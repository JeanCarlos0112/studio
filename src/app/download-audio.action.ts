// This server action handles the download of audio from a YouTube URL.
// For single videos, it downloads the video, converts it to MP3 using ffmpeg, and streams it.
// For playlists, it downloads each video, converts to MP3, packages them into a ZIP file, and streams the ZIP.
// IMPORTANT: Requires ffmpeg to be installed and in the system PATH on the server.

'use server';

import ytdl, { type videoInfo as YtdlVideoInfo, type videoFormat as YtdlVideoFormat } from 'ytdl-core';
import { PassThrough, Readable } from 'stream';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import Ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import JSZip from 'jszip';

Ffmpeg.setFfmpegPath(ffmpegStatic as string);


// Helper to sanitize filenames
const sanitizeFilename = (name: string): string => {
  let saneName = name.replace(/[^a-z0-9_.\-\s]/gi, '_').replace(/\s+/g, ' ');
  if (saneName.length > 100) {
    saneName = saneName.substring(0, 100).trim();
  }
  if (saneName.endsWith('.')) {
      saneName = saneName.substring(0, saneName.length -1) + '_';
  }
  if (!saneName || saneName === '.mp3' || saneName === '.zip') { 
    saneName = `downloaded_file${saneName}`;
  }
  return saneName;
}

interface DownloadError {
  error: string;
}

const YTDL_HIGH_WATER_MARK = 1 << 25; // 32MB buffer for the stream from ytdl

// Enhanced error logging
async function logDetailedError(error: any, context: string, urlOrTitle: string, videoInfo?: YtdlVideoInfo, chosenFormat?: YtdlVideoFormat, customData?: Record<string, any>) {
    console.error(`\n--- DETAILED ERROR REPORT ---`);
    console.error(`Timestamp: ${new Date().toISOString()}`);
    console.error(`Context: ${context}`);
    console.error(`Processed URL/Title: ${urlOrTitle}`);

    if (videoInfo) {
        console.error(`Video Info (if available):`);
        console.error(`  Title: ${videoInfo.videoDetails.title}`);
        console.error(`  Is Live: ${videoInfo.videoDetails.isLiveContent}`);
    } else {
        console.error(`Video Info: Not available or not applicable.`);
    }
    if (chosenFormat) {
        console.error(`Chosen Format (if available):`);
        console.error(`  MIME Type: ${chosenFormat.mimeType}`);
        console.error(`  Quality Label: ${chosenFormat.qualityLabel}`);
        console.error(`  Has Audio: ${chosenFormat.hasAudio}`);
        console.error(`  Has Video: ${chosenFormat.hasVideo}`);
    } else {
        console.error(`Chosen Format: Not available or not applicable.`);
    }

    if (customData) {
        console.error(`Custom Data: ${JSON.stringify(customData, null, 2)}`);
    }

    console.error("Error Type:", Object.prototype.toString.call(error));
    if (error instanceof Error) {
        console.error("Error Name:", error.name);
        console.error("Error Message:", error.message);
        const errorAny = error as any;
        if(errorAny.statusCode) {
            console.error("Error Status Code:", errorAny.statusCode);
        }
        if(errorAny.source) {
            console.error("Error Source:", errorAny.source);
        }
        if(errorAny.stdErr) { // For ffmpeg errors
            console.error("FFmpeg stderr:", errorAny.stdErr);
        }
        console.error("Error Stack:\n", error.stack);
    } else {
        console.error("Caught non-Error object:", error);
    }
    console.error(`--- END DETAILED ERROR REPORT ---\n`);
}


async function downloadAndConvertToMp3(
    youtubeUrl: string, 
    title: string, 
    tempDir: string, 
    operationSignal?: AbortSignal 
): Promise<string> {
  const videoTitle = sanitizeFilename(title);
  const tempVideoPath = path.join(tempDir, `${videoTitle}_${Date.now()}.mp4`);
  const tempMp3Path = path.join(tempDir, `${videoTitle}_${Date.now()}.mp3`);

  if (operationSignal?.aborted) throw new Error(`Download cancelled for "${title}" before starting download.`);
  
  let videoInfo: YtdlVideoInfo;
  try {
    videoInfo = await ytdl.getInfo(youtubeUrl, { lang: 'en' });
  } catch (infoError: any) {
    if (operationSignal?.aborted) throw new Error(`Download cancelled for "${title}" during getInfo.`);
    await logDetailedError(infoError, `ytdl.getInfo for ${title}`, youtubeUrl);
    throw new Error(`Failed to get video info for "${title}": ${infoError.message || 'Unknown ytdl.getInfo error'}`);
  }
  
  if (videoInfo.videoDetails.isLiveContent) {
    throw new Error(`"${title}" is a live stream and cannot be processed.`);
  }

  const format = ytdl.chooseFormat(videoInfo.formats, { 
    quality: 'highestvideo', 
    filter: (format) => format.hasAudio && format.hasVideo && format.container === 'mp4',
  });

  let chosenFormat = format;

  if (!chosenFormat) {
    const fallbackFormat = ytdl.chooseFormat(videoInfo.formats, { quality: 'highestvideo', filter: (f) => f.hasAudio && f.hasVideo });
    if (!fallbackFormat) {
        if (operationSignal?.aborted) throw new Error(`Download cancelled for "${title}" during format selection.`);
        await logDetailedError(new Error('No suitable video format found'), `ytdl.chooseFormat for ${title}`, youtubeUrl, videoInfo);
        throw new Error(`No suitable video format found for "${title}".`);
    }
    chosenFormat = fallbackFormat;
  }
  
  if (!chosenFormat) { 
    if (operationSignal?.aborted) throw new Error(`Download cancelled for "${title}" during format selection (post-fallback).`);
    await logDetailedError(new Error('No suitable video format found even after fallback'), `ytdl.chooseFormat for ${title}`, youtubeUrl, videoInfo);
    throw new Error(`No suitable video format found for "${title}" even after fallback.`);
  }


  const videoStream = ytdl(youtubeUrl, {
    format: chosenFormat,
    highWaterMark: YTDL_HIGH_WATER_MARK,
  });
  
  const fileWriteStream = fs.createWriteStream(tempVideoPath);

  const downloadPromise = new Promise<void>((resolve, reject) => {
    const checkCancellationInterval = setInterval(() => {
        if (operationSignal?.aborted) { 
            videoStream.destroy(new Error('Download cancelled by client.'));
            if (!fileWriteStream.destroyed) {
                fileWriteStream.destroy(new Error('Download cancelled by client.'));
            }
            clearInterval(checkCancellationInterval);
            reject(new Error(`Video download for "${title}" cancelled.`));
        }
    }, 500);


    videoStream.pipe(fileWriteStream);
    fileWriteStream.on('finish', () => {
        clearInterval(checkCancellationInterval);
        if (operationSignal?.aborted) {
            reject(new Error(`Video download for "${title}" cancelled post-finish event.`));
        } else {
            resolve();
        }
    });
    fileWriteStream.on('error', async (err) => {
        clearInterval(checkCancellationInterval);
        if (operationSignal?.aborted) {
             reject(new Error(`Video download for "${title}" cancelled during writestream error.`));
        } else {
            await logDetailedError(err, `WriteStream error during video download for ${title}`, youtubeUrl, videoInfo, chosenFormat);
            reject(new Error(`Failed to write video file for "${title}": ${err.message || 'WriteStream error'}`));
        }
    });
    videoStream.on('error', async (err) => {
        clearInterval(checkCancellationInterval);
        if (!fileWriteStream.destroyed) {
            fileWriteStream.destroy(); 
        }
        if (operationSignal?.aborted || (err.message && err.message.toLowerCase().includes('cancel'))) {
             reject(new Error(`Video download for "${title}" cancelled during ytdl stream error.`));
        } else {
            await logDetailedError(err, `ytdl stream error during video download for ${title}`, youtubeUrl, videoInfo, chosenFormat);
            reject(new Error(`Failed to download video stream for "${title}": ${err.message || 'ytdl stream error'}`));
        }
    });
  });

  await downloadPromise;

  if (operationSignal?.aborted) throw new Error(`Download cancelled for "${title}" after video download, before conversion.`);

  const ffmpegCommand = Ffmpeg(tempVideoPath)
    .noVideo() 
    .audioCodec('libmp3lame')
    .audioBitrate('192k')
    .toFormat('mp3');
  
  const conversionPromise = new Promise<void>((resolve, reject) => {
    let ffmpegKilled = false;
    const checkCancellationInterval = setInterval(() => {
        if (operationSignal?.aborted) { 
            try {
                if (!ffmpegKilled) {
                    ffmpegCommand.kill('SIGTERM'); 
                    ffmpegKilled = true;
                }
            } catch (killError) {
                console.warn(`Error attempting to kill ffmpeg for "${title}": ${(killError as Error).message}`);
            }
            clearInterval(checkCancellationInterval);
            reject(new Error(`FFmpeg conversion for "${title}" cancelled.`));
        }
    }, 500);

    ffmpegCommand
      .on('error', async (err: any, stdout: string, stderr: string) => {
        clearInterval(checkCancellationInterval);
        if (operationSignal?.aborted || ffmpegKilled) { 
             reject(new Error(`FFmpeg conversion for "${title}" was cancelled (on error event).`));
             return;
        }
        const ffmpegErrorMessage = err.message || 'FFmpeg conversion error';
        const ffmpegError = new Error(`FFmpeg conversion failed for "${title}": ${ffmpegErrorMessage}`);
        (ffmpegError as any).stdErr = stderr; 
        await logDetailedError(ffmpegError, `FFmpeg conversion for ${title}`, youtubeUrl, videoInfo, chosenFormat, {tempVideoPath, tempMp3Path, ffmpegStdout: stdout, ffmpegStderr: stderr});
        reject(ffmpegError);
      })
      .on('end', () => {
        clearInterval(checkCancellationInterval);
        if (operationSignal?.aborted || ffmpegKilled) {
            reject(new Error(`FFmpeg conversion for "${title}" was cancelled (on end event).`));
        } else {
            resolve();
        }
      })
      .save(tempMp3Path);
  });

  try {
    await conversionPromise;
  } catch(error: any) {
     if (operationSignal?.aborted) {
        throw new Error(`Download cancelled for "${title}" during ffmpeg conversion (caught error).`);
     }
    throw new Error(`FFmpeg processing failed for "${title}": ${error.message || 'Unknown FFmpeg error'}`);
  } finally {
    await fsp.unlink(tempVideoPath).catch(err => console.warn(`Could not delete temp video file ${tempVideoPath}: ${err.message}`));
  }
  
  if (operationSignal?.aborted) { 
    await fsp.unlink(tempMp3Path).catch(err => console.warn(`Could not delete temp MP3 file ${tempMp3Path} after cancelled conversion: ${err.message}`));
    throw new Error(`Download cancelled for "${title}" post-ffmpeg processing.`);
  }
  
  return tempMp3Path;
}


export async function downloadAudioAction(
  youtubeUrl: string, 
  playlistItems: { url: string; title: string }[] | null, 
  isPlaylist: boolean,
  playlistTitle?: string,
  clientSignal?: AbortSignal 
): Promise<Response | DownloadError> {
  
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'yt-audio-'));

  try {
    // Removed initial clientSignal?.aborted check here.
    // downloadAndConvertToMp3 will perform its own initial check.

    if (isPlaylist && playlistItems && playlistItems.length > 0) {
      const zip = new JSZip();
      const playlistName = sanitizeFilename(playlistTitle || 'youtube_playlist');

      for (let i = 0; i < playlistItems.length; i++) {
        if (clientSignal?.aborted) { 
            throw new Error("Playlist processing cancelled by client during item iteration.");
        }
        const item = playlistItems[i];
        try {
          const mp3Path = await downloadAndConvertToMp3(item.url, item.title, tempDir, clientSignal); 
          const mp3Data = await fsp.readFile(mp3Path);
          zip.file(`${sanitizeFilename(item.title)}.mp3`, mp3Data);
          await fsp.unlink(mp3Path).catch(e => console.warn(`Failed to clean up ${mp3Path}: ${e.message}`));
        } catch (itemError: any) {
           const isCancellation = itemError.name === 'AbortError' || 
                                 (itemError.message && itemError.message.toLowerCase().includes('cancel')) ||
                                 clientSignal?.aborted; // Check signal here again for safety, though error message is primary

           if (isCancellation) {
            console.info(`Skipping playlist item "${item.title}" due to cancellation: ${itemError.message}`);
             zip.file(`CANCELLED_${sanitizeFilename(item.title)}.txt`, `Processing cancelled for: ${item.title}`);
             if (clientSignal?.aborted) {
                throw new Error(`Playlist processing cancelled by client: ${itemError.message}`); 
             }
          } else {
            console.warn(`Skipping playlist item "${item.title}" due to error: ${itemError.message || 'Unknown error during item processing'}`);
            await logDetailedError(itemError, `Processing playlist item "${item.title}"`, item.url);
            zip.file(`ERROR_${sanitizeFilename(item.title)}.txt`, `Failed to process: ${itemError.message || 'Unknown error'}`);
          }
        }
      }

      if (clientSignal?.aborted) { 
        throw new Error("Playlist processing cancelled by client before zipping.");
      }

      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', streamFiles: true });
      
      const headers = new Headers();
      headers.set('Content-Disposition', `attachment; filename="${playlistName}.zip"`);
      headers.set('Content-Type', 'application/zip');
      headers.set('Content-Length', zipBuffer.length.toString());

      return new Response(zipBuffer, { status: 200, headers });

    } else {
      if (!ytdl.validateURL(youtubeUrl)) {
        return { error: 'Invalid YouTube URL provided for single video.' };
      }
      
      let videoInfo: YtdlVideoInfo;
      try {
        videoInfo = await ytdl.getInfo(youtubeUrl, { lang: 'en' });
      } catch (e: any) {
        if (clientSignal?.aborted) throw new Error(`Single video download cancelled during getInfo.`);
        await logDetailedError(e, 'ytdl.getInfo for single video', youtubeUrl);
        return { error: `Failed to get video info: ${e.message || 'Unknown ytdl.getInfo error'}`};
      }

      if (videoInfo.videoDetails.isLiveContent) {
        return { error: `Downloading live streams is not currently supported.` };
      }
      const title = videoInfo.videoDetails.title;

      if (clientSignal?.aborted) { 
        throw new Error("Single video download cancelled by client before processing.");
      }

      const mp3Path = await downloadAndConvertToMp3(youtubeUrl, title, tempDir, clientSignal); 
      
      const stats = await fsp.stat(mp3Path);
      const fileStream = fs.createReadStream(mp3Path);
      
      const passThrough = new PassThrough();
      fileStream.pipe(passThrough);

      fileStream.on('error', (err) => {
        console.error(`[downloadAudioAction] Error reading MP3 file stream ${mp3Path}:`, err);
        if (!passThrough.destroyed) {
          passThrough.destroy(err);
        }
      });
     
      const safeFilename = `${sanitizeFilename(title)}.mp3`;
      const headers = new Headers();
      headers.set('Content-Disposition', `attachment; filename="${encodeURIComponent(safeFilename)}"`);
      headers.set('Content-Type', 'audio/mpeg');
      headers.set('Content-Length', stats.size.toString());
      
      const readableStream = new ReadableStream({
        start(controller) {
          passThrough.on('data', (chunk) => {
            if (clientSignal?.aborted) { 
                const abortError = new Error('Download cancelled by client during streaming.');
                (abortError as any).name = 'AbortError'; 
                controller.error(abortError);
                if (!passThrough.destroyed) passThrough.destroy(abortError);
                if (!fileStream.destroyed) fileStream.destroy(abortError);
                return;
            }
            controller.enqueue(chunk);
          });
          passThrough.on('end', () => {
            if (clientSignal?.aborted) {
                 const abortError = new Error('Download cancelled by client just before stream completion.');
                (abortError as any).name = 'AbortError';
                controller.error(abortError);
            } else {
                controller.close();
            }
          });
          passThrough.on('error', (err) => {
             if (clientSignal?.aborted && !(err.name === 'AbortError' || (err.message && err.message.toLowerCase().includes('cancel')))) {
                 const abortError = new Error('Download cancelled by client during passthrough error.');
                (abortError as any).name = 'AbortError';
                controller.error(abortError);
             } else {
                controller.error(err);
             }
          });
        },
        cancel(reason) {
          console.info(`[downloadAudioAction] ReadableStream cancelled. Reason: ${reason}`);
          const errorToPropagate = reason instanceof Error ? reason : new Error(String(reason));
          if (! (errorToPropagate.name === 'AbortError' || (errorToPropagate.message && errorToPropagate.message.toLowerCase().includes('cancel')))){
             (errorToPropagate as any).name = 'AbortError'; // Ensure it's marked as an abort/cancel
          }
          if (!passThrough.destroyed) passThrough.destroy(errorToPropagate);
          if (!fileStream.destroyed) fileStream.destroy(errorToPropagate);
        }
      });
      
      const response = new Response(readableStream, { status: 200, headers });
      
      const cleanup = async () => {
        if (!fileStream.destroyed) {
          fileStream.destroy();
        }
        await fsp.unlink(mp3Path).catch(e => console.warn(`Could not delete temp mp3 file ${mp3Path} after stream: ${e.message}`));
      };
      
      // 'close' might not fire if stream errors or is destroyed prematurely.
      // Listen to both 'close' and 'error' on passThrough for cleanup.
      let cleanedUp = false;
      const performCleanupOnce = () => {
          if (!cleanedUp) {
              cleanup();
              cleanedUp = true;
          }
      };
      passThrough.on('close', performCleanupOnce);
      passThrough.on('error', performCleanupOnce);


      return response;
    }
  } catch (error: any) {
    // No direct clientSignal.aborted check here. Rely on error properties.
    const isCancellationError = (error.name === 'AbortError') ||
                                (error.message && typeof error.message === 'string' &&
                                 (error.message.toLowerCase().includes('cancel') ||
                                  error.message.toLowerCase().includes('abort')));

    if (isCancellationError) {
        const cancellationMessage = error.message || "Operation cancelled.";
        console.info(`[downloadAudioAction] Operation was explicitly cancelled: ${cancellationMessage}`);
        return { error: `Operation cancelled: ${cancellationMessage}` };
    }
    
    await logDetailedError(error, 'downloadAudioAction main try-catch', isPlaylist && playlistTitle ? `playlist: ${playlistTitle}`: youtubeUrl);
    
    let errorMessage = "An unknown error occurred.";
    if (error instanceof Error) { 
        errorMessage = error.message;
    } else if (typeof error === 'string') { 
        errorMessage = error;
    } else if (error && typeof error.message === 'string') { 
        errorMessage = error.message;
    }
    
    return { error: errorMessage };
  } finally {
    setTimeout(async () => {
        await fsp.rm(tempDir, { recursive: true, force: true }).catch(err => console.warn(`Failed to remove temp directory ${tempDir}: ${err.message}`));
    }, 5000);
  }
}
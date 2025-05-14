// This server action handles the download of audio from a YouTube URL.
// For single videos, it downloads the video, converts it to MP3 using ffmpeg, and streams it.
// For playlists, it downloads each video, converts to MP3, packages them into a ZIP file, and streams the ZIP.
// IMPORTANT: Requires ffmpeg to be installed and in the system PATH on the server.

'use server';

import ytdl from '@distube/ytdl-core';
type YtdlVideoInfo = Awaited<ReturnType<typeof ytdl.getInfo>>;
type YtdlVideoFormat = NonNullable<YtdlVideoInfo['formats']>[number];
import * as stream from 'stream';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import Ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import JSZip from 'jszip';

Ffmpeg.setFfmpegPath(ffmpegStatic as string);

// Custom AbortError for clearer distinction
class AbortErrorCustom extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AbortErrorCustom';
  }
}


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
const ytdlRequestOptions = {
  requestOptions: {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    },
  },
};


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
        if(errorAny.stdErr) {
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
    isOperationInitiallyCancelled?: boolean
): Promise<string> {
  const videoTitle = sanitizeFilename(title);
  const tempVideoPath = path.join(tempDir, `${videoTitle}_${Date.now()}.mp4`);
  const tempMp3Path = path.join(tempDir, `${videoTitle}_${Date.now()}.mp3`);

  if (isOperationInitiallyCancelled) {
    throw new AbortErrorCustom(`Download cancelled for "${title}" before starting (initial flag).`);
  }

  let videoInfo: YtdlVideoInfo;
  try {
    videoInfo = await ytdl.getInfo(youtubeUrl, {
        lang: 'en',
        ...ytdlRequestOptions,
     });
  } catch (infoError: any) {
    if (infoError.name === 'AbortError' || infoError instanceof AbortErrorCustom) { // Check for our custom abort
        throw new AbortErrorCustom(`Download cancelled for "${title}" during getInfo.`);
    }
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
    chosenFormat = fallbackFormat;
  }

  if (!chosenFormat) {
    if (isOperationInitiallyCancelled) throw new AbortErrorCustom(`Download cancelled for "${title}" during format selection (post-fallback).`);
    await logDetailedError(new Error('No suitable video format found even after fallback'), `ytdl.chooseFormat for ${title}`, youtubeUrl, videoInfo);
    throw new Error(`No suitable video format found for "${title}" even after fallback.`);
  }

  const videoStream = ytdl(youtubeUrl, {
    format: chosenFormat,
    highWaterMark: YTDL_HIGH_WATER_MARK,
  });

  const fileWriteStream = fs.createWriteStream(tempVideoPath);

  const downloadPromise = new Promise<void>((resolve, reject) => {
    if (isOperationInitiallyCancelled) {
        return reject(new AbortErrorCustom(`Video download for "${title}" cancelled (initial flag).`));
    }

    videoStream.pipe(fileWriteStream);

    fileWriteStream.on('finish', () => {
        resolve();
    });
    fileWriteStream.on('error', async (err) => {
        if (err instanceof AbortErrorCustom) {
             reject(err);
        } else {
            await logDetailedError(err, `WriteStream error during video download for ${title}`, youtubeUrl, videoInfo, chosenFormat);
            reject(new Error(`Failed to write video file for "${title}": ${err.message || 'WriteStream error'}`));
        }
    });
    videoStream.on('error', async (err: any) => {
        const writableFinished = (fileWriteStream as any).writableFinished ?? false;
        const destroyed = (fileWriteStream as any).destroyed ?? false;
        if (!writableFinished && !destroyed) {
            fileWriteStream.close();
        }
        if (err instanceof AbortErrorCustom || err.name === 'AbortError') {
             reject(err instanceof AbortErrorCustom || err.name === 'AbortError' ? err : new AbortErrorCustom(`Video download for "${title}" cancelled during ytdl stream error.`));
        } else {
            await logDetailedError(err, `ytdl stream error during video download for ${title}`, youtubeUrl, videoInfo, chosenFormat);
            reject(new Error(`Failed to download video stream for "${title}": ${err.message || 'ytdl stream error'}`));
        }
    });
  }); // <-- Add this closing bracket to end the Promise block

  await downloadPromise;

  if (isOperationInitiallyCancelled) {
    throw new AbortErrorCustom(`Download cancelled for "${title}" after video download, before conversion.`);
  }


  const ffmpegCommand = Ffmpeg(tempVideoPath)
    .noVideo()
    .audioCodec('libmp3lame')
    .audioBitrate('192k')
    .toFormat('mp3');

  const conversionPromise = new Promise<void>((resolve, reject) => {
    if (isOperationInitiallyCancelled) {
        return reject(new AbortErrorCustom(`FFmpeg conversion for "${title}" cancelled (initial flag).`));
    }

    let ffmpegKilledByError = false;

    ffmpegCommand
      .on('end', () => {
        if (ffmpegKilledByError) {
             if (isOperationInitiallyCancelled) {
                reject(new AbortErrorCustom(`FFmpeg conversion for "${title}" ended but was initially cancelled.`));
                return;
            }
        }
        resolve();
      })
      .save(tempMp3Path);

    // Attach error handler separately to avoid TypeScript overload issues
    (ffmpegCommand as any).on('error', async (err: any, stdout: string, stderr: string) => {
      ffmpegKilledByError = true;
      if (err.message?.includes('SIGTERM') || err.message?.includes('killed')) {
           reject(new AbortErrorCustom(`FFmpeg conversion for "${title}" was cancelled/killed (on error event).`));
           return;
      }
      const ffmpegErrorMessage = err.message || 'FFmpeg conversion error';
      const ffmpegError = new Error(`FFmpeg conversion failed for "${title}": ${ffmpegErrorMessage}`);
      (ffmpegError as any).stdErr = stderr;
      await logDetailedError(ffmpegError, `FFmpeg conversion for ${title}`, youtubeUrl, videoInfo, chosenFormat, {tempVideoPath, tempMp3Path, ffmpegStdout: stdout, ffmpegStderr: stderr});
      reject(ffmpegError);
    });
  });

  try {
    await conversionPromise;
  } catch(error: any) {
     if (error instanceof AbortErrorCustom || error.name === 'AbortError') {
        throw error;
     }
    throw new Error(`FFmpeg processing failed for "${title}": ${error.message || 'Unknown FFmpeg error'}`);
  } finally {
    await fsp.unlink(tempVideoPath).catch(err => console.warn(`Could not delete temp video file ${tempVideoPath}: ${err.message}`));
  }

  if (isOperationInitiallyCancelled) {
    await fsp.unlink(tempMp3Path).catch(err => console.warn(`Could not delete temp MP3 file ${tempMp3Path} after cancelled conversion: ${err.message}`));
    throw new AbortErrorCustom(`Download cancelled for "${title}" post-ffmpeg processing.`);
  }

  return tempMp3Path;
}


export async function downloadAudioAction(
  youtubeUrl: string,
  playlistItems: { url: string; title: string }[] | null,
  isPlaylist: boolean,
  playlistTitle?: string,
  isClientCancelledInitially?: boolean // Boolean flag for initial client cancellation state
): Promise<Response | DownloadError> {

  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'yt-audio-'));

  try {
    if (isClientCancelledInitially) {
        throw new AbortErrorCustom("Operation cancelled by client before starting.");
    }

    if (isPlaylist && playlistItems && playlistItems.length > 0) {
      const zip = new JSZip();
      const playlistName = sanitizeFilename(playlistTitle || 'youtube_playlist');

      for (let i = 0; i < playlistItems.length; i++) {
        if (isClientCancelledInitially) {
            throw new AbortErrorCustom("Playlist processing cancelled by client (initial flag check in loop).");
        }

        const item = playlistItems[i];
        try {
          const mp3Path = await downloadAndConvertToMp3(item.url, item.title, tempDir, isClientCancelledInitially);
          const mp3Data = await fsp.readFile(mp3Path);
          zip.file(`${sanitizeFilename(item.title)}.mp3`, mp3Data);
          await fsp.unlink(mp3Path).catch(e => console.warn(`Failed to clean up ${mp3Path}: ${e.message}`));
        } catch (itemError: any) {
           const isCancellation = itemError instanceof AbortErrorCustom || itemError.name === 'AbortError' ||
                                 (itemError.message && itemError.message.toLowerCase().includes('cancel'));

           if (isCancellation) {
            console.info(`Skipping playlist item "${item.title}" due to cancellation: ${itemError.message}`);
             zip.file(`CANCELLED_${sanitizeFilename(item.title)}.txt`, `Processing cancelled for: ${item.title}`);
             if (isClientCancelledInitially) {
                throw new AbortErrorCustom(`Playlist processing aborted due to initial cancellation: ${itemError.message}`);
             }
          } else {
            console.warn(`Skipping playlist item "${item.title}" due to error: ${itemError.message || 'Unknown error during item processing'}`);
            await logDetailedError(itemError, `Processing playlist item "${item.title}"`, item.url);
            zip.file(`ERROR_${sanitizeFilename(item.title)}.txt`, `Failed to process: ${itemError.message || 'Unknown error'}`);
          }
        }
      }

      if (isClientCancelledInitially) {
        throw new AbortErrorCustom("Playlist processing cancelled by client before zipping.");
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
        videoInfo = await ytdl.getInfo(youtubeUrl, {
            lang: 'en',
            ...ytdlRequestOptions,
        });
      } catch (e: any) {
        if (e instanceof AbortErrorCustom || e.name === 'AbortError') { // Check for our custom abort
            throw new AbortErrorCustom(`Single video download cancelled during getInfo.`);
        }
        await logDetailedError(e, 'ytdl.getInfo for single video', youtubeUrl);
        return { error: `Failed to get video info: ${e.message || 'Unknown ytdl.getInfo error'}`};
      }

      if (videoInfo.videoDetails.isLiveContent) {
        return { error: `Downloading live streams is not currently supported.` };
      }
      const title = videoInfo.videoDetails.title;

      if (isClientCancelledInitially) {
        throw new AbortErrorCustom("Single video download cancelled by client before processing.");
      }

      const mp3Path = await downloadAndConvertToMp3(youtubeUrl, title, tempDir, isClientCancelledInitially);
      const fileStream = fs.createReadStream(mp3Path);
      const passThrough = new stream.PassThrough();
      (fileStream as unknown as NodeJS.ReadableStream).pipe(passThrough);

      fileStream.on('error', (err: NodeJS.ErrnoException) => {
        console.error(`[downloadAudioAction] Error reading MP3 file stream ${mp3Path}:`, err);
        if (!(passThrough as any).destroyed) {
          passThrough.destroy(err);
        }
      });

      const safeFilename = `${sanitizeFilename(title)}.mp3`;
      const stats = await fsp.stat(mp3Path);
      const headers = new Headers();
      headers.set('Content-Disposition', `attachment; filename="${encodeURIComponent(safeFilename)}"`);
      headers.set('Content-Type', 'audio/mpeg');
      headers.set('Content-Length', stats.size.toString());
      const readableWebStream = new ReadableStream({
        start(controller: ReadableStreamDefaultController) {
          if (isClientCancelledInitially) {
            const abortError = new AbortErrorCustom('Download stream cancelled by initial client request.');
            controller.error(abortError);
            if (!(passThrough as any).destroyed) passThrough.destroy(abortError);
            if (typeof (fileStream as any).destroy === 'function') (fileStream as any).destroy(abortError);
            return;
          }

          passThrough.on('data', (chunk: any) => {
            try {
              controller.enqueue(chunk);
            } catch (e) {
              console.warn("[downloadAudioAction] Error enqueuing chunk to ReadableStream:", e);
              if (typeof (fileStream as any).destroy === 'function') (fileStream as any).destroy(e as Error);
              if (!(passThrough as any).destroyed) passThrough.destroy(e as Error);
              controller.error(e as Error); // Ensure controller errors out
            }
          });
          passThrough.on('end', () => {
            try {
              controller.close();
            } catch(e) {
              console.warn("[downloadAudioAction] Error closing controller on 'end':", e);
            }
          });
          passThrough.on('error', (err: any) => {
            try {
              controller.error(err);
            } catch(e) {
              console.warn("[downloadAudioAction] Error signaling controller error on 'passThrough error':", e);
            }
          });
        },
        cancel(reason: any) {
          console.info(`[downloadAudioAction] ReadableStream cancelled by client. Reason: ${reason}`);
          const finalError = reason instanceof Error ? reason : new Error(String(reason));
          if (!(passThrough as any).destroyed) passThrough.destroy(finalError);
          if (typeof (fileStream as any).destroy === 'function') (fileStream as any).destroy(finalError);
        }
      });

      const response = new Response(readableWebStream, { status: 200, headers });

      let cleanedUp = false;
      const performCleanupOnce = async () => {
          if (!cleanedUp) {
              cleanedUp = true;
              if (fileStream && typeof (fileStream as any).destroy === 'function') {
                (fileStream as any).destroy();
              }
              if (mp3Path) {
                await fsp.unlink(mp3Path).catch(e => console.warn(`Could not delete temp mp3 file ${mp3Path} after stream: ${e.message}`));
              }
          }
      };

      passThrough.on('close', performCleanupOnce);
      passThrough.on('error', performCleanupOnce); // Ensure cleanup on error too

      return response;

      return response;
    }
  } catch (error: any) {
    // Check if the error is an AbortError or if the client-provided flag indicates abortion
    if (error instanceof AbortErrorCustom || (isClientCancelledInitially && error.name === 'AbortError')) {
        const cancellationMessage = error.message || "Operation cancelled by client.";
        console.info(`[downloadAudioAction] Operation was explicitly cancelled: ${cancellationMessage}`);
        return { error: `Operation cancelled: ${cancellationMessage}` };
    }
    if (error.name === 'AbortError') { // Catch generic AbortErrors if isClientCancelledInitially was false but error still happened
        const cancellationMessage = error.message || "Operation aborted.";
        console.info(`[downloadAudioAction] Operation was aborted: ${cancellationMessage}`);
        return { error: `Operation aborted: ${cancellationMessage}` };
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
    }, 10000);
  }
}

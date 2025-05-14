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
async function logDetailedError(error: any, context: string, url: string, videoInfo?: YtdlVideoInfo, chosenFormat?: YtdlVideoFormat, customData?: Record<string, any>) {
    console.error(`\n--- DETAILED ERROR REPORT ---`);
    console.error(`Timestamp: ${new Date().toISOString()}`);
    console.error(`Context: ${context}`);
    console.error(`Processed URL: ${url}`);

    if (videoInfo) {
        console.error(`Video Info (if available):`);
        console.error(`  Title: ${videoInfo.videoDetails.title}`);
        console.error(`  Is Live: ${videoInfo.videoDetails.isLiveContent}`);
    } else {
        console.error(`Video Info: Not available (error likely occurred during getInfo).`);
    }
    if (chosenFormat) {
        console.error(`Chosen Format (if available):`);
        console.error(`  MIME Type: ${chosenFormat.mimeType}`);
        console.error(`  Quality Label: ${chosenFormat.qualityLabel}`);
        console.error(`  Has Audio: ${chosenFormat.hasAudio}`);
        console.error(`  Has Video: ${chosenFormat.hasVideo}`);
    } else {
        console.error(`Chosen Format: Not available (error likely occurred before format selection).`);
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


async function downloadAndConvertToMp3(youtubeUrl: string, title: string, tempDir: string): Promise<string> {
  const videoTitle = sanitizeFilename(title);
  const tempVideoPath = path.join(tempDir, `${videoTitle}_${Date.now()}.mp4`);
  const tempMp3Path = path.join(tempDir, `${videoTitle}_${Date.now()}.mp3`);

  let videoInfo: YtdlVideoInfo;
  try {
    videoInfo = await ytdl.getInfo(youtubeUrl, { lang: 'en' });
  } catch (infoError: any) {
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
        await logDetailedError(new Error('No suitable video format found'), `ytdl.chooseFormat for ${title}`, youtubeUrl, videoInfo);
        throw new Error(`No suitable video format found for "${title}".`);
    }
    chosenFormat = fallbackFormat;
  }
  
  if (!chosenFormat) { 
    await logDetailedError(new Error('No suitable video format found even after fallback'), `ytdl.chooseFormat for ${title}`, youtubeUrl, videoInfo);
    throw new Error(`No suitable video format found for "${title}" even after fallback.`);
  }


  const videoStream = ytdl(youtubeUrl, {
    format: chosenFormat,
    highWaterMark: YTDL_HIGH_WATER_MARK,
  });
  
  const fileWriteStream = fs.createWriteStream(tempVideoPath);
  videoStream.pipe(fileWriteStream);

  await new Promise((resolve, reject) => {
    fileWriteStream.on('finish', resolve);
    fileWriteStream.on('error', async (err) => {
        await logDetailedError(err, `WriteStream error during video download for ${title}`, youtubeUrl, videoInfo, chosenFormat);
        reject(new Error(`Failed to write video file for "${title}": ${err.message || 'WriteStream error'}`));
    });
    videoStream.on('error', async (err) => {
        await logDetailedError(err, `ytdl stream error during video download for ${title}`, youtubeUrl, videoInfo, chosenFormat);
        if (!fileWriteStream.destroyed) {
            fileWriteStream.destroy(); 
        }
        reject(new Error(`Failed to download video stream for "${title}": ${err.message || 'ytdl stream error'}`));
    });
  });

  try {
    await new Promise<void>((resolve, reject) => {
      Ffmpeg(tempVideoPath)
        .noVideo() 
        .audioCodec('libmp3lame')
        .audioBitrate('192k')
        .toFormat('mp3')
        .on('error', async (err: any, stdout: string, stderr: string) => {
          const ffmpegErrorMessage = err.message || 'FFmpeg conversion error';
          const ffmpegError = new Error(`FFmpeg conversion failed for "${title}": ${ffmpegErrorMessage}`);
          (ffmpegError as any).stdErr = stderr; 
          await logDetailedError(ffmpegError, `FFmpeg conversion for ${title}`, youtubeUrl, videoInfo, chosenFormat, {tempVideoPath, tempMp3Path, ffmpegStdout: stdout, ffmpegStderr: stderr});
          reject(ffmpegError);
        })
        .on('end', () => resolve())
        .save(tempMp3Path);
    });
  } catch(error: any) {
     // error is already logged by the .on('error') handler with more details
    throw new Error(`FFmpeg processing failed for "${title}": ${error.message || 'Unknown FFmpeg error'}`);
  }
  
  await fsp.unlink(tempVideoPath).catch(err => console.warn(`Could not delete temp video file ${tempVideoPath}: ${err.message}`));
  return tempMp3Path;
}


export async function downloadAudioAction(
  youtubeUrl: string, 
  playlistItems: { url: string; title: string }[] | null, 
  isPlaylist: boolean,
  playlistTitle?: string,
  clientAbortSignal?: AbortSignal // Optional client-side AbortSignal
): Promise<Response | DownloadError> {
  
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'yt-audio-'));
  
  try {
    if (clientAbortSignal?.aborted) {
        return { error: 'Download cancelled by client before starting.' };
    }

    if (isPlaylist && playlistItems && playlistItems.length > 0) {
      const zip = new JSZip();
      const playlistName = sanitizeFilename(playlistTitle || 'youtube_playlist');

      for (let i = 0; i < playlistItems.length; i++) {
        if (clientAbortSignal?.aborted) {
            return { error: 'Download cancelled by client during playlist processing.' };
        }
        const item = playlistItems[i];
        try {
          const mp3Path = await downloadAndConvertToMp3(item.url, item.title, tempDir);
          const mp3Data = await fsp.readFile(mp3Path);
          zip.file(`${sanitizeFilename(item.title)}.mp3`, mp3Data);
          await fsp.unlink(mp3Path).catch(e => console.warn(`Failed to clean up ${mp3Path}: ${e.message}`));
        } catch (itemError: any) {
          console.warn(`Skipping playlist item "${item.title}" due to error: ${itemError.message || 'Unknown error during item processing'}`);
          await logDetailedError(itemError, `Processing playlist item "${item.title}"`, item.url);
          zip.file(`ERROR_${sanitizeFilename(item.title)}.txt`, `Failed to process: ${itemError.message || 'Unknown error'}`);
        }
      }

      if (clientAbortSignal?.aborted) {
        return { error: 'Download cancelled by client before sending zip.' };
      }

      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', streamFiles: true });
      
      const headers = new Headers();
      headers.set('Content-Disposition', `attachment; filename="${playlistName}.zip"`);
      headers.set('Content-Type', 'application/zip');
      headers.set('Content-Length', zipBuffer.length.toString());

      return new Response(zipBuffer, { status: 200, headers });

    } else {
      // Single video download
      if (!ytdl.validateURL(youtubeUrl)) {
        return { error: 'Invalid YouTube URL provided for single video.' };
      }
      
      let videoInfo: YtdlVideoInfo;
      try {
        videoInfo = await ytdl.getInfo(youtubeUrl, { lang: 'en' });
      } catch (e: any) {
        await logDetailedError(e, 'ytdl.getInfo for single video', youtubeUrl);
        return { error: `Failed to get video info: ${e.message || 'Unknown ytdl.getInfo error'}`};
      }

      if (videoInfo.videoDetails.isLiveContent) {
        return { error: `Downloading live streams is not currently supported.` };
      }
      const title = videoInfo.videoDetails.title;

      if (clientAbortSignal?.aborted) {
        return { error: 'Download cancelled by client before converting single video.' };
      }

      const mp3Path = await downloadAndConvertToMp3(youtubeUrl, title, tempDir);
      
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
      
      // Create a new ReadableStream from the PassThrough stream for the Response
      const readableStream = new ReadableStream({
        start(controller) {
          passThrough.on('data', (chunk) => {
            if (clientAbortSignal?.aborted) {
              controller.error(new Error('Download cancelled by client during streaming.'));
              passThrough.destroy();
              fileStream.destroy();
              return;
            }
            controller.enqueue(chunk);
          });
          passThrough.on('end', () => {
            controller.close();
          });
          passThrough.on('error', (err) => {
            controller.error(err);
          });
           if (clientAbortSignal) {
            clientAbortSignal.addEventListener('abort', () => {
              controller.error(new Error('Download cancelled by client.'));
              passThrough.destroy();
              fileStream.destroy();
            });
          }
        },
        cancel() {
          passThrough.destroy();
          fileStream.destroy();
        }
      });
      
      const response = new Response(readableStream, { status: 200, headers });
      
      // Cleanup logic for server-side resources.
      // This needs to be handled carefully, especially with streaming.
      // The client closing the connection might not be directly observable here
      // to trigger cleanup perfectly.
      // Consider using a finalization registry or similar pattern if strict cleanup is needed
      // upon client disconnect during streaming.
      const cleanup = () => {
        if (!fileStream.destroyed) {
          fileStream.destroy();
        }
        fsp.unlink(mp3Path).catch(e => console.warn(`Could not delete temp mp3 file ${mp3Path} after stream: ${e.message}`));
      };
      
      // Attempt cleanup when the PassThrough stream ends or errors.
      passThrough.on('end', cleanup);
      passThrough.on('error', cleanup); 
      passThrough.on('close', cleanup);

      return response;
    }
  } catch (error: any) {
    if (error.name === 'AbortError' || (clientAbortSignal?.aborted && error.message?.includes('cancel'))) {
        console.info(`[downloadAudioAction] Operation was explicitly cancelled.`);
        return { error: `Operation cancelled: ${error.message}` };
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
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(err => console.warn(`Failed to remove temp directory ${tempDir}: ${err.message}`));
  }
}

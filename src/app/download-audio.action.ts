
// This server action handles the download of audio from a YouTube URL.
// It validates the URL, fetches video information, chooses the best audio format,
// and then streams the audio back to the client as a file download.

'use server';

import ytdl, { type videoInfo as YtdlVideoInfo, type videoFormat as YtdlVideoFormat } from 'ytdl-core';
import { PassThrough } from 'stream';

// Helper to sanitize filenames
const sanitizeFilename = (name: string): string => {
  // Remove invalid characters, replace spaces, and limit length
  let saneName = name.replace(/[^a-z0-9_.\-\s]/gi, '_').replace(/\s+/g, ' ');
  if (saneName.length > 100) {
    saneName = saneName.substring(0, 100).trim();
  }
  // Ensure it doesn't end with a dot, which can be problematic on some OS
  if (saneName.endsWith('.')) {
      saneName = saneName.substring(0, saneName.length -1) + '_';
  }
  if (!saneName || saneName === '.mp3') { // Handle empty or only extension names
    saneName = 'downloaded_audio.mp3';
  }
  return saneName;
}

interface DownloadError {
  error: string;
}

const YTDL_REQUEST_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
};

const YTDL_HIGH_WATER_MARK = 1 << 25; // 32MB buffer for the stream from ytdl

export async function downloadAudioAction(youtubeUrl: string, customTitle?: string): Promise<Response | DownloadError> {
  let videoInfo: YtdlVideoInfo | undefined;
  let format: YtdlVideoFormat | undefined;

  try {
    if (!ytdl.validateURL(youtubeUrl)) {
      return { error: 'Invalid YouTube URL provided. Please ensure it is a valid video URL.' };
    }

    videoInfo = await ytdl.getInfo(youtubeUrl, { requestOptions: { headers: YTDL_REQUEST_HEADERS }, lang: 'en' });

    if (videoInfo.videoDetails.isLiveContent) {
      return { error: `Downloading live streams as complete audio files is not currently supported. Please use a URL for a non-live video.` };
    }

    const videoTitle = customTitle || videoInfo.videoDetails.title;
    let safeFilename = sanitizeFilename(videoTitle);
    if (!safeFilename.toLowerCase().endsWith('.mp3')) {
        safeFilename += '.mp3';
    }
    if (safeFilename === '.mp3') {
        safeFilename = `audio_${Date.now()}.mp3`;
    }


    format = ytdl.chooseFormat(videoInfo.formats, {
      quality: 'highestaudio',
      filter: 'audioonly',
    });

    if (!format) {
      return { error: `No suitable audio-only format found for this video (${videoTitle}). It might be a live stream or have other restrictions.` };
    }

    const audioStream = ytdl(youtubeUrl, {
      format: format,
      requestOptions: { headers: YTDL_REQUEST_HEADERS },
      highWaterMark: YTDL_HIGH_WATER_MARK,
      // lang: 'en' // lang option is typically for getInfo, not direct download stream
    });

    const passThrough = new PassThrough();
    audioStream.pipe(passThrough);

    audioStream.on('error', (err) => {
      console.error(`[downloadAudioAction] Error during ytdl streaming for URL ${youtubeUrl}, Title: ${videoTitle}:`, err);
      if (!passThrough.destroyed) {
        passThrough.destroy(err instanceof Error ? err : new Error(String(err)));
      }
    });

    passThrough.on('error', (err) => {
      console.error(`[downloadAudioAction] PassThrough stream error for URL ${youtubeUrl}, Title: ${videoTitle}:`, err);
    });

    const headers = new Headers();
    headers.set('Content-Disposition', `attachment; filename="${encodeURIComponent(safeFilename)}"`);
    headers.set('Content-Type', format.mimeType ? (format.mimeType.startsWith('audio/mp4') ? 'audio/mp4' : format.mimeType) : 'audio/mpeg'); 
    if (format.contentLength) {
      headers.set('Content-Length', format.contentLength);
    }

    return new Response(passThrough as unknown as ReadableStream, {
      status: 200,
      headers: headers,
    });

  } catch (error) {
    console.error(`\n--- DETAILED ERROR REPORT ---`);
    console.error(`Timestamp: ${new Date().toISOString()}`);
    console.error(`Processed URL: ${youtubeUrl}`);

    if (videoInfo) {
        console.error(`Video Info (if available at error point):`);
        console.error(`  Title: ${videoInfo.videoDetails.title}`);
        console.error(`  Is Live: ${videoInfo.videoDetails.isLiveContent}`);
    } else {
        console.error(`Video Info: Not available (error likely occurred during getInfo).`);
    }
     if (format) {
        console.error(`Chosen Format (if available at error point):`);
        console.error(`  MIME Type: ${format.mimeType}`);
        console.error(`  Quality Label: ${format.qualityLabel}`);
    } else {
        console.error(`Chosen Format: Not available (error likely occurred before format selection).`);
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
        console.error("Error Stack:\n", error.stack);

        const errorProperties: Record<string, any> = {};
        for (const key in error) {
            if (Object.prototype.hasOwnProperty.call(error, key)) {
                errorProperties[key] = (error as Record<string, any>)[key];
            }
        }
        if (Object.keys(errorProperties).length > 2) { // Print if more than name & message
            const loggedProperties: Record<string, any> = {};
            for (const key in errorProperties) {
                if (typeof errorProperties[key] !== 'object' || errorProperties[key] === null) {
                    loggedProperties[key] = errorProperties[key];
                } else if (Object.keys(errorProperties[key]).length < 10) { // Avoid huge nested objects
                    loggedProperties[key] = errorProperties[key];
                } else {
                    loggedProperties[key] = `[Object with ${Object.keys(errorProperties[key]).length} keys, not fully logged]`;
                }
            }
             console.error("Additional Error Properties (filtered):", JSON.stringify(loggedProperties, null, 2));
        }

    } else {
        console.error("Caught non-Error object:", error);
        try {
            console.error("Stringified non-Error object:", JSON.stringify(error, null, 2));
        } catch (e) {
            console.error("Could not stringify non-Error object:", e);
        }
    }
    console.error(`--- END DETAILED ERROR REPORT ---\n`);

    let errorMessage: string;

    if (error instanceof Error) {
        const lowercaseErrorMessage = typeof error.message === 'string' ? error.message.toLowerCase() : '';
        if (lowercaseErrorMessage.includes('could not extract functions') || lowercaseErrorMessage.includes('error parsing info') || lowercaseErrorMessage.includes('failed to get video info') || lowercaseErrorMessage.includes('signature decipher') || lowercaseErrorMessage.includes('throttled') || lowercaseErrorMessage.includes('no functions found') || lowercaseErrorMessage.includes('nsig') ) {
            errorMessage = `Failed to process this video (URL: ${youtubeUrl}). This error (Original: "${error.message}") commonly occurs when YouTube updates its video player structure, the video has specific restrictions, or your server's IP is throttled. The library 'ytdl-core' (version in use: ${require('ytdl-core/package.json').version}) may need an update. Please try a different video or check back later. If this issue persists, consider checking the ytdl-core GitHub issue tracker for recent reports.`;
        } else if (lowercaseErrorMessage.includes('no suitable format found')) {
             errorMessage = `No suitable audio format could be found for this video (URL: ${youtubeUrl}). It might be a live stream, a members-only video, or have other restrictions. Original error: ${error.message}`;
        } else if (lowercaseErrorMessage.includes('unavailable video') || lowercaseErrorMessage.includes('video is unavailable')) {
            errorMessage = `This video (URL: ${youtubeUrl}) is unavailable. It might be private, deleted, or region-restricted. Original error: ${error.message}`;
        }
         else {
            errorMessage = `An error occurred while processing ${youtubeUrl}: ${error.message}`;
        }
    } else {
        errorMessage = `An unknown error occurred while preparing the audio download for ${youtubeUrl}. Details: ${String(error)}`;
    }
    return { error: errorMessage };
  }
}


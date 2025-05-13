// This server action handles the download of audio from a YouTube URL.
// It validates the URL, fetches video information, chooses the best audio format,
// and then streams the audio back to the client as a file download.

'use server';

import ytdl from 'ytdl-core';
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

export async function downloadAudioAction(youtubeUrl: string, customTitle?: string): Promise<Response | DownloadError> {
  try {
    if (!ytdl.validateURL(youtubeUrl)) {
      return { error: 'Invalid YouTube URL provided. Please ensure it is a valid video URL.' };
    }

    const videoInfo = await ytdl.getInfo(youtubeUrl);
    const videoTitle = customTitle || videoInfo.videoDetails.title;
    // Sanitize filename and ensure it's not empty or just ".mp3"
    let safeFilename = sanitizeFilename(videoTitle);
    if (!safeFilename.toLowerCase().endsWith('.mp3')) {
        safeFilename += '.mp3';
    }
    if (safeFilename === '.mp3') { // If sanitizeFilename resulted in just .mp3 due to an empty/invalid title
        safeFilename = `audio_${Date.now()}.mp3`;
    }


    const format = ytdl.chooseFormat(videoInfo.formats, {
      quality: 'highestaudio',
      filter: 'audioonly',
    });

    if (!format) {
      return { error: `No suitable audio-only format found for this video (${videoTitle}). It might be a live stream or have other restrictions.` };
    }
    
    const audioStream = ytdl(youtubeUrl, { format: format });
    const passThrough = new PassThrough();
    audioStream.pipe(passThrough);

    audioStream.on('error', (err) => {
      console.error(`[downloadAudioAction] Error during ytdl streaming for URL ${youtubeUrl}, Title: ${videoTitle}:`, err);
      if (!passThrough.destroyed) {
        passThrough.destroy(err);
      }
    });

    passThrough.on('error', (err) => {
      console.error(`[downloadAudioAction] PassThrough stream error for URL ${youtubeUrl}, Title: ${videoTitle}:`, err);
    });

    const headers = new Headers();
    headers.set('Content-Disposition', `attachment; filename="${encodeURIComponent(safeFilename)}"`);
    headers.set('Content-Type', format.mimeType || 'audio/mpeg'); // Default to audio/mpeg for .mp3
    if (format.contentLength) {
      headers.set('Content-Length', format.contentLength);
    }
    
    return new Response(passThrough as unknown as ReadableStream, {
      headers: headers,
    });

  } catch (error) {
    console.error(`Error in downloadAudioAction for URL "${youtubeUrl}":`, error);
    let errorMessage: string;
    
    if (error instanceof Error) {
        const lowercaseErrorMessage = typeof error.message === 'string' ? error.message.toLowerCase() : '';
        if (lowercaseErrorMessage.includes('could not extract functions') || lowercaseErrorMessage.includes('error parsing info') || lowercaseErrorMessage.includes('failed to get video info')) {
            errorMessage = `Failed to process this video (URL: ${youtubeUrl}). This often occurs when YouTube updates its video player, the video has specific restrictions (e.g., age-restricted, private, members-only), or it's a live stream. The library used for downloading may need an update to adapt. Please try a different video or check back later. Original error: ${error.message}`;
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

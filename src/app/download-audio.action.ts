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
    const safeFilename = sanitizeFilename(videoTitle) + '.mp3'; // Suggest .mp3 extension

    const format = ytdl.chooseFormat(videoInfo.formats, {
      quality: 'highestaudio',
      filter: 'audioonly',
    });

    if (!format) {
      return { error: 'No suitable audio-only format found for this video. It might be a live stream or have other restrictions.' };
    }
    
    const audioStream = ytdl(youtubeUrl, { format: format });
    const passThrough = new PassThrough();
    audioStream.pipe(passThrough);

    audioStream.on('error', (err) => {
      console.error('Error during ytdl streaming:', err);
      // Ensure the PassThrough stream is destroyed to signal the Response object about the error.
      // This helps in propagating the error to the client if streaming fails mid-way.
      if (!passThrough.destroyed) {
        passThrough.destroy(err);
      }
    });

    passThrough.on('error', (err) => {
      // This listener is crucial if audioStream.pipe(passThrough) itself causes an error
      // or if passThrough.destroy(err) above is called.
      console.error('PassThrough stream error:', err);
    });

    const headers = new Headers();
    headers.set('Content-Disposition', `attachment; filename="${encodeURIComponent(safeFilename)}"`);
    // Use the MIME type from the selected format, or default to octet-stream
    headers.set('Content-Type', format.mimeType || 'application/octet-stream');
    // If the format has a known content length, set it. This helps the browser.
    if (format.contentLength) {
      headers.set('Content-Length', format.contentLength);
    }
    
    // For Server Actions, returning a Response object is the way to stream data/files.
    // The PassThrough stream is a ReadableStream.
    return new Response(passThrough as unknown as ReadableStream, {
      headers: headers,
    });

  } catch (error) {
    console.error('Error in downloadAudioAction:', error);
    let errorMessage = error instanceof Error ? error.message : 'An unknown error occurred during audio download preparation.';
    
    if (error instanceof Error) {
        if (error.message.includes('Could not extract functions') || error.message.includes('Error parsing info')) {
            errorMessage = 'Failed to process this video. This can happen if YouTube has updated its video player, the video has specific restrictions (e.g., age-restricted, private), or it is a live stream. Please try a different video or try again later. Original error: ' + error.message;
        } else if (error.message.includes('No suitable format found')) {
             errorMessage = 'No suitable audio format could be found for this video. It might be a live stream, a members-only video, or have other restrictions.';
        }
    }

    // Return a JSON error object for client-side handling
    return { error: errorMessage };
  }
}


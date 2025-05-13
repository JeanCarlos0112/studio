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
      return { error: 'Invalid YouTube URL provided.' };
    }

    const videoInfo = await ytdl.getInfo(youtubeUrl);
    const videoTitle = customTitle || videoInfo.videoDetails.title;
    const safeFilename = sanitizeFilename(videoTitle) + '.mp3'; // Suggest .mp3 extension

    const format = ytdl.chooseFormat(videoInfo.formats, {
      quality: 'highestaudio',
      filter: 'audioonly',
    });

    if (!format) {
      return { error: 'No suitable audio-only format found for this video.' };
    }
    
    const audioStream = ytdl(youtubeUrl, { format: format });
    const passThrough = new PassThrough();
    audioStream.pipe(passThrough);

    audioStream.on('error', (err) => {
      console.error('Error during ytdl streaming:', err);
      passThrough.destroy(err); // Destroy the passThrough stream on error
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
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred during audio download preparation.';
    // Return a JSON error object for client-side handling
    return { error: errorMessage };
  }
}

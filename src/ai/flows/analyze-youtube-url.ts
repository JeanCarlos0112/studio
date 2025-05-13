// This is an AI-powered function to analyze a YouTube URL and determine its content type.
// It identifies whether the URL points to a single video, a playlist, or mixed content.
// It also attempts to fetch the title and thumbnail for videos and playlists, and video items for playlists.
// - analyzeYoutubeUrl - Analyzes the given YouTube URL and returns its content type, title, thumbnail, and video items for playlists.
// - AnalyzeYoutubeUrlInput - The input type for the analyzeYoutubeUrl function.
// - AnalyzeYoutubeUrlOutput - The return type for the analyzeYoutubeUrl function.

'use server';

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import ytdl from 'ytdl-core';
import ytpl from 'ytpl';

const AnalyzeYoutubeUrlInputSchema = z.object({
  url: z.string().describe('The YouTube URL to analyze.'),
});
export type AnalyzeYoutubeUrlInput = z.infer<typeof AnalyzeYoutubeUrlInputSchema>;

const VideoItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().url(),
  thumbnailUrl: z.string().url().optional(),
  duration: z.string().optional(),
});
export type VideoItem = z.infer<typeof VideoItemSchema>;

const AnalyzeYoutubeUrlOutputSchema = z.object({
  type: z
    .enum(['single', 'playlist', 'mixed', 'unknown'])
    .describe(
      'The type of content the URL points to: single video, playlist, mixed content, or unknown.'
    ),
  title: z.string().optional().describe('Title of the video or playlist, if applicable.'),
  thumbnailUrl: z.string().url().optional().describe('URL of the thumbnail, if applicable.'),
  videoItems: z.array(VideoItemSchema).optional().describe('List of video items if the URL is a playlist.'),
  playlistAuthor: z.string().optional().describe('Author of the playlist, if applicable.'),
});
export type AnalyzeYoutubeUrlOutput = z.infer<typeof AnalyzeYoutubeUrlOutputSchema>;

export async function analyzeYoutubeUrl(input: AnalyzeYoutubeUrlInput): Promise<AnalyzeYoutubeUrlOutput> {
  return analyzeYoutubeUrlFlow(input);
}

const analyzeYoutubeUrlPrompt = ai.definePrompt({
  name: 'analyzeYoutubeUrlPrompt',
  input: {schema: AnalyzeYoutubeUrlInputSchema},
  output: {schema: AnalyzeYoutubeUrlOutputSchema.pick({ type: true })}, // LLM only determines type
  prompt: `You are an expert in identifying YouTube content types.
  Analyze the given URL and determine if it points to a single video, a playlist, or a mix of content.
  Return the content type in JSON format. Only determine the type, not other metadata.

  URL: {{{url}}}
  `, config: {
    safetySettings: [
      {
        category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
        threshold: 'BLOCK_ONLY_HIGH',
      },
    ],
  }
});

const analyzeYoutubeUrlFlow = ai.defineFlow(
  {
    name: 'analyzeYoutubeUrlFlow',
    inputSchema: AnalyzeYoutubeUrlInputSchema,
    outputSchema: AnalyzeYoutubeUrlOutputSchema,
  },
  async (input: AnalyzeYoutubeUrlInput): Promise<AnalyzeYoutubeUrlOutput> => {
    const llmResponse = await analyzeYoutubeUrlPrompt(input);
    let typeFromLlm = llmResponse.output?.type || 'unknown';

    let outputData: AnalyzeYoutubeUrlOutput = { type: typeFromLlm };

    try {
      if (typeFromLlm === 'single') {
        if (ytdl.validateURL(input.url)) {
          const info = await ytdl.getInfo(input.url);
          outputData.title = info.videoDetails.title;
          outputData.thumbnailUrl = info.videoDetails.thumbnails?.sort((a, b) => b.width - a.width)[0]?.url;
        } else {
          // LLM might be wrong, or URL is malformed for ytdl but LLM saw 'watch?v='
          console.warn(`LLM suggested single video, but ytdl.validateURL failed for ${input.url}. Attempting ytpl.`);
          try {
            const playlistId = await ytpl.getPlaylistID(input.url);
             if (ytpl.validateID(playlistId)) {
                const playlistInfo = await ytpl(playlistId, { limit: Infinity });
                outputData.title = playlistInfo.title;
                outputData.thumbnailUrl = playlistInfo.thumbnails?.[0]?.url;
                outputData.playlistAuthor = playlistInfo.author?.name;
                outputData.videoItems = playlistInfo.items.map(item => ({
                  id: item.id,
                  title: item.title,
                  url: item.shortUrl,
                  thumbnailUrl: item.thumbnails?.[0]?.url,
                  duration: item.duration || undefined,
                }));
                outputData.type = 'playlist'; // Corrected type
             } else {
                outputData.type = 'unknown';
             }
          } catch (e) {
             console.warn(`Fallback to ytpl also failed for ${input.url}: ${(e as Error).message}`);
             outputData.type = 'unknown';
          }
        }
      } else if (typeFromLlm === 'playlist') {
        try {
          const playlistId = await ytpl.getPlaylistID(input.url); // Throws if not valid playlist URL format
           if (!ytpl.validateID(playlistId)) { // Validate the extracted ID
                throw new Error('Invalid playlist ID format.');
            }
          const playlistInfo = await ytpl(playlistId, { limit: Infinity });
          outputData.title = playlistInfo.title;
          outputData.thumbnailUrl = playlistInfo.thumbnails?.[0]?.url;
          outputData.playlistAuthor = playlistInfo.author?.name;
          outputData.videoItems = playlistInfo.items.map(item => ({
            id: item.id,
            title: item.title,
            url: item.shortUrl,
            thumbnailUrl: item.thumbnails?.[0]?.url,
            duration: item.duration || undefined,
          }));
        } catch (playlistError) {
          console.warn(`Error processing playlist URL ${input.url} with ytpl: ${(playlistError as Error).message}. Attempting ytdl.`);
          // Fallback: LLM might be wrong, and it's a single video URL with 'list' param.
          if (ytdl.validateURL(input.url)) {
            try {
                const info = await ytdl.getInfo(input.url);
                outputData.title = info.videoDetails.title;
                outputData.thumbnailUrl = info.videoDetails.thumbnails?.sort((a, b) => b.width - a.width)[0]?.url;
                outputData.type = 'single'; // Corrected type
                outputData.videoItems = undefined; // Clear playlist specific fields
                outputData.playlistAuthor = undefined;
            } catch (ytdlError) {
                console.warn(`Fallback to ytdl also failed for ${input.url}: ${(ytdlError as Error).message}`);
                outputData.type = 'unknown';
            }
          } else {
            outputData.type = 'unknown';
          }
        }
      }
      // For 'mixed' or 'unknown' types from LLM, we typically don't fetch further metadata here.
      // If typeFromLlm was 'unknown' initially, it remains 'unknown' unless specific parsing succeeds.
    } catch (e) {
      console.error(`Error during YouTube URL analysis for ${input.url}: ${(e as Error).message}`);
      // If a catastrophic error occurs outside specific parsing blocks
      outputData.type = 'unknown';
      outputData.title = undefined;
      outputData.thumbnailUrl = undefined;
      outputData.videoItems = undefined;
      outputData.playlistAuthor = undefined;
    }
    
    // Final check: if type is playlist, ensure videoItems exists.
    if (outputData.type === 'playlist' && !outputData.videoItems) {
        console.warn(`URL ${input.url} typed as playlist but no videoItems found. Marking as unknown.`);
        outputData.type = 'unknown';
    }
    // Final check: if type is single, ensure no videoItems.
    if (outputData.type === 'single' && outputData.videoItems) {
        outputData.videoItems = undefined;
        outputData.playlistAuthor = undefined;
    }


    return outputData;
  }
);

```
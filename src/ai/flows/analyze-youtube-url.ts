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
        if (ytpl.validateID(input.url) || input.url.includes('list=')) { // Prioritize playlist check if it looks like one
            try {
                const playlistId = await ytpl.getPlaylistID(input.url);
                if (!ytpl.validateID(playlistId)) {
                     // If getPlaylistID returns something that isn't a valid ID (e.g. from a malformed URL)
                     // or if the original URL was not a valid playlist ID itself.
                    if (ytdl.validateURL(input.url)) { // Try as single video
                        const info = await ytdl.getInfo(input.url);
                        outputData.title = info.videoDetails.title;
                        outputData.thumbnailUrl = info.videoDetails.thumbnails?.sort((a, b) => b.width - a.width)[0]?.url;
                        outputData.type = 'single';
                    } else {
                        outputData.type = 'unknown';
                    }
                } else {
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
                    outputData.type = 'playlist';
                }
            } catch (playlistError) {
                // If ytpl fails, it might still be a single video URL
                if (ytdl.validateURL(input.url)) {
                    try {
                        const info = await ytdl.getInfo(input.url);
                        outputData.title = info.videoDetails.title;
                        outputData.thumbnailUrl = info.videoDetails.thumbnails?.sort((a, b) => b.width - a.width)[0]?.url;
                        outputData.type = 'single';
                    } catch (ytdlError) {
                        console.warn(`Both ytpl and ytdl failed for ${input.url}: ${(ytdlError as Error).message}`);
                        outputData.type = 'unknown';
                    }
                } else {
                    outputData.type = 'unknown';
                }
            }
        } else if (ytdl.validateURL(input.url)) { // Check if it's a single video
            const info = await ytdl.getInfo(input.url);
            outputData.title = info.videoDetails.title;
            outputData.thumbnailUrl = info.videoDetails.thumbnails?.sort((a, b) => b.width - a.width)[0]?.url;
            outputData.type = 'single';
        } else { // If neither, use LLM's initial guess or mark unknown
            outputData.type = typeFromLlm !== 'single' && typeFromLlm !== 'playlist' ? typeFromLlm : 'unknown';
        }
    } catch (e) {
      console.error(`Error during YouTube URL analysis for ${input.url}: ${(e as Error).message}`);
      outputData.type = 'unknown';
      outputData.title = undefined;
      outputData.thumbnailUrl = undefined;
      outputData.videoItems = undefined;
      outputData.playlistAuthor = undefined;
    }
    
    // Final validation based on parsing results
    if (outputData.type === 'playlist' && (!outputData.videoItems || outputData.videoItems.length === 0)) {
        // If it was identified as a playlist but has no items, it might be an error or an empty playlist.
        // Consider if an empty playlist should be 'playlist' or 'unknown'. For now, keep 'playlist'.
        // If title is missing for a playlist, it's more likely an error
        if (!outputData.title) outputData.type = 'unknown';
    }
    if (outputData.type === 'single' && !outputData.title) {
        outputData.type = 'unknown'; // Single video must have a title
    }
    if (outputData.type === 'unknown' && (outputData.title || (outputData.videoItems && outputData.videoItems.length > 0))) {
        // If it's unknown but we have data, something is inconsistent. This case should ideally not be reached.
        console.warn(`URL ${input.url} typed as unknown but metadata was found. Re-evaluating.`);
        if (outputData.videoItems && outputData.videoItems.length > 0) outputData.type = 'playlist';
        else if (outputData.title) outputData.type = 'single';
    }

    return outputData;
  }
);

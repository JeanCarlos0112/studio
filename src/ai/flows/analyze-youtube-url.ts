// This is an AI-powered function to analyze a YouTube URL and determine its content type.
// It identifies whether the URL points to a single video, a playlist, or mixed content.
// It also attempts to fetch the title and thumbnail for videos and playlists, and video items for playlists.
// - analyzeYoutubeUrl - Analyzes the given YouTube URL and returns its content type, title, thumbnail, video items for playlists, and live status.
// - AnalyzeYoutubeUrlInput - The input type for the analyzeYoutubeUrl function.
// - AnalyzeYoutubeUrlOutput - The return type for the analyzeYoutubeUrl function.

'use server';

import {ai} from '@/ai/genkit';
import {z} from 'zod';
import ytdl from '@distube/ytdl-core';
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
  isLive: z.boolean().optional().describe('Whether the content is a live stream (for single videos).'),
});
export type AnalyzeYoutubeUrlOutput = z.infer<typeof AnalyzeYoutubeUrlOutputSchema>;

export async function analyzeYoutubeUrl(input: AnalyzeYoutubeUrlInput): Promise<AnalyzeYoutubeUrlOutput> {
  return analyzeYoutubeUrlFlow(input);
}

const ytdlRequestOptions = {
  requestOptions: {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    },
  },
};

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
        if (ytpl.validateID(input.url) || input.url.includes('list=')) {
            try {
                const playlistId = await ytpl.getPlaylistID(input.url);
                if (!ytpl.validateID(playlistId)) {
                    if (ytdl.validateURL(input.url)) {
                        const info = await ytdl.getInfo(input.url, { lang: 'en', ...ytdlRequestOptions });
                        outputData.title = info.videoDetails.title;
                        outputData.thumbnailUrl = info.videoDetails.thumbnails?.sort((a, b) => b.width - a.width)[0]?.url;
                        outputData.type = 'single';
                        outputData.isLive = info.videoDetails.isLiveContent;
                    } else {
                        outputData.type = 'unknown';
                    }
                } else {
                    const playlistInfo = await ytpl(playlistId, { limit: Infinity });
                    outputData.title = playlistInfo.title;
                    outputData.thumbnailUrl = playlistInfo.thumbnails?.[0]?.url ?? undefined;
                    outputData.playlistAuthor = playlistInfo.author?.name;
                    outputData.videoItems = playlistInfo.items.map(item => ({
                        id: item.id,
                        title: item.title,
                        url: item.shortUrl,
                        thumbnailUrl: item.thumbnails?.[0]?.url ?? undefined,
                        duration: item.duration || undefined,
                    }));
                    outputData.type = 'playlist';
                    outputData.isLive = false;
                }
            } catch (playlistError) {
                if (ytdl.validateURL(input.url)) {
                    try {
                        const info = await ytdl.getInfo(input.url, { lang: 'en', ...ytdlRequestOptions });
                        outputData.title = info.videoDetails.title;
                        outputData.thumbnailUrl = info.videoDetails.thumbnails?.sort((a, b) => b.width - a.width)[0]?.url;
                        outputData.type = 'single';
                        outputData.isLive = info.videoDetails.isLiveContent;
                    } catch (ytdlError) {
                        console.warn(`[analyzeYoutubeUrlFlow] Both ytpl and ytdl failed for ${input.url} (after playlist attempt). PlaylistError: ${(playlistError as Error).message}. YTDLError: ${(ytdlError as Error).message}`);
                        outputData.type = 'unknown';
                    }
                } else {
                     console.warn(`[analyzeYoutubeUrlFlow] ytpl failed for ${input.url} and it's not a valid ytdl URL. PlaylistError: ${(playlistError as Error).message}`);
                    outputData.type = 'unknown';
                }
            }
        } else if (ytdl.validateURL(input.url)) {
            const info = await ytdl.getInfo(input.url, { lang: 'en', ...ytdlRequestOptions });
            outputData.title = info.videoDetails.title;
            outputData.thumbnailUrl = info.videoDetails.thumbnails?.sort((a, b) => b.width - a.width)[0]?.url;
            outputData.type = 'single';
            outputData.isLive = info.videoDetails.isLiveContent;
        } else {
            outputData.type = typeFromLlm !== 'single' && typeFromLlm !== 'playlist' ? typeFromLlm : 'unknown';
        }
    } catch (e) {
      console.error(`[analyzeYoutubeUrlFlow] Error during YouTube URL analysis for ${input.url}: ${(e as Error).message}. Stack: ${(e as Error).stack}`);
      outputData.type = (typeFromLlm === 'mixed' || typeFromLlm === 'unknown') && !outputData.title && !outputData.videoItems?.length ? typeFromLlm : 'unknown';
      outputData.title = undefined;
      outputData.thumbnailUrl = undefined;
      outputData.videoItems = undefined;
      outputData.playlistAuthor = undefined;
      outputData.isLive = undefined;
    }

    if (outputData.type === 'playlist' && (!outputData.videoItems || outputData.videoItems.length === 0) && outputData.title) {
        // Empty playlist with a title is valid.
    } else if (outputData.type === 'playlist' && (!outputData.title || !outputData.videoItems || outputData.videoItems.length === 0)){
        outputData.type = 'unknown';
    }

    if (outputData.type === 'single' && !outputData.title) {
        outputData.type = 'unknown';
    }

    if (outputData.type === 'unknown' && (outputData.title || (outputData.videoItems && outputData.videoItems.length > 0))) {
      if(outputData.videoItems && outputData.videoItems.length > 0) {
        outputData.type = 'playlist';
      } else if (outputData.title) {
        outputData.type = 'single';
      }
    }

    return outputData;
  }
);

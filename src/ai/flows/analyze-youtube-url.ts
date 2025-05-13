// This is an AI-powered function to analyze a YouTube URL and determine its content type.
// It identifies whether the URL points to a single video, a playlist, or mixed content.
// It also attempts to fetch the title and thumbnail for videos and playlists.
// - analyzeYoutubeUrl - Analyzes the given YouTube URL and returns its content type, title, and thumbnail.
// - AnalyzeYoutubeUrlInput - The input type for the analyzeYoutubeUrl function.
// - AnalyzeYoutubeUrlOutput - The return type for the analyzeYoutubeUrl function.

'use server';

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import ytdl from 'ytdl-core';

const AnalyzeYoutubeUrlInputSchema = z.object({
  url: z.string().describe('The YouTube URL to analyze.'),
});
export type AnalyzeYoutubeUrlInput = z.infer<typeof AnalyzeYoutubeUrlInputSchema>;

const AnalyzeYoutubeUrlOutputSchema = z.object({
  type: z
    .enum(['single', 'playlist', 'mixed'])
    .describe(
      'The type of content the URL points to: single video, playlist, or mixed content.'
    ),
  title: z.string().optional().describe('Title of the video or playlist, if applicable.'),
  thumbnailUrl: z.string().url().optional().describe('URL of the thumbnail, if applicable.'),
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
    let outputData: AnalyzeYoutubeUrlOutput = { type: llmResponse.output!.type };

    if (outputData.type === 'single' || outputData.type === 'playlist') {
      try {
        if (ytdl.validateURL(input.url)) {
          const info = await ytdl.getInfo(input.url);
          outputData.title = info.videoDetails.title;
          // Get the highest resolution thumbnail
          outputData.thumbnailUrl = info.videoDetails.thumbnails?.sort((a, b) => b.width - a.width)[0]?.url;
        }
      } catch (e) {
        console.warn(`Could not fetch extended YouTube info for ${input.url}: ${(e as Error).message}`);
        // Proceed with just the type if ytdl-core fails for metadata
      }
    }
    return outputData;
  }
);

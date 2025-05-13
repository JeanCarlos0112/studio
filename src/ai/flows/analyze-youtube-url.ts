// This is an AI-powered function to analyze a YouTube URL and determine its content type.
// It identifies whether the URL points to a single video, a playlist, or mixed content.
// - analyzeYoutubeUrl - Analyzes the given YouTube URL and returns its content type.
// - AnalyzeYoutubeUrlInput - The input type for the analyzeYoutubeUrl function.
// - AnalyzeYoutubeUrlOutput - The return type for the analyzeYoutubeUrl function.

'use server';

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

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
});
export type AnalyzeYoutubeUrlOutput = z.infer<typeof AnalyzeYoutubeUrlOutputSchema>;

export async function analyzeYoutubeUrl(input: AnalyzeYoutubeUrlInput): Promise<AnalyzeYoutubeUrlOutput> {
  return analyzeYoutubeUrlFlow(input);
}

const analyzeYoutubeUrlPrompt = ai.definePrompt({
  name: 'analyzeYoutubeUrlPrompt',
  input: {schema: AnalyzeYoutubeUrlInputSchema},
  output: {schema: AnalyzeYoutubeUrlOutputSchema},
  prompt: `You are an expert in identifying YouTube content types.
  Analyze the given URL and determine if it points to a single video, a playlist, or a mix of content.
  Return the content type in JSON format.

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
  async input => {
    const {output} = await analyzeYoutubeUrlPrompt(input);
    return output!;
  }
);

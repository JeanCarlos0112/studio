'use server';

import { analyzeYoutubeUrl, type AnalyzeYoutubeUrlInput, type AnalyzeYoutubeUrlOutput } from '@/ai/flows/analyze-youtube-url';

// AnalyzeYoutubeUrlOutput now includes optional title and thumbnailUrl
export interface AnalysisResult extends AnalyzeYoutubeUrlOutput {
  // Potentially add more fields if needed in the future
}

export interface AnalysisError {
  error: string;
}

export async function analyzeUrlAction(input: AnalyzeYoutubeUrlInput): Promise<AnalysisResult | AnalysisError> {
  try {
    const result = await analyzeYoutubeUrl(input);
    return result; // result already matches AnalysisResult structure
  } catch (e) {
    console.error("Error analyzing URL:", e);
    const errorMessage = e instanceof Error ? e.message : "An unknown error occurred during URL analysis.";
    return { error: errorMessage };
  }
}

'use server';

import { analyzeYoutubeUrl, type AnalyzeYoutubeUrlInput, type AnalyzeYoutubeUrlOutput } from '@/ai/flows/analyze-youtube-url';

export interface AnalysisResult extends AnalyzeYoutubeUrlOutput {
  // Potentially add more fields if needed in the future
}

export interface AnalysisError {
  error: string;
}

export async function analyzeUrlAction(input: AnalyzeYoutubeUrlInput): Promise<AnalysisResult | AnalysisError> {
  try {
    const result = await analyzeYoutubeUrl(input);
    return result;
  } catch (e) {
    console.error("Error analyzing URL:", e);
    // Ensure a serializable error object is returned
    const errorMessage = e instanceof Error ? e.message : "An unknown error occurred during URL analysis.";
    return { error: errorMessage };
  }
}

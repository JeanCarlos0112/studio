'use server';

import { analyzeYoutubeUrl, type AnalyzeYoutubeUrlInput, type AnalyzeYoutubeUrlOutput } from '@/ai/flows/analyze-youtube-url';

// AnalysisResult now directly uses AnalyzeYoutubeUrlOutput which includes videoItems, title, thumbnailUrl, etc.
export interface AnalysisResult extends AnalyzeYoutubeUrlOutput {
  // No additional fields needed here as AnalyzeYoutubeUrlOutput is comprehensive.
}

export interface AnalysisError {
  error: string;
}

export async function analyzeUrlAction(input: AnalyzeYoutubeUrlInput): Promise<AnalysisResult | AnalysisError> {
  try {
    const result = await analyzeYoutubeUrl(input);
    // If the result type is unknown and no specific error was thrown by the flow,
    // craft a generic error message.
    if (result.type === 'unknown' && !result.title && !result.videoItems) {
        return { error: "Could not determine content type or extract information from the URL." };
    }
    return result; // result structure matches AnalysisResult
  } catch (e) {
    console.error("Error analyzing URL:", e);
    const errorMessage = e instanceof Error ? e.message : "An unknown error occurred during URL analysis.";
    return { error: errorMessage };
  }
}

'use client';

import React, { useState } from 'react';
import { AppHeader } from '@/components/layout/AppHeader';
import { UrlInputForm } from '@/components/youtube/UrlInputForm';
import { DownloadArea } from '@/components/youtube/DownloadArea';
import type { AnalysisResult, AnalysisError } from '@/app/actions';
import { Loader2 } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";


export default function Home() {
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const { toast } = useToast();

  const handleAnalysisStart = () => {
    setIsAnalyzing(true);
    setAnalysisResult(null); // Clear previous results
  };

  const handleAnalysisComplete = (result: AnalysisResult | AnalysisError) => {
    setIsAnalyzing(false);
    if ('error' in result) {
      toast({
        title: "Analysis Failed",
        description: result.error || "Could not analyze the URL.",
        variant: "destructive",
      });
      setAnalysisResult(null);
    } else {
      toast({
        title: "Analysis Complete",
        description: `URL identified as: ${result.type}`,
        variant: "default",
      });
      setAnalysisResult(result);
      // Assuming the URL for DownloadArea should be the one analyzed
      // This needs to be passed from UrlInputForm or managed here
      // For now, let's assume UrlInputForm somehow provides the URL if needed by DownloadArea
      // Or, we capture the URL when analysis starts.
      // The URL that was analyzed needs to be stored if DownloadArea requires it.
      // We'll pass the URL that was current when analysis was triggered.
      // This logic might need refinement depending on how `UrlInputForm` exposes the submitted URL.
      // For simplicity, if analyzeUrlAction passes the url, we can use that, otherwise manage state.
      // `currentUrl` needs to be set when form is submitted or analysis starts.
      // For now, it's implied that analysisResult could contain necessary info, or DownloadArea uses its own logic.
    }
  };
  
  // This function would be called by UrlInputForm, or UrlInputForm's submit action
  // would set this URL state.
  // For now, this is a simplified approach where we rely on analysisResult.
  // A better way would be for UrlInputForm to pass the submitted URL along with triggering analysis.
  // Let's assume `analyzeUrlAction` could return the original URL if needed, or we manage it.
  // For now, this is okay as `DownloadArea` gets `youtubeUrl` prop which we'll assume is the analyzed URL.
  // `setCurrentUrl` would typically be called within `UrlInputForm` on submit.
  // Let's simplify for now and manage `currentUrl` as part of the `page.tsx`'s state,
  // assuming `UrlInputForm` calls `analyzeUrlAction` which implicitly uses the URL.
  // The `youtubeUrl` prop for `DownloadArea` will be a challenge if not managed carefully.
  // Let's adjust `UrlInputForm` to pass the URL or `page.tsx` to set it.
  // A simpler way: `UrlInputForm` takes `url` and `setUrl` as props.

  // Revisiting: UrlInputForm has its own internal URL state. When analysis completes successfully,
  // we'll use the URL that was submitted. We can capture this URL in `page.tsx` as well.
  // Let's pass the URL from form's state when `onAnalysisComplete` is called.
  // Or, better, `UrlInputForm` triggers `analyzeUrlAction` with its internal `url` state.
  // `page.tsx` needs the URL to pass to `DownloadArea`.

  // Simplest: `UrlInputForm` calls the action. `page.tsx` receives the result.
  // If analysis is successful, we need the URL that was analyzed.
  // The `analyzeUrlAction` does not return the input URL.
  // So, `UrlInputForm` must provide it, or we store it in `page.tsx` when `handleSubmit` in `UrlInputForm` is called.

  const handleFormSubmitInitiated = (url: string) => {
    setCurrentUrl(url); // Capture the URL being analyzed
    handleAnalysisStart();
  };
  
  // UrlInputForm needs to call handleFormSubmitInitiated with the URL,
  // then proceed with its internal logic.
  // This is getting complex. Let `UrlInputForm` manage its URL and `analyzeUrlAction` call.
  // `page.tsx` just needs the result and the URL used for that result.
  // Let's have `onAnalysisComplete` in `UrlInputForm` also pass the URL.

  const handleActualAnalysisComplete = (url: string, result: AnalysisResult | AnalysisError) => {
    setCurrentUrl(url); // Set the URL that was successfully analyzed or attempted
    handleAnalysisComplete(result);
  };


  return (
    <div className="min-h-screen flex flex-col items-center p-4 sm:p-6 md:p-8">
      <AppHeader />
      <div className="w-full space-y-8">
        <UrlInputForm
          onAnalysisStart={() => {
            // This will be called internally by UrlInputForm.
            // We need the URL when analysis starts or completes.
            // Let's adjust `onAnalysisComplete` in `UrlInputForm` to include the URL.
            setIsAnalyzing(true);
            setAnalysisResult(null);
          }}
          onAnalysisComplete={(result, submittedUrl) => {
            // Assuming UrlInputForm is modified to pass submittedUrl
            setIsAnalyzing(false);
            if (submittedUrl) setCurrentUrl(submittedUrl);

            if ('error' in result) {
              toast({
                title: "Analysis Failed",
                description: result.error || "Could not analyze the URL.",
                variant: "destructive",
              });
              setAnalysisResult(null);
            } else {
              toast({
                title: "Analysis Complete",
                description: `URL identified as: ${result.type}`,
                variant: "default",
              });
              setAnalysisResult(result);
            }
          }}
        />
        
        {isAnalyzing && (
          <div className="flex flex-col items-center justify-center text-muted-foreground mt-8 p-6 rounded-lg shadow-md bg-card">
            <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
            <p className="text-xl font-medium">Analyzing URL...</p>
            <p className="text-sm">Please wait while we determine the content type.</p>
          </div>
        )}

        {!isAnalyzing && analysisResult && currentUrl && (
          <DownloadArea analysisResult={analysisResult} youtubeUrl={currentUrl} />
        )}
      </div>
      <footer className="mt-12 text-center text-sm text-muted-foreground">
        <p>&copy; {new Date().getFullYear()} YouTube Audio Extractor. All rights reserved (concept app).</p>
        <p>This is a conceptual application for demonstration purposes.</p>
      </footer>
    </div>
  );
}

// Modify UrlInputForm props to pass URL back
// In UrlInputForm.tsx:
// interface UrlInputFormProps {
//   onAnalysisStart: () => void;
//   onAnalysisComplete: (result: AnalysisResult | AnalysisError, submittedUrl: string) => void;
// }
// ...
// In handleSubmit:
// onAnalysisComplete(result, url); // pass the url state
//
// Let's make this change to UrlInputForm.tsx

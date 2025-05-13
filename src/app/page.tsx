'use client';

import React, { useState } from 'react';
import { AppHeader } from '@/components/layout/AppHeader';
import { UrlInputForm } from '@/components/youtube/UrlInputForm';
import { DownloadArea } from '@/components/youtube/DownloadArea';
import type { AnalysisResult, AnalysisError } from '@/app/actions';
import { Loader2 } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";


export default function Home() {
  // AnalysisResult now can contain title and thumbnailUrl
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const { toast } = useToast();

  const handleAnalysisStart = () => {
    setIsAnalyzing(true);
    setAnalysisResult(null); 
  };

  const handleAnalysisComplete = (url: string, result: AnalysisResult | AnalysisError) => {
    setIsAnalyzing(false);
    setCurrentUrl(url); // Store the URL that was analyzed

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
        description: `URL identified as: ${result.type}${result.title ? ` (${result.title})` : ''}`,
        variant: "default",
      });
      setAnalysisResult(result); // result now includes title and thumbnail if available
    }
  };
  

  return (
    <div className="min-h-screen flex flex-col items-center p-4 sm:p-6 md:p-8">
      <AppHeader />
      <div className="w-full space-y-8">
        <UrlInputForm
          onAnalysisStart={handleAnalysisStart}
          onAnalysisComplete={(result, submittedUrl) => {
            // UrlInputForm passes back the result and the URL it analyzed.
            handleAnalysisComplete(submittedUrl, result);
          }}
        />
        
        {isAnalyzing && (
          <div className="flex flex-col items-center justify-center text-muted-foreground mt-8 p-6 rounded-lg shadow-md bg-card">
            <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
            <p className="text-xl font-medium">Analyzing URL...</p>
            <p className="text-sm">Please wait while we determine the content type and details.</p>
          </div>
        )}

        {!isAnalyzing && analysisResult && currentUrl && (
          // Pass the full analysisResult and the currentUrl to DownloadArea
          <DownloadArea analysisResult={analysisResult} youtubeUrl={currentUrl} />
        )}
      </div>
      <footer className="mt-12 text-center text-sm text-muted-foreground">
        <p>&copy; {new Date().getFullYear()} YouTube Audio Extractor. All rights reserved (concept app).</p>
        <p>This is a conceptual application for demonstration purposes. Audio is downloaded in best available format (e.g. M4A) and named .mp3.</p>
      </footer>
    </div>
  );
}

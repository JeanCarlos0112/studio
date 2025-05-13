'use client';

import type { ChangeEvent, FormEvent } from 'react';
import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { LinkIcon, Loader2 } from 'lucide-react';
import type { AnalysisResult, AnalysisError } from '@/app/actions';

interface UrlInputFormProps {
  onAnalysisStart: () => void;
  onAnalysisComplete: (result: AnalysisResult | AnalysisError, submittedUrl: string) => void;
}

export function UrlInputForm({ onAnalysisStart, onAnalysisComplete }: UrlInputFormProps) {
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      setError('Please enter a YouTube URL.');
      return;
    }
    setError(null);
    setIsLoading(true);
    onAnalysisStart();

    // Dynamically import server action
    const { analyzeUrlAction } = await import('@/app/actions');
    const result = await analyzeUrlAction({ url: trimmedUrl });
    
    setIsLoading(false);
    onAnalysisComplete(result, trimmedUrl); // Pass the submitted URL back
    if ('error' in result && result.error) {
      setError(result.error);
    }
  };

  const handleUrlChange = (event: ChangeEvent<HTMLInputElement>) => {
    setUrl(event.target.value);
    if (error) setError(null); // Clear error when user types
  };

  return (
    <Card className="w-full max-w-2xl mx-auto shadow-lg">
      <CardHeader>
        <CardTitle className="text-2xl font-semibold">Analyze YouTube URL</CardTitle>
        <CardDescription>Enter a YouTube URL to determine its content type and prepare for audio extraction.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="youtube-url" className="text-base font-medium">YouTube URL</Label>
            <div className="flex items-center space-x-2">
              <LinkIcon className="h-5 w-5 text-muted-foreground" />
              <Input
                id="youtube-url"
                type="url"
                placeholder="https://www.youtube.com/watch?v=..."
                value={url}
                onChange={handleUrlChange}
                disabled={isLoading}
                className="text-base"
                aria-describedby="url-error"
              />
            </div>
          </div>
          {error && <p id="url-error" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full bg-accent hover:bg-accent/90 text-accent-foreground text-lg py-3" disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Analyzing...
              </>
            ) : (
              'Analyze URL'
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

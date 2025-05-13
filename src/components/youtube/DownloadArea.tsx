'use client';

import React, { useState, useEffect } from 'react';
import type { AnalysisResult } from '@/app/actions';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { FileVideo, ListVideo, AlertCircle, CheckCircle2, XCircle, Download, FolderOpen, Loader2 } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import Image from 'next/image';

interface DownloadAreaProps {
  analysisResult: AnalysisResult | null;
  youtubeUrl: string;
}

type DownloadStatus = 'idle' | 'preparing' | 'downloading' | 'completed' | 'error' | 'cancelled';

export function DownloadArea({ analysisResult, youtubeUrl }: DownloadAreaProps) {
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [downloadDirectory, setDownloadDirectory] = useState('~/Downloads/YouTubeAudio');
  const [downloadInterval, setDownloadInterval] = useState<NodeJS.Timeout | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    // Reset state when analysisResult changes
    setDownloadStatus('idle');
    setProgress(0);
    if (downloadInterval) clearInterval(downloadInterval);
    return () => {
      if (downloadInterval) clearInterval(downloadInterval);
    };
  }, [analysisResult, youtubeUrl]);

  const handleSimulateDownload = () => {
    setDownloadStatus('downloading');
    setProgress(0);
    let currentProgress = 0;
    
    const intervalId = setInterval(() => {
      currentProgress += 10;
      if (currentProgress > 100) {
        clearInterval(intervalId);
        setDownloadStatus('completed');
        setProgress(100);
        toast({
          title: "Download Complete!",
          description: "Audio successfully extracted (simulated).",
          variant: "default",
          action: <CheckCircle2 className="text-green-500" />,
        });
      } else {
        setProgress(currentProgress);
      }
    }, 300);
    setDownloadInterval(intervalId);
  };

  const handleCancelDownload = () => {
    if (downloadInterval) clearInterval(downloadInterval);
    setDownloadStatus('cancelled');
    setProgress(0); // Reset progress
    toast({
      title: "Download Cancelled",
      description: "The download process was cancelled.",
      variant: "destructive",
    });
  };
  
  const handleChooseDirectory = () => {
    // This is a mock function as we can't actually access local file system this way.
    // In a real desktop app, this would open a directory picker.
    const newPath = prompt("Enter new download directory path:", downloadDirectory);
    if (newPath) {
      setDownloadDirectory(newPath);
      toast({
        title: "Directory Updated (Mock)",
        description: `Download path set to: ${newPath}`,
      });
    }
  };

  if (!analysisResult) {
    return null;
  }

  if (analysisResult.type === 'mixed') {
    return (
      <Alert variant="destructive" className="mt-8 max-w-2xl mx-auto shadow-md">
        <AlertCircle className="h-5 w-5" />
        <AlertTitle>Mixed Content Detected</AlertTitle>
        <AlertDescription>
          The provided URL appears to contain mixed content (e.g., a channel page or a mix of videos and playlists). 
          Audio extraction is only supported for single videos or playlists.
        </AlertDescription>
      </Alert>
    );
  }

  const isActionable = analysisResult.type === 'single' || analysisResult.type === 'playlist';
  const contentTitle = analysisResult.type === 'single' ? 'Single Video Detected' : 'Playlist Detected';
  const IconComponent = analysisResult.type === 'single' ? FileVideo : ListVideo;

  // Placeholder image data - replace with actual data if available
  const placeholderImage = `https://picsum.photos/seed/${encodeURIComponent(youtubeUrl)}/400/225`;
  const placeholderTitle = `Content from: ${new URL(youtubeUrl).hostname}`;
  const placeholderDescription = analysisResult.type === 'single' 
    ? "Details about this video will appear here." 
    : "Details about this playlist will appear here.";


  return (
    <Card className="mt-8 w-full max-w-2xl mx-auto shadow-lg">
      <CardHeader className="flex flex-row items-start space-x-4">
        <IconComponent className="h-8 w-8 text-primary mt-1" />
        <div>
          <CardTitle className="text-2xl font-semibold">{contentTitle}</CardTitle>
          <CardDescription>Ready to extract audio from the detected content.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="p-4 border rounded-lg bg-secondary/30">
            <Image 
              data-ai-hint="video player"
              src={placeholderImage} 
              alt="Video/Playlist Thumbnail Placeholder" 
              width={400} 
              height={225} 
              className="rounded-md mx-auto mb-4 object-cover aspect-video" 
            />
            <h3 className="text-lg font-medium text-foreground">{placeholderTitle}</h3>
            <p className="text-sm text-muted-foreground">{placeholderDescription}</p>
        </div>

        {isActionable && (
          <>
            <div className="space-y-2">
              <Label htmlFor="download-directory" className="text-base font-medium">Download Directory</Label>
              <div className="flex items-center space-x-2">
                <Input id="download-directory" value={downloadDirectory} readOnly className="flex-grow text-base" />
                <Button variant="outline" onClick={handleChooseDirectory} className="text-accent-foreground bg-accent/80 hover:bg-accent/90">
                  <FolderOpen className="mr-2 h-5 w-5" /> Choose
                </Button>
              </div>
            </div>

            {downloadStatus !== 'idle' && downloadStatus !== 'completed' && downloadStatus !== 'cancelled' && downloadStatus !== 'error' && (
              <div className="space-y-2">
                <Label className="text-base font-medium">Progress</Label>
                <Progress value={progress} className="w-full h-4" />
                <p className="text-sm text-muted-foreground text-center">
                  {downloadStatus === 'downloading' ? `${progress}% Complete` : downloadStatus.charAt(0).toUpperCase() + downloadStatus.slice(1)}
                </p>
              </div>
            )}
            
            {downloadStatus === 'completed' && (
                 <Alert variant="default" className="bg-green-100 dark:bg-green-900 border-green-500">
                    <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                    <AlertTitle className="text-green-700 dark:text-green-300">Download Successful!</AlertTitle>
                    <AlertDescription className="text-green-600 dark:text-green-400">
                        Audio extraction (simulated) is complete. Files are "saved" to {downloadDirectory}.
                    </AlertDescription>
                </Alert>
            )}

            {downloadStatus === 'error' && (
                 <Alert variant="destructive">
                    <XCircle className="h-5 w-5" />
                    <AlertTitle>Download Error</AlertTitle>
                    <AlertDescription>
                        An error occurred during the download (simulated). Please try again.
                    </AlertDescription>
                </Alert>
            )}
             {downloadStatus === 'cancelled' && (
                 <Alert variant="default" className="bg-yellow-100 dark:bg-yellow-900 border-yellow-500">
                    <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
                    <AlertTitle className="text-yellow-700 dark:text-yellow-300">Download Cancelled</AlertTitle>
                    <AlertDescription className="text-yellow-600 dark:text-yellow-400">
                        The download process was cancelled by the user.
                    </AlertDescription>
                </Alert>
            )}

          </>
        )}
      </CardContent>
      {isActionable && (
        <CardFooter className="flex flex-col sm:flex-row justify-end space-y-2 sm:space-y-0 sm:space-x-3 pt-6">
          { (downloadStatus === 'idle' || downloadStatus === 'completed' || downloadStatus === 'error' || downloadStatus === 'cancelled') && (
            <Button 
              onClick={handleSimulateDownload} 
              className="w-full sm:w-auto bg-accent hover:bg-accent/90 text-accent-foreground text-lg py-3"
              disabled={downloadStatus === 'downloading'}
            >
              <Download className="mr-2 h-5 w-5" />
              {analysisResult.type === 'single' ? 'Download Audio (MP3)' : 'Download All Audios (MP3)'}
            </Button>
          )}
          {downloadStatus === 'downloading' && (
            <Button 
              variant="destructive" 
              onClick={handleCancelDownload} 
              className="w-full sm:w-auto text-lg py-3"
            >
              <XCircle className="mr-2 h-5 w-5" />
              Cancel
            </Button>
          )}
        </CardFooter>
      )}
    </Card>
  );
}

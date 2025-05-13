'use client';

import React, { useState, useEffect } from 'react';
import type { AnalysisResult } from '@/app/actions'; // AnalysisResult now includes title/thumbnail
import { downloadAudioAction } from '@/app/download-audio.action';
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
  const [progress, setProgress] = useState(0); // Progress primarily for "preparing" stage
  const [downloadDirectory, setDownloadDirectory] = useState('~/Downloads/YouTubeAudio'); // Mock directory
  const { toast } = useToast();

  useEffect(() => {
    setDownloadStatus('idle');
    setProgress(0);
  }, [analysisResult, youtubeUrl]);

  const handleActualDownload = async () => {
    if (!analysisResult || !youtubeUrl) return;

    setDownloadStatus('preparing');
    setProgress(25); // Initial progress for preparation

    try {
      // Pass the title from analysisResult if available, otherwise downloadAudioAction will fetch it
      const response = await downloadAudioAction(youtubeUrl, analysisResult.title);
      setProgress(75); // Preparation nearly complete

      if (response instanceof Response) { // Successful stream response
        if (response.ok) {
          setDownloadStatus('downloading'); // Browser is now handling the download
          setProgress(100); // Preparation complete, download initiated
          
          const blob = await response.blob();
          const link = document.createElement('a');
          const objectUrl = window.URL.createObjectURL(blob);
          link.href = objectUrl;
          
          const contentDisposition = response.headers.get('Content-Disposition');
          let filename = analysisResult.title ? `${analysisResult.title}.mp3` : "youtube_audio.mp3";
          if (contentDisposition) {
            const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
            if (filenameMatch && filenameMatch.length > 1) {
              filename = decodeURIComponent(filenameMatch[1]);
            }
          }
          link.setAttribute('download', filename);
          document.body.appendChild(link);
          link.click();
          
          toast({
            title: "Download Started",
            description: `"${filename}" is downloading. Check your browser's downloads.`,
            variant: "default",
          });
          
          // Cleanup after a short delay to ensure download initiation
          setTimeout(() => {
            document.body.removeChild(link);
            window.URL.revokeObjectURL(objectUrl);
            // Note: 'completed' here means the action to start download is done.
            // Actual file download completion is handled by the browser.
            setDownloadStatus('completed'); 
          }, 100);

        } else {
          // Handle HTTP errors from the Response object (e.g., 500 from server action)
          const errorText = await response.text();
          throw new Error(errorText || `Server error: ${response.status}`);
        }
      } else if (response.error) { // JSON error object from server action
        throw new Error(response.error);
      } else {
        throw new Error('Unexpected response from server.');
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "An unknown error occurred.";
      console.error("Download error:", e);
      setDownloadStatus('error');
      setProgress(0);
      toast({
        title: "Download Failed",
        description: errorMessage,
        variant: "destructive",
        action: <XCircle className="text-red-500" />,
      });
    }
  };

  const handleCancelDownload = () => {
    // Actual cancellation of fetch/stream is complex. This is a UI reset.
    setDownloadStatus('cancelled');
    setProgress(0);
    toast({
      title: "Download Cancelled",
      description: "The download process was cancelled by the user.",
      variant: "destructive",
    });
  };
  
  const handleChooseDirectory = () => {
    const newPath = prompt("Enter new download directory path (simulation):", downloadDirectory);
    if (newPath) {
      setDownloadDirectory(newPath);
      toast({
        title: "Directory Updated (Mock)",
        description: `Download path set to: ${newPath} (Note: Downloads go to your browser's default location).`,
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
          The provided URL appears to contain mixed content. Audio extraction is only supported for single videos or playlists.
        </AlertDescription>
      </Alert>
    );
  }

  const isActionable = analysisResult.type === 'single' || analysisResult.type === 'playlist';
  const contentDisplayTitle = analysisResult.title || (analysisResult.type === 'single' ? 'Single Video Detected' : 'Playlist Detected');
  const IconComponent = analysisResult.type === 'single' ? FileVideo : ListVideo;

  const displayThumbnailUrl = analysisResult.thumbnailUrl || `https://picsum.photos/seed/${encodeURIComponent(youtubeUrl)}/400/225`;
  const displayTitle = analysisResult.title || `Content from URL`;
  const displayDescription = analysisResult.type === 'single' 
    ? "Ready to extract audio from this video." 
    : "Ready to extract audio from this playlist (first video shown as example).";

  return (
    <Card className="mt-8 w-full max-w-2xl mx-auto shadow-lg">
      <CardHeader className="flex flex-row items-start space-x-4">
        <IconComponent className="h-8 w-8 text-primary mt-1" />
        <div>
          <CardTitle className="text-2xl font-semibold">{contentDisplayTitle}</CardTitle>
          <CardDescription>Ready to extract audio. The file will be named .mp3 but contains the best available audio format (e.g., M4A).</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="p-4 border rounded-lg bg-secondary/30">
            <Image 
              data-ai-hint="video thumbnail"
              src={displayThumbnailUrl} 
              alt={displayTitle}
              width={400} 
              height={225} 
              className="rounded-md mx-auto mb-4 object-cover aspect-video" 
              unoptimized={!!analysisResult.thumbnailUrl} // Allow external YouTube thumbnails
            />
            <h3 className="text-lg font-medium text-foreground">{displayTitle}</h3>
            <p className="text-sm text-muted-foreground">{displayDescription}</p>
        </div>

        {isActionable && (
          <>
            <div className="space-y-2">
              <Label htmlFor="download-directory" className="text-base font-medium">Download Directory (Informational)</Label>
              <div className="flex items-center space-x-2">
                <Input id="download-directory" value={downloadDirectory} readOnly className="flex-grow text-base" />
                <Button variant="outline" onClick={handleChooseDirectory} className="text-accent-foreground bg-accent/80 hover:bg-accent/90">
                  <FolderOpen className="mr-2 h-5 w-5" /> Mock Choose
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Note: Files will download to your browser's default download location.</p>
            </div>

            {(downloadStatus === 'preparing' || downloadStatus === 'downloading') && (
              <div className="space-y-2">
                <Label className="text-base font-medium">Progress</Label>
                <Progress value={progress} className="w-full h-4" />
                <p className="text-sm text-muted-foreground text-center">
                  {downloadStatus === 'preparing' ? `Preparing: ${progress}%` : 'Download initiated by browser...'}
                </p>
              </div>
            )}
            
            {downloadStatus === 'completed' && (
                 <Alert variant="default" className="bg-green-100 dark:bg-green-900 border-green-500">
                    <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                    <AlertTitle className="text-green-700 dark:text-green-300">Download Process Initiated!</AlertTitle>
                    <AlertDescription className="text-green-600 dark:text-green-400">
                        Your browser is handling the download. Check your browser's download manager for progress. Files are "saved" to your default downloads folder.
                    </AlertDescription>
                </Alert>
            )}

            {downloadStatus === 'error' && (
                 <Alert variant="destructive">
                    <XCircle className="h-5 w-5" />
                    <AlertTitle>Download Error</AlertTitle>
                    <AlertDescription>
                        An error occurred. Please try again.
                    </AlertDescription>
                </Alert>
            )}
             {downloadStatus === 'cancelled' && (
                 <Alert variant="default" className="bg-yellow-100 dark:bg-yellow-900 border-yellow-500">
                    <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
                    <AlertTitle className="text-yellow-700 dark:text-yellow-300">Download Cancelled</AlertTitle>
                    <AlertDescription className="text-yellow-600 dark:text-yellow-400">
                        The download process was cancelled.
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
              onClick={handleActualDownload} 
              className="w-full sm:w-auto bg-accent hover:bg-accent/90 text-accent-foreground text-lg py-3"
              disabled={downloadStatus === 'preparing' || downloadStatus === 'downloading'}
            >
              {downloadStatus === 'preparing' ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Download className="mr-2 h-5 w-5" />}
              {downloadStatus === 'preparing' ? 'Preparing...' : (analysisResult.type === 'single' ? 'Download Audio' : 'Download All Audios (from playlist)')}
            </Button>
          )}
          {(downloadStatus === 'preparing' || downloadStatus === 'downloading') && downloadStatus !== 'completed' && (
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

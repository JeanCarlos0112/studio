
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import type { AnalysisResult } from '@/app/actions'; 
import { downloadAudioAction } from '@/app/download-audio.action';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { FileVideo, ListVideo, AlertCircle, CheckCircle2, XCircle, Download, Loader2, PlaySquare, RadioTower } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import Image from 'next/image';

interface DownloadAreaProps {
  analysisResult: AnalysisResult | null;
  youtubeUrl: string; 
}

type DownloadStatus = 'idle' | 'preparing' | 'downloading' | 'completed' | 'error' | 'cancelled';
type PlaylistDownloadStatus = 'idle' | 'preparing' | 'downloading_video' | 'completed_with_errors' | 'completed' | 'error' | 'cancelled';

export function DownloadArea({ analysisResult, youtubeUrl }: DownloadAreaProps) {
  const [overallDownloadStatus, setOverallDownloadStatus] = useState<DownloadStatus>('idle');
  const [currentProgress, setCurrentProgress] = useState(0); 
  const { toast } = useToast();

  const [playlistStatus, setPlaylistStatus] = useState<PlaylistDownloadStatus>('idle');
  const [playlistFileProgress, setPlaylistFileProgress] = useState<{ current: number; total: number; title: string } | null>(null);
  const [isProcessingPlaylist, setIsProcessingPlaylist] = useState(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);


  const resetStates = useCallback(() => {
    setOverallDownloadStatus('idle');
    setCurrentProgress(0);
    setPlaylistStatus('idle');
    setPlaylistFileProgress(null);
    setIsProcessingPlaylist(false);
    if (abortController) {
      abortController.abort();
      setAbortController(null);
    }
  }, [abortController]);

  useEffect(() => {
    resetStates();
  }, [analysisResult, youtubeUrl, resetStates]);

  const handleSingleVideoDownload = async (url: string, title?: string) => {
    setOverallDownloadStatus('preparing');
    setCurrentProgress(25); 

    try {
      const response = await downloadAudioAction(url, title);
      setCurrentProgress(50); 

      if (response instanceof Response) {
        if (response.ok) {
          setOverallDownloadStatus('downloading'); 
          
          const blob = await response.blob();
          setCurrentProgress(75); 

          const link = document.createElement('a');
          const objectUrl = window.URL.createObjectURL(blob);
          link.href = objectUrl;
          
          const contentDisposition = response.headers.get('Content-Disposition');
          let filename = title ? `${sanitizeFilename(title)}.mp3` : "youtube_audio.mp3";
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
          });
          
          setTimeout(() => {
            document.body.removeChild(link);
            window.URL.revokeObjectURL(objectUrl);
            setOverallDownloadStatus('completed'); 
            setCurrentProgress(100);
          }, 100);

        } else {
          const errorData = await response.json().catch(() => ({ error: `Server error: ${response.status}. Please try again.` }));
          const errorMessage = errorData.error || `Server error: ${response.status}. Please try again.`;
          throw new Error(errorMessage);
        }
      } else if (response.error) {
        throw new Error(response.error);
      } else {
        throw new Error('Unexpected response from server.');
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "An unknown error occurred.";
      console.error("Download error (single video):", e);
      setOverallDownloadStatus('error');
      setCurrentProgress(0);
      toast({
        title: "Download Failed",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  const handlePlaylistDownload = async () => {
    if (!analysisResult || !analysisResult.videoItems || analysisResult.videoItems.length === 0) {
      toast({ title: "Playlist Error", description: "No videos found in the playlist.", variant: "destructive" });
      setOverallDownloadStatus('error');
      return;
    }

    const newAbortController = new AbortController();
    setAbortController(newAbortController);

    setIsProcessingPlaylist(true);
    setPlaylistStatus('preparing');
    setOverallDownloadStatus('preparing');

    let successfullyInitiatedCount = 0;
    let hasFailures = false;

    for (let i = 0; i < analysisResult.videoItems.length; i++) {
      if (newAbortController.signal.aborted) {
        setPlaylistStatus('cancelled');
        setOverallDownloadStatus('cancelled');
        toast({ title: "Playlist Download Cancelled", description: "Download process was cancelled by user.", variant: "destructive"});
        break; 
      }

      const videoItem = analysisResult.videoItems[i];
      setPlaylistStatus('downloading_video');
      setPlaylistFileProgress({ current: i + 1, total: analysisResult.videoItems.length, title: videoItem.title });
      setCurrentProgress(((i + 1) / analysisResult.videoItems.length) * 100);


      try {
        // We cannot reliably check `isLive` for individual playlist items from `ytpl` output
        // The downloadAudioAction will handle this for each item.
        const response = await downloadAudioAction(videoItem.url, videoItem.title);
        
        if (newAbortController.signal.aborted) continue; 

        if (response instanceof Response) {
          if (response.ok) {
            const blob = await response.blob();
            const link = document.createElement('a');
            const objectUrl = window.URL.createObjectURL(blob);
            link.href = objectUrl;

            const contentDisposition = response.headers.get('Content-Disposition');
            let filename = videoItem.title ? `${sanitizeFilename(videoItem.title)}.mp3` : `playlist_video_${i+1}.mp3`;
            if (contentDisposition) {
                const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
                if (filenameMatch && filenameMatch.length > 1) {
                filename = decodeURIComponent(filenameMatch[1]);
                }
            }
            link.setAttribute('download', filename);
            document.body.appendChild(link);
            link.click();
            
            setTimeout(() => {
                document.body.removeChild(link);
                window.URL.revokeObjectURL(objectUrl);
            }, 100);
            successfullyInitiatedCount++;
          } else {
             const errorData = await response.json().catch(() => ({ error: `Server error for ${videoItem.title}: ${response.status}.` }));
             const errorText = errorData.error || `Server error for ${videoItem.title}: ${response.status}.`;
             hasFailures = true;
             toast({ title: `Failed: ${videoItem.title}`, description: errorText, variant: "destructive" });
          }
        } else if (response.error) {
          hasFailures = true;
          toast({ title: `Failed: ${videoItem.title}`, description: response.error, variant: "destructive" });
        } else {
           hasFailures = true;
           toast({ title: `Failed: ${videoItem.title}`, description: 'Unexpected response from server.', variant: "destructive" });
        }

        if (analysisResult.videoItems.length > 1 && i < analysisResult.videoItems.length - 1 && !newAbortController.signal.aborted) {
          await new Promise(resolve => setTimeout(resolve, 300)); 
        }

      } catch (e) {
        if (!newAbortController.signal.aborted) {
            hasFailures = true;
            const errorMessage = e instanceof Error ? e.message : "Unknown error";
            console.error(`Error downloading playlist item ${videoItem.title}:`, e);
            toast({ title: `Error processing ${videoItem.title}`, description: errorMessage, variant: "destructive" });
        }
      }
    }
    
    setIsProcessingPlaylist(false);
    setCurrentProgress(100);

    if (!newAbortController.signal.aborted) {
        if (hasFailures) {
            setPlaylistStatus('completed_with_errors');
            setOverallDownloadStatus('error'); 
            toast({
                title: "Playlist Processing Finished with Errors",
                description: `${successfullyInitiatedCount} of ${analysisResult.videoItems.length} video downloads initiated. Some failed or were skipped (e.g. live streams). Check notifications.`,
                variant: "destructive",
                duration: 7000,
            });
        } else {
            setPlaylistStatus('completed');
            setOverallDownloadStatus('completed');
            toast({
                title: "Playlist Downloads Processed",
                description: `${successfullyInitiatedCount} of ${analysisResult.videoItems.length} video downloads initiated. Check browser downloads.`,
                duration: 7000,
            });
        }
    }
    setAbortController(null);
  };
  
  const sanitizeFilename = (name: string): string => {
    let saneName = name.replace(/[^a-z0-9_.\-\s]/gi, '_').replace(/\s+/g, ' ');
    if (saneName.length > 100) {
      saneName = saneName.substring(0, 100).trim();
    }
    if (saneName.endsWith('.')) {
        saneName = saneName.substring(0, saneName.length -1) + '_';
    }
    if (!saneName || saneName === '.mp3') { 
      saneName = 'downloaded_audio';
    }
    return saneName;
  }


  const handleActualDownload = () => {
    if (!analysisResult || (overallDownloadStatus !== 'idle' && overallDownloadStatus !== 'completed' && overallDownloadStatus !== 'error' && overallDownloadStatus !== 'cancelled' ) ) {
        return;
    }
    resetStates(); 

    if (analysisResult.type === 'single') {
      if (analysisResult.isLive) {
         toast({
            title: "Live Stream",
            description: "Downloading live streams is not supported.",
            variant: "destructive",
         });
         setOverallDownloadStatus('error'); // Set a status to reflect this
         return;
      }
      handleSingleVideoDownload(youtubeUrl, analysisResult.title);
    } else if (analysisResult.type === 'playlist') {
      handlePlaylistDownload();
    }
  };

  const handleCancelDownload = () => {
    if (isProcessingPlaylist && abortController) {
      abortController.abort(); 
    } else {
        resetStates(); 
        setOverallDownloadStatus('cancelled'); 
         toast({
            title: "Download Cancelled",
            description: "The download process was cancelled.",
            variant: "default",
        });
    }
  };
  

  if (!analysisResult) return null;

  if (analysisResult.type === 'mixed' || analysisResult.type === 'unknown') {
    return (
      <Alert variant="destructive" className="mt-8 max-w-2xl mx-auto shadow-md">
        <AlertCircle className="h-5 w-5" />
        <AlertTitle>{analysisResult.type === 'mixed' ? 'Mixed Content Detected' : 'Unknown Content Type'}</AlertTitle>
        <AlertDescription>
          {analysisResult.type === 'mixed' 
            ? "The provided URL appears to contain mixed content. Audio extraction is only supported for single videos or playlists."
            : "Could not determine the content type of the URL or extract necessary information. Please check the URL and try again."
          }
        </AlertDescription>
      </Alert>
    );
  }
  
  if (analysisResult.type === 'single' && analysisResult.isLive) {
    return (
      <Alert variant="default" className="mt-8 max-w-2xl mx-auto shadow-md bg-amber-100 border-amber-500 text-amber-700 dark:bg-amber-900 dark:border-amber-600 dark:text-amber-300">
        <RadioTower className="h-5 w-5" />
        <AlertTitle>Live Stream Detected</AlertTitle>
        <AlertDescription>
          The provided URL is for a live stream. Downloading live streams as complete audio files is not currently supported. Only regular, non-live videos can be downloaded.
        </AlertDescription>
      </Alert>
    );
  }


  const isActionable = (analysisResult.type === 'single' && !analysisResult.isLive) || (analysisResult.type === 'playlist' && (analysisResult.videoItems?.length ?? 0) > 0);
  
  let contentDisplayTitle = analysisResult.title || 'Content Analysis';
  let IconComponent = AlertCircle; 
  let displayDescription = "Ready to extract audio.";

  if (analysisResult.type === 'single') {
    IconComponent = analysisResult.isLive ? RadioTower : FileVideo;
    contentDisplayTitle = analysisResult.title || (analysisResult.isLive ? 'Live Stream' : 'Single Video Detected');
    displayDescription = analysisResult.isLive 
      ? "This is a live stream. Live streams cannot be downloaded directly." 
      : "Ready to extract audio from this video.";
  } else if (analysisResult.type === 'playlist') {
    IconComponent = ListVideo;
    contentDisplayTitle = analysisResult.title || 'Playlist Detected';
    const videoCount = analysisResult.videoItems?.length || 0;
    displayDescription = videoCount > 0 
      ? `Ready to extract audio from ${videoCount} video${videoCount === 1 ? '' : 's'} in this playlist.`
      : "This playlist appears to be empty or videos could not be fetched.";
    if (analysisResult.playlistAuthor) {
      displayDescription += ` Curated by ${analysisResult.playlistAuthor}.`;
    }
  }
  
  const displayThumbnailUrl = analysisResult.thumbnailUrl || `https://picsum.photos/seed/${encodeURIComponent(youtubeUrl)}/400/225`;
  const cardTitleText = analysisResult.type === 'playlist' ? `Playlist: ${contentDisplayTitle}` : contentDisplayTitle;

  const isProcessing = overallDownloadStatus === 'preparing' || overallDownloadStatus === 'downloading' || isProcessingPlaylist;

  return (
    <Card className="mt-8 w-full max-w-2xl mx-auto shadow-lg">
      <CardHeader className="flex flex-row items-start space-x-4">
        <IconComponent className="h-8 w-8 text-primary mt-1" />
        <div>
          <CardTitle className="text-2xl font-semibold">{cardTitleText}</CardTitle>
          <CardDescription>{displayDescription} Audio is named .mp3 but contains the best available format (e.g., M4A).</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="p-4 border rounded-lg bg-secondary/30">
            <Image 
              data-ai-hint="video thumbnail"
              src={displayThumbnailUrl} 
              alt={contentDisplayTitle}
              width={400} 
              height={225} 
              className="rounded-md mx-auto mb-4 object-cover aspect-video" 
              unoptimized={!!analysisResult.thumbnailUrl} 
            />
            {analysisResult.type === 'playlist' && analysisResult.videoItems && analysisResult.videoItems.length > 0 && (
                <div className="mt-2 text-sm text-muted-foreground">
                    <PlaySquare className="inline h-4 w-4 mr-1" /> 
                    Contains {analysisResult.videoItems.length} video(s). 
                    {analysisResult.playlistAuthor && ` By: ${analysisResult.playlistAuthor}`}
                </div>
            )}
        </div>

        {isActionable && (
          <>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Files will be downloaded to your browser's default download location. 
              </p>
            </div>

            {isProcessing && (
              <div className="space-y-2">
                <Label className="text-base font-medium">Progress</Label>
                <Progress value={currentProgress} className="w-full h-4" />
                <p className="text-sm text-muted-foreground text-center">
                  {isProcessingPlaylist && playlistFileProgress 
                    ? `Processing: ${playlistFileProgress.current} of ${playlistFileProgress.total} - "${playlistFileProgress.title}" (${Math.round(currentProgress)}%)`
                    : overallDownloadStatus === 'preparing' ? `Preparing download... ${Math.round(currentProgress)}%` 
                    : overallDownloadStatus === 'downloading' ? 'Download initiated, waiting for browser...'
                    : 'Processing...'
                  }
                </p>
              </div>
            )}
            
            {overallDownloadStatus === 'completed' && (
                 <Alert variant="default" className="bg-green-100 dark:bg-green-900 border-green-500">
                    <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                    <AlertTitle className="text-green-700 dark:text-green-300">Download Process Initiated!</AlertTitle>
                    <AlertDescription className="text-green-600 dark:text-green-400">
                        Your browser is handling the download(s). Check your browser's download manager for progress.
                    </AlertDescription>
                </Alert>
            )}

            {overallDownloadStatus === 'error' && (
                 <Alert variant="destructive">
                    <XCircle className="h-5 w-5" />
                    <AlertTitle>Download Error</AlertTitle>
                    <AlertDescription>
                        An error occurred during the download process. Some files may not have downloaded or were skipped (e.g. live streams). Please check notifications for details.
                    </AlertDescription>
                </Alert>
            )}
             {overallDownloadStatus === 'cancelled' && (
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
          {!isProcessing && (overallDownloadStatus === 'idle' || overallDownloadStatus === 'completed' || overallDownloadStatus === 'error' || overallDownloadStatus === 'cancelled') && (
            <Button 
              onClick={handleActualDownload} 
              className="w-full sm:w-auto bg-accent hover:bg-accent/90 text-accent-foreground text-lg py-3"
              disabled={isProcessing} 
            >
              <Download className="mr-2 h-5 w-5" />
              {analysisResult.type === 'single' ? 'Download Audio' : 'Download All Audios'}
            </Button>
          )}
          {isProcessing && (
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

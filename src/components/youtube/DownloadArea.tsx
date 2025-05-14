'use client';

import React, { useState, useEffect, useCallback } from 'react';
import type { AnalysisResult } from '@/app/actions'; 
import { downloadAudioAction } from '@/app/download-audio.action';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { FileVideo, ListVideo, AlertCircle, CheckCircle2, XCircle, Download, Loader2, PlaySquare, RadioTower, Package } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import Image from 'next/image';

interface DownloadAreaProps {
  analysisResult: AnalysisResult | null;
  youtubeUrl: string; 
}

type DownloadStage = 
  | 'idle' 
  | 'preparing' 
  | 'downloading_video' 
  | 'converting_video'
  | 'adding_to_archive'
  | 'compressing_archive'
  | 'downloading_browser' 
  | 'completed' 
  | 'error' 
  | 'cancelled';

interface ProgressDetails {
    stage: DownloadStage;
    videoIndex?: number; // For playlists
    totalVideos?: number; // For playlists
    videoTitle?: string; // For playlists
    overallPercentage: number;
}

export function DownloadArea({ analysisResult, youtubeUrl }: DownloadAreaProps) {
  const [progressDetails, setProgressDetails] = useState<ProgressDetails>({ stage: 'idle', overallPercentage: 0 });
  const { toast } = useToast();
  const [abortController, setAbortController] = useState<AbortController | null>(null);


  const resetStates = useCallback(() => {
    setProgressDetails({ stage: 'idle', overallPercentage: 0 });
    if (abortController) {
      abortController.abort("Component re-render or new analysis."); 
      setAbortController(null);
    }
  }, [abortController]); 

  useEffect(() => {
    resetStates();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisResult, youtubeUrl]);


  const handleDownload = async () => {
    if (!analysisResult || (progressDetails.stage !== 'idle' && progressDetails.stage !== 'completed' && progressDetails.stage !== 'error' && progressDetails.stage !== 'cancelled')) {
        return;
    }

    const newAbortController = new AbortController();
    setAbortController(newAbortController); 
    
    setProgressDetails({ stage: 'preparing', overallPercentage: 5 });

    const isPlaylist = analysisResult.type === 'playlist';
    const itemsToDownload = isPlaylist && analysisResult.videoItems ? analysisResult.videoItems.map(v => ({ url: v.url, title: v.title })) : null;
    const primaryUrl = youtubeUrl; 
    const playlistTitle = isPlaylist ? analysisResult.title : undefined;

    try {
      if (isPlaylist) {
        setProgressDetails(prev => ({ ...prev, stage: 'preparing', overallPercentage: 10, videoIndex: 0, totalVideos: itemsToDownload?.length || 0 }));
      } else {
        setProgressDetails(prev => ({ ...prev, stage: 'downloading_video', overallPercentage: 20 }));
      }
      
      if (isPlaylist && itemsToDownload && itemsToDownload.length > 0) {
          setProgressDetails(prev => ({ 
              ...prev, 
              stage: 'downloading_video', 
              overallPercentage: 30, 
              videoIndex: 1, 
              videoTitle: itemsToDownload[0]?.title
          })); 
      }

      const response = await downloadAudioAction(
        primaryUrl, 
        itemsToDownload, 
        isPlaylist, 
        playlistTitle,
        newAbortController.signal, // Pass the AbortSignal object
        newAbortController.signal.aborted // Pass the initial aborted state as a boolean
      );

      if (newAbortController.signal.aborted && progressDetails.stage !== 'cancelled') { 
        // If the signal is aborted by the time we get the response, and we haven't already set to cancelled
        setProgressDetails({ stage: 'cancelled', overallPercentage: 0 });
        toast({ title: "Download Cancelled", description: "The download process was cancelled by the user.", variant: "default" });
        return;
      }

      if (response instanceof Response) {
        if (response.ok) {
          setProgressDetails(prev => ({ ...prev, stage: 'downloading_browser', overallPercentage: 90 }));
          
          const blob = await response.blob();
          setProgressDetails(prev => ({ ...prev, stage: 'downloading_browser', overallPercentage: 95 }));

          const link = document.createElement('a');
          const objectUrl = window.URL.createObjectURL(blob);
          link.href = objectUrl;
          
          const contentDisposition = response.headers.get('Content-Disposition');
          let filename = isPlaylist 
            ? `${sanitizeFilename(playlistTitle || "youtube_playlist")}.zip`
            : `${sanitizeFilename(analysisResult.title || "youtube_audio")}.mp3`;

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
            if (document.body.contains(link)) {
                 document.body.removeChild(link);
            }
            window.URL.revokeObjectURL(objectUrl);
            setProgressDetails({ stage: 'completed', overallPercentage: 100 });
          }, 200);

        } else {
          const errorData = await response.json().catch(() => ({ error: `Server error: ${response.status}. Please try again.` }));
          const errorMessage = errorData.error || `Server error: ${response.status}. Please try again.`;
          throw new Error(errorMessage); // This will be caught by the outer catch
        }
      } else if (response.error) {
        // This means downloadAudioAction returned a DownloadError object
        throw new Error(response.error); // This will be caught by the outer catch
      } else {
        throw new Error('Unexpected response from server.');
      }
    } catch (e) {
      let errorMessage = e instanceof Error ? e.message : "An unknown error occurred.";
      // Check if the error message itself indicates a client-side cancellation or if the signal is aborted
      const clientCancelled = newAbortController.signal.aborted || errorMessage.toLowerCase().includes("cancelled by client") || errorMessage.toLowerCase().includes("aborted by client");

      if (clientCancelled && progressDetails.stage !== 'cancelled') { 
          setProgressDetails({ stage: 'cancelled', overallPercentage: 0 });
          const cancelDesc = newAbortController.signal.aborted ? "The download process was cancelled by the user." : `The download process was aborted: ${errorMessage}`;
          toast({ title: "Download Cancelled", description: cancelDesc, variant: "default" });
      } else if (errorMessage.toLowerCase().includes("operation cancelled") && progressDetails.stage !== 'cancelled') {
          // This handles cancellations reported by the server action (e.g. "Operation cancelled: ...")
          setProgressDetails({ stage: 'cancelled', overallPercentage: 0 });
          toast({ title: "Download Cancelled", description: errorMessage, variant: "default" });
      } else if (progressDetails.stage !== 'cancelled' && progressDetails.stage !== 'error') {
          // For other errors
          console.error("Download error:", e);
          setProgressDetails({ stage: 'error', overallPercentage: 0 });
          toast({
            title: "Download Failed",
            description: errorMessage,
            variant: "destructive",
          });
      }
    } finally {
        // Clean up abort controller if it's the one we created for this download attempt
        if (abortController === newAbortController) { 
            setAbortController(null);
        }
    }
  };
  
  const sanitizeFilename = (name: string): string => {
    let saneName = name.replace(/[^a-z0-9_.\-\s]/gi, '_').replace(/\s+/g, ' ');
    if (saneName.length > 100) {
      saneName = saneName.substring(0, 100).trim();
    }
    if (saneName.endsWith('.')) {
        saneName = saneName.substring(0, saneName.length -1) + '_';
    }
    if (!saneName || saneName === '.mp3' || saneName === '.zip') { 
      saneName = 'downloaded_file'; 
    }
    return saneName;
  }


  const handleCancelDownload = () => {
    if (abortController) {
      abortController.abort("User cancelled download."); 
      // State update to 'cancelled' will be handled by the catch block in handleDownload
      // or by the check `if (newAbortController.signal.aborted)` after the action call.
    }
  };
  
  const getProgressMessage = () => {
    const { stage, overallPercentage, videoIndex, totalVideos, videoTitle } = progressDetails;
    const percent = Math.round(overallPercentage);

    switch (stage) {
        case 'preparing': return `Preparing download... (${percent}%)`;
        case 'downloading_video':
            if (analysisResult?.type === 'playlist' && videoIndex !== undefined && totalVideos && videoTitle) {
                return `Downloading video ${videoIndex} of ${totalVideos}: "${videoTitle}"... (${percent}%)`;
            }
            return `Downloading video... (${percent}%)`;
        case 'converting_video':
            if (analysisResult?.type === 'playlist' && videoIndex !== undefined && totalVideos && videoTitle) {
                return `Converting video ${videoIndex} of ${totalVideos}: "${videoTitle}" to MP3... (${percent}%)`;
            }
            return `Converting video to MP3... (${percent}%)`;
        case 'adding_to_archive':
            if (analysisResult?.type === 'playlist' && videoIndex !== undefined && totalVideos && videoTitle) {
                return `Adding "${videoTitle}" to archive (${videoIndex}/${totalVideos})... (${percent}%)`;
            }
            return `Archiving... (${percent}%)`; 
        case 'compressing_archive': return `Compressing audio files into ZIP... (${percent}%)`;
        case 'downloading_browser': return `Download initiated, your browser is handling it... (${percent}%)`;
        case 'completed': return `Download process complete! (${percent}%)`;
        case 'error': return `An error occurred. (${percent}%)`;
        case 'cancelled': return `Download cancelled. (${percent}%)`;
        case 'idle': return 'Ready to download.';
        default: return 'Processing...';
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
  let IconDisplayComponent = AlertCircle; 
  let displayDescription = "Ready to extract audio.";

  if (analysisResult.type === 'single') {
    IconDisplayComponent = analysisResult.isLive ? RadioTower : FileVideo;
    contentDisplayTitle = analysisResult.title || (analysisResult.isLive ? 'Live Stream' : 'Single Video Detected');
    displayDescription = analysisResult.isLive 
      ? "This is a live stream. Live streams cannot be downloaded directly." 
      : "Ready to download video and convert to MP3.";
  } else if (analysisResult.type === 'playlist') {
    IconDisplayComponent = ListVideo;
    contentDisplayTitle = analysisResult.title || 'Playlist Detected';
    const videoCount = analysisResult.videoItems?.length || 0;
    displayDescription = videoCount > 0 
      ? `Ready to download ${videoCount} video${videoCount === 1 ? '' : 's'}, convert to MP3, and package into a ZIP file.`
      : "This playlist appears to be empty or videos could not be fetched.";
    if (analysisResult.playlistAuthor) {
      displayDescription += ` Curated by ${analysisResult.playlistAuthor}.`;
    }
  }
  
  const displayThumbnailUrl = analysisResult.thumbnailUrl || `https://picsum.photos/seed/${encodeURIComponent(youtubeUrl)}/400/225`;
  const cardTitleText = analysisResult.type === 'playlist' ? `Playlist: ${contentDisplayTitle}` : contentDisplayTitle;

  const isProcessing = progressDetails.stage !== 'idle' && progressDetails.stage !== 'completed' && progressDetails.stage !== 'error' && progressDetails.stage !== 'cancelled';

  return (
    <Card className="mt-8 w-full max-w-2xl mx-auto shadow-lg">
      <CardHeader className="flex flex-row items-start space-x-4">
        <IconDisplayComponent className="h-8 w-8 text-primary mt-1" />
        <div>
          <CardTitle className="text-2xl font-semibold">{cardTitleText}</CardTitle>
          <CardDescription>{displayDescription}</CardDescription>
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
              unoptimized={!!analysisResult.thumbnailUrl} // Use unoptimized if it's a direct YT thumbnail to avoid Next/Image optimization issues with external dynamic URLs
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
                {analysisResult.type === 'playlist' 
                  ? "A ZIP file containing all MP3s will be downloaded." 
                  : "An MP3 file will be downloaded."
                }
                 Files are sent to your browser's default download location.
              </p>
               <p className="text-xs text-muted-foreground italic">
                Note: FFmpeg is used for conversion. Ensure it's available if running this server-side.
              </p>
            </div>

            {isProcessing && (
              <div className="space-y-2">
                <Label className="text-base font-medium">Progress</Label>
                <Progress value={progressDetails.overallPercentage} className="w-full h-4" />
                <p className="text-sm text-muted-foreground text-center">
                  {getProgressMessage()}
                </p>
              </div>
            )}
            
            {progressDetails.stage === 'completed' && (
                 <Alert variant="default" className="bg-green-100 dark:bg-green-900 border-green-500">
                    <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                    <AlertTitle className="text-green-700 dark:text-green-300">Download Process Initiated!</AlertTitle>
                    <AlertDescription className="text-green-600 dark:text-green-400">
                        Your browser is handling the download(s). Check your browser's download manager for progress.
                    </AlertDescription>
                </Alert>
            )}

            {progressDetails.stage === 'error' && (
                 <Alert variant="destructive">
                    <XCircle className="h-5 w-5" />
                    <AlertTitle>Download Error</AlertTitle>
                    <AlertDescription>
                        An error occurred. Some files may not have processed. Check notifications for details.
                    </AlertDescription>
                </Alert>
            )}
             {progressDetails.stage === 'cancelled' && (
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
          {!isProcessing && (
            <Button 
              onClick={handleDownload} 
              className="w-full sm:w-auto bg-accent hover:bg-accent/90 text-accent-foreground text-lg py-3"
              disabled={isProcessing} 
            >
              {isProcessing ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : 
                (analysisResult.type === 'single' ? <Download className="mr-2 h-5 w-5" /> : <Package className="mr-2 h-5 w-5" />)
              }
              {analysisResult.type === 'single' ? 'Download MP3' : 'Download All as ZIP'}
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
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useRef } from 'react';
import { socket } from '../lib/socket';
import { Track, LocalVideoTrack } from 'livekit-client';
import { 
  useTracks,
  useLocalParticipant,
  VideoTrack
} from '@livekit/components-react';

interface VideoGridProps {
  isTeacher: boolean;
}

const VideoGrid: React.FC<VideoGridProps> = ({ isTeacher }) => {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { localParticipant } = useLocalParticipant();
  
  // All camera tracks in the room - both local and remote
  const allTracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: false },
      { source: Track.Source.ScreenShare, withPlaceholder: false }
    ],
    { onlySubscribed: false }
  );

  // Reactive access to local camera track for the AI worker
  useEffect(() => {
    const cameraPub = localParticipant.getTrackPublication(Track.Source.Camera);
    const cameraTrack = cameraPub?.videoTrack as LocalVideoTrack | undefined;
    const videoElement = localVideoRef.current;
    
    console.log('[VideoGrid] Camera pub=' + !!cameraPub + ' track=' + !!cameraTrack + ' video=' + !!videoElement);
    
    if (cameraTrack && videoElement) {
      console.log('[VideoGrid] 🎥 Attaching camera track...');
      
      videoElement.autoplay = true;
      videoElement.muted = true;
      videoElement.playsInline = true;
      
      // Attach track
      cameraTrack.attach(videoElement);
      console.log('[VideoGrid] Track attached. Calling play()...');
      
      // Add comprehensive event listeners
      const onLoadedMetadata = () => {
        console.log(`[VideoGrid] loadedmetadata: dims=${videoElement.videoWidth}x${videoElement.videoHeight}`);
      };
      
      const onCanPlay = () => {
        console.log(`[VideoGrid] canplay: readyState=${videoElement.readyState}`);
      };
      
      const onPlaying = () => {
        console.log(`[VideoGrid] playing: readyState=${videoElement.readyState}`);
      };
      
      const onPlay = () => {
        console.log(`[VideoGrid] play event fired`);
      };
      
      const onTimeUpdate = () => {
        console.log(`[VideoGrid] timeupdate: currentTime=${videoElement.currentTime}, readyState=${videoElement.readyState}`);
      };
      
      const onError = (err: any) => {
        console.error('[VideoGrid]  Video error:', err);
      };
      
      videoElement.addEventListener('loadedmetadata', onLoadedMetadata);
      videoElement.addEventListener('canplay', onCanPlay);
      videoElement.addEventListener('playing', onPlaying);
      videoElement.addEventListener('play', onPlay);
      videoElement.addEventListener('timeupdate', onTimeUpdate);
      videoElement.addEventListener('error', onError);
      
      // Try to play
      videoElement.play()
        .then(() => console.log('[VideoGrid]  play() succeeded'))
        .catch(err => console.error('[VideoGrid] play() failed:', err));
      
      return () => {
        videoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
        videoElement.removeEventListener('canplay', onCanPlay);
        videoElement.removeEventListener('playing', onPlaying);
        videoElement.removeEventListener('play', onPlay);
        videoElement.removeEventListener('timeupdate', onTimeUpdate);
        videoElement.removeEventListener('error', onError);
        if (cameraTrack) {
          cameraTrack.detach(videoElement);
        }
      };
    } else {
      console.warn('[VideoGrid]  Cannot attach: track=' + !!cameraTrack + ' video=' + !!videoElement);
    }
  }, [localParticipant]);

  // AI Worker for phone and distraction detection - Capture from visible tracks
  useEffect(() => {
    if (isTeacher) {
      return; // Teachers don't need AI monitoring
    }

    let aiInterval: any;
    let aiWorker: Worker | null = null;
    let isWorkerReady = false;
    let localTrackRef: any = null;

    try {
      aiWorker = new Worker(new URL('../lib/ai/aiWorker.ts', import.meta.url), { type: 'module' });
      let prevPhoneDetected = false;
      let prevDistraction: string | null = null;
      let frameCount = 0;
      let lastPhoneDetectedTime = 0; // Debounce: prevent rapid re-triggering of phone_detected
      const PHONE_DETECTION_DEBOUNCE_MS = 1000; // Wait 1 second before re-sending phone_detected
      
      aiWorker.onerror = (err) => {
        console.error('[AI] Worker error:', err.message);
      };
      
      aiWorker.onmessage = (e) => {
        if (e.data.type === 'ready') {
          isWorkerReady = true;
          console.log('[AI]  Worker initialized');
        } else if (e.data.type === 'results') {
          const { attention, phone } = e.data.data;
          
          socket.emit('ts:attention_update', { score: attention.score, timestamp: Date.now() });
          
          if (attention.lastDistraction && attention.lastDistraction !== prevDistraction) {
            socket.emit('ts:distraction', { type: attention.lastDistraction, timestamp: Date.now() });
            prevDistraction = attention.lastDistraction;
          } else if (!attention.lastDistraction && prevDistraction) {
            socket.emit('ts:distraction_cleared', { timestamp: Date.now() });
            prevDistraction = null;
          }
          
          if (phone.isPhoneDetected && !prevPhoneDetected) {
            const now = Date.now();
            if (now - lastPhoneDetectedTime > PHONE_DETECTION_DEBOUNCE_MS) {
              console.warn('[AI] 📱 PHONE DETECTED!');
              socket.emit('ts:phone_detected', { confidence: phone.confidence, timestamp: now });
              lastPhoneDetectedTime = now;
            }
            prevPhoneDetected = true;
          } else if (!phone.isPhoneDetected && prevPhoneDetected) {
            console.log('[AI] 📱 Phone cleared');
            socket.emit('ts:phone_cleared', { timestamp: Date.now() });
            prevPhoneDetected = false;
            lastPhoneDetectedTime = 0; // Reset debounce on clear
          }
          
          frameCount++;
        }
      };

      // Capture frames from visible video tracks
      aiInterval = setInterval(async () => {
        if (!isWorkerReady || !canvasRef.current) {
          return;
        }

        try {
          // Find local video element from allTracks
          const localTrack = allTracks.find(t => t.participant.isLocal && t.source === Track.Source.Camera);
          
          if (!localTrack) {
            if (!localTrackRef) {
              console.log('[AI] ⏳ Waiting for local video track...');
              localTrackRef = null;
            }
            return;
          }

          // Get the actual video element that LiveKit is using
          const videoElements = document.querySelectorAll('video[data-livekit-track]');
          let localVideoElement: HTMLVideoElement | null = null;
          
          for (const el of videoElements) {
            const video = el as HTMLVideoElement;
            if (video.srcObject && (video.srcObject as any).getTracks?.().length > 0) {
              // Check if this is the local participant's video
              const rect = video.getBoundingClientRect();
              // Local video is usually smaller or has specific styling
              if (rect.width > 0 && rect.height > 0 && video.readyState >= 2) {
                localVideoElement = video;
                break;
              }
            }
          }

          // If no track-specific video found, try all videos
          if (!localVideoElement) {
            const allVideos = document.querySelectorAll('video');
            for (const video of allVideos) {
              const el = video as HTMLVideoElement;
              if (el.readyState >= 2 && el.videoWidth > 0 && el.videoHeight > 0 && el !== localVideoRef.current) {
                // Skip the preview video in bottom-right
                const rect = el.getBoundingClientRect();
                if (rect.width > 50) { // Actual sized video, not preview
                  localVideoElement = el;
                  break;
                }
              }
            }
          }

          if (!localVideoElement) {
            if (localTrackRef) {
              console.log('[AI] ⏳ Searching for video element...');
              localTrackRef = null;
            }
            return;
          }

          // If we just found the element, log it
          if (!localTrackRef) {
            console.log(`[AI] ✅ Found video! Size: ${localVideoElement.videoWidth}x${localVideoElement.videoHeight}`);
            localTrackRef = localVideoElement;
          }

          const canvas = canvasRef.current;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;

          canvas.width = localVideoElement.videoWidth;
          canvas.height = localVideoElement.videoHeight;
          ctx.drawImage(localVideoElement, 0, 0);

          const bitmap = await createImageBitmap(canvas);
          aiWorker?.postMessage({ type: 'process_frame', bitmap }, [bitmap]);
          console.debug(`[AI] 📸 Frame sent (${frameCount})`);
        } catch (err: any) {
          console.warn('[AI] Capture error:', err.message);
        }
      }, 250); // 250ms interval = 4 frames per second for ultra-fast detection
    } catch (err) {
      console.error('[AI] Setup error:', err);
    }

    return () => {
      if (aiInterval) clearInterval(aiInterval);
      if (aiWorker) aiWorker.terminate();
    };
  }, [allTracks, isTeacher]);

  return (
    <div className="flex-1 flex flex-col w-full h-full relative overflow-hidden">
      {isTeacher ? (
        // Teacher View: Grid of all students + self
        <div className="w-full h-full p-4 sm:p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 overflow-y-auto content-start bg-slate-950">
          {allTracks.length > 0 ? (
            allTracks.map((trackRef) => (
              <div key={`${trackRef.participant.identity}-${trackRef.source}`} className={`bg-slate-900 rounded-2xl overflow-hidden aspect-video md:aspect-auto relative shadow-2xl border transition-all hover:border-slate-700 min-h-35 md:min-h-55 ${trackRef.source === Track.Source.ScreenShare ? 'border-track-teal/50 ring-2 ring-track-teal/20' : 'border-slate-800'}`}>
                <VideoTrack 
                  trackRef={trackRef as any} 
                  className={`w-full h-full ${trackRef.source === Track.Source.ScreenShare ? 'object-contain bg-black' : 'object-cover'}`}
                />
                <div className="absolute bottom-3 left-3 flex items-center gap-2 bg-black/60 px-3 py-1.5 rounded-full text-xs font-bold backdrop-blur-md z-10 border border-white/10 text-white">
                  <span className={`w-2 h-2 rounded-full ${trackRef.participant.isLocal ? 'bg-track-teal' : 'bg-emerald-400'} animate-pulse`}></span>
                  {trackRef.participant.name || trackRef.participant.identity} {trackRef.participant.isLocal && '(You)'}
                  {trackRef.source === Track.Source.ScreenShare && <span className="ml-1 text-[10px] text-track-teal uppercase tracking-widest">[Screen Share]</span>}
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-full h-full flex items-center justify-center">
              <p className="text-slate-500 font-medium">Waiting for participants to share video...</p>
            </div>
          )}
        </div>
      ) : (
        // Student View: Focus on Class Grid, with own self-view visible
        <div className="w-full h-full relative flex flex-col bg-slate-950 overflow-hidden">
          {/* Main View Grid (Everyone else + self) */}
          <div className="flex-1 rounded-2xl md:rounded-3xl overflow-hidden flex flex-col relative bg-slate-900/40 border border-slate-800/50 m-3 md:m-6">
            {allTracks.length > 0 ? (
              <div className="w-full h-full grid gap-2 md:gap-4 lg:gap-6 p-2 md:p-4 auto-rows-fr overflow-y-auto" style={{
                gridTemplateColumns: allTracks.length === 1 ? '1fr' : 
                                     allTracks.length === 2 ? '1fr 1fr' : 
                                     window.innerWidth < 640 ? '1fr' :
                                     window.innerWidth < 1024 ? '1fr 1fr' :
                                     'repeat(auto-fit, minmax(250px, 1fr))'
              }}>
                {/* Show all tracks including self */}
                {allTracks.filter(t => t.source === Track.Source.Camera || t.source === Track.Source.ScreenShare)
                  .sort((a) => (a.source === Track.Source.ScreenShare ? -1 : 1))
                  .map((trackRef) => (
                  <div key={`${trackRef.participant.identity}-${trackRef.source}`} className={`bg-slate-900 rounded-xl md:rounded-2xl overflow-hidden border relative shadow-lg md:shadow-2xl transition-all hover:scale-[1.01] aspect-video ${trackRef.source === Track.Source.ScreenShare ? 'border-track-teal/50 col-span-full' : trackRef.participant.isLocal ? 'border-track-amber/50 ring-2 ring-track-amber/20' : 'border-slate-800'}`}>
                    <VideoTrack 
                      trackRef={trackRef as any} 
                      className={`w-full h-full ${trackRef.source === Track.Source.ScreenShare ? 'object-contain bg-black' : 'object-cover'}`} 
                    />
                    <div className={`absolute bottom-2 md:bottom-3 left-2 md:left-3 flex items-center gap-1 md:gap-2 px-2 md:px-3 py-1 md:py-1.5 rounded-full text-[10px] md:text-[11px] font-bold backdrop-blur-md z-10 whitespace-nowrap ${
                      trackRef.participant.isLocal 
                        ? 'bg-track-amber/20 border border-track-amber/50 text-track-amber shadow-[0_0_8px_rgba(251,146,60,0.5)]' 
                        : 'bg-black/60 border border-white/10 text-white'
                    }`}>
                      <span className={`w-1.5 md:w-2 h-1.5 md:h-2 rounded-full shrink-0 ${trackRef.participant.isLocal ? 'bg-track-amber animate-pulse' : 'bg-track-teal shadow-[0_0_8px_#00e5ff]'}`}></span>
                      <span className="truncate">{trackRef.participant.name || (trackRef.participant.isLocal ? 'You' : 'Participant')}</span>
                      {trackRef.participant.isLocal && <span className="hidden sm:inline"> (You)</span>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center p-6 md:p-12 text-center w-full h-full">
                <div className="w-16 md:w-20 h-16 md:h-20 bg-slate-800 rounded-2xl md:rounded-3xl flex items-center justify-center mb-4 md:mb-8 shadow-lg md:shadow-2xl">
                  <div className="w-8 md:w-10 h-8 md:h-10 border-3 md:border-4 border-track-teal border-t-transparent rounded-full animate-spin"></div>
                </div>
                <h3 className="text-xl md:text-3xl font-bold text-white mb-2 md:mb-4">Connecting to Classroom</h3>
                <p className="text-slate-400 text-sm md:text-lg">Initializing your video feed and AI monitoring...</p>
              </div>
            )}
          </div>

          {/* Canvas for frame processing */}
          <canvas
            ref={canvasRef}
            style={{ display: 'none' }}
          />
          
          {/* Monitoring status indicator */}
          <div className="absolute top-3 right-3 md:top-8 md:right-8 z-20">
            <div className="bg-slate-950/90 px-3 md:px-4 py-2 rounded-full text-[10px] md:text-[11px] font-bold backdrop-blur-md flex items-center gap-2 md:gap-2.5 border border-slate-800/60 shadow-lg md:shadow-xl text-slate-300 whitespace-nowrap">
               <span className="w-1.5 md:w-2 h-1.5 md:h-2 rounded-full bg-track-alert-amber animate-pulse shadow-[0_0_8px_#F59E0B] shrink-0"></span>
               <span className="hidden sm:inline">Monitoring is Active</span>
               <span className="sm:hidden">Monitoring Active</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoGrid;

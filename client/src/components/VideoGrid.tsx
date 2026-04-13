import React, { useEffect, useRef } from 'react';
import { socket } from '../lib/socket';
import { Track, LocalVideoTrack } from 'livekit-client';
import { 
  useTracks, 
  VideoTrack,
  useLocalParticipant
} from '@livekit/components-react';

interface VideoGridProps {
  isTeacher: boolean;
}

const VideoGrid: React.FC<VideoGridProps> = ({ isTeacher }) => {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const { localParticipant } = useLocalParticipant();
  
  // All camera tracks in the room - both local and remote
  // by specifying `onlySubscribed: false`, we ensure we see participants even before the video stream fully negotiates
  const allTracks = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: false }],
    { onlySubscribed: false }
  );

  // Reactive access to local camera track for the AI worker
  useEffect(() => {
    // 1. Fetch camera directly from the strictly local participant hook
    const cameraPub = localParticipant.getTrackPublication(Track.Source.Camera);
    const cameraTrack = cameraPub?.videoTrack as LocalVideoTrack | undefined;
    
    // 2. Attach it to our raw video element used for AI scanning
    if (cameraTrack && localVideoRef.current) {
      cameraTrack.attach(localVideoRef.current);
    }

    let aiInterval: any;
    let aiWorker: Worker | null = null;
    let isWorkerReady = false;

    if (!isTeacher) {
      aiWorker = new Worker(new URL('../lib/ai/aiWorker.ts', import.meta.url), { type: 'module' });
      let prevPhoneDetected = false;
      
      aiWorker.onmessage = (e) => {
        if (e.data.type === 'ready') {
          isWorkerReady = true;
        } else if (e.data.type === 'results') {
          const { attention, phone } = e.data.data;
          
          if (attention.lastDistraction) {
            socket.emit('ts:distraction', { type: attention.lastDistraction, timestamp: Date.now() });
          }
          
          socket.emit('ts:attention_update', { score: attention.score, timestamp: Date.now() });
          
          // State transition for phone detection
          if (phone.isPhoneDetected && !prevPhoneDetected) {
            socket.emit('ts:phone_detected', { confidence: phone.confidence, timestamp: Date.now() });
            prevPhoneDetected = true;
          } else if (!phone.isPhoneDetected && prevPhoneDetected) {
            socket.emit('ts:phone_cleared', { timestamp: Date.now() });
            prevPhoneDetected = false;
          }
        }
      };

      aiInterval = setInterval(async () => {
        if (!isWorkerReady || !localVideoRef.current || localVideoRef.current.readyState < 2) return;
        try {
          const bitmap = await createImageBitmap(localVideoRef.current);
          aiWorker?.postMessage({ type: 'process_frame', bitmap }, [bitmap]);
        } catch (e) {
          // Ignore occasional cloning errors
        }
      }, 2000);
    }

    return () => {
      if (cameraTrack && localVideoRef.current) {
        cameraTrack.detach(localVideoRef.current);
      }
      if (aiInterval) clearInterval(aiInterval);
      if (aiWorker) aiWorker.terminate();
    };
  }, [localParticipant, isTeacher]);

  return (
    <div className="flex-1 flex flex-col w-full h-full relative overflow-hidden">
      {isTeacher ? (
        // Teacher View: Grid of all students + self
        <div className="w-full h-full p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 overflow-y-auto content-start bg-slate-950">
          {allTracks.length > 0 ? (
            allTracks.map((trackRef) => (
              <div key={trackRef.participant.identity} className="bg-slate-900 rounded-2xl overflow-hidden aspect-video relative shadow-2xl border border-slate-800 transition-all hover:border-slate-700">
                <VideoTrack 
                  trackRef={trackRef as any} 
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-3 left-3 flex items-center gap-2 bg-black/60 px-3 py-1.5 rounded-full text-xs font-bold backdrop-blur-md z-10 border border-white/10">
                  <span className={`w-2 h-2 rounded-full ${trackRef.participant.isLocal ? 'bg-track-teal' : 'bg-emerald-400'} animate-pulse`}></span>
                  {trackRef.participant.name || trackRef.participant.identity} {trackRef.participant.isLocal && '(You)'}
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
        // Student View: Focus on Class Grid, with small self-view
        <div className="w-full h-full relative p-6 flex flex-col md:flex-row gap-6 bg-slate-950">
          {/* Main View Grid (Everyone else) */}
          <div className="flex-1 rounded-3xl overflow-hidden flex flex-col relative bg-slate-900/40 border border-slate-800/50">
            {allTracks.filter(t => !t.participant.isLocal).length > 0 ? (
              <div className="w-full h-full grid grid-cols-1 md:grid-cols-2 gap-6 p-4 auto-rows-fr">
                {allTracks.filter(t => !t.participant.isLocal).map((trackRef) => (
                  <div key={trackRef.participant.identity} className="bg-slate-900 rounded-2xl overflow-hidden border border-slate-800 relative shadow-2xl transition-all hover:scale-[1.01]">
                    <VideoTrack 
                      trackRef={trackRef as any} 
                      className="w-full h-full object-cover" 
                    />
                    <div className="absolute bottom-3 left-3 flex items-center gap-2 bg-black/60 px-3 py-1.5 rounded-full text-[11px] font-bold backdrop-blur-md z-10">
                      <span className="w-2 h-2 rounded-full bg-track-teal shadow-[0_0_8px_#00e5ff]"></span>
                      {trackRef.participant.name || 'Instructor'}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center p-12 text-center w-full h-full">
                <div className="w-20 h-20 bg-slate-800 rounded-3xl flex items-center justify-center mb-8 shadow-2xl">
                  <div className="w-10 h-10 border-4 border-track-teal border-t-transparent rounded-full animate-spin"></div>
                </div>
                <h3 className="text-3xl font-bold text-white mb-4">Connecting to Classroom</h3>
                <p className="text-slate-400 max-w-sm text-lg">Class is about to begin. Please stay focused and ensure your camera is positioned correctly.</p>
              </div>
            )}
          </div>

          {/* Student Self-view (Hidden Video + Sticky Label) */}
          <div className="absolute top-8 right-8 z-20">
            <video
              id="local-student-video"
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-1 h-1 opacity-0 pointer-events-none absolute"
            />
            <div className="bg-slate-950/90 px-4 py-2.5 rounded-full text-[11px] font-bold backdrop-blur-md flex items-center gap-2.5 border border-slate-800/60 shadow-xl text-slate-300">
               <span className="w-2 h-2 rounded-full bg-track-alert-amber animate-pulse shadow-[0_0_8px_#F59E0B]"></span>
               Real-time Monitoring is Active
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoGrid;

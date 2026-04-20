/* eslint-disable react-hooks/static-components */
/* eslint-disable react-hooks/set-state-in-effect */
/* eslint-disable @typescript-eslint/no-unused-expressions */
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useState, useRef } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { socket } from '../lib/socket';
import { auth } from '../lib/firebase';
import VideoGrid from '../components/VideoGrid';
import WarningPanel from '../components/WarningPanel';
import ChatPanel from '../components/ChatPanel';
import { LiveKitRoom, useLocalParticipant, RoomAudioRenderer } from '@livekit/components-react';
import { Mic, MicOff, Video as VideoIcon, VideoOff, Monitor, MonitorOff, Users, MessageSquare } from 'lucide-react';
import '@livekit/components-styles';

interface StudentState {
  id: string;
  socketId: string;
  name: string;
  score: number;
  lastDistraction: string | null;
  phoneDetected: boolean;
  tabHidden: boolean;
  warningCount: number;
}

import { IssueWarningModal } from '../components/IssueWarningModal';
import EndSessionModal from '../components/EndSessionModal';

const SessionControls = () => {
  const { isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled, localParticipant } = useLocalParticipant();
  // ... other hooks and states

  const toggleMic = async () => {
    await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
  };

  const toggleCamera = async () => {
    await localParticipant.setCameraEnabled(!isCameraEnabled);
  };

  const toggleScreenShare = async () => {
    await localParticipant.setScreenShareEnabled(!isScreenShareEnabled);
  };

  return (
    <div className="absolute bottom-4 sm:bottom-6 md:bottom-12 left-1/2 -translate-x-1/2 flex items-center gap-3 sm:gap-4 bg-slate-900/90 p-4 sm:p-3 rounded-2xl backdrop-blur-md border border-slate-700/50 shadow-2xl z-20 transition-all">
      <button 
        type="button"
        onClick={toggleMic}
        title={isMicrophoneEnabled ? "Mute Microphone" : "Unmute Microphone"}
        className={`p-3.5 rounded-xl flex items-center justify-center transition-all hover:scale-105 active:scale-95 ${isMicrophoneEnabled ? 'bg-slate-800 text-slate-200 hover:bg-slate-700' : 'bg-red-500/20 text-red-500 hover:bg-red-500/30 ring-1 ring-red-500/50'}`}
      >
        {isMicrophoneEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
      </button>
      
      <button 
        type="button"
        onClick={toggleCamera}
        title={isCameraEnabled ? "Turn Off Camera" : "Turn On Camera"}
        className={`p-3.5 rounded-xl flex items-center justify-center transition-all hover:scale-105 active:scale-95 ${isCameraEnabled ? 'bg-slate-800 text-slate-200 hover:bg-slate-700' : 'bg-red-500/20 text-red-500 hover:bg-red-500/30 ring-1 ring-red-500/50'}`}
      >
        {isCameraEnabled ? <VideoIcon className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
      </button>

      <button 
        type="button"
        onClick={toggleScreenShare}
        title={isScreenShareEnabled ? "Stop Sharing Screen" : "Share Screen"}
        className={`p-3.5 rounded-xl flex items-center justify-center transition-all hover:scale-105 active:scale-95 ${isScreenShareEnabled ? 'bg-track-teal text-slate-900 hover:bg-teal-400 shadow-[0_0_15px_rgba(45,212,191,0.4)]' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'}`}
      >
        {isScreenShareEnabled ? <MonitorOff className="w-5 h-5" /> : <Monitor className="w-5 h-5" />}
      </button>
    </div>
  );
};

const Session: React.FC = () => {
  const { code } = useParams();
  const [searchParams] = useSearchParams();
  const role = searchParams.get('role') || 'participant';
  const { user, userRole } = useAuth();
  const navigate = useNavigate();
  
  const isTeacher = userRole === 'teacher' || userRole === 'admin';
  
  const [status, setStatus] = useState<'joining' | 'waiting' | 'live' | 'error'>('joining');
  const [token, setToken] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [loadingTime, setLoadingTime] = useState(0);
  const [myScore, setMyScore] = useState(100);
  const [myIdentity, setMyIdentity] = useState<string | null>(null);

  // Sidebar tab state — teacher: 'roster' | 'chat', student: 'status' | 'chat'
  const [sidebarTab, setSidebarTab] = useState<'roster' | 'status' | 'chat'>('roster');
  const [unreadChat, setUnreadChat] = useState(0);
  // Chat messages lifted here so they survive ChatPanel unmount when switching tabs
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  
  // Use a ref for isEnding to avoid stale closure in setTimeout
  const isEndingRef = useRef(false);
  const [isEnding, setIsEnding] = useState(false);
  // Ref to read sidebarTab inside socket closures without stale closure issues
  const sidebarTabRef = useRef<string>(isTeacher ? 'roster' : 'status');

  // Roster tracking for Teacher UI
  const [roster, setRoster] = useState<Record<string, StudentState>>({});
  // Modal state for issuing warnings to a student
  const [warningModalStudent, setWarningModalStudent] = useState<StudentState | null>(null);
  // Modal state for confirming end session
  const [showEndSessionModal, setShowEndSessionModal] = useState(false);

  // Set initial tab based on role
  useEffect(() => {
    setSidebarTab(isTeacher ? 'roster' : 'status');
    sidebarTabRef.current = isTeacher ? 'roster' : 'status';
  }, [isTeacher]);

  // Keep sidebarTabRef in sync with sidebarTab state
  useEffect(() => {
    sidebarTabRef.current = sidebarTab;
  }, [sidebarTab]);

  useEffect(() => {
    if (status === 'joining') {
      const timer = setInterval(() => setLoadingTime(prev => prev + 1), 1000);
      return () => clearInterval(timer);
    }
  }, [status]);

  // Main session effect — IMPORTANT: myIdentity is intentionally excluded from deps
  // to prevent fetchToken() from re-running after identity is set.
  useEffect(() => {
    const socketUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';
    
    // 1. Connect to socket with logging
    if (!socket.connected) {
      console.info('📡 [Socket] Attempting connection to:', socketUrl);
      socket.connect();
    }

    const onConnect = () => console.log('📡 [Socket] Connected successfully!');
    const onConnectError = (err: any) => {
      console.error('❌ [Socket] Connection error:', err.message);
      setErrorMsg(`Real-time connection failed: ${err.message}. Please check if the server is running at ${socketUrl}`);
      setStatus('error');
    };

    socket.on('connect', onConnect);
    socket.on('connect_error', onConnectError);

    // Fetch LiveKit Token securely
    const fetchToken = async () => {
      try {
        let authHeader = '';
        const mockRole = localStorage.getItem('ts_mock_role');

        if (mockRole) {
          authHeader = `Bearer MOCK_${mockRole.toUpperCase()}`;
        } else {
          const currentUser = auth.currentUser;
          if (currentUser) {
            const idToken = await currentUser.getIdToken(true);
            authHeader = `Bearer ${idToken}`;
          } else {
             await new Promise(r => setTimeout(r, 1000));
             const retryUser = auth.currentUser;
             if (retryUser) {
               const idToken = await retryUser.getIdToken(true);
               authHeader = `Bearer ${idToken}`;
             }
          }
        }

        const fetchResponsePromise = fetch(`${socketUrl}/api/livekit/token?room=${code}&role=${role}`, {
          headers: { 'Authorization': authHeader }
        });
        
        const httpTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Backend HTTP Timeout - Database is cold booting')), 60000));

        const response: any = await Promise.race([fetchResponsePromise, httpTimeout]);
        const data = await response.json();
        
        if (response.ok && data.token) {
          if (!socket.connected) {
             console.warn('📡 [Socket] Not connected yet, waiting...');
             await new Promise<void>(resolve => {
                const handler = () => resolve();
                socket.once('connect', handler);
                setTimeout(handler, 2000);
             });
          }

          console.info('📡 [Socket] Emitting join_session for:', code);
          socket.emit('join_session', { sessionId: code, role: role, displayName: data.name, studentId: data.identity });
          
          setToken(data.token);
          setMyIdentity(data.identity);
          setStatus('live');
        } else {
          setErrorMsg(data.error || 'Unauthorized to join room.');
          setStatus('error');
        }
      } catch (e: any) {
        console.error("Failed to fetch token", e);
        setErrorMsg(`Failed to connect: ${e.message}`);
        setStatus('error');
      }
    };
    
    fetchToken();

    // Chat message handler — registered here (not in a separate [status] effect)
    // so it survives React StrictMode's forced unmount+remount cycle.
    const handleIncomingChat = (msg: any) => {
      setChatMessages(prev => [...prev, msg]);
      // Use ref to read sidebarTab without stale closure
      if (sidebarTabRef.current !== 'chat') {
        setUnreadChat(n => n + 1);
      }
    };
    socket.on('ts:chat_message', handleIncomingChat);

    // -- Event Listeners for Teacher Roster --
    if (isTeacher) {
      const handleStudentJoined = (data: any) => {
        setRoster(prev => ({
          ...prev,
          [data.studentId]: {
            id: data.studentId,
            socketId: data.socketId,
            name: data.displayName,
            score: 100,
            lastDistraction: null,
            phoneDetected: false,
            tabHidden: false,
            warningCount: 0
          }
        }));
      };

      const handleStudentLeft = (data: any) => {
        setRoster(prev => {
          const next = { ...prev };
          delete next[data.studentId];
          return next;
        });
      };

      const handleStudentAlert = (data: any) => {
        setRoster(prev => {
          if (!prev[data.studentId]) return prev;
          const nextState = { ...prev[data.studentId] };
          
          if (data.alertType === 'distraction') nextState.lastDistraction = data.type;
          else if (data.alertType === 'distraction_cleared') nextState.lastDistraction = null;
          else if (data.alertType === 'phone_detected') nextState.phoneDetected = true;
          else if (data.alertType === 'phone_cleared') nextState.phoneDetected = false;
          else if (data.alertType === 'tab_switch') nextState.tabHidden = true;
          else if (data.alertType === 'tab_return') nextState.tabHidden = false;
          else if (data.alertType === 'complied') {
            nextState.phoneDetected = false;
            nextState.lastDistraction = null;
            nextState.tabHidden = false;
          }
          
          if (data.warningCount !== undefined) {
            nextState.warningCount = data.warningCount;
          }
          
          return { ...prev, [data.studentId]: nextState };
        });
      };

      const handleAttentionUpdate = (data: any) => {
        setRoster(prev => {
          if (!prev[data.studentId]) return prev;
          const penalty = (data.warningCount || 0) * 5;
          const adjustedScore = Math.max(0, data.score - penalty);
          return { 
            ...prev, 
            [data.studentId]: { 
              ...prev[data.studentId], 
              score: adjustedScore,
              warningCount: data.warningCount || 0
            } 
          };
        });
      };
      
      const handleInitialRoster = (currentRoster: Record<string, any>) => {
        console.info('📡 [Socket] Received initial roster sync:', Object.keys(currentRoster).length, 'participants');
        const formattedRoster: Record<string, StudentState> = {};
        Object.entries(currentRoster).forEach(([sid, data]: [string, any]) => {
          formattedRoster[sid] = {
            id: sid,
            socketId: data.socketId,
            name: data.displayName,
            score: data.score || 100,
            lastDistraction: data.lastDistraction || null,
            phoneDetected: false,
            tabHidden: false,
            warningCount: data.warningCount || 0
          };
        });
        setRoster(formattedRoster);
      };

      const handleSessionEnded = () => { navigate('/dashboard'); };

      socket.on('ts:student_joined', handleStudentJoined);
      socket.on('ts:student_left', handleStudentLeft);
      socket.on('ts:student_alert', handleStudentAlert);
      socket.on('ts:attention_update', handleAttentionUpdate);
      socket.on('ts:initial_roster', handleInitialRoster);
      socket.on('ts:session_ended', handleSessionEnded);

      return () => {
        socket.off('ts:student_joined', handleStudentJoined);
        socket.off('ts:student_left', handleStudentLeft);
        socket.off('ts:student_alert', handleStudentAlert);
        socket.off('ts:attention_update', handleAttentionUpdate);
        socket.off('ts:initial_roster', handleInitialRoster);
        socket.off('ts:session_ended', handleSessionEnded);
        socket.off('ts:chat_message', handleIncomingChat);
        socket.off('connect', onConnect);
        socket.off('connect_error', onConnectError);
        socket.disconnect();
      };
    } else {
      // Student listeners
      const handleAttentionUpdate = (data: any) => {
        const penalty = (data.warningCount || 0) * 5;
        const adjustedScore = Math.max(0, data.score - penalty);
        setMyScore(adjustedScore);
      };

      const handleSessionEnded = () => { navigate('/student-dashboard'); };

      socket.on('ts:attention_update', handleAttentionUpdate);
      socket.on('ts:session_ended', handleSessionEnded);

      return () => {
        socket.off('ts:attention_update', handleAttentionUpdate);
        socket.off('ts:session_ended', handleSessionEnded);
        socket.off('ts:chat_message', handleIncomingChat);
        socket.off('connect', onConnect);
        socket.off('connect_error', onConnectError);
        socket.disconnect();
      };
    }
   
  }, [code, role, user, isTeacher, navigate]);

  // Tab & Window Focus Tracking for Students
  useEffect(() => {
    if (isTeacher || status !== 'live') return;

    let switchStart = 0;
    let isAway = false;

    const handleHide = () => {
      if (isAway) return;
      isAway = true;
      switchStart = Date.now();
      socket.emit('ts:tab_switch', { timestamp: switchStart });
    };

    const handleShow = () => {
      if (!isAway) return;
      isAway = false;
      if (switchStart > 0) {
        const durationAwayMs = Date.now() - switchStart;
        socket.emit('ts:tab_return', { durationAwayMs, timestamp: Date.now() });
        switchStart = 0;
      }
    };

    const onVisibilityChange = () => {
      document.visibilityState === 'hidden' ? handleHide() : handleShow();
    };

    window.addEventListener('blur', handleHide);
    window.addEventListener('focus', handleShow);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('blur', handleHide);
      window.removeEventListener('focus', handleShow);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [isTeacher, status]);

  if (status === 'joining' || status === 'waiting' || status === 'error') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-white">
        {status !== 'error' && (
          <div className="w-12 h-12 border-4 border-track-teal border-t-transparent rounded-full animate-spin mb-6"></div>
        )}
        <h2 className={`text-2xl font-bold mb-2 ${status === 'error' ? 'text-track-alert-red' : ''}`}>
          {status === 'joining' && 'Connecting to secure room...'}
          {status === 'waiting' && 'Waiting for teacher to admit you...'}
          {status === 'error' && 'Access Denied'}
        </h2>
        {status === 'error' ? (
          <p className="text-slate-400 max-w-md text-center bg-slate-950 p-4 rounded-xl mt-4 border border-red-900">{errorMsg}</p>
        ) : (
          <div className="text-center">
             <p className="text-slate-400">Room Code: {code}</p>
             {status === 'joining' && loadingTime > 4 && (
                <p className="text-amber-400 text-sm mt-4 max-w-sm font-medium animate-pulse">
                  Waking up the cloud database. This can take up to 40 seconds on the first launch of the day...
                </p>
             )}
          </div>
        )}
      </div>
    );
  }

  const handleEndSession = () => {
    // Open the custom confirmation modal instead of native confirm
    setShowEndSessionModal(true);
  };

  const handleConfirmEndSession = () => {
    setShowEndSessionModal(false);
    isEndingRef.current = true;
    setIsEnding(true);
    console.info('📡 [Socket] Emitting ts:end_session');
    socket.emit('ts:end_session');
    setTimeout(() => {
      if (isEndingRef.current) {
        console.warn('📡 [Socket] End session timeout. Forcing navigation.');
        navigate('/dashboard');
      }
    }, 3000);
  };

  const handleIssueWarningClick = (student: StudentState) => {
    setWarningModalStudent(student);
  };

  const handleIssueWarningSubmit = (message: string) => {
    if (warningModalStudent && message) {
      socket.emit('ts:issue_warning', {
        studentSocketId: warningModalStudent.socketId,
        studentId: warningModalStudent.id,
        message
      });
      setWarningModalStudent(null);
    }
  };
  // Sidebar tab switcher shared component
  const SidebarTabs = ({ tabs }: { tabs: { key: string; label: string; icon: React.ReactNode }[] }) => (
    <div className="flex border-b border-slate-200 dark:border-slate-800 shrink-0">
      {tabs.map(tab => (
        <button
          key={tab.key}
          onClick={() => {
            setSidebarTab(tab.key as any);
            if (tab.key === 'chat') setUnreadChat(0);
          }}
          className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-bold transition-all relative ${
            sidebarTab === tab.key
              ? 'text-track-teal border-b-2 border-track-teal -mb-px bg-track-teal/5'
              : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
          }`}
        >
          {tab.icon}
          {tab.label}
          {tab.key === 'chat' && unreadChat > 0 && sidebarTab !== 'chat' && (
            <span className="absolute top-2 right-3 bg-track-alert-red text-white text-[9px] font-black w-4 h-4 rounded-full flex items-center justify-center animate-pulse">
              {unreadChat > 9 ? '9+' : unreadChat}
            </span>
          )}
        </button>
      ))}
    </div>
  );

  // Live Session View
  return (
    <LiveKitRoom
      video={true}
      audio={true}
      token={token!}
      serverUrl={import.meta.env.VITE_LIVEKIT_URL}
      connect={true}
      data-lk-theme="default"
      className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col md:flex-row w-full transition-colors duration-300"
    >
      <RoomAudioRenderer />
      {/* Video Grid Area */}
      <div className="flex-1 p-4 flex flex-col min-w-0">
        <header className="px-6 py-4 flex justify-between items-center bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-sm z-30 transition-colors rounded-2xl mb-4">
          <div className="flex gap-4 items-center">
            <h2 className="text-xl font-bold text-slate-800 dark:text-white">Class Session</h2>
            <span className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-3 py-1 rounded-md text-sm font-mono tracking-widest border border-slate-200 dark:border-slate-700 shadow-inner">{code}</span>
          </div>
          <div className="flex items-center gap-3">
            <button 
              className={`${isEnding ? 'bg-slate-600' : 'bg-track-alert-red hover:bg-red-600'} px-4 py-2 rounded-lg font-medium transition-all text-sm flex items-center gap-2 text-white shadow-lg shadow-red-500/20`} 
              onClick={isTeacher ? handleEndSession : () => navigate('/student-dashboard')}
              disabled={isEnding}
            >
            {isEnding ? (
              <>
                <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                Ending...
              </>
            ) : (
              isTeacher ? 'End Session' : 'Leave Room'
            )}
            </button>
          </div>
        </header>
        
        <div className="bg-slate-100 dark:bg-slate-950 p-4 md:p-8 h-[60vh] md:flex-1 flex flex-col overflow-hidden relative">
          <div className="bg-slate-900 rounded-3xl flex-1 border border-slate-800 dark:border-slate-700/50 flex items-center justify-center relative shadow-2xl overflow-hidden ring-4 ring-slate-200 dark:ring-slate-900">
            <VideoGrid isTeacher={isTeacher} />
            <SessionControls />
          </div>
        </div>
      </div>

      {/* Sidebar */}
      <div className="w-full md:w-80 border-t md:border-t-0 md:border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col transition-colors overflow-hidden">
        {isTeacher ? (
          <>
            {/* Teacher Tabs: Roster | Chat */}
            <SidebarTabs tabs={[
              { key: 'roster', label: 'Roster', icon: <Users className="w-3.5 h-3.5" /> },
              { key: 'chat',   label: 'Chat',   icon: <MessageSquare className="w-3.5 h-3.5" /> },
            ]} />

            {/* Teacher — Roster panel */}
            {sidebarTab === 'roster' && (
              <div className="p-4 flex-1 overflow-y-auto">
                <h3 className="font-bold text-slate-700 dark:text-slate-200 mb-4 flex items-center gap-2 text-sm">
                  <span className="w-2 h-2 rounded-full bg-track-teal animate-pulse"></span> Real-time Roster Monitor
                </h3>
                <div className="space-y-3">
                  {Object.values(roster).length === 0 ? (
                    <div className="text-center py-10 opacity-50">
                      <div className="w-10 h-10 border-2 border-slate-700 border-t-track-teal rounded-full animate-spin mx-auto mb-3"></div>
                      <p className="text-sm">Waiting for students to connect...</p>
                    </div>
                  ) : Object.values(roster).map((student) => {
                    const isCritical = student.phoneDetected || student.tabHidden || student.score < 50;
                    const isWarning = student.score < 80 && !isCritical;
                    
                    let borderClass = 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 hover:border-track-teal dark:hover:border-track-teal';
                    if (isCritical) borderClass = 'border-track-alert-red bg-track-alert-red/10 shadow-[0_0_15px_rgba(255,71,87,0.3)_inset]';
                    else if (isWarning) borderClass = 'border-track-alert-amber bg-track-alert-amber/10';
                    if (student.phoneDetected) {
                      borderClass = 'border-red-500 bg-red-500/10 shadow-[0_0_20px_rgba(239,68,68,0.4)] animate-pulse';
                    }

                    return (
                      <div key={student.id} className={`p-4 rounded-xl border transition-all duration-300 ${borderClass} relative overflow-hidden group shadow-sm`}>
                        {student.phoneDetected && (
                          <div className="absolute top-0 right-0 p-1 bg-red-500 text-white rounded-bl-lg animate-bounce z-20">
                             <span className="text-[10px] font-black px-1">PHONE ACTIVE</span>
                          </div>
                        )}
                        <div className="flex justify-between items-start mb-2">
                          <p className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                            {student.name}
                            {student.warningCount > 0 && (
                              <span className="flex gap-0.5">
                                 {[...Array(Math.min(3, student.warningCount))].map((_, i) => (
                                   <span key={i} className="w-1.5 h-1.5 rounded-full bg-track-alert-red shadow-[0_0_5px_rgba(255,71,87,0.5)]"></span>
                                 ))}
                                 {student.warningCount > 3 && <span className="text-[10px] text-red-500 font-black">+{student.warningCount - 3}</span>}
                              </span>
                            )}
                          </p>
                          <div className="flex flex-col items-end">
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${isCritical ? 'bg-red-500/20 text-red-400' : isWarning ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                              {student.score}%
                            </span>
                            <span className="text-[9px] text-slate-500 font-bold mt-1 uppercase tracking-tighter">{student.warningCount} Warnings</span>
                          </div>
                        </div>
                        <div className="text-xs space-y-1 mt-3 h-10 font-bold">
                          {student.phoneDetected && <p className="text-red-500 animate-pulse flex items-center gap-1">🚨 [CRITICAL] PHONE DETECTED</p>}
                          {student.tabHidden && <p className="text-red-400">🚨 Tab Switched Away</p>}
                          {student.lastDistraction === 'no_face' && !student.tabHidden && !student.phoneDetected && <p className="text-amber-400">Camera blocked / Walking away</p>}
                          {student.lastDistraction === 'looking_away' && !student.phoneDetected && <p className="text-amber-400">Looking away from screen</p>}
                          {student.score === 100 && !student.phoneDetected && !student.tabHidden && <p className="text-emerald-400">Focused</p>}
                        </div>
                        {isCritical && (
                          <button 
                            onClick={() => handleIssueWarningClick(student)}
                            className="w-full mt-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-bold rounded flex items-center justify-center gap-1 transition-colors"
                          >
                            Issue Strike Warning
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Teacher — Chat panel */}
            {sidebarTab === 'chat' && (
              <ChatPanel
                myIdentity={myIdentity}
                sessionId={code}
                role={role}
                messages={chatMessages}
              />
            )}
          </>
        ) : (
          <>
            {/* Student Tabs: Status | Chat */}
            <SidebarTabs tabs={[
              { key: 'status', label: 'My Status', icon: <Users className="w-3.5 h-3.5" /> },
              { key: 'chat',   label: 'Chat',      icon: <MessageSquare className="w-3.5 h-3.5" /> },
            ]} />

            {/* Student — Warning / status panel */}
            {sidebarTab === 'status' && (
              <WarningPanel score={myScore} myIdentity={myIdentity} />
            )}

            {/* Student — Chat panel */}
            {sidebarTab === 'chat' && (
              <ChatPanel
                myIdentity={myIdentity}
                sessionId={code}
                role={role}
                messages={chatMessages}
              />
            )}
          </>
        )}
      </div>

      {warningModalStudent && (
        <IssueWarningModal
          studentName={warningModalStudent.name}
          isOpen={!!warningModalStudent}
          onClose={() => setWarningModalStudent(null)}
          onSubmit={handleIssueWarningSubmit}
        />
      )}
      <EndSessionModal
        isOpen={showEndSessionModal}
        isProcessing={isEnding}
        onClose={() => setShowEndSessionModal(false)}
        onConfirm={handleConfirmEndSession}
      />
    </LiveKitRoom>
  );
};

export default Session;

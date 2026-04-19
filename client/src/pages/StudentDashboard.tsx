/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
    Hash, 
    Loader2, 
    Clock, 
    LogOut,
    User as UserIcon,
    ChevronRight,
    Settings
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { db } from '../lib/firebase';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  getDoc, 
  doc
} from 'firebase/firestore';

const StudentDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user, userFullName, signOut } = useAuth();
  
  const [roomCode, setRoomCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [history, setHistory] = useState<any[]>([]);


  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    const fetchStudentData = async () => {
      try {
        setLoading(true);
        // 1. Fetch joined events to find history
        const eventsQuery = query(
          collection(db, 'session_events'),
          where('student_id', '==', user.id),
          where('event_type', '==', 'student_joined')
        );
        
        const eventsSnapshot = await getDocs(eventsQuery);
        const sessionIds = Array.from(new Set(eventsSnapshot.docs.map(d => d.data().session_id)));
        
        // 2. Fetch session details for those IDs
        const sessionDetails = await Promise.all(
          sessionIds.map(async (sid) => {
            const sDoc = await getDoc(doc(db, 'sessions', sid));
            return sDoc.exists() ? { id: sDoc.id, ...sDoc.data() } : null;
          })
        );
        
        const validSessions = sessionDetails.filter(s => s !== null);
        validSessions.sort((a: any, b: any) => {
          const tA = a.created_at?.toMillis ? a.created_at.toMillis() : 0;
          const tB = b.created_at?.toMillis ? b.created_at.toMillis() : 0;
          return tB - tA;
        });
        setHistory(validSessions);



      } catch (err) {
        console.error("Failed to fetch student dashboard data:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchStudentData();
  }, [user]);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (roomCode.length !== 6) return;
    
    setError('');
    setJoining(true);

    try {
      // 1. Just find the session by room code (index-free equality query)
      const q = query(
        collection(db, 'sessions'),
        where('room_code', '==', roomCode.toUpperCase())
      );
      
      const querySnapshot = await getDocs(q);
      
      if (querySnapshot.empty) {
        setError('Invalid room code. Please check with your teacher.');
        setJoining(false);
        return;
      }

      const sessionData = querySnapshot.docs[0].data();
      
      // 2. Check status locally to avoid requiring composite indexes
      if (sessionData.status === 'ended') {
        setError('This session has already ended.');
        setJoining(false);
        return;
      }

      navigate(`/room/${roomCode.toUpperCase()}?role=participant`);
    } catch (err: any) {
      console.error("Join failed:", err);
      setError("Failed to verify room. Please try again.");
      setJoining(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-track-teal animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Navbar */}
      <nav className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 py-4 flex justify-between items-center sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl overflow-hidden flex items-center justify-center shadow-lg shadow-track-teal/20">
            <img src="/tracksmart.jpg" alt="TrackSmart" className="w-full h-full object-cover" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-track-navy dark:text-slate-100">Student Dashboard</h1>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 font-bold tracking-widest uppercase">Learning Portal</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => navigate('/profile')}
            className="flex items-center gap-2 text-slate-400 hover:text-track-teal transition-colors font-bold text-sm bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700 hover:bg-slate-100 p-2 rounded-xl border border-transparent"
          >
            <Settings className="w-5 h-5" />
          </button>
          <button 
            onClick={() => { signOut(); navigate('/auth'); }}
            className="flex items-center gap-2 text-slate-400 hover:text-track-alert-red transition-colors font-bold text-sm bg-slate-50 hover:bg-red-50 p-2 rounded-xl border border-transparent"
          >
            <span className="hidden sm:inline">Sign Out</span>
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </nav>

      <main className="flex-1 max-w-6xl w-full mx-auto p-6 md:p-8 space-y-8">
        
        {/* Welcome & Join Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Welcome Card */}
          <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-3xl p-8 border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden flex flex-col md:flex-row items-center justify-between min-h-55 gap-6">
            <div className="absolute top-0 right-0 w-48 h-48 bg-track-teal/5 dark:bg-track-teal/10 rounded-bl-[100px] -z-10"></div>
            <div className="flex-1">
              <div className="flex items-center gap-4 mb-4">
                 <div className="w-12 h-12 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center text-track-teal shadow-inner">
                   <UserIcon size={24} />
                 </div>
                 <h2 className="text-3xl font-bold text-track-navy dark:text-slate-100 tracking-tight">Hi, {userFullName?.split(' ')[0] || 'Student'}!</h2>
              </div>
              <p className="text-slate-500 dark:text-slate-400 text-lg max-w-md">Ready for your next learning session? Enter your teacher's code to get started.</p>
            </div>
            

          </div>

          {/* Join Session Card */}
          <div className="bg-slate-900 rounded-3xl p-6 md:p-8 border border-slate-800 shadow-xl shadow-track-navy/20 text-white flex flex-col justify-center transform transition-transform hover:scale-[1.01]">
            <h3 className="text-lg md:text-xl font-bold mb-4 md:mb-6 flex items-center gap-2">
              <Hash className="text-track-teal w-5 h-5" />
              Join a Class
            </h3>
            
            <form onSubmit={handleJoin} className="space-y-3 md:space-y-4">
              <div className="relative">
                <input
                  type="text"
                  required
                  maxLength={6}
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  className="w-full pl-4 pr-4 py-3 md:py-4 bg-white/5 border border-white/10 rounded-2xl focus:ring-2 focus:ring-track-teal focus:border-track-teal outline-none transition-all placeholder:text-slate-600 font-mono tracking-[0.3em] uppercase font-bold text-xl md:text-2xl text-center"
                  placeholder="CODE"
                />
              </div>

              {error && (
                <p className="text-track-alert-red text-xs font-bold text-center px-2">{error}</p>
              )}

              <button
                type="submit"
                disabled={joining || roomCode.length < 6}
                className="w-full bg-track-teal hover:bg-teal-400 text-slate-900 font-bold py-3 md:py-4 rounded-2xl transition-all shadow-lg shadow-track-teal/20 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2 text-sm md:text-base mt-4 md:mt-6"
              >
                {joining ? <Loader2 className="animate-spin w-5 h-5 text-slate-900" /> : 'Enter Room'}
              </button>
            </form>
          </div>
        </div>



        {/* History Section */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-bold text-track-navy dark:text-slate-100 flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Recent Class History
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {history.length === 0 ? (
               <div className="col-span-full py-12 bg-white dark:bg-slate-900 rounded-3xl border border-dashed border-slate-300 dark:border-slate-800 text-center flex flex-col items-center">
                  <div className="w-12 h-12 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center text-slate-300 dark:text-slate-700 mb-4">
                    <Clock size={24} />
                  </div>
                  <p className="text-slate-400 dark:text-slate-600 font-medium">No previous classes recorded yet.</p>
               </div>
            ) : history.map((session) => (
              <div key={session.id} className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md dark:hover:shadow-track-navy/20 transition-all group cursor-default">
                <div className="flex justify-between items-start">
                  <div>
                    <h5 className="font-bold text-lg text-track-navy dark:text-slate-100 group-hover:text-track-teal transition-colors">
                      {session.title || 'Untitled Session'}
                    </h5>
                    <div className="flex items-center gap-3 mt-2 text-xs text-slate-500 dark:text-slate-400 font-medium tracking-tight">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {session.created_at && new Date(session.created_at.toMillis ? session.created_at.toMillis() : session.created_at).toLocaleDateString()}
                      </span>
                      <span className="w-1 h-1 bg-slate-300 dark:bg-slate-700 rounded-full"></span>
                      <span className="font-mono bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-track-navy/70 dark:text-slate-300">
                        Code: {session.room_code}
                      </span>
                    </div>
                  </div>
                  <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded-full text-slate-300 dark:text-slate-600 group-hover:bg-track-teal/10 group-hover:text-track-teal transition-all">
                    <ChevronRight size={20} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
};

export default StudentDashboard;

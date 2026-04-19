import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Video, Clock, LayoutDashboard, LogOut, Shield, ChevronDown, Link, Copy, Check, X, Settings, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { db } from '../lib/firebase';
import { collection, query, where, getDocs, addDoc, deleteDoc, doc } from 'firebase/firestore';

const Dashboard: React.FC = () => {
  const { user, signOut, userRole, userFullName } = useAuth();
  const navigate = useNavigate();
  const [isCreating, setIsCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirmModal, setDeleteConfirmModal] = useState<{ id: string; title: string } | null>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [className, setClassName] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [newLink, setNewLink] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    const fetchSessions = async () => {
      try {
        const q = query(
          collection(db, 'sessions'), 
          where('teacher_id', '==', user.id)
        );
        
        const querySnapshot = await getDocs(q);
        const fetchedSessions = querySnapshot.docs.map(doc => ({
           id: doc.id,
           ...doc.data()
        }));

        // Sort manually for now since Firebase requires a composite index to order by created_at alongside a filtering where statement
        fetchedSessions.sort((a: any, b: any) => {
           if (!a.created_at || !b.created_at) return 0;
           return b.created_at.toMillis() - a.created_at.toMillis();
        });

        setSessions(fetchedSessions);
      } catch (err) {
        console.error("Failed to fetch sessions from Firestore:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchSessions();
  }, [user]);

  const handleStartSession = async () => {
    setIsCreating(true);
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const title = className.trim() || `Class Session - ${new Date().toLocaleDateString()}`;

    try {
      if (!user) {
        setError("You must be signed in to start a session.");
        setIsCreating(false);
        return;
      }
      await addDoc(collection(db, 'sessions'), {
        teacher_id: user.id,
        room_code: code,
        title: title,
        status: 'waiting',
        created_at: new Date()
      });
      
      navigate(`/room/${code}?role=host`);
    } catch (e) {
      console.error("Session Insert Failed:", e);
      setIsCreating(false);
    }
  };

  const handleCreateLater = async () => {
    setIsCreating(true);
    setShowMenu(false);
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const title = className.trim() || `Class Session - ${new Date().toLocaleDateString()}`;

    try {
      if (!user) {
        setError("You must be signed in to create a session.");
        setIsCreating(false);
        return;
      }
      await addDoc(collection(db, 'sessions'), {
        teacher_id: user.id,
        room_code: code,
        title: title,
        status: 'waiting',
        created_at: new Date()
      });
      
      const shareUrl = `${window.location.origin}/room/${code}`;
      setNewLink(shareUrl);
      setShowLinkModal(true);
      
      // Refresh local sessions list
      setSessions(prev => [{
        id: 'new',
        teacher_id: user.id,
        room_code: code,
        title: title,
        status: 'waiting',
        created_at: new Date()
      }, ...prev]);

    } catch (e) {
      console.error("Session Creation Failed:", e);
    } finally {
      setIsCreating(false);
    }
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(newLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy!', err);
    }
  };

  const handleDeleteSession = async (sessionId: string, sessionTitle: string) => {
    setDeleteConfirmModal({ id: sessionId, title: sessionTitle });
  };

  const confirmDelete = async () => {
    if (!deleteConfirmModal) return;

    try {
      setDeletingId(deleteConfirmModal.id);
      console.log('🗑️ Attempting to delete session:', deleteConfirmModal.id);
      await deleteDoc(doc(db, 'sessions', deleteConfirmModal.id));
      console.log('✅ Session deleted successfully from Firestore');
      setSessions(prev => prev.filter(s => s.id !== deleteConfirmModal.id));
      setError(null);
      setDeleteConfirmModal(null);
    } catch (err: any) {
      console.error('❌ Failed to delete session:', err);
      console.error('Error code:', err.code);
      console.error('Error message:', err.message);
      
      let errorMsg = 'Failed to delete session. Please try again.';
      if (err.code === 'permission-denied') {
        errorMsg = 'Permission denied. Make sure you are the session creator. Did you deploy the Firestore rules?';
      } else if (err.code === 'not-found') {
        errorMsg = 'Session not found. It may have already been deleted.';
      }
      
      setError(errorMsg);
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center">
          <div className="w-10 h-10 border-4 border-track-teal border-t-transparent rounded-full animate-spin"></div>
          <p className="mt-4 text-slate-500 font-medium">Loading your history...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Navbar */}
      <nav className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-10 px-6 py-4 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 bg-track-navy dark:bg-slate-800 rounded-xl flex items-center justify-center shadow-inner">
            <LayoutDashboard className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-track-navy dark:text-slate-100">Dashboard</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium tracking-wide">TEACHER PORTAL</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {userRole === 'admin' && (
            <button
              onClick={() => navigate('/admin')}
              className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 transition-colors bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 p-2.5 rounded-xl border border-transparent flex items-center gap-2 group"
            >
              <Shield className="w-5 h-5 group-hover:text-slate-900 dark:group-hover:text-slate-100 transition-colors" />
              <span className="text-sm font-bold hidden md:inline">Admin System</span>
            </button>
          )}

          <button
            onClick={() => navigate('/profile')}
            className="text-slate-500 hover:text-slate-900 transition-colors bg-slate-50 hover:bg-slate-100 p-2.5 rounded-xl border border-transparent flex items-center gap-2"
          >
            <Settings className="w-5 h-5" />
          </button>
          <button
            onClick={() => { signOut(); navigate('/auth'); }}
            className="text-slate-500 hover:text-red-500 transition-colors bg-slate-50 hover:bg-red-50 p-2.5 rounded-xl border border-transparent shadow-sm hover:border-red-100 flex items-center gap-2"
          >
            <span className="text-sm font-semibold hidden md:inline">Sign Out</span>
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-8">
        
        {/* Welcome Section */}
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-track-alert-red/10 border border-track-alert-red/20 flex items-start gap-3 text-track-alert-red">
            <div className="mt-0.5 font-bold">⚠️</div>
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 p-8 mb-8 relative">
          {/* Decorative background clipped layer */}
          <div className="absolute inset-0 overflow-hidden rounded-2xl pointer-events-none z-0">
             <div className="absolute top-0 right-0 w-64 h-64 bg-track-teal/5 dark:bg-track-teal/10 rounded-bl-full"></div>
          </div>
          
          <div className="relative z-10">
            <h2 className="text-3xl font-bold text-slate-800 dark:text-slate-100 tracking-tight">Welcome back, {userFullName || 'Teacher'}!</h2>
            <p className="text-slate-500 dark:text-slate-400 mt-2 text-lg">You have {sessions.length} recorded sessions.</p>
          </div>
            
          <div className="relative z-10 mt-8 max-w-md">
            <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2 ml-1">Today's Class / Topic</label>
              <div className="flex flex-col md:flex-row gap-3">
                <input 
                  type="text"
                  placeholder="e.g. Math 101: Calculus Basics"
                  value={className}
                  onChange={(e) => setClassName(e.target.value)}
                  className="flex-1 px-4 py-3.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-track-teal focus:border-track-teal outline-none transition-all placeholder:text-slate-400 dark:placeholder:text-slate-600 font-medium text-track-navy dark:text-slate-100"
                />
                <div className="relative">
                  <button
                    onClick={() => setShowMenu(!showMenu)}
                    disabled={isCreating}
                    className="bg-track-teal hover:bg-teal-400 text-white shadow-lg shadow-track-teal/30 hover:shadow-track-teal/40 transition-all font-bold py-3.5 px-6 rounded-xl flex items-center justify-center gap-3 active:scale-95 disabled:opacity-50"
                  >
                    {isCreating ? (
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    ) : (
                      <Video className="w-5 h-5" />
                    )}
                    <span className="whitespace-nowrap">New Session</span>
                    <ChevronDown className={`w-4 h-4 transition-transform ${showMenu ? 'rotate-180' : ''}`} />
                  </button>

                  {/* Meet-style Dropdown Menu */}
                  {showMenu && (
                    <>
                      <div 
                        className="fixed inset-0 z-20" 
                        onClick={() => setShowMenu(false)}
                      ></div>
                      <div className="absolute right-0 md:left-0 top-full mt-2 w-72 bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-100 dark:border-slate-800 py-2 z-30 animate-in fade-in slide-in-from-top-2 duration-200">
                        <button
                          onClick={handleCreateLater}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors text-left"
                        >
                          <Link className="w-5 h-5 text-slate-400 dark:text-slate-500" />
                          <span className="text-sm font-medium">Create Meeting for Later</span>
                        </button>
                        <button
                          onClick={handleStartSession}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors text-left"
                        >
                          <Plus className="w-5 h-5 text-slate-400 dark:text-slate-500" />
                          <span className="text-sm font-medium">Create Instant Session</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
              <p className="text-slate-400 dark:text-slate-500 text-xs mt-3 ml-1 italic">Leave blank to use a generic date-based title.</p>
          </div>
        </div>
        

        {/* Previous Sessions */}
        <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-6 flex items-center gap-2 tracking-tight">
          <Clock className="w-5 h-5 text-track-navy dark:text-track-teal" />
          Session History
        </h3>

        {sessions.length === 0 ? (
          <div className="text-center py-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 border-dashed rounded-2xl shadow-sm">
            <Video className="w-12 h-12 text-slate-300 dark:text-slate-700 mx-auto mb-4" />
            <p className="text-slate-500 dark:text-slate-400 text-lg font-medium">No sessions created yet.</p>
            <p className="text-slate-400 dark:text-slate-600 text-sm mt-1">Start a new session to begin tracking student attention.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {sessions.map((session) => (
              <div key={session.id} className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-800 hover:shadow-md dark:hover:shadow-track-navy/20 transition-shadow relative overflow-hidden group">
                <div className="absolute top-0 left-0 w-1 h-full bg-track-navy dark:bg-track-teal group-hover:w-2 transition-all"></div>
                <div className="flex justify-between items-start mb-4">
                  <h4 className="font-bold text-lg text-slate-800 dark:text-slate-100">{session.title}</h4>
                  <span className={`text-xs px-3 py-1 rounded-full font-bold uppercase tracking-wider shadow-sm ${
                    session.status === 'live' ? 'bg-track-alert-red/10 text-track-alert-red border border-track-alert-red/20' : 
                    session.status === 'waiting' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/50' :
                    'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
                  }`}>
                    {session.status}
                  </span>
                </div>
                
                <div className="space-y-3">
                   <p className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-2">
                     <span className="w-5 flex justify-center"><Clock className="w-4 h-4" /></span>
                     {session.created_at && new Date(session.created_at.toMillis ? session.created_at.toMillis() : session.created_at).toLocaleString()}
                   </p>
                   <p className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-2">
                     <span className="w-5 flex justify-center font-mono font-bold">#</span>
                     Code: <span className="font-mono bg-slate-100 dark:bg-slate-800 px-2 rounded text-slate-700 dark:text-slate-300 font-bold">{session.room_code}</span>
                   </p>
                </div>
                
                <div className="mt-6 flex gap-3">
                  {session.status !== 'ended' && (
                    <button
                      onClick={() => navigate(`/room/${session.room_code}?role=host`)}
                      className="flex-1 bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-white text-white dark:text-slate-900 py-2.5 rounded-lg text-sm font-semibold transition-colors shadow-sm active:scale-95"
                    >
                      Rejoin
                    </button>
                  )}
                  <button
                    onClick={() => navigate(`/sessions/${session.id}/report`)}
                    className="flex-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-300 py-2.5 rounded-lg text-sm font-semibold transition-colors shadow-sm active:scale-95"
                  >
                    View Report
                  </button>
                  <button
                    onClick={() => handleDeleteSession(session.id, session.title)}
                    disabled={deletingId === session.id}
                    className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 p-2.5 rounded-lg transition-colors shadow-sm active:scale-95 disabled:opacity-50 flex items-center justify-center"
                    title="Delete session"
                  >
                    {deletingId === session.id ? (
                      <div className="w-4 h-4 border-2 border-red-600 border-t-transparent rounded-full animate-spin"></div>
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Share Link Modal */}
      {showLinkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden transform animate-in zoom-in-95 duration-300">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-track-navy dark:text-slate-100">Here's the link to your meeting</h2>
                <button 
                  onClick={() => setShowLinkModal(false)}
                  className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-slate-400 dark:text-slate-500" />
                </button>
              </div>

              <p className="text-slate-500 dark:text-slate-400 text-sm mb-4 leading-relaxed">
                Copy this link and send it to your students. They can use it to join the class at any time.
              </p>

              <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 flex items-center justify-between border border-slate-200 dark:border-slate-700 gap-3 group">
                <span className="text-track-navy dark:text-slate-200 font-medium truncate text-sm">
                  {newLink}
                </span>
                <button
                  onClick={copyToClipboard}
                  className={`shrink-0 p-2 rounded-lg transition-all ${
                    copied 
                      ? 'bg-emerald-500 text-white shadow-md shadow-emerald-200' 
                      : 'hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400'
                  }`}
                  title="Copy meeting link"
                >
                  {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                </button>
              </div>

              <div className="mt-8">
                <button
                  onClick={() => setShowLinkModal(false)}
                  className="w-full bg-track-navy dark:bg-track-teal hover:bg-slate-800 dark:hover:bg-teal-400 text-white dark:text-slate-900 font-bold py-3.5 rounded-xl transition-all shadow-lg active:scale-95"
                >
                  Got it
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden transform animate-in zoom-in-95 duration-300">
            <div className="p-6">
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 mx-auto mb-4">
                <Trash2 className="w-6 h-6 text-red-600 dark:text-red-400" />
              </div>

              <h2 className="text-xl font-bold text-center text-slate-900 dark:text-slate-100 mb-2">Delete session?</h2>
              
              <p className="text-slate-600 dark:text-slate-400 text-center text-sm mb-6 leading-relaxed">
                Are you sure you want to delete <span className="font-semibold text-slate-900 dark:text-slate-100">"{deleteConfirmModal.title}"</span>? 
                This action cannot be undone.
              </p>

              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteConfirmModal(null)}
                  disabled={deletingId !== null}
                  className="flex-1 px-4 py-3 rounded-lg font-semibold transition-colors border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  disabled={deletingId !== null}
                  className="flex-1 px-4 py-3 rounded-lg font-semibold transition-colors bg-red-600 hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700 text-white disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {deletingId ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Deleting...</span>
                    </>
                  ) : (
                    'Delete'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;

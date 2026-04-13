import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Clock, ArrowLeft, Loader2, ExternalLink } from 'lucide-react';
import { db } from '../lib/firebase';
import { collection, query, getDocs, orderBy, doc, getDoc } from 'firebase/firestore';

interface SessionRecord {
  id: string;
  room_code: string;
  title: string;
  status: string;
  teacher_id: string;
  created_at: any;
  teacherName?: string;
}

const AdminPanel: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);

  useEffect(() => {
    const fetchAllSessions = async () => {
      try {
        setLoading(true);
        const q = query(collection(db, 'sessions'), orderBy('created_at', 'desc'));
        const querySnapshot = await getDocs(q);
        
        const sessionsData = querySnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as SessionRecord[];

        // Fetch teacher names in parallel
        const enrichedSessions = await Promise.all(sessionsData.map(async (s) => {
          try {
            const userDoc = await getDoc(doc(db, 'users', s.teacher_id));
            return {
              ...s,
              teacherName: userDoc.exists() ? userDoc.data().name : 'Unknown Teacher'
            };
          } catch (e) {
            return { ...s, teacherName: 'Error Loading' };
          }
        }));

        setSessions(enrichedSessions);
      } catch (err) {
        console.error("Failed to fetch all sessions:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchAllSessions();
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-12">
      <div className="max-w-6xl mx-auto">
        <header className="flex justify-between items-center mb-10">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-slate-900 rounded-2xl flex items-center justify-center text-white shadow-xl">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Admin System</h1>
              <p className="text-slate-500 font-medium text-sm">GLOBAL SESSION OVERVIEW</p>
            </div>
          </div>
          <button 
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-5 py-2.5 rounded-xl font-bold hover:bg-slate-50 transition-all shadow-sm active:scale-95"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </button>
        </header>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="w-12 h-12 text-slate-900 animate-spin mb-4" />
            <p className="text-slate-500 font-bold">Scanning Global Network...</p>
          </div>
        ) : (
          <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-200 overflow-hidden">
            <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
              <h2 className="font-bold text-slate-800 flex items-center gap-2">
                <Clock className="w-5 h-4 text-slate-400" />
                All Time Sessions ({sessions.length})
              </h2>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left col-span-1 border-collapse">
                <thead>
                  <tr className="bg-white border-b border-slate-100 text-slate-400 text-[10px] font-black uppercase tracking-[0.2em]">
                    <th className="p-6 pl-8">Teacher</th>
                    <th className="p-6">Session Title</th>
                    <th className="p-6">Room Code</th>
                    <th className="p-6">Status</th>
                    <th className="p-6">Created At</th>
                    <th className="p-6 pr-8 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 text-sm">
                  {sessions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-12 text-center text-slate-400 font-medium">No sessions created in the system yet.</td>
                    </tr>
                  ) : sessions.map(session => (
                    <tr key={session.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-6 pl-8">
                        <div className="font-bold text-slate-900">{session.teacherName}</div>
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">{session.teacher_id}</div>
                      </td>
                      <td className="p-6 font-semibold text-slate-700">{session.title}</td>
                      <td className="p-6">
                        <span className="font-mono bg-slate-100 px-2 py-1 rounded text-slate-600 font-bold tracking-wider">{session.room_code}</span>
                      </td>
                      <td className="p-6">
                        <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full border ${
                          session.status === 'live' ? 'bg-red-50 text-red-600 border-red-100' :
                          session.status === 'waiting' ? 'bg-amber-50 text-amber-600 border-amber-100' :
                          'bg-slate-100 text-slate-500 border-slate-200'
                        }`}>
                          {session.status}
                        </span>
                      </td>
                      <td className="p-6 text-slate-500 font-medium">
                        {session.created_at && new Date(session.created_at.toMillis ? session.created_at.toMillis() : session.created_at).toLocaleDateString()}
                      </td>
                      <td className="p-6 pr-8 text-right">
                        <button 
                          onClick={() => navigate(`/sessions/${session.id}/report`)}
                          className="inline-flex items-center gap-2 text-track-teal hover:text-teal-600 font-bold transition-colors"
                        >
                          View Report
                          <ExternalLink className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminPanel;

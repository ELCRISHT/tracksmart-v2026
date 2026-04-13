import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Hash, AlertTriangle, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { db } from '../lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';

const Join: React.FC = () => {
  const navigate = useNavigate();
  const { userFullName, signOut } = useAuth();
  const [roomCode, setRoomCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (roomCode.length !== 6) {
      setError('Room code must be exactly 6 characters.');
      return;
    }
    
    setError('');
    setLoading(true);

    try {
      const q = query(
        collection(db, 'sessions'),
        where('room_code', '==', roomCode.toUpperCase()),
        where('status', '!=', 'ended')
      );
      
      const querySnapshot = await getDocs(q);
      
      if (querySnapshot.empty) {
        setError('Room not found or has already ended.');
        setLoading(false);
        return;
      }

      // Navigate to actual room directly as student
      navigate(`/room/${roomCode.toUpperCase()}?role=participant`);
    } catch (err: any) {
      console.error("Room validation failed:", err);
      setError("Failed to verify room. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8 border border-slate-200 relative">
        <button 
          onClick={signOut}
          className="absolute top-6 right-6 text-xs font-semibold text-slate-400 hover:text-track-alert-red transition-colors"
        >
          Sign Out
        </button>

        <div className="text-center mb-8 mt-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-track-teal mb-4 shadow-lg shadow-track-teal/20">
            <span className="text-white font-bold text-2xl tracking-tighter">SD</span>
          </div>
          <h1 className="text-3xl font-bold text-track-navy tracking-tight">Student Portal</h1>
          <p className="text-slate-500 mt-2 font-medium">Welcome back, {userFullName || 'Student'}!</p>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-track-alert-red/10 border border-track-alert-red/20 flex items-start gap-3 text-track-alert-red">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}

        <form onSubmit={handleJoin} className="space-y-5">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5 ml-1">Enter Room Code</label>
            <div className="relative">
              <input
                type="text"
                required
                maxLength={6}
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                className="w-full pl-11 pr-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-track-teal focus:border-track-teal outline-none transition-all placeholder:text-slate-400 font-mono tracking-widest uppercase font-bold text-track-navy"
                placeholder="TR4X9K"
              />
              <Hash className="absolute left-4 top-4 w-5 h-5 text-slate-400" />
            </div>
          </div>
          
          <button
            type="submit"
            disabled={loading || roomCode.length < 6}
            className="w-full mt-2 bg-gradient-to-r from-track-teal bg-emerald-500 text-white font-bold py-3.5 rounded-xl transition-all shadow-md shadow-track-teal/20 hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-70 disabled:pointer-events-none"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Validating Room...
              </>
            ) : 'Enter Session'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Join;

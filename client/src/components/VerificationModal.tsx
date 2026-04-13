import React, { useState, useEffect } from 'react';
import { Mail, RefreshCw, Send, LogOut, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { auth } from '../lib/firebase';
import { sendEmailVerification } from 'firebase/auth';

interface VerificationModalProps {
  isOpen: boolean;
  email: string;
}

const VerificationModal: React.FC<VerificationModalProps> = ({ isOpen, email }) => {
  const { refreshUser, signOut } = useAuth();
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    let timer: any;
    if (cooldown > 0) {
      timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [cooldown]);

  if (!isOpen) return null;

  const handleRefresh = async () => {
    setLoading(true);
    setMessage(null);
    try {
      await refreshUser();
      // AuthRedirect in App.tsx will handle navigation if verified
    } catch (err: any) {
      setMessage({ type: 'error', text: 'Failed to refresh status. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    setResending(true);
    setMessage(null);
    try {
      const user = auth.currentUser;
      if (user) {
        await sendEmailVerification(user);
        setMessage({ type: 'success', text: 'Verification email resent! Please check your inbox.' });
        setCooldown(60); // 1 minute cooldown
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to resend email.' });
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0d1b2a]/80 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-[#1b263b] w-full max-w-md rounded-2xl shadow-2xl border border-[#415a77] overflow-hidden transform animate-in zoom-in-95 duration-300">
        {/* Header/Banner */}
        <div className="bg-gradient-to-r from-[#00e5ff] to-[#80ffea] h-2 w-full"></div>
        
        <div className="p-8">
          <div className="flex justify-center mb-6">
            <div className="w-20 h-20 bg-[#0d1b2a] rounded-full flex items-center justify-center border-4 border-[#415a77] relative">
              <Mail className="w-10 h-10 text-[#00e5ff]" />
              <div className="absolute -bottom-1 -right-1 bg-[#1b263b] rounded-full p-1.5 border-2 border-[#415a77]">
                 <RefreshCw className={`w-4 h-4 text-[#80ffea] ${loading ? 'animate-spin' : ''}`} />
              </div>
            </div>
          </div>

          <h2 className="text-2xl font-bold text-white text-center mb-2 tracking-tight">Verify your email</h2>
          <p className="text-slate-400 text-center mb-8 leading-relaxed">
            We've sent a verification link to <span className="text-[#80ffea] font-semibold">{email}</span>. 
            Please check your inbox and click the link to activate your account.
          </p>

          {message && (
            <div className={`mb-6 p-4 rounded-xl flex items-start gap-3 border ${
              message.type === 'success' 
                ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400' 
                : 'bg-red-500/10 border-red-500/50 text-red-400'
            }`}>
              {message.type === 'success' ? <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" /> : <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />}
              <p className="text-sm font-medium">{message.text}</p>
            </div>
          )}

          <div className="space-y-3">
            <button
              onClick={handleRefresh}
              disabled={loading}
              className="w-full bg-[#00e5ff] hover:bg-[#00d0e6] text-[#0d1b2a] font-bold py-3.5 rounded-xl transition-all shadow-lg active:scale-[0.98] flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
              Check Verification Status
            </button>

            <button
              onClick={handleResend}
              disabled={resending || cooldown > 0}
              className={`w-full py-3.5 rounded-xl font-bold transition-all flex items-center justify-center gap-2 border-2 ${
                cooldown > 0 
                  ? 'border-[#415a77] text-slate-500 cursor-not-allowed' 
                  : 'border-[#415a77] text-white hover:bg-[#415a77]/30'
              }`}
            >
              {resending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend Verification Email'}
            </button>
          </div>

          <div className="mt-8 pt-6 border-t border-[#415a77]/50 flex justify-center">
            <button 
              onClick={() => signOut()}
              className="text-slate-400 hover:text-white text-sm font-semibold flex items-center gap-2 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign out and try another account
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VerificationModal;

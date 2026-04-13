import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, User as UserIcon, Shield, GraduationCap, AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { auth, db } from '../lib/firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import VerificationModal from '../components/VerificationModal';

type Role = 'teacher' | 'student' | 'admin';

const Auth: React.FC = () => {
  const navigate = useNavigate();
  const { user, emailVerified } = useAuth();
  
  const [isSignIn, setIsSignIn] = useState(true);
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<Role>('student');

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Real Firebase Auth only
    try {
      if (isSignIn) {
        // --- SIGN IN ---
        await signInWithEmailAndPassword(auth, email, password);
        navigate('/'); 
      } else {
        // --- SIGN UP ---
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        
        // Save metadata into Firestore and WAIT for confirmation
        const userRef = doc(db, 'users', userCredential.user.uid);
        await setDoc(userRef, {
          email: email,
          name: fullName,
          role: role,
          createdAt: new Date()
        });

        console.log('✅ [Auth] Profile created in Firestore for:', role);
        
        // Send Verification Email
        await sendEmailVerification(userCredential.user);
        setShowVerifyModal(true);
      }
    } catch (err: any) {
      // Clean up firebase error codes for friendly reading
      let message = err.message || 'Authentication failed';
      if (err.code === 'auth/email-already-in-use') message = 'This email is already registered.';
      if (err.code === 'auth/invalid-credential') message = 'Invalid email or password.';
      if (err.code === 'auth/weak-password') message = 'Password must be at least 6 characters.';
      
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      setError('Please enter your email address first.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await sendPasswordResetEmail(auth, email);
      setResetSent(true);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to send reset email.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 border border-slate-200">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-track-navy tracking-tight">TrackSmart</h1>
          <p className="text-slate-500 mt-2">{isSignIn ? 'Sign in to your account' : 'Create a new account'}</p>
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-slate-100 p-1 rounded-xl mb-6">
          <button 
            type="button" 
            onClick={() => { setIsSignIn(true); setError(null); }}
            className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${isSignIn ? 'bg-white text-track-navy shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Sign In
          </button>
          <button 
            type="button" 
            onClick={() => { setIsSignIn(false); setError(null); }}
            className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${!isSignIn ? 'bg-white text-track-navy shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Sign Up
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-lg bg-track-alert-red/10 border border-track-alert-red flex items-start gap-3 text-track-alert-red">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}

        {resetSent && (
          <div className="mb-6 p-4 rounded-lg bg-emerald-50 border border-emerald-200 flex items-start gap-3 text-emerald-600">
            <Shield className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <p className="text-sm font-medium">Password reset email sent! Check your inbox.</p>
          </div>
        )}

        <form onSubmit={handleAuth} className="space-y-4">
          
          {!isSignIn && (
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1 ml-1">Full Name</label>
              <div className="relative">
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-track-teal focus:border-track-teal outline-none transition-all placeholder:text-slate-400"
                  placeholder="Juan Cruz"
                />
                <UserIcon className="absolute left-3 top-3 w-5 h-5 text-slate-400" />
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1 ml-1">Email</label>
            <div className="relative">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-track-teal focus:border-track-teal outline-none transition-all placeholder:text-slate-400"
                placeholder={role === 'student' ? 'student@school.edu' : 'teacher@school.edu'}
              />
              <Mail className="absolute left-3 top-3 w-5 h-5 text-slate-400" />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1 ml-1">Password</label>
            <div className="relative">
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-track-teal focus:border-track-teal outline-none transition-all placeholder:text-slate-400"
                placeholder="••••••••"
              />
              <Lock className="absolute left-3 top-3 w-5 h-5 text-slate-400" />
            </div>
            {isSignIn && (
              <div className="flex justify-end mt-1">
                <button 
                  type="button" 
                  onClick={handleForgotPassword}
                  className="text-xs font-bold text-track-teal hover:underline"
                >
                  Forgot password?
                </button>
              </div>
            )}
          </div>

          {!isSignIn && (
            <div className="pt-2">
              <label className="block text-sm font-semibold text-slate-700 mb-2 ml-1">Account Role</label>
              <div className="grid grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => setRole('student')}
                  className={`flex flex-col items-center justify-center py-3 border rounded-xl transition-all ${role === 'student' ? 'bg-track-teal/10 border-track-teal text-track-teal ring-1 ring-track-teal shadow-sm shadow-track-teal/20' : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300'}`}
                >
                  <UserIcon className="w-5 h-5 mb-1" />
                  <span className="text-xs font-bold tracking-tight">Student</span>
                </button>
                <button
                  type="button"
                  onClick={() => setRole('teacher')}
                  className={`flex flex-col items-center justify-center py-3 border rounded-xl transition-all ${role === 'teacher' ? 'bg-track-navy/10 border-track-navy text-track-navy ring-1 ring-track-navy shadow-sm shadow-track-navy/20' : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300'}`}
                >
                  <GraduationCap className="w-5 h-5 mb-1" />
                  <span className="text-xs font-bold tracking-tight">Teacher</span>
                </button>
                <button
                  type="button"
                  onClick={() => setRole('admin')}
                  className={`flex flex-col items-center justify-center py-3 border rounded-xl transition-all ${role === 'admin' ? 'bg-slate-900 border-slate-900 text-white ring-1 ring-slate-900 shadow-sm shadow-slate-900/40' : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300'}`}
                >
                  <Shield className="w-5 h-5 mb-1" />
                  <span className="text-xs font-bold tracking-tight">Admin</span>
                </button>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-4 bg-track-navy hover:bg-track-hover text-white font-bold py-3.5 rounded-xl transition-all shadow-md active:scale-[0.98] flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="w-5 h-5 animate-spin" />}
            {!loading && (isSignIn ? 'Sign In' : 'Create Account')}
          </button>
        </form>
        
        {user && !emailVerified && (
          <VerificationModal isOpen={true} email={user.email} />
        )}
        
        {showVerifyModal && user && (
           <VerificationModal isOpen={true} email={user.email} />
        )}
      </div>
    </div>
  );
};

export default Auth;

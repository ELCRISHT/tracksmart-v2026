import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

import { updatePassword, updateProfile, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { doc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { 
  ArrowLeft, User as UserIcon, Lock, Save, Camera, AlertTriangle
} from 'lucide-react';

const ProfileConfig: React.FC = () => {
  const { user, userFullName, userAvatarUrl, updateUserMetadata } = useAuth();

  const navigate = useNavigate();

  // Profile Form
  const [name, setName] = useState(userFullName || '');
  const [avatarData, setAvatarData] = useState<string | null>(null);
  
  // Security Form
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // States
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingSecurity, setSavingSecurity] = useState(false);
  const [profileMsg, setProfileMsg] = useState({ type: '', text: '' });
  const [securityMsg, setSecurityMsg] = useState({ type: '', text: '' });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const displayAvatar = avatarData || userAvatarUrl;

  const handleBack = () => {
    if (user?.role === 'teacher') navigate('/dashboard');
    else navigate('/student-dashboard');
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setProfileMsg({ type: 'error', text: 'Please select an image file.' });
      return;
    }

    if (file.size > 1024 * 1024) {
      setProfileMsg({ type: 'error', text: 'Image must be less than 1MB.' });
      return; // Ensure file is <1MB base line
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      // Compress to simple base64 (Optional but we just store the direct dataURL if it fits <1MB)
      // Usually direct dataUrl is fine if we restricted size >1MB.
      if (typeof event.target?.result === 'string') {
        const base64Str = event.target.result;
        // Verify length just in case
        if (base64Str.length > 1.3 * 1024 * 1024) {
           setProfileMsg({ type: 'error', text: 'File too large after encoding.' });
           return;
        }
        setAvatarData(base64Str);
        setProfileMsg({ type: '', text: '' });
      }
    };
    reader.readAsDataURL(file);
  };

  const saveProfile = async () => {
    if (!user || !auth.currentUser) return;
    setSavingProfile(true);
    setProfileMsg({ type: '', text: '' });

    try {
      // 1. Update Firebase Auth Identity
      if (name !== userFullName) {
        await updateProfile(auth.currentUser, { displayName: name });
      }

      // 2. Update Firestore `users` Doc
      const updates: any = { name };
      if (avatarData) {
        updates.avatar_url = avatarData;
      }
      
      const userRef = doc(db, 'users', user.id);
      await updateDoc(userRef, updates);

      // 3. Update Global Context
      updateUserMetadata(name, avatarData || undefined);

      setProfileMsg({ type: 'success', text: 'Profile updated successfully!' });
    } catch (e: any) {
      console.error("Profile update failed", e);
      setProfileMsg({ type: 'error', text: e.message || 'Failed to update profile.' });
    } finally {
      setSavingProfile(false);
    }
  };

  const saveSecurity = async () => {
    if (!auth.currentUser || !user?.email) return;
    
    if (newPassword !== confirmPassword) {
      setSecurityMsg({ type: 'error', text: 'New passwords do not match.' });
      return;
    }
    
    if (newPassword.length < 6) {
      setSecurityMsg({ type: 'error', text: 'Password must be at least 6 characters.' });
      return;
    }

    if (!currentPassword) {
      setSecurityMsg({ type: 'error', text: 'Please enter your current password to verify identity.' });
      return;
    }

    setSavingSecurity(true);
    setSecurityMsg({ type: '', text: '' });

    try {
      // Re-authenticate first
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(auth.currentUser, credential);
      
      // Submit update
      await updatePassword(auth.currentUser, newPassword);
      
      setSecurityMsg({ type: 'success', text: 'Password changed successfully.' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (e: any) {
      console.error("Security update failed", e);
      setSecurityMsg({ type: 'error', text: e.message || 'Failed to update password.' });
    } finally {
      setSavingSecurity(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center py-12 px-4 sm:px-6 transition-colors duration-300">
      
      {/* Header */}
      <div className="w-full max-w-3xl flex items-center justify-between mb-8">
        <button 
          onClick={handleBack}
          className="flex items-center gap-2 text-slate-500 hover:text-track-navy dark:text-slate-400 dark:hover:text-slate-200 transition-colors font-semibold"
        >
          <ArrowLeft className="w-5 h-5" />
          <span>Back to Dashboard</span>
        </button>
        <div className="flex items-center gap-4">

          <h1 className="text-2xl font-black text-track-navy dark:text-slate-100 tracking-tight">Account Settings</h1>
        </div>
      </div>

      <div className="w-full max-w-3xl space-y-8">
        
        {/* Profile Card */}
        <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="bg-slate-900 dark:bg-slate-800 px-8 py-6 text-white flex items-center gap-3">
            <UserIcon className="text-track-teal w-6 h-6" />
            <h2 className="text-xl font-bold tracking-wide">Public Profile</h2>
          </div>

          <div className="p-8">
            {profileMsg.text && (
              <div className={`p-4 rounded-xl mb-6 font-bold text-sm flex items-start gap-3 ${profileMsg.type === 'error' ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-emerald-50 text-emerald-600 border border-emerald-100'}`}>
                {profileMsg.type === 'error' && <AlertTriangle className="w-5 h-5 shrink-0" />}
                {profileMsg.text}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-10 items-start">
              
              {/* Avatar Section */}
              <div className="flex flex-col items-center gap-4">
                <div 
                  className="w-32 h-32 rounded-full bg-slate-100 dark:bg-slate-800 border-4 border-white dark:border-slate-900 shadow-xl relative group overflow-hidden flex items-center justify-center"
                >
                  {displayAvatar ? (
                    <img src={displayAvatar} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <UserIcon className="w-12 h-12 text-slate-300 dark:text-slate-700" />
                  )}
                  
                  {/* Overlay */}
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white backdrop-blur-sm"
                  >
                    <Camera className="w-6 h-6 mb-1" />
                    <span className="text-xs font-bold uppercase tracking-wider">Change</span>
                  </button>
                </div>
                
                <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium text-center uppercase tracking-widest max-w-[120px]">
                  JPEG or PNG. Max 1MB.
                </p>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleImageSelect}
                  accept="image/png, image/jpeg, image/jpg"
                  className="hidden"
                />
              </div>

              {/* Data Section */}
              <div className="flex-1 space-y-5 w-full">
                <div>
                  <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Display Name</label>
                  <input 
                    type="text" 
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-track-teal focus:border-track-teal outline-none transition-all font-medium text-slate-900 dark:text-slate-100"
                    placeholder="E.g. Mr. Smith"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Account Email</label>
                  <div className="w-full px-4 py-3 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-medium text-slate-500 dark:text-slate-400 cursor-not-allowed">
                    {user?.email}
                  </div>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-2 font-medium">Email addresses cannot be changed directly.</p>
                </div>

                <div className="pt-4 flex justify-end">
                  <button 
                    onClick={saveProfile}
                    disabled={savingProfile || !name.trim()}
                    className="bg-track-teal hover:bg-teal-400 text-slate-900 shadow-lg shadow-track-teal/30 transition-all font-bold py-3 px-6 rounded-xl flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50 disabled:active:scale-100"
                  >
                    {savingProfile ? (
                      <div className="w-5 h-5 border-2 border-slate-900 border-t-transparent rounded-full animate-spin"></div>
                    ) : (
                      <>
                        <Save className="w-4 h-4" />
                        Save Profile
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Security Card */}
        <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="bg-slate-900 dark:bg-slate-800 px-8 py-6 text-white flex items-center gap-3">
            <Lock className="text-track-alert-amber w-6 h-6" />
            <h2 className="text-xl font-bold tracking-wide">Security</h2>
          </div>

          <div className="p-8 space-y-5">
            {securityMsg.text && (
              <div className={`p-4 rounded-xl mb-4 font-bold text-sm flex items-start gap-3 ${securityMsg.type === 'error' ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-emerald-50 text-emerald-600 border border-emerald-100'}`}>
                 {securityMsg.type === 'error' && <AlertTriangle className="w-5 h-5 shrink-0" />}
                 {securityMsg.text}
              </div>
            )}

            <div>
              <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Current Password</label>
              <input 
                type="password" 
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition-all font-medium text-slate-900 dark:text-slate-100"
                placeholder="Required to change password"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-4 border-t border-slate-100 dark:border-slate-800">
              <div>
                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">New Password</label>
                <input 
                  type="password" 
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition-all font-medium text-slate-900 dark:text-slate-100"
                  placeholder="Min. 6 characters"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Confirm Password</label>
                <input 
                  type="password" 
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition-all font-medium text-slate-900 dark:text-slate-100"
                  placeholder="Retype password"
                />
              </div>
            </div>

            <div className="pt-4 flex justify-end">
              <button 
                onClick={saveSecurity}
                disabled={savingSecurity || !currentPassword || !newPassword}
                className="bg-slate-900 hover:bg-slate-800 text-white shadow-lg transition-all font-bold py-3 px-6 rounded-xl flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50 disabled:active:scale-100"
              >
                {savingSecurity ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <>
                    <Lock className="w-4 h-4" />
                    Update Password
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default ProfileConfig;

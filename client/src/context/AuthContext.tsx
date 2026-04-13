import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, db } from '../lib/firebase';
import { onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
import type { User as FirebaseUser } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';

// Custom User Type mapping
export interface User {
  id: string;
  email: string;
  role: 'teacher' | 'student' | 'admin';
  name: string;
  avatarUrl?: string;
  emailVerified: boolean;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  userRole: 'teacher' | 'student' | 'admin' | null;
  userFullName: string | null;
  userAvatarUrl: string | null;
  emailVerified: boolean | null;
  refreshUser: () => Promise<void>;
  signOut: () => Promise<void>;
  updateUserMetadata: (name: string, avatarUrl?: string) => void;
}

const AuthContext = createContext<AuthContextType>({ 
  user: null, 
  loading: true, 
  userRole: null, 
  userFullName: null,
  userAvatarUrl: null,
  emailVerified: null,
  refreshUser: async () => {},
  signOut: async () => {},
  updateUserMetadata: () => {}
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<'teacher' | 'student' | 'admin' | null>(null);
  const [userFullName, setUserFullName] = useState<string | null>(null);
  const [userAvatarUrl, setUserAvatarUrl] = useState<string | null>(null);
  const [emailVerified, setEmailVerified] = useState<boolean | null>(null);

  const updateUserMetadata = (name: string, avatarUrl?: string) => {
    setUserFullName(name);
    if (avatarUrl !== undefined) setUserAvatarUrl(avatarUrl);
    setUser(prev => prev ? { ...prev, name, avatarUrl: avatarUrl !== undefined ? avatarUrl : prev.avatarUrl } : null);
  };

  const refreshUser = async () => {
    const currentUser = auth.currentUser;
    if (currentUser) {
      await currentUser.reload();
      setEmailVerified(currentUser.emailVerified);
      // Update the user object too
      setUser(prev => prev ? { ...prev, emailVerified: currentUser.emailVerified } : null);
    }
  };



  useEffect(() => {
    let mounted = true;
    
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser: FirebaseUser | null) => {
      if (!mounted) return;

      if (!firebaseUser) {
        setUser(null);
        setUserRole(null);
        setUserFullName(null);
        setLoading(false);
        return;
      }

      try {
        // Fetch custom claims/role from Firestore with a small retry logic for new accounts
        let userData = null;
        let attempts = 0;
        
        while (attempts < 3 && !userData) {
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          userData = userDoc.data();
          if (!userData) {
            console.warn(`🔐 [AuthContext] Attempt ${attempts + 1}: Doc not found for ${firebaseUser.uid}, retrying...`);
            await new Promise(r => setTimeout(r, 1000));
            attempts++;
          }
        }

        if (userData) {
          const mappedUser: User = {
            id: firebaseUser.uid,
            email: firebaseUser.email || '',
            role: userData.role || 'student',
            name: userData.name || 'Unknown User',
            avatarUrl: userData.avatar_url || '',
            emailVerified: firebaseUser.emailVerified
          };
          setUser(mappedUser);
          setUserRole(mappedUser.role);
          setUserFullName(mappedUser.name);
          setUserAvatarUrl(mappedUser.avatarUrl || null);
          setEmailVerified(firebaseUser.emailVerified);
        } else {
           console.error("🔐 [AuthContext] Authenticated but no doc found in Firestore /users collection after retries");
           // Fallback for new users if the doc is still missing
           setUserRole(null);
           setUserFullName(null);
           setUserAvatarUrl(null);
           setEmailVerified(firebaseUser.emailVerified);
        }
      } catch (err) {
        console.error("🔐 [AuthContext] Failed to fetch user roles from Firestore:", err);
      } finally {
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const signOut = async () => {
    try {
      await firebaseSignOut(auth);
    } finally {
      setUser(null);
      setUserRole(null);
      setUserFullName(null);
      setEmailVerified(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, userRole, userFullName, userAvatarUrl, emailVerified, refreshUser, signOut, updateUserMetadata }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  return useContext(AuthContext);
};

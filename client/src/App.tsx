import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Auth from './pages/Auth';
import Dashboard from './pages/Dashboard';
import StudentDashboard from './pages/StudentDashboard';
import Session from './pages/Session';
import SessionReport from './pages/SessionReport';
import AdminPanel from './pages/AdminPanel';
import ProfileConfig from './pages/ProfileConfig';

// Protected Route Component
const ProtectedRoute = ({ children, allowedRoles }: { children: React.ReactNode, allowedRoles?: string[] }) => {
  const { user, userRole, emailVerified, loading } = useAuth();
  
  if (loading) {
    return <div className="flex items-center justify-center min-h-screen text-slate-500 font-medium tracking-tight">Checking credentials...</div>;
  }
  
  // Custom bypass check for mock users or unverified accounts
  if (!user && !userRole) {
    return <Navigate to="/auth" replace />;
  }

  // Strict gate for email verification
  if (user && !emailVerified) {
    return <Navigate to="/auth" replace />;
  }

  // Reject access if the user's role isn't allowed for this specific route
  if (allowedRoles && userRole && !allowedRoles.includes(userRole)) {
     // Kick teachers to dashboard, students to join
     return <Navigate to="/" replace />;
  }

  return children;
};

// Root Redirector based on roles
const AuthRedirect = () => {
  const { user, userRole, emailVerified, loading } = useAuth();

  if (loading) return <div className="flex items-center justify-center min-h-screen text-slate-500 font-medium tracking-tight">Initializing interface...</div>;

  if (!user || (user && !emailVerified)) {
    return <Navigate to="/auth" replace />;
  }

  if (userRole === 'student') return <Navigate to="/student-dashboard" replace />;
  if (userRole === 'teacher' || userRole === 'admin') return <Navigate to="/dashboard" replace />;
  
  // Final fallback for edge cases
  return <Navigate to="/auth" replace />;
};

function App() {
  return (
    <Router>
      <AuthProvider>
        <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
          <Routes>
            <Route path="/" element={<AuthRedirect />} />
            
            {/* Protected Utility Routes */}
            <Route path="/portal" element={<AuthRedirect />} />
            
            {/* Public/Auth Routes */}
            <Route path="/auth" element={<Auth />} />
            
            {/* Session handles both Teacher and Student, logic inside checks token/auth */}
            <Route path="/room/:code" element={<Session />} />

            {/* Universal Protected Routes */}
            <Route 
              path="/profile" 
              element={
                <ProtectedRoute>
                  <ProfileConfig />
                </ProtectedRoute>
              } 
            />

            {/* Student Protected Routes */}
            <Route 
              path="/student-dashboard" 
              element={
                <ProtectedRoute allowedRoles={['student']}>
                  <StudentDashboard />
                </ProtectedRoute>
              } 
            />

            {/* Teacher & Admin Protected Routes */}
            <Route 
              path="/dashboard" 
              element={
                <ProtectedRoute allowedRoles={['teacher', 'admin']}>
                  <Dashboard />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/sessions/:id/report" 
              element={
                <ProtectedRoute allowedRoles={['teacher', 'admin']}>
                  <SessionReport />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/admin" 
              element={
                <ProtectedRoute allowedRoles={['admin']}>
                  <AdminPanel />
                </ProtectedRoute>
              } 
            />
          </Routes>
        </div>
      </AuthProvider>
    </Router>
  );
}

export default App;

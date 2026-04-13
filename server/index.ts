import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { AccessToken } from 'livekit-server-sdk';
import admin from 'firebase-admin';
import path from 'path';

dotenv.config();

// Initialize Firebase Admin
let db: admin.firestore.Firestore;
try {
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './firebase-service-account.json';
  const resolvedPath = path.resolve(serviceAccountPath);
  
  // Check if file exists manually before requiring to provide better error
  if (!require('fs').existsSync(resolvedPath)) {
    throw { code: 'MODULE_NOT_FOUND', path: resolvedPath };
  }

  const serviceAccount = require(resolvedPath);
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  db = admin.firestore();
  console.log('\x1b[32m%s\x1b[0m', '✅ [Firebase] Admin SDK Initialized Successfully');
} catch (error: any) {
  console.warn('\n\x1b[41m\x1b[37m%s\x1b[0m', ' CRITICAL ERROR: FIREBASE SERVICE ACCOUNT MISSING ');
  console.warn('\x1b[31m%s\x1b[0m', `The file was not found at: ${error.path || 'unknown path'}`);
  console.warn('\x1b[33m%s\x1b[0m', '1. Go to Firebase Console -> Project Settings -> Service Accounts');
  console.warn('\x1b[33m%s\x1b[0m', '2. Click "Generate new private key"');
  console.warn('\x1b[33m%s\x1b[0m', '3. Save file as "firebase-service-account.json" inside the /server folder.\n');
  
  // Create a mock DB object that warns on use rather than crashing
  db = {
    collection: () => ({
      doc: () => ({ get: async () => ({ exists: false, data: () => null }), set: async () => {}, update: async () => {} }),
      add: async () => { console.warn('⚠️ Firestore Write Ignored: Admin SDK not initialized'); return { id: 'mock' }; },
      where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) })
    })
  } as any;
}

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { 
    origin: true, // Dynamically allow whatever origin is connecting during dev
    methods: ['GET', 'POST'],
    credentials: true
  },
  allowEIO3: true // Allow compatibility with older clients if needed
});

console.log('📡 [Socket.io] Server initialized and ready for connections');

/* --- LIVEKIT TOKEN GENERATION --- */

app.get('/api/livekit/token', async (req, res) => {
  const { room, role } = req.query;
  const authHeader = req.headers.authorization;

  if (!room || !role) {
    return res.status(400).json({ error: 'Missing room or role parameter.' });
  }

  if (authHeader === 'Bearer MOCK_ADMIN' || authHeader === 'Bearer MOCK_TEACHER') {
    return res.status(401).json({ error: 'Mock tokens are disabled in production mode.' });
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header.' });
  }

  const idToken = authHeader.split(' ')[1] || '';

  try {
    // 1. Verify Firebase JWT securely via Admin SDK
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const userId = decodedToken.uid;
    
    // 2. Grab their metadata securely from Firestore /users collection
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();
    
    if (!userData) {
      return res.status(401).json({ error: 'User metadata not found.' });
    }

    const displayName = userData.name || 'Student';
    const dbRole = userData.role || 'student';
    const isTeacher = (dbRole === 'teacher' || dbRole === 'admin');
    
    const isHostReq = role === 'host';
    if (isHostReq && !isTeacher) {
      return res.status(403).json({ error: 'Forbidden. Students cannot request host privileges.' });
    }

    const at = new AccessToken(
      process.env.LIVEKIT_API_KEY || '',
      process.env.LIVEKIT_API_SECRET || '',
      {
        identity: userId, 
        name: displayName,
      }
    );

    at.addGrant({
      roomJoin: true,
      room: room as string,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      roomAdmin: isHostReq && isTeacher,
    });

    const token = await at.toJwt();
    res.json({ token, identity: userId, name: displayName });
  } catch (err: any) {
    console.error('Failed to generate token:', err);
    res.status(500).json({ error: 'Failed to authenticate securely' });
  }
});

/* --- SOCKET REAL-TIME EVENTS & FIRESTORE LOGGING --- */

// Real-time In-memory State for Roster Sync
const participantsByRoom = new Map<string, Record<string, any>>();

io.on('connection', (socket) => {
  console.log(`🔌 [Socket] New connection: ${socket.id}`);
  
  socket.on('error', (err) => {
    console.error(`❌ [Socket] Error for ${socket.id}:`, err);
  });
  
  // Directly append events into Firebase NoSQL database instantly
  const logEvent = async (roomCode: string, studentId: string | null, type: string, payload: any = {}) => {
    try {
       if (!db) return;
       if (studentId && (studentId.startsWith('anon-') || studentId.startsWith('mock-'))) studentId = null;

       // Find the session ID mapped to this room code
       const sessionsRef = db.collection('sessions');
       const querySnapshot = await sessionsRef.where('room_code', '==', roomCode).limit(1).get();
       
       if (querySnapshot.empty || !querySnapshot.docs[0]) return;
       const sessionId = querySnapshot.docs[0].id;

       await db.collection('session_events').add({
         session_id: sessionId,
         student_id: studentId,
         event_type: type,
         payload: payload,
         timestamp: admin.firestore.FieldValue.serverTimestamp()
       });
    } catch(e) {
       console.error("Failed to log event to Firestore", e);
    }
  };

  socket.on('join_session', ({ sessionId, role, displayName, studentId }) => {
    socket.join(sessionId);
    socket.data = { sessionId, role, displayName, studentId };
    
    // Roster Management
    if (role === 'participant') {
      if (!participantsByRoom.has(sessionId)) participantsByRoom.set(sessionId, {});
      const room = participantsByRoom.get(sessionId)!;
      room[studentId] = { studentId, displayName, socketId: socket.id, score: 100, lastDistraction: null };
      
      socket.to(sessionId).emit('ts:student_joined', { studentId, displayName, socketId: socket.id });
      logEvent(sessionId, studentId, 'student_joined', { displayName });
    }

    // Always send the full initial roster to any joining user (especially teachers joining late)
    const currentRoster = participantsByRoom.get(sessionId) || {};
    socket.emit('ts:initial_roster', currentRoster);
  });

  socket.on('ts:distraction', (data) => {
    const { sessionId, studentId } = socket.data;
    if (sessionId) {
      socket.to(sessionId).emit('ts:student_alert', { studentId, alertType: 'distraction', ...data });
      logEvent(sessionId, studentId, 'distraction', data);
    }
  });

  socket.on('ts:phone_detected', (data) => {
    const { sessionId, studentId } = socket.data;
    if (sessionId) {
      socket.to(sessionId).emit('ts:student_alert', { studentId, alertType: 'phone_detected', ...data });
      logEvent(sessionId, studentId, 'phone_detected', data);
    }
  });

  socket.on('ts:phone_cleared', (data) => {
    const { sessionId, studentId } = socket.data;
    if (sessionId) {
      socket.to(sessionId).emit('ts:student_alert', { studentId, alertType: 'phone_cleared', ...data });
      logEvent(sessionId, studentId, 'phone_cleared', data);
    }
  });

  socket.on('ts:tab_switch', (data) => {
    const { sessionId, studentId } = socket.data;
    if (sessionId) {
      socket.to(sessionId).emit('ts:student_alert', { studentId, alertType: 'tab_switch', ...data });
      logEvent(sessionId, studentId, 'tab_switch', data);
    }
  });

  socket.on('ts:tab_return', (data) => {
    const { sessionId, studentId } = socket.data;
    if (sessionId) {
      socket.to(sessionId).emit('ts:student_alert', { studentId, alertType: 'tab_return', ...data });
      logEvent(sessionId, studentId, 'tab_return', data);
    }
  });

  socket.on('ts:attention_update', (data) => {
    const { sessionId, studentId } = socket.data;
    if (sessionId) {
      // Sync in-memory map
      const room = participantsByRoom.get(sessionId);
      if (room && room[studentId]) {
        room[studentId].score = data.score;
      }
      socket.to(sessionId).emit('ts:attention_update', { studentId, ...data });
    }
  });

  socket.on('ts:issue_warning', (data) => {
    const { sessionId } = socket.data;
    if (sessionId) {
      // Broadcast specifically to the targeted student
      io.to(data.studentSocketId).emit('ts:warning_issued', { message: data.message });
    }
  });

  socket.on('ts:end_session', async () => {
    const { sessionId, role } = socket.data;
    console.log(`📡 [Socket] End Session request for ${sessionId} from ${role}`);
    
    if (sessionId && (role === 'host' || role === 'teacher' || role === 'admin')) {
      try {
        if (db) {
          const sessionsRef = db.collection('sessions');
          const querySnapshot = await sessionsRef.where('room_code', '==', sessionId).limit(1).get();
          if (!querySnapshot.empty && querySnapshot.docs[0]) {
            await sessionsRef.doc(querySnapshot.docs[0].id).update({ status: 'ended' });
            console.log(`✅ [Firestore] Session ${sessionId} marked as ENDED`);
          }
        }
        io.to(sessionId).emit('ts:session_ended');
      } catch (e) {
        console.error("❌ Failed to end session:", e);
      }
    } else {
      console.warn(`⚠️ [Socket] Unauthorized end_session attempt by ${role}`);
    }
  });

  socket.on('disconnect', () => {
    const { sessionId, role, studentId } = socket.data;
    if (sessionId && role === 'participant') {
      // Update in-memory map
      const room = participantsByRoom.get(sessionId);
      if (room && room[studentId]) {
        delete room[studentId];
        if (Object.keys(room).length === 0) participantsByRoom.delete(sessionId);
      }
      
      socket.to(sessionId).emit('ts:student_left', { studentId });
      logEvent(sessionId, studentId, 'student_left', {});
    }
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

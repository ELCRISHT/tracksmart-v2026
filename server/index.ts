import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { AccessToken } from 'livekit-server-sdk';
import admin from 'firebase-admin';
import path from 'path';
import fs from 'fs';

dotenv.config();

// Initialize Firebase Admin
let db: admin.firestore.Firestore | null = null;
let firebaseReady = false;
try {
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './firebase-service-account.json';
  const resolvedPath = path.resolve(serviceAccountPath);
  
  // Check if file exists manually before requiring to provide better error
  if (!fs.existsSync(resolvedPath)) {
    throw { code: 'MODULE_NOT_FOUND', path: resolvedPath };
  }

  const serviceAccount = require(resolvedPath);
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  db = admin.firestore();
  firebaseReady = true;
  console.log('\x1b[32m%s\x1b[0m', '✅ [Firebase] Admin SDK Initialized Successfully');
} catch (error: any) {
  console.warn('\n\x1b[41m\x1b[37m%s\x1b[0m', ' CRITICAL ERROR: FIREBASE SERVICE ACCOUNT MISSING ');
  console.warn('\x1b[31m%s\x1b[0m', `The file was not found at: ${error.path || 'unknown path'}`);
  console.warn('\x1b[33m%s\x1b[0m', '1. Go to Firebase Console -> Project Settings -> Service Accounts');
  console.warn('\x1b[33m%s\x1b[0m', '2. Click "Generate new private key"');
  console.warn('\x1b[33m%s\x1b[0m', '3. Save file as "firebase-service-account.json" inside the /server folder.\n');
}

const app = express();
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin: allowedOrigins.length > 0 ? allowedOrigins : true,
  credentials: true
}));
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { 
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
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
  const livekitApiKey = process.env.LIVEKIT_API_KEY;
  const livekitApiSecret = process.env.LIVEKIT_API_SECRET;

  if (!firebaseReady || !db) {
    return res.status(503).json({ error: 'Server is missing Firebase Admin configuration.' });
  }

  if (!livekitApiKey || !livekitApiSecret) {
    return res.status(503).json({ error: 'Server is missing LiveKit credentials.' });
  }

  if (!room || !role) {
    return res.status(400).json({ error: 'Missing room or role parameter.' });
  }

  if (role !== 'host' && role !== 'participant') {
    return res.status(400).json({ error: 'Invalid role parameter.' });
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
      livekitApiKey,
      livekitApiSecret,
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

  socket.on('join_session', async ({ sessionId, role, displayName, studentId }) => {
    socket.join(sessionId);
    socket.data = { sessionId, role, displayName, studentId };
    
    // Roster Management
    if (role === 'participant') {
      if (!participantsByRoom.has(sessionId)) participantsByRoom.set(sessionId, {});
      const room = participantsByRoom.get(sessionId)!;
      room[studentId] = { studentId, displayName, socketId: socket.id, score: 100, lastDistraction: null, warningCount: 0 };
      
      // Write participant to Firestore
      if (db) {
        try {
          // Look up actual session ID from room code
          const sessionsRef = db.collection('sessions');
          const querySnapshot = await sessionsRef.where('room_code', '==', sessionId).limit(1).get();
          
          if (!querySnapshot.empty && querySnapshot.docs[0]) {
            const actualSessionId = querySnapshot.docs[0].id;
            await db.collection('participants').doc(studentId).set({
              session_id: actualSessionId,
              display_name: displayName,
              joined_at: admin.firestore.FieldValue.serverTimestamp(),
              attention_score: 100
            }, { merge: true });
            console.log(`✅ [Firestore] Participant ${studentId} (${displayName}) saved to participants collection for session ${actualSessionId}`);
          } else {
            console.warn(`⚠️ [Firestore] Session not found for room code: ${sessionId}`);
          }
        } catch (e) {
          console.error('Failed to save participant to Firestore:', e);
        }
      }
      
      socket.to(sessionId).emit('ts:student_joined', { studentId, displayName, socketId: socket.id });
      logEvent(sessionId, studentId, 'student_joined', { displayName });
    }

    // Mark session as 'live' when the host (teacher) joins
    if (role === 'host' && db) {
      try {
        const sessionsRef = db.collection('sessions');
        const querySnapshot = await sessionsRef.where('room_code', '==', sessionId).limit(1).get();
        if (!querySnapshot.empty && querySnapshot.docs[0]) {
          await sessionsRef.doc(querySnapshot.docs[0].id).update({ status: 'live' });
          console.log(`✅ [Firestore] Session ${sessionId} marked as LIVE`);
        }
      } catch (e) {
        console.error('Failed to mark session as live:', e);
      }
    }

    // Always send the full initial roster to any joining user (especially teachers joining late)
    const currentRoster = participantsByRoom.get(sessionId) || {};
    socket.emit('ts:initial_roster', currentRoster);
  });

  socket.on('ts:distraction', (data) => {
    const { sessionId, studentId } = socket.data;
    if (sessionId) {
      const room = participantsByRoom.get(sessionId);
      if (room && room[studentId]) {
        room[studentId].warningCount = (room[studentId].warningCount || 0) + 1;
      }
      console.log(`⚠️  [Distraction] ${studentId} - type: ${data.type}, warningCount: ${room?.[studentId]?.warningCount}`);
      // Broadcast to ALL in room (including self) so student sees their own alert
      io.to(sessionId).emit('ts:student_alert', { studentId, alertType: 'distraction', warningCount: room?.[studentId]?.warningCount || 0, ...data });
      logEvent(sessionId, studentId, 'distraction', data);
    }
  });

  socket.on('ts:phone_detected', (data) => {
    const { sessionId, studentId } = socket.data;
    if (sessionId) {
      const room = participantsByRoom.get(sessionId);
      if (room && room[studentId]) {
        room[studentId].warningCount = (room[studentId].warningCount || 0) + 1;
      }
      console.log(`📱 [Phone Detected] ${studentId} - confidence: ${data.confidence || 'unknown'}, warningCount: ${room?.[studentId]?.warningCount}`);
      // Broadcast to ALL in room (including self) so student sees their own alert
      io.to(sessionId).emit('ts:student_alert', { studentId, alertType: 'phone_detected', warningCount: room?.[studentId]?.warningCount || 0, ...data });
      logEvent(sessionId, studentId, 'phone_detected', data);
    }
  });

  socket.on('ts:phone_cleared', (data) => {
    const { sessionId, studentId } = socket.data;
    if (sessionId) {
      console.log(`✅ [Phone Cleared] ${studentId}`);
      // Broadcast to ALL in room (including self)
      io.to(sessionId).emit('ts:student_alert', { studentId, alertType: 'phone_cleared', ...data });
      logEvent(sessionId, studentId, 'phone_cleared', data);
    }
  });

  socket.on('ts:chat_message', async (data) => {
    // Use socket.data as primary source; fall back to client-provided sessionId
    // for robustness against reconnects / React StrictMode double-mount scenarios.
    const sessionId: string = socket.data.sessionId || data.sessionId;
    const displayName: string = socket.data.displayName || 'Unknown';
    const role: string = socket.data.role || 'participant';
    const studentId: string = socket.data.studentId || socket.id;

    if (!sessionId || !data.text?.trim()) {
      console.warn(`⚠️ [Chat] Dropped message — sessionId missing for socket ${socket.id}`);
      return;
    }

    // If socket somehow isn't in the room, re-join it now
    if (!socket.rooms.has(sessionId)) {
      console.warn(`⚠️ [Chat] Socket ${socket.id} not in room ${sessionId} — re-joining`);
      socket.join(sessionId);
      // Also restore socket.data so future events work
      socket.data = { ...socket.data, sessionId, displayName, role, studentId };
    }

    const message = {
      id: `${socket.id}-${Date.now()}`,
      senderId: studentId,
      senderName: displayName,
      role: role,
      text: data.text.trim().substring(0, 500),
      timestamp: Date.now()
    };

    io.to(sessionId).emit('ts:chat_message', message);
    console.log(`💬 [Chat] ${displayName} (${role}) in ${sessionId}: "${message.text}"`);
  });

  socket.on('ts:tab_switch', (data) => {
    const { sessionId, studentId } = socket.data;
    if (sessionId) {
      const room = participantsByRoom.get(sessionId);
      if (room && room[studentId]) {
        room[studentId].warningCount = (room[studentId].warningCount || 0) + 1;
      }
      console.log(`⚠️  [Tab Switch] ${studentId} - warningCount: ${room?.[studentId]?.warningCount}`);
      // Broadcast to ALL in room (including self)
      io.to(sessionId).emit('ts:student_alert', { studentId, alertType: 'tab_switch', warningCount: room?.[studentId]?.warningCount || 0, ...data });
      logEvent(sessionId, studentId, 'tab_switch', data);
    }
  });

  socket.on('ts:tab_return', (data) => {
    const { sessionId, studentId } = socket.data;
    if (sessionId) {
      console.log(`✅ [Tab Return] ${studentId}`);
      // Broadcast to ALL in room (including self)
      io.to(sessionId).emit('ts:student_alert', { studentId, alertType: 'tab_return', ...data });
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
      console.debug(`📊 [Attention] ${studentId} - score: ${data.score}%`);
      // Log attention update to Firestore
      logEvent(sessionId, studentId, 'attention_update', { score: data.score });
      // Broadcast to ALL in room
      io.to(sessionId).emit('ts:attention_update', { studentId, warningCount: room?.[studentId]?.warningCount || 0, ...data });
    }
  });

  socket.on('ts:issue_warning', (data) => {
    const { sessionId, role, studentId } = socket.data;
    if (sessionId) {
      // Increment warning count manually issued by teacher
      const room = participantsByRoom.get(sessionId);
      if (room && data.studentId && room[data.studentId]) {
        room[data.studentId].warningCount = (room[data.studentId].warningCount || 0) + 1;
        // Broadcast update
        io.to(sessionId).emit('ts:attention_update', { 
           studentId: data.studentId, 
           score: room[data.studentId].score, 
           warningCount: room[data.studentId].warningCount 
        });
      }
      // Log warning to Firestore
      logEvent(sessionId, data.studentId, 'warning_issued', { message: data.message });
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
      
      // Update participant left_at in Firestore
      if (db) {
        try {
          db.collection('participants').doc(studentId).update({
            left_at: admin.firestore.FieldValue.serverTimestamp()
          }).catch(e => {
            console.error('Failed to update participant left_at:', e);
          });
        } catch (e) {
          console.error('Failed to update participant on disconnect:', e);
        }
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

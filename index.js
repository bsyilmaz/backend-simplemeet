const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      process.env.FRONTEND_URL || 'http://localhost:5173',
      'https://simplemeets.netlify.app',
      'https://simplemeets.netlify.app/'
    ],
    methods: ['GET', 'POST'],
  },
});

app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:5173',
    'https://simplemeets.netlify.app',
    'https://simplemeets.netlify.app/'
  ],
  methods: ['GET', 'POST'],
  credentials: true
}));
app.use(express.json());

// In-memory storage for rooms
const rooms = new Map();

// Room cleanup function (runs every 5 minutes)
const roomCleanupInterval = 5 * 60 * 1000; // 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms.entries()) {
    if (room.users.size === 0 && now - room.lastActive > roomCleanupInterval) {
      console.log(`Room ${roomId} has been inactive for 5 minutes. Removing it.`);
      rooms.delete(roomId);
    }
  }
}, roomCleanupInterval);

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  let currentRoom = null;
  
  // Join room
  socket.on('join-room', ({ roomId, username, password }) => {
    // Check if room exists, if not create it
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        password: password || '',
        users: new Map(),
        lastActive: Date.now(),
      });
      console.log(`Room ${roomId} created with password: ${password ? 'Yes' : 'No'}`);
    }
    
    const room = rooms.get(roomId);
    
    // Validate password if room has one
    if (room.password && room.password !== password) {
      socket.emit('room-join-error', { message: 'Invalid password' });
      return;
    }
    
    // Check if room is full (max 10 users)
    if (room.users.size >= 10) {
      socket.emit('room-join-error', { message: 'Room is full (max 10 users)' });
      return;
    }
    
    // Add user to room
    room.users.set(socket.id, { username, streamId: socket.id });
    room.lastActive = Date.now();
    currentRoom = roomId;
    
    // Join socket.io room
    socket.join(roomId);
    
    // Send list of existing users to new user
    const usersInRoom = Array.from(room.users.entries()).map(([id, user]) => ({
      id,
      username: user.username,
      streamId: user.streamId,
    }));
    
    socket.emit('room-joined', { roomId, users: usersInRoom });
    
    // Notify other users about new user
    socket.to(roomId).emit('user-joined', {
      id: socket.id,
      username,
      streamId: socket.id,
    });
    
    console.log(`User ${username} (${socket.id}) joined room ${roomId}`);
  });
  
  // Handle WebRTC signaling
  socket.on('send-signal', ({ to, signal }) => {
    io.to(to).emit('user-signal', { from: socket.id, signal });
  });
  
  // Handle user disconnect
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    
    if (currentRoom && rooms.has(currentRoom)) {
      const room = rooms.get(currentRoom);
      
      // Remove user from room
      if (room.users.has(socket.id)) {
        const username = room.users.get(socket.id).username;
        room.users.delete(socket.id);
        room.lastActive = Date.now();
        
        // Notify other users about user leaving
        socket.to(currentRoom).emit('user-left', { id: socket.id });
        
        console.log(`User ${username} (${socket.id}) left room ${currentRoom}`);
      }
    }
  });
  
  // Screen sharing status
  socket.on('screen-share-started', () => {
    if (currentRoom) {
      socket.to(currentRoom).emit('user-screen-share-started', { id: socket.id });
    }
  });
  
  socket.on('screen-share-stopped', () => {
    if (currentRoom) {
      socket.to(currentRoom).emit('user-screen-share-stopped', { id: socket.id });
    }
  });
});

// Basic health check endpoint
app.get('/', (req, res) => {
  res.send({ status: 'SimpleMeet Backend Server is running' });
});

// Get active rooms (for debugging)
app.get('/api/rooms', (req, res) => {
  const roomList = Array.from(rooms.entries()).map(([roomId, room]) => ({
    roomId,
    userCount: room.users.size,
    hasPassword: !!room.password,
  }));
  
  res.json({ rooms: roomList });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
}); 
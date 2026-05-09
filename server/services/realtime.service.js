/**
 * Matrix Spins Casino — Realtime Service (Socket.IO)
 *
 * Centralised wiring for the Socket.IO server. Wired from server/index.js
 * after the HTTP server is created. Other services (notifications, support
 * chat) call into this module to push events to the right room.
 *
 * Rooms:
 *   user:<id>     — every authenticated socket joins their own user room
 *   agent         — every authenticated admin/agent socket joins this room
 *   support:<id>  — agent + the conversation owner join when an agent opens it
 */
'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../database');
const support = require('./support-chat.service');

let _io = null;

/**
 * Initialize Socket.IO on the provided HTTP server.
 * @param {http.Server} httpServer
 * @returns {SocketIO.Server}
 */
function init(httpServer) {
  if (_io) return _io;
  let Server;
  try {
    Server = require('socket.io').Server;
  } catch (err) {
    console.warn('[Realtime] socket.io not installed — realtime disabled:', err.message);
    return null;
  }

  const allowed = (() => {
    if (process.env.ALLOWED_ORIGIN) {
      return process.env.ALLOWED_ORIGIN.split(',').map(o => o.trim()).filter(Boolean);
    }
    if (process.env.NODE_ENV === 'production') {
      return ['https://msaart.online', 'https://www.msaart.online'];
    }
    return true; // dev: any origin
  })();

  _io = new Server(httpServer, {
    path: '/socket.io',
    cors: {
      origin: (origin, cb) => {
        if (allowed === true) return cb(null, true);
        if (!origin) return cb(null, true);
        if (Array.isArray(allowed) && allowed.includes(origin)) return cb(null, true);
        if (origin.endsWith && origin.endsWith('.vercel.app')) return cb(null, true);
        return cb(null, false);
      },
      credentials: true,
    },
    pingInterval: 25000,
    pingTimeout: 60000,
  });

  // Auth middleware — token via auth payload OR query string
  _io.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth && socket.handshake.auth.token) || socket.handshake.query.token;
      if (!token) {
        // Anonymous sockets get connection but can only join public rooms (chat lobby).
        socket.user = null;
        return next();
      }
      const payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] });
      const user = await db.get(
        'SELECT id, username, email, is_admin, is_banned FROM users WHERE id = ?',
        [payload.userId]
      );
      if (!user || user.is_banned) {
        socket.user = null;
        return next();
      }
      socket.user = user;
      next();
    } catch (err) {
      socket.user = null;
      next();
    }
  });

  _io.on('connection', (socket) => {
    const u = socket.user;
    if (u) {
      socket.join('user:' + u.id);
      if (u.is_admin) socket.join('agent');
    }

    // Send unread support count for this user on connect
    if (u) {
      support.unreadCountForUser(u.id).then(count => {
        socket.emit('support:unread', { unread: count });
      }).catch(() => {});
    }

    // Heartbeat / ping
    socket.on('ping:client', () => socket.emit('pong:server', { t: Date.now() }));

    // ── Support chat events ────────────────────────────────────
    socket.on('support:join', async () => {
      if (!u) return;
      try {
        const conv = await support.getOrCreateConversation(u.id);
        socket.join('support:' + conv.id);
        socket.emit('support:joined', { conversationId: conv.id });
      } catch (err) {
        socket.emit('support:error', { error: 'Could not join support chat' });
      }
    });

    socket.on('support:typing', async () => {
      if (!u) return;
      try {
        const conv = await support.getOrCreateConversation(u.id);
        socket.to('agent').emit('support:typing', {
          conversationId: conv.id,
          userId: u.id,
          username: u.username,
        });
      } catch (_) {}
    });

    socket.on('support:agent_typing', async (data) => {
      if (!u || !u.is_admin) return;
      const cid = parseInt(data && data.conversationId, 10);
      if (!Number.isFinite(cid)) return;
      try {
        const conv = await support.getConversation(cid);
        if (conv) _io.to('user:' + conv.user_id).emit('support:agent_typing', { conversationId: cid });
      } catch (_) {}
    });

    socket.on('support:agent_join', async (data) => {
      if (!u || !u.is_admin) return;
      const cid = parseInt(data && data.conversationId, 10);
      if (Number.isFinite(cid)) {
        socket.join('support:' + cid);
        socket.emit('support:agent_joined', { conversationId: cid });
      }
    });

    // Disconnect handling — automatic cleanup by socket.io
    socket.on('disconnect', () => {/* nothing extra needed */});
  });

  console.log('[Realtime] Socket.IO initialised on /socket.io');
  return _io;
}

function getIO() {
  return _io;
}

function sendToUser(userId, event, payload) {
  if (!_io) return;
  try {
    _io.to('user:' + userId).emit(event, payload);
  } catch (err) {
    console.warn('[Realtime] sendToUser failed:', err.message);
  }
}

function broadcastToAgents(event, payload) {
  if (!_io) return;
  try {
    _io.to('agent').emit(event, payload);
  } catch (err) {
    console.warn('[Realtime] broadcastToAgents failed:', err.message);
  }
}

function broadcastAll(event, payload) {
  if (!_io) return;
  try { _io.emit(event, payload); } catch (_) {}
}

module.exports = { init, getIO, sendToUser, broadcastToAgents, broadcastAll };

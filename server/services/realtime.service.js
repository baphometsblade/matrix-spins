'use strict';

/**
 * Real-time broadcaster (socket.io)
 *
 * Single source of truth for socket.io. Other modules call:
 *   - attach(httpServer)            once at server start
 *   - broadcastJackpotPools(pools)  on every jackpot contribution / spin tick
 *   - broadcastJackpotWin(payload)  on a confirmed jackpot win
 *
 * If socket.io is unavailable for any reason (module missing, env disabled),
 * all broadcast functions become no-ops so route handlers never crash.
 */

let io = null;
let attached = false;
let lastPoolsHash = '';

function _safe(fn) {
  try { return fn(); } catch (e) { console.warn('[realtime] error:', e.message); return null; }
}

function attach(httpServer) {
  if (attached) return io;
  attached = true;
  if (process.env.DISABLE_SOCKET_IO === '1') {
    console.warn('[realtime] socket.io disabled via env');
    return null;
  }
  let SocketIOServer;
  try { SocketIOServer = require('socket.io').Server; }
  catch (e) {
    console.warn('[realtime] socket.io not installed:', e.message);
    return null;
  }
  io = new SocketIOServer(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling'],
    pingInterval: 25000,
    pingTimeout: 60000,
  });
  io.on('connection', (socket) => {
    socket.emit('hello', { t: Date.now() });
    socket.on('subscribe:jackpots', () => socket.join('jackpots'));
    socket.on('unsubscribe:jackpots', () => socket.leave('jackpots'));
  });
  console.log('[realtime] socket.io attached');
  return io;
}

function broadcastJackpotPools(pools) {
  if (!io) return;
  _safe(() => {
    // Skip identical broadcasts to reduce socket noise
    const hash = JSON.stringify(pools);
    if (hash === lastPoolsHash) return;
    lastPoolsHash = hash;
    io.to('jackpots').emit('jackpot:pools', { pools, t: Date.now() });
  });
}

function broadcastJackpotWin(payload) {
  if (!io) return;
  _safe(() => {
    // Win goes to ALL clients (not just /jackpots room) — site-wide celebration
    io.emit('jackpot:win', { ...payload, t: Date.now() });
  });
}

function broadcastBonusGranted(userId, payload) {
  if (!io || !userId) return;
  _safe(() => {
    io.emit('bonus:granted:' + userId, { ...payload, t: Date.now() });
  });
}

function isAttached() { return !!io; }

module.exports = {
  attach,
  broadcastJackpotPools,
  broadcastJackpotWin,
  broadcastBonusGranted,
  isAttached,
};

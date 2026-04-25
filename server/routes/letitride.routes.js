const _crypto = require('crypto');
function secureFloat() { return _crypto.randomBytes(4).readUInt32BE(0) / 0x100000000; }
function secureInt(n) { return _crypto.randomInt(n); }

'use strict';

// Let It Ride
// Player posts 3 equal "spot" bets (1, 2, 3).
// Receives 3 cards.  Two community cards revealed one at a time.
// After seeing 3 cards: can pull back Bet-1 or "let it ride".
// After community card 1 revealed: can pull back Bet-2 or "let it ride".
// Bet-3 always stays.
// Final 5-card hand (3 player + 2 community) pays paytable on EACH
// remaining bet.
//
// Paytable (each active bet pays):
//   Royal Flush    1000:1
//   Straight Flush  200:1
//   Four of a Kind   50:1
//   Full House       11:1
//   Flush             8:1
//   Straight          5:1
//   Three of a Kind   3:1
//   Two Pair          2:1
//   Pair 10s or better 1:1
//   Below pair         0  (lose bet)
//
// Endpoints:
//   POST /api/letitride/deal     { bet }         → { playerCards, gameId }
//   POST /api/letitride/decide1  { gameId, pullBack: bool } → { community1 }
//   POST /api/letitride/decide2  { gameId, pullBack: bool } → { community2, result, payouts... }

const express  = require('express');
const router   = express.Router();
const db       = require('../database');
const { authenticate } = require('../middleware/auth');

const MIN_BET  = 0.50;
const MAX_BET  = 100;   // per spot; total 3x

const RANKS  = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const SUITS  = ['\u2660','\u2665','\u2666','\u2663'];
const VALUES = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,J:11,Q:12,K:13,A:14 };

function buildDeck() {
  var deck = [];
  SUITS.forEach(function(s) { RANKS.forEach(function(r) { deck.push({ rank:r, suit:s, value:VALUES[r] }); }); });
  return deck;
}
function shuffle(d) {
  for (var i = d.length-1; i > 0; i--) { var j=secureInt((i+1)); var t=d[i]; d[i]=d[j]; d[j]=t; }
  return d;
}

// ── 5-card evaluator ──────────────────────────────────────────────────────────
function eval5(cards) {
  var vals  = cards.map(function(c){return c.value;}).sort(function(a,b){return b-a;});
  var suits = cards.map(function(c){return c.suit;});
  var rc = {};
  vals.forEach(function(v){ rc[v]=(rc[v]||0)+1; });
  var cnts = Object.values(rc).sort(function(a,b){return b-a;});
  var isFlush = suits.every(function(s){return s===suits[0];});
  var uvs = Object.keys(rc).map(Number).sort(function(a,b){return b-a;});
  var isStraight = false;
  if (uvs.length===5) {
    if (uvs[0]-uvs[4]===4) isStraight=true;
    if (uvs[0]===14&&uvs[1]===5&&uvs[2]===4&&uvs[3]===3&&uvs[4]===2) isStraight=true;
  }
  if (isFlush && isStraight) {
    var name = vals[0]===14&&vals[1]===13 ? 'Royal Flush' : 'Straight Flush';
    return { rank: name==='Royal Flush'?9:7, name:name };
  }
  if (cnts[0]===4) return { rank:6, name:'Four of a Kind' };
  if (cnts[0]===3&&cnts[1]===2) return { rank:5, name:'Full House' };
  if (isFlush)    return { rank:4, name:'Flush' };
  if (isStraight) return { rank:3, name:'Straight' };
  if (cnts[0]===3) return { rank:2, name:'Three of a Kind' };
  if (cnts[0]===2&&cnts[1]===2) return { rank:1, name:'Two Pair' };
  if (cnts[0]===2) {
    // find the pair value
    var pairVal = parseInt(Object.keys(rc).find(function(k){return rc[k]===2;}));
    if (pairVal >= 10) return { rank:0, name:'Pair (Tens or Better)' };
    return { rank:-1, name:'Pair (below Tens)' };
  }
  return { rank:-2, name:'High Card' };
}

// Paytable: rank → multiplier (pays X:1, so payout = bet * (mult+1))
var PAYTABLE = { 9:1000, 7:200, 6:50, 5:11, 4:8, 3:5, 2:3, 1:2, 0:1 };
// rank -1 and -2 pay 0

var _games = {};
var GAME_TTL = 10*60*1000;
function cleanGames() {
  var now=Date.now(); Object.keys(_games).forEach(function(id){ if(now-_games[id].ts>GAME_TTL) delete _games[id]; });
}
function newGameId() { return _crypto.randomBytes(6).toString('hex')+Date.now().toString(36); }

// ── POST /deal ────────────────────────────────────────────────────────────────

router.post('/deal', authenticate, async function(req, res) {
  try {
    cleanGames();
    const userId = req.user.id;
    const bet    = parseFloat(req.body.bet);
    if (isNaN(bet)||bet<MIN_BET||bet>MAX_BET) {
      return res.status(400).json({ error:'Bet per spot must be $'+MIN_BET+'\u2013$'+MAX_BET });
    }
    const user = await db.get('SELECT balance FROM users WHERE id=?',[userId]);
    if (!user) return res.status(404).json({ error:'User not found' });
    if (parseFloat(user.balance) < bet*3) return res.status(400).json({ error:'Insufficient balance' });

    await db.run('UPDATE users SET balance=balance-? WHERE id=?',[bet*3,userId]);

    var deck = shuffle(buildDeck());
    var gameId = newGameId();
    _games[gameId] = {
      userId:  userId,
      bet:     bet,
      active:  [true,true,true],  // bets 1,2,3 active flags
      player:  [deck[0],deck[1],deck[2]],
      comm:    [deck[3],deck[4]],
      ts:      Date.now(),
      phase:   1,   // 1=after deal, 2=after comm1, 3=done
      over:    false,
    };
    return res.json({ success:true, gameId:gameId, playerCards:[deck[0],deck[1],deck[2]] });
  } catch(err) {
    console.error('[LIR] /deal error:',err.message);
    return res.status(500).json({ error:'Failed to deal' });
  }
});

// ── POST /decide1 — after 3 player cards, before community card 1 ─────────────

router.post('/decide1', authenticate, async function(req, res) {
  try {
    const userId   = req.user.id;
    const gameId   = req.body.gameId;
    const pullBack = !!req.body.pullBack;
    if (!gameId||!_games[gameId]) return res.status(400).json({ error:'Game not found' });
    const game = _games[gameId];
    if (game.userId!==userId) return res.status(403).json({ error:'Not your game' });
    if (game.over||game.phase!==1) return res.status(400).json({ error:'Invalid phase' });

    if (pullBack) {
      // Return bet-1 to player immediately
      game.active[0] = false;
      await db.run('UPDATE users SET balance=balance+? WHERE id=?',[game.bet,userId]);
    }
    game.phase = 2;

    return res.json({ success:true, community1:game.comm[0], pulledBack:pullBack });
  } catch(err) {
    console.error('[LIR] /decide1 error:',err.message);
    return res.status(500).json({ error:'Failed to process decision' });
  }
});

// ── POST /decide2 — after community card 1, before community card 2 ───────────

router.post('/decide2', authenticate, async function(req, res) {
  try {
    const userId   = req.user.id;
    const gameId   = req.body.gameId;
    const pullBack = !!req.body.pullBack;
    if (!gameId||!_games[gameId]) return res.status(400).json({ error:'Game not found' });
    const game = _games[gameId];
    if (game.userId!==userId) return res.status(403).json({ error:'Not your game' });
    if (game.over||game.phase!==2) return res.status(400).json({ error:'Invalid phase' });

    if (pullBack) {
      game.active[1] = false;
      await db.run('UPDATE users SET balance=balance+? WHERE id=?',[game.bet,userId]);
    }
    game.phase = 3;
    game.over  = true;

    // Evaluate final 5-card hand
    var five = game.player.concat(game.comm);
    var hand  = eval5(five);
    var mult  = PAYTABLE[hand.rank] || 0;

    var payout = 0;
    var activeBets = game.active.filter(Boolean).length;
    // Each active bet wins mult:1 (or loses)
    if (mult > 0) {
      payout = game.bet * activeBets * (mult + 1);
    }
    // Inactive (pulled-back) bets were already returned; count those as returned
    var returned = game.active.filter(function(a){return !a;}).length * game.bet;
    var totalIn  = game.bet * 3;  // original deduction
    var netPayout = payout; // pulled-back already returned
    var profit    = parseFloat((payout + returned - totalIn).toFixed(2));

    if (payout > 0) {
      await db.run('UPDATE users SET balance=balance+? WHERE id=?',[payout,userId]);
    }
    if (profit > 0) {
      await db.run(
        "INSERT INTO transactions (user_id,type,amount,description) VALUES (?,'win',?,?)",
        [userId,profit,'Let It Ride: '+hand.name+' x'+activeBets+' bets']
      ).catch(function(){});
    }

    delete _games[gameId];

    const u = await db.get('SELECT balance FROM users WHERE id=?',[userId]);
    return res.json({
      success:    true,
      community2: game.comm[1],
      allCards:   five,
      hand:       { name:hand.name, rank:hand.rank },
      multiplier: mult,
      activeBets: activeBets,
      payout:     parseFloat(payout.toFixed(2)),
      profit:     profit,
      newBalance: u ? parseFloat(u.balance) : null,
    });
  } catch(err) {
    console.error('[LIR] /decide2 error:',err.message);
    return res.status(500).json({ error:'Failed to process decision' });
  }
});

module.exports = router;

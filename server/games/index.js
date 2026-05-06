'use strict';

/**
 * Game registry. Each live, server-authoritative slot lives in its own
 * module under this directory and exports a uniform shape:
 *
 *   {
 *     id, name, reels, paytable,
 *     min_bet_cents, max_bet_cents, rtp,
 *     evaluate(stops, betCents) -> { win_cents, line }
 *   }
 *
 * Adding a new game is two steps:
 *   1. Create server/games/<id>.js exporting the shape above.
 *   2. Import it in this index.
 *
 * The slot engine (server/services/slot-engine.service.js) consumes
 * games strictly through this registry — there is no per-game branching
 * in the engine, so each module can be audited in isolation against
 * its declared RTP.
 */

const classic777 = require('./classic_777');
const neonBurst = require('./neon_burst');
const luckyDiamond = require('./lucky_diamond');
const royalSeven = require('./royal_seven');

const REGISTRY = Object.freeze({
    [classic777.id]: classic777,
    [neonBurst.id]: neonBurst,
    [luckyDiamond.id]: luckyDiamond,
    [royalSeven.id]: royalSeven,
});

function get(id) {
    return REGISTRY[id] || null;
}

function has(id) {
    return Object.prototype.hasOwnProperty.call(REGISTRY, id);
}

function ids() {
    return Object.keys(REGISTRY);
}

function all() {
    return ids().map((id) => REGISTRY[id]);
}

module.exports = { get, has, ids, all };

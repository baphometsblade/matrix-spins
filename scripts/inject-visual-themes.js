#!/usr/bin/env node
/**
 * inject-visual-themes.js
 * ───────────────────────────────────────────────────────────────────────────
 * Gives every slot game a COMPLETELY DISTINCT visual identity. The slot UI is
 * one shared engine (js/casino-engine.js), but each game page now carries a
 * `visualTheme` block inside its gameConfig that the engine's
 * _applyVisualTheme() reads to skin that game uniquely:
 *
 *   • palette        — primary / secondary / accent / win-highlight hues
 *   • frame          — reel-frame material (gold, silver, wood, crystal, neon,
 *                      stone, jade, obsidian, bamboo, copper, ice, bone,
 *                      coral, velvet)
 *   • spin           — spin-button shape (round, hex, gem, shield, diamond,
 *                      ring, pulsar)
 *   • symAnim        — symbol-landing animation (bounce, spin, flip, pulse,
 *                      shimmer, grow, wobble)
 *   • winLine        — win-line color + style (solid, neon, dashed, dotted)
 *   • particle       — one of ~15 ambient canvas particle types
 *   • bgGradient     — atmospheric scrim behind the reels
 *
 * Games are bucketed into themed categories (Egyptian, Fantasy, Nature, Ocean,
 * Space, Fire, Asian, Horror, Romance, Fruit/Classic, Outback, Western,
 * Carnival, Steampunk, …). Within a category, each game gets a deterministic
 * but well-spread pick of palette / particle / frame / spin / symAnim so no
 * two games — even neighbours in the same category — look the same.
 *
 * Idempotent: re-running replaces the previously-injected block. Only touches
 * game HTMLs that boot the slot engine (CasinoEngine.init).
 *
 *   node scripts/inject-visual-themes.js          # inject all
 *   node scripts/inject-visual-themes.js --dry     # report only, write nothing
 *   node scripts/inject-visual-themes.js <slug>    # single game
 */
'use strict';

const fs = require('fs');
const path = require('path');

const GAMES_DIR = path.join(__dirname, '..', 'games');

// ── Deterministic per-slug variation ──────────────────────────────────────
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function pick(arr, slug, salt) { return arr[hash(slug + '|' + salt) % arr.length]; }

// ── Particle colors keyed by particle type (overridable per kit) ───────────
const PARTICLE_COLORS = {
  embers: ['#ff6a00', '#ff3d00', '#ffb300'],
  snow: ['#ffffff', '#e8f4ff', '#cfe9ff'],
  blossom: ['#ffb7d5', '#ff8fab', '#ffd1e0'],
  coins: ['#ffd700', '#ffe066', '#f0c75e'],
  bubbles: ['#bdf0ff', '#8fe0ff', '#ffffff'],
  stars: ['#ffffff', '#fff2b3', '#b3e5ff'],
  leaves: ['#6a994e', '#a7c957', '#bc6c25', '#dda15e'],
  fireflies: ['#d4ff6a', '#aaff66', '#fff07c'],
  fog: ['#9fb3c8', '#c9d6e3', '#aab8c8'],
  aurora: ['#5de0e6', '#9b6bff', '#39ff8b'],
  caustics: ['#7fe7ff', '#bdf0ff', '#9fefff'],
  rain: ['#9fb3c8', '#c9d6e3', '#86a8c8'],
  matrix: ['#00ff41', '#39ff6a', '#1aff5a'],
  dust: ['#e0c9a6', '#d9b88a', '#cdb48a'],
  sparkles: ['#ffffff', '#fff2b3', '#ffe066'],
};

// ── Themed style kits ──────────────────────────────────────────────────────
// Each kit: palettes [primary, secondary, accent, win], plus the candidate
// frames / spins / symAnims / particles to spread across that category's games.
const KITS = {
  egyptian: {
    bg: 'linear-gradient(180deg, rgba(46,30,8,.55) 0%, rgba(22,15,4,.86) 100%)',
    palettes: [
      ['#E6B422', '#F2D472', '#39C5BB', '#FFE066'],
      ['#D4A017', '#F0C75E', '#C84B31', '#FFD700'],
      ['#C9A227', '#E8D08B', '#2E8B9E', '#FFDF6B'],
      ['#B8860B', '#E3C16F', '#7FC8A9', '#FFE08A'],
      ['#CFA456', '#EAD49A', '#D9603A', '#FFE07A'],
    ],
    particles: ['coins', 'dust', 'sparkles'],
    frames: ['gold', 'bone', 'stone'],
    spins: ['gem', 'round', 'ring'],
    symAnims: ['grow', 'pulse', 'shimmer'],
    winLine: { style: 'solid', glow: 7 },
  },
  greek: {
    bg: 'linear-gradient(180deg, rgba(30,34,46,.5) 0%, rgba(14,16,24,.86) 100%)',
    palettes: [
      ['#E8E2D0', '#C9B370', '#3D7EAA', '#FFD86B'],
      ['#D9CBA3', '#B98D3E', '#5A8FB0', '#F4E1A6'],
      ['#EFE7D2', '#C2A45C', '#2E6E8E', '#FFE08A'],
    ],
    particles: ['dust', 'sparkles', 'coins'],
    frames: ['stone', 'bone', 'gold'],
    spins: ['shield', 'round', 'gem'],
    symAnims: ['grow', 'pulse'],
    winLine: { style: 'solid', glow: 7 },
  },
  fantasy: {
    bg: 'linear-gradient(180deg, rgba(36,20,52,.55) 0%, rgba(16,10,28,.88) 100%)',
    palettes: [
      ['#9B59B6', '#C39BD3', '#5DE0E6', '#E6C9FF'],
      ['#7E57C2', '#B39DDB', '#64FFDA', '#D1B3FF'],
      ['#6A4C93', '#A06CD5', '#4DD0E1', '#C8A2FF'],
      ['#8E44AD', '#BB6BD9', '#56CCF2', '#E0AAFF'],
      ['#5C6BC0', '#9FA8DA', '#80DEEA', '#C5CAE9'],
    ],
    particles: ['fireflies', 'sparkles', 'stars'],
    frames: ['crystal', 'neon', 'obsidian'],
    spins: ['gem', 'diamond', 'ring'],
    symAnims: ['shimmer', 'spin', 'grow'],
    winLine: { style: 'neon', glow: 8 },
  },
  darkmagic: {
    bg: 'linear-gradient(180deg, rgba(18,28,16,.6) 0%, rgba(10,8,18,.9) 100%)',
    palettes: [
      ['#39FF14', '#7CFC00', '#9B30FF', '#B6FF9E'],
      ['#7B2FBE', '#B14EFF', '#39FF6A', '#C77DFF'],
      ['#5D8C3F', '#A2D45E', '#6A0DAD', '#C8FF9E'],
      ['#2EA043', '#56D364', '#A371F7', '#7EE787'],
    ],
    particles: ['fog', 'fireflies', 'sparkles'],
    frames: ['obsidian', 'crystal', 'stone'],
    spins: ['gem', 'diamond', 'shield'],
    symAnims: ['flip', 'shimmer', 'wobble'],
    winLine: { style: 'neon', glow: 9 },
  },
  nature: {
    bg: 'linear-gradient(180deg, rgba(18,38,20,.5) 0%, rgba(8,20,10,.85) 100%)',
    palettes: [
      ['#4CAF50', '#8BC34A', '#FFC107', '#C5F26B'],
      ['#2E7D32', '#66BB6A', '#FFD54F', '#A5D86E'],
      ['#3B7A57', '#7BB661', '#E6B800', '#B6E388'],
      ['#558B2F', '#9CCC65', '#FFCA28', '#CCFF90'],
    ],
    particles: ['leaves', 'fireflies', 'blossom'],
    frames: ['wood', 'jade', 'bamboo'],
    spins: ['round', 'gem', 'shield'],
    symAnims: ['grow', 'wobble', 'pulse'],
    winLine: { style: 'solid', glow: 7 },
  },
  animal: {
    bg: 'linear-gradient(180deg, rgba(40,28,14,.5) 0%, rgba(18,12,6,.85) 100%)',
    palettes: [
      ['#C77D34', '#E0A458', '#3C6E47', '#FFD27F'],
      ['#A0522D', '#D2956B', '#6B8E23', '#F0C27B'],
      ['#8B5A2B', '#C68642', '#4F7942', '#E8B873'],
      ['#B5651D', '#E0A458', '#2E7D52', '#FFCF87'],
    ],
    particles: ['dust', 'leaves', 'sparkles'],
    frames: ['wood', 'stone', 'copper'],
    spins: ['round', 'shield', 'gem'],
    symAnims: ['pulse', 'grow', 'wobble'],
    winLine: { style: 'solid', glow: 7 },
  },
  predator: { // night-hunting animals — darker palette
    bg: 'linear-gradient(180deg, rgba(14,16,24,.6) 0%, rgba(6,7,12,.9) 100%)',
    palettes: [
      ['#7E57C2', '#B39DDB', '#FFC400', '#D1B3FF'],
      ['#455A64', '#90A4AE', '#FFB300', '#CFD8DC'],
      ['#5D4037', '#A1887F', '#FFCA28', '#D7CCC8'],
    ],
    particles: ['fireflies', 'fog', 'sparkles'],
    frames: ['obsidian', 'stone', 'silver'],
    spins: ['gem', 'diamond', 'shield'],
    symAnims: ['flip', 'pulse', 'wobble'],
    winLine: { style: 'neon', glow: 8 },
  },
  ocean: {
    bg: 'linear-gradient(180deg, rgba(8,40,60,.55) 0%, rgba(4,18,32,.88) 100%)',
    palettes: [
      ['#1CA9C9', '#5FD3E0', '#FFB347', '#7FE7FF'],
      ['#0E7C9B', '#39C5E0', '#FFD166', '#9BE7FF'],
      ['#1B6CA8', '#3FC1C9', '#F5A623', '#86E3FF'],
      ['#2196A6', '#64DFDF', '#FF9E5E', '#B3F0FF'],
    ],
    particles: ['bubbles', 'caustics', 'fog'],
    frames: ['coral', 'crystal', 'jade'],
    spins: ['round', 'gem', 'diamond'],
    symAnims: ['wobble', 'pulse', 'grow'],
    winLine: { style: 'solid', color: '#7FE7FF', glow: 8 },
  },
  space: {
    bg: 'linear-gradient(180deg, rgba(10,12,30,.55) 0%, rgba(4,5,16,.92) 100%)',
    palettes: [
      ['#00E5FF', '#7C4DFF', '#FF4081', '#80FFEA'],
      ['#2979FF', '#00E5FF', '#E040FB', '#82B1FF'],
      ['#536DFE', '#18FFFF', '#FF6E40', '#84FFFF'],
      ['#7C4DFF', '#00B0FF', '#1DE9B6', '#B388FF'],
      ['#26C6DA', '#5C6BC0', '#FF7043', '#80DEEA'],
    ],
    particles: ['stars', 'aurora', 'sparkles', 'matrix'],
    frames: ['neon', 'obsidian', 'crystal'],
    spins: ['hex', 'diamond', 'pulsar'],
    symAnims: ['flip', 'spin', 'shimmer'],
    winLine: { style: 'neon', glow: 9 },
    particleFromPalette: true,
  },
  cyber: { // quantum / robot / clockwork tech
    bg: 'linear-gradient(180deg, rgba(6,20,16,.6) 0%, rgba(2,8,10,.92) 100%)',
    palettes: [
      ['#00FF9C', '#00E5FF', '#FF4081', '#7CFFCB'],
      ['#18FFFF', '#536DFE', '#FFD740', '#84FFFF'],
      ['#00E676', '#1DE9B6', '#FF6E40', '#69F0AE'],
    ],
    particles: ['matrix', 'stars', 'sparkles'],
    frames: ['neon', 'obsidian', 'silver'],
    spins: ['hex', 'ring', 'pulsar'],
    symAnims: ['spin', 'flip', 'shimmer'],
    winLine: { style: 'dashed', glow: 8 },
  },
  fire: {
    bg: 'linear-gradient(180deg, rgba(48,12,8,.55) 0%, rgba(22,5,4,.9) 100%)',
    palettes: [
      ['#FF3D00', '#FF8A00', '#FFC400', '#FF6E40'],
      ['#E53935', '#FF7043', '#FFCA28', '#FF8A65'],
      ['#C62828', '#FF5722', '#FFB300', '#FF7043'],
      ['#FF5252', '#FF9100', '#FFD740', '#FF8A80'],
    ],
    particles: ['embers', 'sparkles', 'fog'],
    frames: ['obsidian', 'copper', 'stone'],
    spins: ['gem', 'ring', 'diamond'],
    symAnims: ['pulse', 'shimmer', 'grow'],
    winLine: { style: 'neon', color: '#FF8A00', glow: 9 },
  },
  asian: {
    bg: 'linear-gradient(180deg, rgba(48,14,16,.55) 0%, rgba(24,6,8,.88) 100%)',
    palettes: [
      ['#E63946', '#F4A261', '#E9C46A', '#FFD56B'],
      ['#C1121F', '#E76F51', '#FFD60A', '#FF8FA3'],
      ['#B22222', '#E09F3E', '#F2C14E', '#FFB3C1'],
      ['#D62828', '#F77F00', '#FCBF49', '#FFD6A5'],
    ],
    particles: ['blossom', 'coins', 'sparkles'],
    frames: ['jade', 'bamboo', 'gold'],
    spins: ['round', 'gem', 'ring'],
    symAnims: ['grow', 'wobble', 'pulse'],
    winLine: { style: 'solid', color: '#FFD60A', glow: 8 },
  },
  jade: { // jade-emperor / koi-garden — green-gold asian
    bg: 'linear-gradient(180deg, rgba(10,36,26,.55) 0%, rgba(4,18,12,.88) 100%)',
    palettes: [
      ['#2FB98A', '#7FF0C4', '#FFD60A', '#A8FFE0'],
      ['#149C6E', '#3FD6A0', '#F2C14E', '#86F0C8'],
    ],
    particles: ['blossom', 'sparkles', 'bubbles'],
    frames: ['jade', 'bamboo', 'gold'],
    spins: ['gem', 'round'],
    symAnims: ['grow', 'wobble'],
    winLine: { style: 'solid', color: '#FFD60A', glow: 8 },
  },
  steampunk: {
    bg: 'linear-gradient(180deg, rgba(40,28,16,.6) 0%, rgba(20,14,8,.9) 100%)',
    palettes: [
      ['#B87333', '#D9A05B', '#3FB0AC', '#E8C07D'],
      ['#A97142', '#C9A66B', '#5BC0BE', '#E0B973'],
      ['#9C6B3F', '#CDA06B', '#4FB0A8', '#E6C290'],
    ],
    particles: ['dust', 'embers', 'fog'],
    frames: ['copper', 'wood', 'stone'],
    spins: ['ring', 'hex', 'gem'],
    symAnims: ['spin', 'wobble', 'pulse'],
    winLine: { style: 'dashed', color: '#E8C07D', glow: 7 },
  },
  horror: {
    bg: 'linear-gradient(180deg, rgba(16,18,16,.62) 0%, rgba(6,7,8,.92) 100%)',
    palettes: [
      ['#6B8E23', '#9CCC65', '#7E57C2', '#B6FF9E'],
      ['#4A5D23', '#8D9440', '#9C27B0', '#C5E1A5'],
      ['#37474F', '#78909C', '#AB47BC', '#B0BEC5'],
      ['#546E7A', '#90A4AE', '#7E57C2', '#CFD8DC'],
    ],
    particles: ['fog', 'fireflies', 'rain'],
    frames: ['bone', 'obsidian', 'stone'],
    spins: ['shield', 'gem', 'diamond'],
    symAnims: ['flip', 'wobble', 'pulse'],
    winLine: { style: 'dotted', glow: 7 },
  },
  undead: { // vampire / zombie / skeleton — blood + rot
    bg: 'linear-gradient(180deg, rgba(28,8,10,.6) 0%, rgba(10,4,5,.92) 100%)',
    palettes: [
      ['#B71C1C', '#E53935', '#7CB342', '#FF8A80'],
      ['#7CB342', '#AEEA00', '#B71C1C', '#CCFF90'],
      ['#8E0000', '#D32F2F', '#9E9E9E', '#FF5252'],
    ],
    particles: ['fog', 'embers', 'rain'],
    frames: ['bone', 'obsidian', 'velvet'],
    spins: ['gem', 'shield', 'diamond'],
    symAnims: ['flip', 'pulse', 'wobble'],
    winLine: { style: 'dotted', color: '#FF5252', glow: 8 },
  },
  romance: {
    bg: 'linear-gradient(180deg, rgba(40,8,24,.55) 0%, rgba(20,4,12,.9) 100%)',
    palettes: [
      ['#C2185B', '#F06292', '#FFD54F', '#FF8FB3'],
      ['#8E0038', '#D81B60', '#E6B800', '#FF6F91'],
      ['#B71C4A', '#E91E63', '#FFC107', '#FF85A1'],
      ['#AD1457', '#EC407A', '#FFD740', '#FF94B8'],
    ],
    particles: ['sparkles', 'blossom', 'fireflies'],
    frames: ['velvet', 'crystal', 'gold'],
    spins: ['gem', 'diamond', 'ring'],
    symAnims: ['shimmer', 'pulse', 'grow'],
    winLine: { style: 'neon', color: '#FF6F91', glow: 8 },
  },
  neonnight: { // neon-temptation / vixen-noir / high-roller — electric night
    bg: 'linear-gradient(180deg, rgba(10,8,24,.55) 0%, rgba(4,4,12,.92) 100%)',
    palettes: [
      ['#FF2D95', '#00E5FF', '#FFE600', '#FF7AC6'],
      ['#FF00A0', '#7C4DFF', '#00E5FF', '#FF6AD5'],
      ['#E040FB', '#18FFFF', '#FFD740', '#EA80FC'],
    ],
    particles: ['sparkles', 'stars', 'fireflies'],
    frames: ['neon', 'obsidian', 'crystal'],
    spins: ['ring', 'gem', 'pulsar'],
    symAnims: ['shimmer', 'spin', 'pulse'],
    winLine: { style: 'neon', glow: 9 },
  },
  fruit: {
    bg: 'linear-gradient(180deg, rgba(20,30,40,.5) 0%, rgba(8,14,20,.85) 100%)',
    palettes: [
      ['#E63946', '#FFB703', '#06D6A0', '#FFD166'],
      ['#FB8500', '#FFB703', '#8ECAE6', '#FFE066'],
      ['#EF476F', '#FFD166', '#06D6A0', '#FFE08A'],
      ['#FF5DA2', '#FFD23F', '#3BCEAC', '#FFE066'],
    ],
    particles: ['sparkles', 'coins', 'stars'],
    frames: ['gold', 'silver', 'crystal'],
    spins: ['round', 'gem', 'ring'],
    symAnims: ['grow', 'pulse', 'wobble'],
    winLine: { style: 'solid', glow: 7 },
  },
  deco: { // art-deco / vintage / diamond — silver-gold glamour
    bg: 'linear-gradient(180deg, rgba(20,20,26,.55) 0%, rgba(8,8,12,.9) 100%)',
    palettes: [
      ['#D4AF37', '#F5D76E', '#1B998B', '#FFE066'],
      ['#C0C0C0', '#E8E8E8', '#D4AF37', '#F5F5F5'],
      ['#B8A06A', '#E6D4A0', '#2E8B9E', '#FFE08A'],
    ],
    particles: ['sparkles', 'stars', 'coins'],
    frames: ['silver', 'gold', 'crystal'],
    spins: ['gem', 'diamond', 'ring'],
    symAnims: ['shimmer', 'grow', 'pulse'],
    winLine: { style: 'neon', glow: 8 },
  },
  outback: {
    bg: 'linear-gradient(180deg, rgba(54,28,10,.55) 0%, rgba(28,14,6,.88) 100%)',
    palettes: [
      ['#CC5500', '#E08E45', '#3C6E47', '#F0B27A'],
      ['#B7410E', '#D98E04', '#5B8C5A', '#E8A87C'],
      ['#A0522D', '#CD853F', '#6B8E23', '#E0A96D'],
    ],
    particles: ['dust', 'leaves', 'sparkles'],
    frames: ['wood', 'stone', 'bone'],
    spins: ['round', 'shield', 'gem'],
    symAnims: ['grow', 'wobble', 'pulse'],
    winLine: { style: 'solid', color: '#F0B27A', glow: 7 },
  },
  western: {
    bg: 'linear-gradient(180deg, rgba(44,30,16,.55) 0%, rgba(22,15,8,.88) 100%)',
    palettes: [
      ['#A0522D', '#DEB887', '#8B4513', '#F0C27B'],
      ['#8B5A2B', '#C19A6B', '#B22222', '#E8B873'],
    ],
    particles: ['dust', 'embers', 'sparkles'],
    frames: ['wood', 'copper', 'stone'],
    spins: ['shield', 'ring', 'round'],
    symAnims: ['pulse', 'grow', 'wobble'],
    winLine: { style: 'dashed', color: '#F0C27B', glow: 7 },
  },
  carnival: {
    bg: 'linear-gradient(180deg, rgba(30,10,40,.5) 0%, rgba(14,5,20,.88) 100%)',
    palettes: [
      ['#FF4081', '#FFD740', '#40C4FF', '#FF80AB'],
      ['#F50057', '#FFEA00', '#00E5FF', '#FF8A80'],
      ['#D500F9', '#FFC400', '#1DE9B6', '#EA80FC'],
    ],
    particles: ['sparkles', 'stars', 'coins'],
    frames: ['neon', 'gold', 'crystal'],
    spins: ['ring', 'gem', 'round'],
    symAnims: ['wobble', 'pulse', 'spin'],
    winLine: { style: 'neon', glow: 9 },
  },
  holy: { // paladin — radiant gold + sky blue
    bg: 'linear-gradient(180deg, rgba(28,30,44,.5) 0%, rgba(12,14,24,.86) 100%)',
    palettes: [
      ['#F4D35E', '#FFE9A8', '#4D96FF', '#FFF1C1'],
      ['#FFD166', '#FFE3A3', '#3D7EAA', '#FFF0C9'],
    ],
    particles: ['sparkles', 'stars', 'fireflies'],
    frames: ['gold', 'crystal', 'silver'],
    spins: ['shield', 'gem', 'ring'],
    symAnims: ['grow', 'shimmer', 'pulse'],
    winLine: { style: 'neon', color: '#FFE9A8', glow: 8 },
  },
};

// Generic premium fallback (should not be hit — logged if it is).
const FALLBACK = 'fruit';

// ── Slug → category. Ordered, first match wins; specific before generic. ────
const RULES = [
  [/anubis|bastet|cleopatra|horus|isis|osiris|pharaoh|^ra-|sun-god|set-chaos|thoth|sphinx|scarab|dynasty/, 'egyptian'],
  [/athena|minotaur|olympus|zeus|poseidon/, 'greek'],
  [/paladin|holy/, 'holy'],
  [/koi|reef|shark|underwater|coral|mermaid|siren|pirate|billabong.*water/, 'ocean'],
  [/jade-emperor|moonlit-koi/, 'jade'],
  [/cherry-blossom|dragon|geisha|imperial|ninja|pagoda|lantern|silk-road|tigers-golden|red-lantern/, 'asian'],
  [/clockwork|steampunk|gears|cannonball|express/, 'steampunk'],
  [/quantum|robot|singularity|pulsar|stellar|nexus-prime|void-vault|cyber/, 'cyber'],
  [/alien|asteroid|cosmic|galaxy|meteor|nebula|space|stellar-collapse|raider/, 'space'],
  [/demon|inferno|reaper|darkness|phoenix|tango/, 'fire'],
  [/vampire|zombie|skeleton|bone-collector/, 'undead'],
  [/banshee|cursed|ghost|haunted|witch|necromancer|dark-sorcerer/, 'horror'],
  [/alchemist|bard|druid|elven|enchant|fairy|mage|merlin|sorcerer|wizard|crystal-ball|crystal-sanctuary|golem|grove|spellbook/, 'fantasy'],
  [/neon-temptation|vixen|high-roller|after-dark|velvet|noir/, 'neonnight'],
  [/casanova|cabaret|boudoir|diamonds-and-lace|goddess|masquerade|tryst|passion|scarlet|seduction|whisper|temptation|crimson/, 'romance'],
  [/aboriginal|boomerang|crocodile|dingo|kangaroo|outback|koala|dreamtime|billabong/, 'outback'],
  [/cowboy|frontier|western|showdown|bounty/, 'western'],
  [/carnival|circus|spectacular/, 'carnival'],
  [/artdeco|art-deco|diamond-deco|vintage|deco-deluxe/, 'deco'],
  [/bear|eagle|elephant|panther|lion|tiger|wolf|safari|grizzly/, 'animal'],
  [/cherry|melon|lemon|fruit|forbidden|lucky-seven|classic-gold|retro|prosperity|sunshine|sevens|golden-cherry|golden-melon/, 'fruit'],
];

function categoryFor(slug) {
  for (const [re, cat] of RULES) if (re.test(slug)) return cat;
  return FALLBACK;
}

// Predator override (night animals) — applied after animal match.
const PREDATORS = /panther|wolf|midnight-prowler|nocturn/;

function fixHex(h) { return /^#[0-9a-fA-F]{6}$/.test(h) ? h : '#D4A017'; }

function themeFor(slug) {
  let cat = categoryFor(slug);
  if (cat === 'animal' && PREDATORS.test(slug)) cat = 'predator';
  const kit = KITS[cat] || KITS[FALLBACK];
  const pal = pick(kit.palettes, slug, 'pal').map(fixHex);
  const particle = pick(kit.particles, slug, 'par');
  const frame = pick(kit.frames, slug, 'frm');
  const spin = pick(kit.spins, slug, 'spn');
  const symAnim = pick(kit.symAnims, slug, 'sym');
  const [primary, secondary, accent, win] = pal;
  const particleColor = kit.particleFromPalette
    ? [accent, win, primary]
    : (PARTICLE_COLORS[particle] || [accent, win]);
  const winLine = Object.assign({}, kit.winLine);
  if (!winLine.color) winLine.color = win;
  const density = particle === 'fog' ? 7 : particle === 'matrix' ? 26
    : particle === 'rain' ? 40 : particle === 'aurora' || particle === 'caustics' ? 0 : 28;
  return {
    category: cat,
    primary, secondary, accent, win,
    bgGradient: kit.bg,
    frame, spin, symAnim,
    winLine,
    particle, particleColor, density,
  };
}

// ── HTML injection ─────────────────────────────────────────────────────────
// Block is wrapped in begin/end marker comments so re-runs can strip it
// unambiguously (the visualTheme object nests winLine, so a brace-based
// removal would be ambiguous). Anchors after the gameConfig `id` field —
// handles BOTH page styles: unquoted `id: 'slug',` and JSON `"id": "slug",`.
const BEGIN = '// visualTheme:begin (auto — scripts/inject-visual-themes.js)';
const END = '// visualTheme:end';

function injectInto(html, slug, theme) {
  html = html.replace(/\n[ \t]*\/\/ visualTheme:begin[\s\S]*?\/\/ visualTheme:end/, '');
  const esc = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const idRe = new RegExp(`(\\n([ \\t]*)(?:id|"id"):\\s*['"]${esc}['"],)`);
  const m = html.match(idRe);
  if (!m) return null;
  const indent = m[2];
  const body = JSON.stringify(theme, null, 2)
    .split('\n')
    .map((line, i) => (i === 0 ? line : indent + line))
    .join('\n');
  const block = `\n${indent}${BEGIN}\n${indent}visualTheme: ${body},\n${indent}${END}`;
  return html.replace(idRe, `$1${block}`);
}

// ── Main ───────────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const only = args.filter((a) => !a.startsWith('--'));

  let files = fs.readdirSync(GAMES_DIR).filter((f) => f.endsWith('.html'));
  if (only.length) files = files.filter((f) => only.includes(f.replace('.html', '')));

  const dist = { cat: {}, particle: {}, frame: {}, spin: {}, symAnim: {} };
  let injected = 0, skipped = 0;
  const fallbacks = [];

  for (const file of files) {
    const full = path.join(GAMES_DIR, file);
    const slug = file.replace('.html', '');
    let html = fs.readFileSync(full, 'utf8');
    if (!html.includes('CasinoEngine.init')) { skipped++; continue; }

    const { category, ...theme } = themeFor(slug);
    if (category === FALLBACK && categoryFor(slug) === FALLBACK
        && !/cherry|melon|lemon|fruit|forbidden|lucky|classic|retro|prosperity|sunshine|seven|golden-c|golden-m/.test(slug)) {
      fallbacks.push(slug);
    }
    const out = injectInto(html, slug, theme);
    if (!out) { console.warn(`  ! could not find id anchor in ${file}`); skipped++; continue; }

    if (!dry) fs.writeFileSync(full, out);
    injected++;
    dist.cat[category] = (dist.cat[category] || 0) + 1;
    dist.particle[theme.particle] = (dist.particle[theme.particle] || 0) + 1;
    dist.frame[theme.frame] = (dist.frame[theme.frame] || 0) + 1;
    dist.spin[theme.spin] = (dist.spin[theme.spin] || 0) + 1;
    dist.symAnim[theme.symAnim] = (dist.symAnim[theme.symAnim] || 0) + 1;
  }

  console.log(`\n${dry ? '[DRY] ' : ''}Visual themes injected: ${injected}  (skipped ${skipped})`);
  const show = (label, obj) => console.log(`  ${label.padEnd(9)} ` + Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  '));
  show('category', dist.cat);
  show('particle', dist.particle);
  show('frame', dist.frame);
  show('spin', dist.spin);
  show('symAnim', dist.symAnim);
  if (fallbacks.length) console.log(`  ⚠ unmatched (fallback): ${fallbacks.join(', ')}`);
}

main();

#!/usr/bin/env node
'use strict';

/**
 * Generate 100 premium slot game definitions
 * Theme distribution:
 *   Ancient Egypt / Mythology: 13
 *   Fruit Classics: 12
 *   Space / Sci-Fi: 12
 *   Fantasy / Magic: 12
 *   Animals / Wildlife: 12
 *   Asian / Lucky: 10
 *   Horror / Dark: 10
 *   Australian / Outback: 10
 *   Bonus Wildcard: 9
 */

const fs = require('fs');
const path = require('path');

// Provider studios (fictional)
const PROVIDERS = [
  'NovaSpin Studios', 'Celestial Plays', 'IronReel Entertainment',
  'GoldenEdge Gaming', 'PhantomWorks', 'VaultX Gaming',
  'ArcadeForge', 'SolsticeFX', 'NeonCore Labs', 'Desert Gold Studios'
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function providerFor(i) { return PROVIDERS[i % PROVIDERS.length]; }

// RTP tuned per volatility
function rtpForVol(vol) {
  const base = { low: 94, medium: 92, 'medium-high': 91, high: 90, 'very high': 88.5 };
  return (base[vol] || 91) + (Math.random() * 2 - 1); // ±1 jitter
}

// Payout tables tuned by volatility and grid type
function payoutsFor(vol, winType, gridCols) {
  if (winType === 'cluster') {
    const mult = { low: 0.6, medium: 1, 'medium-high': 1.3, high: 1.6, 'very high': 2 }[vol] || 1;
    return {
      triple: Math.round(100 * mult), double: Math.round(12 * mult),
      wildTriple: Math.round(150 * mult), scatterPay: 5,
      cluster5: Math.round(4 * mult), cluster8: Math.round(12 * mult),
      cluster12: Math.round(40 * mult), cluster15: Math.round(100 * mult)
    };
  }
  if (gridCols === 3) { // classic 3x3
    const mult = { low: 0.7, medium: 1, 'medium-high': 1.4, high: 1.8, 'very high': 2.5 }[vol] || 1;
    return {
      triple: Math.round(120 * mult), double: Math.round(15 * mult),
      wildTriple: Math.round(180 * mult), scatterPay: 3
    };
  }
  // Standard 5-col payline
  const mult = { low: 0.7, medium: 1, 'medium-high': 1.3, high: 1.6, 'very high': 2.2 }[vol] || 1;
  return {
    payline3: Math.round(5 * mult), payline4: Math.round(20 * mult),
    payline5: Math.round(80 * mult), wildTriple: Math.round(120 * mult),
    scatterPay: 5
  };
}

// Tags based on volatility and mechanic
function tagFor(vol, mechanic, i) {
  if (mechanic === 'random_jackpot') return ['JACKPOT', 'tag-jackpot'];
  if (vol === 'very high') return ['MEGA', 'tag-mega'];
  if (vol === 'high') return ['HOT', 'tag-hot'];
  if (i % 5 === 0) return ['NEW', 'tag-new'];
  return ['POPULAR', 'tag-popular'];
}

// Free spins count by mechanic
function freeSpinsFor(mechanic) {
  const map = {
    tumble: 10, cascading: 12, expanding_wilds: 8, sticky_wilds: 10,
    walking_wilds: 8, stacked_wilds: 10, hold_and_win: 3, coin_respin: 3,
    random_multiplier: 10, zeus_multiplier: 12, wheel_multiplier: 8,
    multiplier_wilds: 8, increasing_mult: 10, expanding_symbol: 10,
    mystery_stacks: 8, respin: 5, prize_wheel: 0, symbol_collect: 12,
    random_jackpot: 8, wild_reels: 10
  };
  return map[mechanic] || 8;
}

// Bonus description
function bonusDescFor(mechanic, name) {
  const descs = {
    tumble: 'Tumbling Reels — winning symbols vanish and new ones cascade down! Multiplier increases with each tumble!',
    cascading: 'Cascade Feature — wins explode and new symbols fall! Chain reactions multiply your prizes!',
    expanding_wilds: 'Expanding Wilds — wilds stretch to cover entire reels for massive win potential!',
    expanding_symbol: 'Expanding Symbol — one symbol is chosen to expand across reels during free spins!',
    sticky_wilds: 'Sticky Wilds — wilds lock in place for the duration of the bonus round!',
    walking_wilds: 'Walking Wilds — wild symbols move one reel left each spin, creating new combinations!',
    stacked_wilds: 'Stacked Wilds — wilds appear in stacks of 2-4, covering full reels!',
    hold_and_win: 'Hold & Win — collect coins and respins! Fill the grid for the Grand jackpot!',
    coin_respin: 'Coin Respin — special coins lock in place with cash values during the respin feature!',
    random_multiplier: 'Random Multiplier — every win gets a surprise multiplier from 2x up to 10x!',
    zeus_multiplier: 'Thunder Multiplier — progressive multiplier builds with consecutive wins up to 500x!',
    wheel_multiplier: 'Wheel Multiplier — spin the bonus wheel for multipliers, free spins, and jackpots!',
    multiplier_wilds: 'Multiplier Wilds — each wild carries a random multiplier that applies to your wins!',
    increasing_mult: 'Increasing Multiplier — multiplier grows with every winning spin, no upper limit!',
    mystery_stacks: 'Mystery Stacks — mystery symbols reveal matching high-value symbols for huge combos!',
    respin: 'Respin Feature — near misses trigger a free respin on the almost-winning reel!',
    prize_wheel: 'Prize Wheel Bonus — land 3 scatters to spin the wheel for cash prizes and jackpots!',
    symbol_collect: 'Symbol Collection — collect special symbols to fill meters and unlock bonus rewards!',
    random_jackpot: 'Progressive Jackpot — any spin can trigger the progressive jackpot! Higher bets = better odds!',
    wild_reels: 'Wild Reels — entire reels transform into wilds during the bonus feature!'
  };
  return descs[mechanic] || 'Bonus Feature — land 3 scatters to trigger the bonus round!';
}

// All 100 games organized by theme
const GAMES = [
  // ============ ANCIENT EGYPT / MYTHOLOGY (13) ============
  { id: 'tomb_of_anubis', name: 'Tomb of Anubis', theme: 'egypt',
    bg: 'linear-gradient(135deg, #1a0f00 0%, #4a3000 50%, #1a1500 100%)',
    reelBg: 'linear-gradient(180deg, #0d0800 0%, #1a0f00 100%)',
    accent: '#d4a017', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'high', mechanic: 'expanding_wilds',
    symbols: ['🏛️', '⚱️', '🐍', '🪲', '👁️', '🔱', '💀', '🌟'] },
  { id: 'pharaohs_fortune', name: "Pharaoh's Fortune", theme: 'egypt',
    bg: 'linear-gradient(135deg, #2d1810 0%, #8b6914 50%, #2d1810 100%)',
    reelBg: 'linear-gradient(180deg, #1a0f08 0%, #2d1810 100%)',
    accent: '#ffd700', cols: 5, rows: 4, winType: 'payline', template: 'extended',
    vol: 'medium-high', mechanic: 'hold_and_win',
    symbols: ['👑', '🏺', '🐫', '🦅', '💎', '🔮', '⭐'] },
  { id: 'cleopatras_crown', name: "Cleopatra's Crown", theme: 'egypt',
    bg: 'linear-gradient(135deg, #2b0a3d 0%, #6b2fa0 50%, #1a0628 100%)',
    reelBg: 'linear-gradient(180deg, #1a0628 0%, #0d0414 100%)',
    accent: '#b088f9', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'high', mechanic: 'sticky_wilds',
    symbols: ['👸', '🐱', '🪷', '💍', '🏛️', '🌙', '💎'] },
  { id: 'eye_of_horus', name: 'Eye of Horus', theme: 'egypt',
    bg: 'linear-gradient(135deg, #0a1628 0%, #1a3a6b 50%, #0a1020 100%)',
    reelBg: 'linear-gradient(180deg, #050b14 0%, #0a1628 100%)',
    accent: '#4da6ff', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium', mechanic: 'random_multiplier',
    symbols: ['👁️', '🪶', '🐍', '🏺', '🌙', '⚡', '💠'] },
  { id: 'scarab_riches', name: 'Scarab Riches', theme: 'egypt',
    bg: 'linear-gradient(135deg, #0a2810 0%, #1a6b30 50%, #0a1a10 100%)',
    reelBg: 'linear-gradient(180deg, #051408 0%, #0a2810 100%)',
    accent: '#50c878', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium-high', mechanic: 'coin_respin',
    symbols: ['🪲', '🏛️', '⚱️', '🐍', '💚', '🌿', '🔱'] },
  { id: 'temple_of_isis', name: 'Temple of Isis', theme: 'egypt',
    bg: 'linear-gradient(135deg, #1a0828 0%, #4a1a6b 50%, #100520 100%)',
    reelBg: 'linear-gradient(180deg, #0d0414 0%, #1a0828 100%)',
    accent: '#e080c0', cols: 5, rows: 4, winType: 'payline', template: 'extended',
    vol: 'medium', mechanic: 'expanding_symbol',
    symbols: ['🌙', '🪷', '🦉', '⭐', '🔮', '🌺', '💜'] },
  { id: 'sphinx_riddle', name: 'Sphinx Riddle', theme: 'egypt',
    bg: 'linear-gradient(135deg, #2d2010 0%, #8b7040 50%, #1a1408 100%)',
    reelBg: 'linear-gradient(180deg, #141008 0%, #2d2010 100%)',
    accent: '#c8a850', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'high', mechanic: 'mystery_stacks',
    symbols: ['🦁', '❓', '📜', '🏛️', '⚱️', '🌟', '👑'] },
  { id: 'nile_treasures', name: 'Nile Treasures', theme: 'egypt',
    bg: 'linear-gradient(135deg, #001428 0%, #003060 50%, #000a14 100%)',
    reelBg: 'linear-gradient(180deg, #000a14 0%, #001428 100%)',
    accent: '#4db8ff', cols: 6, rows: 5, winType: 'cluster', template: 'scatter',
    vol: 'medium', mechanic: 'cascading',
    symbols: ['🐊', '🏺', '🌊', '🦅', '💎', '🔵', '⚱️', '🐟'] },
  { id: 'wrath_of_zeus', name: 'Wrath of Zeus', theme: 'mythology',
    bg: 'linear-gradient(135deg, #1a0a3d 0%, #3d1a8b 50%, #0a0520 100%)',
    reelBg: 'linear-gradient(180deg, #0d0520 0%, #1a0a3d 100%)',
    accent: '#a370f7', cols: 5, rows: 4, winType: 'payline', template: 'extended',
    vol: 'very high', mechanic: 'zeus_multiplier',
    symbols: ['⚡', '🦅', '🏛️', '⚔️', '🔱', '🌩️', '👑', '🏺'] },
  { id: 'viking_thunder', name: 'Viking Thunder', theme: 'mythology',
    bg: 'linear-gradient(135deg, #0a1428 0%, #1a3050 50%, #050a14 100%)',
    reelBg: 'linear-gradient(180deg, #050a14 0%, #0a1428 100%)',
    accent: '#ff8c42', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'high', mechanic: 'walking_wilds',
    symbols: ['⚔️', '🛡️', '🪓', '⛵', '🍖', '🐺', '⚡'] },
  { id: 'athenas_shield', name: "Athena's Shield", theme: 'mythology',
    bg: 'linear-gradient(135deg, #1a2020 0%, #4a6060 50%, #0a1414 100%)',
    reelBg: 'linear-gradient(180deg, #0a1010 0%, #1a2020 100%)',
    accent: '#c0c0c0', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium-high', mechanic: 'stacked_wilds',
    symbols: ['🛡️', '🦉', '🏛️', '⚔️', '🫒', '💫', '🏆'] },
  { id: 'minotaur_maze', name: "Minotaur's Maze", theme: 'mythology',
    bg: 'linear-gradient(135deg, #282020 0%, #504040 50%, #141010 100%)',
    reelBg: 'linear-gradient(180deg, #141010 0%, #282020 100%)',
    accent: '#e04040', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium', mechanic: 'respin',
    symbols: ['🐂', '🏛️', '⚔️', '🧶', '🔥', '💀', '🗡️'] },
  { id: 'golden_pyramid', name: 'Golden Pyramid', theme: 'egypt',
    bg: 'linear-gradient(135deg, #3d2800 0%, #8b6000 50%, #1a1200 100%)',
    reelBg: 'linear-gradient(180deg, #1a1200 0%, #3d2800 100%)',
    accent: '#ffd700', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'high', mechanic: 'prize_wheel',
    symbols: ['🔺', '👑', '⚱️', '🐫', '🌟', '💎', '🏆'] },

  // ============ FRUIT CLASSICS (12) ============
  { id: 'cherry_blaze', name: 'Cherry Blaze', theme: 'fruit',
    bg: 'linear-gradient(135deg, #3d0a0a 0%, #8b1a1a 50%, #1a0505 100%)',
    reelBg: 'linear-gradient(180deg, #1a0505 0%, #3d0a0a 100%)',
    accent: '#ff4040', cols: 3, rows: 3, winType: 'classic', template: 'classic',
    vol: 'low', mechanic: 'expanding_wilds',
    symbols: ['🍒', '🔔', '⭐', '7️⃣', '💎', '🍋'] },
  { id: 'citrus_crush', name: 'Citrus Crush', theme: 'fruit',
    bg: 'linear-gradient(135deg, #3d2800 0%, #ff8c00 50%, #1a1400 100%)',
    reelBg: 'linear-gradient(180deg, #1a1400 0%, #3d2800 100%)',
    accent: '#ff8c00', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium', mechanic: 'tumble',
    symbols: ['🍊', '🍋', '🍈', '🍌', '🥝', '⭐', '💎'] },
  { id: 'melon_millions', name: 'Melon Millions', theme: 'fruit',
    bg: 'linear-gradient(135deg, #0a280a 0%, #1a6b1a 50%, #051405 100%)',
    reelBg: 'linear-gradient(180deg, #051405 0%, #0a280a 100%)',
    accent: '#50c850', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium-high', mechanic: 'hold_and_win',
    symbols: ['🍉', '🍈', '🥒', '🍏', '💚', '⭐', '💎'] },
  { id: 'berry_bonanza', name: 'Berry Bonanza', theme: 'fruit',
    bg: 'linear-gradient(135deg, #280a3d 0%, #6b1a8b 50%, #140520 100%)',
    reelBg: 'linear-gradient(180deg, #140520 0%, #280a3d 100%)',
    accent: '#c060f0', cols: 7, rows: 7, winType: 'cluster', template: 'grid',
    vol: 'medium', mechanic: 'cascading',
    symbols: ['🫐', '🍇', '🍓', '🫒', '🍑', '⭐', '💎', '🌟'] },
  { id: 'fruit_inferno', name: 'Fruit Inferno', theme: 'fruit',
    bg: 'linear-gradient(135deg, #3d1400 0%, #8b3000 50%, #1a0a00 100%)',
    reelBg: 'linear-gradient(180deg, #1a0a00 0%, #3d1400 100%)',
    accent: '#ff6020', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'high', mechanic: 'multiplier_wilds',
    symbols: ['🔥', '🍒', '🍊', '🍋', '🍇', '⭐', '💎'] },
  { id: 'lucky_sevens_deluxe', name: 'Lucky Sevens Deluxe', theme: 'fruit',
    bg: 'linear-gradient(135deg, #3d0000 0%, #8b0000 50%, #1a0000 100%)',
    reelBg: 'linear-gradient(180deg, #1a0000 0%, #3d0000 100%)',
    accent: '#ff0040', cols: 3, rows: 3, winType: 'classic', template: 'classic',
    vol: 'low', mechanic: 'respin',
    symbols: ['7️⃣', '🍒', '🔔', 'BAR', '⭐', '💎'] },
  { id: 'grape_escape', name: 'Grape Escape', theme: 'fruit',
    bg: 'linear-gradient(135deg, #200a3d 0%, #4a1a6b 50%, #100520 100%)',
    reelBg: 'linear-gradient(180deg, #100520 0%, #200a3d 100%)',
    accent: '#9060d0', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium', mechanic: 'walking_wilds',
    symbols: ['🍇', '🍷', '🥂', '🍾', '💜', '⭐', '💎'] },
  { id: 'tropical_twist', name: 'Tropical Twist', theme: 'fruit',
    bg: 'linear-gradient(135deg, #003028 0%, #006050 50%, #001a14 100%)',
    reelBg: 'linear-gradient(180deg, #001a14 0%, #003028 100%)',
    accent: '#40c0a0', cols: 5, rows: 4, winType: 'payline', template: 'extended',
    vol: 'medium', mechanic: 'random_multiplier',
    symbols: ['🥭', '🍍', '🥥', '🍌', '🌴', '⭐', '💎'] },
  { id: 'golden_apple', name: 'Golden Apple', theme: 'fruit',
    bg: 'linear-gradient(135deg, #283d00 0%, #506b00 50%, #141a00 100%)',
    reelBg: 'linear-gradient(180deg, #141a00 0%, #283d00 100%)',
    accent: '#c8d820', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium-high', mechanic: 'sticky_wilds',
    symbols: ['🍎', '🍏', '🌟', '🍐', '🥝', '⭐', '💎'] },
  { id: 'plum_paradise', name: 'Plum Paradise', theme: 'fruit',
    bg: 'linear-gradient(135deg, #280028 0%, #500050 50%, #140014 100%)',
    reelBg: 'linear-gradient(180deg, #140014 0%, #280028 100%)',
    accent: '#d060d0', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium', mechanic: 'prize_wheel',
    symbols: ['🍑', '🫐', '🍒', '🍇', '💜', '⭐', '💎'] },
  { id: 'star_fruit_rush', name: 'Star Fruit Rush', theme: 'fruit',
    bg: 'linear-gradient(135deg, #3d3d00 0%, #8b8b00 50%, #1a1a00 100%)',
    reelBg: 'linear-gradient(180deg, #1a1a00 0%, #3d3d00 100%)',
    accent: '#e0e040', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'high', mechanic: 'increasing_mult',
    symbols: ['⭐', '🍊', '🍋', '🍈', '🌟', '💫', '💎'] },
  { id: 'juicy_jackpot', name: 'Juicy Jackpot', theme: 'fruit',
    bg: 'linear-gradient(135deg, #3d0020 0%, #8b0040 50%, #1a0010 100%)',
    reelBg: 'linear-gradient(180deg, #1a0010 0%, #3d0020 100%)',
    accent: '#ff4080', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium', mechanic: 'random_jackpot',
    symbols: ['🍒', '🍊', '🍋', '🍇', '🍉', '⭐', '💎'] },

  // ============ SPACE / SCI-FI (12) ============
  { id: 'neon_nebula', name: 'Neon Nebula Spins', theme: 'space',
    bg: 'linear-gradient(135deg, #0a0028 0%, #1a0060 50%, #050014 100%)',
    reelBg: 'linear-gradient(180deg, #050014 0%, #0a0028 100%)',
    accent: '#8040ff', cols: 6, rows: 5, winType: 'cluster', template: 'scatter',
    vol: 'high', mechanic: 'tumble',
    symbols: ['🌌', '💫', '🪐', '☄️', '🌠', '🔮', '💎', '⭐'] },
  { id: 'cosmic_crusade', name: 'Cosmic Crusade', theme: 'space',
    bg: 'linear-gradient(135deg, #000a28 0%, #001a60 50%, #000514 100%)',
    reelBg: 'linear-gradient(180deg, #000514 0%, #000a28 100%)',
    accent: '#4060ff', cols: 5, rows: 4, winType: 'payline', template: 'extended',
    vol: 'medium-high', mechanic: 'expanding_wilds',
    symbols: ['🚀', '🛸', '🌍', '🌙', '⭐', '💎', '🔵'] },
  { id: 'astro_miners', name: 'Astro Miners', theme: 'space',
    bg: 'linear-gradient(135deg, #141414 0%, #3d3020 50%, #0a0a08 100%)',
    reelBg: 'linear-gradient(180deg, #0a0a08 0%, #141414 100%)',
    accent: '#d4a050', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium', mechanic: 'hold_and_win',
    symbols: ['⛏️', '💎', '🪨', '🌑', '⚙️', '🔧', '⭐'] },
  { id: 'galactic_gems', name: 'Galactic Gems', theme: 'space',
    bg: 'linear-gradient(135deg, #140028 0%, #280050 50%, #0a0014 100%)',
    reelBg: 'linear-gradient(180deg, #0a0014 0%, #140028 100%)',
    accent: '#c040ff', cols: 7, rows: 7, winType: 'cluster', template: 'grid',
    vol: 'high', mechanic: 'cascading',
    symbols: ['💎', '🔴', '🔵', '🟢', '🟡', '🟣', '⭐', '💫'] },
  { id: 'stellar_surge', name: 'Stellar Surge', theme: 'space',
    bg: 'linear-gradient(135deg, #0a1428 0%, #1a2850 50%, #050a14 100%)',
    reelBg: 'linear-gradient(180deg, #050a14 0%, #0a1428 100%)',
    accent: '#60a0ff', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'very high', mechanic: 'increasing_mult',
    symbols: ['💥', '⚡', '🌟', '☄️', '🔥', '💫', '💎'] },
  { id: 'void_voyager', name: 'Void Voyager', theme: 'space',
    bg: 'linear-gradient(135deg, #000814 0%, #001028 50%, #00050a 100%)',
    reelBg: 'linear-gradient(180deg, #00050a 0%, #000814 100%)',
    accent: '#00e0ff', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium', mechanic: 'walking_wilds',
    symbols: ['🛸', '🌌', '🪐', '🌑', '💀', '⭐', '💎'] },
  { id: 'quantum_flux', name: 'Quantum Flux', theme: 'space',
    bg: 'linear-gradient(135deg, #002828 0%, #005050 50%, #001414 100%)',
    reelBg: 'linear-gradient(180deg, #001414 0%, #002828 100%)',
    accent: '#00ffc8', cols: 5, rows: 4, winType: 'payline', template: 'extended',
    vol: 'high', mechanic: 'random_multiplier',
    symbols: ['⚛️', '🔬', '💠', '🌀', '⚡', '⭐', '💎'] },
  { id: 'mars_colony', name: 'Mars Colony', theme: 'space',
    bg: 'linear-gradient(135deg, #281408 0%, #502810 50%, #140a04 100%)',
    reelBg: 'linear-gradient(180deg, #140a04 0%, #281408 100%)',
    accent: '#e06030', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium-high', mechanic: 'coin_respin',
    symbols: ['🏗️', '🚀', '🔴', '⚙️', '🌡️', '⭐', '💎'] },
  { id: 'alien_artifacts', name: 'Alien Artifacts', theme: 'space',
    bg: 'linear-gradient(135deg, #0a2800 0%, #1a5000 50%, #051400 100%)',
    reelBg: 'linear-gradient(180deg, #051400 0%, #0a2800 100%)',
    accent: '#60ff40', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium', mechanic: 'mystery_stacks',
    symbols: ['👽', '🛸', '🔮', '🧬', '💚', '⭐', '💎'] },
  { id: 'supernova_spin', name: 'Supernova Spin', theme: 'space',
    bg: 'linear-gradient(135deg, #281400 0%, #603000 50%, #140a00 100%)',
    reelBg: 'linear-gradient(180deg, #140a00 0%, #281400 100%)',
    accent: '#ff8040', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'very high', mechanic: 'multiplier_wilds',
    symbols: ['💥', '🌟', '🔥', '☄️', '⚡', '⭐', '💎'] },
  { id: 'lunar_loot', name: 'Lunar Loot', theme: 'space',
    bg: 'linear-gradient(135deg, #141428 0%, #282850 50%, #0a0a14 100%)',
    reelBg: 'linear-gradient(180deg, #0a0a14 0%, #141428 100%)',
    accent: '#c0c0e0', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium', mechanic: 'sticky_wilds',
    symbols: ['🌙', '🌕', '🌗', '🌑', '🚀', '⭐', '💎'] },
  { id: 'warp_drive', name: 'Warp Drive', theme: 'space',
    bg: 'linear-gradient(135deg, #0a0a3d 0%, #1a1a8b 50%, #050520 100%)',
    reelBg: 'linear-gradient(180deg, #050520 0%, #0a0a3d 100%)',
    accent: '#6060ff', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'high', mechanic: 'wheel_multiplier',
    symbols: ['🌀', '🚀', '⚡', '🌌', '💠', '⭐', '💎'] },

  // ============ FANTASY / MAGIC (12) ============
  { id: 'enchanted_forest', name: 'Enchanted Forest', theme: 'fantasy',
    bg: 'linear-gradient(135deg, #0a280a 0%, #1a501a 50%, #051405 100%)',
    reelBg: 'linear-gradient(180deg, #051405 0%, #0a280a 100%)',
    accent: '#40e080', cols: 5, rows: 4, winType: 'payline', template: 'extended',
    vol: 'medium', mechanic: 'expanding_symbol',
    symbols: ['🧚', '🦌', '🍄', '🌳', '🦋', '✨', '💎'] },
  { id: 'dragons_hoard', name: "Dragon's Hoard", theme: 'fantasy',
    bg: 'linear-gradient(135deg, #280808 0%, #601010 50%, #140404 100%)',
    reelBg: 'linear-gradient(180deg, #140404 0%, #280808 100%)',
    accent: '#ff4020', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'high', mechanic: 'hold_and_win',
    symbols: ['🐉', '🔥', '👑', '💰', '🛡️', '⭐', '💎'] },
  { id: 'wizards_tower', name: "Wizard's Tower", theme: 'fantasy',
    bg: 'linear-gradient(135deg, #1a0a3d 0%, #3d1a6b 50%, #0d0520 100%)',
    reelBg: 'linear-gradient(180deg, #0d0520 0%, #1a0a3d 100%)',
    accent: '#a060e0', cols: 5, rows: 4, winType: 'payline', template: 'extended',
    vol: 'medium-high', mechanic: 'random_multiplier',
    symbols: ['🧙', '📖', '🔮', '⚗️', '🌟', '✨', '💎'] },
  { id: 'fairy_fortune', name: 'Fairy Fortune', theme: 'fantasy',
    bg: 'linear-gradient(135deg, #280a28 0%, #501a50 50%, #140514 100%)',
    reelBg: 'linear-gradient(180deg, #140514 0%, #280a28 100%)',
    accent: '#ff80c0', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'low', mechanic: 'cascading',
    symbols: ['🧚', '🌸', '🦋', '🌺', '✨', '⭐', '💎'] },
  { id: 'crystal_cavern', name: 'Crystal Cavern', theme: 'fantasy',
    bg: 'linear-gradient(135deg, #0a1428 0%, #1a2850 50%, #050a14 100%)',
    reelBg: 'linear-gradient(180deg, #050a14 0%, #0a1428 100%)',
    accent: '#60c0ff', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium', mechanic: 'sticky_wilds',
    symbols: ['💎', '🔷', '🔹', '🧊', '💠', '⭐', '✨'] },
  { id: 'elven_gold', name: 'Elven Gold', theme: 'fantasy',
    bg: 'linear-gradient(135deg, #142808 0%, #285010 50%, #0a1404 100%)',
    reelBg: 'linear-gradient(180deg, #0a1404 0%, #142808 100%)',
    accent: '#80c040', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium', mechanic: 'walking_wilds',
    symbols: ['🧝', '🏹', '🌿', '🍃', '💚', '⭐', '💎'] },
  { id: 'dark_sorcerer', name: 'Dark Sorcerer', theme: 'fantasy',
    bg: 'linear-gradient(135deg, #0a0014 0%, #1a0028 50%, #05000a 100%)',
    reelBg: 'linear-gradient(180deg, #05000a 0%, #0a0014 100%)',
    accent: '#a040ff', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'high', mechanic: 'stacked_wilds',
    symbols: ['🧙', '💀', '🔮', '⚡', '🌑', '⭐', '💎'] },
  { id: 'unicorn_valley', name: 'Unicorn Valley', theme: 'fantasy',
    bg: 'linear-gradient(135deg, #281028 0%, #502050 50%, #140814 100%)',
    reelBg: 'linear-gradient(180deg, #140814 0%, #281028 100%)',
    accent: '#e080e0', cols: 6, rows: 5, winType: 'cluster', template: 'scatter',
    vol: 'low', mechanic: 'tumble',
    symbols: ['🦄', '🌈', '🌸', '⭐', '🦋', '✨', '💎', '🌺'] },
  { id: 'goblin_treasures', name: 'Goblin Treasures', theme: 'fantasy',
    bg: 'linear-gradient(135deg, #142008 0%, #283d10 50%, #0a1004 100%)',
    reelBg: 'linear-gradient(180deg, #0a1004 0%, #142008 100%)',
    accent: '#80a030', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium-high', mechanic: 'coin_respin',
    symbols: ['👺', '💰', '🗡️', '🍖', '💀', '⭐', '💎'] },
  { id: 'phoenix_rising', name: 'Phoenix Rising', theme: 'fantasy',
    bg: 'linear-gradient(135deg, #281000 0%, #603000 50%, #140800 100%)',
    reelBg: 'linear-gradient(180deg, #140800 0%, #281000 100%)',
    accent: '#ff6020', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'very high', mechanic: 'increasing_mult',
    symbols: ['🔥', '🦅', '💫', '🌟', '⚡', '⭐', '💎'] },
  { id: 'merlins_spell', name: "Merlin's Spell", theme: 'fantasy',
    bg: 'linear-gradient(135deg, #0a0a28 0%, #1a1a50 50%, #050514 100%)',
    reelBg: 'linear-gradient(180deg, #050514 0%, #0a0a28 100%)',
    accent: '#6080ff', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium', mechanic: 'prize_wheel',
    symbols: ['🧙', '📖', '🔮', '⚗️', '🌙', '⭐', '💎'] },
  { id: 'shadow_realm', name: 'Shadow Realm', theme: 'fantasy',
    bg: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 50%, #050505 100%)',
    reelBg: 'linear-gradient(180deg, #050505 0%, #0a0a0a 100%)',
    accent: '#808080', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'high', mechanic: 'expanding_wilds',
    symbols: ['👻', '🌑', '💀', '🗡️', '🕯️', '⭐', '💎'] },

  // ============ ANIMALS / WILDLIFE (12) ============
  { id: 'lion_king_savanna', name: 'Lion King Savanna', theme: 'animals',
    bg: 'linear-gradient(135deg, #3d2000 0%, #8b5000 50%, #1a1000 100%)',
    reelBg: 'linear-gradient(180deg, #1a1000 0%, #3d2000 100%)',
    accent: '#e0a030', cols: 5, rows: 4, winType: 'payline', template: 'extended',
    vol: 'medium-high', mechanic: 'expanding_wilds',
    symbols: ['🦁', '🐘', '🦒', '🌅', '🌳', '⭐', '💎'] },
  { id: 'arctic_wolves', name: 'Arctic Wolves', theme: 'animals',
    bg: 'linear-gradient(135deg, #142838 0%, #285070 50%, #0a141c 100%)',
    reelBg: 'linear-gradient(180deg, #0a141c 0%, #142838 100%)',
    accent: '#80c0e0', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'high', mechanic: 'stacked_wilds',
    symbols: ['🐺', '❄️', '🌨️', '🏔️', '🌙', '⭐', '💎'] },
  { id: 'eagle_summit', name: 'Eagle Summit', theme: 'animals',
    bg: 'linear-gradient(135deg, #142028 0%, #284050 50%, #0a1014 100%)',
    reelBg: 'linear-gradient(180deg, #0a1014 0%, #142028 100%)',
    accent: '#80a0c0', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium', mechanic: 'walking_wilds',
    symbols: ['🦅', '🏔️', '🌲', '🐿️', '🌤️', '⭐', '💎'] },
  { id: 'jungle_jaguar', name: 'Jungle Jaguar', theme: 'animals',
    bg: 'linear-gradient(135deg, #0a2008 0%, #1a4010 50%, #051004 100%)',
    reelBg: 'linear-gradient(180deg, #051004 0%, #0a2008 100%)',
    accent: '#40a030', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium-high', mechanic: 'sticky_wilds',
    symbols: ['🐆', '🌿', '🦜', '🐍', '🌺', '⭐', '💎'] },
  { id: 'ocean_dolphins', name: 'Ocean Dolphins', theme: 'animals',
    bg: 'linear-gradient(135deg, #001428 0%, #002850 50%, #000a14 100%)',
    reelBg: 'linear-gradient(180deg, #000a14 0%, #001428 100%)',
    accent: '#4090e0', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium', mechanic: 'cascading',
    symbols: ['🐬', '🐚', '🌊', '🐠', '🦈', '⭐', '💎'] },
  { id: 'safari_stampede', name: 'Safari Stampede', theme: 'animals',
    bg: 'linear-gradient(135deg, #282010 0%, #504020 50%, #141008 100%)',
    reelBg: 'linear-gradient(180deg, #141008 0%, #282010 100%)',
    accent: '#c09040', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'high', mechanic: 'hold_and_win',
    symbols: ['🐃', '🦓', '🐘', '🦏', '🌴', '⭐', '💎'] },
  { id: 'panda_paradise', name: 'Panda Paradise', theme: 'animals',
    bg: 'linear-gradient(135deg, #0a2808 0%, #1a5010 50%, #051404 100%)',
    reelBg: 'linear-gradient(180deg, #051404 0%, #0a2808 100%)',
    accent: '#40c040', cols: 6, rows: 5, winType: 'cluster', template: 'scatter',
    vol: 'medium', mechanic: 'tumble',
    symbols: ['🐼', '🎋', '🍃', '🌸', '🐾', '⭐', '💎', '🌿'] },
  { id: 'cobra_strike', name: 'Cobra Strike', theme: 'animals',
    bg: 'linear-gradient(135deg, #082808 0%, #105010 50%, #041404 100%)',
    reelBg: 'linear-gradient(180deg, #041404 0%, #082808 100%)',
    accent: '#30a030', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium-high', mechanic: 'respin',
    symbols: ['🐍', '💎', '🌿', '🦎', '🔮', '⭐', '🌟'] },
  { id: 'bear_mountain', name: 'Bear Mountain', theme: 'animals',
    bg: 'linear-gradient(135deg, #1a1408 0%, #3d2810 50%, #0d0a04 100%)',
    reelBg: 'linear-gradient(180deg, #0d0a04 0%, #1a1408 100%)',
    accent: '#a08040', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium', mechanic: 'random_multiplier',
    symbols: ['🐻', '🏔️', '🌲', '🍯', '🐟', '⭐', '💎'] },
  { id: 'flamingo_fortune', name: 'Flamingo Fortune', theme: 'animals',
    bg: 'linear-gradient(135deg, #280a1a 0%, #501430 50%, #14050d 100%)',
    reelBg: 'linear-gradient(180deg, #14050d 0%, #280a1a 100%)',
    accent: '#ff60a0', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium', mechanic: 'multiplier_wilds',
    symbols: ['🦩', '🌴', '🌺', '🐚', '💗', '⭐', '💎'] },
  { id: 'gorilla_gold', name: 'Gorilla Gold', theme: 'animals',
    bg: 'linear-gradient(135deg, #0a1408 0%, #142810 50%, #050a04 100%)',
    reelBg: 'linear-gradient(180deg, #050a04 0%, #0a1408 100%)',
    accent: '#60a040', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'high', mechanic: 'mystery_stacks',
    symbols: ['🦍', '🌿', '🍌', '🐾', '💰', '⭐', '💎'] },
  { id: 'butterfly_bloom', name: 'Butterfly Bloom', theme: 'animals',
    bg: 'linear-gradient(135deg, #281428 0%, #502850 50%, #140a14 100%)',
    reelBg: 'linear-gradient(180deg, #140a14 0%, #281428 100%)',
    accent: '#e080c0', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'low', mechanic: 'symbol_collect',
    symbols: ['🦋', '🌸', '🌺', '🌼', '🌷', '⭐', '💎'] },

  // ============ ASIAN / LUCKY (10) ============
  { id: 'jade_emperor', name: 'Jade Emperor', theme: 'asian',
    bg: 'linear-gradient(135deg, #082808 0%, #105010 50%, #041404 100%)',
    reelBg: 'linear-gradient(180deg, #041404 0%, #082808 100%)',
    accent: '#40c060', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'high', mechanic: 'hold_and_win',
    symbols: ['🐉', '👑', '🏯', '🎋', '💚', '⭐', '💎'] },
  { id: 'lucky_koi', name: 'Lucky Koi', theme: 'asian',
    bg: 'linear-gradient(135deg, #280808 0%, #501010 50%, #140404 100%)',
    reelBg: 'linear-gradient(180deg, #140404 0%, #280808 100%)',
    accent: '#ff4040', cols: 5, rows: 4, winType: 'payline', template: 'extended',
    vol: 'medium', mechanic: 'cascading',
    symbols: ['🐟', '🌊', '🪷', '🏮', '💰', '⭐', '💎'] },
  { id: 'dragon_dynasty', name: 'Dragon Dynasty', theme: 'asian',
    bg: 'linear-gradient(135deg, #3d0000 0%, #8b0000 50%, #1a0000 100%)',
    reelBg: 'linear-gradient(180deg, #1a0000 0%, #3d0000 100%)',
    accent: '#ff2020', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'very high', mechanic: 'expanding_wilds',
    symbols: ['🐉', '🔥', '🏯', '⚔️', '💰', '⭐', '💎'] },
  { id: 'fortune_panda', name: 'Fortune Panda', theme: 'asian',
    bg: 'linear-gradient(135deg, #280a08 0%, #501410 50%, #140504 100%)',
    reelBg: 'linear-gradient(180deg, #140504 0%, #280a08 100%)',
    accent: '#e04030', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium-high', mechanic: 'coin_respin',
    symbols: ['🐼', '🎋', '🏮', '🧧', '💰', '⭐', '💎'] },
  { id: 'golden_tiger', name: 'Golden Tiger', theme: 'asian',
    bg: 'linear-gradient(135deg, #282000 0%, #504000 50%, #141000 100%)',
    reelBg: 'linear-gradient(180deg, #141000 0%, #282000 100%)',
    accent: '#e0c020', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'high', mechanic: 'stacked_wilds',
    symbols: ['🐅', '💰', '🏯', '🎋', '👑', '⭐', '💎'] },
  { id: 'lotus_bloom', name: 'Lotus Bloom', theme: 'asian',
    bg: 'linear-gradient(135deg, #1a0a1a 0%, #3d1a3d 50%, #0d050d 100%)',
    reelBg: 'linear-gradient(180deg, #0d050d 0%, #1a0a1a 100%)',
    accent: '#e080c0', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium', mechanic: 'sticky_wilds',
    symbols: ['🪷', '🌸', '🏮', '🐟', '💗', '⭐', '💎'] },
  { id: 'samurai_spirit', name: 'Samurai Spirit', theme: 'asian',
    bg: 'linear-gradient(135deg, #0a0a28 0%, #141450 50%, #050514 100%)',
    reelBg: 'linear-gradient(180deg, #050514 0%, #0a0a28 100%)',
    accent: '#4040e0', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'high', mechanic: 'walking_wilds',
    symbols: ['⚔️', '🏯', '🌸', '🐉', '🎋', '⭐', '💎'] },
  { id: 'lantern_festival', name: 'Lantern Festival', theme: 'asian',
    bg: 'linear-gradient(135deg, #281408 0%, #502810 50%, #140a04 100%)',
    reelBg: 'linear-gradient(180deg, #140a04 0%, #281408 100%)',
    accent: '#ffa030', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium', mechanic: 'random_multiplier',
    symbols: ['🏮', '🎆', '🎇', '🧧', '🎊', '⭐', '💎'] },
  { id: 'temple_of_fortune', name: 'Temple of Fortune', theme: 'asian',
    bg: 'linear-gradient(135deg, #280a00 0%, #501400 50%, #140500 100%)',
    reelBg: 'linear-gradient(180deg, #140500 0%, #280a00 100%)',
    accent: '#ff6030', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium-high', mechanic: 'prize_wheel',
    symbols: ['🏯', '🐉', '🔔', '💰', '🧧', '⭐', '💎'] },
  { id: 'silk_road_riches', name: 'Silk Road Riches', theme: 'asian',
    bg: 'linear-gradient(135deg, #281828 0%, #503050 50%, #140c14 100%)',
    reelBg: 'linear-gradient(180deg, #140c14 0%, #281828 100%)',
    accent: '#c080a0', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium', mechanic: 'symbol_collect',
    symbols: ['🐫', '🧶', '💍', '🏺', '🌟', '⭐', '💎'] },

  // ============ HORROR / DARK (10) ============
  { id: 'haunted_mansion', name: 'Haunted Mansion', theme: 'horror',
    bg: 'linear-gradient(135deg, #0a0a14 0%, #1a1a28 50%, #05050a 100%)',
    reelBg: 'linear-gradient(180deg, #05050a 0%, #0a0a14 100%)',
    accent: '#40c060', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium-high', mechanic: 'mystery_stacks',
    symbols: ['👻', '🏚️', '🕯️', '🦇', '🕸️', '⭐', '💎'] },
  { id: 'vampire_night', name: 'Vampire Night', theme: 'horror',
    bg: 'linear-gradient(135deg, #1a0008 0%, #3d0010 50%, #0d0004 100%)',
    reelBg: 'linear-gradient(180deg, #0d0004 0%, #1a0008 100%)',
    accent: '#cc0030', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'high', mechanic: 'sticky_wilds',
    symbols: ['🧛', '🩸', '🌙', '🦇', '⚰️', '⭐', '💎'] },
  { id: 'zombie_horde', name: 'Zombie Horde', theme: 'horror',
    bg: 'linear-gradient(135deg, #0a1408 0%, #142810 50%, #050a04 100%)',
    reelBg: 'linear-gradient(180deg, #050a04 0%, #0a1408 100%)',
    accent: '#60a040', cols: 5, rows: 4, winType: 'payline', template: 'extended',
    vol: 'medium', mechanic: 'cascading',
    symbols: ['🧟', '🧠', '💀', '⚰️', '🪦', '⭐', '💎'] },
  { id: 'witchs_brew', name: "Witch's Brew", theme: 'horror',
    bg: 'linear-gradient(135deg, #140a28 0%, #281450 50%, #0a0514 100%)',
    reelBg: 'linear-gradient(180deg, #0a0514 0%, #140a28 100%)',
    accent: '#8040c0', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium', mechanic: 'random_multiplier',
    symbols: ['🧙‍♀️', '🧪', '🐈‍⬛', '🌙', '🍄', '⭐', '💎'] },
  { id: 'grim_reaper', name: 'Grim Reaper', theme: 'horror',
    bg: 'linear-gradient(135deg, #050505 0%, #141414 50%, #020202 100%)',
    reelBg: 'linear-gradient(180deg, #020202 0%, #050505 100%)',
    accent: '#c0c0c0', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'very high', mechanic: 'increasing_mult',
    symbols: ['💀', '⚰️', '🕯️', '🌑', '⏳', '⭐', '💎'] },
  { id: 'cursed_tomb', name: 'Cursed Tomb', theme: 'horror',
    bg: 'linear-gradient(135deg, #141008 0%, #282010 50%, #0a0804 100%)',
    reelBg: 'linear-gradient(180deg, #0a0804 0%, #141008 100%)',
    accent: '#a08030', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'high', mechanic: 'hold_and_win',
    symbols: ['💀', '🏺', '🕷️', '🐍', '🔥', '⭐', '💎'] },
  { id: 'werewolf_moon', name: 'Werewolf Moon', theme: 'horror',
    bg: 'linear-gradient(135deg, #0a0a1a 0%, #141428 50%, #05050d 100%)',
    reelBg: 'linear-gradient(180deg, #05050d 0%, #0a0a1a 100%)',
    accent: '#6080c0', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium-high', mechanic: 'expanding_wilds',
    symbols: ['🐺', '🌕', '🌲', '🦴', '🌙', '⭐', '💎'] },
  { id: 'ghost_ship', name: 'Ghost Ship', theme: 'horror',
    bg: 'linear-gradient(135deg, #0a1414 0%, #142828 50%, #050a0a 100%)',
    reelBg: 'linear-gradient(180deg, #050a0a 0%, #0a1414 100%)',
    accent: '#40a0a0', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium', mechanic: 'walking_wilds',
    symbols: ['👻', '⛵', '🌊', '💀', '⚓', '⭐', '💎'] },
  { id: 'demons_gold', name: "Demon's Gold", theme: 'horror',
    bg: 'linear-gradient(135deg, #1a0500 0%, #3d0a00 50%, #0d0200 100%)',
    reelBg: 'linear-gradient(180deg, #0d0200 0%, #1a0500 100%)',
    accent: '#ff3020', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'high', mechanic: 'multiplier_wilds',
    symbols: ['😈', '🔥', '💰', '⛓️', '💀', '⭐', '💎'] },
  { id: 'nightmare_circus', name: 'Nightmare Circus', theme: 'horror',
    bg: 'linear-gradient(135deg, #1a0a14 0%, #3d1428 50%, #0d050a 100%)',
    reelBg: 'linear-gradient(180deg, #0d050a 0%, #1a0a14 100%)',
    accent: '#e04060', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium-high', mechanic: 'prize_wheel',
    symbols: ['🤡', '🎪', '🎭', '🎈', '🔮', '⭐', '💎'] },

  // ============ AUSTRALIAN / OUTBACK (10) ============
  { id: 'kookaburra_cash', name: 'Kookaburra Cash', theme: 'australian',
    bg: 'linear-gradient(135deg, #282014 0%, #504028 50%, #14100a 100%)',
    reelBg: 'linear-gradient(180deg, #14100a 0%, #282014 100%)',
    accent: '#c0a060', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium', mechanic: 'expanding_wilds',
    symbols: ['🐦', '🌾', '🦎', '🌅', '🪃', '⭐', '💎'] },
  { id: 'outback_gold', name: 'Outback Gold', theme: 'australian',
    bg: 'linear-gradient(135deg, #3d1400 0%, #8b3000 50%, #1a0a00 100%)',
    reelBg: 'linear-gradient(180deg, #1a0a00 0%, #3d1400 100%)',
    accent: '#ff6020', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium-high', mechanic: 'hold_and_win',
    symbols: ['🤠', '💰', '🌵', '🦘', '🌅', '⭐', '💎'] },
  { id: 'kangaroo_king', name: 'Kangaroo King', theme: 'australian',
    bg: 'linear-gradient(135deg, #281808 0%, #503010 50%, #140c04 100%)',
    reelBg: 'linear-gradient(180deg, #140c04 0%, #281808 100%)',
    accent: '#d09040', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium', mechanic: 'walking_wilds',
    symbols: ['🦘', '🌿', '🌾', '🐊', '🌅', '⭐', '💎'] },
  { id: 'great_barrier', name: 'Great Barrier', theme: 'australian',
    bg: 'linear-gradient(135deg, #001428 0%, #002850 50%, #000a14 100%)',
    reelBg: 'linear-gradient(180deg, #000a14 0%, #001428 100%)',
    accent: '#40a0e0', cols: 6, rows: 5, winType: 'cluster', template: 'scatter',
    vol: 'medium', mechanic: 'cascading',
    symbols: ['🐠', '🐙', '🐚', '🪸', '🐢', '⭐', '💎', '🌊'] },
  { id: 'boomerang_bonus', name: 'Boomerang Bonus', theme: 'australian',
    bg: 'linear-gradient(135deg, #281408 0%, #502810 50%, #140a04 100%)',
    reelBg: 'linear-gradient(180deg, #140a04 0%, #281408 100%)',
    accent: '#d08040', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium', mechanic: 'respin',
    symbols: ['🪃', '🦘', '🌾', '🎯', '🌅', '⭐', '💎'] },
  { id: 'platypus_pays', name: 'Platypus Pays', theme: 'australian',
    bg: 'linear-gradient(135deg, #0a1a14 0%, #143428 50%, #050d0a 100%)',
    reelBg: 'linear-gradient(180deg, #050d0a 0%, #0a1a14 100%)',
    accent: '#40a080', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'low', mechanic: 'coin_respin',
    symbols: ['🦆', '🌿', '💧', '🐛', '🪨', '⭐', '💎'] },
  { id: 'sydney_nights', name: 'Sydney Nights', theme: 'australian',
    bg: 'linear-gradient(135deg, #0a0a28 0%, #141450 50%, #050514 100%)',
    reelBg: 'linear-gradient(180deg, #050514 0%, #0a0a28 100%)',
    accent: '#6080ff', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium-high', mechanic: 'sticky_wilds',
    symbols: ['🌃', '🏙️', '🎆', '🌉', '🎰', '⭐', '💎'] },
  { id: 'koala_kingdom', name: 'Koala Kingdom', theme: 'australian',
    bg: 'linear-gradient(135deg, #142814 0%, #285028 50%, #0a140a 100%)',
    reelBg: 'linear-gradient(180deg, #0a140a 0%, #142814 100%)',
    accent: '#60c060', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'low', mechanic: 'tumble',
    symbols: ['🐨', '🌿', '🍃', '🌳', '🌸', '⭐', '💎'] },
  { id: 'uluru_sunset', name: 'Uluru Sunset', theme: 'australian',
    bg: 'linear-gradient(135deg, #3d1000 0%, #8b2000 50%, #1a0800 100%)',
    reelBg: 'linear-gradient(180deg, #1a0800 0%, #3d1000 100%)',
    accent: '#ff4020', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium', mechanic: 'stacked_wilds',
    symbols: ['🌅', '🪨', '🦎', '🌵', '🐍', '⭐', '💎'] },
  { id: 'crocodile_creek', name: 'Crocodile Creek', theme: 'australian',
    bg: 'linear-gradient(135deg, #0a1a08 0%, #143410 50%, #050d04 100%)',
    reelBg: 'linear-gradient(180deg, #050d04 0%, #0a1a08 100%)',
    accent: '#40a030', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'high', mechanic: 'random_multiplier',
    symbols: ['🐊', '🌿', '🐸', '🦆', '💰', '⭐', '💎'] },

  // ============ BONUS WILDCARD (9) ============
  { id: 'pirate_plunder', name: 'Pirate Plunder', theme: 'pirate',
    bg: 'linear-gradient(135deg, #0a1420 0%, #142840 50%, #050a10 100%)',
    reelBg: 'linear-gradient(180deg, #050a10 0%, #0a1420 100%)',
    accent: '#d0a030', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'high', mechanic: 'hold_and_win',
    symbols: ['🏴‍☠️', '💰', '🗡️', '🦜', '⚓', '⭐', '💎'] },
  { id: 'steampunk_forge', name: 'Steampunk Forge', theme: 'steampunk',
    bg: 'linear-gradient(135deg, #1a1408 0%, #3d2810 50%, #0d0a04 100%)',
    reelBg: 'linear-gradient(180deg, #0d0a04 0%, #1a1408 100%)',
    accent: '#c09040', cols: 5, rows: 4, winType: 'payline', template: 'extended',
    vol: 'medium-high', mechanic: 'wheel_multiplier',
    symbols: ['⚙️', '🔧', '🔩', '💡', '🔥', '⭐', '💎'] },
  { id: 'underwater_riches', name: 'Underwater Riches', theme: 'underwater',
    bg: 'linear-gradient(135deg, #001028 0%, #002050 50%, #000814 100%)',
    reelBg: 'linear-gradient(180deg, #000814 0%, #001028 100%)',
    accent: '#2090d0', cols: 6, rows: 5, winType: 'cluster', template: 'scatter',
    vol: 'medium', mechanic: 'cascading',
    symbols: ['🐙', '🐬', '🐚', '🌊', '💎', '⭐', '🔱', '🐠'] },
  { id: 'candy_kingdom', name: 'Candy Kingdom', theme: 'candy',
    bg: 'linear-gradient(135deg, #3d0028 0%, #8b0050 50%, #1a0014 100%)',
    reelBg: 'linear-gradient(180deg, #1a0014 0%, #3d0028 100%)',
    accent: '#ff40a0', cols: 7, rows: 7, winType: 'cluster', template: 'grid',
    vol: 'low', mechanic: 'tumble',
    symbols: ['🍬', '🍭', '🍫', '🧁', '🍩', '⭐', '💎', '🌟'] },
  { id: 'wild_west_gold', name: 'Wild West Gold', theme: 'western',
    bg: 'linear-gradient(135deg, #281808 0%, #503010 50%, #140c04 100%)',
    reelBg: 'linear-gradient(180deg, #140c04 0%, #281808 100%)',
    accent: '#d0a030', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'high', mechanic: 'sticky_wilds',
    symbols: ['🤠', '🔫', '💰', '🐎', '🌵', '⭐', '💎'] },
  { id: 'dia_de_muertos', name: 'Día de Muertos', theme: 'festival',
    bg: 'linear-gradient(135deg, #1a0028 0%, #3d0050 50%, #0d0014 100%)',
    reelBg: 'linear-gradient(180deg, #0d0014 0%, #1a0028 100%)',
    accent: '#ff8020', cols: 5, rows: 4, winType: 'payline', template: 'extended',
    vol: 'medium-high', mechanic: 'expanding_symbol',
    symbols: ['💀', '🌺', '🕯️', '🎸', '🌮', '⭐', '💎'] },
  { id: 'norse_legends', name: 'Norse Legends', theme: 'norse',
    bg: 'linear-gradient(135deg, #0a1428 0%, #142850 50%, #050a14 100%)',
    reelBg: 'linear-gradient(180deg, #050a14 0%, #0a1428 100%)',
    accent: '#80c0e0', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'high', mechanic: 'increasing_mult',
    symbols: ['⚔️', '🛡️', '🐺', '❄️', '🌊', '⭐', '💎'] },
  { id: 'treasure_island', name: 'Treasure Island', theme: 'pirate',
    bg: 'linear-gradient(135deg, #002820 0%, #005040 50%, #001410 100%)',
    reelBg: 'linear-gradient(180deg, #001410 0%, #002820 100%)',
    accent: '#40c080', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium', mechanic: 'coin_respin',
    symbols: ['🏝️', '💰', '🗺️', '🦜', '⛵', '⭐', '💎'] },
  { id: 'casino_royale_vip', name: 'Casino Royale VIP', theme: 'luxury',
    bg: 'linear-gradient(135deg, #0a0a14 0%, #1a1a28 50%, #05050a 100%)',
    reelBg: 'linear-gradient(180deg, #05050a 0%, #0a0a14 100%)',
    accent: '#d4a017', cols: 5, rows: 3, winType: 'payline', template: 'standard',
    vol: 'medium-high', mechanic: 'random_jackpot',
    symbols: ['🎰', '🃏', '💎', '🥂', '👑', '⭐', '🌟'] },
];

// Theme → display name mapping
const THEME_NAMES = {
  egypt: 'Ancient Egypt', mythology: 'Mythology', fruit: 'Fruit Classics',
  space: 'Space / Sci-Fi', fantasy: 'Fantasy / Magic', animals: 'Animals / Wildlife',
  asian: 'Asian / Lucky', horror: 'Horror / Dark', australian: 'Australian / Outback',
  pirate: 'Pirate', steampunk: 'Steampunk', underwater: 'Underwater',
  candy: 'Candy', western: 'Wild West', festival: 'Festival',
  norse: 'Norse', luxury: 'Luxury'
};

// Generate full game definitions
function generateDefinitions() {
  let lines = [];
  lines.push("'use strict';");
  lines.push('');
  lines.push('/**');
  lines.push(' * 100 Premium Slot Game Definitions');
  lines.push(' * Each game has a unique theme, colour palette, symbol set, and signature mechanic.');
  lines.push(' * RTP range: 88-94% | Volatility: low to very high');
  lines.push(' */');
  lines.push('');
  lines.push('// eslint-disable-next-line no-unused-vars');
  lines.push('var games = [');

  let currentTheme = '';

  GAMES.forEach(function(g, idx) {
    // Theme section comment
    const themeName = THEME_NAMES[g.theme] || g.theme;
    if (g.theme !== currentTheme) {
      currentTheme = g.theme;
      lines.push('');
      lines.push('  // ═══════════════════════════════════════');
      lines.push('  // ' + themeName.toUpperCase());
      lines.push('  // ═══════════════════════════════════════');
    }

    const rtp = Math.round(rtpForVol(g.vol) * 100) / 100;
    const tag = tagFor(g.vol, g.mechanic, idx);
    const provider = providerFor(idx);
    const payouts = payoutsFor(g.vol, g.winType, g.cols);
    const fsCount = freeSpinsFor(g.mechanic);
    const bonusDesc = bonusDescFor(g.mechanic, g.name);

    // Wild is second-to-last symbol, scatter is last
    const wildSym = g.symbols[g.symbols.length - 2];
    const scatterSym = g.symbols[g.symbols.length - 1];

    // Build mechanic-specific fields
    let mechFields = '';
    if (g.mechanic === 'tumble' || g.mechanic === 'cascading') {
      mechFields += `\n    tumbleMultipliers: [1, 2, 3, 5, 8, 12, 15, 20],`;
    }
    if (g.mechanic === 'zeus_multiplier') {
      mechFields += `\n    zeusMultipliers: [1, 2, 3, 5, 10, 25, 50, 100, 250, 500],`;
    }
    if (g.mechanic === 'wheel_multiplier') {
      mechFields += `\n    wheelMultipliers: [2, 3, 5, 8, 10, 15, 20, 25],`;
    }
    if (g.mechanic === 'hold_and_win' || g.mechanic === 'coin_respin') {
      mechFields += `\n    holdAndWinRespins: 3,`;
    }
    if (g.mechanic === 'expanding_wilds' || g.mechanic === 'expanding_symbol') {
      mechFields += `\n    expandingWildMaxRespins: 3,`;
    }
    if (g.mechanic === 'random_multiplier') {
      mechFields += `\n    randomMultiplierRange: [2, 3, 5, 8, 10],`;
    }
    if (g.mechanic === 'respin') {
      mechFields += `\n    maxRespins: 3,`;
    }

    // Cluster-specific fields
    let clusterField = '';
    if (g.winType === 'cluster') {
      clusterField = `\n    clusterMin: 5,`;
    }

    // Jackpot for random_jackpot games
    const jackpotVal = g.mechanic === 'random_jackpot' ? 10000 : 0;

    lines.push(`  {
    id: '${g.id}',
    name: '${g.name.replace(/'/g, "\\'")}',
    theme: '${g.theme}',
    provider: '${provider}',
    tag: '${tag[0]}', tagClass: '${tag[1]}',
    thumbnail: 'assets/thumbnails/${g.id}.png',
    bgGradient: '${g.bg}',
    reelBg: '${g.reelBg}',
    accentColor: '${g.accent}',
    gridCols: ${g.cols}, gridRows: ${g.rows},
    template: '${g.template}',
    winType: '${g.winType}',${clusterField}
    symbols: ${JSON.stringify(g.symbols)},
    wildSymbol: '${wildSym}',
    scatterSymbol: '${scatterSym}',
    rtp: ${rtp},
    volatility: '${g.vol}',
    bonusType: '${g.mechanic}',
    freeSpinsCount: ${fsCount},
    freeSpinsRetrigger: ${fsCount >= 8},${mechFields}
    bonusDesc: '${bonusDesc.replace(/'/g, "\\'")}',
    payouts: ${JSON.stringify(payouts)},
    minBet: 0.20,
    maxBet: ${g.vol === 'very high' ? 500 : g.vol === 'high' ? 300 : 200},
    hot: ${g.vol === 'high' || g.vol === 'very high'},
    jackpot: ${jackpotVal}
  }${idx < GAMES.length - 1 ? ',' : ''}`);
  });

  lines.push('];');
  lines.push('');
  lines.push('// Theme metadata for lobby grouping');
  lines.push('var GAME_THEMES = ' + JSON.stringify(THEME_NAMES, null, 2) + ';');
  lines.push('');
  lines.push("if (typeof module !== 'undefined' && module.exports) {");
  lines.push('  module.exports = { games: games, GAME_THEMES: GAME_THEMES };');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

// Write output
const output = generateDefinitions();
const outPath = path.join(__dirname, '..', 'shared', 'game-definitions.js');
fs.writeFileSync(outPath, output, 'utf8');

console.log('Generated ' + GAMES.length + ' game definitions');
console.log('Output: ' + outPath);
console.log('File size: ' + (output.length / 1024).toFixed(1) + ' KB');

// Verify theme distribution
const dist = {};
GAMES.forEach(function(g) {
  const cat = ['egypt', 'mythology'].includes(g.theme) ? 'egypt/mythology'
    : ['pirate', 'steampunk', 'underwater', 'candy', 'western', 'festival', 'norse', 'luxury'].includes(g.theme) ? 'wildcard'
    : g.theme;
  dist[cat] = (dist[cat] || 0) + 1;
});
console.log('\nTheme distribution:');
Object.entries(dist).sort((a, b) => b[1] - a[1]).forEach(function([k, v]) {
  console.log('  ' + k + ': ' + v);
});

const SYMBOLS = {
  CHERRY: { id: 'CHERRY', payout: { 3: 10, 4: 25, 5: 50 } },
  LEMON: { id: 'LEMON', payout: { 3: 5, 4: 15, 5: 30 } },
  ORANGE: { id: 'ORANGE', payout: { 3: 5, 4: 15, 5: 30 } },
  PLUM: { id: 'PLUM', payout: { 3: 5, 4: 15, 5: 30 } },
  BELL: { id: 'BELL', payout: { 3: 20, 4: 50, 5: 100 } },
  SEVEN: { id: 'SEVEN', payout: { 3: 50, 4: 150, 5: 300 } },
  JACKPOT: { id: 'JACKPOT', payout: { 3: 100, 4: 500, 5: 0 } }, // 5 JACKPOTS triggers progressive
};

const REELS = [
  ['CHERRY', 'LEMON', 'ORANGE', 'PLUM', 'BELL', 'SEVEN', 'JACKPOT', 'LEMON', 'ORANGE', 'PLUM', 'BELL', 'SEVEN', 'CHERRY', 'LEMON', 'ORANGE', 'PLUM', 'BELL', 'SEVEN'],
  ['CHERRY', 'LEMON', 'ORANGE', 'PLUM', 'BELL', 'SEVEN', 'JACKPOT', 'LEMON', 'ORANGE', 'PLUM', 'BELL', 'SEVEN', 'CHERRY', 'LEMON', 'ORANGE', 'PLUM', 'BELL', 'SEVEN'],
  ['CHERRY', 'LEMON', 'ORANGE', 'PLUM', 'BELL', 'SEVEN', 'JACKPOT', 'LEMON', 'ORANGE', 'PLUM', 'BELL', 'SEVEN', 'CHERRY', 'LEMON', 'ORANGE', 'PLUM', 'BELL', 'SEVEN'],
  ['CHERRY', 'LEMON', 'ORANGE', 'PLUM', 'BELL', 'SEVEN', 'JACKPOT', 'LEMON', 'ORANGE', 'PLUM', 'BELL', 'SEVEN', 'CHERRY', 'LEMON', 'ORANGE', 'PLUM', 'BELL', 'SEVEN'],
  ['CHERRY', 'LEMON', 'ORANGE', 'PLUM', 'BELL', 'SEVEN', 'JACKPOT', 'LEMON', 'ORANGE', 'PLUM', 'BELL', 'SEVEN', 'CHERRY', 'LEMON', 'ORANGE', 'PLUM', 'BELL', 'SEVEN'],
];

const PAYLINES = [
  [1, 1, 1, 1, 1], // Middle line
  [0, 0, 0, 0, 0], // Top line
  [2, 2, 2, 2, 2], // Bottom line
  [0, 1, 2, 1, 0], // V-shape
  [2, 1, 0, 1, 2], // Inverted V-shape
];

module.exports = {
  SYMBOLS,
  REELS,
  PAYLINES,
};

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const WIDTH = 1200;
const HEIGHT = 630;

const canvas = createCanvas(WIDTH, HEIGHT);
const ctx = canvas.getContext('2d');

// --- Background gradient ---
const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
bg.addColorStop(0, '#0D0F14');
bg.addColorStop(1, '#1A1D27');
ctx.fillStyle = bg;
ctx.fillRect(0, 0, WIDTH, HEIGHT);

// --- Subtle radial glow behind center text ---
const glow = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2 - 30, 0, WIDTH / 2, HEIGHT / 2 - 30, 340);
glow.addColorStop(0, 'rgba(212, 168, 83, 0.08)');
glow.addColorStop(1, 'rgba(212, 168, 83, 0)');
ctx.fillStyle = glow;
ctx.fillRect(0, 0, WIDTH, HEIGHT);

// --- Gold border frame ---
const GOLD = '#D4A853';
const GOLD_DIM = 'rgba(212, 168, 83, 0.35)';
const BORDER_INSET = 28;
const BORDER_WIDTH = 1.5;

ctx.strokeStyle = GOLD_DIM;
ctx.lineWidth = BORDER_WIDTH;
ctx.strokeRect(BORDER_INSET, BORDER_INSET, WIDTH - BORDER_INSET * 2, HEIGHT - BORDER_INSET * 2);

// --- Corner accents (L-shaped brackets) ---
const CORNER_LEN = 50;
const CORNER_WIDTH = 2.5;
const CI = BORDER_INSET - 6; // corner inset

ctx.strokeStyle = GOLD;
ctx.lineWidth = CORNER_WIDTH;
ctx.lineCap = 'round';

// Top-left
ctx.beginPath();
ctx.moveTo(CI, CI + CORNER_LEN);
ctx.lineTo(CI, CI);
ctx.lineTo(CI + CORNER_LEN, CI);
ctx.stroke();

// Top-right
ctx.beginPath();
ctx.moveTo(WIDTH - CI - CORNER_LEN, CI);
ctx.lineTo(WIDTH - CI, CI);
ctx.lineTo(WIDTH - CI, CI + CORNER_LEN);
ctx.stroke();

// Bottom-left
ctx.beginPath();
ctx.moveTo(CI, HEIGHT - CI - CORNER_LEN);
ctx.lineTo(CI, HEIGHT - CI);
ctx.lineTo(CI + CORNER_LEN, HEIGHT - CI);
ctx.stroke();

// Bottom-right
ctx.beginPath();
ctx.moveTo(WIDTH - CI - CORNER_LEN, HEIGHT - CI);
ctx.lineTo(WIDTH - CI, HEIGHT - CI);
ctx.lineTo(WIDTH - CI, HEIGHT - CI - CORNER_LEN);
ctx.stroke();

// --- Thin gold decorative lines flanking the title area ---
const LINE_Y_TOP = 210;
const LINE_Y_BOT = 400;
const LINE_PAD = 160;

ctx.strokeStyle = 'rgba(212, 168, 83, 0.2)';
ctx.lineWidth = 1;

ctx.beginPath();
ctx.moveTo(LINE_PAD, LINE_Y_TOP);
ctx.lineTo(WIDTH - LINE_PAD, LINE_Y_TOP);
ctx.stroke();

ctx.beginPath();
ctx.moveTo(LINE_PAD, LINE_Y_BOT);
ctx.lineTo(WIDTH - LINE_PAD, LINE_Y_BOT);
ctx.stroke();

// --- Small diamond accents on the lines ---
function drawDiamond(cx, cy, size, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx, cy - size);
  ctx.lineTo(cx + size, cy);
  ctx.lineTo(cx, cy + size);
  ctx.lineTo(cx - size, cy);
  ctx.closePath();
  ctx.fill();
}

drawDiamond(WIDTH / 2, LINE_Y_TOP, 4, GOLD);
drawDiamond(WIDTH / 2, LINE_Y_BOT, 4, GOLD);

// --- Crown symbol ---
ctx.fillStyle = GOLD;
ctx.font = 'bold 44px serif';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillText('♛', WIDTH / 2, 170);

// --- Main title: "Matrix Spins" ---
ctx.fillStyle = GOLD;
ctx.font = 'bold 72px "Arial Black", "Impact", "Trebuchet MS", sans-serif';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';

// Subtle gold text shadow
ctx.shadowColor = 'rgba(212, 168, 83, 0.4)';
ctx.shadowBlur = 20;
ctx.shadowOffsetX = 0;
ctx.shadowOffsetY = 0;
ctx.fillText('MATRIX SPINS', WIDTH / 2, 280);

// Reset shadow
ctx.shadowColor = 'transparent';
ctx.shadowBlur = 0;

// --- Tagline ---
ctx.fillStyle = '#F0F0F5';
ctx.font = '600 24px "Arial", "Helvetica Neue", sans-serif';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillText('Premium Online Slots  •  100 Games  •  Play Free', WIDTH / 2, 348);

// --- Bottom bar background ---
ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
ctx.fillRect(0, HEIGHT - 65, WIDTH, 65);

// Thin gold line at top of bottom bar
ctx.strokeStyle = 'rgba(212, 168, 83, 0.3)';
ctx.lineWidth = 1;
ctx.beginPath();
ctx.moveTo(0, HEIGHT - 65);
ctx.lineTo(WIDTH, HEIGHT - 65);
ctx.stroke();

// --- Bottom URL text ---
ctx.fillStyle = 'rgba(212, 168, 83, 0.6)';
ctx.font = '500 18px "Arial", "Helvetica Neue", sans-serif';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillText('msaart.online', WIDTH / 2, HEIGHT - 33);

// --- Export ---
const outDir = path.join(__dirname, 'img');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const outPath = path.join(outDir, 'og-banner.png');
const buffer = canvas.toBuffer('image/png');
fs.writeFileSync(outPath, buffer);

console.log(`OG banner generated: ${outPath} (${WIDTH}x${HEIGHT})`);

import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import * as pico from '@picojs/pico';

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

// Pre-generated image URLs
const slotAssets = [
  { symbol: 'Blue Orb', image: 'https://example.com/assets/matrix-blue-orb.png' },
  { symbol: 'Green Orb', image: 'https://example.com/assets/matrix-green-orb.png' },
  { symbol: 'Red Orb', image: 'https://example.com/assets/matrix-red-orb.png' },
  { symbol: 'Purple Orb', image: 'https://example.com/assets/matrix-purple-orb.png' },
  { symbol: 'Yellow Orb', image: 'https://example.com/assets/matrix-yellow-orb.png' },
  { symbol: 'Red Pill', image: 'https://example.com/assets/matrix-pill.png' },
  { symbol: 'Sunglasses', image: 'https://example.com/assets/matrix-sunglasses.png' },
  { symbol: 'Computer', image: 'https://example.com/assets/matrix-computer.png' },
  { symbol: 'Unlock', image: 'https://example.com/assets/matrix-unlock.png' },
  { symbol: 'Hourglass', image: 'https://example.com/assets/matrix-hourglass.png' }
];

const gameBackgrounds = [
  { game: 'Matrix Reloaded', image: 'https://example.com/assets/matrix-background.png' },
  { game: 'Cybernetic Spin', image: 'https://example.com/assets/cyber-background.png' },
  { game: 'Quantum Quandary', image: 'https://example.com/assets/quantum-background.png' },
  { game: 'Neural Network', image: 'https://example.com/assets/neural-background.png' }
];

const promotionImages = [
  'https://example.com/assets/promotion-1.png',
  'https://example.com/assets/promotion-2.png',
  'https://example.com/assets/promotion-3.png',
  'https://example.com/assets/promotion-4.png',
  'https://example.com/assets/promotion-5.png',
  'https://example.com/assets/promotion-6.png'
];

export function getSlotAssets() {
  return slotAssets;
}

export function getGameBackgrounds() {
  return gameBackgrounds;
}

export function getPromotionImages() {
  return promotionImages;
}

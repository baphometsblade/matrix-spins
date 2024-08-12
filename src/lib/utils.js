import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

// Function for image generation using the provided API
// Slot assets
export const slotAssets = {
  matrix: [
    { symbol: 'Blue Orb', image: '/placeholder.svg' },
    { symbol: 'Green Orb', image: '/placeholder.svg' },
    { symbol: 'Red Orb', image: '/placeholder.svg' },
    { symbol: 'Purple Orb', image: '/placeholder.svg' },
    { symbol: 'Yellow Orb', image: '/placeholder.svg' },
    { symbol: 'Red Pill', image: '/placeholder.svg' },
    { symbol: 'Sunglasses', image: '/placeholder.svg' },
    { symbol: 'Computer', image: '/placeholder.svg' },
    { symbol: 'Unlock', image: '/placeholder.svg' },
    { symbol: 'Hourglass', image: '/placeholder.svg' },
  ],
  // Add other game themes here if needed
};

// Game backgrounds
export const gameBackgrounds = [
  { game: 'Matrix Reloaded', image: '/placeholder.svg' },
  { game: 'Cybernetic Spin', image: '/placeholder.svg' },
  { game: 'Quantum Quandary', image: '/placeholder.svg' },
  { game: 'Neural Network', image: '/placeholder.svg' },
];

// Promotion images
export const promotionImages = [
  '/placeholder.svg',
  '/placeholder.svg',
  '/placeholder.svg',
  '/placeholder.svg',
  '/placeholder.svg',
  '/placeholder.svg',
];

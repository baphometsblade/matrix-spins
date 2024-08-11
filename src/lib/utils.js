import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

// Function for image generation using the provided API
// Function for image generation using the provided API
// Generate slot assets
export function generateSlotAssets() {
  const symbols = ['Blue Orb', 'Green Orb', 'Red Orb', 'Purple Orb', 'Yellow Orb', 'Red Pill', 'Sunglasses', 'Computer', 'Unlock', 'Hourglass'];
  return symbols.map((symbol) => {
    const filename = `matrix-${symbol.toLowerCase().replace(' ', '-')}.png`;
    return { symbol, image: `/assets/${filename}` };
  });
}

// Pre-generate game background images
export function generateGameBackgrounds() {
  const games = ['Matrix Reloaded', 'Cybernetic Spin', 'Quantum Quandary', 'Neural Network'];
  return games.map(game => {
    const filename = `${game.toLowerCase().replace(' ', '-')}-background.png`;
    return { game, image: `/assets/${filename}` };
  });
}

// Initialize and export pre-generated assets
export const slotAssets = {
  matrix: generateSlotAssets(),
  // Add other game themes here
};
export const gameBackgrounds = generateGameBackgrounds();

import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

// Mock functions for image generation and saving
export function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

// Pre-generated slot assets
export const slotAssets = {
  matrix: [
    { symbol: '🔵', image: '/assets/matrix-blue-orb.png' },
    { symbol: '🟢', image: '/assets/matrix-green-orb.png' },
    { symbol: '🔴', image: '/assets/matrix-red-orb.png' },
    { symbol: '🟣', image: '/assets/matrix-purple-orb.png' },
    { symbol: '🟡', image: '/assets/matrix-yellow-orb.png' },
    { symbol: '💊', image: '/assets/matrix-pill.png' },
    { symbol: '🕶️', image: '/assets/matrix-sunglasses.png' },
    { symbol: '🖥️', image: '/assets/matrix-computer.png' },
    { symbol: '🔓', image: '/assets/matrix-unlock.png' },
    { symbol: '⏳', image: '/assets/matrix-hourglass.png' },
  ],
  // Add other game assets here...
};

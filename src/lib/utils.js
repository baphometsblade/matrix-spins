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
    { symbol: '🔵', image: '/placeholder.svg' },
    { symbol: '🟢', image: '/placeholder.svg' },
    { symbol: '🔴', image: '/placeholder.svg' },
    { symbol: '🟣', image: '/placeholder.svg' },
    { symbol: '🟡', image: '/placeholder.svg' },
    { symbol: '💊', image: '/placeholder.svg' },
    { symbol: '🕶️', image: '/placeholder.svg' },
    { symbol: '🖥️', image: '/placeholder.svg' },
    { symbol: '🔓', image: '/placeholder.svg' },
    { symbol: '⏳', image: '/placeholder.svg' },
  ],
  // Add other game assets here...
};

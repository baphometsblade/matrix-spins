import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import * as pico from '@picojs/pico';

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

// Pico API for image generation
export async function generateImage(prompt, width = 512, height = 512) {
  try {
    const response = await pico.default.generateImage({
      prompt,
      width,
      height,
      modelVersion: 'v1',
    });
    return response.imageUrl;
  } catch (error) {
    console.error('Error generating image:', error);
    return '/placeholder.svg';
  }
}

// Pre-generate slot assets
export async function generateSlotAssets() {
  const symbols = ['Blue Orb', 'Green Orb', 'Red Orb', 'Purple Orb', 'Yellow Orb', 'Red Pill', 'Sunglasses', 'Computer', 'Unlock', 'Hourglass'];
  const assets = await Promise.all(symbols.map(async (symbol) => {
    const image = await generateImage(`${symbol} icon, neon style, matrix theme`, 128, 128);
    return { symbol, image };
  }));
  return assets;
}

// Pre-generate promotion images
export async function generatePromotionImages() {
  const promotions = [
    'Welcome Package casino promotion',
    'Weekly Cashback casino promotion',
    'Refer a Friend casino promotion',
    'Daily Drops & Wins casino promotion',
    'VIP Program casino promotion',
    'Slot of the Week casino promotion'
  ];
  const images = await Promise.all(promotions.map(prompt => generateImage(prompt, 512, 256)));
  return images;
}

// Initialize and export pre-generated assets
export let slotAssets = {};
export let promotionImages = [];

(async () => {
  slotAssets = {
    matrix: await generateSlotAssets(),
    // Add other game themes here
  };
  promotionImages = await generatePromotionImages();
})();

import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

// Image generation function
export async function generateImage(prompt, width = 512, height = 512, filename) {
  console.log(`Generating image for: ${prompt}`);
  
  // In a real application, you would use an AI image generation service here
  // For this example, we'll create a simple colored rectangle
  const buffer = await sharp({
    create: {
      width: width,
      height: height,
      channels: 4,
      background: { r: Math.random() * 255, g: Math.random() * 255, b: Math.random() * 255, alpha: 1 }
    }
  })
    .png()
    .toBuffer();

  const filePath = path.join(process.cwd(), 'public', 'assets', filename);
  await fs.writeFile(filePath, buffer);

  return `/assets/${filename}`;
}

// Pre-generate slot assets
export function generateSlotAssets() {
  const symbols = ['Blue Orb', 'Green Orb', 'Red Orb', 'Purple Orb', 'Yellow Orb', 'Red Pill', 'Sunglasses', 'Computer', 'Unlock', 'Hourglass'];
  return symbols.map((symbol, index) => {
    const filename = `slot-${symbol.toLowerCase().replace(' ', '-')}.png`;
    return { symbol, image: `/assets/${filename}` };
  });
}

// Pre-generate promotion images
export function generatePromotionImages() {
  const promotions = [
    'Welcome Package casino promotion',
    'Weekly Cashback casino promotion',
    'Refer a Friend casino promotion',
    'Daily Drops & Wins casino promotion',
    'VIP Program casino promotion',
    'Slot of the Week casino promotion'
  ];
  return promotions.map((_, index) => `/assets/promotion-${index + 1}.png`);
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
export let slotAssets = {};
export let promotionImages = [];
export let gameBackgrounds = [];

(async () => {
  slotAssets = {
    matrix: await generateSlotAssets(),
    // Add other game themes here
  };
  promotionImages = await generatePromotionImages();
  gameBackgrounds = await generateGameBackgrounds();
})();

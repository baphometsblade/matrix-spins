import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import * as pico from '@picojs/pico';
import fs from 'fs';
import path from 'path';

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

// Pico API for image generation
export async function generateImage(prompt, width = 512, height = 512, filename) {
  try {
    const response = await pico.default.generateImage({
      prompt,
      width,
      height,
      modelVersion: 'v1',
    });
    
    const buffer = Buffer.from(await (await fetch(response.imageUrl)).arrayBuffer());
    const filePath = path.join(process.cwd(), 'public', 'assets', filename);
    fs.writeFileSync(filePath, buffer);
    
    return `/assets/${filename}`;
  } catch (error) {
    console.error('Error generating image:', error);
    return '/placeholder.svg';
  }
}

// Pre-generate slot assets
export async function generateSlotAssets() {
  const symbols = ['Blue Orb', 'Green Orb', 'Red Orb', 'Purple Orb', 'Yellow Orb', 'Red Pill', 'Sunglasses', 'Computer', 'Unlock', 'Hourglass'];
  const assets = await Promise.all(symbols.map(async (symbol, index) => {
    const filename = `slot-${symbol.toLowerCase().replace(' ', '-')}.png`;
    const image = await generateImage(`${symbol} icon, neon style, matrix theme`, 128, 128, filename);
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
  const images = await Promise.all(promotions.map(async (prompt, index) => {
    const filename = `promotion-${index + 1}.png`;
    return generateImage(prompt, 512, 256, filename);
  }));
  return images;
}

// Pre-generate game background images
export async function generateGameBackgrounds() {
  const games = ['Matrix Reloaded', 'Cybernetic Spin', 'Quantum Quandary', 'Neural Network'];
  const backgrounds = await Promise.all(games.map(async (game, index) => {
    const filename = `${game.toLowerCase().replace(' ', '-')}-background.png`;
    const image = await generateImage(`${game} slot machine game background, digital art style, vibrant colors, detailed`, 1024, 576, filename);
    return { game, image };
  }));
  return backgrounds;
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

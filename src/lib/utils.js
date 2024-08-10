import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { generateImage as picoGenerateImage } from '@picojs/pico';

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

// Image generation function using Pico API
export async function generateImage(prompt, width = 512, height = 512, filename) {
  console.log(`Generating image for: ${prompt}`);
  
  try {
    const image = await picoGenerateImage({
      prompt,
      width,
      height,
      steps: 50,
      cfg_scale: 7.5,
      sampler: 'k_euler_ancestral',
    });

    // Save the image to the public/assets directory
    const filePath = `/assets/${filename}`;
    await image.save(`public${filePath}`);

    return filePath;
  } catch (error) {
    console.error('Error generating image:', error);
    return '/placeholder.svg'; // Fallback to placeholder if generation fails
  }
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

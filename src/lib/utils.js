import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import pico from '@picojs/pico';

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

export async function generateImage(prompt, width, height) {
  try {
    const response = await pico.generate({
      prompt,
      width,
      height,
      steps: 50,
      cfg_scale: 7.5,
      sampler: 'k_euler_ancestral',
    });
    return response.image_url;
  } catch (error) {
    console.error('Error generating image:', error);
    return null;
  }
}

export async function generateSlotAssets() {
  const symbols = [
    'Blue Orb', 'Green Orb', 'Red Orb', 'Purple Orb', 'Yellow Orb',
    'Red Pill', 'Sunglasses', 'Computer', 'Unlock', 'Hourglass'
  ];
  const assets = await Promise.all(symbols.map(async (symbol) => {
    const image = await generateImage(`Futuristic ${symbol} slot machine symbol, matrix style`, 128, 128);
    return { symbol, image };
  }));
  return assets;
}

export async function generateGameBackgrounds() {
  const games = ['Matrix Reloaded', 'Cybernetic Spin', 'Quantum Quandary', 'Neural Network'];
  const backgrounds = await Promise.all(games.map(async (game) => {
    const image = await generateImage(`Futuristic ${game} slot machine background, matrix style`, 1280, 720);
    return { game, image };
  }));
  return backgrounds;
}

export async function generatePromotionImages() {
  const prompts = [
    'Casino welcome package with stacks of chips and free spin symbols',
    'Casino cashback promotion with calendar and money symbols',
    'Casino refer a friend promotion with people icons and money symbols',
    'Casino daily tournament promotion with trophy and lightning bolt symbols',
    'Casino VIP program promotion with crown and exclusive access symbols',
    'Casino slot of the week promotion with slot machine and sparkle symbols'
  ];
  const images = await Promise.all(prompts.map(prompt => generateImage(prompt, 640, 360)));
  return images;
}

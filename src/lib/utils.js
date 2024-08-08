import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

// Mock functions for image generation and saving
export async function generateImage(prompt, width = 1024, height = 1024) {
  console.log(`Generating image: ${prompt} (${width}x${height})`);
  return `https://picsum.photos/${width}/${height}`;
}

export async function saveImage(imageUrl, fileName) {
  console.log(`Saving image: ${imageUrl} as ${fileName}`);
  return `/images/${fileName}`;
}

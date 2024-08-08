import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import * as pico from '@picojs/pico'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export async function generateImage(prompt, width = 256, height = 256) {
  // Placeholder function as generateImage is not available
  console.warn('generateImage is not implemented');
  return 'https://via.placeholder.com/' + width + 'x' + height;
}

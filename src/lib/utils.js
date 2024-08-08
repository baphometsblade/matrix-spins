import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import * as pico from '@picojs/pico'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function generateImage(prompt, width = 256, height = 256) {
  return pico.generate(prompt, { width, height });
}

export function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

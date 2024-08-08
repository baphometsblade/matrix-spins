import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import pico from '@picojs/pico'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function generateImage(prompt, width = 256, height = 256) {
  return pico.generate(prompt, { width, height })
}

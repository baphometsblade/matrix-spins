import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import * as pico from '@picojs/pico'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export async function generateImage(prompt, width = 256, height = 256) {
  return await pico.generateImage(prompt, { width, height })
}

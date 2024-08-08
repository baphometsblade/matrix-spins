import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import * as pico from '@picojs/pico'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

import OpenAI from 'openai';

const openai = new OpenAI(process.env.OPENAI_API_KEY);

export async function generateImage(prompt, width = 1024, height = 1024) {
  try {
    const response = await openai.images.generate({
      model: "dall-e-3",
      prompt: prompt,
      size: `${width}x${height}`,
      quality: "standard",
      n: 1,
    });
    return response.data[0].url;
  } catch (error) {
    console.error("Error generating image:", error);
    return null;
  }
}

export function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

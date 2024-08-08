import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import * as pico from '@picojs/pico'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function generateImage(prompt, width = 256, height = 256) {
  window.postMessage({
    action: "generateImage",
    prompt: prompt,
    width: width,
    height: height
  }, "https://a.picoapps.xyz/boy-every");
  
  // Return a promise that resolves with the image URL
  return new Promise((resolve) => {
    const handleMessage = (event) => {
      if (event.origin === "https://a.picoapps.xyz" && event.data.action === "imageGenerated") {
        window.removeEventListener("message", handleMessage);
        resolve(event.data.imageUrl);
      }
    };
    window.addEventListener("message", handleMessage);
  });
}

export function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

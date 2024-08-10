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
  // In a real implementation, this would call an AI image generation API
  return `https://source.unsplash.com/random/${width}x${height}?${encodeURIComponent(prompt)}`;
}

export async function saveImage(imageUrl, fileName) {
  console.log(`Saving image: ${imageUrl} as ${fileName}`);
  return `/images/${fileName}`;
}

export async function generateSlotAssets(gameName) {
  const symbols = ['🔵', '🟢', '🔴', '🟣', '🟡', '💊', '🕶️', '🖥️', '🔓', '⏳'];
  const assetPrompts = symbols.map(symbol => `Hyper-realistic 3D render of a ${gameName} themed slot machine symbol: ${symbol}, metallic finish, neon glow, against a dark background, 8k resolution`);
  
  const assets = await Promise.all(assetPrompts.map(async (prompt, index) => {
    const imageUrl = await generateImage(prompt, 512, 512);
    const fileName = `${gameName.toLowerCase().replace(/\s+/g, '-')}-symbol-${index}.png`;
    const savedPath = await saveImage(imageUrl, fileName);
    return { symbol: symbols[index], image: savedPath };
  }));

  return assets;
}

/**
 * Asset Generator for Matrix Spins Casino
 * Generates CSS/SVG fallback symbols for all 100 slot games
 * Provides programmatic symbol generation when Fooocus is unavailable
 */

(function() {
  'use strict';

  // Symbol SVG template library - 30+ base archetypes
  const SYMBOL_TEMPLATES = {
    // Gems & Jewelry
    diamond: (colors) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="diamondGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:${colors[0]};stop-opacity:1" />
        <stop offset="100%" style="stop-color:${colors[1]};stop-opacity:1" />
      </linearGradient></defs>
      <polygon points="50,10 90,50 50,90 10,50" fill="url(#diamondGrad)" stroke="${colors[2]}" stroke-width="2"/>
      <line x1="50" y1="10" x2="50" y2="90" stroke="${colors[2]}" stroke-width="1" opacity="0.5"/>
      <line x1="10" y1="50" x2="90" y2="50" stroke="${colors[2]}" stroke-width="1" opacity="0.5"/>
    </svg>`,

    ruby: (colors) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs><radialGradient id="rubyGrad" cx="35%" cy="35%">
        <stop offset="0%" style="stop-color:${colors[0]};stop-opacity:1" />
        <stop offset="100%" style="stop-color:${colors[1]};stop-opacity:1" />
      </radialGradient></defs>
      <circle cx="50" cy="50" r="40" fill="url(#rubyGrad)" stroke="${colors[2]}" stroke-width="2"/>
      <circle cx="35" cy="35" r="12" fill="${colors[0]}" opacity="0.6"/>
    </svg>`,

    emerald: (colors) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="emeraldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:${colors[0]};stop-opacity:1" />
        <stop offset="100%" style="stop-color:${colors[1]};stop-opacity:1" />
      </linearGradient></defs>
      <rect x="20" y="20" width="60" height="60" rx="8" fill="url(#emeraldGrad)" stroke="${colors[2]}" stroke-width="2"/>
      <line x1="30" y1="30" x2="70" y2="70" stroke="${colors[2]}" stroke-width="1" opacity="0.4"/>
      <line x1="70" y1="30" x2="30" y2="70" stroke="${colors[2]}" stroke-width="1" opacity="0.4"/>
    </svg>`,

    sapphire: (colors) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="sapphireGrad" x1="50%" y1="0%" x2="50%" y2="100%">
        <stop offset="0%" style="stop-color:${colors[0]};stop-opacity:1" />
        <stop offset="50%" style="stop-color:${colors[1]};stop-opacity:1" />
        <stop offset="100%" style="stop-color:${colors[2]};stop-opacity:1" />
      </linearGradient></defs>
      <polygon points="50,15 85,50 70,85 30,85 15,50" fill="url(#sapphireGrad)" stroke="${colors[2]}" stroke-width="2"/>
    </svg>`,

    // Cards
    ace: (colors) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect x="15" y="15" width="70" height="70" rx="4" fill="${colors[0]}" stroke="${colors[2]}" stroke-width="2"/>
      <text x="50" y="50" font-size="48" font-weight="bold" text-anchor="middle" dominant-baseline="central" fill="${colors[2]}">A</text>
      <circle cx="50" cy="50" r="20" fill="none" stroke="${colors[2]}" stroke-width="1" opacity="0.3"/>
    </svg>`,

    king: (colors) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect x="15" y="15" width="70" height="70" rx="4" fill="${colors[0]}" stroke="${colors[2]}" stroke-width="2"/>
      <path d="M 35 35 L 50 25 L 65 35 L 60 40 L 65 45 L 50 50 L 35 45 L 40 40 Z" fill="${colors[1]}" stroke="${colors[2]}" stroke-width="1"/>
      <text x="50" y="65" font-size="24" font-weight="bold" text-anchor="middle" fill="${colors[2]}">K</text>
    </svg>`,

    queen: (colors) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect x="15" y="15" width="70" height="70" rx="4" fill="${colors[0]}" stroke="${colors[2]}" stroke-width="2"/>
      <circle cx="50" cy="30" r="6" fill="${colors[1]}"/>
      <circle cx="42" cy="28" r="3" fill="${colors[1]}"/>
      <circle cx="58" cy="28" r="3" fill="${colors[1]}"/>
      <text x="50" y="65" font-size="24" font-weight="bold" text-anchor="middle" fill="${colors[2]}">Q</text>
    </svg>`,

    jack: (colors) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect x="15" y="15" width="70" height="70" rx="4" fill="${colors[0]}" stroke="${colors[2]}" stroke-width="2"/>
      <path d="M 45 25 L 55 25 L 52 40 L 60 40 L 45 50 L 55 55 L 45 65 Z" fill="${colors[1]}" stroke="${colors[2]}" stroke-width="1"/>
      <text x="50" y="65" font-size="24" font-weight="bold" text-anchor="middle" fill="${colors[2]}">J</text>
    </svg>`,

    ten: (colors) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect x="15" y="15" width="70" height="70" rx="4" fill="${colors[0]}" stroke="${colors[2]}" stroke-width="2"/>
      <text x="50" y="50" font-size="32" font-weight="bold" text-anchor="middle" dominant-baseline="central" fill="${colors[2]}">10</text>
    </svg>`,

    // Animals
    scarab: (colors) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="50" cy="55" rx="25" ry="28" fill="${colors[0]}" stroke="${colors[2]}" stroke-width="2"/>
      <circle cx="50" cy="30" r="18" fill="${colors[1]}" stroke="${colors[2]}" stroke-width="2"/>
      <circle cx="42" cy="25" r="4" fill="${colors[2]}"/>
      <circle cx="58" cy="25" r="4" fill="${colors[2]}"/>
      <line x1="45" y1="60" x2="40" y2="75" stroke="${colors[2]}" stroke-width="2"/>
      <line x1="55" y1="60" x2="60" y2="75" stroke="${colors[2]}" stroke-width="2"/>
    </svg>`,

    eagle: (colors) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="40" r="15" fill="${colors[0]}" stroke="${colors[2]}" stroke-width="2"/>
      <path d="M 25 45 L 40 50 L 50 60 L 60 50 L 75 45" fill="none" stroke="${colors[1]}" stroke-width="3"/>
      <polygon points="38,48 42,52 46,48" fill="${colors[2]}"/>
      <polygon points="54,48 58,52 62,48" fill="${colors[2]}"/>
    </svg>`,

    lion: (colors) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="28" fill="${colors[0]}" stroke="${colors[2]}" stroke-width="2"/>
      <circle cx="50" cy="50" r="38" fill="none" stroke="${colors[1]}" stroke-width="3" opacity="0.6"/>
      <circle cx="45" cy="45" r="4" fill="${colors[2]}"/>
      <circle cx="55" cy="45" r="4" fill="${colors[2]}"/>
      <path d="M 45 55 Q 50 60 55 55" fill="none" stroke="${colors[2]}" stroke-width="2"/>
    </svg>`,

    dragon: (colors) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path d="M 25 50 Q 35 30 50 25 Q 65 30 75 50 Q 70 65 60 70 Q 50 75 40 70 Z" fill="${colors[0]}" stroke="${colors[2]}" stroke-width="2"/>
      <circle cx="55" cy="35" r="5" fill="${colors[1]}"/>
      <circle cx="55" cy="36" r="2" fill="${colors[2]}"/>
      <path d="M 40 65 L 35 80 L 40 75 L 45 85" fill="${colors[1]}" stroke="${colors[2]}" stroke-width="1"/>
    </svg>`,

    phoenix: (colors) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="20" fill="${colors[0]}" stroke="${colors[2]}" stroke-width="2"/>
      <path d="M 50 30 L 55 35 L 60 32 L 58 40 L 65 38" fill="${colors[1]}" stroke="${colors[2]}" stroke-width="1.5"/>
      <path d="M 50 70 L 45 60 L 40 68" fill="${colors[1]}" stroke="${colors[2]}" stroke-width="1.5"/>
    </svg>`,

    // Mythology & Fantasy
    crown: (colors) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path d="M 20 70 L 30 50 L 40 60 L 50 30 L 60 60 L 70 50 L 80 70 Z" fill="${colors[0]}" stroke="${colors[2]}" stroke-width="2"/>
      <rect x="20" y="70" width="60" height="15" fill="${colors[1]}" stroke="${colors[2]}" stroke-width="2"/>
      <circle cx="35" cy="45" r="5" fill="${colors[1]}"/>
      <circle cx="50" cy="25" r="5" fill="${colors[1]}"/>
      <circle cx="65" cy="45" r="5" fill="${colors[1]}"/>
    </svg>`,

    star: (colors) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <polygon points="50,15 61,40 88,40 67,55 78,80 50,65 22,80 33,55 12,40 39,40" fill="${colors[0]}" stroke="${colors[2]}" stroke-width="2"/>
      <circle cx="50" cy="50" r="15" fill="none" stroke="${colors[1]}" stroke-width="1.5" opacity="0.5"/>
    </svg>`,

    moon: (colors) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="35" fill="${colors[0]}" stroke="${colors[2]}" stroke-width="2"/>
      <circle cx="62" cy="42" r="35" fill="white" opacity="0.1"/>
      <circle cx="35" cy="35" r="5" fill="${colors[1]}" opacity="0.7"/>
      <circle cx="45" cy="60" r="4" fill="${colors[1]}" opacity="0.7"/>
      <circle cx="60" cy="55" r="3" fill="${colors[1]}" opacity="0.7"/>
    </svg>`,

    sun: (colors) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="25" fill="${colors[0]}" stroke="${colors[2]}" stroke-width="2"/>
      <line x1="50" y1="10" x2="50" y2="25" stroke="${colors[1]}" stroke-width="3"/>
      <line x1="50" y1="75" x2="50" y2="90" stroke="${colors[1]}" stroke-width="3"/>
      <line x1="10" y1="50" x2="25" y2="50" stroke="${colors[1]}" stroke-width="3"/>
      <line x1="75" y1="50" x2="90" y2="50" stroke="${colors[1]}" stroke-width="3"/>
      <circle cx="50" cy="50" r="10" fill="${colors[1]}" opacity="0.4"/>
    </svg>`,

    // Fruit & Nature
    cherry: (colors) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <circle cx="40" cy="55" r="18" fill="${colors[0]}" stroke="${colors[2]}" stroke-width="2"/>
      <circle cx="60" cy="55" r="18" fill="${colors[0]}" stroke="${colors[2]}" stroke-width="2"/>
      <line x1="40" y1="37" x2="60" y2="37" stroke="${colors[1]}" stroke-width="3"/>
      <path d="M 45 37 Q 50 25 55 37" fill="none" stroke="${colors[1]}" stroke-width="2"/>
    </svg>`,

    lemon: (colors) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="50" cy="50" rx="28" ry="32" fill="${colors[0]}" stroke="${colors[2]}" stroke-width="2"/>
      <ellipse cx="50" cy="50" rx="20" ry="24" fill="${colors[1]}" opacity="0.4"/>
      <path d="M 50 18 Q 55 15 60 20" fill="none" stroke="${colors[1]}" stroke-width="2"/>
    </svg>`,

    apple: (colors) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="55" r="30" fill="${colors[0]}" stroke="${colors[2]}" stroke-width="2"/>
      <path d="M 50 25 Q 45 20 40 25" fill="none" stroke="${colors[1]}" stroke-width="2"/>
      <line x1="50" y1="25" x2="50" y2="35" stroke="${colors[1]}" stroke-width="2"/>
      <path d="M 35 45 Q 30 50 32 60" fill="none" stroke="${colors[2]}" stroke-width="1" opacity="0.5"/>
    </svg>`,

    flower: (colors) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="8" fill="${colors[1]}"/>
      <circle cx="50" cy="25" r="12" fill="${colors[0]}"/>
      <circle cx="75" cy="35" r="12" fill="${colors[0]}"/>
      <circle cx="75" cy="65" r="12" fill="${colors[0]}"/>
      <circle cx="50" cy="75" r="12" fill="${colors[0]}"/>
      <circle cx="25" cy="65" r="12" fill="${colors[0]}"/>
      <circle cx="25" cy="35" r="12" fill="${colors[0]}"/>
    </svg>`,

    leaf: (colors) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="50" cy="50" rx="20" ry="28" fill="${colors[0]}" stroke="${colors[2]}" stroke-width="2" transform="rotate(25 50 50)"/>
      <path d="M 50 22 Q 55 50 50 78" fill="none" stroke="${colors[1]}" stroke-width="2" opacity="0.6"/>
    </svg>`,

    // Money & Luck
    coin: (colors) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs><radialGradient id="coinGrad" cx="35%" cy="35%">
        <stop offset="0%" style="stop-color:${colors[0]};stop-opacity:1" />
        <stop offset="100%" style="stop-color:${colors[1]};stop-opacity:1" />
      </radialGradient></defs>
      <circle cx="50" cy="50" r="35" fill="url(#coinGrad)" stroke="${colors[2]}" stroke-width="2"/>
      <circle cx="50" cy="50" r="32" fill="none" stroke="${colors[2]}" stroke-width="1" opacity="0.5"/>
      <text x="50" y="55" font-size="20" font-weight="bold" text-anchor="middle" fill="${colors[2]}">$</text>
    </svg>`,

    gem: (colors) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <polygon points="50,10 75,35 75,75 50,90 25,75 25,35" fill="${colors[0]}" stroke="${colors[2]}" stroke-width="2"/>
      <line x1="50" y1="10" x2="50" y2="90" stroke="${colors[1]}" stroke-width="1" opacity="0.4"/>
      <line x1="25" y1="55" x2="75" y2="55" stroke="${colors[1]}" stroke-width="1" opacity="0.4"/>
    </svg>`,

    horseshoe: (colors) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path d="M 30 35 Q 30 20 50 20 Q 70 20 70 35" fill="none" stroke="${colors[0]}" stroke-width="6" stroke-linecap="round"/>
      <circle cx="35" cy="25" r="4" fill="${colors[1]}"/>
      <circle cx="65" cy="25" r="4" fill="${colors[1]}"/>
    </svg>`,

    // Special Symbols
    wild: (colors) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect x="10" y="20" width="80" height="60" rx="6" fill="${colors[0]}" stroke="${colors[2]}" stroke-width="3"/>
      <text x="50" y="58" font-size="36" font-weight="bold" text-anchor="middle" dominant-baseline="central" fill="${colors[2]}" font-style="italic">WILD</text>
    </svg>`,

    scatter: (colors) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path d="M 50 15 L 61 37 L 85 40 L 68 54 L 73 78 L 50 62 L 27 78 L 32 54 L 15 40 L 39 37 Z" fill="${colors[0]}" stroke="${colors[2]}" stroke-width="2"/>
      <circle cx="50" cy="50" r="8" fill="${colors[1]}" stroke="${colors[2]}" stroke-width="1"/>
      <circle cx="35" cy="35" r="4" fill="${colors[1]}"/>
      <circle cx="65" cy="35" r="4" fill="${colors[1]}"/>
      <circle cx="50" cy="70" r="4" fill="${colors[1]}"/>
    </svg>`,

    bonus: (colors) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect x="15" y="20" width="70" height="60" rx="8" fill="${colors[0]}" stroke="${colors[2]}" stroke-width="2"/>
      <text x="50" y="42" font-size="20" font-weight="bold" text-anchor="middle" fill="${colors[2]}">BONUS</text>
      <circle cx="50" cy="65" r="8" fill="${colors[1]}"/>
    </svg>`,

    // Space & Tech
    spaceship: (colors) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <polygon points="50,20 75,70 50,60 25,70" fill="${colors[0]}" stroke="${colors[2]}" stroke-width="2"/>
      <circle cx="50" cy="45" r="6" fill="${colors[1]}"/>
      <path d="M 40 70 L 35 85 M 60 70 L 65 85" stroke="${colors[1]}" stroke-width="2"/>
    </svg>`,

    rocket: (colors) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <polygon points="50,15 60,40 60,70 40,70 40,40" fill="${colors[0]}" stroke="${colors[2]}" stroke-width="2"/>
      <circle cx="50" cy="28" r="8" fill="${colors[1]}"/>
      <polygon points="40,70 35,85 45,75" fill="${colors[1]}"/>
      <polygon points="60,70 65,85 55,75" fill="${colors[1]}"/>
    </svg>`,

    planet: (colors) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs><radialGradient id="planetGrad" cx="40%" cy="40%">
        <stop offset="0%" style="stop-color:${colors[0]};stop-opacity:1" />
        <stop offset="100%" style="stop-color:${colors[1]};stop-opacity:1" />
      </radialGradient></defs>
      <circle cx="50" cy="50" r="32" fill="url(#planetGrad)" stroke="${colors[2]}" stroke-width="2"/>
      <ellipse cx="50" cy="50" rx="32" ry="8" fill="none" stroke="${colors[2]}" stroke-width="1.5" opacity="0.4"/>
      <circle cx="70" cy="35" r="6" fill="${colors[2]}" opacity="0.3"/>
    </svg>`,

    // Additional archetypes
    bell: (colors) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path d="M 30 35 L 35 50 Q 35 70 50 75 Q 65 70 65 50 L 70 35 Z" fill="${colors[0]}" stroke="${colors[2]}" stroke-width="2"/>
      <circle cx="50" cy="78" r="4" fill="${colors[1]}"/>
      <line x1="45" y1="35" x2="55" y2="35" stroke="${colors[2]}" stroke-width="2"/>
    </svg>`,

    clover: (colors) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <circle cx="40" cy="40" r="12" fill="${colors[0]}" stroke="${colors[2]}" stroke-width="1.5"/>
      <circle cx="60" cy="40" r="12" fill="${colors[0]}" stroke="${colors[2]}" stroke-width="1.5"/>
      <circle cx="50" cy="55" r="12" fill="${colors[0]}" stroke="${colors[2]}" stroke-width="1.5"/>
      <circle cx="50" cy="25" r="12" fill="${colors[0]}" stroke="${colors[2]}" stroke-width="1.5"/>
      <line x1="50" y1="68" x2="50" y2="80" stroke="${colors[1]}" stroke-width="2"/>
    </svg>`,

    shield: (colors) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path d="M 50 20 L 75 35 L 75 60 Q 75 80 50 85 Q 25 80 25 60 L 25 35 Z" fill="${colors[0]}" stroke="${colors[2]}" stroke-width="2"/>
      <circle cx="50" cy="55" r="10" fill="${colors[1]}"/>
    </svg>`
  };

  /**
   * Generate SVG symbol based on name, game theme, and studio theme
   */
  function generateSymbolSVG(symbolName, gameTheme, studioTheme) {
    // Normalize symbol name
    const normalizedName = symbolName.toLowerCase().trim();
    
    // Get template or use a generic default
    const template = SYMBOL_TEMPLATES[normalizedName];
    
    // Determine color palette
    const colors = extractColorPalette(gameTheme, studioTheme);
    
    let svgContent;
    if (template) {
      svgContent = template(colors);
    } else {
      // Fallback: generic symbol
      svgContent = generateGenericSymbol(symbolName, colors);
    }
    
    // Convert to data URI
    return 'data:image/svg+xml;base64,' + btoa(svgContent);
  }

  /**
   * Extract color palette from game/studio theme
   */
  function extractColorPalette(gameTheme, studioTheme) {
    const primaryColor = gameTheme.primaryColor || '#6A5ACD';
    const secondaryColor = gameTheme.secondaryColor || '#FFD700';
    const accentColor = gameTheme.accentColor || '#FFFFFF';
    
    return [primaryColor, secondaryColor, accentColor];
  }

  /**
   * Generate fallback generic symbol
   */
  function generateGenericSymbol(name, colors) {
    const hash = name.split('').reduce((h, c) => h + c.charCodeAt(0), 0);
    const shapeIndex = hash % 3;
    
    let shape;
    switch (shapeIndex) {
      case 0:
        shape = `<circle cx="50" cy="50" r="30" fill="${colors[0]}" stroke="${colors[2]}" stroke-width="2"/>`;
        break;
      case 1:
        shape = `<rect x="20" y="20" width="60" height="60" rx="8" fill="${colors[0]}" stroke="${colors[2]}" stroke-width="2"/>`;
        break;
      case 2:
        shape = `<polygon points="50,15 85,50 70,85 30,85 15,50" fill="${colors[0]}" stroke="${colors[2]}" stroke-width="2"/>`;
        break;
    }
    
    const textChar = name.charAt(0).toUpperCase();
    
    return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      ${shape}
      <text x="50" y="55" font-size="28" font-weight="bold" text-anchor="middle" fill="${colors[2]}">${textChar}</text>
    </svg>`;
  }

  /**
   * Generate background CSS for a game
   */
  function generateBackgroundCSS(game) {
    const primaryColor = game.primaryColor || '#6A5ACD';
    const secondaryColor = game.secondaryColor || '#FFD700';
    
    // Get theme-specific background pattern
    const themePattern = getThemePattern(game.theme, primaryColor, secondaryColor);
    
    return `
      background: linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%);
      background-attachment: fixed;
      ${themePattern}
    `;
  }

  /**
   * Get theme-specific CSS patterns
   */
  function getThemePattern(theme, primaryColor, secondaryColor) {
    const patterns = {
      'ancient_egypt': `
        background-image: 
          repeating-linear-gradient(45deg, transparent, transparent 35px, rgba(255,255,255,.05) 35px, rgba(255,255,255,.05) 70px);
      `,
      'mythology': `
        background-image:
          radial-gradient(circle at 20% 50%, rgba(255,255,255,.1) 0%, transparent 50%),
          radial-gradient(circle at 80% 50%, rgba(255,255,255,.1) 0%, transparent 50%);
      `,
      'space': `
        background-image:
          radial-gradient(2px 2px at 20% 30%, white, rgba(255,255,255,.2) 2px, transparent 40px),
          radial-gradient(2px 2px at 60% 70%, white, rgba(255,255,255,.15) 1px, transparent 30px);
        background-size: 200% 200%;
      `,
      'nature': `
        background-image:
          repeating-linear-gradient(90deg, transparent, transparent 2px, rgba(255,255,255,.05) 2px, rgba(255,255,255,.05) 4px);
      `,
      'luxury': `
        background-image:
          linear-gradient(90deg, transparent 24%, rgba(255,255,255,.05) 25%, rgba(255,255,255,.05) 26%, transparent 27%, transparent 74%, rgba(255,255,255,.05) 75%, rgba(255,255,255,.05) 76%, transparent 77%, transparent),
          linear-gradient(0deg, transparent 24%, rgba(255,255,255,.05) 25%, rgba(255,255,255,.05) 26%, transparent 27%, transparent 74%, rgba(255,255,255,.05) 75%, rgba(255,255,255,.05) 76%, transparent 77%, transparent);
        background-size: 50px 50px;
      `
    };
    
    return patterns[theme] || '';
  }

  /**
   * Generate studio logo SVG
   */
  function generateStudioLogoSVG(studioConfig) {
    const name = studioConfig.name || 'Studio';
    const primaryColor = studioConfig.primaryColor || '#000000';
    const secondaryColor = studioConfig.secondaryColor || '#FFFFFF';
    
    // Create initials-based logo
    const initials = name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .substring(0, 2);
    
    return `data:image/svg+xml;base64,${btoa(`
      <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="studioGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:${primaryColor};stop-opacity:1" />
            <stop offset="100%" style="stop-color:${secondaryColor};stop-opacity:0.8" />
          </linearGradient>
        </defs>
        <rect x="10" y="10" width="80" height="80" rx="12" fill="url(#studioGrad)" stroke="${primaryColor}" stroke-width="2"/>
        <text x="50" y="60" font-size="32" font-weight="bold" text-anchor="middle" dominant-baseline="central" fill="${secondaryColor}">${initials}</text>
        <circle cx="50" cy="50" r="42" fill="none" stroke="${primaryColor}" stroke-width="1" opacity="0.3"/>
      </svg>
    `)}`;
  }

  /**
   * Generate all game assets
   */
  function generateAllGameAssets() {
    if (!window.GAME_REGISTRY || !window.GAME_REGISTRY.games) {
      console.warn('AssetGenerator: GAME_REGISTRY not found');
      return {};
    }

    const assets = {};
    
    window.GAME_REGISTRY.games.forEach(game => {
      assets[game.id] = {
        id: game.id,
        name: game.name,
        symbols: {},
        background: generateBackgroundCSS(game),
        studioLogo: generateStudioLogoSVG(game.studio)
      };

      // Generate symbols for each game
      if (game.symbolNames && Array.isArray(game.symbolNames)) {
        game.symbolNames.forEach(symbolName => {
          assets[game.id].symbols[symbolName] = generateSymbolSVG(
            symbolName,
            game,
            game.studio
          );
        });
      }
    });

    return assets;
  }

  // Export module
  window.AssetGenerator = {
    generateSymbolSVG,
    generateBackgroundCSS,
    generateStudioLogoSVG,
    generateAllGameAssets,
    // Additional exports for testing
    SYMBOL_TEMPLATES,
    extractColorPalette,
    getThemePattern
  };

  // Auto-generate assets if GAME_REGISTRY is available
  if (window.GAME_REGISTRY) {
    window.GENERATED_ASSETS = generateAllGameAssets();
    console.log('AssetGenerator: Generated assets for', Object.keys(window.GENERATED_ASSETS).length, 'games');
  }

})();

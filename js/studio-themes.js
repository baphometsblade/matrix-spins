// Google Fonts imports for all studios
const STUDIO_FONTS = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&display=swap');
  @import url('https://fonts.googleapis.com/css2?family=Lora:wght@400;600&display=swap');
  @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;700&display=swap');
  @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&display=swap');
  @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');
  @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&display=swap');
  @import url('https://fonts.googleapis.com/css2?family=Crimson+Text:wght@400;600&display=swap');
  @import url('https://fonts.googleapis.com/css2?family=Righteous:wght@400&display=swap');
  @import url('https://fonts.googleapis.com/css2?family=Caveat:wght@400;700&display=swap');
  @import url('https://fonts.googleapis.com/css2?family=Black+Ops+One:wght@400&display=swap');
  @import url('https://fonts.googleapis.com/css2?family=Fredoka+One:wght@400&display=swap');
  @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap');
`;

const STUDIO_THEMES = {
  'golden-reels': {
    name: 'Golden Reels Studio',
    specialty: 'Fruit classics, retro',
    logo: 'assets/studio-logos/golden-reels.svg',
    googleFonts: "@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Lora:wght@400;600&family=Oswald:wght@400;700&display=swap');",
    colors: {
      primary: '#D4AF37',        // Gold
      secondary: '#8B6914',      // Dark gold
      accent: '#FFF8DC',         // Cornsilk
      bg: '#1A1205',             // Dark warm brown
      bgGradient: 'linear-gradient(135deg, #1A1205 0%, #2D1F0E 50%, #1A1205 100%)',
      text: '#FFF8DC',
      textMuted: '#BFA76A',
      winHighlight: '#FFD700',
      reelBg: '#0D0A03',
      reelBorder: '#D4AF37',
    },
    fonts: {
      heading: "'Playfair Display', serif",
      body: "'Lora', serif",
      numbers: "'Oswald', sans-serif",
    },
    chrome: {
      borderStyle: '3px solid #D4AF37',
      borderRadius: '12px',
      boxShadow: '0 0 30px rgba(212,175,55,0.3), inset 0 0 20px rgba(212,175,55,0.1)',
      frameImage: 'ornate-brass-frame',
      buttonStyle: 'background: linear-gradient(180deg, #D4AF37, #8B6914); border-radius: 8px; border: 1px solid #FFD700; text-transform: uppercase; letter-spacing: 2px; font-weight: bold;',
      spinButtonGlow: '0 0 20px rgba(212,175,55,0.6)',
    },
    particles: {
      type: 'sparkle',
      color: '#FFD700',
      onWin: 'gold-coins',
    },
  },

  'nebula-gaming': {
    name: 'Nebula Gaming',
    specialty: 'Space, sci-fi',
    logo: 'assets/studio-logos/nebula-gaming.svg',
    googleFonts: "@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Space+Mono:wght@400;700&display=swap');",
    colors: {
      primary: '#00F0FF',        // Neon cyan
      secondary: '#9D4EDD',      // Neon purple
      accent: '#3A86FF',         // Electric blue
      bg: '#0A0E27',             // Deep space blue
      bgGradient: 'linear-gradient(135deg, #0A0E27 0%, #1a0033 50%, #0A0E27 100%)',
      text: '#00F0FF',
      textMuted: '#7B68EE',
      winHighlight: '#39FF14',   // Neon green
      reelBg: '#030810',
      reelBorder: '#00F0FF',
    },
    fonts: {
      heading: "'Orbitron', sans-serif",
      body: "'Space Mono', monospace",
      numbers: "'Orbitron', sans-serif",
    },
    chrome: {
      borderStyle: '2px solid #00F0FF',
      borderRadius: '4px',
      boxShadow: '0 0 40px rgba(0,240,255,0.5), inset 0 0 30px rgba(157,78,221,0.2)',
      frameImage: 'sleek-metal-grid',
      buttonStyle: 'background: linear-gradient(180deg, #9D4EDD, #3A86FF); border-radius: 4px; border: 1px solid #00F0FF; text-transform: uppercase; letter-spacing: 3px; font-weight: bold;',
      spinButtonGlow: '0 0 30px rgba(0,240,255,0.8)',
    },
    particles: {
      type: 'plasma',
      color: '#00F0FF',
      onWin: 'star-burst',
    },
  },

  'mythic-forge': {
    name: 'Mythic Forge',
    specialty: 'Egypt, mythology, fantasy',
    logo: 'assets/studio-logos/mythic-forge.svg',
    googleFonts: "@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&family=Crimson+Text:wght@400;600&display=swap');",
    colors: {
      primary: '#50C878',        // Emerald green
      secondary: '#DC143C',      // Ruby red
      accent: '#4169E1',         // Sapphire blue
      bg: '#2C1810',             // Stone brown
      bgGradient: 'linear-gradient(135deg, #2C1810 0%, #3D2817 50%, #2C1810 100%)',
      text: '#F5DEB3',           // Wheat
      textMuted: '#A39070',      // Taupe
      winHighlight: '#FFD700',   // Gold
      reelBg: '#1A0F08',
      reelBorder: '#50C878',
    },
    fonts: {
      heading: "'Cinzel', serif",
      body: "'Crimson Text', serif",
      numbers: "'Cinzel', serif",
    },
    chrome: {
      borderStyle: '4px solid #50C878',
      borderRadius: '8px',
      boxShadow: '0 0 35px rgba(80,200,120,0.25), inset 0 0 25px rgba(80,200,120,0.1)',
      frameImage: 'carved-stone-border',
      buttonStyle: 'background: linear-gradient(180deg, #50C878, #3A9B5C); border-radius: 6px; border: 2px solid #DC143C; text-transform: uppercase; letter-spacing: 2px; font-weight: 600;',
      spinButtonGlow: '0 0 25px rgba(80,200,120,0.5)',
    },
    particles: {
      type: 'ember',
      color: '#DC143C',
      onWin: 'fire-burst',
    },
  },

  'wild-frontier': {
    name: 'Wild Frontier Games',
    specialty: 'Animals, wildlife, outback',
    logo: 'assets/studio-logos/wild-frontier.svg',
    googleFonts: "@import url('https://fonts.googleapis.com/css2?family=Righteous:wght@400&family=Black+Ops+One:wght@400&family=Fredoka+One:wght@400&display=swap');",
    colors: {
      primary: '#D2691E',        // Chocolate orange
      secondary: '#228B22',      // Forest green
      accent: '#FF8C00',         // Dark orange
      bg: '#3E2723',             // Brown
      bgGradient: 'linear-gradient(135deg, #3E2723 0%, #4A3728 50%, #3E2723 100%)',
      text: '#F5DEB3',           // Wheat
      textMuted: '#8B7355',      // Tan
      winHighlight: '#FF8C00',
      reelBg: '#1B0F08',
      reelBorder: '#D2691E',
    },
    fonts: {
      heading: "'Righteous', sans-serif",
      body: "'Fredoka One', sans-serif",
      numbers: "'Black Ops One', sans-serif",
    },
    chrome: {
      borderStyle: '5px solid #D2691E',
      borderRadius: '16px',
      boxShadow: '0 0 25px rgba(210,105,30,0.4), inset 0 0 20px rgba(34,139,34,0.15)',
      frameImage: 'wood-texture-frame',
      buttonStyle: 'background: linear-gradient(180deg, #D2691E, #8B4513); border-radius: 10px; border: 2px solid #FF8C00; text-transform: uppercase; letter-spacing: 2px; font-weight: 900;',
      spinButtonGlow: '0 0 20px rgba(210,105,30,0.6)',
    },
    particles: {
      type: 'leaf',
      color: '#228B22',
      onWin: 'dust-cloud',
    },
  },

  'shadow-works': {
    name: 'Shadow Works',
    specialty: 'Horror, dark themes',
    logo: 'assets/studio-logos/shadow-works.svg',
    googleFonts: "@import url('https://fonts.googleapis.com/css2?family=Black+Ops+One:wght@400&family=Caveat:wght@700&display=swap');",
    colors: {
      primary: '#8B0000',        // Dark red
      secondary: '#39FF14',      // Neon green
      accent: '#1F1F1F',         // Near black
      bg: '#0B0B0B',             // Pure black
      bgGradient: 'linear-gradient(135deg, #0B0B0B 0%, #1a0a0a 50%, #0B0B0B 100%)',
      text: '#E0E0E0',           // Light gray
      textMuted: '#666666',
      winHighlight: '#39FF14',   // Neon green
      reelBg: '#050505',
      reelBorder: '#8B0000',
    },
    fonts: {
      heading: "'Black Ops One', sans-serif",
      body: "'Caveat', cursive",
      numbers: "'Black Ops One', sans-serif",
    },
    chrome: {
      borderStyle: '3px solid #8B0000',
      borderRadius: '2px',
      boxShadow: '0 0 40px rgba(139,0,0,0.6), inset 0 0 20px rgba(57,255,20,0.05)',
      frameImage: 'gothic-iron-frame',
      buttonStyle: 'background: linear-gradient(180deg, #8B0000, #600000); border-radius: 3px; border: 1px solid #39FF14; text-transform: uppercase; letter-spacing: 3px; font-weight: bold;',
      spinButtonGlow: '0 0 30px rgba(139,0,0,0.7)',
    },
    particles: {
      type: 'smoke',
      color: '#39FF14',
      onWin: 'ash-burst',
    },
  },

  'dragon-pearl': {
    name: 'Dragon Pearl Studios',
    specialty: 'Asian, luck, prosperity',
    logo: 'assets/studio-logos/dragon-pearl.svg',
    googleFonts: "@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Caveat:wght@400;700&display=swap');",
    colors: {
      primary: '#CC0000',        // Lucky red
      secondary: '#FFD700',      // Gold
      accent: '#00A86B',         // Jade green
      bg: '#0D0B0A',             // Deep black
      bgGradient: 'linear-gradient(135deg, #0D0B0A 0%, #1A0F0E 50%, #0D0B0A 100%)',
      text: '#FFD700',
      textMuted: '#C9A961',      // Muted gold
      winHighlight: '#FFD700',
      reelBg: '#050403',
      reelBorder: '#CC0000',
    },
    fonts: {
      heading: "'Playfair Display', serif",
      body: "'Caveat', cursive",
      numbers: "'Playfair Display', serif",
    },
    chrome: {
      borderStyle: '4px solid #CC0000',
      borderRadius: '12px',
      boxShadow: '0 0 35px rgba(204,0,0,0.4), inset 0 0 25px rgba(255,215,0,0.15)',
      frameImage: 'lacquered-red-panel',
      buttonStyle: 'background: linear-gradient(180deg, #CC0000, #990000); border-radius: 8px; border: 2px solid #FFD700; text-transform: uppercase; letter-spacing: 2px; font-weight: bold;',
      spinButtonGlow: '0 0 25px rgba(204,0,0,0.6)',
    },
    particles: {
      type: 'lantern',
      color: '#FFD700',
      onWin: 'cherry-blossom',
    },
  },

  'ironclad-entertainment': {
    name: 'Ironclad Entertainment',
    specialty: 'Pirate, steampunk, western',
    logo: 'assets/studio-logos/ironclad.svg',
    googleFonts: "@import url('https://fonts.googleapis.com/css2?family=Righteous:wght@400&family=Fredoka+One:wght@400&display=swap');",
    colors: {
      primary: '#B5A642',        // Brass
      secondary: '#8B4513',      // Saddle brown (leather)
      accent: '#CD853F',         // Peru (copper)
      bg: '#2D2416',             // Deep brown
      bgGradient: 'linear-gradient(135deg, #2D2416 0%, #3D3023 50%, #2D2416 100%)',
      text: '#D4AF37',           // Gold
      textMuted: '#8B7355',      // Tan
      winHighlight: '#FFD700',   // Gold
      reelBg: '#15110D',
      reelBorder: '#B5A642',
    },
    fonts: {
      heading: "'Righteous', sans-serif",
      body: "'Fredoka One', sans-serif",
      numbers: "'Righteous', sans-serif",
    },
    chrome: {
      borderStyle: '4px solid #B5A642',
      borderRadius: '6px',
      boxShadow: '0 0 30px rgba(181,166,66,0.35), inset 0 0 20px rgba(181,166,66,0.1)',
      frameImage: 'riveted-metal-frame',
      buttonStyle: 'background: linear-gradient(180deg, #B5A642, #8B6F47); border-radius: 6px; border: 2px solid #CD853F; text-transform: uppercase; letter-spacing: 2px; font-weight: bold;',
      spinButtonGlow: '0 0 20px rgba(181,166,66,0.5)',
    },
    particles: {
      type: 'gear',
      color: '#B5A642',
      onWin: 'mechanical-spark',
    },
  },

  'cascade-labs': {
    name: 'Cascade Labs',
    specialty: 'Wildcard, experimental',
    logo: 'assets/studio-logos/cascade-labs.svg',
    googleFonts: "@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap');",
    colors: {
      primary: '#9D4EDD',        // Purple
      secondary: '#00F0FF',      // Cyan
      accent: '#FF006E',         // Hot pink
      bg: '#F8F9FA',             // Almost white
      bgGradient: 'linear-gradient(135deg, #F8F9FA 0%, #E9ECEF 50%, #F8F9FA 100%)',
      text: '#212529',           // Dark gray
      textMuted: '#6C757D',      // Medium gray
      winHighlight: '#FF006E',   // Hot pink
      reelBg: '#FFFFFF',
      reelBorder: '#9D4EDD',
    },
    fonts: {
      heading: "'Poppins', sans-serif",
      body: "'Poppins', sans-serif",
      numbers: "'Poppins', sans-serif",
    },
    chrome: {
      borderStyle: '2px solid #9D4EDD',
      borderRadius: '8px',
      boxShadow: '0 4px 20px rgba(157,78,221,0.15), inset 0 0 10px rgba(0,240,255,0.05)',
      frameImage: 'minimal-flat-frame',
      buttonStyle: 'background: linear-gradient(135deg, #9D4EDD, #00F0FF); border-radius: 6px; border: none; text-transform: uppercase; letter-spacing: 1px; font-weight: 600; color: #FFF;',
      spinButtonGlow: '0 0 15px rgba(157,78,221,0.4)',
    },
    particles: {
      type: 'geometric',
      color: '#FF006E',
      onWin: 'shape-burst',
    },
  },
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = STUDIO_THEMES;
}

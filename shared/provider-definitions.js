'use strict';

/**
 * 8 Fictional Provider Studios — each with unique visual chrome and branding.
 * Provider IDs map to game-definitions.js provider field.
 */
var providers = [
  {
    id: 'nebula-gaming',
    name: 'Nebula Gaming',
    tagline: 'Where Stars Align',
    logo: '🌟',
    accentColor: '#00e5ff',
    accentGradient: 'linear-gradient(135deg, #00e5ff 0%, #1a237e 100%)',
    bgColor: '#0a1628',
    textColor: '#e0f7fa',
    borderStyle: '2px solid #00e5ff44',
    badgeStyle: 'background: linear-gradient(135deg, #00e5ff22, #1a237e22); border: 1px solid #00e5ff55; color: #00e5ff;',
    reelChrome: 'box-shadow: 0 0 20px #00e5ff33, inset 0 0 30px #00e5ff11;',
    specialty: 'Space & Cosmic themes',
    founded: '2019'
  },
  {
    id: 'golden-reels',
    name: 'Golden Reels Studio',
    tagline: 'Fortune Favours the Bold',
    logo: '👑',
    accentColor: '#ffd700',
    accentGradient: 'linear-gradient(135deg, #ffd700 0%, #ff8f00 100%)',
    bgColor: '#1a1400',
    textColor: '#fff8e1',
    borderStyle: '2px solid #ffd70044',
    badgeStyle: 'background: linear-gradient(135deg, #ffd70022, #ff8f0022); border: 1px solid #ffd70055; color: #ffd700;',
    reelChrome: 'box-shadow: 0 0 20px #ffd70033, inset 0 0 30px #ffd70011;',
    specialty: 'Premium jackpot slots',
    founded: '2017'
  },
  {
    id: 'mythic-forge',
    name: 'Mythic Forge',
    tagline: 'Mythic Wins Await',
    logo: '⚡',
    accentColor: '#b388ff',
    accentGradient: 'linear-gradient(135deg, #b388ff 0%, #7c4dff 100%)',
    bgColor: '#12001a',
    textColor: '#f3e5f5',
    borderStyle: '2px solid #b388ff44',
    badgeStyle: 'background: linear-gradient(135deg, #b388ff22, #7c4dff22); border: 1px solid #b388ff55; color: #b388ff;',
    reelChrome: 'box-shadow: 0 0 20px #b388ff33, inset 0 0 30px #b388ff11;',
    specialty: 'Mythology & epic themes',
    founded: '2018'
  },
  {
    id: 'ironclad',
    name: 'Ironclad Entertainment',
    tagline: 'Forged in Fire',
    logo: '🔥',
    accentColor: '#ff6d00',
    accentGradient: 'linear-gradient(135deg, #ff6d00 0%, #d84315 100%)',
    bgColor: '#1a0e00',
    textColor: '#fff3e0',
    borderStyle: '2px solid #ff6d0044',
    badgeStyle: 'background: linear-gradient(135deg, #ff6d0022, #d8431522); border: 1px solid #ff6d0055; color: #ff6d00;',
    reelChrome: 'box-shadow: 0 0 20px #ff6d0033, inset 0 0 30px #ff6d0011;',
    specialty: 'High-volatility action',
    founded: '2016'
  },
  {
    id: 'shadow-works',
    name: 'PhantomWorks',
    tagline: 'Beyond the Veil',
    logo: '👻',
    accentColor: '#69f0ae',
    accentGradient: 'linear-gradient(135deg, #69f0ae 0%, #00c853 100%)',
    bgColor: '#001a0e',
    textColor: '#e8f5e9',
    borderStyle: '2px solid #69f0ae44',
    badgeStyle: 'background: linear-gradient(135deg, #69f0ae22, #00c85322); border: 1px solid #69f0ae55; color: #69f0ae;',
    reelChrome: 'box-shadow: 0 0 20px #69f0ae33, inset 0 0 30px #69f0ae11;',
    specialty: 'Horror & mystery',
    founded: '2020'
  },
  {
    id: 'wild-frontier',
    name: 'ArcadeForge',
    tagline: 'Play. Win. Repeat.',
    logo: '🎮',
    accentColor: '#ff4081',
    accentGradient: 'linear-gradient(135deg, #ff4081 0%, #f50057 100%)',
    bgColor: '#1a0010',
    textColor: '#fce4ec',
    borderStyle: '2px solid #ff408144',
    badgeStyle: 'background: linear-gradient(135deg, #ff408122, #f5005722); border: 1px solid #ff408155; color: #ff4081;',
    reelChrome: 'box-shadow: 0 0 20px #ff408133, inset 0 0 30px #ff408111;',
    specialty: 'Classic & retro arcade',
    founded: '2021'
  },
  {
    id: 'cascade-labs',
    name: 'ThunderBolt Games',
    tagline: 'Strike It Rich',
    logo: '⚡',
    accentColor: '#ffd740',
    accentGradient: 'linear-gradient(135deg, #ffd740 0%, #ff6f00 100%)',
    bgColor: '#1a1200',
    textColor: '#fffde7',
    borderStyle: '2px solid #ffd74044',
    badgeStyle: 'background: linear-gradient(135deg, #ffd74022, #ff6f0022); border: 1px solid #ffd74055; color: #ffd740;',
    reelChrome: 'box-shadow: 0 0 20px #ffd74033, inset 0 0 30px #ffd74011;',
    specialty: 'Megaways & cluster',
    founded: '2018'
  },
  {
    id: 'dragon-pearl',
    name: 'VortexSpin',
    tagline: 'Spin Into the Vortex',
    logo: '🌀',
    accentColor: '#40c4ff',
    accentGradient: 'linear-gradient(135deg, #40c4ff 0%, #0091ea 100%)',
    bgColor: '#001a28',
    textColor: '#e1f5fe',
    borderStyle: '2px solid #40c4ff44',
    badgeStyle: 'background: linear-gradient(135deg, #40c4ff22, #0091ea22); border: 1px solid #40c4ff55; color: #40c4ff;',
    reelChrome: 'box-shadow: 0 0 20px #40c4ff33, inset 0 0 30px #40c4ff11;',
    specialty: 'Innovative mechanics',
    founded: '2019'
  }
];

// Lookup helper
var providerMap = {};
providers.forEach(function(p) { providerMap[p.name] = p; providerMap[p.id] = p; });

if (typeof module !== 'undefined' && module.exports) {
  module.exports = providers;
  module.exports.providerMap = providerMap;
}

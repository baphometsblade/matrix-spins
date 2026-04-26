/**
 * NEW_GAME_CONFIGS - Complete configurations for 24 new games
 * Matrix Spins Casino | All games compatible with CasinoEngine.launch()
 * Generated: 2026-04-07
 */

const NEW_GAME_CONFIGS = {
  // ==================== GOLDEN REELS STUDIO ====================

  retro_reels: {
    id: 'retro_reels',
    name: 'Retro Reels',
    studio: 'golden_reels_studio',
    studioTheme: 'goldenReels',
    assetPath: '/assets/games/retro_reels',
    description: 'Classic slot with random locked reels spinning in sync',
    reels: 5,
    rows: 3,
    paylines: 10,
    rtp: 91.0,
    volatility: 'low',
    mechanic: 'locked-reels',
    minBet: 0.10,
    maxBet: 10.00,
    symbols: [
      {
        id: 'wild',
        name: 'Wild',
        assetPath: '/assets/games/retro_reels/symbols/wild.png',
        weight: 8,
        payouts: { 3: 0, 4: 0, 5: 0 },
        isWild: true,
        isScatter: false
      },
      {
        id: 'scatter_bonus',
        name: 'Bonus Scatter',
        assetPath: '/assets/games/retro_reels/symbols/scatter.png',
        weight: 10,
        payouts: { 2: 1, 3: 5, 4: 25, 5: 100 },
        isWild: false,
        isScatter: true
      },
      {
        id: 'cherry',
        name: 'Retro Cherry',
        assetPath: '/assets/games/retro_reels/symbols/cherry.png',
        weight: 20,
        payouts: { 3: 2, 4: 8, 5: 50 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'bar',
        name: 'Classic Bar',
        assetPath: '/assets/games/retro_reels/symbols/bar.png',
        weight: 18,
        payouts: { 3: 3, 4: 12, 5: 75 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'star',
        name: 'Vintage Star',
        assetPath: '/assets/games/retro_reels/symbols/star.png',
        weight: 15,
        payouts: { 3: 5, 4: 20, 5: 100 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'seven',
        name: 'Old School Seven',
        assetPath: '/assets/games/retro_reels/symbols/seven.png',
        weight: 12,
        payouts: { 3: 8, 4: 30, 5: 150 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'bell',
        name: 'Brass Bell',
        assetPath: '/assets/games/retro_reels/symbols/bell.png',
        weight: 10,
        payouts: { 3: 10, 4: 40, 5: 200 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'diamond',
        name: 'Diamond',
        assetPath: '/assets/games/retro_reels/symbols/diamond.png',
        weight: 7,
        payouts: { 3: 15, 4: 60, 5: 300 },
        isWild: false,
        isScatter: false
      }
    ],
    bonusConfig: {
      type: 'free_spins',
      triggerSymbol: 'scatter_bonus',
      triggerCount: 3,
      freeSpinsCount: 5,
      mechanicBehavior: 'locked-reels-enhanced',
      details: '2 reels lock together for entire free spin feature'
    }
  },

  golden_sevens: {
    id: 'golden_sevens',
    name: 'Golden Sevens',
    studio: 'golden_reels_studio',
    studioTheme: 'goldenReels',
    assetPath: '/assets/games/golden_sevens',
    description: 'Synchronized reels increase in number each free spin',
    reels: 5,
    rows: 3,
    paylines: 20,
    rtp: 91.8,
    volatility: 'medium',
    mechanic: 'reel-sync',
    minBet: 0.10,
    maxBet: 10.00,
    symbols: [
      {
        id: 'wild',
        name: 'Wild',
        assetPath: '/assets/games/golden_sevens/symbols/wild.png',
        weight: 8,
        payouts: { 3: 0, 4: 0, 5: 0 },
        isWild: true,
        isScatter: false
      },
      {
        id: 'scatter_bonus',
        name: 'Bonus Scatter',
        assetPath: '/assets/games/golden_sevens/symbols/scatter.png',
        weight: 10,
        payouts: { 3: 5, 4: 25, 5: 100 },
        isWild: false,
        isScatter: true
      },
      {
        id: 'seven',
        name: 'Golden Seven',
        assetPath: '/assets/games/golden_sevens/symbols/seven.png',
        weight: 12,
        payouts: { 3: 12, 4: 50, 5: 250 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'bar',
        name: 'Gold Bar',
        assetPath: '/assets/games/golden_sevens/symbols/bar.png',
        weight: 14,
        payouts: { 3: 8, 4: 35, 5: 150 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'diamond',
        name: 'Diamond',
        assetPath: '/assets/games/golden_sevens/symbols/diamond.png',
        weight: 16,
        payouts: { 3: 6, 4: 25, 5: 120 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'ruby',
        name: 'Ruby',
        assetPath: '/assets/games/golden_sevens/symbols/ruby.png',
        weight: 15,
        payouts: { 3: 5, 4: 20, 5: 100 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'emerald',
        name: 'Emerald',
        assetPath: '/assets/games/golden_sevens/symbols/emerald.png',
        weight: 13,
        payouts: { 3: 4, 4: 18, 5: 90 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'crown',
        name: 'Crown',
        assetPath: '/assets/games/golden_sevens/symbols/crown.png',
        weight: 12,
        payouts: { 3: 3, 4: 15, 5: 80 },
        isWild: false,
        isScatter: false
      }
    ],
    bonusConfig: {
      type: 'free_spins',
      triggerSymbol: 'scatter_bonus',
      triggerCount: 3,
      freeSpinsCount: 8,
      mechanicBehavior: 'reel-sync-progressive',
      details: 'Synced reels increase by 1 each free spin, starting at 2 reels'
    }
  },

  cherry_blitz: {
    id: 'cherry_blitz',
    name: 'Cherry Blitz',
    studio: 'golden_reels_studio',
    studioTheme: 'goldenReels',
    assetPath: '/assets/games/cherry_blitz',
    description: 'Stacking symbols cascade down the reels for big wins',
    reels: 5,
    rows: 3,
    paylines: 25,
    rtp: 90.8,
    volatility: 'low',
    mechanic: 'symbol-stacking',
    minBet: 0.10,
    maxBet: 10.00,
    symbols: [
      {
        id: 'wild',
        name: 'Wild',
        assetPath: '/assets/games/cherry_blitz/symbols/wild.png',
        weight: 8,
        payouts: { 3: 0, 4: 0, 5: 0 },
        isWild: true,
        isScatter: false
      },
      {
        id: 'scatter_bonus',
        name: 'Bonus Scatter',
        assetPath: '/assets/games/cherry_blitz/symbols/scatter.png',
        weight: 10,
        payouts: { 3: 8, 4: 40, 5: 150 },
        isWild: false,
        isScatter: true
      },
      {
        id: 'cherry',
        name: 'Blitz Cherry',
        assetPath: '/assets/games/cherry_blitz/symbols/cherry.png',
        weight: 18,
        payouts: { 3: 3, 4: 12, 5: 60 },
        isWild: false,
        isScatter: false,
        stackWeight: 3
      },
      {
        id: 'lightning_fruit',
        name: 'Lightning Fruit',
        assetPath: '/assets/games/cherry_blitz/symbols/lightning_fruit.png',
        weight: 16,
        payouts: { 3: 4, 4: 15, 5: 75 },
        isWild: false,
        isScatter: false,
        stackWeight: 3
      },
      {
        id: 'speed_star',
        name: 'Speed Star',
        assetPath: '/assets/games/cherry_blitz/symbols/speed_star.png',
        weight: 14,
        payouts: { 3: 6, 4: 25, 5: 100 },
        isWild: false,
        isScatter: false,
        stackWeight: 2
      },
      {
        id: 'turbo_bar',
        name: 'Turbo Bar',
        assetPath: '/assets/games/cherry_blitz/symbols/turbo_bar.png',
        weight: 12,
        payouts: { 3: 8, 4: 30, 5: 125 },
        isWild: false,
        isScatter: false,
        stackWeight: 2
      },
      {
        id: 'flash_diamond',
        name: 'Flash Diamond',
        assetPath: '/assets/games/cherry_blitz/symbols/flash_diamond.png',
        weight: 10,
        payouts: { 3: 12, 4: 45, 5: 180 },
        isWild: false,
        isScatter: false,
        stackWeight: 2
      },
      {
        id: 'neon_lemon',
        name: 'Neon Lemon',
        assetPath: '/assets/games/cherry_blitz/symbols/neon_lemon.png',
        weight: 12,
        payouts: { 3: 2, 4: 8, 5: 40 },
        isWild: false,
        isScatter: false,
        stackWeight: 3
      }
    ],
    bonusConfig: {
      type: 'free_spins',
      triggerSymbol: 'scatter_bonus',
      triggerCount: 3,
      freeSpinsCount: 10,
      mechanicBehavior: 'symbol-stacking-full',
      details: 'All high symbols (star, bar, diamond) fully stacked during free spins'
    }
  },

  diamond_deco: {
    id: 'diamond_deco',
    name: 'Diamond Deco',
    studio: 'golden_reels_studio',
    studioTheme: 'goldenReels',
    assetPath: '/assets/games/diamond_deco',
    description: 'Art deco elegance with wins in both directions',
    reels: 5,
    rows: 3,
    paylines: 40,
    rtp: 92.2,
    volatility: 'medium',
    mechanic: 'win-both-ways',
    minBet: 0.10,
    maxBet: 10.00,
    symbols: [
      {
        id: 'wild',
        name: 'Wild',
        assetPath: '/assets/games/diamond_deco/symbols/wild.png',
        weight: 8,
        payouts: { 3: 0, 4: 0, 5: 0 },
        isWild: true,
        isScatter: false
      },
      {
        id: 'scatter_bonus',
        name: 'Bonus Scatter',
        assetPath: '/assets/games/diamond_deco/symbols/scatter.png',
        weight: 10,
        payouts: { 3: 8, 4: 45, 5: 180 },
        isWild: false,
        isScatter: true
      },
      {
        id: 'diamond',
        name: 'Art Deco Diamond',
        assetPath: '/assets/games/diamond_deco/symbols/diamond.png',
        weight: 12,
        payouts: { 3: 15, 4: 60, 5: 300 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'fan',
        name: 'Gold Fan',
        assetPath: '/assets/games/diamond_deco/symbols/fan.png',
        weight: 14,
        payouts: { 3: 12, 4: 50, 5: 250 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'star',
        name: 'Deco Star',
        assetPath: '/assets/games/diamond_deco/symbols/star.png',
        weight: 14,
        payouts: { 3: 10, 4: 40, 5: 200 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'gem',
        name: 'Gatsby Gem',
        assetPath: '/assets/games/diamond_deco/symbols/gem.png',
        weight: 15,
        payouts: { 3: 8, 4: 32, 5: 160 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'orchid',
        name: 'Brass Orchid',
        assetPath: '/assets/games/diamond_deco/symbols/orchid.png',
        weight: 16,
        payouts: { 3: 6, 4: 24, 5: 120 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'trumpet',
        name: 'Jazz Trumpet',
        assetPath: '/assets/games/diamond_deco/symbols/trumpet.png',
        weight: 15,
        payouts: { 3: 4, 4: 16, 5: 80 },
        isWild: false,
        isScatter: false
      }
    ],
    bonusConfig: {
      type: 'free_spins',
      triggerSymbol: 'scatter_bonus',
      triggerCount: 3,
      freeSpinsCount: 8,
      mechanicBehavior: 'win-both-ways-with-multiplier',
      details: 'Win both ways with 2x multiplier for 8 free spins'
    }
  },

  // ==================== NEBULA GAMING ====================

  asteroid_fortune: {
    id: 'asteroid_fortune',
    name: 'Asteroid Fortune',
    studio: 'nebula_gaming',
    studioTheme: 'nebulaGaming',
    assetPath: '/assets/games/asteroid_fortune',
    description: 'Winning symbols explode and multiply your winnings',
    reels: 5,
    rows: 3,
    paylines: 20,
    rtp: 91.0,
    volatility: 'high',
    mechanic: 'symbol-explosion',
    minBet: 0.10,
    maxBet: 10.00,
    symbols: [
      {
        id: 'wild',
        name: 'Wild',
        assetPath: '/assets/games/asteroid_fortune/symbols/wild.png',
        weight: 8,
        payouts: { 3: 0, 4: 0, 5: 0 },
        isWild: true,
        isScatter: false
      },
      {
        id: 'scatter_bonus',
        name: 'Bonus Scatter',
        assetPath: '/assets/games/asteroid_fortune/symbols/scatter.png',
        weight: 10,
        payouts: { 3: 10, 4: 50, 5: 200 },
        isWild: false,
        isScatter: true
      },
      {
        id: 'asteroid',
        name: 'Golden Asteroid',
        assetPath: '/assets/games/asteroid_fortune/symbols/asteroid.png',
        weight: 12,
        payouts: { 3: 15, 4: 60, 5: 300 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'laser',
        name: 'Mining Laser',
        assetPath: '/assets/games/asteroid_fortune/symbols/laser.png',
        weight: 13,
        payouts: { 3: 12, 4: 48, 5: 240 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'gem',
        name: 'Space Gem',
        assetPath: '/assets/games/asteroid_fortune/symbols/gem.png',
        weight: 14,
        payouts: { 3: 10, 4: 40, 5: 200 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'meteor',
        name: 'Meteor Shower',
        assetPath: '/assets/games/asteroid_fortune/symbols/meteor.png',
        weight: 15,
        payouts: { 3: 8, 4: 32, 5: 160 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'crystal',
        name: 'Crystal Core',
        assetPath: '/assets/games/asteroid_fortune/symbols/crystal.png',
        weight: 16,
        payouts: { 3: 6, 4: 24, 5: 120 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'plasma',
        name: 'Plasma Orb',
        assetPath: '/assets/games/asteroid_fortune/symbols/plasma.png',
        weight: 14,
        payouts: { 3: 4, 4: 16, 5: 80 },
        isWild: false,
        isScatter: false
      }
    ],
    bonusConfig: {
      type: 'free_spins',
      triggerSymbol: 'scatter_bonus',
      triggerCount: 3,
      freeSpinsCount: 10,
      mechanicBehavior: 'explosion-with-multiplier',
      details: 'Every explosion adds 1x to multiplier, stacking infinitely'
    }
  },

  warp_drive: {
    id: 'warp_drive',
    name: 'Warp Drive',
    studio: 'nebula_gaming',
    studioTheme: 'nebulaGaming',
    assetPath: '/assets/games/warp_drive',
    description: 'Reels expand with each winning spin to unlock new ways',
    reels: 5,
    rows: 3,
    paylines: 1,
    rtp: 92.5,
    volatility: 'high',
    mechanic: 'reel-rush',
    minBet: 0.10,
    maxBet: 10.00,
    symbols: [
      {
        id: 'wild',
        name: 'Wild',
        assetPath: '/assets/games/warp_drive/symbols/wild.png',
        weight: 8,
        payouts: { 3: 0, 4: 0, 5: 0 },
        isWild: true,
        isScatter: false
      },
      {
        id: 'scatter_bonus',
        name: 'Bonus Scatter',
        assetPath: '/assets/games/warp_drive/symbols/scatter.png',
        weight: 10,
        payouts: { 3: 12, 4: 60, 5: 240 },
        isWild: false,
        isScatter: true
      },
      {
        id: 'engine',
        name: 'Warp Engine',
        assetPath: '/assets/games/warp_drive/symbols/engine.png',
        weight: 12,
        payouts: { 3: 15, 4: 60, 5: 300 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'tunnel',
        name: 'Hyperspace Tunnel',
        assetPath: '/assets/games/warp_drive/symbols/tunnel.png',
        weight: 13,
        payouts: { 3: 12, 4: 48, 5: 240 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'crystal',
        name: 'Time Crystal',
        assetPath: '/assets/games/warp_drive/symbols/crystal.png',
        weight: 14,
        payouts: { 3: 10, 4: 40, 5: 200 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'capacitor',
        name: 'Flux Capacitor',
        assetPath: '/assets/games/warp_drive/symbols/capacitor.png',
        weight: 15,
        payouts: { 3: 8, 4: 32, 5: 160 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'gate',
        name: 'Jump Gate',
        assetPath: '/assets/games/warp_drive/symbols/gate.png',
        weight: 16,
        payouts: { 3: 6, 4: 24, 5: 120 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'star',
        name: 'Void Star',
        assetPath: '/assets/games/warp_drive/symbols/star.png',
        weight: 14,
        payouts: { 3: 4, 4: 16, 5: 80 },
        isWild: false,
        isScatter: false
      }
    ],
    bonusConfig: {
      type: 'free_spins',
      triggerSymbol: 'scatter_bonus',
      triggerCount: 3,
      freeSpinsCount: 12,
      mechanicBehavior: 'reel-rush-maxed',
      details: 'Start at maximum reel size (5x5x5x5x5) during free spins'
    }
  },

  plasma_grid: {
    id: 'plasma_grid',
    name: 'Plasma Grid',
    studio: 'nebula_gaming',
    studioTheme: 'nebulaGaming',
    assetPath: '/assets/games/plasma_grid',
    description: 'Heat map reels increase multipliers on hot positions',
    reels: 6,
    rows: 5,
    paylines: 0,
    rtp: 90.8,
    volatility: 'medium',
    mechanic: 'heat-map-respins',
    minBet: 0.10,
    maxBet: 10.00,
    symbols: [
      {
        id: 'wild',
        name: 'Wild',
        assetPath: '/assets/games/plasma_grid/symbols/wild.png',
        weight: 8,
        payouts: { 3: 0, 4: 0, 5: 0 },
        isWild: true,
        isScatter: false
      },
      {
        id: 'scatter_bonus',
        name: 'Bonus Scatter',
        assetPath: '/assets/games/plasma_grid/symbols/scatter.png',
        weight: 10,
        payouts: { 2: 5, 3: 25, 4: 100 },
        isWild: false,
        isScatter: true
      },
      {
        id: 'cell',
        name: 'Plasma Cell',
        assetPath: '/assets/games/plasma_grid/symbols/cell.png',
        weight: 14,
        payouts: { 4: 8, 5: 40, 6: 200 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'grid',
        name: 'Energy Grid',
        assetPath: '/assets/games/plasma_grid/symbols/grid.png',
        weight: 14,
        payouts: { 4: 10, 5: 50, 6: 250 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'circuit',
        name: 'Circuit Board',
        assetPath: '/assets/games/plasma_grid/symbols/circuit.png',
        weight: 15,
        payouts: { 4: 8, 5: 40, 6: 200 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'node',
        name: 'Power Node',
        assetPath: '/assets/games/plasma_grid/symbols/node.png',
        weight: 15,
        payouts: { 4: 6, 5: 30, 6: 150 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'coil',
        name: 'Tesla Coil',
        assetPath: '/assets/games/plasma_grid/symbols/coil.png',
        weight: 15,
        payouts: { 4: 5, 5: 25, 6: 125 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'chip',
        name: 'Quantum Chip',
        assetPath: '/assets/games/plasma_grid/symbols/chip.png',
        weight: 13,
        payouts: { 4: 4, 5: 20, 6: 100 },
        isWild: false,
        isScatter: false
      }
    ],
    bonusConfig: {
      type: 'free_spins',
      triggerSymbol: 'scatter_bonus',
      triggerCount: 3,
      freeSpinsCount: 8,
      mechanicBehavior: 'heat-map-enhanced',
      details: 'Heat map positions start at 2x multiplier during free spins'
    }
  },

  lunar_loot: {
    id: 'lunar_loot',
    name: 'Lunar Loot',
    studio: 'nebula_gaming',
    studioTheme: 'nebulaGaming',
    assetPath: '/assets/games/lunar_loot',
    description: 'Collect moon symbols to fill the meter and win prizes',
    reels: 5,
    rows: 3,
    paylines: 20,
    rtp: 91.5,
    volatility: 'medium',
    mechanic: 'collection-meter',
    minBet: 0.10,
    maxBet: 10.00,
    symbols: [
      {
        id: 'wild',
        name: 'Wild',
        assetPath: '/assets/games/lunar_loot/symbols/wild.png',
        weight: 8,
        payouts: { 3: 0, 4: 0, 5: 0 },
        isWild: true,
        isScatter: false
      },
      {
        id: 'scatter_bonus',
        name: 'Bonus Scatter',
        assetPath: '/assets/games/lunar_loot/symbols/scatter.png',
        weight: 10,
        payouts: { 3: 8, 4: 40, 5: 160 },
        isWild: false,
        isScatter: true
      },
      {
        id: 'rock',
        name: 'Moon Rock',
        assetPath: '/assets/games/lunar_loot/symbols/rock.png',
        weight: 16,
        payouts: { 3: 3, 4: 12, 5: 60 },
        isWild: false,
        isScatter: false,
        collectionValue: 1
      },
      {
        id: 'gem',
        name: 'Lunar Gem',
        assetPath: '/assets/games/lunar_loot/symbols/gem.png',
        weight: 15,
        payouts: { 3: 5, 4: 20, 5: 100 },
        isWild: false,
        isScatter: false,
        collectionValue: 2
      },
      {
        id: 'crater_gold',
        name: 'Crater Gold',
        assetPath: '/assets/games/lunar_loot/symbols/crater_gold.png',
        weight: 14,
        payouts: { 3: 8, 4: 32, 5: 160 },
        isWild: false,
        isScatter: false,
        collectionValue: 3
      },
      {
        id: 'chest',
        name: 'Space Chest',
        assetPath: '/assets/games/lunar_loot/symbols/chest.png',
        weight: 13,
        payouts: { 3: 12, 4: 50, 5: 250 },
        isWild: false,
        isScatter: false,
        collectionValue: 5
      },
      {
        id: 'helmet',
        name: 'Astronaut Helmet',
        assetPath: '/assets/games/lunar_loot/symbols/helmet.png',
        weight: 14,
        payouts: { 3: 6, 4: 24, 5: 120 },
        isWild: false,
        isScatter: false,
        collectionValue: 2
      },
      {
        id: 'satellite',
        name: 'Satellite',
        assetPath: '/assets/games/lunar_loot/symbols/satellite.png',
        weight: 12,
        payouts: { 3: 10, 4: 42, 5: 210 },
        isWild: false,
        isScatter: false,
        collectionValue: 4
      }
    ],
    bonusConfig: {
      type: 'free_spins',
      triggerSymbol: 'scatter_bonus',
      triggerCount: 3,
      freeSpinsCount: 10,
      mechanicBehavior: 'collection-meter-boosted',
      details: 'Collection meter starts half full during free spins'
    }
  },

  // ==================== MYTHIC FORGE ====================

  tomb_of_anubis: {
    id: 'tomb_of_anubis',
    name: 'Tomb of Anubis',
    studio: 'mythic_forge',
    studioTheme: 'mythicForge',
    assetPath: '/assets/games/tomb_of_anubis',
    description: 'Ancient wilds remain locked throughout your free spins',
    reels: 5,
    rows: 3,
    paylines: 20,
    rtp: 92.0,
    volatility: 'high',
    mechanic: 'sticky-wilds',
    minBet: 0.10,
    maxBet: 10.00,
    symbols: [
      {
        id: 'wild',
        name: 'Wild',
        assetPath: '/assets/games/tomb_of_anubis/symbols/wild.png',
        weight: 8,
        payouts: { 3: 0, 4: 0, 5: 0 },
        isWild: true,
        isScatter: false
      },
      {
        id: 'scatter_bonus',
        name: 'Bonus Scatter',
        assetPath: '/assets/games/tomb_of_anubis/symbols/scatter.png',
        weight: 10,
        payouts: { 3: 10, 4: 50, 5: 200 },
        isWild: false,
        isScatter: true
      },
      {
        id: 'anubis',
        name: 'Anubis Statue',
        assetPath: '/assets/games/tomb_of_anubis/symbols/anubis.png',
        weight: 11,
        payouts: { 3: 20, 4: 80, 5: 400 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'jar',
        name: 'Canopic Jar',
        assetPath: '/assets/games/tomb_of_anubis/symbols/jar.png',
        weight: 12,
        payouts: { 3: 15, 4: 60, 5: 300 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'mask',
        name: 'Death Mask',
        assetPath: '/assets/games/tomb_of_anubis/symbols/mask.png',
        weight: 13,
        payouts: { 3: 12, 4: 48, 5: 240 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'key',
        name: 'Tomb Key',
        assetPath: '/assets/games/tomb_of_anubis/symbols/key.png',
        weight: 14,
        payouts: { 3: 10, 4: 40, 5: 200 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'jackal',
        name: 'Sacred Jackal',
        assetPath: '/assets/games/tomb_of_anubis/symbols/jackal.png',
        weight: 15,
        payouts: { 3: 8, 4: 32, 5: 160 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'scarab',
        name: 'Golden Scarab',
        assetPath: '/assets/games/tomb_of_anubis/symbols/scarab.png',
        weight: 16,
        payouts: { 3: 6, 4: 24, 5: 120 },
        isWild: false,
        isScatter: false
      }
    ],
    bonusConfig: {
      type: 'free_spins',
      triggerSymbol: 'scatter_bonus',
      triggerCount: 3,
      freeSpinsCount: 10,
      mechanicBehavior: 'sticky-wilds-feature',
      details: 'All wilds become sticky and remain locked for entire free spin feature'
    }
  },

  curse_of_sphinx: {
    id: 'curse_of_sphinx',
    name: 'Curse of the Sphinx',
    studio: 'mythic_forge',
    studioTheme: 'mythicForge',
    assetPath: '/assets/games/curse_of_sphinx',
    description: 'Symbols randomly transform after each spin for bigger wins',
    reels: 5,
    rows: 3,
    paylines: 25,
    rtp: 90.8,
    volatility: 'high',
    mechanic: 'symbol-morph',
    minBet: 0.10,
    maxBet: 10.00,
    symbols: [
      {
        id: 'wild',
        name: 'Wild',
        assetPath: '/assets/games/curse_of_sphinx/symbols/wild.png',
        weight: 8,
        payouts: { 3: 0, 4: 0, 5: 0 },
        isWild: true,
        isScatter: false
      },
      {
        id: 'scatter_bonus',
        name: 'Bonus Scatter',
        assetPath: '/assets/games/curse_of_sphinx/symbols/scatter.png',
        weight: 10,
        payouts: { 3: 12, 4: 60, 5: 240 },
        isWild: false,
        isScatter: true
      },
      {
        id: 'riddle',
        name: 'Sphinx Riddle',
        assetPath: '/assets/games/curse_of_sphinx/symbols/riddle.png',
        weight: 12,
        payouts: { 3: 20, 4: 80, 5: 400 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'eye',
        name: 'Cursed Eye',
        assetPath: '/assets/games/curse_of_sphinx/symbols/eye.png',
        weight: 13,
        payouts: { 3: 15, 4: 60, 5: 300 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'rose',
        name: 'Desert Rose',
        assetPath: '/assets/games/curse_of_sphinx/symbols/rose.png',
        weight: 14,
        payouts: { 3: 12, 4: 48, 5: 240 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'timer',
        name: 'Sand Timer',
        assetPath: '/assets/games/curse_of_sphinx/symbols/timer.png',
        weight: 15,
        payouts: { 3: 10, 4: 40, 5: 200 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'seal',
        name: 'Ancient Seal',
        assetPath: '/assets/games/curse_of_sphinx/symbols/seal.png',
        weight: 15,
        payouts: { 3: 8, 4: 32, 5: 160 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'gem',
        name: 'Oasis Gem',
        assetPath: '/assets/games/curse_of_sphinx/symbols/gem.png',
        weight: 13,
        payouts: { 3: 6, 4: 24, 5: 120 },
        isWild: false,
        isScatter: false
      }
    ],
    bonusConfig: {
      type: 'free_spins',
      triggerSymbol: 'scatter_bonus',
      triggerCount: 3,
      freeSpinsCount: 12,
      mechanicBehavior: 'symbol-morph-upgraded',
      details: 'Symbols always morph to higher value symbols during free spins'
    }
  },

  medusa_gaze: {
    id: 'medusa_gaze',
    name: 'Medusa\'s Gaze',
    studio: 'mythic_forge',
    studioTheme: 'mythicForge',
    assetPath: '/assets/games/medusa_gaze',
    description: 'Features level up as you play, unlocking greater rewards',
    reels: 5,
    rows: 4,
    paylines: 30,
    rtp: 91.5,
    volatility: 'medium',
    mechanic: 'level-up',
    minBet: 0.10,
    maxBet: 10.00,
    symbols: [
      {
        id: 'wild',
        name: 'Wild',
        assetPath: '/assets/games/medusa_gaze/symbols/wild.png',
        weight: 8,
        payouts: { 3: 0, 4: 0, 5: 0 },
        isWild: true,
        isScatter: false
      },
      {
        id: 'scatter_bonus',
        name: 'Bonus Scatter',
        assetPath: '/assets/games/medusa_gaze/symbols/scatter.png',
        weight: 10,
        payouts: { 3: 10, 4: 50, 5: 200 },
        isWild: false,
        isScatter: true
      },
      {
        id: 'medusa',
        name: 'Medusa Head',
        assetPath: '/assets/games/medusa_gaze/symbols/medusa.png',
        weight: 11,
        payouts: { 3: 20, 4: 80, 5: 400 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'gaze',
        name: 'Stone Gaze',
        assetPath: '/assets/games/medusa_gaze/symbols/gaze.png',
        weight: 12,
        payouts: { 3: 15, 4: 60, 5: 300 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'crown',
        name: 'Serpent Crown',
        assetPath: '/assets/games/medusa_gaze/symbols/crown.png',
        weight: 13,
        payouts: { 3: 12, 4: 48, 5: 240 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'soldier',
        name: 'Petrified Soldier',
        assetPath: '/assets/games/medusa_gaze/symbols/soldier.png',
        weight: 14,
        payouts: { 3: 10, 4: 40, 5: 200 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'shield',
        name: 'Golden Shield',
        assetPath: '/assets/games/medusa_gaze/symbols/shield.png',
        weight: 15,
        payouts: { 3: 8, 4: 32, 5: 160 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'branch',
        name: 'Olive Branch',
        assetPath: '/assets/games/medusa_gaze/symbols/branch.png',
        weight: 16,
        payouts: { 3: 6, 4: 24, 5: 120 },
        isWild: false,
        isScatter: false
      }
    ],
    bonusConfig: {
      type: 'free_spins',
      triggerSymbol: 'scatter_bonus',
      triggerCount: 3,
      freeSpinsCount: 10,
      mechanicBehavior: 'level-up-progression',
      details: 'Level 1→2→3 upgrades with more wilds and bigger multipliers'
    }
  },

  // ==================== WILD FRONTIER ====================

  outback_gold: {
    id: 'outback_gold',
    name: 'Outback Gold',
    studio: 'wild_frontier',
    studioTheme: 'wildFrontier',
    assetPath: '/assets/games/outback_gold',
    description: 'Cascading wins with growing multipliers across spins',
    reels: 5,
    rows: 3,
    paylines: 20,
    rtp: 91.5,
    volatility: 'medium',
    mechanic: 'avalanche-with-growing-multiplier',
    minBet: 0.10,
    maxBet: 10.00,
    symbols: [
      {
        id: 'wild',
        name: 'Wild',
        assetPath: '/assets/games/outback_gold/symbols/wild.png',
        weight: 8,
        payouts: { 3: 0, 4: 0, 5: 0 },
        isWild: true,
        isScatter: false
      },
      {
        id: 'scatter_bonus',
        name: 'Bonus Scatter',
        assetPath: '/assets/games/outback_gold/symbols/scatter.png',
        weight: 10,
        payouts: { 3: 8, 4: 40, 5: 160 },
        isWild: false,
        isScatter: true
      },
      {
        id: 'kangaroo',
        name: 'Kangaroo',
        assetPath: '/assets/games/outback_gold/symbols/kangaroo.png',
        weight: 13,
        payouts: { 3: 15, 4: 60, 5: 300 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'koala',
        name: 'Koala',
        assetPath: '/assets/games/outback_gold/symbols/koala.png',
        weight: 14,
        payouts: { 3: 12, 4: 48, 5: 240 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'boomerang',
        name: 'Boomerang',
        assetPath: '/assets/games/outback_gold/symbols/boomerang.png',
        weight: 14,
        payouts: { 3: 10, 4: 40, 5: 200 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'sunset',
        name: 'Outback Sunset',
        assetPath: '/assets/games/outback_gold/symbols/sunset.png',
        weight: 15,
        payouts: { 3: 8, 4: 32, 5: 160 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'nugget',
        name: 'Gold Nugget',
        assetPath: '/assets/games/outback_gold/symbols/nugget.png',
        weight: 15,
        payouts: { 3: 6, 4: 24, 5: 120 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'eucalyptus',
        name: 'Eucalyptus',
        assetPath: '/assets/games/outback_gold/symbols/eucalyptus.png',
        weight: 16,
        payouts: { 3: 4, 4: 16, 5: 80 },
        isWild: false,
        isScatter: false
      }
    ],
    bonusConfig: {
      type: 'free_spins',
      triggerSymbol: 'scatter_bonus',
      triggerCount: 3,
      freeSpinsCount: 8,
      mechanicBehavior: 'avalanche-persistent-multiplier',
      details: 'Multiplier does not reset between spins during feature'
    }
  },

  eagle_peak: {
    id: 'eagle_peak',
    name: 'Eagle Peak',
    studio: 'wild_frontier',
    studioTheme: 'wildFrontier',
    assetPath: '/assets/games/eagle_peak',
    description: 'Symbols split to double win potential on every spin',
    reels: 5,
    rows: 4,
    paylines: 40,
    rtp: 92.0,
    volatility: 'high',
    mechanic: 'split-symbols',
    minBet: 0.10,
    maxBet: 10.00,
    symbols: [
      {
        id: 'wild',
        name: 'Wild',
        assetPath: '/assets/games/eagle_peak/symbols/wild.png',
        weight: 8,
        payouts: { 3: 0, 4: 0, 5: 0 },
        isWild: true,
        isScatter: false
      },
      {
        id: 'scatter_bonus',
        name: 'Bonus Scatter',
        assetPath: '/assets/games/eagle_peak/symbols/scatter.png',
        weight: 10,
        payouts: { 3: 10, 4: 50, 5: 200 },
        isWild: false,
        isScatter: true
      },
      {
        id: 'eagle',
        name: 'Bald Eagle',
        assetPath: '/assets/games/eagle_peak/symbols/eagle.png',
        weight: 11,
        payouts: { 3: 20, 4: 80, 5: 400 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'peak',
        name: 'Mountain Peak',
        assetPath: '/assets/games/eagle_peak/symbols/peak.png',
        weight: 12,
        payouts: { 3: 15, 4: 60, 5: 300 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'feather',
        name: 'Golden Feather',
        assetPath: '/assets/games/eagle_peak/symbols/feather.png',
        weight: 13,
        payouts: { 3: 12, 4: 48, 5: 240 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'gem',
        name: 'Alpine Gem',
        assetPath: '/assets/games/eagle_peak/symbols/gem.png',
        weight: 14,
        payouts: { 3: 10, 4: 40, 5: 200 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'nest',
        name: 'Cloud Nest',
        assetPath: '/assets/games/eagle_peak/symbols/nest.png',
        weight: 15,
        payouts: { 3: 8, 4: 32, 5: 160 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'tree',
        name: 'Pine Tree',
        assetPath: '/assets/games/eagle_peak/symbols/tree.png',
        weight: 16,
        payouts: { 3: 6, 4: 24, 5: 120 },
        isWild: false,
        isScatter: false
      }
    ],
    bonusConfig: {
      type: 'free_spins',
      triggerSymbol: 'scatter_bonus',
      triggerCount: 3,
      freeSpinsCount: 12,
      mechanicBehavior: 'split-symbols-eagle-locked',
      details: 'All eagle symbols split during free spins'
    }
  },

  // ==================== SHADOW WORKS ====================

  phantom_manor: {
    id: 'phantom_manor',
    name: 'Phantom Manor',
    studio: 'shadow_works',
    studioTheme: 'shadowWorks',
    assetPath: '/assets/games/phantom_manor',
    description: 'Random bursts of wilds strike during free spins',
    reels: 5,
    rows: 3,
    paylines: 20,
    rtp: 90.8,
    volatility: 'high',
    mechanic: 'wild-storm',
    minBet: 0.10,
    maxBet: 10.00,
    symbols: [
      {
        id: 'wild',
        name: 'Wild',
        assetPath: '/assets/games/phantom_manor/symbols/wild.png',
        weight: 8,
        payouts: { 3: 0, 4: 0, 5: 0 },
        isWild: true,
        isScatter: false
      },
      {
        id: 'scatter_bonus',
        name: 'Bonus Scatter',
        assetPath: '/assets/games/phantom_manor/symbols/scatter.png',
        weight: 10,
        payouts: { 3: 10, 4: 50, 5: 200 },
        isWild: false,
        isScatter: true
      },
      {
        id: 'manor',
        name: 'Haunted Manor',
        assetPath: '/assets/games/phantom_manor/symbols/manor.png',
        weight: 12,
        payouts: { 3: 15, 4: 60, 5: 300 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'lantern',
        name: 'Ghost Lantern',
        assetPath: '/assets/games/phantom_manor/symbols/lantern.png',
        weight: 13,
        payouts: { 3: 12, 4: 48, 5: 240 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'bride',
        name: 'Phantom Bride',
        assetPath: '/assets/games/phantom_manor/symbols/bride.png',
        weight: 14,
        payouts: { 3: 10, 4: 40, 5: 200 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'door',
        name: 'Creaking Door',
        assetPath: '/assets/games/phantom_manor/symbols/door.png',
        weight: 15,
        payouts: { 3: 8, 4: 32, 5: 160 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'mirror',
        name: 'Spectral Mirror',
        assetPath: '/assets/games/phantom_manor/symbols/mirror.png',
        weight: 15,
        payouts: { 3: 6, 4: 24, 5: 120 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'painting',
        name: 'Cursed Painting',
        assetPath: '/assets/games/phantom_manor/symbols/painting.png',
        weight: 13,
        payouts: { 3: 4, 4: 16, 5: 80 },
        isWild: false,
        isScatter: false
      }
    ],
    bonusConfig: {
      type: 'free_spins',
      triggerSymbol: 'scatter_bonus',
      triggerCount: 3,
      freeSpinsCount: 10,
      mechanicBehavior: 'wild-storm-guaranteed',
      details: 'Wild storm with 3-15 wilds guaranteed every spin during free spins'
    }
  },

  blood_moon: {
    id: 'blood_moon',
    name: 'Blood Moon Rising',
    studio: 'shadow_works',
    studioTheme: 'shadowWorks',
    assetPath: '/assets/games/blood_moon',
    description: 'Adjacent symbols merge into mega symbols for triple payouts',
    reels: 5,
    rows: 4,
    paylines: 30,
    rtp: 91.2,
    volatility: 'high',
    mechanic: 'symbol-merge',
    minBet: 0.10,
    maxBet: 10.00,
    symbols: [
      {
        id: 'wild',
        name: 'Wild',
        assetPath: '/assets/games/blood_moon/symbols/wild.png',
        weight: 8,
        payouts: { 3: 0, 4: 0, 5: 0 },
        isWild: true,
        isScatter: false
      },
      {
        id: 'scatter_bonus',
        name: 'Bonus Scatter',
        assetPath: '/assets/games/blood_moon/symbols/scatter.png',
        weight: 10,
        payouts: { 3: 12, 4: 60, 5: 240 },
        isWild: false,
        isScatter: true
      },
      {
        id: 'moon',
        name: 'Blood Moon',
        assetPath: '/assets/games/blood_moon/symbols/moon.png',
        weight: 11,
        payouts: { 3: 20, 4: 80, 5: 400 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'werewolf',
        name: 'Werewolf',
        assetPath: '/assets/games/blood_moon/symbols/werewolf.png',
        weight: 12,
        payouts: { 3: 15, 4: 60, 5: 300 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'bullet',
        name: 'Silver Bullet',
        assetPath: '/assets/games/blood_moon/symbols/bullet.png',
        weight: 13,
        payouts: { 3: 12, 4: 48, 5: 240 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'pendant',
        name: 'Cursed Pendant',
        assetPath: '/assets/games/blood_moon/symbols/pendant.png',
        weight: 14,
        payouts: { 3: 10, 4: 40, 5: 200 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'forest',
        name: 'Dark Forest',
        assetPath: '/assets/games/blood_moon/symbols/forest.png',
        weight: 15,
        payouts: { 3: 8, 4: 32, 5: 160 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'tome',
        name: 'Ancient Tome',
        assetPath: '/assets/games/blood_moon/symbols/tome.png',
        weight: 16,
        payouts: { 3: 6, 4: 24, 5: 120 },
        isWild: false,
        isScatter: false
      }
    ],
    bonusConfig: {
      type: 'free_spins',
      triggerSymbol: 'scatter_bonus',
      triggerCount: 3,
      freeSpinsCount: 12,
      mechanicBehavior: 'symbol-merge-triple',
      details: 'Merged symbols pay 3x during free spins'
    }
  },

  // ==================== DRAGON PEARL ====================

  koi_cascade: {
    id: 'koi_cascade',
    name: 'Koi Cascade',
    studio: 'dragon_pearl',
    studioTheme: 'dragonPearl',
    assetPath: '/assets/games/koi_cascade',
    description: 'Winning symbols removed, new ones fall creating chain reactions',
    reels: 6,
    rows: 5,
    paylines: 0,
    rtp: 91.0,
    volatility: 'low',
    mechanic: 'reaction-pays',
    minBet: 0.10,
    maxBet: 10.00,
    symbols: [
      {
        id: 'wild',
        name: 'Wild',
        assetPath: '/assets/games/koi_cascade/symbols/wild.png',
        weight: 8,
        payouts: { 3: 0, 4: 0, 5: 0 },
        isWild: true,
        isScatter: false
      },
      {
        id: 'scatter_bonus',
        name: 'Bonus Scatter',
        assetPath: '/assets/games/koi_cascade/symbols/scatter.png',
        weight: 10,
        payouts: { 2: 5, 3: 25, 4: 100 },
        isWild: false,
        isScatter: true
      },
      {
        id: 'koi',
        name: 'Cascading Koi',
        assetPath: '/assets/games/koi_cascade/symbols/koi.png',
        weight: 14,
        payouts: { 4: 10, 5: 50, 6: 250 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'waterfall',
        name: 'Waterfall',
        assetPath: '/assets/games/koi_cascade/symbols/waterfall.png',
        weight: 14,
        payouts: { 4: 12, 5: 60, 6: 300 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'lily',
        name: 'Golden Lily',
        assetPath: '/assets/games/koi_cascade/symbols/lily.png',
        weight: 15,
        payouts: { 4: 10, 5: 50, 6: 250 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'bridge',
        name: 'Moon Bridge',
        assetPath: '/assets/games/koi_cascade/symbols/bridge.png',
        weight: 15,
        payouts: { 4: 8, 5: 40, 6: 200 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'stone',
        name: 'Fortune Stone',
        assetPath: '/assets/games/koi_cascade/symbols/stone.png',
        weight: 15,
        payouts: { 4: 6, 5: 30, 6: 150 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'bamboo',
        name: 'Bamboo',
        assetPath: '/assets/games/koi_cascade/symbols/bamboo.png',
        weight: 13,
        payouts: { 4: 4, 5: 20, 6: 100 },
        isWild: false,
        isScatter: false
      }
    ],
    bonusConfig: {
      type: 'free_spins',
      triggerSymbol: 'scatter_bonus',
      triggerCount: 3,
      freeSpinsCount: 10,
      mechanicBehavior: 'reaction-pays-unlimited',
      details: 'Unlimited cascades during free spins'
    }
  },

  jade_emperor: {
    id: 'jade_emperor',
    name: 'Jade Emperor',
    studio: 'dragon_pearl',
    studioTheme: 'dragonPearl',
    assetPath: '/assets/games/jade_emperor',
    description: 'Pay to enter the throne room and trigger expanding wilds',
    reels: 5,
    rows: 3,
    paylines: 25,
    rtp: 92.2,
    volatility: 'high',
    mechanic: 'bonus-buy',
    minBet: 0.10,
    maxBet: 10.00,
    symbols: [
      {
        id: 'wild',
        name: 'Wild',
        assetPath: '/assets/games/jade_emperor/symbols/wild.png',
        weight: 8,
        payouts: { 3: 0, 4: 0, 5: 0 },
        isWild: true,
        isScatter: false
      },
      {
        id: 'scatter_bonus',
        name: 'Bonus Scatter',
        assetPath: '/assets/games/jade_emperor/symbols/scatter.png',
        weight: 10,
        payouts: { 3: 8, 4: 40, 5: 160 },
        isWild: false,
        isScatter: true
      },
      {
        id: 'emperor',
        name: 'Jade Emperor',
        assetPath: '/assets/games/jade_emperor/symbols/emperor.png',
        weight: 11,
        payouts: { 3: 20, 4: 80, 5: 400 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'court',
        name: 'Celestial Court',
        assetPath: '/assets/games/jade_emperor/symbols/court.png',
        weight: 12,
        payouts: { 3: 15, 4: 60, 5: 300 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'dragon',
        name: 'Imperial Dragon',
        assetPath: '/assets/games/jade_emperor/symbols/dragon.png',
        weight: 13,
        payouts: { 3: 12, 4: 48, 5: 240 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'gate',
        name: 'Heaven Gate',
        assetPath: '/assets/games/jade_emperor/symbols/gate.png',
        weight: 14,
        payouts: { 3: 10, 4: 40, 5: 200 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'decree',
        name: 'Divine Decree',
        assetPath: '/assets/games/jade_emperor/symbols/decree.png',
        weight: 15,
        payouts: { 3: 8, 4: 32, 5: 160 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'seal',
        name: 'Jade Seal',
        assetPath: '/assets/games/jade_emperor/symbols/seal.png',
        weight: 16,
        payouts: { 3: 6, 4: 24, 5: 120 },
        isWild: false,
        isScatter: false
      }
    ],
    bonusConfig: {
      type: 'free_spins',
      triggerSymbol: 'scatter_bonus',
      triggerCount: 3,
      freeSpinsCount: 12,
      mechanicBehavior: 'bonus-buy-feature',
      buyinCost: 100,
      details: 'Pay 100x bet to buy 12 free spins with expanding wilds'
    }
  },

  fortune_tiger: {
    id: 'fortune_tiger',
    name: 'Fortune Tiger',
    studio: 'dragon_pearl',
    studioTheme: 'dragonPearl',
    assetPath: '/assets/games/fortune_tiger',
    description: 'Random free spins awarded naturally without cost',
    reels: 5,
    rows: 3,
    paylines: 20,
    rtp: 91.8,
    volatility: 'medium',
    mechanic: 'free-bet',
    minBet: 0.10,
    maxBet: 10.00,
    symbols: [
      {
        id: 'wild',
        name: 'Wild',
        assetPath: '/assets/games/fortune_tiger/symbols/wild.png',
        weight: 8,
        payouts: { 3: 0, 4: 0, 5: 0 },
        isWild: true,
        isScatter: false
      },
      {
        id: 'scatter_bonus',
        name: 'Bonus Scatter',
        assetPath: '/assets/games/fortune_tiger/symbols/scatter.png',
        weight: 10,
        payouts: { 3: 8, 4: 40, 5: 160 },
        isWild: false,
        isScatter: true
      },
      {
        id: 'tiger',
        name: 'Fortune Tiger',
        assetPath: '/assets/games/fortune_tiger/symbols/tiger.png',
        weight: 13,
        payouts: { 3: 15, 4: 60, 5: 300 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'bamboo',
        name: 'Golden Bamboo',
        assetPath: '/assets/games/fortune_tiger/symbols/bamboo.png',
        weight: 14,
        payouts: { 3: 12, 4: 48, 5: 240 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'eye',
        name: 'Tiger Eye Gem',
        assetPath: '/assets/games/fortune_tiger/symbols/eye.png',
        weight: 14,
        payouts: { 3: 10, 4: 40, 5: 200 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'coin',
        name: 'Lucky Coin',
        assetPath: '/assets/games/fortune_tiger/symbols/coin.png',
        weight: 15,
        payouts: { 3: 8, 4: 32, 5: 160 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'scroll',
        name: 'Prosperity Scroll',
        assetPath: '/assets/games/fortune_tiger/symbols/scroll.png',
        weight: 15,
        payouts: { 3: 6, 4: 24, 5: 120 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'lantern',
        name: 'Red Lantern',
        assetPath: '/assets/games/fortune_tiger/symbols/lantern.png',
        weight: 16,
        payouts: { 3: 4, 4: 16, 5: 80 },
        isWild: false,
        isScatter: false
      }
    ],
    bonusConfig: {
      type: 'free_spins',
      triggerSymbol: 'scatter_bonus',
      triggerCount: 3,
      freeSpinsCount: 8,
      mechanicBehavior: 'free-bet-random',
      freeBetChance: 0.05,
      details: '1 in 20 chance of a free spin on any spin'
    }
  },

  // ==================== IRONCLAD ====================

  steam_fortune: {
    id: 'steam_fortune',
    name: 'Steam Fortune',
    studio: 'ironclad',
    studioTheme: 'ironclad',
    assetPath: '/assets/games/steam_fortune',
    description: 'Progress along a jackpot trail to claim rewards',
    reels: 5,
    rows: 3,
    paylines: 20,
    rtp: 91.5,
    volatility: 'medium',
    mechanic: 'jackpot-trail',
    minBet: 0.10,
    maxBet: 10.00,
    symbols: [
      {
        id: 'wild',
        name: 'Wild',
        assetPath: '/assets/games/steam_fortune/symbols/wild.png',
        weight: 8,
        payouts: { 3: 0, 4: 0, 5: 0 },
        isWild: true,
        isScatter: false
      },
      {
        id: 'scatter_bonus',
        name: 'Bonus Scatter',
        assetPath: '/assets/games/steam_fortune/symbols/scatter.png',
        weight: 10,
        payouts: { 3: 8, 4: 40, 5: 160 },
        isWild: false,
        isScatter: true
      },
      {
        id: 'engine',
        name: 'Steam Engine',
        assetPath: '/assets/games/steam_fortune/symbols/engine.png',
        weight: 13,
        payouts: { 3: 15, 4: 60, 5: 300 },
        isWild: false,
        isScatter: false,
        trailValue: 3
      },
      {
        id: 'gear',
        name: 'Brass Gear',
        assetPath: '/assets/games/steam_fortune/symbols/gear.png',
        weight: 14,
        payouts: { 3: 12, 4: 48, 5: 240 },
        isWild: false,
        isScatter: false,
        trailValue: 2
      },
      {
        id: 'heart',
        name: 'Clockwork Heart',
        assetPath: '/assets/games/steam_fortune/symbols/heart.png',
        weight: 14,
        payouts: { 3: 10, 4: 40, 5: 200 },
        isWild: false,
        isScatter: false,
        trailValue: 2
      },
      {
        id: 'pipe',
        name: 'Copper Pipe',
        assetPath: '/assets/games/steam_fortune/symbols/pipe.png',
        weight: 15,
        payouts: { 3: 8, 4: 32, 5: 160 },
        isWild: false,
        isScatter: false,
        trailValue: 1
      },
      {
        id: 'gauge',
        name: 'Pressure Gauge',
        assetPath: '/assets/games/steam_fortune/symbols/gauge.png',
        weight: 15,
        payouts: { 3: 6, 4: 24, 5: 120 },
        isWild: false,
        isScatter: false,
        trailValue: 1
      },
      {
        id: 'whistle',
        name: 'Steam Whistle',
        assetPath: '/assets/games/steam_fortune/symbols/whistle.png',
        weight: 16,
        payouts: { 3: 4, 4: 16, 5: 80 },
        isWild: false,
        isScatter: false,
        trailValue: 1
      }
    ],
    bonusConfig: {
      type: 'free_spins',
      triggerSymbol: 'scatter_bonus',
      triggerCount: 3,
      freeSpinsCount: 10,
      mechanicBehavior: 'jackpot-trail-progressive',
      details: 'Advance 1-5 positions per special symbol during feature'
    }
  },

  brass_bandits: {
    id: 'brass_bandits',
    name: 'Brass Bandits',
    studio: 'ironclad',
    studioTheme: 'ironclad',
    assetPath: '/assets/games/brass_bandits',
    description: 'Top and bottom zones merge into a single megaboard',
    reels: 5,
    rows: 6,
    paylines: 20,
    rtp: 91.8,
    volatility: 'high',
    mechanic: 'dual-zone-reels',
    minBet: 0.10,
    maxBet: 10.00,
    symbols: [
      {
        id: 'wild',
        name: 'Wild',
        assetPath: '/assets/games/brass_bandits/symbols/wild.png',
        weight: 8,
        payouts: { 3: 0, 4: 0, 5: 0 },
        isWild: true,
        isScatter: false
      },
      {
        id: 'scatter_bonus',
        name: 'Bonus Scatter',
        assetPath: '/assets/games/brass_bandits/symbols/scatter.png',
        weight: 10,
        payouts: { 3: 10, 4: 50, 5: 200 },
        isWild: false,
        isScatter: true
      },
      {
        id: 'bandit',
        name: 'Brass Bandit',
        assetPath: '/assets/games/brass_bandits/symbols/bandit.png',
        weight: 11,
        payouts: { 3: 20, 4: 80, 5: 400 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'horse',
        name: 'Mechanical Horse',
        assetPath: '/assets/games/brass_bandits/symbols/horse.png',
        weight: 12,
        payouts: { 3: 15, 4: 60, 5: 300 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'pistol',
        name: 'Steam Pistol',
        assetPath: '/assets/games/brass_bandits/symbols/pistol.png',
        weight: 13,
        payouts: { 3: 12, 4: 48, 5: 240 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'badge',
        name: 'Gear Badge',
        assetPath: '/assets/games/brass_bandits/symbols/badge.png',
        weight: 14,
        payouts: { 3: 10, 4: 40, 5: 200 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'loot',
        name: 'Copper Loot',
        assetPath: '/assets/games/brass_bandits/symbols/loot.png',
        weight: 15,
        payouts: { 3: 8, 4: 32, 5: 160 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'mask',
        name: 'Iron Mask',
        assetPath: '/assets/games/brass_bandits/symbols/mask.png',
        weight: 16,
        payouts: { 3: 6, 4: 24, 5: 120 },
        isWild: false,
        isScatter: false
      }
    ],
    bonusConfig: {
      type: 'free_spins',
      triggerSymbol: 'scatter_bonus',
      triggerCount: 3,
      freeSpinsCount: 12,
      mechanicBehavior: 'dual-zone-merge',
      details: 'Top and bottom zones merge into single 5x6 megaboard during feature'
    }
  },

  corsair_cove: {
    id: 'corsair_cove',
    name: 'Corsair Cove',
    studio: 'ironclad',
    studioTheme: 'ironclad',
    assetPath: '/assets/games/corsair_cove',
    description: 'Wilds expand to fill entire reels during free spins',
    reels: 5,
    rows: 3,
    paylines: 20,
    rtp: 92.0,
    volatility: 'high',
    mechanic: 'expanding-wilds',
    minBet: 0.10,
    maxBet: 10.00,
    symbols: [
      {
        id: 'wild',
        name: 'Wild',
        assetPath: '/assets/games/corsair_cove/symbols/wild.png',
        weight: 8,
        payouts: { 3: 0, 4: 0, 5: 0 },
        isWild: true,
        isScatter: false
      },
      {
        id: 'scatter_bonus',
        name: 'Bonus Scatter',
        assetPath: '/assets/games/corsair_cove/symbols/scatter.png',
        weight: 10,
        payouts: { 3: 10, 4: 50, 5: 200 },
        isWild: false,
        isScatter: true
      },
      {
        id: 'ship',
        name: 'Corsair Ship',
        assetPath: '/assets/games/corsair_cove/symbols/ship.png',
        weight: 12,
        payouts: { 3: 15, 4: 60, 5: 300 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'map',
        name: 'Treasure Map',
        assetPath: '/assets/games/corsair_cove/symbols/map.png',
        weight: 13,
        payouts: { 3: 12, 4: 48, 5: 240 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'doubloon',
        name: 'Golden Doubloon',
        assetPath: '/assets/games/corsair_cove/symbols/doubloon.png',
        weight: 14,
        payouts: { 3: 10, 4: 40, 5: 200 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'cutlass',
        name: 'Cutlass',
        assetPath: '/assets/games/corsair_cove/symbols/cutlass.png',
        weight: 15,
        payouts: { 3: 8, 4: 32, 5: 160 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'parrot',
        name: 'Parrot',
        assetPath: '/assets/games/corsair_cove/symbols/parrot.png',
        weight: 15,
        payouts: { 3: 6, 4: 24, 5: 120 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'flag',
        name: 'Skull Flag',
        assetPath: '/assets/games/corsair_cove/symbols/flag.png',
        weight: 13,
        payouts: { 3: 4, 4: 16, 5: 80 },
        isWild: false,
        isScatter: false
      }
    ],
    bonusConfig: {
      type: 'free_spins',
      triggerSymbol: 'scatter_bonus',
      triggerCount: 3,
      freeSpinsCount: 10,
      mechanicBehavior: 'expanding-wilds-guaranteed',
      details: '2 expanding wilds guaranteed per free spin'
    }
  },

  // ==================== CASCADE LABS ====================

  prism_burst: {
    id: 'prism_burst',
    name: 'Prism Burst',
    studio: 'cascade_labs',
    studioTheme: 'cascadeLabs',
    assetPath: '/assets/games/prism_burst',
    description: 'Connected matching symbols in any direction count as a win',
    reels: 7,
    rows: 7,
    paylines: 0,
    rtp: 92.0,
    volatility: 'medium',
    mechanic: 'symbol-chain',
    minBet: 0.10,
    maxBet: 10.00,
    symbols: [
      {
        id: 'wild',
        name: 'Wild',
        assetPath: '/assets/games/prism_burst/symbols/wild.png',
        weight: 8,
        payouts: { 3: 0, 4: 0, 5: 0 },
        isWild: true,
        isScatter: false
      },
      {
        id: 'scatter_bonus',
        name: 'Bonus Scatter',
        assetPath: '/assets/games/prism_burst/symbols/scatter.png',
        weight: 10,
        payouts: { 2: 5, 3: 25, 4: 100 },
        isWild: false,
        isScatter: true
      },
      {
        id: 'crystal',
        name: 'Prism Crystal',
        assetPath: '/assets/games/prism_burst/symbols/crystal.png',
        weight: 13,
        payouts: { 4: 10, 5: 50, 6: 250, 7: 1000 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'rainbow',
        name: 'Rainbow Burst',
        assetPath: '/assets/games/prism_burst/symbols/rainbow.png',
        weight: 14,
        payouts: { 4: 12, 5: 60, 6: 300, 7: 1200 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'spectrum',
        name: 'Light Spectrum',
        assetPath: '/assets/games/prism_burst/symbols/spectrum.png',
        weight: 14,
        payouts: { 4: 10, 5: 50, 6: 250, 7: 1000 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'gem',
        name: 'Refraction Gem',
        assetPath: '/assets/games/prism_burst/symbols/gem.png',
        weight: 15,
        payouts: { 4: 8, 5: 40, 6: 200, 7: 800 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'beam',
        name: 'Aurora Beam',
        assetPath: '/assets/games/prism_burst/symbols/beam.png',
        weight: 15,
        payouts: { 4: 6, 5: 30, 6: 150, 7: 600 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'photon',
        name: 'Photon',
        assetPath: '/assets/games/prism_burst/symbols/photon.png',
        weight: 13,
        payouts: { 4: 4, 5: 20, 6: 100, 7: 400 },
        isWild: false,
        isScatter: false
      }
    ],
    bonusConfig: {
      type: 'free_spins',
      triggerSymbol: 'scatter_bonus',
      triggerCount: 3,
      freeSpinsCount: 10,
      mechanicBehavior: 'symbol-chain-reduced',
      details: 'Chain length minimum reduced to 3 symbols during free spins'
    }
  },

  gravity_wells: {
    id: 'gravity_wells',
    name: 'Gravity Wells',
    studio: 'cascade_labs',
    studioTheme: 'cascadeLabs',
    assetPath: '/assets/games/gravity_wells',
    description: 'Groups of 5+ adjacent symbols win and pull together',
    reels: 6,
    rows: 5,
    paylines: 0,
    rtp: 91.5,
    volatility: 'high',
    mechanic: 'cluster-pays',
    minBet: 0.10,
    maxBet: 10.00,
    symbols: [
      {
        id: 'wild',
        name: 'Wild',
        assetPath: '/assets/games/gravity_wells/symbols/wild.png',
        weight: 8,
        payouts: { 3: 0, 4: 0, 5: 0 },
        isWild: true,
        isScatter: false
      },
      {
        id: 'scatter_bonus',
        name: 'Bonus Scatter',
        assetPath: '/assets/games/gravity_wells/symbols/scatter.png',
        weight: 10,
        payouts: { 2: 5, 3: 25, 4: 100 },
        isWild: false,
        isScatter: true
      },
      {
        id: 'well',
        name: 'Gravity Well',
        assetPath: '/assets/games/gravity_wells/symbols/well.png',
        weight: 13,
        payouts: { 5: 20, 6: 100, 8: 500 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'rock',
        name: 'Floating Rock',
        assetPath: '/assets/games/gravity_wells/symbols/rock.png',
        weight: 14,
        payouts: { 5: 18, 6: 90, 8: 450 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'gem',
        name: 'Anti-Gravity Gem',
        assetPath: '/assets/games/gravity_wells/symbols/gem.png',
        weight: 14,
        payouts: { 5: 15, 6: 75, 8: 375 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'crystal',
        name: 'Zero-G Crystal',
        assetPath: '/assets/games/gravity_wells/symbols/crystal.png',
        weight: 15,
        payouts: { 5: 12, 6: 60, 8: 300 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'ring',
        name: 'Orbit Ring',
        assetPath: '/assets/games/gravity_wells/symbols/ring.png',
        weight: 15,
        payouts: { 5: 10, 6: 50, 8: 250 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'comet',
        name: 'Comet',
        assetPath: '/assets/games/gravity_wells/symbols/comet.png',
        weight: 13,
        payouts: { 5: 8, 6: 40, 8: 200 },
        isWild: false,
        isScatter: false
      }
    ],
    bonusConfig: {
      type: 'free_spins',
      triggerSymbol: 'scatter_bonus',
      triggerCount: 3,
      freeSpinsCount: 12,
      mechanicBehavior: 'gravity-enhanced',
      details: 'Gravity pulls symbols together for bigger clusters during free spins'
    }
  },

  chaos_theory: {
    id: 'chaos_theory',
    name: 'Chaos Theory',
    studio: 'cascade_labs',
    studioTheme: 'cascadeLabs',
    assetPath: '/assets/games/chaos_theory',
    description: 'Multiple winning ways expand dramatically during free spins',
    reels: 5,
    rows: 3,
    paylines: 243,
    rtp: 92.5,
    volatility: 'high',
    mechanic: 'multiway-pays',
    minBet: 0.10,
    maxBet: 10.00,
    symbols: [
      {
        id: 'wild',
        name: 'Wild',
        assetPath: '/assets/games/chaos_theory/symbols/wild.png',
        weight: 8,
        payouts: { 3: 0, 4: 0, 5: 0 },
        isWild: true,
        isScatter: false
      },
      {
        id: 'scatter_bonus',
        name: 'Bonus Scatter',
        assetPath: '/assets/games/chaos_theory/symbols/scatter.png',
        weight: 10,
        payouts: { 3: 12, 4: 60, 5: 240 },
        isWild: false,
        isScatter: true
      },
      {
        id: 'fractal',
        name: 'Chaos Fractal',
        assetPath: '/assets/games/chaos_theory/symbols/fractal.png',
        weight: 11,
        payouts: { 3: 20, 4: 80, 5: 400 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'butterfly',
        name: 'Butterfly Effect',
        assetPath: '/assets/games/chaos_theory/symbols/butterfly.png',
        weight: 12,
        payouts: { 3: 15, 4: 60, 5: 300 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'attractor',
        name: 'Strange Attractor',
        assetPath: '/assets/games/chaos_theory/symbols/attractor.png',
        weight: 13,
        payouts: { 3: 12, 4: 48, 5: 240 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'entropy',
        name: 'Entropy Crystal',
        assetPath: '/assets/games/chaos_theory/symbols/entropy.png',
        weight: 14,
        payouts: { 3: 10, 4: 40, 5: 200 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'dice',
        name: 'Quantum Dice',
        assetPath: '/assets/games/chaos_theory/symbols/dice.png',
        weight: 15,
        payouts: { 3: 8, 4: 32, 5: 160 },
        isWild: false,
        isScatter: false
      },
      {
        id: 'void',
        name: 'Void Sphere',
        assetPath: '/assets/games/chaos_theory/symbols/void.png',
        weight: 16,
        payouts: { 3: 6, 4: 24, 5: 120 },
        isWild: false,
        isScatter: false
      }
    ],
    bonusConfig: {
      type: 'free_spins',
      triggerSymbol: 'scatter_bonus',
      triggerCount: 3,
      freeSpinsCount: 15,
      mechanicBehavior: 'multiway-expanded',
      expandedWays: 1024,
      details: 'Ways increase to 1024 during free spins (from 243 base)'
    }
  }
};

// Export for use in CasinoEngine
if (typeof module !== 'undefined' && module.exports) {
  module.exports = NEW_GAME_CONFIGS;
}

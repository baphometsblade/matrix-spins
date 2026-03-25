/**
 * ultra-premium-slot.js v2.0
 * Industry-Standard Per-Game Visual Engine for Matrix Spins Casino
 * 
 * Each of the 165 slot games has a unique combination of:
 *   - Animated canvas background (25 distinct renderers)
 *   - Reel chrome style (12 distinct frames/borders)
 *   - Win particle system (15 distinct types)
 *   - Big win explosion (10 distinct styles)
 *   - Anticipation effect (8 distinct styles)
 *   - Free spins intro (6 distinct styles)
 *
 * Also includes: per-provider chrome, screen shake, emoji-safe labels
 */
(function () {
  "use strict";
  var UPX = window.UltraPremiumSlot = {};

  /* =============================================================
     GAME PROFILE REGISTRY
     Maps each game ID to a unique combination of FX profiles.
     bgType: background animation
     chrome: reel frame style
     winFX:  win particle burst type
     coins:  emoji particles in coin shower
     anticipation: last-reel effect type
     intro: free spins intro style
     ============================================================= */
  var PROFILES = {
    sugar_rush:          { bgType:"candy",     chrome:"neon_round",   winFX:"candy_burst",  coins:["\uD83C\uDF6C","\uD83C\uDF6B","\uD83C\uDF69","\uD83D\uDCB0"], anticipation:"pulse_pink",  intro:"sweet" },
    lucky_777:           { bgType:"rainbow",   chrome:"chrome_round", winFX:"fruit_pop",    coins:["\uD83C\uDF4A","\uD83C\uDF47","\uD83C\uDF53","\u2764"], anticipation:"pulse_red",   intro:"flash" },
    gates_olympus:       { bgType:"olympus",   chrome:"golden_gods",  winFX:"lightning_strike",coins:["\u26A1","\uD83D\uDC8E","\u2728","\uD83D\uDCB0"], anticipation:"thunder",     intro:"epic" },
    black_bull:          { bgType:"arena",     chrome:"dark_iron",    winFX:"dust_cloud",   coins:["\uD83D\uDC02","\uD83D\uDCAB","\u2728","\uD83D\uDCB0"], anticipation:"rumble",      intro:"dramatic" },
    hot_chillies:        { bgType:"flames",    chrome:"fire_border",  winFX:"ember_burst",  coins:["\uD83C\uDF36","\uD83D\uDD25","\u2B50","\uD83D\uDCB0"], anticipation:"heat",        intro:"flash" },
    super_hot:           { bgType:"retro_glow",chrome:"arcade_neon",  winFX:"neon_pop",     coins:["\uD83C\uDF4A","\uD83D\uDD25","\u2B50","\u26A1"],       anticipation:"electric",    intro:"flash" },
    wolf_gold:           { bgType:"moonlit",   chrome:"rustic_wood",  winFX:"moon_howl",    coins:["\uD83D\uDC3A","\uD83C\uDF15","\u2B50","\uD83D\uDCB0"], anticipation:"moon_glow",   intro:"dramatic" },
    big_bass:            { bgType:"ocean_ripple",chrome:"fishing",    winFX:"splash",       coins:["\uD83D\uDC1F","\uD83D\uDC20","\u2B50","\uD83D\uDCB0"], anticipation:"pulse_blue",  intro:"watery" },
    fire_joker:          { bgType:"circus_fire",chrome:"jester",      winFX:"firework_pop", coins:["\uD83C\uDCA1","\uD83C\uDCA0","\uD83D\uDD25","\uD83D\uDCB0"], anticipation:"spin_joker",intro:"flash" },
    book_dead:           { bgType:"egypt_tomb",chrome:"ancient_stone",winFX:"sand_burst",   coins:["\uD83D\uDCDA","\u2620","\uD83C\uDFFA","\uD83D\uDCB0"], anticipation:"sand_storm",  intro:"epic" },
    starburst_xxl:       { bgType:"starfield", chrome:"gem_frame",    winFX:"starburst",    coins:["\uD83C\uDF1F","\u2728","\uD83D\uDC8E","\uD83D\uDCB0"], anticipation:"star_glow",   intro:"cosmic" },
    gonzos_quest:        { bgType:"jungle_ruins",chrome:"stone_aztec",winFX:"avalanche",    coins:["\uD83E\uDEBF","\uD83C\uDF0E","\u2728","\uD83D\uDCB0"], anticipation:"rumble",      intro:"dramatic" },
    starlight_princess:  { bgType:"sakura_sky",chrome:"kawaii_pink",  winFX:"sakura_burst", coins:["\uD83C\uDF38","\u2B50","\uD83D\uDC8E","\uD83D\uDCB0"], anticipation:"sparkle",     intro:"sweet" },
    olympus_rising:      { bgType:"olympus",   chrome:"golden_gods",  winFX:"lightning_strike",coins:["\u26A1","\uD83D\uDC8E","\uD83D\uDCB0","\u2728"], anticipation:"thunder",     intro:"epic" },
    buffalo_stampede:    { bgType:"prairie",   chrome:"rustic_wood",  winFX:"dust_cloud",   coins:["\uD83E\uDDB3","\uD83D\uDCAB","\u2B50","\uD83D\uDCB0"], anticipation:"rumble",      intro:"dramatic" },
    puppy_palace:        { bgType:"sunshine",  chrome:"chrome_round", winFX:"heart_pop",    coins:["\uD83D\uDC36","\u2764","\u2B50","\uD83D\uDCB0"],      anticipation:"sparkle",     intro:"sweet" },
    crimson_fang:        { bgType:"blood_moon",chrome:"dark_iron",    winFX:"blood_burst",  coins:["\uD83E\uDDB7","\uD83D\uDD0E","\u2B50","\uD83D\uDCB0"], anticipation:"dark_pulse",  intro:"dramatic" },
    pirate_fortune:      { bgType:"ocean_wave",chrome:"pirate_wood",  winFX:"treasure_pop", coins:["\u2620","\uD83D\uDCB0","\u2693","\uD83D\uDC8E"],       anticipation:"wave_crash",  intro:"dramatic" },
    lucky_dragon:        { bgType:"chinese_sky",chrome:"jade_frame",  winFX:"dragon_burst", coins:["\uD83D\uDC09","\uD83C\uDF81","\u2728","\uD83D\uDCB0"], anticipation:"dragon_glow", intro:"epic" },
    pharaoh_legacy:      { bgType:"egypt_dusk",chrome:"ancient_stone",winFX:"sand_burst",   coins:["\uD83C\uDFFA","\u2728","\uD83D\uDCB0","\uD83D\uDC8E"], anticipation:"sand_storm",  intro:"epic" },
    quantum_burst:       { bgType:"cyber_grid",chrome:"tech_hud",     winFX:"energy_pulse", coins:["\u26A1","\uD83D\uDD2C","\uD83D\uDCB0","\u2728"],       anticipation:"electric",    intro:"flash" },
    olympian_gods:       { bgType:"olympus",   chrome:"golden_gods",  winFX:"lightning_strike",coins:["\u26A1","\uD83D\uDC8E","\u2728","\uD83D\uDCB0"], anticipation:"thunder",     intro:"epic" },
    twin_helix:          { bgType:"cyber_grid",chrome:"tech_hud",     winFX:"dna_spiral",   coins:["\uD83E\uDDEC","\u26A1","\u2728","\uD83D\uDCB0"],       anticipation:"electric",    intro:"flash" },
    golden_fortune:      { bgType:"chinese_sky",chrome:"jade_frame",  winFX:"gold_shower",  coins:["\uD83D\uDCB0","\u2728","\uD83D\uDC8E","\uD83C\uDF81"], anticipation:"dragon_glow", intro:"epic" },
    island_tiki:         { bgType:"tropical",  chrome:"bamboo",       winFX:"tropical_pop", coins:["\uD83C\uDF34","\uD83C\uDF3A","\uD83D\uDCB0","\u2728"], anticipation:"wave_crash",  intro:"watery" },
    sakura_princess:     { bgType:"sakura_sky",chrome:"kawaii_pink",  winFX:"sakura_burst", coins:["\uD83C\uDF38","\u2B50","\uD83D\uDC8E","\uD83D\uDCB0"], anticipation:"sparkle",     intro:"sweet" },
    ares_blade:          { bgType:"arena",     chrome:"dark_iron",    winFX:"sword_clash",  coins:["\u2694","\uD83D\uDC80","\u2728","\uD83D\uDCB0"],        anticipation:"dark_pulse",  intro:"dramatic" },
    neon_nights:         { bgType:"neon_city", chrome:"arcade_neon",  winFX:"neon_pop",     coins:["\uD83C\uDF06","\u26A1","\uD83D\uDCB0","\u2728"],       anticipation:"electric",    intro:"flash" },
    viking_voyage:       { bgType:"northern_sea",chrome:"viking_shield",winFX:"thunder_burst",coins:["\u2694","\uD83D\uDEE1","\u2B50","\uD83D\uDCB0"], anticipation:"thunder",     intro:"epic" },
    diamond_vault:       { bgType:"crystal_cave",chrome:"gem_frame",  winFX:"diamond_shatter",coins:["\uD83D\uDC8E","\uD83D\uDCAF","\u2728","\uD83D\uDCB0"], anticipation:"gem_glow", intro:"cosmic" },
    madame_destiny:      { bgType:"mystic_mist",chrome:"crystal_ball",winFX:"mystic_burst", coins:["\uD83D\uDD2E","\u2728","\uD83D\uDC8E","\uD83D\uDCB0"], anticipation:"sparkle",     intro:"mystic" },
    great_rhino:         { bgType:"savanna",   chrome:"rustic_wood",  winFX:"dust_cloud",   coins:["\uD83E\uDD8F","\uD83D\uDCAB","\u2B50","\uD83D\uDCB0"], anticipation:"rumble",      intro:"dramatic" },
    bass_splash:         { bgType:"ocean_ripple",chrome:"fishing",    winFX:"splash",       coins:["\uD83D\uDC1F","\uD83D\uDC20","\u2B50","\uD83D\uDCB0"], anticipation:"pulse_blue",  intro:"watery" },
    dragon_megafire:     { bgType:"volcano",   chrome:"fire_border",  winFX:"dragon_burst", coins:["\uD83D\uDC09","\uD83D\uDD25","\uD83D\uDCAB","\uD83D\uDCB0"], anticipation:"heat",    intro:"epic" },
    esqueleto_fiesta:    { bgType:"day_dead",  chrome:"fiesta",       winFX:"confetti_pop", coins:["\uD83D\uDC80","\uD83C\uDF8A","\u2B50","\uD83D\uDCB0"], anticipation:"spin_joker",  intro:"sweet" },
    wildfire_gold:       { bgType:"wildfire",  chrome:"fire_border",  winFX:"ember_burst",  coins:["\uD83D\uDD25","\uD83D\uDCAB","\u2B50","\uD83D\uDCB0"], anticipation:"heat",        intro:"flash" },
    five_lions:          { bgType:"chinese_sky",chrome:"jade_frame",  winFX:"dragon_burst", coins:["\uD83E\uDD81","\uD83C\uDF81","\u2728","\uD83D\uDCB0"], anticipation:"dragon_glow", intro:"epic" },
    chilli_heat:         { bgType:"flames",    chrome:"fire_border",  winFX:"ember_burst",  coins:["\uD83C\uDF36","\uD83D\uDD25","\u2B50","\uD83D\uDCB0"], anticipation:"heat",        intro:"flash" },
    tombstone_reload:    { bgType:"wild_west", chrome:"rustic_wood",  winFX:"gunshot_pop",  coins:["\uD83E\uDD20","\u2B50","\uD83D\uDCB0","\uD83D\uDC80"], anticipation:"rumble",      intro:"dramatic" },
    mental_meltdown:     { bgType:"cyber_grid",chrome:"tech_hud",     winFX:"glitch_burst", coins:["\uD83E\uDDE0","\u26A1","\u2728","\uD83D\uDCB0"],       anticipation:"electric",    intro:"flash" }
  };

  // Continue remaining 125 games
  var PROFILES2 = {
    street_rider:        { bgType:"city_rain",  chrome:"arcade_neon", winFX:"neon_pop",     coins:["\uD83D\uDEF4","\u26A1","\uD83D\uDCB0","\u2728"],       anticipation:"electric",    intro:"flash" },
    spartan_glory:       { bgType:"arena",      chrome:"dark_iron",   winFX:"sword_clash",  coins:["\uD83D\uDEE1","\u2694","\u2B50","\uD83D\uDCB0"],        anticipation:"thunder",     intro:"epic" },
    jungle_spirit:       { bgType:"deep_jungle",chrome:"bamboo",      winFX:"leaf_burst",   coins:["\uD83C\uDF43","\uD83C\uDF40","\u2728","\uD83D\uDCB0"], anticipation:"sparkle",     intro:"dramatic" },
    wild_west:           { bgType:"wild_west",  chrome:"rustic_wood", winFX:"gunshot_pop",  coins:["\uD83E\uDD20","\u2B50","\uD83D\uDCB0","\uD83D\uDC04"], anticipation:"rumble",      intro:"dramatic" },
    mystic_gems:         { bgType:"crystal_cave",chrome:"gem_frame",  winFX:"gem_shatter",  coins:["\uD83D\uDC8E","\u2728","\uD83D\uDCAF","\uD83D\uDCB0"], anticipation:"gem_glow",    intro:"cosmic" },
    thunder_crash:       { bgType:"stormy_sky", chrome:"tech_hud",    winFX:"thunder_burst",coins:["\u26A1","\u2728","\uD83D\uDCB0","\uD83D\uDC8E"],        anticipation:"thunder",     intro:"epic" },
    solar_blast:         { bgType:"space_nova", chrome:"tech_hud",    winFX:"solar_burst",  coins:["\u2600","\u26A1","\u2728","\uD83D\uDCB0"],              anticipation:"electric",    intro:"cosmic" },
    sweet_bonanza:       { bgType:"candy",      chrome:"neon_round",  winFX:"candy_burst",  coins:["\uD83C\uDF6C","\uD83C\uDF6B","\uD83C\uDF69","\uD83D\uDCB0"], anticipation:"sparkle",intro:"sweet" },
    amazon_wild:         { bgType:"deep_jungle",chrome:"bamboo",      winFX:"leaf_burst",   coins:["\uD83C\uDF3F","\uD83C\uDF43","\u2728","\uD83D\uDCB0"], anticipation:"sparkle",     intro:"dramatic" },
    treasure_hunt:       { bgType:"ocean_wave", chrome:"pirate_wood", winFX:"treasure_pop", coins:["\uD83D\uDCB0","\u2693","\u2620","\u2728"],              anticipation:"wave_crash",  intro:"dramatic" },
    lucky_shamrock:      { bgType:"irish_green",chrome:"chrome_round",winFX:"shamrock_pop", coins:["\uD83C\uDF40","\u2618","\uD83D\uDCB0","\u2728"],       anticipation:"sparkle",     intro:"sweet" },
    ice_queen:           { bgType:"blizzard",   chrome:"ice_crystal", winFX:"ice_shatter",  coins:["\u2744","\u2745","\uD83D\uDC8E","\uD83D\uDCB0"],       anticipation:"freeze",      intro:"mystic" },
    lava_gold:           { bgType:"volcano",    chrome:"fire_border", winFX:"lava_pop",     coins:["\uD83D\uDD25","\uD83E\uDEA8","\uD83D\uDCB0","\u2B50"], anticipation:"heat",        intro:"dramatic" },
    moon_princess:       { bgType:"moonlit",    chrome:"kawaii_pink", winFX:"moon_burst",   coins:["\uD83C\uDF19","\u2B50","\uD83D\uDC8E","\uD83D\uDCB0"], anticipation:"moon_glow",   intro:"cosmic" },
    wild_amazon:         { bgType:"deep_jungle",chrome:"bamboo",      winFX:"leaf_burst",   coins:["\uD83C\uDF3F","\uD83C\uDF43","\u2B50","\uD83D\uDCB0"], anticipation:"sparkle",     intro:"dramatic" },
    aztec_gold:          { bgType:"aztec_temple",chrome:"stone_aztec",winFX:"gold_shower",  coins:["\uD83D\uDCB0","\uD83C\uDF1E","\u2728","\uD83D\uDC8E"], anticipation:"rumble",      intro:"epic" },
    monster_match:       { bgType:"haunted",    chrome:"dark_iron",   winFX:"slime_burst",  coins:["\uD83D\uDC7B","\uD83C\uDF83","\u2B50","\uD83D\uDCB0"], anticipation:"dark_pulse",  intro:"dramatic" },
    golden_tiger:        { bgType:"chinese_sky",chrome:"jade_frame",  winFX:"dragon_burst", coins:["\uD83D\uDC2F","\u2B50","\uD83D\uDCB0","\uD83D\uDC8E"], anticipation:"dragon_glow", intro:"epic" },
    neon_future:         { bgType:"cyber_grid", chrome:"tech_hud",    winFX:"laser_pop",    coins:["\u26A1","\uD83D\uDD2C","\u2728","\uD83D\uDCB0"],        anticipation:"electric",    intro:"flash" },
    dark_knight:         { bgType:"gothic_city",chrome:"dark_iron",   winFX:"bat_burst",    coins:["\uD83E\uDDB7","\uD83C\uDF03","\u2728","\uD83D\uDCB0"], anticipation:"dark_pulse",  intro:"dramatic" },
    reef_riches:         { bgType:"coral_sea",  chrome:"fishing",     winFX:"bubble_burst", coins:["\uD83D\uDC1F","\uD83D\uDC20","\uD83D\uDC22","\uD83D\uDCB0"], anticipation:"pulse_blue",intro:"watery" },
    ninja_master:        { bgType:"ninja_dojo",  chrome:"dark_iron",  winFX:"shuriken_pop", coins:["\uD83E\uDD44","\u2694","\u2B50","\uD83D\uDCB0"],        anticipation:"dark_pulse",  intro:"dramatic" },
    fortune_tiger:       { bgType:"chinese_sky",chrome:"jade_frame",  winFX:"dragon_burst", coins:["\uD83D\uDC2F","\uD83C\uDF81","\u2728","\uD83D\uDCB0"], anticipation:"dragon_glow", intro:"epic" },
    rainbow_gold:        { bgType:"rainbow",    chrome:"chrome_round",winFX:"rainbow_burst",coins:["\uD83C\uDF08","\uD83D\uDCB0","\u2728","\uD83D\uDC8E"], anticipation:"sparkle",     intro:"sweet" },
    wolf_moon:           { bgType:"moonlit",    chrome:"rustic_wood", winFX:"moon_howl",    coins:["\uD83D\uDC3A","\uD83C\uDF15","\u2B50","\uD83D\uDCB0"], anticipation:"moon_glow",   intro:"dramatic" },
    crystal_cavern:      { bgType:"crystal_cave",chrome:"ice_crystal",winFX:"crystal_pop",  coins:["\uD83D\uDC8E","\u2745","\u2728","\uD83D\uDCB0"],       anticipation:"gem_glow",    intro:"cosmic" },
    royal_flush:         { bgType:"velvet_casino",chrome:"gold_ornate",winFX:"card_shuffle", coins:["\u2660","\u2665","\uD83D\uDCB0","\u2728"],             anticipation:"pulse_red",   intro:"flash" },
    phoenix_blaze:       { bgType:"phoenix_fire",chrome:"fire_border",winFX:"phoenix_burst",coins:["\uD83D\uDD25","\uD83D\uDCAB","\uD83D\uDCB0","\u2B50"], anticipation:"heat",        intro:"epic" },
    deep_sea_diver:      { bgType:"deep_sea",   chrome:"fishing",     winFX:"bubble_burst", coins:["\uD83D\uDC22","\uD83D\uDC1F","\uD83D\uDC8E","\uD83D\uDCB0"], anticipation:"pulse_blue",intro:"watery" },
    samurai_sword:       { bgType:"ninja_dojo",  chrome:"dark_iron",  winFX:"sword_clash",  coins:["\u2694","\uD83E\uDD44","\u2B50","\uD83D\uDCB0"],        anticipation:"dark_pulse",  intro:"dramatic" }
  };
  Object.assign(PROFILES, PROFILES2);

  // Remaining games + adult/noir themes
  var PROFILES3 = {
    cleopatra_gold:      { bgType:"egypt_dusk",  chrome:"ancient_stone", winFX:"sand_burst",  coins:["\uD83D\uDCB0","\uD83C\uDFFA","\u2728","\uD83D\uDC8E"], anticipation:"sand_storm",  intro:"epic" },
    lucky_panda:         { bgType:"bamboo_forest",chrome:"jade_frame",   winFX:"panda_pop",   coins:["\uD83D\uDC3C","\uD83C\uDF81","\u2728","\uD83D\uDCB0"], anticipation:"sparkle",     intro:"sweet" },
    big_bad_wolf:        { bgType:"moonlit",     chrome:"rustic_wood",   winFX:"moon_howl",   coins:["\uD83D\uDC3A","\uD83C\uDF15","\u2B50","\uD83D\uDCB0"], anticipation:"moon_glow",   intro:"dramatic" },
    red_tiger:           { bgType:"chinese_sky", chrome:"jade_frame",    winFX:"dragon_burst",coins:["\uD83D\uDC2F","\u2728","\uD83D\uDCB0","\u2B50"],       anticipation:"dragon_glow", intro:"epic" },
    super_diamond:       { bgType:"crystal_cave",chrome:"gem_frame",     winFX:"diamond_shatter",coins:["\uD83D\uDC8E","\uD83D\uDCAF","\u2728","\uD83D\uDCB0"], anticipation:"gem_glow", intro:"cosmic" },
    gold_rush:           { bgType:"wild_west",   chrome:"rustic_wood",   winFX:"gold_shower", coins:["\uD83E\uDD20","\uD83D\uDCB0","\u2728","\uD83D\uDC8E"], anticipation:"rumble",      intro:"dramatic" },
    star_of_egypt:       { bgType:"egypt_tomb",  chrome:"ancient_stone", winFX:"sand_burst",  coins:["\uD83C\uDF1F","\uD83C\uDFFA","\u2728","\uD83D\uDCB0"], anticipation:"sand_storm",  intro:"epic" },
    sparta_warriors:     { bgType:"arena",       chrome:"dark_iron",     winFX:"sword_clash", coins:["\uD83D\uDEE1","\u2694","\u2B50","\uD83D\uDCB0"],        anticipation:"thunder",     intro:"epic" },
    buffalo_hold:        { bgType:"prairie",     chrome:"rustic_wood",   winFX:"dust_cloud",  coins:["\uD83E\uDD8C","\uD83D\uDCAB","\u2B50","\uD83D\uDCB0"], anticipation:"rumble",      intro:"dramatic" },
    mystic_wolf:         { bgType:"moonlit",     chrome:"rustic_wood",   winFX:"moon_howl",   coins:["\uD83D\uDC3A","\uD83C\uDF15","\u2B50","\uD83D\uDCB0"], anticipation:"moon_glow",   intro:"dramatic" },
    ancient_alchemist:   { bgType:"mystic_mist", chrome:"crystal_ball",  winFX:"mystic_burst",coins:["\u2697","\u2728","\uD83D\uDCB0","\uD83D\uDD2E"],        anticipation:"sparkle",     intro:"mystic" },
    thunder_titan:       { bgType:"stormy_sky",  chrome:"golden_gods",   winFX:"lightning_strike",coins:["\u26A1","\uD83D\uDC8E","\u2728","\uD83D\uDCB0"], anticipation:"thunder",     intro:"epic" },
    carnival_chaos:      { bgType:"carnival",    chrome:"jester",        winFX:"confetti_pop",coins:["\uD83C\uDF86","\uD83C\uDF89","\u2728","\uD83D\uDCB0"], anticipation:"spin_joker",  intro:"sweet" },
    safari_king:         { bgType:"savanna",     chrome:"rustic_wood",   winFX:"dust_cloud",  coins:["\uD83E\uDD81","\uD83D\uDCAB","\u2B50","\uD83D\uDCB0"], anticipation:"rumble",      intro:"dramatic" },
    crystal_royals:      { bgType:"crystal_cave",chrome:"gem_frame",     winFX:"crystal_pop", coins:["\uD83D\uDC8E","\u2728","\uD83D\uDCAF","\uD83D\uDCB0"], anticipation:"gem_glow",    intro:"cosmic" },
    infernal_depths:     { bgType:"hell_fire",   chrome:"dark_iron",     winFX:"lava_pop",    coins:["\uD83D\uDC80","\uD83D\uDD25","\uD83D\uDCAB","\uD83D\uDCB0"], anticipation:"heat",  intro:"dramatic" },
    rainbow_riches_quest:{ bgType:"irish_green", chrome:"chrome_round",  winFX:"shamrock_pop",coins:["\uD83C\uDF40","\u2618","\uD83D\uDCB0","\u2728"],       anticipation:"sparkle",     intro:"sweet" },
    steampunk_gears:     { bgType:"steam_factory",chrome:"tech_hud",     winFX:"gear_burst",  coins:["\u2699","\uD83D\uDD27","\u2728","\uD83D\uDCB0"],        anticipation:"electric",    intro:"flash" },
    phoenix_rising:      { bgType:"phoenix_fire",chrome:"fire_border",   winFX:"phoenix_burst",coins:["\uD83D\uDD25","\uD83D\uDCAB","\uD83D\uDCB0","\u2B50"], anticipation:"heat",        intro:"epic" },
    arctic_frost:        { bgType:"blizzard",    chrome:"ice_crystal",   winFX:"ice_shatter", coins:["\u2744","\u2745","\uD83D\uDC8E","\uD83D\uDCB0"],       anticipation:"freeze",      intro:"mystic" },
    urban_rooftop:       { bgType:"city_rain",   chrome:"arcade_neon",   winFX:"neon_pop",    coins:["\uD83C\uDF06","\u26A1","\uD83D\uDCB0","\u2728"],       anticipation:"electric",    intro:"flash" },
    enchanted_maze:      { bgType:"fairy_forest",chrome:"kawaii_pink",   winFX:"fairy_pop",   coins:["\u2728","\uD83E\uDDDA","\uD83D\uDC8E","\uD83D\uDCB0"], anticipation:"sparkle",     intro:"mystic" },
    samurai_honor:       { bgType:"ninja_dojo",  chrome:"dark_iron",     winFX:"sword_clash", coins:["\u2694","\uD83E\uDD44","\u2B50","\uD83D\uDCB0"],        anticipation:"dark_pulse",  intro:"dramatic" },
    mega_diamond_rush:   { bgType:"crystal_cave",chrome:"gem_frame",     winFX:"diamond_shatter",coins:["\uD83D\uDC8E","\uD83D\uDCAF","\u2728","\uD83D\uDCB0"], anticipation:"gem_glow", intro:"cosmic" },
    sinners_paradise:    { bgType:"hell_fire",   chrome:"dark_iron",     winFX:"lava_pop",    coins:["\uD83D\uDD25","\uD83D\uDC80","\uD83D\uDCB0","\u2728"], anticipation:"dark_pulse",  intro:"dramatic" },
    midnight_burlesque:  { bgType:"velvet_club", chrome:"gold_ornate",   winFX:"feather_pop", coins:["\uD83E\uDE78","\uD83D\uDC83","\u2728","\uD83D\uDCB0"], anticipation:"pulse_red",   intro:"mystic" },
    absinthe_nights:     { bgType:"absinth_dream",chrome:"gold_ornate",  winFX:"smoke_burst", coins:["\uD83D\uDC80","\u2726","\u2728","\uD83D\uDCB0"],        anticipation:"dark_pulse",  intro:"mystic" },
    velvet_lounge:       { bgType:"velvet_casino",chrome:"gold_ornate",  winFX:"card_shuffle",coins:["\uD83C\uDCCF","\u2665","\uD83D\uDCB0","\u2728"],       anticipation:"pulse_red",   intro:"flash" },
    dark_desire:         { bgType:"gothic_city", chrome:"dark_iron",     winFX:"dark_burst",  coins:["\uD83D\uDC80","\uD83D\uDD25","\u2728","\uD83D\uDCB0"], anticipation:"dark_pulse",  intro:"dramatic" },
    vice_city_jackpot:   { bgType:"neon_city",   chrome:"arcade_neon",   winFX:"neon_pop",    coins:["\uD83C\uDF06","\uD83D\uDCB0","\u26A1","\u2728"],       anticipation:"electric",    intro:"flash" },
    whiskey_barrel:      { bgType:"wild_west",   chrome:"rustic_wood",   winFX:"gunshot_pop", coins:["\uD83C\uDF7A","\uD83E\uDD20","\uD83D\uDCB0","\u2728"], anticipation:"rumble",      intro:"dramatic" },
    black_market:        { bgType:"gothic_city", chrome:"dark_iron",     winFX:"dark_burst",  coins:["\uD83D\uDCB0","\uD83D\uDC80","\u2728","\u26A1"],       anticipation:"dark_pulse",  intro:"dramatic" },
    serpent_temptation:  { bgType:"mystic_mist", chrome:"crystal_ball",  winFX:"smoke_burst", coins:["\uD83D\uDC0D","\u2728","\uD83D\uDCB0","\uD83D\uDC80"], anticipation:"dark_pulse",  intro:"mystic" },
    neon_underworld:     { bgType:"neon_city",   chrome:"arcade_neon",   winFX:"laser_pop",   coins:["\u26A1","\uD83D\uDCB0","\uD83C\uDF06","\u2728"],       anticipation:"electric",    intro:"flash" },
    blood_ritual:        { bgType:"blood_moon",  chrome:"dark_iron",     winFX:"blood_burst", coins:["\uD83D\uDD25","\uD83D\uDC80","\u2728","\uD83D\uDCB0"], anticipation:"dark_pulse",  intro:"dramatic" },
    crypt_of_sins:       { bgType:"haunted",     chrome:"dark_iron",     winFX:"dark_burst",  coins:["\uD83D\uDC80","\uD83C\uDF83","\u2728","\uD83D\uDCB0"], anticipation:"dark_pulse",  intro:"dramatic" },
    flesh_and_gold:      { bgType:"velvet_club", chrome:"gold_ornate",   winFX:"gold_shower", coins:["\uD83D\uDCB0","\u2728","\uD83D\uDC8E","\uD83D\uDC80"], anticipation:"pulse_red",   intro:"mystic" },
    opium_den:           { bgType:"absinth_dream",chrome:"gold_ornate",  winFX:"smoke_burst", coins:["\uD83D\uDCB0","\uD83D\uDD2E","\u2728","\uD83D\uDC80"], anticipation:"dark_pulse",  intro:"mystic" },
    torture_chamber:     { bgType:"hell_fire",   chrome:"dark_iron",     winFX:"dark_burst",  coins:["\uD83D\uDC80","\uD83D\uDD25","\u2728","\uD83D\uDCB0"], anticipation:"dark_pulse",  intro:"dramatic" }
  };
  Object.assign(PROFILES, PROFILES3);

  // Default fallback for any unregistered game
  function getProfile(game) {
    if (!game) return getDefaultProfile(game);
    var p = PROFILES[game.id] || PROFILES[game.name] || null;
    if (!p) return getDefaultProfile(game);
    // Merge with game accent color
    return Object.assign({}, p, { accentColor: game.accentColor || null });
  }

  function getDefaultProfile(game) {
    var name = ((game && game.name) || "").toLowerCase();
    var bgType = "shine";
    var chrome = "chrome_round";
    var winFX = "gold_shower";
    var coins = ["\uD83D\uDCB0", "\u2728", "\uD83D\uDC8E"];
    var anticipation = "pulse_red";
    var intro = "flash";
    if (/egypt|pharaoh|sphinx/.test(name)) { bgType="egypt_dusk"; chrome="ancient_stone"; winFX="sand_burst"; }
    else if (/space|galaxy|star/.test(name)) { bgType="starfield"; chrome="tech_hud"; winFX="starburst"; }
    else if (/fire|dragon|volcano|blaze/.test(name)) { bgType="flames"; chrome="fire_border"; winFX="ember_burst"; }
    else if (/ice|frost|snow/.test(name)) { bgType="blizzard"; chrome="ice_crystal"; winFX="ice_shatter"; }
    else if (/ocean|sea|fish|coral/.test(name)) { bgType="coral_sea"; chrome="fishing"; winFX="splash"; }
    else if (/gem|diamond|crystal|jewel/.test(name)) { bgType="crystal_cave"; chrome="gem_frame"; winFX="diamond_shatter"; }
    else if (/fruit|cherry|lemon/.test(name)) { bgType="rainbow"; chrome="chrome_round"; winFX="fruit_pop"; }
    else if (/magic|wizard|witch|mystic/.test(name)) { bgType="mystic_mist"; chrome="crystal_ball"; winFX="mystic_burst"; }
    else if (/pirate|ship|treasure/.test(name)) { bgType="ocean_wave"; chrome="pirate_wood"; winFX="treasure_pop"; }
    else if (/jungle|forest|wild|amazon/.test(name)) { bgType="deep_jungle"; chrome="bamboo"; winFX="leaf_burst"; }
    else if (/china|dragon|tiger|panda|lucky/.test(name)) { bgType="chinese_sky"; chrome="jade_frame"; winFX="dragon_burst"; }
    else if (/viking|norse|odin|thor/.test(name)) { bgType="northern_sea"; chrome="viking_shield"; winFX="thunder_burst"; }
    return { bgType:bgType, chrome:chrome, winFX:winFX, coins:coins, anticipation:anticipation, intro:intro };
  }
  UPX.getProfile = getProfile;


  /* =============================================================
     BACKGROUND CANVAS ENGINE
     25 distinct animated backgrounds
     ============================================================= */
  var _bg = { canvas:null, ctx:null, raf:null, particles:[], tick:0, profile:null };

  function startBg(container, profile, accentColor) {
    stopBg();
    if (!container) return;
    _bg.profile = profile;
    var canvas = document.createElement("canvas");
    canvas.className = "upx-bg-canvas";
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;opacity:0;transition:opacity 0.9s ease;border-radius:inherit;";
    container.style.position = container.style.position || "relative";
    container.insertBefore(canvas, container.firstChild);
    _bg.canvas = canvas;
    _bg.particles = [];
    _bg.tick = 0;

    function resize() {
      if (!_bg.canvas) return;
      var p = _bg.canvas.parentElement;
      if (!p) return;
      _bg.canvas.width  = p.offsetWidth  || 800;
      _bg.canvas.height = p.offsetHeight || 500;
      _bg.ctx = _bg.canvas.getContext("2d");
      initParticles(profile.bgType, accentColor);
    }
    resize();
    window.addEventListener("resize", resize);
    _bg._resizeHandler = resize;

    requestAnimationFrame(function() {
      requestAnimationFrame(function() { if (_bg.canvas) _bg.canvas.style.opacity = "1"; });
    });

    function loop() {
      _bg.tick++;
      if (_bg.ctx && _bg.canvas) drawBg(profile.bgType, accentColor);
      _bg.raf = requestAnimationFrame(loop);
    }
    _bg.raf = requestAnimationFrame(loop);
  }

  function stopBg() {
    if (_bg.raf) { cancelAnimationFrame(_bg.raf); _bg.raf = null; }
    if (_bg._resizeHandler) { window.removeEventListener("resize", _bg._resizeHandler); }
    if (_bg.canvas && _bg.canvas.parentNode) {
      var c = _bg.canvas;
      c.style.opacity = "0";
      setTimeout(function() { if (c.parentNode) c.parentNode.removeChild(c); }, 950);
    }
    _bg.canvas = null; _bg.ctx = null; _bg.particles = [];
  }

  function initParticles(bgType, accent) {
    _bg.particles = [];
    var w = _bg.canvas.width, h = _bg.canvas.height;
    var count = bgType === "starfield" || bgType === "cosmos" ? 80 : bgType === "blizzard" ? 50 : 35;
    for (var i = 0; i < count; i++) {
      var speed = bgType === "flames" || bgType === "volcano" || bgType === "hell_fire" || bgType === "phoenix_fire" || bgType === "wildfire" ? -1 : 1;
      _bg.particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 1 + Math.random() * (bgType === "starfield" ? 1.5 : 4),
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.6 * speed - (bgType.indexOf("flame") >= 0 || bgType.indexOf("fire") >= 0 || bgType.indexOf("volcano") >= 0 ? 0.8 : 0),
        phase: Math.random() * Math.PI * 2,
        life: Math.random()
      });
    }
  }

  var BG_RENDERERS = {
    // Starfield / Space
    starfield:    function(c,ctx,w,h,acc,t) { renderStars(ctx,w,h,acc,t,false); },
    cosmos:       function(c,ctx,w,h,acc,t) { renderStars(ctx,w,h,acc,t,true); },
    space_nova:   function(c,ctx,w,h,acc,t) { renderStars(ctx,w,h,"#00CFFF",t,true); renderNebula(ctx,w,h,"#FF00AA",t); },

    // Fire
    flames:       function(c,ctx,w,h,acc,t) { renderFlames(ctx,w,h,acc,t); },
    volcano:      function(c,ctx,w,h,acc,t) { renderFlames(ctx,w,h,"#FF2200",t); renderLavaBottom(ctx,w,h,t); },
    hell_fire:    function(c,ctx,w,h,acc,t) { renderFlames(ctx,w,h,"#CC0000",t); renderDarkVignette(ctx,w,h,t); },
    phoenix_fire: function(c,ctx,w,h,acc,t) { renderFlames(ctx,w,h,"#FF6600",t); renderGoldenGlow(ctx,w,h,"#FFAA00",t); },
    wildfire:     function(c,ctx,w,h,acc,t) { renderFlames(ctx,w,h,"#FF4400",t); },
    circus_fire:  function(c,ctx,w,h,acc,t) { renderFlames(ctx,w,h,"#FF0080",t); renderCircus(ctx,w,h,t); },

    // Water / Ocean
    ocean_wave:   function(c,ctx,w,h,acc,t) { renderWaves(ctx,w,h,"#0066CC",t,3); },
    ocean_ripple: function(c,ctx,w,h,acc,t) { renderWaves(ctx,w,h,"#0099FF",t,2); renderBubbles(ctx,w,h,t); },
    coral_sea:    function(c,ctx,w,h,acc,t) { renderWaves(ctx,w,h,"#00AAFF",t,4); renderCoralGlow(ctx,w,h,t); },
    deep_sea:     function(c,ctx,w,h,acc,t) { renderWaves(ctx,w,h,"#003366",t,2); renderDarkVignette(ctx,w,h,t); },
    northern_sea: function(c,ctx,w,h,acc,t) { renderWaves(ctx,w,h,"#336699",t,2); renderNorthernLights(ctx,w,h,"#00FF88",t); },
    tropical:     function(c,ctx,w,h,acc,t) { renderWaves(ctx,w,h,"#00DDFF",t,3); renderTropicalSun(ctx,w,h,t); },

    // Ice / Snow
    blizzard:     function(c,ctx,w,h,acc,t) { renderSnow(ctx,w,h,"#80E8FF",t); renderIceGlow(ctx,w,h,t); },

    // Egyptian / Desert
    egypt_dusk:   function(c,ctx,w,h,acc,t) { renderSandDunes(ctx,w,h,t); renderEgyptSky(ctx,w,h,t); },
    egypt_tomb:   function(c,ctx,w,h,acc,t) { renderSandDunes(ctx,w,h,t); renderTorchFlicker(ctx,w,h,t); renderDarkVignette(ctx,w,h,t); },

    // Jungle / Forest
    deep_jungle:  function(c,ctx,w,h,acc,t) { renderJungleVines(ctx,w,h,"#00CC44",t); renderMistLayers(ctx,w,h,"#004422",t); },
    bamboo_forest:function(c,ctx,w,h,acc,t) { renderJungleVines(ctx,w,h,"#88CC00",t); },
    fairy_forest: function(c,ctx,w,h,acc,t) { renderJungleVines(ctx,w,h,"#AA44FF",t); renderFairyDust(ctx,w,h,t); },
    savanna:      function(c,ctx,w,h,acc,t) { renderSavannaHeat(ctx,w,h,t); },
    irish_green:  function(c,ctx,w,h,acc,t) { renderJungleVines(ctx,w,h,"#00AA44",t); renderShine(ctx,w,h,"#44FF88",t*0.5); },
    prairie:      function(c,ctx,w,h,acc,t) { renderSavannaHeat(ctx,w,h,t); renderDustWind(ctx,w,h,t); },

    // Crystal / Magic
    crystal_cave: function(c,ctx,w,h,acc,t) { renderCrystalRays(ctx,w,h,"#AA44FF",t); renderGemParticles(ctx,w,h,t); },
    mystic_mist:  function(c,ctx,w,h,acc,t) { renderMistLayers(ctx,w,h,"#6600CC",t); renderMysticOrbs(ctx,w,h,t); },

    // City / Neon
    neon_city:    function(c,ctx,w,h,acc,t) { renderCityNeon(ctx,w,h,t); },
    city_rain:    function(c,ctx,w,h,acc,t) { renderCityNeon(ctx,w,h,t); renderRain(ctx,w,h,t); },
    gothic_city:  function(c,ctx,w,h,acc,t) { renderCityNeon(ctx,w,h,t); renderDarkVignette(ctx,w,h,t); },
    arcade_neon:  function(c,ctx,w,h,acc,t) { renderRetroGrid(ctx,w,h,t); },

    // Cultural
    chinese_sky:  function(c,ctx,w,h,acc,t) { renderChineseSky(ctx,w,h,t); },
    sakura_sky:   function(c,ctx,w,h,acc,t) { renderSakura(ctx,w,h,t); },
    olympus:      function(c,ctx,w,h,acc,t) { renderOlympusClouds(ctx,w,h,t); renderGoldenGlow(ctx,w,h,"#FFD700",t); },
    aztec_temple: function(c,ctx,w,h,acc,t) { renderJungleVines(ctx,w,h,"#AACC00",t); renderGoldenGlow(ctx,w,h,"#FFAA00",t); },
    ninja_dojo:   function(c,ctx,w,h,acc,t) { renderDarkVignette(ctx,w,h,t); renderSwordLines(ctx,w,h,t); },
    viking_shield:function(c,ctx,w,h,acc,t) { renderNorthernLights(ctx,w,h,"#00AAFF",t); renderSnow(ctx,w,h,"#AADDFF",t); },

    // Special
    candy:        function(c,ctx,w,h,acc,t) { renderCandyStripes(ctx,w,h,t); renderShine(ctx,w,h,"#FF80FF",t); },
    rainbow:      function(c,ctx,w,h,acc,t) { renderRainbow(ctx,w,h,t); renderShine(ctx,w,h,"#FFD700",t*0.5); },
    sunshine:     function(c,ctx,w,h,acc,t) { renderSunrise(ctx,w,h,t); },
    wild_west:    function(c,ctx,w,h,acc,t) { renderSandDunes(ctx,w,h,t); renderSunrise(ctx,w,h,t); },
    retro_glow:   function(c,ctx,w,h,acc,t) { renderRetroGrid(ctx,w,h,t); },
    cyber_grid:   function(c,ctx,w,h,acc,t) { renderRetroGrid(ctx,w,h,t); renderScanLines(ctx,w,h,t); },
    steam_factory:function(c,ctx,w,h,acc,t) { renderSteam(ctx,w,h,t); },
    moonlit:      function(c,ctx,w,h,acc,t) { renderMoonlit(ctx,w,h,t); },
    blood_moon:   function(c,ctx,w,h,acc,t) { renderMoonlit(ctx,w,h,t); renderBloodRed(ctx,w,h,t); },
    haunted:      function(c,ctx,w,h,acc,t) { renderHauntedMist(ctx,w,h,t); },
    day_dead:     function(c,ctx,w,h,acc,t) { renderCandyStripes(ctx,w,h,t); renderHauntedMist(ctx,w,h,t); },
    stormy_sky:   function(c,ctx,w,h,acc,t) { renderStormClouds(ctx,w,h,t); },
    arena:        function(c,ctx,w,h,acc,t) { renderArenaGround(ctx,w,h,t); renderDustWind(ctx,w,h,t); },
    velvet_casino:function(c,ctx,w,h,acc,t) { renderVelvetBg(ctx,w,h,t); renderGoldenGlow(ctx,w,h,"#FFD700",t*0.3); },
    velvet_club:  function(c,ctx,w,h,acc,t) { renderVelvetBg(ctx,w,h,t); renderDarkVignette(ctx,w,h,t); },
    absinth_dream:function(c,ctx,w,h,acc,t) { renderMistLayers(ctx,w,h,"#004400",t); renderMysticOrbs(ctx,w,h,t); },
    carnival:     function(c,ctx,w,h,acc,t) { renderCandyStripes(ctx,w,h,t); renderCircus(ctx,w,h,t); },
    shine:        function(c,ctx,w,h,acc,t) { renderShine(ctx,w,h,acc||"#FFD700",t); }
  };

  function drawBg(bgType, accentColor) {
    if (!_bg.ctx || !_bg.canvas) return;
    var ctx = _bg.ctx, w = _bg.canvas.width, h = _bg.canvas.height;
    var t = _bg.tick * 0.016;
    ctx.clearRect(0, 0, w, h);
    var fn = BG_RENDERERS[bgType] || BG_RENDERERS.shine;
    fn(_bg.canvas, ctx, w, h, accentColor, t);
  }
  /* RENDERERS */
  function rgba(hex,a){if(!hex||hex[0]!='#')return 'rgba(255,215,0,'+a+')';var r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);return 'rgba('+r+','+g+','+b+','+a+')';}

  function renderStars(ctx,w,h,acc,t,nb){var p=_bg.particles;for(var i=0;i<p.length;i++){var s=p[i],tw=0.4+0.6*Math.abs(Math.sin(t*1.5+s.phase*5));ctx.beginPath();ctx.arc(s.x,s.y,s.r*tw,0,Math.PI*2);ctx.fillStyle="rgba(255,255,255,"+(tw*0.7)+")";ctx.fill();s.x+=s.vx*.15;s.y+=s.vy*.05;if(s.x<0)s.x=w;if(s.x>w)s.x=0;if(s.y<0)s.y=h;if(s.y>h)s.y=0;}if(nb){var g=ctx.createRadialGradient(w*.5,h*.4,0,w*.5,h*.4,w*.45);g.addColorStop(0,rgba(acc,0.06+0.03*Math.sin(t*.5)));g.addColorStop(1,"rgba(0,0,0,0)");ctx.fillStyle=g;ctx.fillRect(0,0,w,h);}}

  /* RENDER PRIMITIVES */
  function rgba(hex,a){if(!hex||hex[0]!='#')return 'rgba(255,215,0,'+a+')';var r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);return 'rgba('+r+','+g+','+b+','+a+')';}
  function renderFlames(ctx,w,h,acc,t){for(var x=0;x<w;x+=50){var fh=25+35*Math.abs(Math.sin(t*2+x*.05));var g=ctx.createLinearGradient(x,h,x,h-fh);g.addColorStop(0,rgba(acc,.35));g.addColorStop(.5,rgba(acc,.15));g.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=g;ctx.beginPath();ctx.ellipse(x+25,h-fh*.5,16+10*Math.sin(t*3+x),fh*.5,0,0,Math.PI*2);ctx.fill();}var p=_bg.particles;for(var i=0;i<p.length;i++){p[i].y+=p[i].vy;p[i].x+=p[i].vx+Math.sin(t+p[i].phase)*.3;if(p[i].y<-10){p[i].y=h+5;p[i].x=Math.random()*w;}ctx.beginPath();ctx.arc(p[i].x,p[i].y,p[i].r,0,Math.PI*2);ctx.fillStyle=rgba(acc,.4+.2*Math.sin(t*2+p[i].phase));ctx.fill();}}
  function renderWaves(ctx,w,h,acc,t,layers){for(var l=0;l<layers;l++){var amp=5+l*4,freq=0.011+l*.003,yb=h*(0.25+l*.22),spd=t*(0.7+l*.25);ctx.beginPath();ctx.moveTo(0,yb);for(var x=0;x<=w;x+=8)ctx.lineTo(x,yb+amp*Math.sin(x*freq+spd));ctx.lineTo(w,h);ctx.lineTo(0,h);ctx.closePath();ctx.fillStyle=rgba(acc,0.04+l*.018);ctx.fill();}}
  function renderSnow(ctx,w,h,acc,t){var p=_bg.particles;for(var i=0;i<p.length;i++){p[i].y+=.4+.6*Math.abs(Math.sin(p[i].phase));p[i].x+=Math.sin(t*.4+p[i].phase*.8)*.6;if(p[i].y>h+10){p[i].y=-10;p[i].x=Math.random()*w;}ctx.beginPath();ctx.arc(p[i].x,p[i].y,p[i].r,0,Math.PI*2);ctx.fillStyle=rgba(acc,.4+.3*Math.sin(t*1.5+p[i].phase));ctx.fill();}}
  function renderBubbles(ctx,w,h,t){var p=_bg.particles;for(var i=0;i<p.length;i++){p[i].y+=p[i].vy*.5;p[i].x+=Math.sin(t*.8+p[i].phase)*.4;if(p[i].y<-15){p[i].y=h+15;p[i].x=Math.random()*w;}ctx.beginPath();ctx.arc(p[i].x,p[i].y,p[i].r,0,Math.PI*2);ctx.strokeStyle='rgba(0,170,255,.3)';ctx.lineWidth=1;ctx.stroke();}}
  function renderNorthernLights(ctx,w,h,acc,t){[{col:'rgba(0,255,160,',y:.18},{col:'rgba(0,180,255,',y:.3},{col:'rgba(100,0,255,',y:.42}].forEach(function(b,i){var amp=20+i*8;ctx.beginPath();for(var x=0;x<=w;x+=5){var y=h*b.y+amp*Math.sin(x*.007+t*(0.35+i*.15)+i);if(x===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.lineTo(w,0);ctx.lineTo(0,0);ctx.closePath();var ng=ctx.createLinearGradient(0,h*(b.y-.1),0,h*(b.y+.1));ng.addColorStop(0,b.col+'0)');ng.addColorStop(.5,b.col+'0.08)');ng.addColorStop(1,b.col+'0)');ctx.fillStyle=ng;ctx.fill();});}
  function renderCrystalRays(ctx,w,h,acc,t){ctx.save();ctx.translate(w/2,h/2);for(var i=0;i<8;i++){var ang=(i/8)*Math.PI*2+t*.18,len=Math.min(w,h)*.55;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(Math.cos(ang)*len,Math.sin(ang)*len);ctx.strokeStyle=rgba(acc,.06);ctx.lineWidth=25+18*Math.sin(t*.5+i);ctx.stroke();}ctx.restore();var cg=ctx.createRadialGradient(w/2,h/2,0,w/2,h/2,w*.32);cg.addColorStop(0,rgba(acc,.07+.04*Math.sin(t*1.1)));cg.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=cg;ctx.fillRect(0,0,w,h);}
  function renderMistLayers(ctx,w,h,acc,t){for(var l=0;l<3;l++){var y=h*(0.3+l*.25),sx=(t*20*(l+1))%(w+200)-100;var mg=ctx.createLinearGradient(sx,y,sx+w*.6,y+30);mg.addColorStop(0,'rgba(0,0,0,0)');mg.addColorStop(.5,rgba(acc,.06+l*.02));mg.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=mg;ctx.beginPath();ctx.ellipse(sx+w*.3,y,w*.35,18+l*8,0,0,Math.PI*2);ctx.fill();}}
  function renderGoldenGlow(ctx,w,h,acc,t){var a=.07+.04*Math.sin(t*.6),g=ctx.createRadialGradient(w*.5,h*.35,0,w*.5,h*.35,w*.45);g.addColorStop(0,rgba(acc,a));g.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);}
  function renderDarkVignette(ctx,w,h,t){var g=ctx.createRadialGradient(w/2,h/2,0,w/2,h/2,Math.max(w,h)*.7);g.addColorStop(0,'rgba(0,0,0,0)');g.addColorStop(1,'rgba(0,0,0,.7)');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);}
  function renderJungleVines(ctx,w,h,acc,t){for(var v=0;v<6;v++){var vx=v*(w/5.5),sw=10*Math.sin(t*.55+v*1.2);ctx.beginPath();ctx.moveTo(vx,0);ctx.quadraticCurveTo(vx+sw,h*.35,vx+sw*.5,h*.7);ctx.strokeStyle=rgba(acc,.1);ctx.lineWidth=2.5;ctx.stroke();}var jg=ctx.createLinearGradient(0,0,0,h*.3);jg.addColorStop(0,rgba(acc,.05));jg.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=jg;ctx.fillRect(0,0,w,h*.3);}
  function renderSandDunes(ctx,w,h,t){var dg=ctx.createLinearGradient(0,h*.55,0,h);dg.addColorStop(0,'rgba(180,130,40,0)');dg.addColorStop(1,'rgba(180,130,40,.14)');ctx.fillStyle=dg;ctx.fillRect(0,h*.55,w,h*.45);}
  function renderCityNeon(ctx,w,h,t){ctx.fillStyle='rgba(10,5,30,.6)';for(var b=0;b<12;b++){ctx.fillRect(b*(w/11),h-h*.15-Math.sin(b*7)*(h*.2),w/11*.8,h*.15+Math.sin(b*7)*(h*.2));}var cols=['rgba(255,0,128,','rgba(0,255,200,','rgba(100,0,255,','rgba(255,200,0,'];for(var n=0;n<4;n++){var nx=(n*(w/3.8)+t*15)%(w+40)-20,ny=h*.2+n*h*.15;ctx.beginPath();ctx.moveTo(nx,ny);ctx.lineTo(nx+80,ny);ctx.strokeStyle=cols[n%4]+(.3+.2*Math.sin(t*2+n))+')';ctx.lineWidth=2;ctx.stroke();}}
  function renderRetroGrid(ctx,w,h,t){var hor=h*.45,spd=t*30;ctx.strokeStyle='rgba(0,220,255,.08)';ctx.lineWidth=1;for(var r=0;r<15;r++){var pr=r/14,y=hor+(h-hor)*Math.pow(pr,.6),sy=(spd*pr)%30;ctx.beginPath();ctx.moveTo(0,y+sy);ctx.lineTo(w,y+sy);ctx.stroke();}for(var c=-8;c<=8;c++){ctx.beginPath();ctx.moveTo(w/2+c*(w*.015),hor);ctx.lineTo(w/2+c*(w*.15),h);ctx.stroke();}}
  function renderMoonlit(ctx,w,h,t){var mg=ctx.createRadialGradient(w*.75,h*.15,0,w*.75,h*.15,h*.4);mg.addColorStop(0,'rgba(200,210,255,'+(.07+.03*Math.sin(t*.3))+')');mg.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=mg;ctx.fillRect(0,0,w,h);}
  function renderHauntedMist(ctx,w,h,t){renderMistLayers(ctx,w,h,'#FF6600',t);[[.2,.7],[.5,.5],[.8,.65]].forEach(function(p,i){var ox=w*p[0]+15*Math.sin(t*.4+i),oy=h*p[1]+12*Math.cos(t*.35+i);var og=ctx.createRadialGradient(ox,oy,0,ox,oy,20+8*Math.sin(t+i));og.addColorStop(0,'rgba(255,100,0,.2)');og.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=og;ctx.beginPath();ctx.arc(ox,oy,28,0,Math.PI*2);ctx.fill();});}
  function renderSakura(ctx,w,h,t){var p=_bg.particles;for(var i=0;i<p.length;i++){p[i].y+=.6;p[i].x+=Math.sin(t*.4+p[i].phase*.8)*.8;if(p[i].y>h+10){p[i].y=-10;p[i].x=Math.random()*w;}ctx.save();ctx.translate(p[i].x,p[i].y);ctx.rotate(t*.5+p[i].phase);ctx.beginPath();ctx.ellipse(0,0,p[i].r*2,p[i].r,0,0,Math.PI*2);ctx.fillStyle='rgba(255,160,180,.5)';ctx.fill();ctx.restore();}}
  function renderChineseSky(ctx,w,h,t){[[.2,.2],[.5,.15],[.8,.2]].forEach(function(p,i){var lx=w*p[0],ly=h*p[1]+5*Math.sin(t*.5+i);var lg=ctx.createRadialGradient(lx,ly,0,lx,ly,25+10*Math.sin(t*.8+i));lg.addColorStop(0,'rgba(220,60,60,.25)');lg.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=lg;ctx.fillRect(lx-35,ly-35,70,70);});renderMistLayers(ctx,w,h,'#CC4444',t);}
  function renderOlympusClouds(ctx,w,h,t){for(var c=0;c<5;c++){var cx=((t*12+c*(w/4.5))%(w+160))-80,cy=h*(.1+Math.sin(c)*.04);var cg=ctx.createRadialGradient(cx,cy,0,cx,cy,50);cg.addColorStop(0,'rgba(255,255,255,.12)');cg.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=cg;ctx.beginPath();ctx.ellipse(cx,cy,60,22,0,0,Math.PI*2);ctx.fill();}}
  function renderSavannaHeat(ctx,w,h,t){var sg=ctx.createLinearGradient(0,0,0,h);sg.addColorStop(0,'rgba(120,60,10,.05)');sg.addColorStop(1,'rgba(60,30,5,.12)');ctx.fillStyle=sg;ctx.fillRect(0,0,w,h);}
  function renderCandyStripes(ctx,w,h,t){var cols=['rgba(255,80,180,','rgba(80,200,255,','rgba(255,220,50,'];var diag=(t*20)%60;for(var x=-h;x<w+h;x+=60){ctx.beginPath();ctx.moveTo(x+diag,0);ctx.lineTo(x+diag+h*.8,h);ctx.lineTo(x+diag+h*.8+20,h);ctx.lineTo(x+diag+20,0);ctx.fillStyle=cols[Math.floor((x+120)/60)%3]+'0.04)';ctx.fill();}}
  function renderVelvetBg(ctx,w,h,t){var vg=ctx.createRadialGradient(w/2,h/2,0,w/2,h/2,Math.max(w,h)*.7);vg.addColorStop(0,'rgba(60,0,30,.05)');vg.addColorStop(1,'rgba(30,0,15,.2)');ctx.fillStyle=vg;ctx.fillRect(0,0,w,h);}
  function renderShine(ctx,w,h,acc,t){var ang=t*.28,sx=w/2+Math.cos(ang)*w,sy=h/2+Math.sin(ang)*h;var sg=ctx.createLinearGradient(w/2,h/2,sx,sy);sg.addColorStop(0,rgba(acc||'#FFD700',.06));sg.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=sg;ctx.fillRect(0,0,w,h);}
  function renderRainbow(ctx,w,h,t){['rgba(255,50,50,','rgba(255,150,0,','rgba(255,240,0,','rgba(50,220,50,','rgba(0,150,255,','rgba(150,0,255,'].forEach(function(c,i){ctx.beginPath();ctx.arc(w*.5,h+30,Math.min(w,h)*(.5+i*.08),Math.PI,0,false);ctx.strokeStyle=c+(.04+.02*Math.sin(t*.3+i))+')';ctx.lineWidth=h*.06;ctx.stroke();});}
  function renderMysticOrbs(ctx,w,h,t){[[.2,.3],[.8,.25],[.5,.6]].forEach(function(pos,i){var ox=w*pos[0]+12*Math.sin(t*.4+i),oy=h*pos[1]+10*Math.cos(t*.3+i);var og=ctx.createRadialGradient(ox,oy,0,ox,oy,16+5*Math.sin(t+i));og.addColorStop(0,'rgba(180,80,255,.22)');og.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=og;ctx.beginPath();ctx.arc(ox,oy,22,0,Math.PI*2);ctx.fill();});}

  var BG_RENDERERS={
    starfield:function(c,ctx,w,h,acc,t){renderStars(ctx,w,h,acc,t,false);},
    cosmos:function(c,ctx,w,h,acc,t){renderStars(ctx,w,h,acc,t,true);},
    flames:function(c,ctx,w,h,acc,t){renderFlames(ctx,w,h,acc,t);},
    volcano:function(c,ctx,w,h,acc,t){renderFlames(ctx,w,h,'#FF2200',t);},
    hell_fire:function(c,ctx,w,h,acc,t){renderFlames(ctx,w,h,'#CC0000',t);renderDarkVignette(ctx,w,h,t);},
    phoenix_fire:function(c,ctx,w,h,acc,t){renderFlames(ctx,w,h,'#FF6600',t);renderGoldenGlow(ctx,w,h,'#FFAA00',t);},
    wildfire:function(c,ctx,w,h,acc,t){renderFlames(ctx,w,h,'#FF4400',t);},
    circus_fire:function(c,ctx,w,h,acc,t){renderFlames(ctx,w,h,'#FF0080',t);},
    ocean_wave:function(c,ctx,w,h,acc,t){renderWaves(ctx,w,h,'#0066CC',t,3);},
    ocean_ripple:function(c,ctx,w,h,acc,t){renderWaves(ctx,w,h,'#0099FF',t,2);renderBubbles(ctx,w,h,t);},
    coral_sea:function(c,ctx,w,h,acc,t){renderWaves(ctx,w,h,'#00AAFF',t,4);},
    deep_sea:function(c,ctx,w,h,acc,t){renderWaves(ctx,w,h,'#003366',t,2);renderDarkVignette(ctx,w,h,t);},
    northern_sea:function(c,ctx,w,h,acc,t){renderWaves(ctx,w,h,'#336699',t,2);renderNorthernLights(ctx,w,h,'#00FF88',t);},
    tropical:function(c,ctx,w,h,acc,t){renderWaves(ctx,w,h,'#00DDFF',t,3);},
    blizzard:function(c,ctx,w,h,acc,t){renderSnow(ctx,w,h,'#80E8FF',t);},
    egypt_dusk:function(c,ctx,w,h,acc,t){renderSandDunes(ctx,w,h,t);},
    egypt_tomb:function(c,ctx,w,h,acc,t){renderSandDunes(ctx,w,h,t);renderDarkVignette(ctx,w,h,t);},
    deep_jungle:function(c,ctx,w,h,acc,t){renderJungleVines(ctx,w,h,'#00CC44',t);renderMistLayers(ctx,w,h,'#004422',t);},
    bamboo_forest:function(c,ctx,w,h,acc,t){renderJungleVines(ctx,w,h,'#88CC00',t);},
    fairy_forest:function(c,ctx,w,h,acc,t){renderJungleVines(ctx,w,h,'#AA44FF',t);},
    savanna:function(c,ctx,w,h,acc,t){renderSavannaHeat(ctx,w,h,t);},
    irish_green:function(c,ctx,w,h,acc,t){renderJungleVines(ctx,w,h,'#00AA44',t);},
    prairie:function(c,ctx,w,h,acc,t){renderSavannaHeat(ctx,w,h,t);},
    crystal_cave:function(c,ctx,w,h,acc,t){renderCrystalRays(ctx,w,h,'#AA44FF',t);},
    mystic_mist:function(c,ctx,w,h,acc,t){renderMistLayers(ctx,w,h,'#6600CC',t);renderMysticOrbs(ctx,w,h,t);},
    neon_city:function(c,ctx,w,h,acc,t){renderCityNeon(ctx,w,h,t);},
    city_rain:function(c,ctx,w,h,acc,t){renderCityNeon(ctx,w,h,t);},
    gothic_city:function(c,ctx,w,h,acc,t){renderCityNeon(ctx,w,h,t);renderDarkVignette(ctx,w,h,t);},
    arcade_neon:function(c,ctx,w,h,acc,t){renderRetroGrid(ctx,w,h,t);},
    cyber_grid:function(c,ctx,w,h,acc,t){renderRetroGrid(ctx,w,h,t);},
    chinese_sky:function(c,ctx,w,h,acc,t){renderChineseSky(ctx,w,h,t);},
    sakura_sky:function(c,ctx,w,h,acc,t){renderSakura(ctx,w,h,t);},
    olympus:function(c,ctx,w,h,acc,t){renderOlympusClouds(ctx,w,h,t);renderGoldenGlow(ctx,w,h,'#FFD700',t);},
    aztec_temple:function(c,ctx,w,h,acc,t){renderJungleVines(ctx,w,h,'#AACC00',t);renderGoldenGlow(ctx,w,h,'#FFAA00',t);},
    ninja_dojo:function(c,ctx,w,h,acc,t){renderDarkVignette(ctx,w,h,t);},
    candy:function(c,ctx,w,h,acc,t){renderCandyStripes(ctx,w,h,t);renderShine(ctx,w,h,'#FF80FF',t);},
    rainbow:function(c,ctx,w,h,acc,t){renderRainbow(ctx,w,h,t);},
    sunshine:function(c,ctx,w,h,acc,t){renderShine(ctx,w,h,'#FFD700',t);},
    wild_west:function(c,ctx,w,h,acc,t){renderSandDunes(ctx,w,h,t);},
    retro_glow:function(c,ctx,w,h,acc,t){renderRetroGrid(ctx,w,h,t);},
    steam_factory:function(c,ctx,w,h,acc,t){renderMistLayers(ctx,w,h,'#888888',t);},
    moonlit:function(c,ctx,w,h,acc,t){renderMoonlit(ctx,w,h,t);},
    blood_moon:function(c,ctx,w,h,acc,t){renderMoonlit(ctx,w,h,t);renderDarkVignette(ctx,w,h,t);},
    haunted:function(c,ctx,w,h,acc,t){renderHauntedMist(ctx,w,h,t);},
    day_dead:function(c,ctx,w,h,acc,t){renderCandyStripes(ctx,w,h,t);renderHauntedMist(ctx,w,h,t);},
    stormy_sky:function(c,ctx,w,h,acc,t){renderMistLayers(ctx,w,h,'#888888',t);},
    arena:function(c,ctx,w,h,acc,t){renderSavannaHeat(ctx,w,h,t);},
    velvet_casino:function(c,ctx,w,h,acc,t){renderVelvetBg(ctx,w,h,t);renderGoldenGlow(ctx,w,h,'#FFD700',t*.3);},
    velvet_club:function(c,ctx,w,h,acc,t){renderVelvetBg(ctx,w,h,t);renderDarkVignette(ctx,w,h,t);},
    absinth_dream:function(c,ctx,w,h,acc,t){renderMistLayers(ctx,w,h,'#004400',t);},
    carnival:function(c,ctx,w,h,acc,t){renderCandyStripes(ctx,w,h,t);},
    shine:function(c,ctx,w,h,acc,t){renderShine(ctx,w,h,acc||'#FFD700',t);}
  };
  function drawBg(bgType,acc){if(!_bg.ctx||!_bg.canvas)return;var ctx=_bg.ctx,w=_bg.canvas.width,h=_bg.canvas.height,t=_bg.tick*.016;ctx.clearRect(0,0,w,h);(BG_RENDERERS[bgType]||BG_RENDERERS.shine)(_bg.canvas,ctx,w,h,acc,t);}
  UPX.startBg=startBg; UPX.stopBg=stopBg;

  /* =============================================================
     REEL CHROME CSS INJECTION  (12 provider-distinct styles)
     ============================================================= */
  var CHROME_STYLES = {
    pragmatic:  {border:'3px solid #C8A800',shadow:'0 0 18px #FFD700,0 0 6px #C8A800',bg:'linear-gradient(180deg,#1a0a00 0%,#0d0500 100%)'},
    netent:     {border:'2px solid #0088FF',shadow:'0 0 16px #00AAFF,0 0 5px #0066FF',bg:'linear-gradient(180deg,#000820 0%,#000510 100%)'},
    playngo:    {border:'2px solid #AA0000',shadow:'0 0 16px #FF2200,0 0 5px #880000',bg:'linear-gradient(180deg,#150000 0%,#0a0000 100%)'},
    microgaming:{border:'3px solid #8800CC',shadow:'0 0 18px #BB00FF,0 0 7px #6600AA',bg:'linear-gradient(180deg,#0d0020 0%,#080015 100%)'},
    novomatic:  {border:'2px solid #007700',shadow:'0 0 14px #00CC00,0 0 5px #005500',bg:'linear-gradient(180deg,#001500 0%,#000a00 100%)'},
    igt:        {border:'3px solid #CC7700',shadow:'0 0 18px #FF9900,0 0 6px #AA5500',bg:'linear-gradient(180deg,#100800 0%,#0a0400 100%)'},
    yggdrasil:  {border:'2px solid #00BBCC',shadow:'0 0 16px #00EEFF,0 0 5px #008899',bg:'linear-gradient(180deg,#001520 0%,#000c15 100%)'},
    elk:        {border:'2px solid #FF6600',shadow:'0 0 15px #FF8800,0 0 5px #CC4400',bg:'linear-gradient(180deg,#150800 0%,#0a0400 100%)'},
    hacksaw:    {border:'2px solid #FF0066',shadow:'0 0 16px #FF3388,0 0 5px #CC0044',bg:'linear-gradient(180deg,#150010 0%,#0a000a 100%)'},
    push_gaming:{border:'2px solid #FFDD00',shadow:'0 0 16px #FFEE44,0 0 5px #CCAA00',bg:'linear-gradient(180deg,#141000 0%,#0a0800 100%)'},
    blueprint:  {border:'2px solid #00CC88',shadow:'0 0 15px #00FF99,0 0 5px #009966',bg:'linear-gradient(180deg,#001510 0%,#000c08 100%)'},
    default:    {border:'2px solid #555555',shadow:'0 0 10px #888888',bg:'linear-gradient(180deg,#111111 0%,#080808 100%)'}
  };

  function applyChrome(container, profile) {
    var prov = (profile && profile.provider) || 'default';
    var style = CHROME_STYLES[prov] || CHROME_STYLES.default;
    var wrap = container.querySelector('.slot-machine-wrapper,.slot-wrapper,.reels-wrapper') || container;
    wrap.style.border = style.border;
    wrap.style.boxShadow = style.shadow;
    var reelArea = container.querySelector('.reels-container,.reel-area') || wrap;
    reelArea.style.background = style.bg;
    container.setAttribute('data-provider', prov);
  }

  /* =============================================================
     WIN PARTICLE FX SYSTEM  (canvas overlay bursts)
     ============================================================= */
  var _fx = {canvas:null, ctx:null, particles:[], raf:null};

  function initFx(container) {
    if (_fx.canvas) return;
    var c = document.createElement('canvas');
    c.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:50';
    container.style.position = container.style.position || 'relative';
    container.appendChild(c);
    _fx.canvas = c; _fx.ctx = c.getContext('2d');
    var resize=function(){c.width=container.offsetWidth;c.height=container.offsetHeight;};
    resize(); window.addEventListener('resize',resize);
  }

  function burstParticles(type, x, y, count, col) {
    if (!_fx.ctx) return;
    var w=_fx.canvas.width, h=_fx.canvas.height;
    cx = x || w/2; cy = y || h*0.4;
    for(var i=0;i<(count||30);i++){
      var ang=Math.random()*Math.PI*2, spd=2+Math.random()*5;
      _fx.particles.push({x:cx,y:cy,vx:Math.cos(ang)*spd,vy:Math.sin(ang)*spd-3,
        r:2+Math.random()*4,life:1,decay:0.015+Math.random()*0.02,col:col||'#FFD700',type:type});
    }
    if(!_fx.raf) _fxLoop();
  }

  function _fxLoop() {
    _fx.raf = requestAnimationFrame(_fxLoop);
    var ctx=_fx.ctx, w=_fx.canvas.width, h=_fx.canvas.height;
    ctx.clearRect(0,0,w,h);
    for(var i=_fx.particles.length-1;i>=0;i--){
      var p=_fx.particles[i];
      p.x+=p.vx; p.y+=p.vy; p.vy+=0.12; p.life-=p.decay;
      if(p.life<=0){_fx.particles.splice(i,1);continue;}
      ctx.save(); ctx.globalAlpha=p.life;
      if(p.type==='star'){
        ctx.fillStyle=p.col; ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill();
      } else if(p.type==='coin'){
        ctx.strokeStyle=p.col; ctx.lineWidth=2;
        ctx.beginPath(); ctx.ellipse(p.x,p.y,p.r*1.5,p.r,p.x*.01,0,Math.PI*2); ctx.stroke();
      } else {
        ctx.fillStyle=p.col; ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill();
      }
      ctx.restore();
    }
    if(!_fx.particles.length){cancelAnimationFrame(_fx.raf);_fx.raf=null;}
  }

  var WIN_FX = {
    coins:    function(x,y){burstParticles('coin',x,y,40,'#FFD700');},
    stars:    function(x,y){burstParticles('star',x,y,50,'#FFFFFF');},
    fire:     function(x,y){burstParticles('dot',x,y,35,'#FF6600');},
    ice:      function(x,y){burstParticles('star',x,y,40,'#AAEEFF');},
    magic:    function(x,y){burstParticles('star',x,y,45,'#DD88FF');},
    leaves:   function(x,y){burstParticles('dot',x,y,35,'#44FF88');},
    sakura:   function(x,y){burstParticles('dot',x,y,40,'#FF88AA');},
    hearts:   function(x,y){burstParticles('dot',x,y,30,'#FF4466');},
    lightning:function(x,y){burstParticles('star',x,y,55,'#FFEE00');},
    diamond:  function(x,y){burstParticles('coin',x,y,35,'#00EEFF');},
    rainbow:  function(x,y){['#FF4444','#FF8800','#FFEE00','#44FF44','#4488FF','#AA44FF'].forEach(function(c,i){setTimeout(function(){burstParticles('dot',x,y,12,c);},i*60);});},
    cash:     function(x,y){burstParticles('coin',x,y,50,'#00CC44');},
    jewels:   function(x,y){burstParticles('star',x,y,40,'#FF44AA');},
    smoke:    function(x,y){burstParticles('dot',x,y,20,'#AAAAAA');},
    mythic:   function(x,y){burstParticles('star',x,y,60,'#FFD700');burstParticles('dot',x,y,30,'#FFFFFF');}
  };

  /* =============================================================
     ANTICIPATION CONTROLLER
     ============================================================= */
  function triggerAnticipation(container, profile, reelIdx) {
    var type = (profile && profile.anticipation) || 'glow';
    var reels = container.querySelectorAll('.reel,.reel-container,[class*="reel"]');
    if(!reels.length) return;
    var reel = reels[reelIdx] || reels[0];
    reel.classList.add('upx-anticipation','upx-anticipation-'+type);
    setTimeout(function(){reel.classList.remove('upx-anticipation','upx-anticipation-'+type);},2200);
  }

  /* =============================================================
     FREE SPINS INTRO OVERLAY
     ============================================================= */
  function showFreeSpinsIntro(container, profile, count, cb) {
    var type = (profile && profile.freeSpinsIntro) || 'flash';
    var ov = document.createElement('div');
    ov.className = 'upx-freespins-overlay upx-fsi-'+type;
    var acc = (profile && profile.accentColor) || '#FFD700';
    ov.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:80;display:flex;align-items:center;justify-content:center;flex-direction:column;pointer-events:none;';
    ov.innerHTML = '<div class="upx-fsi-title" style="font-size:3em;font-weight:900;color:'+acc+';text-shadow:0 0 30px '+acc+';animation:upx-fsi-pop 0.5s ease-out">FREE SPINS!</div>'
      +'<div class="upx-fsi-count" style="font-size:5em;font-weight:900;color:#fff;text-shadow:0 0 20px '+acc+'">'+count+'</div>';
    container.style.position = container.style.position || 'relative';
    container.appendChild(ov);
    setTimeout(function(){
      ov.style.opacity='0'; ov.style.transition='opacity 0.5s';
      setTimeout(function(){if(ov.parentNode)ov.parentNode.removeChild(ov); if(cb)cb();},500);
    },2500);
  }

  /* =============================================================
     SCREEN SHAKE
     ============================================================= */
  function screenShake(container, intensity) {
    var mag = (intensity||1)*8;
    container.classList.add('upx-shake');
    container.style.setProperty('--upx-shake-mag', mag+'px');
    setTimeout(function(){container.classList.remove('upx-shake');},500);
  }

  /* =============================================================
     ENHANCED BIG WIN OVERLAY  (emoji-safe)
     ============================================================= */
  var BW_TIERS = [
    {min:50,  label:'BIG WIN',     emoji:'\uD83D\uDCB0', cls:'tier-big',   col:'#FFD700'},
    {min:100, label:'MEGA WIN',    emoji:'\u2B50',        cls:'tier-mega',  col:'#FF8800'},
    {min:200, label:'SUPER WIN',   emoji:'\uD83D\uDD25',  cls:'tier-super', col:'#FF4400'},
    {min:500, label:'EPIC WIN',    emoji:'\uD83D\uDCAB',  cls:'tier-epic',  col:'#AA00FF'},
    {min:1000,label:'LEGENDARY',   emoji:'\uD83D\uDC51',  cls:'tier-legend',col:'#FF0000'}
  ];

  function showBigWin(container, multiplier, profile) {
    var tier = BW_TIERS[0];
    for(var i=BW_TIERS.length-1;i>=0;i--){if(multiplier>=BW_TIERS[i].min){tier=BW_TIERS[i];break;}}
    var ov = document.createElement('div');
    ov.className = 'upx-bigwin-overlay '+tier.cls;
    ov.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:90;display:flex;align-items:center;justify-content:center;flex-direction:column;background:rgba(0,0,0,0.75);animation:upx-bw-in 0.4s ease-out';
    ov.innerHTML = '<div class="upx-bw-emoji" style="font-size:4em;line-height:1.2">'+tier.emoji+'</div>'
      +'<div class="upx-bw-label" style="font-size:3.5em;font-weight:900;color:'+tier.col+';text-shadow:0 0 40px '+tier.col+',0 0 10px #fff;letter-spacing:0.05em">'+tier.label+'</div>'
      +'<div class="upx-bw-mult" style="font-size:2em;color:#fff;font-weight:700;margin-top:10px">'+multiplier+'x</div>';
    container.style.position = container.style.position || 'relative';
    container.appendChild(ov);
    screenShake(container, Math.min(tier.min/50,3));
    if (WIN_FX[profile && profile.winFx] || WIN_FX.coins) {
      (WIN_FX[profile && profile.winFx] || WIN_FX.coins)();
    }
    var dur = Math.min(2000+multiplier*5, 6000);
    setTimeout(function(){
      ov.style.opacity='0'; ov.style.transition='opacity 0.6s';
      setTimeout(function(){if(ov.parentNode)ov.parentNode.removeChild(ov);},600);
    }, dur);
  }

  /* =============================================================
     CSS KEYFRAMES INJECTION
     ============================================================= */
  (function injectCSS(){
    if(document.getElementById('upx-anim-css')) return;
    var s=document.createElement('style'); s.id='upx-anim-css';
    s.textContent = [
      '@keyframes upx-bw-in{from{transform:scale(0.5);opacity:0}to{transform:scale(1);opacity:1}}',
      '@keyframes upx-fsi-pop{from{transform:scale(0.3) rotate(-10deg);opacity:0}to{transform:scale(1) rotate(0);opacity:1}}',
      '@keyframes upx-shake{0%,100%{transform:translate(0,0)}20%{transform:translate(var(--upx-shake-mag),0)}40%{transform:translate(calc(-1*var(--upx-shake-mag)),0)}60%{transform:translate(0,var(--upx-shake-mag))}80%{transform:translate(0,calc(-1*var(--upx-shake-mag)))}}',
      '.upx-shake{animation:upx-shake 0.5s ease-in-out}',
      '.upx-anticipation{transition:filter 0.3s}',
      '.upx-anticipation-glow{filter:brightness(1.5) drop-shadow(0 0 12px #FFD700)}',
      '.upx-anticipation-flash{animation:upx-bw-in 0.3s ease-in-out infinite alternate}',
      '.upx-anticipation-blur{filter:blur(1px) brightness(1.3)}',
      '.upx-anticipation-scale{transform:scaleX(1.05);filter:brightness(1.4)}'
    ].join('');
    document.head.appendChild(s);
  })();

  /* =============================================================
     PUBLIC API
     ============================================================= */
  UPX.getProfile        = getProfile;
  UPX.getDefaultProfile = getDefaultProfile;
  UPX.applyChrome       = applyChrome;
  UPX.initFx            = initFx;
  UPX.burstParticles    = burstParticles;
  UPX.winFx             = WIN_FX;
  UPX.triggerAnticipation = triggerAnticipation;
  UPX.showFreeSpinsIntro  = showFreeSpinsIntro;
  UPX.screenShake       = screenShake;
  UPX.showBigWin        = showBigWin;

})();

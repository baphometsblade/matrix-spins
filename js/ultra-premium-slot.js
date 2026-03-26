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
    sugar_rush:{ bgType:"candy",chrome:"kawaii_pink",winFX:"candy_burst",  coins:["\uD83C\uDF6C","\uD83C\uDF6B","\uD83C\uDF69","\uD83D\uDCB0"], anticipation:"pulse_pink",  intro:"sweet" },
    lucky_777:           { bgType:"rainbow",   chrome:"chrome_round", winFX:"fruit_pop",    coins:["\uD83C\uDF4A","\uD83C\uDF47","\uD83C\uDF53","\u2764"], anticipation:"pulse_red",   intro:"flash" },
    gates_olympus:       { bgType:"olympus",   chrome:"golden_gods",  winFX:"lightning_strike",coins:["\u26A1","\uD83D\uDC8E","\u2728","\uD83D\uDCB0"], anticipation:"thunder",     intro:"epic" },
    black_bull:          { bgType:"arena",     chrome:"dark_iron",    winFX:"dust_cloud",   coins:["\uD83D\uDC02","\uD83D\uDCAB","\u2728","\uD83D\uDCB0"], anticipation:"rumble",      intro:"dramatic" },
    hot_chillies:{ bgType:"flames",chrome:"fiesta",winFX:"firework_pop",  coins:["\uD83C\uDF36","\uD83D\uDD25","\u2B50","\uD83D\uDCB0"], anticipation:"heat",        intro:"flash" },
    super_hot:{ bgType:"retro_glow",chrome:"chrome_round",winFX:"firework_pop",     coins:["\uD83C\uDF4A","\uD83D\uDD25","\u2B50","\u26A1"],       anticipation:"electric",    intro:"flash" },
    wolf_gold:{ bgType:"moonlit",chrome:"dark_iron",winFX:"moon_burst",    coins:["\uD83D\uDC3A","\uD83C\uDF15","\u2B50","\uD83D\uDCB0"], anticipation:"moon_glow",   intro:"dramatic" },
    big_bass:{ bgType:"deep_sea",chrome:"fishing",winFX:"splash",       coins:["\uD83D\uDC1F","\uD83D\uDC20","\u2B50","\uD83D\uDCB0"], anticipation:"pulse_blue",  intro:"watery" },
    fire_joker:{ bgType:"circus_fire",chrome:"jester",winFX:"ember_burst", coins:["\uD83C\uDCA1","\uD83C\uDCA0","\uD83D\uDD25","\uD83D\uDCB0"], anticipation:"spin_joker",intro:"flash" },
    book_dead:           { bgType:"egypt_tomb",chrome:"ancient_stone",winFX:"sand_burst",   coins:["\uD83D\uDCDA","\u2620","\uD83C\uDFFA","\uD83D\uDCB0"], anticipation:"sand_storm",  intro:"epic" },
    starburst_xxl:       { bgType:"starfield", chrome:"gem_frame",    winFX:"starburst",    coins:["\uD83C\uDF1F","\u2728","\uD83D\uDC8E","\uD83D\uDCB0"], anticipation:"star_glow",   intro:"cosmic" },
    gonzos_quest:        { bgType:"jungle_ruins",chrome:"stone_aztec",winFX:"avalanche",    coins:["\uD83E\uDEBF","\uD83C\uDF0E","\u2728","\uD83D\uDCB0"], anticipation:"rumble",      intro:"dramatic" },
    starlight_princess:{ bgType:"cosmos",chrome:"kawaii_pink",winFX:"sakura_burst", coins:["\uD83C\uDF38","\u2B50","\uD83D\uDC8E","\uD83D\uDCB0"], anticipation:"sparkle",     intro:"sweet" },
    olympus_rising:{ bgType:"olympus",chrome:"golden_gods",winFX:"solar_burst",coins:["\u26A1","\uD83D\uDC8E","\uD83D\uDCB0","\u2728"], anticipation:"thunder",     intro:"epic" },
    buffalo_stampede:{ bgType:"stormy_sky",chrome:"rustic_wood",winFX:"dust_cloud",   coins:["\uD83E\uDDB3","\uD83D\uDCAB","\u2B50","\uD83D\uDCB0"], anticipation:"rumble",      intro:"wild" ,accentColor:"#CD853F"},
    puppy_palace:{ bgType:"rainbow",chrome:"chrome_round",winFX:"heart_pop",    coins:["\uD83D\uDC36","\u2764","\u2B50","\uD83D\uDCB0"],      anticipation:"sparkle",     intro:"sweet" ,accentColor:"#FFB6C1"},
    crimson_fang:{ bgType:"haunted",chrome:"dark_iron",winFX:"blood_burst",  coins:["\uD83E\uDDB7","\uD83D\uDD0E","\u2B50","\uD83D\uDCB0"], anticipation:"dark_pulse",  intro:"dramatic" },
    pirate_fortune:      { bgType:"ocean_wave",chrome:"pirate_wood",  winFX:"treasure_pop", coins:["\u2620","\uD83D\uDCB0","\u2693","\uD83D\uDC8E"],       anticipation:"pirate_warn",  intro:"pirate" ,accentColor:"#DEB887"},
    lucky_dragon:{ bgType:"chinese_sky",chrome:"gold_ornate",winFX:"lightning_strike", coins:["\uD83D\uDC09","\uD83C\uDF81","\u2728","\uD83D\uDCB0"], anticipation:"dragon_glow", intro:"epic" ,accentColor:"#FF6347"},
    pharaoh_legacy:{ bgType:"egypt_dusk",chrome:"gold_ornate",winFX:"gold_shower",   coins:["\uD83C\uDFFA","\u2728","\uD83D\uDCB0","\uD83D\uDC8E"], anticipation:"sand_storm",  intro:"epic" },
    quantum_burst:{ bgType:"cosmos",chrome:"tech_hud",winFX:"energy_pulse", coins:["\u26A1","\uD83D\uDD2C","\uD83D\uDCB0","\u2728"],       anticipation:"cosmic_hum",    intro:"cosmic" ,accentColor:"#7B68EE"},
    olympian_gods:{ bgType:"olympus",chrome:"gold_ornate",winFX:"thunder_burst",coins:["\u26A1","\uD83D\uDC8E","\u2728","\uD83D\uDCB0"], anticipation:"thunder",     intro:"epic" },
    twin_helix:          { bgType:"cyber_grid",chrome:"tech_hud",     winFX:"dna_spiral",   coins:["\uD83E\uDDEC","\u26A1","\u2728","\uD83D\uDCB0"],       anticipation:"neon_flash",    intro:"cosmic" ,accentColor:"#00FF00"},
    golden_fortune:{ bgType:"chinese_sky",chrome:"jade_frame",winFX:"confetti_pop",  coins:["\uD83D\uDCB0","\u2728","\uD83D\uDC8E","\uD83C\uDF81"], anticipation:"dragon_glow", intro:"epic" },
    island_tiki:         { bgType:"tropical",  chrome:"bamboo",       winFX:"tropical_pop", coins:["\uD83C\uDF34","\uD83C\uDF3A","\uD83D\uDCB0","\u2728"], anticipation:"wave_crash",  intro:"watery" },
    sakura_princess:     { bgType:"sakura_sky",chrome:"kawaii_pink",  winFX:"sakura_burst", coins:["\uD83C\uDF38","\u2B50","\uD83D\uDC8E","\uD83D\uDCB0"], anticipation:"sparkle",     intro:"sweet" },
    ares_blade:          { bgType:"arena",     chrome:"dark_iron",    winFX:"sword_clash",  coins:["\u2694","\uD83D\uDC80","\u2728","\uD83D\uDCB0"],        anticipation:"dark_pulse",  intro:"dramatic" },
    neon_nights:         { bgType:"neon_city", chrome:"arcade_neon",  winFX:"neon_pop",     coins:["\uD83C\uDF06","\u26A1","\uD83D\uDCB0","\u2728"],       anticipation:"electric",    intro:"neon" ,accentColor:"#FF1493"},
    viking_voyage:       { bgType:"northern_sea",chrome:"viking_shield",winFX:"thunder_burst",coins:["\u2694","\uD83D\uDEE1","\u2B50","\uD83D\uDCB0"], anticipation:"thunder",     intro:"epic" },
    diamond_vault:       { bgType:"crystal_cave",chrome:"gem_frame",  winFX:"diamond_shatter",coins:["\uD83D\uDC8E","\uD83D\uDCAF","\u2728","\uD83D\uDCB0"], anticipation:"gem_glow", intro:"cosmic" },
    madame_destiny:{ bgType:"mystic_mist",chrome:"gold_ornate",winFX:"mystic_burst", coins:["\uD83D\uDD2E","\u2728","\uD83D\uDC8E","\uD83D\uDCB0"], anticipation:"sparkle",     intro:"mystic" },
    great_rhino:         { bgType:"savanna",   chrome:"rustic_wood",  winFX:"dust_cloud",   coins:["\uD83E\uDD8F","\uD83D\uDCAB","\u2B50","\uD83D\uDCB0"], anticipation:"rumble",      intro:"dramatic" },
    bass_splash:{ bgType:"ocean_ripple",chrome:"fishing",winFX:"bubble_burst",       coins:["\uD83D\uDC1F","\uD83D\uDC20","\u2B50","\uD83D\uDCB0"], anticipation:"wave_crash",  intro:"watery" ,accentColor:"#87CEEB"},
    dragon_megafire:{ bgType:"flames",chrome:"fire_border",winFX:"dragon_burst", coins:["\uD83D\uDC09","\uD83D\uDD25","\uD83D\uDCAB","\uD83D\uDCB0"], anticipation:"heat",    intro:"epic" },
    esqueleto_fiesta:    { bgType:"day_dead",  chrome:"fiesta",       winFX:"confetti_pop", coins:["\uD83D\uDC80","\uD83C\uDF8A","\u2B50","\uD83D\uDCB0"], anticipation:"spin_joker",  intro:"sweet" },
    wildfire_gold:       { bgType:"wildfire",  chrome:"fire_border",  winFX:"ember_burst",  coins:["\uD83D\uDD25","\uD83D\uDCAB","\u2B50","\uD83D\uDCB0"], anticipation:"heat",        intro:"flash" },
    five_lions:{ bgType:"chinese_sky",chrome:"gold_ornate",winFX:"gold_shower", coins:["\uD83E\uDD81","\uD83C\uDF81","\u2728","\uD83D\uDCB0"], anticipation:"dragon_glow", intro:"epic" ,accentColor:"#FFD700"},
    chilli_heat:         { bgType:"flames",    chrome:"fire_border",  winFX:"ember_burst",  coins:["\uD83C\uDF36","\uD83D\uDD25","\u2B50","\uD83D\uDCB0"], anticipation:"heat",        intro:"flash" },
    tombstone_reload:    { bgType:"wild_west", chrome:"rustic_wood",  winFX:"gunshot_pop",  coins:["\uD83E\uDD20","\u2B50","\uD83D\uDCB0","\uD83D\uDC80"], anticipation:"rumble",      intro:"dramatic" },
    mental_meltdown:     { bgType:"cyber_grid",chrome:"tech_hud",     winFX:"glitch_burst", coins:["\uD83E\uDDE0","\u26A1","\u2728","\uD83D\uDCB0"],       anticipation:"neon_flash",    intro:"cyber" ,accentColor:"#FF0000"}
  };

  // Continue remaining 125 games
  var PROFILES2 = {
    street_rider:        { bgType:"city_rain",  chrome:"arcade_neon", winFX:"neon_pop",     coins:["\uD83D\uDEF4","\u26A1","\uD83D\uDCB0","\u2728"],       anticipation:"electric",    intro:"flash" },
    spartan_glory:{ bgType:"arena",chrome:"chrome_round",winFX:"sword_clash",  coins:["\uD83D\uDEE1","\u2694","\u2B50","\uD83D\uDCB0"],        anticipation:"thunder",     intro:"epic" },
    jungle_spirit:{ bgType:"deep_jungle",chrome:"bamboo",winFX:"magic_swirl",   coins:["\uD83C\uDF43","\uD83C\uDF40","\u2728","\uD83D\uDCB0"], anticipation:"sparkle",     intro:"dramatic" },
    wild_west:{ bgType:"wild_west",chrome:"rustic_wood",winFX:"dust_cloud",  coins:["\uD83E\uDD20","\u2B50","\uD83D\uDCB0","\uD83D\uDC04"], anticipation:"rumble",      intro:"dramatic" },
    mystic_gems:         { bgType:"crystal_cave",chrome:"gem_frame",  winFX:"gem_shatter",  coins:["\uD83D\uDC8E","\u2728","\uD83D\uDCAF","\uD83D\uDCB0"], anticipation:"gem_glow",    intro:"cosmic" },
    thunder_crash:       { bgType:"stormy_sky", chrome:"tech_hud",    winFX:"thunder_burst",coins:["\u26A1","\u2728","\uD83D\uDCB0","\uD83D\uDC8E"],        anticipation:"thunder",     intro:"epic" },
    solar_blast:         { bgType:"space_nova", chrome:"tech_hud",    winFX:"solar_burst",  coins:["\u2600","\u26A1","\u2728","\uD83D\uDCB0"],              anticipation:"electric",    intro:"cosmic" },
    sweet_bonanza:{ bgType:"candy",chrome:"chrome_round",winFX:"fruit_pop",  coins:["\uD83C\uDF6C","\uD83C\uDF6B","\uD83C\uDF69","\uD83D\uDCB0"], anticipation:"sparkle",intro:"sweet" },
    amazon_wild:         { bgType:"deep_jungle",chrome:"bamboo",      winFX:"leaf_burst",   coins:["\uD83C\uDF3F","\uD83C\uDF43","\u2728","\uD83D\uDCB0"], anticipation:"sparkle",     intro:"dramatic" },
    treasure_hunt:{ bgType:"ocean_wave",chrome:"gold_ornate",winFX:"treasure_pop", coins:["\uD83D\uDCB0","\u2693","\u2620","\u2728"],              anticipation:"wave_crash",  intro:"dramatic" },
    lucky_shamrock:      { bgType:"irish_green",chrome:"chrome_round",winFX:"shamrock_pop", coins:["\uD83C\uDF40","\u2618","\uD83D\uDCB0","\u2728"],       anticipation:"sparkle",     intro:"sweet" },
    ice_queen:{ bgType:"blizzard",chrome:"crystal_ball",winFX:"ice_shatter",  coins:["\u2744","\u2745","\uD83D\uDC8E","\uD83D\uDCB0"],       anticipation:"freeze",      intro:"mystic" },
    lava_gold:           { bgType:"volcano",    chrome:"fire_border", winFX:"lava_pop",     coins:["\uD83D\uDD25","\uD83E\uDEA8","\uD83D\uDCB0","\u2B50"], anticipation:"heat",        intro:"dramatic" },
    moon_princess:       { bgType:"moonlit",    chrome:"kawaii_pink", winFX:"moon_burst",   coins:["\uD83C\uDF19","\u2B50","\uD83D\uDC8E","\uD83D\uDCB0"], anticipation:"moon_glow",   intro:"cosmic" },
    wild_amazon:{ bgType:"bamboo_forest",chrome:"bamboo",winFX:"leaf_burst",   coins:["\uD83C\uDF3F","\uD83C\uDF43","\u2B50","\uD83D\uDCB0"], anticipation:"sparkle",     intro:"dramatic" },
    aztec_gold:          { bgType:"aztec_temple",chrome:"stone_aztec",winFX:"gold_shower",  coins:["\uD83D\uDCB0","\uD83C\uDF1E","\u2728","\uD83D\uDC8E"], anticipation:"rumble",      intro:"epic" },
    monster_match:       { bgType:"haunted",    chrome:"dark_iron",   winFX:"slime_burst",  coins:["\uD83D\uDC7B","\uD83C\uDF83","\u2B50","\uD83D\uDCB0"], anticipation:"dark_pulse",  intro:"dramatic" },
    golden_tiger:{ bgType:"chinese_sky",chrome:"jade_frame",winFX:"gold_shower", coins:["\uD83D\uDC2F","\u2B50","\uD83D\uDCB0","\uD83D\uDC8E"], anticipation:"dragon_glow", intro:"epic" },
    neon_future:         { bgType:"cyber_grid", chrome:"tech_hud",    winFX:"laser_pop",    coins:["\u26A1","\uD83D\uDD2C","\u2728","\uD83D\uDCB0"],        anticipation:"electric",    intro:"cyber" ,accentColor:"#00FFFF"},
    dark_knight:         { bgType:"gothic_city",chrome:"dark_iron",   winFX:"bat_burst",    coins:["\uD83E\uDDB7","\uD83C\uDF03","\u2728","\uD83D\uDCB0"], anticipation:"dark_pulse",  intro:"dramatic" },
    reef_riches:         { bgType:"coral_sea",  chrome:"fishing",     winFX:"bubble_burst", coins:["\uD83D\uDC1F","\uD83D\uDC20","\uD83D\uDC22","\uD83D\uDCB0"], anticipation:"pulse_blue",intro:"watery" },
    ninja_master:        { bgType:"ninja_dojo",  chrome:"dark_iron",  winFX:"shuriken_pop", coins:["\uD83E\uDD44","\u2694","\u2B50","\uD83D\uDCB0"],        anticipation:"dark_pulse",  intro:"dramatic" },
    fortune_tiger:{ bgType:"chinese_sky",chrome:"fire_border",winFX:"dragon_burst", coins:["\uD83D\uDC2F","\uD83C\uDF81","\u2728","\uD83D\uDCB0"], anticipation:"heat", intro:"epic" ,accentColor:"#FF4500"},
    rainbow_gold:        { bgType:"rainbow",    chrome:"chrome_round",winFX:"rainbow_burst",coins:["\uD83C\uDF08","\uD83D\uDCB0","\u2728","\uD83D\uDC8E"], anticipation:"sparkle",     intro:"sweet" },
    wolf_moon:{ bgType:"moonlit",chrome:"ice_crystal",winFX:"moon_howl",    coins:["\uD83D\uDC3A","\uD83C\uDF15","\u2B50","\uD83D\uDCB0"], anticipation:"moon_glow",   intro:"dramatic" },
    crystal_cavern:      { bgType:"crystal_cave",chrome:"ice_crystal",winFX:"crystal_pop",  coins:["\uD83D\uDC8E","\u2745","\u2728","\uD83D\uDCB0"],       anticipation:"gem_glow",    intro:"cosmic" },
    royal_flush:         { bgType:"velvet_casino",chrome:"gold_ornate",winFX:"card_shuffle", coins:["\u2660","\u2665","\uD83D\uDCB0","\u2728"],             anticipation:"pulse_red",   intro:"flash" },
    phoenix_blaze:       { bgType:"phoenix_fire",chrome:"fire_border",winFX:"phoenix_burst",coins:["\uD83D\uDD25","\uD83D\uDCAB","\uD83D\uDCB0","\u2B50"], anticipation:"heat",        intro:"epic" },
    deep_sea_diver:      { bgType:"deep_sea",   chrome:"fishing",     winFX:"bubble_burst", coins:["\uD83D\uDC22","\uD83D\uDC1F","\uD83D\uDC8E","\uD83D\uDCB0"], anticipation:"pulse_blue",intro:"watery" },
    samurai_sword:{ bgType:"ninja_dojo",chrome:"jade_frame",winFX:"sword_clash",  coins:["\u2694","\uD83E\uDD44","\u2B50","\uD83D\uDCB0"],        anticipation:"dark_pulse",  intro:"dramatic" }
  };
  Object.assign(PROFILES, PROFILES2);

  // Remaining games + adult/noir themes
  var PROFILES3 = {
    cleopatra_gold:      { bgType:"egypt_dusk",  chrome:"ancient_stone", winFX:"sand_burst",  coins:["\uD83D\uDCB0","\uD83C\uDFFA","\u2728","\uD83D\uDC8E"], anticipation:"sand_storm",  intro:"epic" },
    lucky_panda:         { bgType:"bamboo_forest",chrome:"jade_frame",   winFX:"panda_pop",   coins:["\uD83D\uDC3C","\uD83C\uDF81","\u2728","\uD83D\uDCB0"], anticipation:"sparkle",     intro:"sweet" },
    big_bad_wolf:        { bgType:"moonlit",     chrome:"rustic_wood",   winFX:"moon_howl",   coins:["\uD83D\uDC3A","\uD83C\uDF15","\u2B50","\uD83D\uDCB0"], anticipation:"moon_glow",   intro:"dramatic" },
    red_tiger:{ bgType:"chinese_sky",chrome:"fire_border",winFX:"ember_burst",coins:["\uD83D\uDC2F","\u2728","\uD83D\uDCB0","\u2B50"],       anticipation:"dragon_glow", intro:"inferno" ,accentColor:"#CC0000"},
    super_diamond:{ bgType:"crystal_cave",chrome:"chrome_round",winFX:"diamond_shatter",coins:["\uD83D\uDC8E","\uD83D\uDCAF","\u2728","\uD83D\uDCB0"], anticipation:"gem_glow", intro:"cosmic" },
    gold_rush:           { bgType:"wild_west",   chrome:"rustic_wood",   winFX:"gold_shower", coins:["\uD83E\uDD20","\uD83D\uDCB0","\u2728","\uD83D\uDC8E"], anticipation:"rumble",      intro:"dramatic" },
    star_of_egypt:{ bgType:"egypt_dusk",chrome:"ancient_stone",winFX:"starburst",  coins:["\uD83C\uDF1F","\uD83C\uDFFA","\u2728","\uD83D\uDCB0"], anticipation:"sand_storm",  intro:"epic" },
    sparta_warriors:{ bgType:"arena",chrome:"ancient_stone",winFX:"sword_clash", coins:["\uD83D\uDEE1","\u2694","\u2B50","\uD83D\uDCB0"],        anticipation:"thunder",     intro:"epic" },
    buffalo_hold:{ bgType:"savanna",chrome:"rustic_wood",winFX:"thunder_burst",  coins:["\uD83E\uDD8C","\uD83D\uDCAB","\u2B50","\uD83D\uDCB0"], anticipation:"rumble",      intro:"wild" ,accentColor:"#A0522D"},
    mystic_wolf:{ bgType:"moonlit",chrome:"dark_iron",winFX:"moon_howl",   coins:["\uD83D\uDC3A","\uD83C\uDF15","\u2B50","\uD83D\uDCB0"], anticipation:"moon_glow",   intro:"dramatic" },
    ancient_alchemist:   { bgType:"mystic_mist", chrome:"crystal_ball",  winFX:"mystic_burst",coins:["\u2697","\u2728","\uD83D\uDCB0","\uD83D\uDD2E"],        anticipation:"sparkle",     intro:"mystic" },
    thunder_titan:       { bgType:"stormy_sky",  chrome:"golden_gods",   winFX:"lightning_strike",coins:["\u26A1","\uD83D\uDC8E","\u2728","\uD83D\uDCB0"], anticipation:"thunder",     intro:"epic" },
    carnival_chaos:{ bgType:"carnival",chrome:"fiesta",winFX:"confetti_pop",coins:["\uD83C\uDF86","\uD83C\uDF89","\u2728","\uD83D\uDCB0"], anticipation:"spin_joker",  intro:"sweet" },
    safari_king:{ bgType:"savanna",chrome:"gold_ornate",winFX:"dust_cloud",  coins:["\uD83E\uDD81","\uD83D\uDCAB","\u2B50","\uD83D\uDCB0"], anticipation:"rumble",      intro:"dramatic" },
    crystal_royals:      { bgType:"crystal_cave",chrome:"gem_frame",     winFX:"crystal_pop", coins:["\uD83D\uDC8E","\u2728","\uD83D\uDCAF","\uD83D\uDCB0"], anticipation:"gem_glow",    intro:"mystic" ,accentColor:"#BA55D3"},
    infernal_depths:     { bgType:"hell_fire",   chrome:"dark_iron",     winFX:"lava_pop",    coins:["\uD83D\uDC80","\uD83D\uDD25","\uD83D\uDCAB","\uD83D\uDCB0"], anticipation:"heat",  intro:"dramatic" },
    rainbow_riches_quest:{ bgType:"rainbow",chrome:"chrome_round",winFX:"shamrock_pop",coins:["\uD83C\uDF40","\u2618","\uD83D\uDCB0","\u2728"],       anticipation:"pulse_green",     intro:"flash" ,accentColor:"#00FF00"},
    steampunk_gears:     { bgType:"steam_factory",chrome:"tech_hud",     winFX:"gear_burst",  coins:["\u2699","\uD83D\uDD27","\u2728","\uD83D\uDCB0"],        anticipation:"electric",    intro:"flash" },
    phoenix_rising:{ bgType:"phoenix_fire",chrome:"gold_ornate",winFX:"phoenix_burst",coins:["\uD83D\uDD25","\uD83D\uDCAB","\uD83D\uDCB0","\u2B50"], anticipation:"heat",        intro:"epic" },
    arctic_frost:        { bgType:"blizzard",    chrome:"ice_crystal",   winFX:"ice_shatter", coins:["\u2744","\u2745","\uD83D\uDC8E","\uD83D\uDCB0"],       anticipation:"freeze",      intro:"frozen" ,accentColor:"#87CEEB"},
    urban_rooftop:{ bgType:"city_rain",chrome:"chrome_round",winFX:"neon_pop",    coins:["\uD83C\uDF06","\u26A1","\uD83D\uDCB0","\u2728"],       anticipation:"neon_flash",    intro:"cyber" ,accentColor:"#00FFFF"},
    enchanted_maze:      { bgType:"fairy_forest",chrome:"kawaii_pink",   winFX:"fairy_pop",   coins:["\u2728","\uD83E\uDDDA","\uD83D\uDC8E","\uD83D\uDCB0"], anticipation:"sparkle",     intro:"mystic" },
    samurai_honor:       { bgType:"ninja_dojo",  chrome:"dark_iron",     winFX:"sword_clash", coins:["\u2694","\uD83E\uDD44","\u2B50","\uD83D\uDCB0"],        anticipation:"pulse_red",  intro:"samurai" ,accentColor:"#DC143C"},
    mega_diamond_rush:{ bgType:"crystal_cave",chrome:"gold_ornate",winFX:"diamond_shatter",coins:["\uD83D\uDC8E","\uD83D\uDCAF","\u2728","\uD83D\uDCB0"], anticipation:"gem_glow", intro:"cosmic" },
    sinners_paradise:{ bgType:"hell_fire",chrome:"fire_border",winFX:"lava_pop",    coins:["\uD83D\uDD25","\uD83D\uDC80","\uD83D\uDCB0","\u2728"], anticipation:"dark_pulse",  intro:"dramatic" },
    midnight_burlesque:  { bgType:"velvet_club", chrome:"gold_ornate",   winFX:"feather_pop", coins:["\uD83E\uDE78","\uD83D\uDC83","\u2728","\uD83D\uDCB0"], anticipation:"pulse_red",   intro:"mystic" },
    absinthe_nights:     { bgType:"absinth_dream",chrome:"gold_ornate",  winFX:"smoke_burst", coins:["\uD83D\uDC80","\u2726","\u2728","\uD83D\uDCB0"],        anticipation:"dark_pulse",  intro:"mystic" },
    velvet_lounge:{ bgType:"velvet_club",chrome:"gold_ornate",winFX:"card_shuffle",coins:["\uD83C\uDCCF","\u2665","\uD83D\uDCB0","\u2728"],       anticipation:"royal_glow",   intro:"royal" ,accentColor:"#9400D3"},
    dark_desire:{ bgType:"city_rain",chrome:"dark_iron",winFX:"dark_burst",  coins:["\uD83D\uDC80","\uD83D\uDD25","\u2728","\uD83D\uDCB0"], anticipation:"dark_pulse",  intro:"dramatic" },
    vice_city_jackpot:{ bgType:"neon_city",chrome:"neon_round",winFX:"confetti_pop",    coins:["\uD83C\uDF06","\uD83D\uDCB0","\u26A1","\u2728"],       anticipation:"electric",    intro:"flash" },
    whiskey_barrel:{ bgType:"wild_west",chrome:"chrome_round",winFX:"gunshot_pop", coins:["\uD83C\uDF7A","\uD83E\uDD20","\uD83D\uDCB0","\u2728"], anticipation:"rumble",      intro:"dramatic" },
    black_market:        { bgType:"gothic_city", chrome:"dark_iron",     winFX:"dark_burst",  coins:["\uD83D\uDCB0","\uD83D\uDC80","\u2728","\u26A1"],       anticipation:"dark_pulse",  intro:"dramatic" },
    serpent_temptation:  { bgType:"mystic_mist", chrome:"crystal_ball",  winFX:"smoke_burst", coins:["\uD83D\uDC0D","\u2728","\uD83D\uDCB0","\uD83D\uDC80"], anticipation:"dark_pulse",  intro:"mystic" },
    neon_underworld:     { bgType:"neon_city",   chrome:"arcade_neon",   winFX:"laser_pop",   coins:["\u26A1","\uD83D\uDCB0","\uD83C\uDF06","\u2728"],       anticipation:"electric",    intro:"flash" },
    blood_ritual:        { bgType:"blood_moon",  chrome:"dark_iron",     winFX:"blood_burst", coins:["\uD83D\uDD25","\uD83D\uDC80","\u2728","\uD83D\uDCB0"], anticipation:"dark_pulse",  intro:"dramatic" },
    crypt_of_sins:       { bgType:"haunted",     chrome:"dark_iron",     winFX:"dark_burst",  coins:["\uD83D\uDC80","\uD83C\uDF83","\u2728","\uD83D\uDCB0"], anticipation:"dark_pulse",  intro:"dramatic" },
    flesh_and_gold:      { bgType:"velvet_club", chrome:"gold_ornate",   winFX:"gold_shower", coins:["\uD83D\uDCB0","\u2728","\uD83D\uDC8E","\uD83D\uDC80"], anticipation:"pulse_red",   intro:"mystic" },
    opium_den:{ bgType:"absinth_dream",chrome:"crystal_ball",winFX:"smoke_burst", coins:["\uD83D\uDCB0","\uD83D\uDD2E","\u2728","\uD83D\uDC80"], anticipation:"dark_pulse",  intro:"mystic" },
    torture_chamber:     { bgType:"hell_fire",   chrome:"dark_iron",     winFX:"dark_burst",  coins:["\uD83D\uDC80","\uD83D\uDD25","\u2728","\uD83D\uDCB0"], anticipation:"dark_pulse",  intro:"dramatic" }
  };
  Object.assign(PROFILES, PROFILES3);

  // 93 additional unique game profiles — PROFILES4
  var PROFILES4 = {
    san_quentin:         { bgType:"dark_vignette",chrome:"dark_iron",    winFX:"lightning_strike",coins:["\uD83D\uDD12","\u26A1","\u2728","\uD83D\uDCB0"], anticipation:"dark_pulse",  intro:"dramatic" },
    nitro_street:{ bgType:"neon_city",chrome:"chrome_round",winFX:"energy_pulse",     coins:["\uD83C\uDFCE","\uD83D\uDCA8","\u26A1","\uD83D\uDCB0"],       anticipation:"electric",    intro:"flash" },
    wild_toro:           { bgType:"arena",        chrome:"fire_border",  winFX:"dust_cloud",   coins:["\uD83D\uDC02","\uD83C\uDF39","\u2728","\uD83D\uDCB0"],       anticipation:"rumble",      intro:"dramatic" },
    jammin_fruits:{ bgType:"tropical",chrome:"chrome_round",winFX:"tropical_pop", coins:["\uD83C\uDF4D","\uD83C\uDF4E","\uD83C\uDF53","\uD83D\uDCB0"], anticipation:"pulse_green", intro:"sweet" },
    big_bamboo:          { bgType:"deep_jungle",  chrome:"bamboo",       winFX:"tropical_pop", coins:["\uD83C\uDF8B","\uD83C\uDF3F","\u2728","\uD83D\uDCB0"],       anticipation:"pulse_green", intro:"dramatic" },
    fat_rabbit:{ bgType:"sunshine",chrome:"kawaii_pink",winFX:"heart_pop",    coins:["\uD83D\uDC30","\uD83E\uDD55","\u2728","\uD83D\uDCB0"],       anticipation:"pulse_pink",     intro:"sweet" ,accentColor:"#FF69B4"},
    immortal_blood:{ bgType:"gothic_city",chrome:"dark_iron",winFX:"blood_burst",  coins:["\uD83E\uDDB7","\u2620","\uD83D\uDD2E","\uD83D\uDCB0"],       anticipation:"dark_pulse",  intro:"dramatic" },
    mega_safari:{ bgType:"savanna",chrome:"bamboo",winFX:"dust_cloud",   coins:["\uD83E\uDD81","\uD83D\uDC18","\u2728","\uD83D\uDCB0"],       anticipation:"rumble",      intro:"dramatic" },
    lucha_mania:{ bgType:"circus_fire",chrome:"fiesta",winFX:"firework_pop", coins:["\uD83E\uDD3C","\uD83C\uDF1F","\u26A1","\uD83D\uDCB0"],       anticipation:"heat",        intro:"flash" },
    extra_chilli:{ bgType:"volcano",chrome:"fiesta",winFX:"ember_burst",  coins:["\uD83C\uDF36","\uD83D\uDD25","\u2728","\uD83D\uDCB0"],       anticipation:"heat",        intro:"flash" },
    wanted_dead:{ bgType:"wild_west",chrome:"dark_iron",winFX:"gunshot_pop",   coins:["\uD83E\uDD20","\uD83D\uDCA3","\u2B50","\uD83D\uDCB0"],       anticipation:"wild_pulse",      intro:"wild" ,accentColor:"#696969"},
    chaos_crew:          { bgType:"neon_city",    chrome:"neon_round",   winFX:"neon_pop",     coins:["\uD83E\uDD21","\uD83D\uDCA3","\u26A1","\uD83D\uDCB0"],       anticipation:"neon_flash",    intro:"neon" ,accentColor:"#FF00FF"},
    le_bandit:           { bgType:"dark_vignette",chrome:"dark_iron",    winFX:"gold_shower",  coins:["\uD83C\uDFA9","\uD83D\uDCB0","\uD83D\uDC8E","\u2728"],       anticipation:"dark_pulse",  intro:"dramatic" },
    dead_alive:{ bgType:"blood_moon",chrome:"dark_iron",winFX:"dark_burst",  coins:["\u2620","\uD83E\uDDB4","\u2728","\uD83D\uDCB0"],             anticipation:"dark_pulse",  intro:"dramatic" },
    mega_joker:{ bgType:"carnival",chrome:"jester",winFX:"confetti_pop", coins:["\uD83C\uDCA0","\uD83C\uDCA1","\u2B50","\uD83D\uDCB0"],       anticipation:"spin_joker",  intro:"flash" },
    crown_fire:          { bgType:"flames",       chrome:"golden_gods",  winFX:"ember_burst",  coins:["\uD83D\uDC51","\uD83D\uDD25","\uD83D\uDCB0","\u2728"],       anticipation:"heat",        intro:"epic" },
    olympus_dream:{ bgType:"olympus",chrome:"chrome_round",winFX:"lightning_strike",coins:["\u26A1","\uD83C\uDFDB","\uD83D\uDC8E","\uD83D\uDCB0"], anticipation:"thunder",     intro:"epic" },
    goldstorm_ultra:{ bgType:"golden_sky",chrome:"gold_ornate",winFX:"gold_shower",  coins:["\uD83D\uDCB0","\uD83C\uDF1F","\u2728","\uD83D\uDC8E"],       anticipation:"star_glow",   intro:"epic" },
    fire_hole:           { bgType:"volcano",      chrome:"fire_border",  winFX:"ember_burst",  coins:["\uD83C\uDF0B","\uD83D\uDD25","\u26A1","\uD83D\uDCB0"],       anticipation:"heat",        intro:"flash" },
    merlin_power:        { bgType:"enchanted",    chrome:"stone_aztec",  winFX:"magic_swirl",  coins:["\uD83E\uDDD9","\u2728","\uD83D\uDD2E","\uD83D\uDCB0"],       anticipation:"sparkle",     intro:"epic" },
    coin_strike:         { bgType:"golden_sky",   chrome:"chrome_round", winFX:"gold_shower",  coins:["\uD83D\uDCB0","\uD83C\uDF1F","\u2728","\uD83D\uDC8E"],       anticipation:"star_glow",   intro:"flash" },
    gold_rush_frog:      { bgType:"tropical",     chrome:"jade_frame",   winFX:"gold_shower",  coins:["\uD83D\uDC38","\uD83D\uDCB0","\u2728","\uD83D\uDC8E"],       anticipation:"pulse_green", intro:"sweet" },
    snoop_dollars:       { bgType:"neon_city",    chrome:"tech_hud",     winFX:"gold_shower",  coins:["\uD83D\uDCB5","\uD83D\uDCB0","\u2728","\uD83C\uDF1F"],       anticipation:"electric",    intro:"flash" },
    gemhalla:            { bgType:"olympus",      chrome:"gem_frame",    winFX:"starburst",    coins:["\uD83D\uDC8E","\u2728","\u2B50","\uD83D\uDCB0"],             anticipation:"thunder",     intro:"epic" },
    loki_loot:           { bgType:"enchanted",    chrome:"dark_iron",    winFX:"magic_swirl",  coins:["\uD83D\uDE08","\u2728","\u26A1","\uD83D\uDCB0"],             anticipation:"dark_pulse",  intro:"dramatic" },
    buffalo_extreme:     { bgType:"prairie",      chrome:"rustic_wood",  winFX:"dust_cloud",   coins:["\uD83E\uDDB3","\uD83C\uDF1E","\u2B50","\uD83D\uDCB0"],       anticipation:"rumble",      intro:"dramatic" },
    pots_olympus:{ bgType:"olympus",chrome:"golden_gods",winFX:"gold_shower",coins:["\uD83C\uDFFA","\u26A1","\uD83D\uDCB0","\u2728"],       anticipation:"thunder",     intro:"epic" },
    dog_house_mega:      { bgType:"sunshine",     chrome:"chrome_round", winFX:"heart_pop",    coins:["\uD83D\uDC36","\uD83C\uDF56","\u2764","\uD83D\uDCB0"],       anticipation:"wild_pulse",     intro:"flash" ,accentColor:"#FF8C00"},
    fruit_party:         { bgType:"candy",        chrome:"neon_round",   winFX:"candy_burst",  coins:["\uD83C\uDF4E","\uD83C\uDF47","\uD83C\uDF4A","\uD83D\uDCB0"], anticipation:"pulse_pink",  intro:"sweet" },
    reactoonz:{ bgType:"arcade_neon",chrome:"tech_hud",winFX:"glitch_burst", coins:["\uD83D\uDC7E","\u26A1","\u2728","\uD83D\uDCB0"],             anticipation:"electric",    intro:"flash" },
    money_train:         { bgType:"prairie",      chrome:"rustic_wood",  winFX:"gold_shower",  coins:["\uD83D\uDE82","\uD83D\uDCB0","\u2B50","\u2728"],             anticipation:"electric",      intro:"flash" ,accentColor:"#FFD700"},
    razor_shark:{ bgType:"northern_sea",chrome:"dark_iron",winFX:"splash",       coins:["\uD83E\uDD88","\uD83D\uDC1F","\u2728","\uD83D\uDCB0"],       anticipation:"pulse_blue",  intro:"watery" },
    elvis_frog:{ bgType:"retro_glow",chrome:"neon_round",winFX:"neon_pop",     coins:["\uD83D\uDC38","\uD83C\uDFA4","\u2728","\uD83D\uDCB0"],       anticipation:"electric",    intro:"neon" ,accentColor:"#00FF00"},
    gems_bonanza:{ bgType:"crystal_cave",chrome:"gold_ornate",winFX:"gem_shatter",    coins:["\uD83D\uDC8E","\u2728","\uD83C\uDF1F","\uD83D\uDCB0"],       anticipation:"star_glow",   intro:"cosmic" },
    buffalo_mega:{ bgType:"prairie",chrome:"chrome_round",winFX:"dust_cloud",   coins:["\uD83E\uDDB3","\uD83D\uDCAB","\u2B50","\uD83D\uDCB0"],       anticipation:"wild_pulse",      intro:"dramatic" ,accentColor:"#8B7355"},
    tome_madness:{ bgType:"enchanted",chrome:"stone_aztec",winFX:"mystic_burst",  coins:["\uD83D\uDCD6","\uD83D\uDD2E","\u2728","\uD83D\uDCB0"],       anticipation:"sparkle",     intro:"epic" },
    eternal_romance:{ bgType:"blood_moon",chrome:"crystal_ball",winFX:"mystic_burst",  coins:["\u2764","\uD83E\uDDB7","\uD83C\uDF39","\uD83D\uDCB0"],       anticipation:"dark_pulse",  intro:"dramatic" },
    coin_volcano:        { bgType:"volcano",      chrome:"fire_border",  winFX:"gold_shower",  coins:["\uD83C\uDF0B","\uD83D\uDCB0","\u2728","\uD83D\uDC8E"],       anticipation:"lava_glow",        intro:"inferno" ,accentColor:"#FFA500"},
    power_crown:{ bgType:"golden_sky",chrome:"gold_ornate",winFX:"starburst",  coins:["\uD83D\uDC51","\uD83D\uDCB0","\u2B50","\u2728"],             anticipation:"golden_aura",   intro:"royal" ,accentColor:"#FFD700"},
    wild_safari:{ bgType:"savanna",chrome:"chrome_round",winFX:"feather_pop",   coins:["\uD83E\uDD81","\uD83E\uDD92","\u2728","\uD83D\uDCB0"],       anticipation:"rumble",      intro:"dramatic" },
    wild_deep:{ bgType:"northern_sea",chrome:"fishing",winFX:"splash",       coins:["\uD83D\uDC19","\uD83D\uDC20","\u2728","\uD83D\uDCB0"],       anticipation:"pulse_blue",  intro:"watery" ,accentColor:"#00688B"},
    wild_west_rush:{ bgType:"prairie",chrome:"rustic_wood",winFX:"gunshot_pop",   coins:["\uD83E\uDD20","\uD83D\uDCA3","\u2B50","\uD83D\uDCB0"],       anticipation:"rumble",      intro:"wild" ,accentColor:"#DEB887"},
    golden_pharaoh:{ bgType:"egypt_dusk",chrome:"ancient_stone",winFX:"gold_shower",   coins:["\uD83C\uDFFA","\uD83D\uDCB0","\u2728","\uD83D\uDC8E"],       anticipation:"sand_storm",  intro:"epic" },
    mystic_cauldron:{ bgType:"enchanted",chrome:"crystal_ball",winFX:"magic_swirl",  coins:["\uD83E\uDDE4","\uD83D\uDD2E","\u2728","\uD83D\uDCB0"],       anticipation:"sparkle",     intro:"epic" },
    crystal_shrine:{ bgType:"mystic_mist",chrome:"gem_frame",winFX:"crystal_pop",    coins:["\uD83D\uDC8E","\u2728","\uD83C\uDF1F","\uD83D\uDCB0"],       anticipation:"star_glow",   intro:"cosmic" },
    dragon_coins:        { bgType:"chinese_sky",  chrome:"jade_frame",   winFX:"dragon_burst", coins:["\uD83D\uDC09","\uD83D\uDCB0","\u2728","\uD83C\uDF1F"],       anticipation:"dragon_glow", intro:"epic" },
    mine_coins:          { bgType:"dark_vignette",chrome:"stone_aztec",  winFX:"gold_shower",  coins:["\u26CF","\uD83D\uDCB0","\uD83D\uDC8E","\u2728"],             anticipation:"rumble",      intro:"dramatic" },
    vault_coins:{ bgType:"dark_vignette",chrome:"gold_ornate",winFX:"gold_shower",  coins:["\uD83D\uDD12","\uD83D\uDCB0","\uD83D\uDC8E","\u2728"],       anticipation:"dark_pulse",  intro:"dramatic" },
    demon_chambers:{ bgType:"hell_fire",chrome:"dark_iron",winFX:"blood_burst",  coins:["\uD83D\uDE08","\uD83D\uDD25","\u2620","\uD83D\uDCB0"],       anticipation:"dark_pulse",  intro:"dramatic" },
    norse_vaults:        { bgType:"blizzard",     chrome:"dark_iron",    winFX:"lightning_strike",coins:["\u2694","\u26A1","\uD83D\uDC8E","\uD83D\uDCB0"],       anticipation:"thunder",     intro:"epic" },
    crystal_chambers:    { bgType:"crystal_cave", chrome:"gem_frame",    winFX:"starburst",    coins:["\uD83D\uDC8E","\u2728","\uD83C\uDF1F","\uD83D\uDCB0"],       anticipation:"star_glow",   intro:"cosmic" },
    jade_temple:{ bgType:"chinese_sky",chrome:"ancient_stone",winFX:"dragon_burst", coins:["\uD83C\uDFEF","\uD83D\uDC09","\u2728","\uD83D\uDCB0"],       anticipation:"dragon_glow", intro:"epic" },
    arctic_foxes:        { bgType:"blizzard",     chrome:"chrome_round", winFX:"frost_burst",  coins:["\uD83E\uDD8A","\u2744","\u2728","\uD83D\uDCB0"],             anticipation:"frost_glow",  intro:"cosmic" },
    neon_viper:{ bgType:"neon_city",chrome:"neon_round",winFX:"laser_pop",     coins:["\uD83D\uDC0D","\u26A1","\u2728","\uD83D\uDCB0"],             anticipation:"electric",    intro:"flash" },
    midnight_drifter:{ bgType:"city_rain",chrome:"tech_hud",winFX:"neon_pop",     coins:["\uD83C\uDFCE","\uD83C\uDF03","\u2728","\uD83D\uDCB0"],       anticipation:"electric",    intro:"flash" },
    pharaoh_march:{ bgType:"egypt_tomb",chrome:"stone_aztec",winFX:"sand_burst",   coins:["\uD83C\uDFFA","\u2620","\u2728","\uD83D\uDCB0"],             anticipation:"sand_storm",  intro:"epic" },
    iron_stampede:       { bgType:"prairie",      chrome:"dark_iron",    winFX:"dust_cloud",   coins:["\uD83D\uDC0E","\u2694","\u2728","\uD83D\uDCB0"],             anticipation:"rumble",      intro:"dramatic" },
    golden_jaguar:       { bgType:"deep_jungle",  chrome:"jade_frame",   winFX:"tropical_pop", coins:["\uD83D\uDC06","\uD83D\uDCB0","\u2728","\uD83D\uDC8E"],       anticipation:"pulse_green", intro:"dramatic" },
    lightning_pearl:     { bgType:"ocean_ripple", chrome:"gem_frame",    winFX:"energy_pulse", coins:["\u26A1","\uD83D\uDC1A","\u2728","\uD83D\uDCB0"],             anticipation:"electric",    intro:"cosmic" },
    galactic_raiders:{ bgType:"cosmos",chrome:"dark_iron",winFX:"laser_pop", coins:["\uD83D\uDE80","\uD83C\uDF1F","\u26A1","\uD83D\uDCB0"],       anticipation:"cosmic_hum",    intro:"cosmic" ,accentColor:"#6A5ACD"},
    nova_blackhole:{ bgType:"starfield",chrome:"tech_hud",winFX:"energy_pulse", coins:["\uD83C\uDF0C","\u26A1","\u2728","\uD83D\uDCB0"],             anticipation:"electric",    intro:"cosmic" },
    agent_zero:          { bgType:"cyber_grid",   chrome:"tech_hud",     winFX:"neon_pop",     coins:["\uD83D\uDD75","\uD83D\uDD2B","\u26A1","\uD83D\uDCB0"],       anticipation:"electric",    intro:"flash" },
    black_ops_heist:     { bgType:"dark_vignette",chrome:"dark_iron",    winFX:"neon_pop",     coins:["\uD83D\uDD12","\uD83D\uDCB0","\uD83D\uDCA3","\u2728"],       anticipation:"dark_pulse",  intro:"dramatic" },
    dragon_forge:        { bgType:"volcano",      chrome:"fire_border",  winFX:"dragon_burst", coins:["\uD83D\uDC09","\uD83D\uDD25","\u2728","\uD83D\uDCB0"],       anticipation:"heat",        intro:"epic" },
    castle_siege:        { bgType:"dark_vignette",chrome:"stone_aztec",  winFX:"dust_cloud",   coins:["\uD83C\uDFF0","\u2694","\u2728","\uD83D\uDCB0"],             anticipation:"rumble",      intro:"dramatic" },
    world_cup_glory:     { bgType:"sunshine",     chrome:"chrome_round", winFX:"firework_pop", coins:["\u26BD","\uD83C\uDFC6","\u2728","\uD83D\uDCB0"],             anticipation:"sparkle",     intro:"flash" },
    grand_prix_rush:     { bgType:"neon_city",    chrome:"tech_hud",     winFX:"neon_pop",     coins:["\uD83C\uDFCE","\uD83C\uDFC1","\u26A1","\uD83D\uDCB0"],       anticipation:"electric",    intro:"flash" },
    gold_crown_club:     { bgType:"golden_sky",   chrome:"golden_gods",  winFX:"gold_shower",  coins:["\uD83D\uDC51","\uD83D\uDCB0","\uD83C\uDF1F","\uD83D\uDC8E"], anticipation:"star_glow",   intro:"epic" },
    monaco_million:      { bgType:"neon_city",    chrome:"golden_gods",  winFX:"gold_shower",  coins:["\uD83C\uDFB0","\uD83D\uDCB0","\uD83D\uDC8E","\u2728"],       anticipation:"star_glow",   intro:"epic" },
    rome_eternal:        { bgType:"olympus",      chrome:"stone_aztec",  winFX:"dust_cloud",   coins:["\uD83C\uDFDB","\u2694","\uD83C\uDF1F","\uD83D\uDCB0"],       anticipation:"thunder",     intro:"epic" },
    pixel_rewind:        { bgType:"retro_glow",   chrome:"arcade_neon",  winFX:"neon_pop",     coins:["\uD83D\uDC7E","\uD83C\uDFAE","\u2B50","\uD83D\uDCB0"],       anticipation:"electric",    intro:"flash" },
    thunder_hero:        { bgType:"cosmos",       chrome:"tech_hud",     winFX:"lightning_strike",coins:["\u26A1","\uD83E\uDDB8","\u2728","\uD83D\uDCB0"],       anticipation:"thunder",     intro:"epic" },
    solar_fist:{ bgType:"flames",chrome:"gold_ornate",winFX:"solar_burst",  coins:["\u2600","\uD83E\uDD1C","\u26A1","\uD83D\uDCB0"],             anticipation:"heat",        intro:"flash" },
    big_top_bonanza:     { bgType:"circus_fire",  chrome:"jester",       winFX:"firework_pop", coins:["\uD83C\uDFAA","\uD83E\uDD21","\u2B50","\uD83D\uDCB0"],       anticipation:"spin_joker",  intro:"sweet" },
    clockwork_realm:     { bgType:"cyber_grid",   chrome:"tech_hud",     winFX:"energy_pulse", coins:["\u2699","\uD83D\uDD70","\u2728","\uD83D\uDCB0"],             anticipation:"electric",    intro:"cyber" ,accentColor:"#B8860B"},
    rockstar_wild:       { bgType:"neon_city",    chrome:"neon_round",   winFX:"firework_pop", coins:["\uD83C\uDFB8","\uD83C\uDFA4","\u2728","\uD83D\uDCB0"],       anticipation:"electric",    intro:"flash" },
    snow_queen_riches:   { bgType:"blizzard",     chrome:"gem_frame",    winFX:"frost_burst",  coins:["\u2744","\uD83D\uDC51","\uD83D\uDC8E","\uD83D\uDCB0"],       anticipation:"frost_glow",  intro:"cosmic" },
    jungle_fury:{ bgType:"deep_jungle",chrome:"stone_aztec",winFX:"leaf_burst", coins:["\uD83D\uDC05","\uD83C\uDF3F","\u2728","\uD83D\uDCB0"],       anticipation:"pulse_green", intro:"dramatic" },
    golden_vault_pharaoh:{ bgType:"egypt_dusk",chrome:"gold_ornate",winFX:"sand_burst",   coins:["\uD83C\uDFFA","\uD83D\uDCB0","\uD83D\uDC8E","\u2728"],       anticipation:"sand_storm",  intro:"epic" },
    mythic_olympiad:{ bgType:"olympus",chrome:"ancient_stone",winFX:"lightning_strike",coins:["\uD83C\uDFDB","\u26A1","\uD83D\uDC8E","\uD83D\uDCB0"], anticipation:"thunder",     intro:"epic" },
    neon_nexus:{ bgType:"neon_city",chrome:"arcade_neon",winFX:"energy_pulse", coins:["\uD83D\uDCBB","\u26A1","\u2728","\uD83D\uDCB0"],             anticipation:"neon_flash",    intro:"neon" ,accentColor:"#FF00FF"},
    anglers_fortune:     { bgType:"ocean_ripple", chrome:"fishing",      winFX:"splash",       coins:["\uD83D\uDC1F","\uD83C\uDFA3","\u2728","\uD83D\uDCB0"],       anticipation:"pulse_blue",  intro:"watery" },
    mecha_warriors:{ bgType:"cyber_grid",chrome:"dark_iron",winFX:"gear_burst", coins:["\uD83E\uDD16","\u26A1","\uD83D\uDD25","\uD83D\uDCB0"],       anticipation:"electric",    intro:"cyber" ,accentColor:"#00FF88"},
    enchanted_grove:     { bgType:"enchanted",    chrome:"bamboo",       winFX:"magic_swirl",  coins:["\uD83C\uDF3F","\uD83E\uDDA5","\u2728","\uD83D\uDCB0"],       anticipation:"sparkle",     intro:"sweet" },
    dragons_hoard:{ bgType:"volcano",chrome:"gold_ornate",winFX:"dragon_burst", coins:["\uD83D\uDC09","\uD83D\uDCB0","\uD83D\uDC8E","\u2728"],       anticipation:"heat",        intro:"epic" },
    time_keepers_book:{ bgType:"enchanted",chrome:"gold_ornate",winFX:"magic_swirl",  coins:["\uD83D\uDD70","\uD83D\uDCD6","\u2728","\uD83D\uDCB0"],       anticipation:"sparkle",     intro:"epic" },
    cyber_rebellion:{ bgType:"neon_city",chrome:"tech_hud",winFX:"glitch_burst", coins:["\uD83E\uDD16","\uD83D\uDCA5","\u26A1","\uD83D\uDCB0"],       anticipation:"electric",    intro:"cyber" ,accentColor:"#39FF14"},
    volcano_riches:{ bgType:"volcano",chrome:"gold_ornate",winFX:"lava_pop",  coins:["\uD83C\uDF0B","\uD83D\uDD25","\uD83D\uDCB0","\u2728"],       anticipation:"lava_glow",        intro:"inferno" ,accentColor:"#FF4500"},
    sunken_treasure:{ bgType:"ocean_ripple",chrome:"pirate_wood",winFX:"treasure_pop",       coins:["\uD83D\uDC1A","\uD83D\uDCB0","\u2693","\u2728"],             anticipation:"wave_crash",  intro:"watery" ,accentColor:"#20B2AA"},
    wild_stallion:{ bgType:"prairie",chrome:"dark_iron",winFX:"thunder_burst",   coins:["\uD83D\uDC0E","\uD83C\uDF1E","\u2B50","\uD83D\uDCB0"],       anticipation:"rumble",      intro:"dramatic" ,accentColor:"#8B4513"},
    celestial_cosmos:    { bgType:"cosmos",       chrome:"gem_frame",    winFX:"starburst",    coins:["\uD83C\uDF0C","\u2728","\uD83C\uDF1F","\uD83D\uDCB0"],       anticipation:"star_glow",   intro:"cosmic" },
    jade_prosperity:{ bgType:"chinese_sky",chrome:"jade_frame",winFX:"starburst", coins:["\uD83C\uDFEF","\uD83D\uDCB0","\uD83D\uDC8E","\u2728"],       anticipation:"golden_aura", intro:"mystic" ,accentColor:"#50C878"},
    inferno_fiesta:      { bgType:"flames",       chrome:"fire_border",  winFX:"firework_pop", coins:["\uD83D\uDD25","\uD83C\uDF89","\u2728","\uD83D\uDCB0"],       anticipation:"heat",        intro:"flash" }
  };
  Object.assign(PROFILES, PROFILES4);


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
    
  BG_RENDERERS.dark_vignette = function(ctx,w,h,t,acc){
    var g=ctx.createRadialGradient(w/2,h/2,0,w/2,h/2,w/1.5);g.addColorStop(0,'#2a2a2a');g.addColorStop(1,'#000');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
    for(var i=0;i<15;i++){var x=Math.random()*w,y=Math.random()*h,r=Math.random()*1.5,o=0.2+Math.sin(t*0.5+i)*0.15;ctx.fillStyle='rgba(255,255,255,'+o+')';ctx.beginPath();ctx.arc(x,y,r,0,6.28);ctx.fill();}
    ctx.fillStyle='rgba(0,0,0,'+(0.3+Math.sin(t)*0.1)+')';ctx.fillRect(0,0,w,h);
  };
  BG_RENDERERS.enchanted = function(ctx,w,h,t,acc){
    var g=ctx.createLinearGradient(0,0,0,h);g.addColorStop(0,'#1a0f3a');g.addColorStop(0.5,'#2d1b4e');g.addColorStop(1,'#0f0620');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
    for(var i=0;i<25;i++){var x=(i*w/25+Math.sin(t*0.3+i)*w*0.1)%w,y=(h*0.4+Math.cos(t*0.25+i)*h*0.2),r=2+Math.sin(t*0.5+i)*1;ctx.fillStyle='rgba(150,100,200,'+(0.4+Math.sin(t+i*0.5)*0.3)+')';ctx.beginPath();ctx.arc(x,y,r,0,6.28);ctx.fill();}
  };
  BG_RENDERERS.golden_sky = function(ctx,w,h,t,acc){
    var g=ctx.createLinearGradient(0,0,0,h);g.addColorStop(0,'#3a2a00');g.addColorStop(0.5,'#2a1a00');g.addColorStop(1,'#1a0f00');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
    for(var i=0;i<12;i++){var cx=w*(0.15+i*0.07)+Math.sin(t*0.1+i)*w*0.03,cy=h*(0.3+Math.cos(t*0.08+i)*0.15),r=w*0.06+Math.sin(t*0.12+i)*w*0.02;ctx.fillStyle='rgba(255,215,0,'+(0.15+Math.sin(t*0.2+i)*0.1)+')';ctx.beginPath();ctx.arc(cx,cy,r,0,6.28);ctx.fill();}
  };
  BG_RENDERERS.jungle_ruins = function(ctx,w,h,t,acc){
    var g=ctx.createLinearGradient(0,0,0,h);g.addColorStop(0,'#1a3a1a');g.addColorStop(1,'#0d1f0d');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
    for(var i=0;i<20;i++){var x=(i*w/20+Math.sin(t*0.4+i)*w*0.08)%w,y=Math.random()*h*0.8,r=1.5+Math.sin(t*0.6+i)*0.8;ctx.fillStyle='rgba(255,200,100,'+(0.5+Math.sin(t*0.5+i)*0.3)+')';ctx.beginPath();ctx.arc(x,y,r,0,6.28);ctx.fill();}
  };
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
    'default':      {border:'2px solid #555',shadow:'0 0 10px rgba(200,200,200,0.4)',bg:'linear-gradient(180deg,#111 0%,#080808 100%)'},
    'ancient_stone': {border:'3px solid #c9a96e',shadow:'0 0 15px rgba(150,120,80,0.6)',bg:'linear-gradient(180deg,#2a2218 0%,#15120c 100%)'},
    'arcade_neon':  {border:'3px solid #ff00ff',shadow:'0 0 20px #ff00ff,0 0 10px #00ffff',bg:'linear-gradient(180deg,#1a0033 0%,#0a0015 100%)'},
    'bamboo':       {border:'2px solid #7cb342',shadow:'0 0 12px rgba(100,140,50,0.5)',bg:'linear-gradient(180deg,#1a2a0a 0%,#0d150a 100%)'},
    'chrome_round': {border:'3px solid #c0c0c0',shadow:'0 0 15px rgba(200,200,200,0.5)',bg:'linear-gradient(180deg,#1a1a1a 0%,#0d0d0d 100%)'},
    'crystal_ball': {border:'3px solid #9370db',shadow:'0 0 20px rgba(147,112,219,0.7)',bg:'linear-gradient(180deg,#1a0040 0%,#0d0020 100%)'},
    'dark_iron':    {border:'3px solid #2c3e50',shadow:'0 0 15px rgba(0,150,200,0.4)',bg:'linear-gradient(180deg,#1a2530 0%,#0d1318 100%)'},
    'fiesta':       {border:'3px solid #ff6b00',shadow:'0 0 15px rgba(255,107,0,0.6)',bg:'linear-gradient(180deg,#2a1500 0%,#150a00 100%)'},
    'fire_border':  {border:'3px solid #ff4500',shadow:'0 0 20px rgba(255,69,0,0.7),0 0 10px rgba(255,140,0,0.5)',bg:'linear-gradient(180deg,#1a0500 0%,#0d0300 100%)'},
    'fishing':      {border:'2px solid #0077be',shadow:'0 0 12px rgba(0,119,190,0.5)',bg:'linear-gradient(180deg,#001a2a 0%,#000d15 100%)'},
    'gem_frame':    {border:'3px solid #4169e1',shadow:'0 0 20px rgba(65,105,225,0.6)',bg:'linear-gradient(180deg,#0d1a3a 0%,#060d1f 100%)'},
    'gold_ornate':  {border:'3px solid #ffd700',shadow:'0 0 20px rgba(255,215,0,0.7)',bg:'linear-gradient(180deg,#2a2000 0%,#151000 100%)'},
    'golden_gods':  {border:'3px solid #ffa500',shadow:'0 0 20px rgba(255,165,0,0.7),0 0 10px rgba(255,215,0,0.5)',bg:'linear-gradient(180deg,#1a0f00 0%,#0d0800 100%)'},
    'ice_crystal':  {border:'3px solid #4dd0e1',shadow:'0 0 20px rgba(77,208,225,0.6)',bg:'linear-gradient(180deg,#001a20 0%,#000d10 100%)'},
    'jade_frame':   {border:'3px solid #50c878',shadow:'0 0 15px rgba(80,200,120,0.5)',bg:'linear-gradient(180deg,#0a2a1a 0%,#051510 100%)'},
    'jester':       {border:'3px solid #9c27b0',shadow:'0 0 15px rgba(156,39,176,0.6),0 0 8px rgba(255,215,0,0.3)',bg:'linear-gradient(180deg,#1a0020 0%,#0d0010 100%)'},
    'kawaii_pink':  {border:'3px solid #ff69b4',shadow:'0 0 15px rgba(255,105,180,0.5)',bg:'linear-gradient(180deg,#2a0a1a 0%,#15050d 100%)'},
    'neon_round':   {border:'3px solid #00ff66',shadow:'0 0 20px #00ff66,0 0 10px #ff00ff',bg:'linear-gradient(180deg,#0a0a0a 0%,#050505 100%)'},
    'pirate_wood':  {border:'3px solid #8b4513',shadow:'0 0 12px rgba(139,69,19,0.6),0 0 6px rgba(255,215,0,0.2)',bg:'linear-gradient(180deg,#1a0f08 0%,#0d0804 100%)'},
    'rustic_wood':  {border:'2px solid #8b6f47',shadow:'0 0 12px rgba(139,111,71,0.5)',bg:'linear-gradient(180deg,#1a150d 0%,#0d0a06 100%)'},
    'stone_aztec':  {border:'3px solid #b8860b',shadow:'0 0 15px rgba(184,134,11,0.6)',bg:'linear-gradient(180deg,#1a1508 0%,#0d0a04 100%)'},
    'tech_hud':     {border:'2px solid #00ff88',shadow:'0 0 15px rgba(0,255,136,0.5),0 0 8px rgba(0,150,150,0.3)',bg:'linear-gradient(180deg,#001a1a 0%,#000d0d 100%)'},
    'viking_shield':{border:'3px solid #3a5a7a',shadow:'0 0 18px rgba(65,105,225,0.5)',bg:'linear-gradient(180deg,#0f1a2a 0%,#080d15 100%)'}
  };

  function applyChrome(container, profile) {
    var chromeKey = (profile && profile.chrome) || 'default';
    var style = CHROME_STYLES[chromeKey] || CHROME_STYLES['default'];
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
    avalanche:        function(x,y){ burstParticles('dot',x,y,50,'#b0c4de'); burstParticles('dot',x,y,20,'#ffffff'); },
    bat_burst:        function(x,y){ burstParticles('star',x,y,35,'#4a0080'); burstParticles('dot',x,y,15,'#8b008b'); },
    blood_burst:      function(x,y){ burstParticles('dot',x,y,40,'#cc0000'); burstParticles('dot',x,y,15,'#880000'); },
    bubble_burst:     function(x,y){ burstParticles('dot',x,y,30,'#87ceeb'); burstParticles('dot',x,y,20,'#b0e0e6'); },
    candy_burst:      function(x,y){ burstParticles('star',x,y,40,'#ff1493'); burstParticles('star',x,y,20,'#ffb6c1'); },
    card_shuffle:     function(x,y){ burstParticles('dot',x,y,25,'#cc0000'); burstParticles('dot',x,y,25,'#222222'); },
    confetti_pop:     function(x,y){ burstParticles('star',x,y,50,'#ff6b6b'); burstParticles('star',x,y,30,'#ffd700'); burstParticles('star',x,y,20,'#4169e1'); },
    crystal_pop:      function(x,y){ burstParticles('star',x,y,45,'#4dd0e1'); burstParticles('star',x,y,15,'#ffffff'); },
    dark_burst:       function(x,y){ burstParticles('dot',x,y,35,'#2c3e50'); burstParticles('dot',x,y,15,'#111111'); },
    diamond_shatter:  function(x,y){ burstParticles('star',x,y,50,'#ffffff'); burstParticles('star',x,y,25,'#b0e0e6'); },
    dna_spiral:       function(x,y){ burstParticles('dot',x,y,30,'#00ff00'); burstParticles('dot',x,y,20,'#0088ff'); },
    dragon_burst:     function(x,y){ burstParticles('star',x,y,50,'#ff4500'); burstParticles('star',x,y,30,'#ffa500'); setTimeout(function(){burstParticles('dot',x,y,20,'#ff6347');},100); },
    dust_cloud:       function(x,y){ burstParticles('dot',x,y,40,'#d3d3d3'); burstParticles('dot',x,y,20,'#a9a9a9'); },
    ember_burst:      function(x,y){ burstParticles('dot',x,y,35,'#ff4500'); burstParticles('dot',x,y,20,'#ffa500'); },
    energy_pulse:     function(x,y){ burstParticles('star',x,y,45,'#00ff00'); burstParticles('dot',x,y,25,'#00dd00'); },
    fairy_pop:        function(x,y){ burstParticles('star',x,y,40,'#ff69b4'); burstParticles('star',x,y,20,'#ffb6d9'); },
    feather_pop:      function(x,y){ burstParticles('dot',x,y,30,'#f5deb3'); burstParticles('dot',x,y,15,'#daa520'); },
    firework_pop:     function(x,y){ burstParticles('star',x,y,55,'#ff0000'); burstParticles('star',x,y,30,'#ffff00'); burstParticles('star',x,y,20,'#0000ff'); },
    frost_burst:      function(x,y){ burstParticles('star',x,y,40,'#b0e0e6'); burstParticles('star',x,y,20,'#f0ffff'); },
    fruit_pop:        function(x,y){ burstParticles('dot',x,y,35,'#ff6347'); burstParticles('dot',x,y,20,'#ffd700'); },
    gear_burst:       function(x,y){ burstParticles('dot',x,y,40,'#808080'); burstParticles('dot',x,y,15,'#c0c0c0'); },
    gem_shatter:      function(x,y){ burstParticles('star',x,y,50,'#9370db'); burstParticles('star',x,y,25,'#ba55d3'); },
    glitch_burst:     function(x,y){ burstParticles('dot',x,y,45,'#00ff00'); burstParticles('dot',x,y,20,'#ff0000'); },
    gold_shower:      function(x,y){ burstParticles('coin',x,y,50,'#ffd700'); burstParticles('star',x,y,20,'#ffee88'); },
    gunshot_pop:      function(x,y){ burstParticles('dot',x,y,30,'#696969'); burstParticles('dot',x,y,15,'#2f4f4f'); },
    heart_pop:        function(x,y){ burstParticles('star',x,y,40,'#ff1493'); burstParticles('star',x,y,20,'#ff69b4'); },
    ice_shatter:      function(x,y){ burstParticles('star',x,y,45,'#00bfff'); burstParticles('star',x,y,20,'#ffffff'); },
    laser_pop:        function(x,y){ burstParticles('dot',x,y,35,'#00ff00'); burstParticles('dot',x,y,15,'#ffff00'); },
    lava_pop:         function(x,y){ burstParticles('dot',x,y,40,'#ff4500'); burstParticles('dot',x,y,20,'#ff6347'); },
    leaf_burst:       function(x,y){ burstParticles('dot',x,y,35,'#228b22'); burstParticles('dot',x,y,20,'#7cb342'); },
    lightning_strike: function(x,y){ burstParticles('star',x,y,40,'#ffff00'); burstParticles('dot',x,y,25,'#ffffff'); setTimeout(function(){burstParticles('dot',x,y,15,'#0088ff');},80); },
    magic_swirl:      function(x,y){ burstParticles('star',x,y,45,'#9370db'); burstParticles('star',x,y,25,'#ba55d3'); },
    moon_burst:       function(x,y){ burstParticles('dot',x,y,30,'#ffffff'); burstParticles('dot',x,y,15,'#f0f8ff'); },
    moon_howl:        function(x,y){ burstParticles('star',x,y,35,'#ffffff'); burstParticles('dot',x,y,20,'#dda0dd'); },
    mystic_burst:     function(x,y){ burstParticles('star',x,y,40,'#6a0dad'); burstParticles('star',x,y,20,'#9370db'); },
    neon_pop:         function(x,y){ burstParticles('star',x,y,45,'#ff00ff'); burstParticles('star',x,y,20,'#00ffff'); },
    panda_pop:        function(x,y){ burstParticles('dot',x,y,35,'#222222'); burstParticles('dot',x,y,20,'#ffffff'); },
    phoenix_burst:    function(x,y){ burstParticles('star',x,y,50,'#ff4500'); burstParticles('star',x,y,30,'#ffa500'); setTimeout(function(){burstParticles('dot',x,y,25,'#ff6347');},120); },
    rainbow_burst:    function(x,y){ burstParticles('star',x,y,35,'#ff0000'); burstParticles('star',x,y,25,'#ffff00'); setTimeout(function(){burstParticles('star',x,y,20,'#00ff00');burstParticles('star',x,y,20,'#0000ff');},100); },
    sakura_burst:     function(x,y){ burstParticles('dot',x,y,40,'#ff69b4'); burstParticles('dot',x,y,20,'#ffb6d9'); },
    sand_burst:       function(x,y){ burstParticles('dot',x,y,45,'#d2b48c'); burstParticles('dot',x,y,20,'#c9a96e'); },
    shamrock_pop:     function(x,y){ burstParticles('star',x,y,35,'#00aa00'); burstParticles('dot',x,y,20,'#00ff00'); },
    shuriken_pop:     function(x,y){ burstParticles('dot',x,y,40,'#696969'); burstParticles('dot',x,y,15,'#ff6347'); },
    slime_burst:      function(x,y){ burstParticles('dot',x,y,40,'#7cb342'); burstParticles('dot',x,y,20,'#9ccc65'); },
    smoke_burst:      function(x,y){ burstParticles('dot',x,y,45,'#808080'); burstParticles('dot',x,y,25,'#a9a9a9'); },
    solar_burst:      function(x,y){ burstParticles('star',x,y,50,'#ffff00'); burstParticles('star',x,y,25,'#ffa500'); },
    splash:           function(x,y){ burstParticles('dot',x,y,40,'#0077be'); burstParticles('dot',x,y,20,'#00bfff'); },
    starburst:        function(x,y){ burstParticles('star',x,y,55,'#ffd700'); burstParticles('star',x,y,30,'#ffee88'); },
    sword_clash:      function(x,y){ burstParticles('dot',x,y,35,'#c0c0c0'); burstParticles('dot',x,y,20,'#ff6347'); },
    thunder_burst:    function(x,y){ burstParticles('star',x,y,40,'#ffff00'); burstParticles('dot',x,y,25,'#4169e1'); },
    treasure_pop:     function(x,y){ burstParticles('coin',x,y,45,'#ffd700'); burstParticles('star',x,y,25,'#ffee88'); },
    tropical_pop:     function(x,y){ burstParticles('dot',x,y,40,'#ff6347'); burstParticles('dot',x,y,20,'#ffa500'); }
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
    var type = (profile && profile.intro) || 'flash';
    var acc = (profile && profile.accentColor) || '#FFD700';
    var ov = document.createElement('div');
    ov.className = 'upx-freespins-overlay upx-fsi-'+type;
    var FSI_ANIMS = {
      dramatic:'upx-fsi-pop 0.6s cubic-bezier(0.175,0.885,0.32,1.275)',
      epic:'upx-fsi-explode 0.7s cubic-bezier(0.175,0.885,0.32,1.275)',
      flash:'upx-fsi-pop 0.3s ease-out',
      cosmic:'upx-fsi-spin 0.8s ease-out',
      sweet:'upx-fsi-pop 0.5s ease-out',
      mystic:'upx-fsi-slide 0.6s ease-out',
      watery:'upx-fsi-slide 0.7s ease-in-out',
      inferno:'upx-fsi-explode 0.5s ease-out',
      thunder:'upx-fsi-pop 0.2s ease-out',
      royal:'upx-fsi-slide 0.8s cubic-bezier(0.175,0.885,0.32,1.275)',
      neon:'upx-fsi-glitch 0.5s ease-out',
      ancient:'upx-fsi-slide 0.9s ease-out',
      wild:'upx-fsi-explode 0.6s cubic-bezier(0.175,0.885,0.32,1.275)',
      dark:'upx-fsi-pop 0.7s ease-in',
      carnival:'upx-fsi-spin 0.6s ease-out',
      frozen:'upx-fsi-slide 0.5s ease-out',
      samurai:'upx-fsi-pop 0.4s ease-out',
      pirate:'upx-fsi-spin 0.7s ease-out',
      cyber:'upx-fsi-glitch 0.4s steps(8)',
      jungle:'upx-fsi-slide 0.6s ease-out'
    };
    var FSI_BGS = {
      dramatic:'radial-gradient(circle,rgba(0,0,0,0.9) 0%,rgba(0,0,0,0.7) 100%)',
      epic:'radial-gradient(circle,rgba(30,0,60,0.9) 0%,rgba(0,0,0,0.8) 100%)',
      flash:'radial-gradient(circle,rgba(50,50,0,0.85) 0%,rgba(0,0,0,0.7) 100%)',
      cosmic:'radial-gradient(circle,rgba(20,0,50,0.9) 0%,rgba(0,0,30,0.8) 100%)',
      sweet:'radial-gradient(circle,rgba(60,0,40,0.85) 0%,rgba(30,0,20,0.7) 100%)',
      mystic:'radial-gradient(circle,rgba(30,0,60,0.9) 0%,rgba(10,0,20,0.8) 100%)',
      watery:'radial-gradient(circle,rgba(0,20,50,0.9) 0%,rgba(0,10,30,0.8) 100%)',
      inferno:'radial-gradient(circle,rgba(60,10,0,0.9) 0%,rgba(20,0,0,0.8) 100%)',
      thunder:'radial-gradient(circle,rgba(40,40,0,0.85) 0%,rgba(0,0,0,0.8) 100%)',
      royal:'radial-gradient(circle,rgba(40,0,60,0.9) 0%,rgba(10,0,20,0.8) 100%)',
      neon:'radial-gradient(circle,rgba(10,0,20,0.9) 0%,rgba(0,0,0,0.85) 100%)',
      ancient:'radial-gradient(circle,rgba(40,30,10,0.9) 0%,rgba(15,10,0,0.8) 100%)',
      wild:'radial-gradient(circle,rgba(30,15,0,0.9) 0%,rgba(0,0,0,0.8) 100%)',
      dark:'radial-gradient(circle,rgba(0,0,0,0.95) 0%,rgba(10,0,10,0.9) 100%)',
      carnival:'radial-gradient(circle,rgba(50,0,30,0.85) 0%,rgba(0,0,0,0.7) 100%)',
      frozen:'radial-gradient(circle,rgba(0,30,50,0.9) 0%,rgba(0,10,20,0.8) 100%)',
      samurai:'radial-gradient(circle,rgba(20,0,0,0.9) 0%,rgba(0,0,0,0.8) 100%)',
      pirate:'radial-gradient(circle,rgba(30,15,0,0.9) 0%,rgba(10,5,0,0.8) 100%)',
      cyber:'radial-gradient(circle,rgba(0,20,20,0.9) 0%,rgba(0,0,0,0.85) 100%)',
      jungle:'radial-gradient(circle,rgba(0,30,10,0.9) 0%,rgba(0,10,0,0.8) 100%)'
    };
    var anim = FSI_ANIMS[type] || FSI_ANIMS.flash;
    var bg = FSI_BGS[type] || 'radial-gradient(circle,rgba(0,0,0,0.85) 0%,rgba(0,0,0,0.7) 100%)';
    ov.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:80;display:flex;align-items:center;justify-content:center;flex-direction:column;pointer-events:none;background:'+bg+';';
    ov.innerHTML = '<div class="upx-fsi-title" style="font-size:3em;font-weight:900;color:'+acc+';text-shadow:0 0 30px '+acc+',0 0 60px '+acc+';animation:'+anim+'">FREE SPINS!</div>'
      +'<div class="upx-fsi-count" style="font-size:5em;font-weight:900;color:#fff;text-shadow:0 0 20px '+acc+',0 0 40px '+acc+';animation:'+anim+'">'+count+'</div>';
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
      '@keyframes upx-antic-pulse{from{opacity:0.7}to{opacity:1}}',
      '@keyframes upx-antic-rumble{0%{transform:translate(-2px,0)}25%{transform:translate(2px,1px)}50%{transform:translate(-1px,-1px)}75%{transform:translate(1px,2px)}100%{transform:translate(-2px,0)}}',
      '@keyframes upx-antic-fire{from{filter:brightness(1.3) drop-shadow(0 0 15px #ff4500)}to{filter:brightness(1.7) drop-shadow(0 0 25px #ff6347)}}',
      '@keyframes upx-antic-thunder{0%{filter:brightness(1) drop-shadow(0 0 5px #ffff00)}50%{filter:brightness(3) drop-shadow(0 0 40px #ffffff)}100%{filter:brightness(1) drop-shadow(0 0 5px #ffff00)}}',
      '@keyframes upx-antic-sparkle{0%{filter:brightness(1.3) drop-shadow(0 0 8px #ffd700)}33%{filter:brightness(1.6) drop-shadow(0 0 15px #ffee88)}66%{filter:brightness(1.2) drop-shadow(0 0 6px #ffa500)}100%{filter:brightness(1.3) drop-shadow(0 0 8px #ffd700)}}',
      '@keyframes upx-antic-heat{from{filter:brightness(1.2) drop-shadow(0 0 12px #ff4500)}to{filter:brightness(1.5) drop-shadow(0 0 22px #ff6347) blur(0.3px)}}',
      '@keyframes upx-antic-sandstorm{from{filter:brightness(1.1) sepia(0.3)}to{filter:brightness(1.3) sepia(0.6) blur(0.3px)}}',
      '@keyframes upx-antic-joker{from{filter:hue-rotate(0deg) brightness(1.3)}to{filter:hue-rotate(360deg) brightness(1.5)}}',
      '@keyframes upx-antic-wave{0%{transform:translateY(0);filter:brightness(1.2)}50%{transform:translateY(-3px);filter:brightness(1.4) drop-shadow(0 0 15px #00bfff)}100%{transform:translateY(0);filter:brightness(1.2)}}',
      '@keyframes upx-antic-freeze{from{filter:brightness(1.3) saturate(1.2) drop-shadow(0 0 12px #00ffff)}to{filter:brightness(1.6) saturate(2) drop-shadow(0 0 25px #b0e0e6)}}',
      '@keyframes upx-antic-neon{0%{filter:brightness(1.4) drop-shadow(0 0 12px #ff00ff)}50%{filter:brightness(1.8) drop-shadow(0 0 20px #00ffff)}100%{filter:brightness(1.4) drop-shadow(0 0 12px #ff00ff)}}',
      '@keyframes upx-antic-cosmic{0%{filter:brightness(1.2) drop-shadow(0 0 10px #6a5acd)}33%{filter:brightness(1.5) drop-shadow(0 0 20px #483d8b)}66%{filter:brightness(1.3) drop-shadow(0 0 15px #7b68ee)}100%{filter:brightness(1.2) drop-shadow(0 0 10px #6a5acd)}}',
      '@keyframes upx-antic-wild{from{transform:scale(1);filter:brightness(1.3)}to{transform:scale(1.03);filter:brightness(1.6) drop-shadow(0 0 15px #ff6347)}}',
      '@keyframes upx-antic-candy{0%{filter:brightness(1.3) drop-shadow(0 0 10px #ff69b4)}50%{filter:brightness(1.5) drop-shadow(0 0 15px #ff1493) drop-shadow(0 0 8px #ffb6c1)}100%{filter:brightness(1.3) drop-shadow(0 0 10px #ff69b4)}}',
      '@keyframes upx-fsi-slide{from{transform:translateY(-100%) scale(0.8);opacity:0}to{transform:translateY(0) scale(1);opacity:1}}',
      '@keyframes upx-fsi-explode{0%{transform:scale(0);opacity:0}60%{transform:scale(1.3);opacity:1}100%{transform:scale(1);opacity:1}}',
      '@keyframes upx-fsi-spin{from{transform:rotate(-180deg) scale(0);opacity:0}to{transform:rotate(0) scale(1);opacity:1}}',
      '@keyframes upx-fsi-glitch{0%{transform:translate(0);filter:hue-rotate(0)}25%{transform:translate(-5px,3px);filter:hue-rotate(90deg)}50%{transform:translate(3px,-2px);filter:hue-rotate(180deg)}75%{transform:translate(-2px,-3px);filter:hue-rotate(270deg)}100%{transform:translate(0);filter:hue-rotate(360deg)}}',
      '.upx-shake{animation:upx-shake 0.5s ease-in-out}',
      '.upx-anticipation{transition:all 0.3s}',
      '.upx-anticipation-electric{filter:brightness(1.6) drop-shadow(0 0 15px #00aaff) drop-shadow(0 0 8px #ffffff);animation:upx-antic-pulse 0.4s ease-in-out infinite alternate}',
      '.upx-anticipation-dark_pulse{filter:brightness(0.7) drop-shadow(0 0 20px #6a0dad) drop-shadow(0 0 10px #330066);animation:upx-antic-pulse 0.5s ease-in-out infinite alternate}',
      '.upx-anticipation-rumble{animation:upx-antic-rumble 0.15s linear infinite;filter:brightness(1.2)}',
      '.upx-anticipation-sparkle{filter:brightness(1.5) drop-shadow(0 0 12px #ffee88) drop-shadow(0 0 6px #ffd700);animation:upx-antic-sparkle 0.6s ease-in-out infinite}',
      '.upx-anticipation-heat{filter:brightness(1.3) drop-shadow(0 0 18px #ff4500) drop-shadow(0 0 8px #ff6347);animation:upx-antic-heat 0.5s ease-in-out infinite alternate}',
      '.upx-anticipation-thunder{filter:brightness(2) drop-shadow(0 0 25px #ffff00);animation:upx-antic-thunder 0.3s steps(2) infinite}',
      '.upx-anticipation-star_glow{filter:brightness(1.4) drop-shadow(0 0 14px #ffd700) drop-shadow(0 0 25px #ffa500);animation:upx-antic-pulse 0.7s ease-in-out infinite alternate}',
      '.upx-anticipation-dragon_glow{filter:brightness(1.5) drop-shadow(0 0 20px #ff4500) drop-shadow(0 0 10px #ff8c00);animation:upx-antic-fire 0.3s ease-in-out infinite alternate}',
      '.upx-anticipation-pulse_blue{filter:brightness(1.3) drop-shadow(0 0 15px #4169e1);animation:upx-antic-pulse 0.6s ease-in-out infinite alternate}',
      '.upx-anticipation-sand_storm{filter:brightness(1.2) sepia(0.4) blur(0.5px);animation:upx-antic-sandstorm 0.4s ease-in-out infinite alternate}',
      '.upx-anticipation-gem_glow{filter:brightness(1.5) drop-shadow(0 0 15px #9370db) drop-shadow(0 0 8px #ba55d3);animation:upx-antic-pulse 0.5s ease-in-out infinite alternate}',
      '.upx-anticipation-spin_joker{filter:brightness(1.4) hue-rotate(90deg);animation:upx-antic-joker 1s linear infinite}',
      '.upx-anticipation-pulse_red{filter:brightness(1.3) drop-shadow(0 0 15px #ff0000) drop-shadow(0 0 8px #cc0000);animation:upx-antic-pulse 0.5s ease-in-out infinite alternate}',
      '.upx-anticipation-pulse_green{filter:brightness(1.3) drop-shadow(0 0 15px #00ff00) drop-shadow(0 0 8px #00cc00);animation:upx-antic-pulse 0.5s ease-in-out infinite alternate}',
      '.upx-anticipation-moon_glow{filter:brightness(1.3) drop-shadow(0 0 20px #ffffff) drop-shadow(0 0 10px #c0c0ff);animation:upx-antic-pulse 0.8s ease-in-out infinite alternate}',
      '.upx-anticipation-wave_crash{filter:brightness(1.2) drop-shadow(0 0 12px #00bfff);animation:upx-antic-wave 0.6s ease-in-out infinite}',
      '.upx-anticipation-frost_glow{filter:brightness(1.4) drop-shadow(0 0 15px #00ffff) drop-shadow(0 0 8px #b0e0e6);animation:upx-antic-pulse 0.6s ease-in-out infinite alternate}',
      '.upx-anticipation-pulse_pink{filter:brightness(1.3) drop-shadow(0 0 15px #ff69b4) drop-shadow(0 0 8px #ff1493);animation:upx-antic-pulse 0.5s ease-in-out infinite alternate}',
      '.upx-anticipation-freeze{filter:brightness(1.5) saturate(1.5) drop-shadow(0 0 20px #00ffff);animation:upx-antic-freeze 0.4s ease-in-out infinite alternate}',
      '.upx-anticipation-neon_flash{filter:brightness(1.6) drop-shadow(0 0 15px #ff00ff) drop-shadow(0 0 8px #00ffff);animation:upx-antic-neon 0.3s ease-in-out infinite alternate}',
      '.upx-anticipation-blood_pulse{filter:brightness(0.8) drop-shadow(0 0 20px #cc0000) drop-shadow(0 0 10px #660000);animation:upx-antic-pulse 0.4s ease-in-out infinite alternate}',
      '.upx-anticipation-cosmic_hum{filter:brightness(1.4) drop-shadow(0 0 20px #6a5acd) drop-shadow(0 0 10px #483d8b);animation:upx-antic-cosmic 1.2s ease-in-out infinite}',
      '.upx-anticipation-golden_aura{filter:brightness(1.5) drop-shadow(0 0 18px #ffd700) drop-shadow(0 0 30px #ffa500);animation:upx-antic-pulse 0.6s ease-in-out infinite alternate}',
      '.upx-anticipation-jungle_drum{filter:brightness(1.2) drop-shadow(0 0 12px #228b22);animation:upx-antic-rumble 0.2s linear infinite}',
      '.upx-anticipation-pirate_warn{filter:brightness(1.3) sepia(0.5) drop-shadow(0 0 12px #ffd700);animation:upx-antic-pulse 0.5s ease-in-out infinite alternate}',
      '.upx-anticipation-royal_glow{filter:brightness(1.4) drop-shadow(0 0 15px #9400d3) drop-shadow(0 0 25px #4b0082);animation:upx-antic-pulse 0.7s ease-in-out infinite alternate}',
      '.upx-anticipation-wild_pulse{filter:brightness(1.5) drop-shadow(0 0 15px #ff6347);animation:upx-antic-wild 0.3s ease-in-out infinite alternate}',
      '.upx-anticipation-lava_glow{filter:brightness(1.3) drop-shadow(0 0 20px #ff4500) drop-shadow(0 0 10px #ff0000);animation:upx-antic-fire 0.4s ease-in-out infinite alternate}',
      '.upx-anticipation-crystal_ring{filter:brightness(1.6) drop-shadow(0 0 12px #e0e0ff) drop-shadow(0 0 20px #9370db);animation:upx-antic-pulse 0.5s ease-in-out infinite alternate}',
      '.upx-anticipation-candy_pulse{filter:brightness(1.4) drop-shadow(0 0 12px #ff69b4) drop-shadow(0 0 8px #ff1493);animation:upx-antic-candy 0.4s ease-in-out infinite}'
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

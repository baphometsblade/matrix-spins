#!/usr/bin/env python3
"""
Matrix Spins Casino - Per-Game GUI Asset Generator
Generates unique HD UI textures for each of 150 slot games using local Fooocus SDXL.

Assets per game:
  - reel_frame.png     (1280x720) - Decorative frame overlay for the reel area
  - spin_btn.png       (256x256)  - Unique spin button texture
  - top_bar.png        (1280x120) - Textured header bar
  - bottom_bar.png     (1280x120) - Textured control bar
  - panel_bg.png       (512x512)  - Tileable panel/info background texture

Each game gets a unique art style matching its theme.
"""
import json, os, sys, time, traceback, shutil
from pathlib import Path

# ── Config ──────────────────────────────────────────────────────────────────
BASE_OUT = Path(r"C:\Users\markm\casino_assets\gui_assets")
PROGRESS_FILE = BASE_OUT / "gui_progress.json"
LOG_FILE = BASE_OUT / "gui_generate.log"
NEG = "text, letters, words, numbers, watermark, signature, low quality, blurry, deformed, ugly, amateur, nsfw, nudity, human, face, person"

ASSET_TYPES = {
    'reel_frame': {
        'aspect': '1280\u00d7720',
        'suffix': '_frame',
        'prompt_template': 'ornate decorative frame border overlay, {theme_desc}, intricate {art_style} frame design, transparent center, elaborate corner ornaments, {material} material texture, {color_desc}, game UI frame asset, ultra detailed, 4k quality, seamless edges',
    },
    'spin_btn': {
        'aspect': '1024\u00d71024',
        'suffix': '_btn',
        'prompt_template': 'circular button design, {theme_desc}, {art_style} style ornate round button, {material} texture, glowing {color_desc} accents, embossed center symbol, game UI spin button, 3D rendered, ultra detailed, centered composition',
    },
    'top_bar': {
        'aspect': '1280\u00d7720',
        'suffix': '_topbar',
        'prompt_template': 'horizontal decorative banner header bar, {theme_desc}, {art_style} ornamental strip design, {material} texture, {color_desc} color scheme, intricate border pattern, game UI header bar asset, ultra detailed, seamless horizontal',
    },
    'bottom_bar': {
        'aspect': '1280\u00d7720',
        'suffix': '_bottombar',
        'prompt_template': 'horizontal decorative control panel bar, {theme_desc}, {art_style} ornamental strip, {material} texture with embedded gem slots, {color_desc}, game UI control bar, ultra detailed, seamless horizontal',
    },
    'panel_bg': {
        'aspect': '1024\u00d71024',
        'suffix': '_panel',
        'prompt_template': 'seamless tileable texture pattern, {theme_desc}, {art_style} background texture, {material} surface, subtle {color_desc} pattern, game UI panel background, high quality seamless tile, muted elegant',
    },
}

# ── Per-Game Art Style Definitions ──────────────────────────────────────────
# Each game gets: theme_desc, art_style, material, color_desc
GAME_STYLES = {
    'sugar_rush': {'theme_desc': 'candy kingdom magical sweets', 'art_style': 'cartoon style, bold outlines, flat colors, animated movie style, vibrant candy illustration', 'material': 'crystallized sugar and candy glass', 'color_desc': 'pink magenta and golden candy'},
    'lucky_777': {'theme_desc': 'retro neon fruit machine', 'art_style': 'retro cartoon style, bold outlines, flat diner graphic, vintage arcade illustration', 'material': 'chrome and neon tube', 'color_desc': 'hot pink and electric purple neon'},
    'gates_olympus': {'theme_desc': 'ancient greek olympus temple', 'art_style': 'dramatic cinematic oil painting, golden hour lighting, ultra detailed, 8k', 'material': 'white marble and gold leaf', 'color_desc': 'celestial blue and divine gold'},
    'black_bull': {'theme_desc': 'wild west rodeo arena', 'art_style': 'vintage western poster art, worn texture, folk art style, retro rodeo illustration', 'material': 'distressed leather and iron', 'color_desc': 'deep crimson and burnished bronze'},
    'hot_chillies': {'theme_desc': 'mexican fiesta cantina', 'art_style': 'cartoon style, bold outlines, vibrant folk art illustration, flat festive graphic', 'material': 'hand-painted ceramic tile', 'color_desc': 'fiery red and warm orange'},
    'super_hot': {'theme_desc': 'blazing fire fruit machine', 'art_style': 'retro cartoon style, bold flat colors, 1950s diner graphic, vintage slot machine art', 'material': 'polished brass and flame', 'color_desc': 'amber gold and flame orange'},
    'wolf_gold': {'theme_desc': 'native american wilderness', 'art_style': 'painterly nature illustration, children’s book style, lush painted wildlife art', 'material': 'carved cedar wood and turquoise', 'color_desc': 'golden amber and forest brown'},
    'big_bass': {'theme_desc': 'lakeside fishing adventure', 'art_style': 'nautical maritime watercolor', 'material': 'weathered driftwood and rope', 'color_desc': 'ocean teal and sandy beige'},
    'fire_joker': {'theme_desc': 'circus fire performance', 'art_style': 'dark carnival cartoon style, bold outlines, stylized circus illustration, flat graphic', 'material': 'velvet and brass circus', 'color_desc': 'crimson red and midnight purple'},
    'book_dead': {'theme_desc': 'ancient egyptian tomb', 'art_style': 'dramatic cinematic oil painting, Egyptian golden hour lighting, ultra detailed, 8k', 'material': 'sandstone and gold inlay', 'color_desc': 'amber gold and lapis blue'},
    'starburst_xxl': {'theme_desc': 'cosmic space nebula gems', 'art_style': 'synthwave art, neon colors, retrowave, glowing neon outlines, 80s sci-fi aesthetic', 'material': 'holographic crystal and plasma', 'color_desc': 'prismatic rainbow and cosmic purple'},
    'sweet_bonanza': {'theme_desc': 'candy explosion dreamworld', 'art_style': 'kawaii cartoon style, bold outlines, flat pastel colors, cute candy illustration', 'material': 'frosted sugar glass and sprinkles', 'color_desc': 'pastel pink and lavender'},
    'starlight_princess': {'theme_desc': 'celestial magical princess palace', 'art_style': 'anime style, cel shading, magical girl manga art, clean linework, JRPG style', 'material': 'crystal star and moonstone', 'color_desc': 'ethereal pink and celestial cyan'},
    'reactoonz': {'theme_desc': 'alien reactor laboratory', 'art_style': 'cartoon style, bold outlines, animated alien blob art, flat sci-fi illustration', 'material': 'glowing alien goo and metal', 'color_desc': 'electric lime and alien purple'},
    'gonzos_quest': {'theme_desc': 'ancient mayan jungle temple', 'art_style': 'dramatic cinematic adventure painting, Mayan jungle lighting, ultra detailed, 8k', 'material': 'moss-covered stone and gold', 'color_desc': 'jungle green and ancient gold'},
    'dead_alive': {'theme_desc': 'undead wild west ghost town', 'art_style': 'dark gothic illustration, Tim Burton-esque western, expressionist dramatic shadows', 'material': 'rusted iron and bone', 'color_desc': 'sickly green and dried blood red'},
    'buffalo_stampede': {'theme_desc': 'great plains thunderstorm', 'art_style': 'western landscape oil painting', 'material': 'weathered rawhide and copper', 'color_desc': 'sunset orange and earth brown'},
    'extra_chilli': {'theme_desc': 'explosive mexican fiesta', 'art_style': 'cartoon style, bold outlines, Day of the Dead folk art illustration, flat graphic', 'material': 'painted terracotta and papel picado', 'color_desc': 'hot pepper red and fiesta yellow'},
    'big_bamboo': {'theme_desc': 'chinese bamboo forest', 'art_style': 'anime style, cel shading, manga art, clean linework, serene JRPG illustration', 'material': 'bamboo and jade stone', 'color_desc': 'emerald green and bamboo gold'},
    'dragon_megafire': {'theme_desc': 'dragon fire treasure lair', 'art_style': 'dark fantasy illustration, high fantasy dragon art, dramatic painted style', 'material': 'dragon scale and molten gold', 'color_desc': 'molten orange and obsidian black'},
    'wanted_dead': {'theme_desc': 'dusty wild west bounty', 'art_style': 'vintage western poster art, aged parchment texture, folk art style', 'material': 'aged parchment and rusty nail', 'color_desc': 'sepia brown and dusty gold'},
    'tombstone_reload': {'theme_desc': 'graveyard western gothic', 'art_style': 'dark gothic illustration, Victorian expressionist engraving, dramatic shadows', 'material': 'weathered tombstone granite', 'color_desc': 'moonlit grey and ghostly white'},
    'money_train': {'theme_desc': 'steam train heist robbery', 'art_style': 'hand-drawn steampunk adventure illustration, ink and watercolor, vintage travel art', 'material': 'riveted steel and steam pipe', 'color_desc': 'industrial copper and smoke grey'},
    'san_quentin': {'theme_desc': 'maximum security prison', 'art_style': 'gritty comic book art, bold lines, urban concrete illustration, noir style', 'material': 'concrete and chain link', 'color_desc': 'prison grey and warning orange'},
    'fat_rabbit': {'theme_desc': 'whimsical vegetable garden', 'art_style': 'storybook illustration, children’s book watercolor art, whimsical painted', 'material': 'painted wood and garden vine', 'color_desc': 'carrot orange and leaf green'},
    'fruit_party': {'theme_desc': 'tropical fruit beach party', 'art_style': 'cartoon style, bold outlines, flat tropical colors, animated movie style', 'material': 'polished tropical wood and shell', 'color_desc': 'tropical pink and mango yellow'},
    'jammin_fruits': {'theme_desc': 'funky disco music stage', 'art_style': 'cartoon style, 1970s disco illustration, bold flat graphic, retro funky art', 'material': 'glitter vinyl and disco ball', 'color_desc': 'disco gold and funk purple'},
    'wild_toro': {'theme_desc': 'spanish bullfighting arena', 'art_style': 'vintage Spanish bullfighting poster art, folk art style, bold graphic illustration', 'material': 'embossed leather and gold filigree', 'color_desc': 'matador red and arena gold'},
    'great_rhino': {'theme_desc': 'african savanna sunset', 'art_style': 'painterly nature illustration, children’s book style, lush African wildlife art', 'material': 'carved ebony and copper wire', 'color_desc': 'savanna gold and earth sienna'},
    'razor_shark': {'theme_desc': 'deep ocean predator abyss', 'art_style': 'soft watercolor illustration, Studio Ghibli ocean feel, loose brushwork, aquatic art', 'material': 'coral reef and deep sea metal', 'color_desc': 'abyssal blue and bioluminescent cyan'},
    'chilli_heat': {'theme_desc': 'desert mexican marketplace', 'art_style': 'cartoon style, bold outlines, colorful Mexican folk art, flat festive illustration', 'material': 'painted ceramic mosaic tile', 'color_desc': 'terracotta red and cactus green'},
    'madame_destiny': {'theme_desc': 'mystical fortune teller tent', 'art_style': 'art nouveau mystic illustration, hand-drawn decorative, ornate flat design', 'material': 'velvet and crystal ball glass', 'color_desc': 'deep purple and mystic silver'},
    'cleopatra_gold': {'theme_desc': 'egyptian queen palace', 'art_style': 'dramatic cinematic oil painting, Egyptian royal golden hour, ultra detailed, 8k', 'material': 'polished gold and lapis lazuli', 'color_desc': 'royal gold and nile blue'},
    'pharaoh_legacy': {'theme_desc': 'pharaoh pyramid dynasty', 'art_style': 'dramatic cinematic oil painting, ancient Egyptian desert light, ultra detailed, 8k', 'material': 'limestone and gold paint', 'color_desc': 'desert sand and pharaoh gold'},
    'golden_pharaoh': {'theme_desc': 'pharaoh treasure vault', 'art_style': 'dramatic cinematic oil painting, pharaoh treasure golden light, ultra detailed, 8k', 'material': 'solid gold and gemstone inlay', 'color_desc': 'pure gold and ruby red'},
    'pharaoh_march': {'theme_desc': 'egyptian army war march', 'art_style': 'dramatic cinematic oil painting, Egyptian military fresco style, ultra detailed, 8k', 'material': 'bronze armor and papyrus', 'color_desc': 'bronze and desert tan'},
    'viking_voyage': {'theme_desc': 'norse viking longship', 'art_style': 'hand-drawn adventure style, ink and watercolor, Norse knotwork illustration', 'material': 'oak wood and iron rivets', 'color_desc': 'storm grey and viking red'},
    'norse_vaults': {'theme_desc': 'norse ice treasure cavern', 'art_style': 'hand-drawn Norse illustration, ink art, frost rune watercolor style', 'material': 'ice crystal and enchanted iron', 'color_desc': 'frost blue and rune silver'},
    'gemhalla': {'theme_desc': 'gemstone valhalla mead hall', 'art_style': 'watercolor fantasy art, soft washes, loose brushwork, Norse painted illustration', 'material': 'crystal and enchanted silver', 'color_desc': 'gemstone multi-color and silver'},
    'olympus_rising': {'theme_desc': 'olympus mountain storm', 'art_style': 'dramatic cinematic oil painting, divine Olympus golden light, ultra detailed, 8k', 'material': 'marble column and gold laurel', 'color_desc': 'royal blue and divine gold'},
    'puppy_palace': {'theme_desc': 'adorable puppy kingdom', 'art_style': 'storybook illustration, children’s book art, whimsical cute painted style', 'material': 'soft plush and paw print', 'color_desc': 'warm brown and puppy pink'},
    'crimson_fang': {'theme_desc': 'vampire gothic castle', 'art_style': 'dark gothic illustration, Tim Burton-esque expressionist, dramatic shadows, macabre art', 'material': 'black velvet and blood crystal', 'color_desc': 'blood crimson and midnight black'},
    'diamond_vault': {'theme_desc': 'luxury diamond heist vault', 'art_style': 'art deco style, geometric gold patterns, elegant flat illustration, luxury design', 'material': 'polished chrome and diamond', 'color_desc': 'platinum silver and diamond white'},
    'neon_nights': {'theme_desc': 'cyberpunk neon city', 'art_style': 'synthwave art, neon colors, retrowave, glowing neon outlines, 80s cyberpunk aesthetic', 'material': 'holographic glass and neon tube', 'color_desc': 'neon pink and electric blue'},
    'dragon_coins': {'theme_desc': 'chinese dragon treasure', 'art_style': 'anime style, cel shading, Chinese manga art, clean linework, JRPG art style', 'material': 'red lacquer and gold coin', 'color_desc': 'imperial red and dragon gold'},
    'jade_temple': {'theme_desc': 'ancient jade buddhist temple', 'art_style': 'anime style, cel shading, manga art, clean temple linework, JRPG illustration', 'material': 'polished jade and bronze', 'color_desc': 'jade green and temple bronze'},
    'lucky_dragon': {'theme_desc': 'lucky golden dragon', 'art_style': 'anime style, cel shading, Chinese New Year manga art, clean linework', 'material': 'red silk and gold thread', 'color_desc': 'lucky red and prosperity gold'},
    'pirate_fortune': {'theme_desc': 'pirate treasure island', 'art_style': 'hand-drawn adventure map style, ink and watercolor, treasure map aesthetic', 'material': 'weathered ship wood and rope', 'color_desc': 'ocean blue and treasure gold'},
    'enchanted_grove': {'theme_desc': 'magical forest fairy grove', 'art_style': 'storybook illustration, watercolor fantasy art, whimsical hand-painted', 'material': 'enchanted bark and flower petal', 'color_desc': 'fairy green and blossom pink'},
    'crystal_royals': {'theme_desc': 'royal crystal palace', 'art_style': 'storybook illustration, watercolor fantasy art, hand-painted crystal palace', 'material': 'cut crystal and platinum', 'color_desc': 'crystal clear and royal purple'},
    'gold_rush_frog': {'theme_desc': 'golden frog treasure pond', 'art_style': 'storybook illustration, hand-drawn ink and watercolor, fairy tale art', 'material': 'lily pad green and gold coin', 'color_desc': 'frog green and gold'},
    'phoenix_rising': {'theme_desc': 'phoenix rebirth flames', 'art_style': 'dramatic cinematic oil painting, mythological phoenix fire light, ultra detailed, 8k', 'material': 'flame feather and ember', 'color_desc': 'phoenix red-orange and golden flame'},
    'island_tiki': {'theme_desc': 'polynesian tiki island', 'art_style': 'cartoon style, bold outlines, tropical tiki illustration, flat Polynesian graphic', 'material': 'carved tiki wood and volcanic stone', 'color_desc': 'tropical teal and tiki brown'},
    'thunder_hero': {'theme_desc': 'superhero thunder strike', 'art_style': 'comic book art, halftone, bold lines, superhero comic style illustration', 'material': 'metallic spandex and lightning', 'color_desc': 'electric yellow and hero blue'},
    'thunder_titan': {'theme_desc': 'greek titan thunderstorm', 'art_style': 'dramatic cinematic oil painting, epic Greek mythology stormy light, ultra detailed, 8k', 'material': 'storm cloud marble and lightning gold', 'color_desc': 'storm purple and titan gold'},
    'sakura_princess': {'theme_desc': 'japanese cherry blossom princess', 'art_style': 'anime style, cel shading, manga art, clean linework, JRPG art style', 'material': 'lacquered wood and silk', 'color_desc': 'sakura pink and black lacquer'},
    'samurai_honor': {'theme_desc': 'feudal japan samurai', 'art_style': 'anime style, cel shading, manga art, clean samurai linework, JRPG art style', 'material': 'folded steel katana and bamboo', 'color_desc': 'steel grey and blood red'},
    'wild_safari': {'theme_desc': 'african wildlife safari', 'art_style': 'painterly nature illustration, children’s book style, lush safari wildlife art', 'material': 'canvas tent and leather strap', 'color_desc': 'khaki brown and savanna gold'},
    'mega_safari': {'theme_desc': 'mega african safari expedition', 'art_style': 'painterly nature illustration, children’s book style, lush African panorama art', 'material': 'woven kente and ivory', 'color_desc': 'kente gold and jungle green'},
    'safari_king': {'theme_desc': 'lion king of the savanna', 'art_style': 'painterly nature illustration, children’s book style, majestic wildlife portrait', 'material': 'golden mane fur and acacia bark', 'color_desc': 'lion gold and sunset amber'},
    'wild_deep': {'theme_desc': 'deep sea exploration', 'art_style': 'soft watercolor illustration, Studio Ghibli ocean feel, loose brushwork, deep sea art', 'material': 'submarine porthole brass', 'color_desc': 'deep navy and brass gold'},
    'sunken_treasure': {'theme_desc': 'underwater sunken shipwreck', 'art_style': 'soft watercolor illustration, loose brushwork, underwater treasure painted art', 'material': 'barnacle-covered wood and pearl', 'color_desc': 'ocean turquoise and pearl white'},
    'bass_splash': {'theme_desc': 'bass fishing splash zone', 'art_style': 'watercolor illustration, soft washes, loose brushwork, fishing nature art', 'material': 'varnished wood and fishing line', 'color_desc': 'water blue and lure silver'},
    'arctic_frost': {'theme_desc': 'frozen arctic wonderland', 'art_style': 'cheerful holiday illustration, greeting card style, whimsical winter painted art', 'material': 'ice crystal and frozen silver', 'color_desc': 'frost white and ice blue'},
    'arctic_foxes': {'theme_desc': 'arctic fox snow kingdom', 'art_style': 'watercolor illustration, soft washes, children’s book wildlife art, loose brushwork', 'material': 'snow crystal and fur texture', 'color_desc': 'arctic white and fox orange'},
    'snow_queen_riches': {'theme_desc': 'ice queen frozen palace', 'art_style': 'storybook illustration, watercolor fantasy art, hand-painted ice palace', 'material': 'ice diamond and frozen silver', 'color_desc': 'ice blue and silver frost'},
    'volcano_riches': {'theme_desc': 'volcanic eruption treasure', 'art_style': 'dramatic cinematic painting, fiery volcanic illustration, bold dramatic light', 'material': 'obsidian and molten lava', 'color_desc': 'lava red and obsidian black'},
    'crown_fire': {'theme_desc': 'flaming royal crown', 'art_style': 'art deco style, geometric gold patterns, elegant royal illustration', 'material': 'burning gold and fire opal', 'color_desc': 'fire gold and royal crimson'},
    'fire_hole': {'theme_desc': 'infernal fire pit hellscape', 'art_style': 'dark gothic illustration, infernal expressionist, dramatic shadow and fire art', 'material': 'scorched iron and brimstone', 'color_desc': 'hellfire orange and charcoal black'},
    'coin_volcano': {'theme_desc': 'volcano erupting gold coins', 'art_style': 'cartoon style, bold outlines, vibrant flat colors, adventure cartoon illustration', 'material': 'volcanic rock and gold coin', 'color_desc': 'volcanic orange and gold'},
    'coin_strike': {'theme_desc': 'lightning striking gold coins', 'art_style': 'synthwave art, electric neon, glowing gold outlines, retrowave', 'material': 'electrified gold and steel', 'color_desc': 'electric gold and storm silver'},
    'vault_coins': {'theme_desc': 'bank vault gold reserves', 'art_style': 'art deco style, geometric industrial gold design, elegant flat illustration', 'material': 'vault steel and gold bar', 'color_desc': 'steel grey and gold'},
    'mine_coins': {'theme_desc': 'underground gold mine', 'art_style': 'hand-drawn adventure illustration, rustic ink and watercolor, mining sketch art', 'material': 'mine timber and raw gold ore', 'color_desc': 'mine brown and raw gold'},
    'golden_fortune': {'theme_desc': 'chinese fortune golden palace', 'art_style': 'anime style, cel shading, Chinese imperial manga art, clean linework, JRPG style', 'material': 'imperial gold and cinnabar', 'color_desc': 'fortune gold and cinnabar red'},
    'golden_jaguar': {'theme_desc': 'aztec golden jaguar temple', 'art_style': 'dramatic cinematic oil painting, Aztec jungle golden hour, ultra detailed, 8k', 'material': 'obsidian and gold aztec', 'color_desc': 'aztec gold and jungle green'},
    'golden_vault_pharaoh': {'theme_desc': 'pharaoh golden vault chamber', 'art_style': 'dramatic cinematic oil painting, pharaoh chamber golden light, ultra detailed, 8k', 'material': 'electrum and gemstone', 'color_desc': 'electrum gold and turquoise'},
    'gold_crown_club': {'theme_desc': 'elite royal crown club', 'art_style': 'art deco style, geometric gold patterns, luxury club elegant flat design', 'material': 'velvet and gold crown', 'color_desc': 'royal purple and crown gold'},
    'goldstorm_ultra': {'theme_desc': 'golden storm lightning', 'art_style': 'synthwave art, electric metallic neon, glowing gold storm, retrowave aesthetic', 'material': 'electrified gold and platinum', 'color_desc': 'storm gold and lightning white'},
    'mega_diamond_rush': {'theme_desc': 'diamond rush mining cave', 'art_style': 'watercolor fantasy art, crystal cave soft illustration, hand-painted gem art', 'material': 'raw diamond and cave crystal', 'color_desc': 'diamond white and cave blue'},
    'crystal_chambers': {'theme_desc': 'underground crystal cavern', 'art_style': 'watercolor fantasy art, soft washes, hand-painted crystal cave illustration', 'material': 'amethyst crystal and quartz', 'color_desc': 'amethyst purple and crystal clear'},
    'crystal_shrine': {'theme_desc': 'sacred crystal shrine', 'art_style': 'storybook illustration, mystical watercolor art, hand-painted shrine', 'material': 'crystal pillar and sacred stone', 'color_desc': 'shrine gold and crystal cyan'},
    'gems_bonanza': {'theme_desc': 'gemstone mining bonanza', 'art_style': 'cartoon style, bold outlines, bright gem illustration, flat colorful graphic', 'material': 'faceted gemstone multi-cut', 'color_desc': 'ruby red sapphire blue emerald green'},
    'rainbow_riches_quest': {'theme_desc': 'irish rainbow pot of gold', 'art_style': 'storybook illustration, Celtic watercolor art, hand-painted Irish fantasy', 'material': 'celtic gold and emerald', 'color_desc': 'rainbow multi-color and irish green'},
    'pots_olympus': {'theme_desc': 'greek pottery olympus', 'art_style': 'dramatic cinematic oil painting, ancient Greek pottery style, ultra detailed, 8k', 'material': 'terracotta and black glaze', 'color_desc': 'terracotta red and olive black'},
    'rome_eternal': {'theme_desc': 'eternal rome colosseum', 'art_style': 'dramatic cinematic oil painting, Roman imperial golden hour, ultra detailed, 8k', 'material': 'roman marble and mosaic tile', 'color_desc': 'imperial purple and roman gold'},
    'castle_siege': {'theme_desc': 'medieval castle siege battle', 'art_style': 'medieval illuminated manuscript illustration, hand-drawn ink art, historical painting', 'material': 'stone castle wall and iron chain', 'color_desc': 'castle grey and banner red'},
    'merlin_power': {'theme_desc': 'wizard merlin magic tower', 'art_style': 'storybook illustration, whimsical fantasy painted art, children’s book style', 'material': 'ancient spell book and crystal orb', 'color_desc': 'mystic blue and spell purple'},
    'time_keepers_book': {'theme_desc': 'time keeper clockwork library', 'art_style': 'steampunk illustration, hand-drawn Victorian ink art, clockwork detailed drawing', 'material': 'brass gear and leather book', 'color_desc': 'clockwork brass and leather brown'},
    'steampunk_gears': {'theme_desc': 'steampunk machinery', 'art_style': 'steampunk illustration, hand-drawn Victorian mechanical art, copper ink drawing', 'material': 'brass gear and copper pipe', 'color_desc': 'copper bronze and steam white'},
    'clockwork_realm': {'theme_desc': 'clockwork mechanical realm', 'art_style': 'steampunk illustration, mechanical precision ink drawing, hand-drawn Victorian art', 'material': 'precision brass mechanism', 'color_desc': 'polished brass and clock silver'},
    'mecha_warriors': {'theme_desc': 'mecha robot battlezone', 'art_style': 'anime style, cel shading, mecha manga art, clean linework, JRPG mecha illustration', 'material': 'titanium armor and plasma', 'color_desc': 'mecha blue and plasma orange'},
    'cyber_rebellion': {'theme_desc': 'cyber rebellion hacker', 'art_style': 'synthwave art, cyberpunk glitch aesthetic, neon digital art, retrowave', 'material': 'circuit board and neon wire', 'color_desc': 'matrix green and cyber red'},
    'neon_nexus': {'theme_desc': 'neon cyberpunk nexus hub', 'art_style': 'synthwave art, neon colors, retrowave, glowing neon outlines, retro-futuristic', 'material': 'neon glass and chrome', 'color_desc': 'synthwave pink and neon cyan'},
    'neon_viper': {'theme_desc': 'neon viper snake cyberpunk', 'art_style': 'synthwave art, neon wildlife, glowing neon outlines, cyberpunk neon aesthetic', 'material': 'neon scales and chrome fang', 'color_desc': 'toxic green and neon purple'},
    'quantum_burst': {'theme_desc': 'quantum physics energy burst', 'art_style': 'synthwave art, neon colors, sci-fi particle visualization, glowing neon', 'material': 'quantum particle and energy field', 'color_desc': 'quantum blue and particle gold'},
    'nova_blackhole': {'theme_desc': 'black hole supernova event', 'art_style': 'synthwave art, deep space neon, astrophysics visualization, glowing cosmic neon', 'material': 'event horizon plasma and starlight', 'color_desc': 'void black and supernova white'},
    'celestial_cosmos': {'theme_desc': 'celestial cosmic observatory', 'art_style': 'synthwave art, retrowave cosmic, glowing neon star map, retro-futuristic space', 'material': 'telescope brass and star map', 'color_desc': 'cosmic navy and star gold'},
    'galactic_raiders': {'theme_desc': 'galactic space pirate raiders', 'art_style': 'retro sci-fi pulp illustration, comic book space art, bold graphic design', 'material': 'spaceship hull and laser', 'color_desc': 'space black and laser red'},
    'solar_fist': {'theme_desc': 'solar power martial arts', 'art_style': 'anime style, cel shading, manga action energy art, clean linework, JRPG style', 'material': 'solar flare and ki energy', 'color_desc': 'solar gold and energy white'},
    'pixel_rewind': {'theme_desc': 'retro pixel game arcade', 'art_style': 'pixel art, 16-bit style, retro game sprites, pixelated illustration', 'material': 'CRT screen and pixel block', 'color_desc': 'retro green and pixel cyan'},
    'mega_joker': {'theme_desc': 'classic mega jackpot joker', 'art_style': 'vintage casino art deco illustration, elegant flat graphic, classic retro design', 'material': 'velvet card table and gold trim', 'color_desc': 'casino green and gold'},
    'dog_house_mega': {'theme_desc': 'mega dog house adventure', 'art_style': 'cartoon style, bold outlines, flat colors, animated pet adventure illustration', 'material': 'painted doghouse wood', 'color_desc': 'dog brown and bone white'},
    'eternal_romance': {'theme_desc': 'gothic vampire romance', 'art_style': 'dark gothic illustration, romantic expressionist, dramatic shadows, macabre art', 'material': 'dark silk and blood rose', 'color_desc': 'romance crimson and gothic purple'},
    'immortal_blood': {'theme_desc': 'immortal vampire blood ritual', 'art_style': 'dark gothic horror illustration, expressionist dramatic shadows, macabre art', 'material': 'ancient blood stone and iron', 'color_desc': 'blood red and shadow black'},
    'infernal_depths': {'theme_desc': 'infernal demon underworld', 'art_style': 'dark gothic illustration, Dante inferno expressionist, dramatic shadows, macabre art', 'material': 'hellstone and demon bone', 'color_desc': 'infernal red and abyss black'},
    'demon_chambers': {'theme_desc': 'demon summoning chamber', 'art_style': 'dark gothic occult illustration, expressionist dramatic shadows, macabre ritual art', 'material': 'obsidian altar and pentagram', 'color_desc': 'occult purple and demon red'},
    'mystic_cauldron': {'theme_desc': 'witch mystic cauldron brew', 'art_style': 'storybook illustration, whimsical witch watercolor art, hand-painted', 'material': 'iron cauldron and potion glass', 'color_desc': 'potion green and cauldron black'},
    'mystic_wolf': {'theme_desc': 'mystical spirit wolf', 'art_style': 'watercolor illustration, soft washes, spirit animal painted art, loose brushwork', 'material': 'spirit mist and moonstone', 'color_desc': 'mystic blue and moon silver'},
    'tome_madness': {'theme_desc': 'forbidden tome madness', 'art_style': 'dark gothic illustration, Lovecraftian horror manuscript art, expressionist shadows', 'material': 'ancient vellum and eldritch ink', 'color_desc': 'eldritch green and madness purple'},
    'mental_meltdown': {'theme_desc': 'psychedelic mental breakdown', 'art_style': 'psychedelic illustration, optical art style, swirling surreal art, bold graphic', 'material': 'melting reality and fractured mirror', 'color_desc': 'psychedelic rainbow and void black'},
    'loki_loot': {'theme_desc': 'norse trickster god loki', 'art_style': 'storybook illustration, hand-drawn Norse trickster art, watercolor fantasy', 'material': 'enchanted green fire and gold', 'color_desc': 'loki green and mischief gold'},
    'le_bandit': {'theme_desc': 'french bandit heist', 'art_style': 'film noir illustration, dark comic book art, underground noir aesthetic', 'material': 'parisian stone and safe steel', 'color_desc': 'noir grey and heist gold'},
    'snoop_dollars': {'theme_desc': 'hip hop money lifestyle', 'art_style': 'hip hop graffiti art, street art style, bold urban illustration', 'material': 'gold chain and dollar bill', 'color_desc': 'money green and bling gold'},
    'elvis_frog': {'theme_desc': 'rock and roll frog vegas', 'art_style': 'rockabilly retro illustration, vintage poster style, bold 1950s graphic art', 'material': 'sequin jumpsuit and gold record', 'color_desc': 'elvis gold and vegas pink'},
    'rockstar_wild': {'theme_desc': 'rock star concert stage', 'art_style': 'hand-drawn rock concert poster art, bold ink illustration, vintage poster style', 'material': 'electric guitar chrome and stage light', 'color_desc': 'rock red and stage black'},
    'world_cup_glory': {'theme_desc': 'football world cup stadium', 'art_style': 'cartoon style, bold outlines, vibrant sports illustration, flat graphic design', 'material': 'golden trophy and stadium turf', 'color_desc': 'champion gold and pitch green'},
    'grand_prix_rush': {'theme_desc': 'formula racing grand prix', 'art_style': 'comic book art, bold lines, motorsport speed graphic illustration, halftone', 'material': 'carbon fiber and racing stripe', 'color_desc': 'racing red and carbon black'},
    'nitro_street': {'theme_desc': 'street racing nitro boost', 'art_style': 'synthwave art, neon street racing, glowing neon outlines, retrowave night city', 'material': 'nitro chrome and asphalt', 'color_desc': 'nitro blue and street neon'},
    'midnight_drifter': {'theme_desc': 'midnight street drift racing', 'art_style': 'anime style, cel shading, drift culture manga art, clean linework, Tokyo neon', 'material': 'tokyo neon and tire rubber', 'color_desc': 'midnight blue and drift orange'},
    'urban_rooftop': {'theme_desc': 'urban rooftop night city', 'art_style': 'graffiti street art style, urban spray paint illustration, bold graphic', 'material': 'concrete and spray paint', 'color_desc': 'urban grey and graffiti multi-color'},
    'enchanted_maze': {'theme_desc': 'magical hedge maze garden', 'art_style': 'storybook illustration, fairy tale garden watercolor, whimsical painted art', 'material': 'enchanted topiary and magic stone', 'color_desc': 'maze green and fairy gold'},
    'wild_stallion': {'theme_desc': 'wild mustang horse plains', 'art_style': 'vintage western oil painting, landscape folk art style, dramatic prairie light', 'material': 'tooled leather and horseshoe iron', 'color_desc': 'mustang brown and prairie gold'},
    'wild_west_rush': {'theme_desc': 'gold rush wild west', 'art_style': 'vintage western poster art, worn texture, folk art style, gold rush era', 'material': 'rustic wood and gold nugget', 'color_desc': 'gold rush yellow and desert brown'},
    'iron_stampede': {'theme_desc': 'iron beast mechanical stampede', 'art_style': 'steampunk illustration, hand-drawn mechanical beast art, Victorian ink drawing', 'material': 'riveted iron and steam', 'color_desc': 'iron grey and steam copper'},
    'monaco_million': {'theme_desc': 'monaco luxury casino', 'art_style': 'art deco style, French Riviera geometric gold, elegant luxury flat illustration', 'material': 'marble and champagne gold', 'color_desc': 'monaco blue and luxury gold'},
    'power_crown': {'theme_desc': 'royal power crown jewels', 'art_style': 'art deco style, geometric heraldic gold, elegant royal flat illustration', 'material': 'crown gold and velvet cushion', 'color_desc': 'royal gold and ermine white'},
    'five_lions': {'theme_desc': 'five lion guardians temple', 'art_style': 'anime style, cel shading, Chinese guardian lion manga art, clean linework', 'material': 'jade lion and temple stone', 'color_desc': 'jade green and guardian gold'},
    'jade_prosperity': {'theme_desc': 'jade prosperity fortune', 'art_style': 'anime style, cel shading, Chinese prosperity manga art, clean linework', 'material': 'carved jade and red envelope', 'color_desc': 'prosperity jade and lucky red'},
    'lightning_pearl': {'theme_desc': 'lightning dragon pearl', 'art_style': 'anime style, cel shading, dragon pearl manga art, clean linework, JRPG style', 'material': 'luminous pearl and dragon scale', 'color_desc': 'pearl white and lightning gold'},
    'twin_helix': {'theme_desc': 'DNA double helix laboratory', 'art_style': 'synthwave art, neon bio-tech visualization, glowing neon colors, clean sci-fi vector', 'material': 'glass helix and bio-luminescent', 'color_desc': 'bio green and lab white'},
    'chaos_crew': {'theme_desc': 'anarchist chaos crew punk', 'art_style': 'punk rock illustration, underground zine aesthetic, dark noir comic style', 'material': 'spiked leather and safety pin', 'color_desc': 'punk pink and anarchist black'},
    'wildfire_gold': {'theme_desc': 'golden wildfire blaze', 'art_style': 'dramatic cinematic painting, fiery gold illustration, bold dramatic brushwork', 'material': 'fire-licked gold and ember', 'color_desc': 'wildfire gold and ember orange'},
    'ancient_alchemist': {'theme_desc': 'medieval alchemy laboratory', 'art_style': 'storybook illustration, hand-drawn medieval manuscript art, whimsical painted', 'material': 'alchemist brass and glass flask', 'color_desc': 'alchemist gold and potion amber'},
    'anglers_fortune': {'theme_desc': 'deep sea angler fortune', 'art_style': 'watercolor illustration, soft washes, loose brushwork, deep sea fishing art', 'material': 'deep sea coral and fishing rod', 'color_desc': 'ocean navy and angler gold'},
    'carnival_chaos': {'theme_desc': 'carnival chaos fairground', 'art_style': 'carnival funhouse art', 'material': 'painted carnival wood and lights', 'color_desc': 'carnival red and yellow'},
    'ares_blade': {'theme_desc': 'greek god of war blade', 'art_style': 'dramatic cinematic oil painting, Greek warrior bronze dramatic light, ultra detailed, 8k', 'material': 'spartan bronze and war shield', 'color_desc': 'war bronze and blood red'},
    'olympian_gods': {'theme_desc': 'mount olympus pantheon gods', 'art_style': 'dramatic cinematic oil painting, classical Greek divine light, ultra detailed, 8k', 'material': 'divine marble and cloud gold', 'color_desc': 'olympian white and divine gold'},
    'olympus_dream': {'theme_desc': 'dreamy olympus paradise', 'art_style': 'dramatic cinematic oil painting, romantic classicism divine glow, ultra detailed, 8k', 'material': 'dream cloud marble and starlight', 'color_desc': 'dream lavender and paradise gold'},
    'mythic_olympiad': {'theme_desc': 'olympic mythic competition', 'art_style': 'dramatic cinematic oil painting, Greek athletic amphora golden light, ultra detailed, 8k', 'material': 'olive wreath and bronze medal', 'color_desc': 'olympic bronze and laurel green'},
    'dragons_hoard': {'theme_desc': 'dragon treasure hoard cave', 'art_style': 'high fantasy illustration, painterly dragon art, dramatic painted style', 'material': 'dragon treasure gold and gemstone', 'color_desc': 'hoard gold and dragon emerald'},
    'dragon_forge': {'theme_desc': 'dragon forge blacksmith', 'art_style': 'high fantasy illustration, fantasy forge painterly art, dramatic forge light', 'material': 'forged dragonmetal and flame', 'color_desc': 'forge orange and dragonmetal grey'},
    'black_ops_heist': {'theme_desc': 'special ops stealth heist', 'art_style': 'comic book art, halftone, bold lines, military tactical comic illustration', 'material': 'tactical kevlar and night vision', 'color_desc': 'ops black and tactical green'},
    'agent_zero': {'theme_desc': 'secret agent spy thriller', 'art_style': 'film noir illustration, James Bond poster style, elegant dark comic art', 'material': 'tuxedo silk and martini glass', 'color_desc': 'spy black and martini silver'},
    'lucha_mania': {'theme_desc': 'lucha libre wrestling ring', 'art_style': 'cartoon style, bold outlines, lucha libre poster illustration, flat festive graphic', 'material': 'wrestling ring rope and mask fabric', 'color_desc': 'lucha red and wrestling gold'},
    'esqueleto_fiesta': {'theme_desc': 'day of the dead skeleton fiesta', 'art_style': 'cartoon style, bold outlines, Dia de los Muertos folk art illustration, flat graphic', 'material': 'sugar skull and marigold', 'color_desc': 'skeleton white and marigold orange'},
    'inferno_fiesta': {'theme_desc': 'infernal fire fiesta party', 'art_style': 'cartoon style, bold outlines, Latin fire festival illustration, flat festive graphic', 'material': 'burning festival and ember', 'color_desc': 'inferno red and fiesta gold'},
    'buffalo_extreme': {'theme_desc': 'extreme buffalo wild charge', 'art_style': 'painterly nature illustration, epic wildlife dramatic painting, bold brushwork', 'material': 'buffalo horn and lightning', 'color_desc': 'extreme gold and storm purple'},
    'buffalo_mega': {'theme_desc': 'mega buffalo stampede herd', 'art_style': 'painterly nature illustration, epic wildlife panorama painting, bold brushwork', 'material': 'prairie grass and thundercloud', 'color_desc': 'mega gold and thunder grey'},
    'jungle_fury': {'theme_desc': 'jungle fury tiger attack', 'art_style': 'painterly nature illustration, lush jungle painted art, children’s book style', 'material': 'jungle vine and tiger stripe', 'color_desc': 'jungle green and tiger orange'},
    # 18+ Adults Only Collection
    'sinners_paradise': {'theme_desc': 'hellish devils casino underworld', 'art_style': 'dark baroque infernal', 'material': 'black velvet and burning gold', 'color_desc': 'hellfire red and shadow black'},
    'midnight_burlesque': {'theme_desc': 'midnight cabaret show stage', 'art_style': 'art deco cabaret noir', 'material': 'velvet curtain and spotlight brass', 'color_desc': 'deep purple and hot magenta'},
    'absinthe_nights': {'theme_desc': 'absinthe hallucination green fairy', 'art_style': 'art nouveau psychedelic', 'material': 'absinthe glass and green flame', 'color_desc': 'toxic green and midnight black'},
    'velvet_lounge': {'theme_desc': 'exclusive VIP lounge club', 'art_style': 'art deco luxury illustration, noir cocktail bar graphic, elegant flat design', 'material': 'crushed velvet and pearl', 'color_desc': 'hot pink and champagne gold'},
    'dark_desire': {'theme_desc': 'dark gothic forbidden chamber', 'art_style': 'dark romantic gothic', 'material': 'black silk and amethyst crystal', 'color_desc': 'deep purple and midnight blue'},
    'vice_city_jackpot': {'theme_desc': 'neon vice city nightlife', 'art_style': 'synthwave art, 1980s Miami neon colors, retrowave, glowing neon outlines', 'material': 'chrome and neon tube', 'color_desc': 'neon pink and sunset orange'},
    'whiskey_barrel': {'theme_desc': 'premium whiskey distillery', 'art_style': 'rustic distillery woodcraft', 'material': 'oak barrel and copper still', 'color_desc': 'amber whiskey and oak brown'},
    'black_market': {'theme_desc': 'underground black market deal', 'art_style': 'film noir crime', 'material': 'steel vault and shadow', 'color_desc': 'gunmetal grey and noir black'},
    'serpent_temptation': {'theme_desc': 'garden of temptation serpent', 'art_style': 'pre-raphaelite painting', 'material': 'garden vine and serpent scale', 'color_desc': 'eden green and forbidden red'},
    'neon_underworld': {'theme_desc': 'neon-lit criminal underworld', 'art_style': 'synthwave art, cyberpunk noir neon, glowing neon outlines, rain-soaked retrowave', 'material': 'neon wire and chrome blade', 'color_desc': 'neon magenta and electric cyan'},
    'blood_ritual': {'theme_desc': 'occult blood ritual chamber', 'art_style': 'dark baroque horror painting', 'material': 'dripping blood and bone altar', 'color_desc': 'deep crimson and charred black'},
    'crypt_of_sins': {'theme_desc': 'ancient cursed undead crypt', 'art_style': 'gothic horror digital art', 'material': 'cracked tombstone and cursed gem', 'color_desc': 'deep purple and spectral green'},
    'flesh_and_gold': {'theme_desc': 'molten gold throne room torture', 'art_style': 'dark renaissance oil painting', 'material': 'molten gold and spiked iron', 'color_desc': 'molten amber and burnt black'},
    'opium_den': {'theme_desc': 'forbidden opium den dragon haze', 'art_style': 'oriental dark fantasy painting', 'material': 'jade dragon and smoke wisps', 'color_desc': 'emerald green and smoky jade'},
    'torture_chamber': {'theme_desc': 'medieval dungeon torture chamber', 'art_style': 'gritty dark realism', 'material': 'rusted iron and bloodstained stone', 'color_desc': 'rust red and dungeon grey'},
}

def log(msg):
    ts = time.strftime("%H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(line + "\n")

def build_args(prompt, neg, aspect="1024×1024"):
    """Build args for Fooocus generate_api endpoint"""
    args = [
        False, prompt, neg,
        ["Fooocus V2", "Fooocus Enhance", "Fooocus Sharp"],
        "Speed", aspect, 1, "png", "0", False,
        2.0, 4.0, "juggernautXL_v8Rundiffusion.safetensors", "None", 0.5,
        True, "sd_xl_offset_example-lora_1.0.safetensors", 0.1,
        True, "None", 1.0, True, "None", 1.0, True, "None", 1.0, True, "None", 1.0,
        False, "uov", "Disabled", None, [], None, "", None,
        False, False, False, False,
        1.5, 0.8, 0.3, 7.0, 2,
        "dpmpp_2m_sde_gpu", "karras", "Default (model)",
        -1, -1, -1, -1, -1, -1,
        False, False, False, False, 64, 128, "joint", 0.25,
        False, 1.01, 1.02, 0.99, 0.95,
        False, False, "v2.6", 1.0, 0.618,
        False, False, 0, False, False, "fooocus",
    ]
    for _ in range(4):
        args.extend([None, 0.5, 0.6, "ImagePrompt"])
    # Additional args for inpaint/enhance controls (must match Fooocus 153 params)
    args.extend([False, 0, False, None])
    args.extend([False, "Disabled", "Before First Enhancement", "Original Prompts"])
    for _ in range(3):
        args.extend([False, "", "", "", "sam", "full", "vit_b", 0.25, 0.3, 0, False, "v2.6", 1.0, 0.618, 0, False])
    return args

def load_progress():
    if PROGRESS_FILE.exists():
        try:
            return json.loads(PROGRESS_FILE.read_text(encoding='utf-8'))
        except:
            return {}
    return {}

def save_progress(prog):
    tmp = PROGRESS_FILE.with_suffix('.json.tmp')
    tmp.write_text(json.dumps(prog, indent=2), encoding='utf-8')
    if PROGRESS_FILE.exists():
        PROGRESS_FILE.unlink()
    tmp.rename(PROGRESS_FILE)

def generate_one(client, prompt, neg, aspect, out_path):
    """Generate a single image via Fooocus API"""
    args = build_args(prompt, neg, aspect)
    result = client.predict(*args, api_name="/generate_api")
    # Result can be: list with file paths, single path string, or dict
    if isinstance(result, list) and len(result) > 0:
        src = result[0]
    elif isinstance(result, str):
        src = result
    else:
        return False
    if isinstance(src, dict):
        src = src.get('name', src.get('path', ''))
    if src and os.path.exists(str(src)):
        shutil.copy2(str(src), str(out_path))
        return True
    return False

def main():
    from gradio_client import Client

    BASE_OUT.mkdir(parents=True, exist_ok=True)
    log("=== GUI Asset Generation Starting ===")

    client = Client("http://127.0.0.1:7860", serialize=False)
    log("Connected to Fooocus")

    progress = load_progress()
    total_games = len(GAME_STYLES)
    total_assets = total_games * len(ASSET_TYPES)
    done_count = sum(1 for g in progress.values() for a in g.values() if a == 'done')
    log(f"Total: {total_games} games × {len(ASSET_TYPES)} assets = {total_assets} images")
    log(f"Already done: {done_count}")

    for gi, (game_id, style) in enumerate(GAME_STYLES.items()):
        if game_id not in progress:
            progress[game_id] = {}

        game_dir = BASE_OUT / game_id
        game_dir.mkdir(exist_ok=True)

        for asset_type, asset_cfg in ASSET_TYPES.items():
            asset_key = f"{game_id}_{asset_type}"
            if progress[game_id].get(asset_type) == 'done':
                continue

            prompt = asset_cfg['prompt_template'].format(**style)
            out_path = game_dir / f"{asset_type}.png"
            aspect = asset_cfg['aspect']

            log(f"[{gi+1}/{total_games}] {game_id} / {asset_type} ({aspect})")

            try:
                success = generate_one(client, prompt, NEG, aspect, out_path)
                if success:
                    progress[game_id][asset_type] = 'done'
                    log(f"  OK Saved {out_path.name}")
                else:
                    progress[game_id][asset_type] = 'failed'
                    log(f"  FAILNo output for {asset_type}")
            except Exception as e:
                progress[game_id][asset_type] = f'error: {str(e)[:80]}'
                log(f"  FAILError: {str(e)[:100]}")
                traceback.print_exc()

            save_progress(progress)
            time.sleep(0.5)

    done_final = sum(1 for g in progress.values() for a in g.values() if a == 'done')
    log(f"=== Complete: {done_final}/{total_assets} assets generated ===")

if __name__ == '__main__':
    main()



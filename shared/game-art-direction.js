'use strict';

/**
 * Per-game art direction for Fooocus asset generation.
 * Each entry is unique — no two games share an artDirection, soundProfile, or colorNote.
 * Used by generate-sdxl-symbols.js, generate-sdxl-assets.js, and generate-all-assets.js.
 *
 * artDirection : 1-2 sentence cinematic brief for the AI — mood, era, art movement, palette
 * soundProfile : audio archetype identifier used by sound-manager.js
 * colorNote    : primary color descriptor for prompt injection (e.g. "neon pink and hot orange")
 */

const ART_DIRECTION = {

  // ── FRUIT ──────────────────────────────────────────────────────────────────
  sugar_rush: {
    artDirection: 'Hyper-saturated candy-pop dreamscape channelling Willy Wonka surrealism — translucent sugar-crystal textures, neon pink and hot-orange gradients, bubblegum gloss.',
    soundProfile: 'playful',
    colorNote: 'neon pink and hot orange',
  },
  hot_chillies: {
    artDirection: 'Mexican folk-art fiesta rendered in bold hand-painted poster style — vivid crimson peppers, sombrero silhouettes, hand-lettered patterns, sun-scorched earthen warmth.',
    soundProfile: 'festive',
    colorNote: 'blazing crimson and saffron yellow',
  },
  peach_paradise: {
    artDirection: 'Japanese ukiyo-e watercolour meets kawaii pastel — soft peach-blossom gradients, ink-wash bamboo framing, delicate gold-foil accents, serene and feminine.',
    soundProfile: 'zen',
    colorNote: 'blush peach and soft mint',
  },
  berry_bliss: {
    artDirection: 'Scandinavian botanical illustration — hand-drawn berry clusters on cream linen, muted sage and lavender washes, refined Nordic minimalism.',
    soundProfile: 'whimsical',
    colorNote: 'deep blueberry and rose lavender',
  },
  fruit_bonanza: {
    artDirection: 'Golden-era Vegas 1950s chrome-diner aesthetic — polished chrome frames, cherry-red neon tubes, mid-century Americana typography, retro slot-machine glamour.',
    soundProfile: 'classic',
    colorNote: 'candy apple red and polished gold',
  },
  spice_fortune: {
    artDirection: 'Moroccan souk luxury — ornate arabesque tilework in saffron, indigo, and terracotta; brass lantern glow; richly layered Islamic geometric patterns.',
    soundProfile: 'exotic',
    colorNote: 'saffron gold and indigo blue',
  },
  melon_feast: {
    artDirection: 'Brazilian carnival explosion — lime-green and hot-magenta confetti, feathered headdresses, tropical party energy, sun-drenched Rio de Janeiro atmosphere.',
    soundProfile: 'festive',
    colorNote: 'lime green and hot magenta',
  },
  cherry_bombs: {
    artDirection: 'Military pop-art — bold Roy Lichtenstein halftone dots, comic-book explosion panels, cherry-red and jet-black with white impact lettering aesthetic.',
    soundProfile: 'intense',
    colorNote: 'cherry red and comic black',
  },
  grape_vine: {
    artDirection: 'Renaissance Italian winery — oil-painted grape clusters, Baroque chiaroscuro lighting, dark burgundy and aged-gold leaf, classical Old-Masters gravitas.',
    soundProfile: 'regal',
    colorNote: 'deep burgundy and Renaissance gold',
  },
  tangerine_tango: {
    artDirection: 'Cuban Art Deco dance hall — warm copper and tangerine poster typography, 1940s ballroom elegance, rhythmic geometric motifs, Havana-cigar warmth.',
    soundProfile: 'exotic',
    colorNote: 'tangerine orange and warm copper',
  },
  lemon_drop: {
    artDirection: 'Amalfi Coast Mediterranean sun-bleached freshness — hand-painted ceramic lemon tiles, azure sea in the distance, whitewashed stucco, salt-air clarity.',
    soundProfile: 'playful',
    colorNote: 'lemon yellow and Amalfi azure',
  },
  harvest_megaways: {
    artDirection: 'American heartland pastoral — Norman Rockwell illustration warmth, autumn rust and amber wheat fields, weathered timber barns, wholesome harvest abundance.',
    soundProfile: 'adventurous',
    colorNote: 'harvest amber and barn red',
  },

  // ── EGYPT ──────────────────────────────────────────────────────────────────
  gates_olympus: {
    artDirection: 'Divine Olympian throne room fused with Egyptian grandeur — electric gold lightning arcs, deep lapis-lazuli sky, ultra-premium Vegas high-roller excess.',
    soundProfile: 'epic',
    colorNote: 'divine gold and lapis blue',
  },
  book_dead: {
    artDirection: 'Cursed occult Egypt — sepia-toned aged parchment, crumbling hieroglyphs half-erased by desert wind, shadowy candlelight, gothic-mystery thriller atmosphere.',
    soundProfile: 'mysterious',
    colorNote: 'aged sepia and shadow black',
  },
  pyramid_king: {
    artDirection: 'Dynastic military power — imposing monumental sandstone pyramids lit by blood-red sunset, crimson and obsidian geometry, laser-sharp Pharaonic authority.',
    soundProfile: 'epic',
    colorNote: 'blood crimson and obsidian black',
  },
  nile_jewels: {
    artDirection: 'Cleopatra Art Nouveau elegance — lapis lazuli, emerald, and 22-karat gold; jewel-encrusted peacock motifs; flowing Mucha-style feminine opulence.',
    soundProfile: 'regal',
    colorNote: 'lapis lazuli and emerald green',
  },
  sphinx_riddle: {
    artDirection: 'Desert mysticism at violet dusk — the Great Sphinx gazes from sand dunes stained amber and purple, golden riddle-symbols float in the haze, majestic enigma.',
    soundProfile: 'mysterious',
    colorNote: 'amber sand and violet dusk',
  },
  sacred_ibis: {
    artDirection: 'Sacred ceremony of Thoth — pristine white ibis feathers against hammered-gold leaf murals, temple incense smoke, divine ivory-and-gold ceremonial palette.',
    soundProfile: 'ethereal',
    colorNote: 'ivory white and ceremonial gold',
  },
  pyramid_power: {
    artDirection: 'Ptolemaic astronomical observatory — celestial charts on papyrus, brass armillary spheres, deep teal and burnished gold, alchemical Egyptian science.',
    soundProfile: 'mysterious',
    colorNote: 'deep teal and burnished gold',
  },
  ancient_tombs: {
    artDirection: 'Tomb raider adventure energy — torch-lit carved corridors, Indiana Jones cinematic urgency, ochre limestone walls, teal faience inlays, shadows alive with peril.',
    soundProfile: 'adventurous',
    colorNote: 'ochre stone and torch-flicker teal',
  },
  temple_bells: {
    artDirection: 'Acoustic sacred temple — verdigris copper bells suspended in a colonnaded hypostyle hall, resonant green-bronze and warm alabaster, soundwave geometry in stone.',
    soundProfile: 'ethereal',
    colorNote: 'verdigris copper and alabaster',
  },
  tomb_anubis: {
    artDirection: 'Jackal-god underworld judgment — obsidian black and electric cobalt, the scales of Ma\'at rendered in sharp angular Art Deco geometry, divine and terrifying.',
    soundProfile: 'dark',
    colorNote: 'obsidian black and electric cobalt',
  },
  isis_blessing: {
    artDirection: 'Mother-goddess celestial magic — Isis with outstretched wings fills the sky, flowing white linen, star-field constellations, soft celestial gold radiation.',
    soundProfile: 'ethereal',
    colorNote: 'celestial white and star gold',
  },
  desert_dynasty: {
    artDirection: 'Grand Imperial era sweeping vista — camel caravans crossing copper-sienna dunes under a vast sky, warm terracotta and burnt-sienna panorama, timeless dynasty.',
    soundProfile: 'epic',
    colorNote: 'terracotta sienna and sky copper',
  },
  cleopatra_moon: {
    artDirection: 'Nocturnal Nile glamour — Cleopatra at the moonlit river, Art Deco femme-fatale silhouette, midnight navy and cold silver, moonbeam-on-water reflections.',
    soundProfile: 'mysterious',
    colorNote: 'midnight navy and moonbeam silver',
  },

  // ── SPACE ──────────────────────────────────────────────────────────────────
  starburst_xxl: {
    artDirection: 'Retro arcade starburst — 8-bit pixel energy meets crisp HD, electric cyan and rainbow prism rays, joyful nostalgia of the golden age of video arcades.',
    soundProfile: 'playful',
    colorNote: 'electric cyan and rainbow prism',
  },
  space_odyssey: {
    artDirection: 'Kubrick 2001 clinical futurism — bone-white interiors, HAL-9000 red eye, mathematically perfect composition, cold silent vastness of deep space.',
    soundProfile: 'mysterious',
    colorNote: 'clinical white and HAL crimson',
  },
  cosmic_nova: {
    artDirection: 'Photorealistic astrophotography of a supernova birth — magenta and gold shockwave rings expanding through a star field, scientific awe made beautiful.',
    soundProfile: 'epic',
    colorNote: 'nova magenta and stellar gold',
  },
  galaxy_rush: {
    artDirection: 'Hyperspace jump corridor — motion-blur light streaks at warp speed, electric blue and white velocity lines, pure racing adrenaline meets cosmic scale.',
    soundProfile: 'intense',
    colorNote: 'hyperspace blue and velocity white',
  },
  eclipse_mystery: {
    artDirection: 'Solar corona moment — a perfect black disc ringed by golden diamond-ring totality, corona filaments in deep violet sky, rare cosmic suspense frozen in time.',
    soundProfile: 'mysterious',
    colorNote: 'corona gold and eclipse black',
  },
  supernova_slots: {
    artDirection: 'Scientific UV-spectrum aesthetics — periodic table meets casino, ultraviolet fluorescent glows, deep-field telescope imagery, intellectual wonder under black light.',
    soundProfile: 'ethereal',
    colorNote: 'ultraviolet purple and fluorescent white',
  },
  neon_nebula: {
    artDirection: 'Synthwave retro-future — Tron-style 80s grid extending to the horizon, hot-pink and electric-blue neon tubes, VHS scanlines, Stranger Things nostalgia.',
    soundProfile: 'intense',
    colorNote: 'hot pink and electric blue neon',
  },
  stellar_drift: {
    artDirection: 'Organic space drift — flowing hydrogen-gas cloud paintings, soft teal and lavender washes, meditative cosmic calm, like a living Hubble watercolour.',
    soundProfile: 'ethereal',
    colorNote: 'nebula teal and lavender violet',
  },
  gravity_well: {
    artDirection: 'Event-horizon physics art — gravitational lensing bends starlight into perfect rings, deep indigo background, white accretion disc glow, scientific awe.',
    soundProfile: 'mysterious',
    colorNote: 'deep indigo and accretion white',
  },
  warp_station: {
    artDirection: 'Near-future space-station dock — industrial metal grating, amber warning lights, docking clamps and pressure seals, cinéma vérité realism of 2150.',
    soundProfile: 'adventurous',
    colorNote: 'industrial steel and amber warning',
  },
  moon_madness: {
    artDirection: 'Lunar fever dream — extreme close-up of crater regolith in chalk white and deep shadow black, surreal isolation, Kubrick-meets-Dali dreamscape.',
    soundProfile: 'whimsical',
    colorNote: 'crater white and shadow black',
  },
  solar_system: {
    artDirection: 'Orbital mechanics beauty — gas-giant ring systems, icy moon geysers, swirling atmosphere bands, rich Prussian blue and gas-giant amber, NASA-grade wonder.',
    soundProfile: 'epic',
    colorNote: 'Prussian blue and gas-giant amber',
  },

  // ── FANTASY ────────────────────────────────────────────────────────────────
  starlight_princess: {
    artDirection: 'Anime magical-girl transformation — J-RPG sakura pink and lavender, sparkling star particles, celestial wand trails, shōjo manga elegance in HD.',
    soundProfile: 'whimsical',
    colorNote: 'sakura pink and celestial lavender',
  },
  dragon_realm: {
    artDirection: 'European medieval tapestry style — heraldic crimson and burnished gold, wyvern dragons in Bayeux-style flat illustration, heavy chivalric atmosphere.',
    soundProfile: 'epic',
    colorNote: 'heraldic crimson and burnished gold',
  },
  infinity_mirror: {
    artDirection: 'Psychedelic fractal infinity — recursive mirror reflections creating impossible geometry, gold-on-black kaleidoscopic mandala, zen and hallucinatory.',
    soundProfile: 'mysterious',
    colorNote: 'fractal gold and void black',
  },
  warrior_princess: {
    artDirection: 'Nordic shield-maiden saga — Frank Frazetta-inspired battle-painting, storm-blue steel armour, blood-red cloak, wind-swept Scandinavian wilderness.',
    soundProfile: 'intense',
    colorNote: 'steel blue and battle crimson',
  },
  mystic_grail: {
    artDirection: 'Arthurian Avalon legend — mist-wreathed isle of Glastonbury, the golden grail radiating warm amber light through forest-green branches, chivalric romance.',
    soundProfile: 'ethereal',
    colorNote: 'amber grail gold and Avalon green',
  },
  fairy_tales: {
    artDirection: 'Storybook illustration hand-painted — Arthur Rackham ink-and-watercolour fairy-tale style, bright primary enchantment, whimsical characters, timeless magic.',
    soundProfile: 'whimsical',
    colorNote: 'storybook primary and fairy-dust gold',
  },
  avalon_castle: {
    artDirection: 'Gothic romantic castle in rain — Pre-Raphaelite painting mood, mossy stone towers, violet and pewter storm light, tragic romantic atmosphere.',
    soundProfile: 'mysterious',
    colorNote: 'storm violet and pewter grey',
  },
  crystal_cavern: {
    artDirection: 'Underground crystal palace — translucent selenite and amethyst formations, cool aquamarine light refracting through facets, alien subterranean beauty.',
    soundProfile: 'ethereal',
    colorNote: 'aquamarine and amethyst violet',
  },
  fae_forest: {
    artDirection: 'Bioluminescent enchanted woodland — deep forest floor lit by glowing mushrooms and firefly constellations, silver moonbeam, verdant and magical.',
    soundProfile: 'whimsical',
    colorNote: 'bioluminescent green and moonbeam silver',
  },
  runeblade: {
    artDirection: 'Dark fantasy rune-magic — carved elder-futhark runes glowing volcanic orange in dark slate stone, brutal Norse warrior energy, heavy metal album art gravitas.',
    soundProfile: 'dark',
    colorNote: 'volcanic orange and dark slate',
  },
  arcane_tower: {
    artDirection: 'Alchemist\'s candlelit laboratory tower — brass astrolabes, bubbling alembics, warm candlelight against dark oak shelves, Da Vinci-era scientific mysticism.',
    soundProfile: 'mysterious',
    colorNote: 'candlelight amber and dark oak brown',
  },
  dragonfire_forge: {
    artDirection: 'Dragon blacksmith volcano forge — molten lava rivers, steam and ember clouds, hammered-iron scale textures, dragon-breath fire in deep orange and charcoal.',
    soundProfile: 'intense',
    colorNote: 'molten orange and forge charcoal',
  },

  // ── ANIMALS ────────────────────────────────────────────────────────────────
  wolf_gold: {
    artDirection: 'Cinematic wildlife photography — midnight wolf pack howling under a full moon, electric blue moonlight on snow, National Geographic cinematic precision.',
    soundProfile: 'intense',
    colorNote: 'electric blue moonlight and silver frost',
  },
  leopard_prowl: {
    artDirection: 'Dappled-light jungle portrait — a leopard\'s amber eyes stare from sun-dappled shadow, National Geographic hyper-realism, ochre and obsidian tension.',
    soundProfile: 'intense',
    colorNote: 'amber gold and jungle obsidian',
  },
  wild_rooster: {
    artDirection: 'Southeast Asian cockfighting spectacle — iridescent feathers in electric teal and crimson, ritual arena grandeur, vivid folk-art border patterns.',
    soundProfile: 'festive',
    colorNote: 'iridescent teal and feather crimson',
  },
  tiger_strike: {
    artDirection: 'Bengal tiger power close-up — extreme macro portrait, blaze-orange and jet-black stripes, snarling danger, cinematic depth-of-field wildlife intensity.',
    soundProfile: 'intense',
    colorNote: 'blaze orange and jet black',
  },
  emerald_dragon: {
    artDirection: 'Eastern mythic dragon over jade mountain valleys — jade-green scales shimmering in misty peak light, temple architecture below, mythic Chinese sublime.',
    soundProfile: 'epic',
    colorNote: 'jade green and mountain mist gold',
  },
  rhino_rampage: {
    artDirection: 'African savanna thunderstorm charge — dust clouds erupt around a charging rhino, earth-tone khaki and red-ochre, storm drama, sheer primal force.',
    soundProfile: 'intense',
    colorNote: 'dust ochre and storm grey',
  },
  tiger_temple: {
    artDirection: 'Rajasthani palace tiger — ornate terracotta-and-gold temple columns framing a resting white tiger, Indian court opulence meets wild-animal power.',
    soundProfile: 'regal',
    colorNote: 'terracotta gold and regal ivory',
  },
  eagle_summit: {
    artDirection: 'Mountain-peak raptor majesty — a bald eagle surveys vast Alaskan sky from a cliff pinnacle, slate-blue atmosphere, stark white and gold silhouette.',
    soundProfile: 'epic',
    colorNote: 'sky slate blue and eagle gold',
  },
  panda_paradise: {
    artDirection: 'Bamboo grove sumi-e ink painting — Japanese ink-wash brushstroke style, monochrome black and white with jade-green bamboo accent, serene and minimal.',
    soundProfile: 'zen',
    colorNote: 'ink black and bamboo jade',
  },
  shark_reef: {
    artDirection: 'Bioluminescent deep-reef danger — a great white glides through glowing coral tunnels, dark teal and electric-cyan abyss, ocean-horror beauty.',
    soundProfile: 'dark',
    colorNote: 'deep teal and bioluminescent cyan',
  },
  wolf_canyon: {
    artDirection: 'American Southwest canyon dusk — russet sandstone arches, purple-sky Navajo-textile geometric patterns, lone wolf silhouette, Land of the Long Shadow.',
    soundProfile: 'adventurous',
    colorNote: 'canyon russet and Navajo purple',
  },
  flamingo_fiesta: {
    artDirection: 'Caribbean flamingo paradise — coral-pink wading birds against turquoise lagoon, tropical-fruit brightness, key-lime and coral palette, resort luxury.',
    soundProfile: 'festive',
    colorNote: 'flamingo coral and lagoon turquoise',
  },

  // ── ASIAN ──────────────────────────────────────────────────────────────────
  lucky_dragon: {
    artDirection: 'Cantonese New Year explosion — firecracker red and 24-karat gold, coiling celestial dragon amid sparks and lantern light, maximum prosperity energy.',
    soundProfile: 'festive',
    colorNote: 'firecracker red and 24-karat gold',
  },
  jade_fortune: {
    artDirection: 'Imperial jade collector\'s gallery — cool celadon jade carvings on obsidian pedestals, Chinese connoisseur quiet luxury, cool green and deep black.',
    soundProfile: 'regal',
    colorNote: 'celadon jade and imperial black',
  },
  dragon_temple: {
    artDirection: 'Thai Wat meets Chinese dragon temple — gilded saffron roof tiles, crimson lacquer columns, incense-smoke haze, gold and vermilion sacred grandeur.',
    soundProfile: 'exotic',
    colorNote: 'temple saffron and vermilion crimson',
  },
  oriental_silk: {
    artDirection: 'Tang Dynasty Silk Road luxury — richly embroidered crimson silk draped over ivory, thread-gold arabesque borders, collector-grade Chinese textile refinement.',
    soundProfile: 'regal',
    colorNote: 'silk crimson and thread gold',
  },
  jade_emperor: {
    artDirection: 'Celestial court of the Jade Emperor — dragon-throne hall bathed in cobalt blue and imperial gold, cloud-scroll motifs, heavenly court protocol.',
    soundProfile: 'epic',
    colorNote: 'imperial cobalt and celestial gold',
  },
  koi_cascade: {
    artDirection: 'Japanese garden watercolour — orange-and-white koi ascending a mossy waterfall, ink-wash painting elegance, flowing water in Hiroshige woodblock style.',
    soundProfile: 'zen',
    colorNote: 'koi orange and waterfall jade',
  },
  samurai_honor: {
    artDirection: 'Feudal Japan bushido code — cherry-blossom petals falling across polished katana steel, Hokusai woodblock print precision, blood-red and iron grey.',
    soundProfile: 'intense',
    colorNote: 'cherry red and katana steel',
  },
  moon_rabbit: {
    artDirection: 'Mid-Autumn Festival lantern warmth — white jade rabbit pounds mooncakes on the moon\'s surface, soft gold lantern light, cloud-white and warm amber glow.',
    soundProfile: 'whimsical',
    colorNote: 'lantern amber and moon white',
  },
  dragon_gate: {
    artDirection: 'Dragon-boat race through ceremonial gate — racing red hulls and thrashing blue water, festival flags and drum energy, competitive Han-dynasty spectacle.',
    soundProfile: 'festive',
    colorNote: 'race red and festival blue',
  },
  lucky_tanuki: {
    artDirection: 'Yokai folklore tanuki — cartoon raccoon-dog with straw hat and sake bottle, warm earthy brown and gold-coin gleam, jovial Edo-era Japanese folk art.',
    soundProfile: 'playful',
    colorNote: 'sake gold and earthy brown',
  },

  // ── HORROR ─────────────────────────────────────────────────────────────────
  cursed_night: {
    artDirection: 'Baroque vampire aristocracy — blood-red rose garden, coffin-black sky, silver moonlight on velvet, decadent Gothic opulence and cold immortal danger.',
    soundProfile: 'dark',
    colorNote: 'blood red and coffin black',
  },
  midnight_phantom: {
    artDirection: 'Paris Opera Ghost — sepia candlelight and crimson velvet curtains, half-mask in shadow, chandelier crystal reflections, romantic and sinister.',
    soundProfile: 'mysterious',
    colorNote: 'sepia gold and opera crimson',
  },
  zombie_carnival: {
    artDirection: 'Día de los Muertos carnival fiesta — sugar-skull faces in marigold yellow, purple, and teal, confetti bones, joyful Latin death-celebration beauty.',
    soundProfile: 'festive',
    colorNote: 'marigold yellow and sugar-skull teal',
  },
  haunted_mansion: {
    artDirection: 'Victorian haunted estate — faded-wallpaper patterns, sheet-ghost silhouettes in moonlit corridors, dusty-rose grey and moss green, gentle melancholy.',
    soundProfile: 'whimsical',
    colorNote: 'dusty rose and moss grey',
  },
  witches_brew: {
    artDirection: 'Wiccan forest ritual at the sabbath — cauldron steam rising through dark oak canopy, electric purple spell-glow, forest black and witch-circle silver.',
    soundProfile: 'dark',
    colorNote: 'spell purple and cauldron black',
  },
  crimson_fang: {
    artDirection: 'Transylvanian vampire clan tableau — Gothic castle interior, fresh-crimson on bone china, aristocratic restraint turned bloody, silver-and-crimson formal horror.',
    soundProfile: 'dark',
    colorNote: 'aristocrat crimson and bone silver',
  },
  plague_doctor: {
    artDirection: 'Medieval plague physician — elongated bird-beak mask in sepia and aged leather, apothecary amber bottles, ochre quarantine walls, morbid quiet authority.',
    soundProfile: 'mysterious',
    colorNote: 'plague sepia and amber leather',
  },
  eldritch_depths: {
    artDirection: 'Lovecraftian cosmic horror — deep-ocean tentacles descending into lightless void, sickly bioluminescent green on crushing black, existential dread made visual.',
    soundProfile: 'dark',
    colorNote: 'abyssal black and sickly green',
  },
  banshee_wail: {
    artDirection: 'Irish Celtic spirit on storm-cliff — translucent wailing banshee in white and woad-blue against crashing wave spray, ancient Celtic stone spiral carvings.',
    soundProfile: 'ethereal',
    colorNote: 'woad blue and spectre white',
  },
  puppet_master: {
    artDirection: 'Venetian marionette horror — commedia dell\'arte masks dangling from gilded strings, crimson and black velvet theatre curtain, uncanny valley elegance.',
    soundProfile: 'dark',
    colorNote: 'Venetian crimson and puppet gold',
  },

  // ── AUSTRALIAN ─────────────────────────────────────────────────────────────
  outback_king: {
    artDirection: 'Red Centre Uluru majesty at golden hour — monolith glowing terracotta against vast cobalt sky, sweeping outback vistas, ancient-land spiritual grandeur.',
    soundProfile: 'epic',
    colorNote: 'Uluru terracotta and outback cobalt',
  },
  boomerang_luck: {
    artDirection: 'Aboriginal dot-painting tradition — traditional ochre, red, and white dots forming symbolic animal stories on dark earth, sacred geometric expression.',
    soundProfile: 'adventurous',
    colorNote: 'ochre earth and sacred white',
  },
  crocodile_gold: {
    artDirection: 'Tropical Top End billabong — mangrove roots in murky olive-green water, sunlight-dappled mud banks, gold-flash in crocodile scales, wild north Australia.',
    soundProfile: 'adventurous',
    colorNote: 'mangrove olive and sunlit gold',
  },
  opal_outback: {
    artDirection: 'Lightning Ridge opal mine — iridescent shifting rainbow fire in raw precious opal, dark ironstone matrix, the infinite colour of Australian gemstone wonder.',
    soundProfile: 'ethereal',
    colorNote: 'iridescent rainbow and ironstone dark',
  },
  platypus_paradise: {
    artDirection: 'Eastern rainforest creek at dawn — whimsical platypus in watercolour botanical illustration, soft rainforest green, brown creek pebbles, wonder of the weird.',
    soundProfile: 'whimsical',
    colorNote: 'rainforest green and creek brown',
  },
  kookaburra_cash: {
    artDirection: 'Eucalyptus forest golden morning — kookaburra perched on a ghost-gum branch, dawn light through silvery leaves, golden wattle blossom, Australian pastoral.',
    soundProfile: 'playful',
    colorNote: 'wattle gold and gum silver',
  },
  crocodile_dundee: {
    artDirection: '1980s adventure-film Australia — weathered khaki and outback leather, croc-tooth knife belt, red-dust energy, Paul Hogan grin, action-hero nostalgia.',
    soundProfile: 'adventurous',
    colorNote: 'khaki tan and red dust',
  },
  uluru_gold: {
    artDirection: 'Sacred red rock at sunset ceremony — deep ochre monolith under streaked magenta and violet sky, ancient gold light, Anangu spiritual connection to country.',
    soundProfile: 'ethereal',
    colorNote: 'sacred ochre and ceremony magenta',
  },
  platypus_fortune: {
    artDirection: 'Billabong at purple dusk — watercolour banksia and teal water reflections, amber lily pads, the shy platypus at the water\'s edge, lyrical nature beauty.',
    soundProfile: 'zen',
    colorNote: 'billabong teal and banksia amber',
  },
  great_barrier: {
    artDirection: 'Great Barrier Reef carnival of life — neon-parrot fish, staghorn coral, manta ray silhouettes in crystalline cyan, a living underwater rainbow cathedral.',
    soundProfile: 'festive',
    colorNote: 'coral cyan and reef rainbow',
  },

  // ── WILDCARD ───────────────────────────────────────────────────────────────
  joker_frenzy: {
    artDirection: 'Playing-card court-jester retro — diamond and club suit patterns in bold red and black, 1920s gambling den lithography, raucous vaudeville excess.',
    soundProfile: 'playful',
    colorNote: 'card red and jester black',
  },
  rainbow_fortune: {
    artDirection: 'Irish pub rainbow fortune — cobblestone village under a double rainbow arc, a pot of gold at the crossroads, emerald green hills, jovial and warm.',
    soundProfile: 'festive',
    colorNote: 'emerald green and rainbow gold',
  },
  carnival_crown: {
    artDirection: 'New Orleans Mardi Gras excess — purple, green, and gold parade floats, feather masks, jazz-trumpet glitter, bayou midnight excess and Bourbon Street joy.',
    soundProfile: 'festive',
    colorNote: 'Mardi Gras purple, green and gold',
  },
  circus_thrills: {
    artDirection: 'Victorian big-top circus ring — red-and-white candy-stripe tent, sawdust golden ring, acrobat silhouettes, ringmaster top-hat showmanship, classic Americana.',
    soundProfile: 'playful',
    colorNote: 'circus red and sawdust gold',
  },
  ticket_to_fortune: {
    artDirection: 'Scratch-card lottery glamour — gold-foil reveal texture, star-burst winner flare, bold primary primary colours, instant-win excitement at maximum pitch.',
    soundProfile: 'playful',
    colorNote: 'gold foil and lottery red',
  },
  pirate_plunder: {
    artDirection: 'Golden Age of Piracy treasure map — worn parchment compass rose, Spanish galleon on the horizon, navy-blue and rum-brown, Robert Louis Stevenson adventure.',
    soundProfile: 'adventurous',
    colorNote: 'treasure navy and rum brown',
  },
  steampunk_fortune: {
    artDirection: 'Victorian clockwork elegance — intricate brass gear mechanisms, riveted copper pressure chambers, amber glass lamp warmth, Jules Verne precision romance.',
    soundProfile: 'adventurous',
    colorNote: 'polished brass and copper amber',
  },
  wild_west_bounty: {
    artDirection: 'American frontier saloon wanted-poster energy — sun-bleached denim, saddle leather, gold sheriff badge, desert-dust atmosphere, Wild West frontier grit.',
    soundProfile: 'adventurous',
    colorNote: 'saddle brown and sheriff gold',
  },
  deep_dive: {
    artDirection: 'Jules Verne submersible treasure hunt — brass porthole frames, pressure-gauge copper dials, green bioluminescent deep-sea glow, nautical Victorian wonder.',
    soundProfile: 'adventurous',
    colorNote: 'submersible copper and deep-sea green',
  },
};

if (typeof module !== 'undefined') module.exports = { ART_DIRECTION };

#!/usr/bin/env python3
"""
Generate symbols, thumbnails, and backgrounds for the 10 adult-only slot games.
Uses Fooocus SDXL via local API on port 7865.
"""
import json, os, shutil, sys, time, traceback
from pathlib import Path

BASE_OUT = Path(r"C:\Users\markm\casino_assets\adult_assets")
PROGRESS_FILE = BASE_OUT / "adult_progress.json"
LOG_FILE = BASE_OUT / "adult_generate.log"

ADULT_GAMES = {
    'sinners_paradise': {
        'name': "Sinner's Paradise",
        'art_style': 'dark baroque oil painting, Caravaggio chiaroscuro',
        'theme_desc': 'hellfire casino, demonic gambling den, red flames, skulls, dice',
        'color_desc': 'deep crimson red, black shadows, gold accents',
        'symbols': {
            's1_dice_fire': 'flaming pair of dice engulfed in hellfire, detailed fire effects',
            's2_whiskey': 'crystal whiskey tumbler with amber liquid, ice cubes, smoke rising',
            's3_cigar': 'lit premium cigar with glowing ember tip, curling smoke trails',
            's4_skull_ace': 'ornate human skull with ace of spades card embedded, gold teeth',
            's5_devil_mask': 'venetian devil masquerade mask, red and gold, horns, jeweled',
            'wild_sin': 'golden ornate frame with SIN text in burning letters, devil wings'
        },
        'bg_desc': 'luxurious underground casino with red velvet, hellfire chandeliers, dark baroque architecture'
    },
    'midnight_burlesque': {
        'name': 'Midnight Burlesque',
        'art_style': 'art deco glamour illustration, 1920s Moulin Rouge poster style',
        'theme_desc': 'glamorous burlesque cabaret, feathers, champagne, spotlights',
        'color_desc': 'deep purple, magenta pink, gold metallic accents',
        'symbols': {
            's1_feather_fan': 'elaborate ostrich feather fan, iridescent purple and pink plumes',
            's2_top_hat': 'glossy black top hat with satin ribbon, theatrical spotlight gleam',
            's3_champagne': 'champagne bottle popping with golden bubbles and spray',
            's4_masquerade': 'elegant masquerade mask with peacock feathers and gems',
            's5_spotlight': 'vintage theatrical spotlight beam cutting through haze',
            'wild_showtime': 'SHOWTIME in neon lights on marquee with art deco frame'
        },
        'bg_desc': 'opulent 1920s burlesque theater stage, velvet curtains, crystal chandeliers, art deco architecture'
    },
    'absinthe_nights': {
        'name': 'Absinthe Nights',
        'art_style': 'art nouveau absinthe poster, Alphonse Mucha inspired illustration',
        'theme_desc': 'bohemian absinthe bar, green fairy, hallucinatory swirls',
        'color_desc': 'emerald green, electric green glow, dark forest green, gold',
        'symbols': {
            's1_green_fairy': 'ethereal glowing green fairy sprite with translucent wings',
            's2_absinthe_glass': 'ornate absinthe glass with slotted spoon and sugar cube, green liquid',
            's3_sugar_cube': 'sugar cube dissolving into absinthe with green flames',
            's4_opium_pipe': 'ornate antique pipe with swirling colored smoke',
            's5_hallucination': 'psychedelic swirling vortex, kaleidoscope of green and gold',
            'wild_fairy': 'enchanted green fairy queen holding golden star, art nouveau frame'
        },
        'bg_desc': 'dimly lit Parisian bohemian absinthe bar, art nouveau decor, green gas lamps, swirling smoke'
    },
    'velvet_lounge': {
        'name': 'Velvet Lounge VIP',
        'art_style': 'photorealistic luxury product photography, soft pink lighting',
        'theme_desc': 'exclusive VIP lounge, pink velvet, cocktails, luxury fashion',
        'color_desc': 'hot pink, rose gold, champagne gold, blush pink',
        'symbols': {
            's1_martini': 'elegant pink martini cocktail in crystal glass, cherry garnish',
            's2_lipstick': 'luxury red lipstick tube, gold case, dramatic makeup product',
            's3_high_heel': 'designer crystal-studded stiletto heel, sparkling gems',
            's4_pearl_necklace': 'lustrous pearl necklace with diamond clasp on velvet',
            's5_red_rose': 'single perfect red rose with water droplets, dramatic lighting',
            'wild_vip': 'VIP golden badge with diamonds and velvet ribbon, premium feel'
        },
        'bg_desc': 'exclusive high-end VIP lounge, pink velvet booths, crystal chandeliers, soft mood lighting'
    },
    'dark_desire': {
        'name': 'Dark Desire',
        'art_style': 'dark gothic fantasy digital painting, dramatic shadows, mystical',
        'theme_desc': 'gothic romance, forbidden treasures, dark mysticism, chains',
        'color_desc': 'deep purple, amethyst violet, black, dark gold',
        'symbols': {
            's1_black_rose': 'single black rose with thorns, dark petals with purple shimmer',
            's2_chains': 'ornate gothic chains with lock, silver and amethyst gems',
            's3_mirror': 'antique ornate hand mirror reflecting mysterious purple light',
            's4_masquerade_gold': 'golden masquerade mask with dark feathers and purple gems',
            's5_forbidden_gem': 'massive glowing amethyst gem, pulsing with dark energy',
            'wild_desire': 'ornate gothic frame with DESIRE in purple fire lettering'
        },
        'bg_desc': 'gothic cathedral interior at midnight, purple moonlight through stained glass, candelabras'
    },
    'vice_city_jackpot': {
        'name': 'Vice City Jackpot',
        'art_style': 'neon noir 80s Miami vice retro illustration, synthwave aesthetic',
        'theme_desc': '80s Miami vice, neon lights, fast cars, palm trees, cash',
        'color_desc': 'hot pink neon, electric orange, deep purple, cyan highlights',
        'symbols': {
            's1_neon_palm': 'neon palm tree silhouette glowing pink against sunset',
            's2_sports_car': 'sleek 80s sports car, neon underlight glow, chrome shine',
            's3_cash_stack': 'thick stack of bills wrapped in gold band',
            's4_gold_gun': 'golden pistol with diamond-encrusted grip, dramatic lighting',
            's5_vice_badge': 'glowing neon detective badge, vice squad, chrome and pink',
            'wild_vice': 'VICE in chromatic 80s neon letters, palm tree silhouettes background'
        },
        'bg_desc': '80s Miami vice cityscape at night, neon signs, palm trees, orange sunset, retro cars'
    },
    'whiskey_barrel': {
        'name': 'Whiskey Barrel Fortunes',
        'art_style': 'warm rustic illustration, photorealistic textures, cozy tavern feel',
        'theme_desc': 'distillery, oak barrels, aged whiskey, copper stills, warmth',
        'color_desc': 'warm amber, rich brown, copper, aged oak, golden honey',
        'symbols': {
            's1_barrel': 'aged oak whiskey barrel with brass bands, dark cellar setting',
            's2_copper_still': 'gleaming copper distillery still, steam and warmth',
            's3_whiskey_bottle': 'premium aged whiskey bottle with wax seal and aged label',
            's4_oak_cask': 'small oak cask with spigot, golden liquid dripping',
            's5_golden_dram': 'crystal whiskey glass with golden liquid, dramatic light through glass',
            'wild_master': 'MASTER DISTILLER golden medallion badge, oak leaf wreath border'
        },
        'bg_desc': 'cozy Scottish distillery cellar, rows of oak barrels, warm amber lighting, stone walls'
    },
    'black_market': {
        'name': 'Black Market Underground',
        'art_style': 'gritty noir film style, high contrast monochrome with selective color',
        'theme_desc': 'underground black market, contraband, safes, dark deals',
        'color_desc': 'charcoal grey, gunmetal, selective gold accents, dark shadows',
        'symbols': {
            's1_briefcase': 'metal briefcase overflowing with gold bars, dramatic noir lighting',
            's2_safe': 'heavy vault safe door slightly ajar, gold glow from inside',
            's3_contraband': 'mysterious wrapped package with wax seal, dark cloth, noir style',
            's4_skeleton_key': 'ornate vintage skeleton key, tarnished brass, mysterious glow',
            's5_black_diamond': 'rare black diamond gem, faceted, dramatic light refraction',
            'wild_dealer': 'silhouette figure in fedora with DEALER text, film noir style'
        },
        'bg_desc': 'dark underground vault, steel doors, dramatic shadows, film noir atmosphere, dim overhead lights'
    },
    'serpent_temptation': {
        'name': 'Serpent Temptation',
        'art_style': 'lush pre-Raphaelite fantasy painting, rich botanical detail',
        'theme_desc': 'garden of Eden, forbidden fruit, serpents, golden chalice',
        'color_desc': 'lush green, crimson red, gold, deep forest tones',
        'symbols': {
            's1_apple': 'luminous red forbidden apple with golden leaf, garden of Eden',
            's2_serpent': 'coiled emerald serpent with golden eyes, garden vine wrapped',
            's3_garden_gate': 'ornate golden garden gate, ivy covered, mystical light beyond',
            's4_forbidden_tree': 'ancient mystical tree with glowing red fruit, twisted trunk',
            's5_golden_chalice': 'ornate golden chalice overflowing with red wine, jeweled',
            'wild_temptress': 'serpent coiled around golden apple, TEMPT text, garden frame'
        },
        'bg_desc': 'lush mystical garden of Eden, ancient trees, hanging fruit, golden light through canopy'
    },
    'neon_underworld': {
        'name': 'Neon Underworld',
        'art_style': 'cyberpunk neon illustration, Blade Runner inspired, rain-soaked',
        'theme_desc': 'cyberpunk underworld, neon skulls, switchblades, poison, crown',
        'color_desc': 'hot pink neon, electric cyan, deep black, purple glow',
        'symbols': {
            's1_skull_neon': 'human skull outlined in neon pink and cyan light tubes',
            's2_switchblade': 'chrome switchblade knife reflecting neon lights, rain drops',
            's3_poison_vial': 'glowing vial of neon green poison, skull label, cyberpunk style',
            's4_neon_cross': 'neon cross sign glowing in rain, cyberpunk alley wall',
            's5_underworld_crown': 'crown made of neon tubes, glowing pink and cyan, cyberpunk',
            'wild_kingpin': 'KINGPIN in massive neon sign letters, crown above, rain dripping'
        },
        'bg_desc': 'cyberpunk underworld alley at night, neon signs, rain, wet reflections, pink and cyan glow'
    },
    'blood_ritual': {
        'name': 'Blood Ritual',
        'art_style': 'dark baroque horror oil painting, Caravaggio chiaroscuro, dramatic shadows',
        'theme_desc': 'occult blood ritual, altar, candles, dark chamber, sacrifice',
        'color_desc': 'deep crimson, black, dried blood red, bone white accents',
        'symbols': {
            's1_bleeding_heart': 'anatomical bleeding heart on stone altar, dark dramatic lighting',
            's2_ritual_dagger': 'ornate obsidian ritual dagger with blood-red jeweled hilt',
            's3_skull_chalice': 'human skull converted into drinking chalice, filled with dark red liquid',
            's4_blood_moon': 'massive blood red moon with dark clouds and bats silhouette',
            's5_pentagram_seal': 'glowing red pentagram seal carved into stone floor, occult symbols',
            'wild_sacrifice': 'ornate dark frame with SACRIFICE text in dripping red blood letters'
        },
        'bg_desc': 'dark occult ritual chamber with stone altar, dripping red candles, pentagram floor, gothic arches'
    },
    'crypt_of_sins': {
        'name': 'Crypt of Sins',
        'art_style': 'gothic horror digital painting, deep shadows, spectral glow',
        'theme_desc': 'ancient crypt, undead, coffins, cursed treasures, demons',
        'color_desc': 'deep purple, spectral green, bone white, shadow black',
        'symbols': {
            's1_coffin': 'ornate gothic coffin with cracked lid, spectral mist seeping out',
            's2_bone_throne': 'throne made entirely of human bones and skulls, dark purple glow',
            's3_cursed_ring': 'ancient cursed ring with pulsing purple gem, dark energy tendrils',
            's4_soul_lantern': 'wrought iron lantern containing trapped green souls, ghostly faces',
            's5_demon_eye': 'massive demon eye with slit pupil, glowing purple and green iris',
            'wild_lich': 'skeletal lich king figure in tattered robes holding dark purple orb'
        },
        'bg_desc': 'ancient underground crypt with stone sarcophagi, purple torchlight, crumbling gothic pillars'
    },
    'flesh_and_gold': {
        'name': 'Flesh & Gold',
        'art_style': 'dark renaissance oil painting, rich textures, dramatic chiaroscuro',
        'theme_desc': 'opulent tyrannical throne room, molten gold, iron and wealth',
        'color_desc': 'molten gold, amber, burnt umber, dark iron black',
        'symbols': {
            's1_gold_mask': 'golden theatrical mask with hollow eyes, ornate filigree, dark background',
            's2_spiked_crown': 'iron crown with gold spikes and blood-red rubies, menacing',
            's3_molten_chain': 'heavy chain links of molten gold dripping, glowing amber',
            's4_branded_coin': 'ancient gold coin with skull brand mark, weathered and sinister',
            's5_iron_maiden': 'ornate iron maiden device with gold trim, partially open, dramatic lighting',
            'wild_emperor': 'dark silhouette of emperor figure on golden throne, EMPEROR text below'
        },
        'bg_desc': 'dark opulent throne room with molten gold pouring from walls, iron chains, dramatic torchlight'
    },
    'opium_den': {
        'name': 'Opium Den',
        'art_style': 'oriental dark fantasy painting, rich detail, atmospheric haze',
        'theme_desc': 'forbidden opium den, dragon statues, smoke, jade, lotus',
        'color_desc': 'deep jade green, smoky emerald, gold, dark mahogany',
        'symbols': {
            's1_hookah_pipe': 'ornate jade and gold hookah pipe with curling green smoke trails',
            's2_poppy_flower': 'blood-red opium poppy flower with dew drops, dark background',
            's3_jade_dragon': 'carved jade dragon statue with glowing emerald eyes, menacing',
            's4_smoke_wisp': 'ethereal green smoke wisp forming a dragon shape, mystical',
            's5_lotus_tattoo': 'dark lotus flower tattoo design with intricate mandala patterns',
            'wild_dragon': 'massive jade dragon head breathing green fire, ornate scales'
        },
        'bg_desc': 'dimly lit oriental opium den with silk curtains, jade dragon statues, thick green haze, lanterns'
    },
    'torture_chamber': {
        'name': 'Torture Chamber',
        'art_style': 'gritty dark medieval realism, harsh lighting, rust and blood',
        'theme_desc': 'medieval dungeon, torture devices, chains, executioner',
        'color_desc': 'rusted iron red, dungeon grey, dried blood brown, shadow black',
        'symbols': {
            's1_rack': 'medieval torture rack device with leather straps and iron gears',
            's2_iron_shackles': 'heavy rusted iron shackles and chains on dungeon wall',
            's3_branding_iron': 'glowing hot branding iron with skull design, embers floating',
            's4_executioner_axe': 'massive executioner battle axe with notched blade, blood stains',
            's5_spiked_wheel': 'medieval breaking wheel with iron spikes, dramatic torchlight',
            'wild_warden': 'hooded dungeon warden silhouette holding keys and whip, WARDEN text'
        },
        'bg_desc': 'medieval stone dungeon with chains on walls, iron maiden, torch sconces, rats, dark atmosphere'
    }
}

NEG = "text, watermark, logo, blurry, low quality, deformed, ugly, cartoon, amateur, jpeg artifacts, frame, border, signature, words, letters, numbers"

def log(msg):
    ts = time.strftime('%H:%M:%S')
    line = "[%s] %s" % (ts, msg)
    print(line)
    try:
        with open(str(LOG_FILE), 'a', encoding='utf-8') as f:
            f.write(line + '\n')
    except Exception:
        pass

def load_progress():
    return {}  # force_overwrite=True - always regenerate all assets

def save_progress(prog):
    PROGRESS_FILE.write_text(json.dumps(prog, indent=2), encoding='utf-8')

def build_args(prompt, neg, aspect):
    """Build 152-arg list matching Fooocus /generate_api endpoint signature"""
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
    args.extend([False, 0, False, None])
    args.extend([False, "Disabled", "Before First Enhancement", "Original Prompts"])
    for _ in range(3):
        args.extend([False, "", "", "", "sam", "full", "vit_b", 0.25, 0.3, 0, False, "v2.6", 1.0, 0.618, 0, False])
    return args

def generate_one(client, prompt, neg, aspect, out_path):
    args = build_args(prompt, neg, aspect)
    result = client.predict(*args, api_name="/generate_api")
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
    BASE_OUT.mkdir(parents=True, exist_ok=True)
    log("=== Adult Game Asset Generation Starting ===")
    try:
        from gradio_client import Client
        client = Client("http://127.0.0.1:7860", serialize=False)
        log("Connected to Fooocus")
    except Exception as e:
        log("Failed to connect: %s" % str(e))
        sys.exit(1)

    prog = load_progress()
    total_assets = 0
    for gid, gdata in ADULT_GAMES.items():
        total_assets += len(gdata['symbols']) + 2
    already = sum(1 for v in prog.values() if v == 'done')
    log("Total: %d assets across %d games" % (total_assets, len(ADULT_GAMES)))
    log("Already done: %d" % already)

    game_idx = 0
    for gid, gdata in ADULT_GAMES.items():
        game_idx += 1
        art_style = gdata['art_style']
        color_desc = gdata['color_desc']

        sym_dir = BASE_OUT / "game_symbols" / gid
        sym_dir.mkdir(parents=True, exist_ok=True)
        for sym_id, sym_desc in gdata['symbols'].items():
            key = "%s/sym/%s" % (gid, sym_id)
            if prog.get(key) == 'done':
                continue
            out_path = sym_dir / ("%s.png" % sym_id)
            prompt = "game icon, slot machine symbol, %s, %s style, %s colors, centered on dark background, clean icon design, high detail" % (sym_desc, art_style, color_desc)
            log("[%d/%d] %s / symbol %s" % (game_idx, len(ADULT_GAMES), gid, sym_id))
            try:
                ok = generate_one(client, prompt, NEG, "1024\u00d71024", out_path)
                if ok:
                    log("  OK %s" % sym_id)
                    prog[key] = 'done'
                else:
                    log("  FAIL (no output)")
            except Exception as e:
                log("  FAIL %s" % str(e).split('\n')[0])
            save_progress(prog)

        thumb_key = "%s/thumbnail" % gid
        if prog.get(thumb_key) != 'done':
            thumb_dir = BASE_OUT / "thumbnails"
            thumb_dir.mkdir(parents=True, exist_ok=True)
            out_path = thumb_dir / ("%s.png" % gid)
            prompt = "slot game promotional banner, %s, %s, %s style, dramatic composition, premium casino game artwork, high detail" % (gdata['name'], gdata['theme_desc'], art_style)
            log("[%d/%d] %s / thumbnail" % (game_idx, len(ADULT_GAMES), gid))
            try:
                ok = generate_one(client, prompt, NEG, "1280\u00d7720", out_path)
                if ok:
                    log("  OK thumbnail")
                    prog[thumb_key] = 'done'
                else:
                    log("  FAIL thumbnail")
            except Exception as e:
                log("  FAIL %s" % str(e).split('\n')[0])
            save_progress(prog)

        bg_key = "%s/background" % gid
        if prog.get(bg_key) != 'done':
            bg_dir = BASE_OUT / "backgrounds"
            bg_dir.mkdir(parents=True, exist_ok=True)
            out_path = bg_dir / ("%s_bg.png" % gid)
            prompt = "%s, wide panoramic background, %s style, %s, atmospheric, cinematic lighting, ultra HD" % (gdata['bg_desc'], art_style, color_desc)
            log("[%d/%d] %s / background" % (game_idx, len(ADULT_GAMES), gid))
            try:
                ok = generate_one(client, prompt, NEG + ", people, faces, characters, figures", "1280\u00d7720", out_path)
                if ok:
                    log("  OK background")
                    prog[bg_key] = 'done'
                else:
                    log("  FAIL background")
            except Exception as e:
                log("  FAIL %s" % str(e).split('\n')[0])
            save_progress(prog)

    done_count = sum(1 for v in prog.values() if v == 'done')
    log("=== Complete: %d/%d assets generated ===" % (done_count, total_assets))

if __name__ == '__main__':
    main()

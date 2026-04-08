#!/usr/bin/env python3
"""
Matrix Spins Casino — HD Asset Generator (Fooocus API + CSS/SVG Fallback)
Generates symbols, backgrounds, bonus art, lobby thumbnails, and 8 studio logos
for all 100 games. Falls back to CSS/SVG procedural assets when Fooocus is offline.

Usage:
    python scripts/asset-generator.py                  # Generate all
    python scripts/asset-generator.py --game sugar_rush # Single game
    python scripts/asset-generator.py --studios-only    # Studio logos only
    python scripts/asset-generator.py --detect          # Just detect Fooocus
    python scripts/asset-generator.py --gap-analysis    # Audit existing assets
    python scripts/asset-generator.py --fallback-only   # CSS/SVG only, skip Fooocus
"""

import os, sys, json, time, hashlib, argparse, subprocess, math
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import URLError

# ═══════════════════════════════════════════════════════════════════════════
# PATHS & CONSTANTS
# ═══════════════════════════════════════════════════════════════════════════

ROOT = Path(__file__).resolve().parent.parent
ASSETS_DIR = ROOT / "assets"
FOOOCUS_CONFIG = ROOT / "fooocus_config.json"
PROMPTS_LOG = ASSETS_DIR / "prompts_log.json"
FAILURES_LOG = ASSETS_DIR / "generation_failures.log"
MANIFEST_FILE = ASSETS_DIR / "manifest.json"

CANDIDATES = [
    "http://127.0.0.1:8888",
    "http://127.0.0.1:7865",
    "http://127.0.0.1:3001",
    "http://localhost:8888",
    "http://127.0.0.1:7860",
    "http://localhost:7865",
    "http://localhost:7860",
]

QUALITY_GATE_MIN_KB = 150  # Reject generated images under 150KB
QUALITY_GATE_RETRY = 1     # Number of retries for quality failures

NEGATIVE_PROMPT = (
    "blurry, low quality, text, watermark, UI, HUD, multiple objects, busy background, "
    "flat design, cartoon, anime, deformed, extra limbs, bad anatomy, cropped, border"
)

# ═══════════════════════════════════════════════════════════════════════════
# STUDIO DEFINITIONS (keyed by slug ID, matching game-definitions.js)
# ═══════════════════════════════════════════════════════════════════════════

STUDIOS = {
    "nebula-gaming": {
        "display": "Nebula Gaming",
        "style": "holographic neon sci-fi, chromatic aberration edges, deep space purple",
        "logo_prompt": "futuristic neon text logo 'Nebula Gaming', purple and cyan glow, holographic, dark background",
        "palette": ["#00e5ff", "#7c4dff", "#1a237e", "#e040fb"],
        "svg_gradient": ("#00e5ff", "#7c4dff"),
    },
    "golden-reels": {
        "display": "Golden Reels Studio",
        "style": "art deco gold styling, warm amber glow, ornate gilded frames",
        "logo_prompt": "elegant art deco gold text logo 'Golden Reels', ornate brass frame, warm amber, dark background",
        "palette": ["#ffd700", "#ff8f00", "#4e342e", "#fff8e1"],
        "svg_gradient": ("#ffd700", "#ff8f00"),
    },
    "mythic-forge": {
        "display": "Mythic Forge",
        "style": "ancient stone carving, jewel inlays, torch lighting, mythological",
        "logo_prompt": "ancient stone carved text logo 'Mythic Forge', jewel inlays, torch-lit, dark background",
        "palette": ["#b388ff", "#7c4dff", "#311b92", "#d1c4e9"],
        "svg_gradient": ("#b388ff", "#7c4dff"),
    },
    "ironclad": {
        "display": "Ironclad Entertainment",
        "style": "steampunk brass and leather, riveted metal, aged patina, industrial",
        "logo_prompt": "steampunk riveted metal text logo 'Ironclad', brass and leather, aged patina, dark background",
        "palette": ["#ff6d00", "#bf360c", "#3e2723", "#ffab40"],
        "svg_gradient": ("#ff6d00", "#bf360c"),
    },
    "shadow-works": {
        "display": "Shadow Works",
        "style": "dark gothic horror, sickly green rim light, decay texture, eerie",
        "logo_prompt": "gothic horror text logo 'Shadow Works', dark red and green glow, distressed, dark background",
        "palette": ["#69f0ae", "#1b5e20", "#212121", "#b9f6ca"],
        "svg_gradient": ("#69f0ae", "#1b5e20"),
    },
    "wild-frontier": {
        "display": "Wild Frontier Games",
        "style": "naturalistic painterly, earthy rich colours, adventurous, wild nature",
        "logo_prompt": "rustic naturalistic text logo 'Wild Frontier', earth tones, wooden texture, dark background",
        "palette": ["#ff4081", "#880e4f", "#33691e", "#f8bbd0"],
        "svg_gradient": ("#ff4081", "#880e4f"),
    },
    "cascade-labs": {
        "display": "Cascade Labs",
        "style": "clean geometric modern, bold flat gradients, sharp edges, tech-forward",
        "logo_prompt": "minimalist modern text logo 'Cascade Labs', clean gradients, geometric font, dark background",
        "palette": ["#ffd740", "#f9a825", "#1a237e", "#fff9c4"],
        "svg_gradient": ("#ffd740", "#f9a825"),
    },
    "dragon-pearl": {
        "display": "Dragon Pearl Studios",
        "style": "Chinese lacquerware, red and gold, jade accents, oriental luxury",
        "logo_prompt": "Chinese calligraphy style text logo 'Dragon Pearl', red and gold, jade accents, dark background",
        "palette": ["#40c4ff", "#d50000", "#b71c1c", "#ffecb3"],
        "svg_gradient": ("#40c4ff", "#d50000"),
    },
}

# ═══════════════════════════════════════════════════════════════════════════
# PROGRESS BAR
# ═══════════════════════════════════════════════════════════════════════════

def progress_bar(current, total, label="", bar_len=40):
    """Print a terminal progress bar."""
    pct = current / max(total, 1)
    filled = int(bar_len * pct)
    bar = "█" * filled + "░" * (bar_len - filled)
    sys.stdout.write(f"\r  [{bar}] {current}/{total} {label}")
    sys.stdout.flush()
    if current >= total:
        print()


# ═══════════════════════════════════════════════════════════════════════════
# FOOOCUS DETECTION
# ═══════════════════════════════════════════════════════════════════════════

def detect_fooocus():
    """Detect running Fooocus instance across all candidate ports."""
    # Check saved config first
    if FOOOCUS_CONFIG.exists():
        try:
            cfg = json.loads(FOOOCUS_CONFIG.read_text())
            url = cfg.get("base_url", "")
            if url and _ping(url):
                print(f"[DETECT] Fooocus found at {url} (cached config)")
                return url
        except Exception:
            pass

    print("[DETECT] Scanning ports for Fooocus...")
    for url in CANDIDATES:
        port = url.split(":")[-1]
        sys.stdout.write(f"  Checking {url}...")
        if _ping(url):
            print(" FOUND!")
            FOOOCUS_CONFIG.write_text(json.dumps({
                "base_url": url,
                "detected_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            }, indent=2))
            return url
        print(" no response")

    return None


def _ping(url):
    """Check if a URL responds with Fooocus/Gradio content."""
    try:
        resp = urlopen(Request(url, headers={"User-Agent": "MatrixSpins-AssetGen/1.0"}), timeout=5)
        body = resp.read(4000).decode("utf-8", errors="ignore").lower()
        return "fooocus" in body or "gradio" in body or "text-to-image" in body
    except Exception:
        return False


# ═══════════════════════════════════════════════════════════════════════════
# FOOOCUS API
# ═══════════════════════════════════════════════════════════════════════════

def generate_image(base_url, prompt, negative_prompt, width, height, seed=-1):
    """Call Fooocus API to generate an image. Returns (image_bytes, seed) or (None, -1)."""
    api_url = f"{base_url}/api/v1/generation/text-to-image"

    payload = json.dumps({
        "prompt": prompt,
        "negative_prompt": negative_prompt,
        "style_selections": ["Fooocus V2", "Fooocus Enhance", "Fooocus Sharp"],
        "performance_selection": "Quality",
        "aspect_ratios_selection": f"{width}*{height}",
        "image_number": 1,
        "image_seed": seed,
        "sharpness": 2.0,
        "guidance_scale": 7.0,
        "base_model_name": "juggernautXL_v8Rundiffusion.safetensors",
        "refiner_switch": 0.8,
    }).encode("utf-8")

    req = Request(api_url, data=payload, headers={"Content-Type": "application/json"})

    for attempt in range(3):
        try:
            resp = urlopen(req, timeout=180)
            result = json.loads(resp.read())

            if isinstance(result, list) and len(result) > 0:
                img_data = result[0]
                result_seed = img_data.get("seed", seed)
                if "base64" in img_data:
                    import base64
                    return base64.b64decode(img_data["base64"]), result_seed
                elif "url" in img_data:
                    img_resp = urlopen(img_data["url"], timeout=30)
                    return img_resp.read(), result_seed

            print(f"\n  [WARN] Unexpected API response (attempt {attempt+1}/3)")
        except Exception as e:
            print(f"\n  [WARN] API call failed (attempt {attempt+1}/3): {e}")
            if attempt < 2:
                time.sleep(10)

    return None, -1


# ═══════════════════════════════════════════════════════════════════════════
# GAME LOADER
# ═══════════════════════════════════════════════════════════════════════════

def load_games():
    """Load game definitions from Node.js module."""
    result = subprocess.run(
        ["node", "-e", "console.log(JSON.stringify(require('./shared/game-definitions.js')))"],
        capture_output=True, text=True, cwd=str(ROOT)
    )
    if result.returncode != 0:
        print(f"[ERROR] Failed to load game definitions: {result.stderr}")
        sys.exit(1)
    games = json.loads(result.stdout)
    print(f"[OK] Loaded {len(games)} game definitions")
    return games


# ═══════════════════════════════════════════════════════════════════════════
# QUALITY GATE & LOGGING
# ═══════════════════════════════════════════════════════════════════════════

def save_image(data, path, min_kb=QUALITY_GATE_MIN_KB):
    """Save image data. Returns True if quality gate passes."""
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_bytes(data)
    size_kb = len(data) / 1024
    if size_kb < min_kb:
        print(f"\n  [QUALITY FAIL] {Path(path).name}: {size_kb:.0f}KB < {min_kb}KB minimum")
        return False
    return True


def log_prompt(game_id, asset_type, prompt, seed):
    """Append to the prompts log JSON."""
    log = []
    if PROMPTS_LOG.exists():
        try:
            log = json.loads(PROMPTS_LOG.read_text())
        except Exception:
            pass
    log.append({
        "game_id": game_id,
        "asset_type": asset_type,
        "prompt": prompt,
        "seed": seed,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
    })
    PROMPTS_LOG.write_text(json.dumps(log, indent=2))


def log_failure(game_id, asset_type, reason):
    """Append to the failures log."""
    with open(FAILURES_LOG, "a") as f:
        f.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S')} | {game_id} | {asset_type} | {reason}\n")


# ═══════════════════════════════════════════════════════════════════════════
# FOOOCUS ASSET GENERATION
# ═══════════════════════════════════════════════════════════════════════════

def generate_game_assets_fooocus(base_url, game, idx, total):
    """Generate all HD assets for a single game using Fooocus."""
    game_id = game["id"]
    name = game["name"]
    provider = game.get("provider", "")
    symbols = game.get("symbols", [])
    studio = STUDIOS.get(provider, {})
    studio_style = studio.get("style", "")

    prefix = f"[{idx}/{total}]"
    print(f"\n{prefix} {name} ({studio.get('display', provider)})")

    sym_dir = ASSETS_DIR / "game_symbols" / game_id
    bg_dir = ASSETS_DIR / "backgrounds" / "slots"
    thumb_dir = ASSETS_DIR / "thumbnails"
    bonus_dir = ASSETS_DIR / "bonus" / game_id
    sym_dir.mkdir(parents=True, exist_ok=True)
    bg_dir.mkdir(parents=True, exist_ok=True)
    thumb_dir.mkdir(parents=True, exist_ok=True)
    bonus_dir.mkdir(parents=True, exist_ok=True)

    asset_count = len(symbols) + 3  # symbols + bg_land + bg_port + thumbnail
    generated = 0

    # --- Symbols ---
    for i, sym in enumerate(symbols[:8]):
        sym_clean = sym.replace("_", " ")
        out_png = sym_dir / f"{sym}.png"
        out_webp = sym_dir / f"{sym}.webp"

        if out_png.exists() and out_png.stat().st_size > 1024:
            generated += 1
            progress_bar(generated, asset_count, f"{sym}")
            continue

        prompt = f"single {sym_clean} icon, game symbol, centered, detailed, {studio_style}, isolated on dark background, high detail"
        data, seed = generate_image(base_url, prompt, NEGATIVE_PROMPT, 512, 512)

        if data:
            ok = save_image(data, out_png, min_kb=10)
            if not ok and QUALITY_GATE_RETRY > 0:
                data, seed = generate_image(base_url, prompt, NEGATIVE_PROMPT, 512, 512)
                if data:
                    save_image(data, out_png, min_kb=0)
                else:
                    log_failure(game_id, f"symbol_{sym}", "retry failed")
            log_prompt(game_id, f"symbol_{sym}", prompt, seed)
            _convert_webp(out_png, out_webp)
        else:
            log_failure(game_id, f"symbol_{sym}", "API returned no data")

        generated += 1
        progress_bar(generated, asset_count, f"{sym}")

    # --- Background Landscape ---
    bg_land = bg_dir / f"{game_id}.png"
    if not bg_land.exists():
        theme_desc = name.replace("1000", "").strip()
        prompt = f"wide cinematic background for '{theme_desc}' slot game, {studio_style}, atmospheric, no text, no UI, no reels, detailed environment"
        data, seed = generate_image(base_url, prompt, NEGATIVE_PROMPT, 1920, 1080)
        if data:
            ok = save_image(data, bg_land, min_kb=50)
            if not ok:
                data, seed = generate_image(base_url, prompt, NEGATIVE_PROMPT, 1920, 1080)
                if data:
                    save_image(data, bg_land, min_kb=0)
                else:
                    log_failure(game_id, "bg_landscape", "retry failed")
            else:
                log_prompt(game_id, "bg_landscape", prompt, seed)
            _convert_webp(bg_land, bg_dir / f"{game_id}.webp")
        else:
            log_failure(game_id, "bg_landscape", "API returned no data")
    generated += 1
    progress_bar(generated, asset_count, "bg_landscape")

    # --- Background Portrait ---
    bg_port = bg_dir / f"{game_id}_portrait.png"
    if not bg_port.exists():
        theme_desc = name.replace("1000", "").strip()
        prompt = f"tall portrait background for '{theme_desc}' slot game, {studio_style}, atmospheric, mobile-first, no text, no UI"
        data, seed = generate_image(base_url, prompt, NEGATIVE_PROMPT, 1080, 1920)
        if data:
            save_image(data, bg_port, min_kb=50)
            log_prompt(game_id, "bg_portrait", prompt, seed)
            _convert_webp(bg_port, bg_dir / f"{game_id}_portrait.webp")
        else:
            log_failure(game_id, "bg_portrait", "API returned no data")
    generated += 1
    progress_bar(generated, asset_count, "bg_portrait")

    # --- Lobby Thumbnail ---
    thumb = thumb_dir / f"{game_id}.png"
    if not thumb.exists():
        theme_desc = name.replace("1000", "").strip()
        prompt = f"bold hero thumbnail for '{theme_desc}' slot game, {studio_style}, dramatic, eye-catching, no text, cinematic"
        data, seed = generate_image(base_url, prompt, NEGATIVE_PROMPT, 600, 400)
        if data:
            save_image(data, thumb, min_kb=20)
            log_prompt(game_id, "thumbnail", prompt, seed)
            _convert_webp(thumb, thumb_dir / f"{game_id}.webp")
        else:
            log_failure(game_id, "thumbnail", "API returned no data")
    generated += 1
    progress_bar(generated, asset_count, "thumbnail")

    # --- Bonus Art ---
    bonus_file = bonus_dir / "bonus.png"
    if not bonus_file.exists():
        prompt = f"celebratory bonus round art for '{name}' slot game, {studio_style}, exciting, high energy, gold coins, sparkles, no text"
        data, seed = generate_image(base_url, prompt, NEGATIVE_PROMPT, 1280, 720)
        if data:
            save_image(data, bonus_file, min_kb=30)
            log_prompt(game_id, "bonus", prompt, seed)
        else:
            log_failure(game_id, "bonus", "API returned no data")


def generate_studio_logos_fooocus(base_url):
    """Generate HD logos for all 8 studios using Fooocus."""
    logo_dir = ASSETS_DIR / "studio-logos"
    logo_dir.mkdir(parents=True, exist_ok=True)

    for slug, studio in STUDIOS.items():
        out = logo_dir / f"{slug}.png"
        if out.exists() and out.stat().st_size > 1024:
            print(f"  [SKIP] {studio['display']} logo (exists)")
            continue

        print(f"  Generating logo: {studio['display']}...")
        data, seed = generate_image(base_url, studio["logo_prompt"], NEGATIVE_PROMPT, 400, 120)
        if data:
            save_image(data, out, min_kb=1)
            log_prompt("studios", f"logo_{slug}", studio["logo_prompt"], seed)
        else:
            log_failure("studios", f"logo_{slug}", "API returned no data")


def _convert_webp(src_path, dst_path):
    """Convert PNG to WebP using PIL if available."""
    try:
        from PIL import Image
        img = Image.open(str(src_path))
        img.save(str(dst_path), "WEBP", quality=85)
    except ImportError:
        pass
    except Exception:
        pass


# ═══════════════════════════════════════════════════════════════════════════
# CSS/SVG FALLBACK GENERATION
# ═══════════════════════════════════════════════════════════════════════════

def generate_fallback_symbol_svg(symbol_name, studio_slug, out_path):
    """Generate an SVG symbol icon as a fallback."""
    studio = STUDIOS.get(studio_slug, {})
    c1, c2 = studio.get("svg_gradient", ("#ffd700", "#ff6b35"))
    palette = studio.get("palette", ["#ffd700", "#ff6b35", "#333", "#fff"])

    # Hash symbol name for deterministic visual variation
    h = int(hashlib.md5(symbol_name.encode()).hexdigest()[:8], 16)
    shape_type = h % 5  # 0=diamond, 1=circle, 2=star, 3=hexagon, 4=shield
    rotation = (h % 360)
    bg_color = palette[2] if len(palette) > 2 else "#1a1a2e"

    shapes = {
        0: f'<polygon points="50,5 95,50 50,95 5,50" fill="url(#g)" stroke="{c1}" stroke-width="2"/>',
        1: f'<circle cx="50" cy="50" r="42" fill="url(#g)" stroke="{c1}" stroke-width="2"/>',
        2: _star_polygon(50, 50, 5, 42, 20, c1),
        3: _hexagon(50, 50, 42, c1),
        4: f'<path d="M50 5 L90 20 L90 65 L50 95 L10 65 L10 20 Z" fill="url(#g)" stroke="{c1}" stroke-width="2"/>',
    }

    clean_name = symbol_name.replace("_", " ").replace("s1 ", "").replace("s2 ", "").replace("s3 ", "").replace("s4 ", "").replace("s5 ", "").replace("s6 ", "")
    display = clean_name[:8].upper()

    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="{c1}"/>
      <stop offset="100%" stop-color="{c2}"/>
    </linearGradient>
    <filter id="glow"><feGaussianBlur stdDeviation="2" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="100" height="100" rx="12" fill="{bg_color}"/>
  <g filter="url(#glow)" transform="rotate({rotation % 15} 50 50)">
    {shapes.get(shape_type, shapes[0])}
  </g>
  <text x="50" y="56" text-anchor="middle" font-family="Arial,sans-serif" font-weight="bold"
        font-size="14" fill="white" filter="url(#glow)">{display}</text>
</svg>'''

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    Path(out_path).write_text(svg, encoding="utf-8")


def _star_polygon(cx, cy, points, outer_r, inner_r, color):
    """Generate SVG star polygon points."""
    coords = []
    for i in range(points * 2):
        r = outer_r if i % 2 == 0 else inner_r
        angle = math.pi * i / points - math.pi / 2
        x = cx + r * math.cos(angle)
        y = cy + r * math.sin(angle)
        coords.append(f"{x:.1f},{y:.1f}")
    return f'<polygon points="{" ".join(coords)}" fill="url(#g)" stroke="{color}" stroke-width="2"/>'


def _hexagon(cx, cy, r, color):
    """Generate SVG hexagon."""
    coords = []
    for i in range(6):
        angle = math.pi / 3 * i - math.pi / 6
        x = cx + r * math.cos(angle)
        y = cy + r * math.sin(angle)
        coords.append(f"{x:.1f},{y:.1f}")
    return f'<polygon points="{" ".join(coords)}" fill="url(#g)" stroke="{color}" stroke-width="2"/>'


def generate_fallback_background_svg(game_name, studio_slug, orientation, out_path):
    """Generate an SVG background as a CSS/SVG fallback."""
    studio = STUDIOS.get(studio_slug, {})
    c1, c2 = studio.get("svg_gradient", ("#ffd700", "#ff6b35"))
    palette = studio.get("palette", ["#ffd700", "#ff6b35", "#1a1a2e", "#fff"])
    bg = palette[2] if len(palette) > 2 else "#1a1a2e"

    w, h = (1920, 1080) if orientation == "landscape" else (1080, 1920)

    # Deterministic decorative elements from game name hash
    gh = int(hashlib.md5(game_name.encode()).hexdigest()[:8], 16)
    num_circles = 5 + (gh % 8)
    circles = ""
    for i in range(num_circles):
        cx = (gh * (i + 1) * 137) % w
        cy = (gh * (i + 1) * 251) % h
        r = 30 + (gh * (i + 3)) % 120
        opacity = 0.03 + (i % 5) * 0.02
        circles += f'  <circle cx="{cx}" cy="{cy}" r="{r}" fill="{c1}" opacity="{opacity:.2f}"/>\n'

    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="40%" r="80%">
      <stop offset="0%" stop-color="{c2}" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="{bg}"/>
    </radialGradient>
    <linearGradient id="shine" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="{c1}" stop-opacity="0.05"/>
      <stop offset="50%" stop-color="{c1}" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="{c1}" stop-opacity="0.02"/>
    </linearGradient>
  </defs>
  <rect width="{w}" height="{h}" fill="{bg}"/>
  <rect width="{w}" height="{h}" fill="url(#bg)"/>
{circles}  <rect width="{w}" height="{h}" fill="url(#shine)"/>
</svg>'''

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    Path(out_path).write_text(svg, encoding="utf-8")


def generate_fallback_thumbnail_svg(game_name, studio_slug, out_path):
    """Generate a lobby thumbnail SVG fallback."""
    studio = STUDIOS.get(studio_slug, {})
    c1, c2 = studio.get("svg_gradient", ("#ffd700", "#ff6b35"))
    palette = studio.get("palette", ["#ffd700", "#ff6b35", "#1a1a2e", "#fff"])
    bg = palette[2] if len(palette) > 2 else "#1a1a2e"
    text_color = palette[3] if len(palette) > 3 else "#ffffff"

    display_name = game_name.replace("_", " ").title()
    # Truncate long names
    if len(display_name) > 20:
        display_name = display_name[:18] + "..."

    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400" width="600" height="400">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="{c1}"/>
      <stop offset="100%" stop-color="{c2}"/>
    </linearGradient>
    <filter id="shadow"><feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="#000" flood-opacity="0.5"/></filter>
  </defs>
  <rect width="600" height="400" rx="16" fill="{bg}"/>
  <rect width="600" height="400" rx="16" fill="url(#g)" opacity="0.15"/>
  <rect x="20" y="20" width="560" height="360" rx="12" fill="none" stroke="{c1}" stroke-width="2" opacity="0.3"/>
  <text x="300" y="190" text-anchor="middle" font-family="Arial,sans-serif" font-weight="900"
        font-size="36" fill="{text_color}" filter="url(#shadow)">{display_name}</text>
  <text x="300" y="240" text-anchor="middle" font-family="Arial,sans-serif" font-size="14"
        fill="{c1}" opacity="0.7">{studio.get("display", "Matrix Spins")}</text>
</svg>'''

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    Path(out_path).write_text(svg, encoding="utf-8")


def generate_fallback_studio_logo_svg(slug, out_path):
    """Generate a studio logo SVG (if not already present)."""
    studio = STUDIOS.get(slug, {})
    c1, c2 = studio.get("svg_gradient", ("#ffd700", "#ff6b35"))
    display = studio.get("display", slug.replace("-", " ").title())

    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60" width="200" height="60">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="{c1}"/>
      <stop offset="100%" stop-color="{c2}"/>
    </linearGradient>
  </defs>
  <rect width="200" height="60" rx="8" fill="#121212"/>
  <circle cx="30" cy="30" r="16" fill="url(#g)" opacity="0.9"/>
  <text x="56" y="35" font-family="Arial,sans-serif" font-weight="700" font-size="15"
        fill="url(#g)">{display}</text>
</svg>'''

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    Path(out_path).write_text(svg, encoding="utf-8")


def generate_all_fallbacks(games):
    """Generate CSS/SVG fallback assets for all games missing HD assets."""
    print("\n=== CSS/SVG Fallback Generation ===\n")
    total_generated = 0
    total_skipped = 0

    for idx, game in enumerate(games, 1):
        game_id = game["id"]
        name = game["name"]
        provider = game.get("provider", "")
        symbols = game.get("symbols", [])

        game_generated = 0

        # --- Symbol SVGs ---
        sym_dir = ASSETS_DIR / "game_symbols" / game_id
        for sym in symbols:
            # Check for existing PNG or SVG
            png_path = sym_dir / f"{sym}.png"
            svg_path = sym_dir / f"{sym}.svg"
            webp_path = sym_dir / f"{sym}.webp"
            if png_path.exists() or webp_path.exists() or svg_path.exists():
                total_skipped += 1
                continue
            generate_fallback_symbol_svg(sym, provider, svg_path)
            game_generated += 1

        # --- Background SVGs ---
        bg_dir = ASSETS_DIR / "backgrounds" / "slots"
        for orient in ["landscape", "portrait"]:
            suffix = "" if orient == "landscape" else "_portrait"
            png_path = bg_dir / f"{game_id}{suffix}.png"
            webp_path = bg_dir / f"{game_id}{suffix}.webp"
            svg_path = bg_dir / f"{game_id}{suffix}.svg"
            if png_path.exists() or webp_path.exists() or svg_path.exists():
                total_skipped += 1
                continue
            generate_fallback_background_svg(name, provider, orient, svg_path)
            game_generated += 1

        # --- Thumbnail SVG ---
        thumb_dir = ASSETS_DIR / "thumbnails"
        thumb_png = thumb_dir / f"{game_id}.png"
        thumb_webp = thumb_dir / f"{game_id}.webp"
        thumb_svg = thumb_dir / f"{game_id}.svg"
        if not thumb_png.exists() and not thumb_webp.exists() and not thumb_svg.exists():
            generate_fallback_thumbnail_svg(name, provider, thumb_svg)
            game_generated += 1
        else:
            total_skipped += 1

        total_generated += game_generated
        progress_bar(idx, len(games), f"{game_id} (+{game_generated} SVGs)")

    # --- Studio Logo SVGs ---
    logo_dir = ASSETS_DIR / "studio-logos"
    for slug in STUDIOS:
        svg_path = logo_dir / f"{slug}.svg"
        png_path = logo_dir / f"{slug}.png"
        if not svg_path.exists() and not png_path.exists():
            generate_fallback_studio_logo_svg(slug, svg_path)
            total_generated += 1
        else:
            total_skipped += 1

    print(f"\n[FALLBACK] Generated {total_generated} SVG fallbacks, skipped {total_skipped} (already had assets)")
    return total_generated


# ═══════════════════════════════════════════════════════════════════════════
# GAP ANALYSIS
# ═══════════════════════════════════════════════════════════════════════════

def run_gap_analysis(games):
    """Audit existing assets and report what's missing."""
    print("\n=== Asset Gap Analysis ===\n")

    missing = {"symbols": 0, "backgrounds": 0, "thumbnails": 0, "bonus": 0, "logos": 0}
    present = {"symbols": 0, "backgrounds": 0, "thumbnails": 0, "bonus": 0, "logos": 0}
    games_incomplete = []

    for game in games:
        game_id = game["id"]
        symbols = game.get("symbols", [])
        game_missing = []

        # Check symbols
        sym_dir = ASSETS_DIR / "game_symbols" / game_id
        for sym in symbols:
            has_any = any((sym_dir / f"{sym}{ext}").exists() for ext in [".png", ".webp", ".svg"])
            if has_any:
                present["symbols"] += 1
            else:
                missing["symbols"] += 1
                game_missing.append(f"symbol:{sym}")

        # Check backgrounds
        bg_dir = ASSETS_DIR / "backgrounds" / "slots"
        for suffix in ["", "_portrait"]:
            has_any = any((bg_dir / f"{game_id}{suffix}{ext}").exists() for ext in [".png", ".webp", ".svg"])
            if has_any:
                present["backgrounds"] += 1
            else:
                missing["backgrounds"] += 1
                game_missing.append(f"bg{'_portrait' if suffix else '_landscape'}")

        # Check thumbnail
        thumb_dir = ASSETS_DIR / "thumbnails"
        has_thumb = any((thumb_dir / f"{game_id}{ext}").exists() for ext in [".png", ".webp", ".svg"])
        if has_thumb:
            present["thumbnails"] += 1
        else:
            missing["thumbnails"] += 1
            game_missing.append("thumbnail")

        if game_missing:
            games_incomplete.append((game_id, game_missing))

    # Check studio logos
    logo_dir = ASSETS_DIR / "studio-logos"
    for slug in STUDIOS:
        has_logo = any((logo_dir / f"{slug}{ext}").exists() for ext in [".svg", ".png"])
        if has_logo:
            present["logos"] += 1
        else:
            missing["logos"] += 1

    total_present = sum(present.values())
    total_missing = sum(missing.values())
    total = total_present + total_missing

    print(f"  Asset Coverage: {total_present}/{total} ({total_present/max(total,1)*100:.1f}%)\n")
    print(f"  {'Category':<15} {'Present':>8} {'Missing':>8} {'Coverage':>10}")
    print(f"  {'─'*15} {'─'*8} {'─'*8} {'─'*10}")
    for cat in ["symbols", "backgrounds", "thumbnails", "bonus", "logos"]:
        p, m = present[cat], missing[cat]
        t = p + m
        pct = p / max(t, 1) * 100
        print(f"  {cat:<15} {p:>8} {m:>8} {pct:>9.1f}%")

    if games_incomplete:
        print(f"\n  Games with missing assets ({len(games_incomplete)}):")
        for gid, items in games_incomplete[:20]:
            print(f"    {gid}: {', '.join(items[:5])}")
        if len(games_incomplete) > 20:
            print(f"    ... and {len(games_incomplete) - 20} more")

    return missing, present


# ═══════════════════════════════════════════════════════════════════════════
# MANIFEST UPDATE
# ═══════════════════════════════════════════════════════════════════════════

def update_manifest(games):
    """Rebuild the asset manifest JSON."""
    manifest = []
    for game in games:
        game_id = game["id"]
        provider = game.get("provider", "")
        symbols = game.get("symbols", [])

        entry = {
            "id": game_id,
            "name": game["name"],
            "studio": provider,
            "provider": STUDIOS.get(provider, {}).get("display", provider),
            "assets": {
                "thumbnail": _find_asset("thumbnails", game_id),
                "symbols": {},
                "backgrounds": {
                    "landscape": _find_asset("backgrounds/slots", game_id),
                    "portrait": _find_asset("backgrounds/slots", f"{game_id}_portrait"),
                },
                "studioLogo": _find_asset("studio-logos", provider),
            }
        }

        for sym in symbols:
            entry["assets"]["symbols"][sym] = _find_asset(f"game_symbols/{game_id}", sym)

        manifest.append(entry)

    manifest_data = {
        "generated": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "version": "3.0.0",
        "games": manifest,
    }
    MANIFEST_FILE.write_text(json.dumps(manifest_data, indent=2))
    print(f"\n[OK] Manifest updated: {MANIFEST_FILE}")


def _find_asset(subdir, name):
    """Find the best available asset format (PNG > WebP > SVG)."""
    base = ASSETS_DIR / subdir
    for ext in [".png", ".webp", ".svg", ".jpg"]:
        path = base / f"{name}{ext}"
        if path.exists():
            return f"assets/{subdir}/{name}{ext}"
    return None


# ═══════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="Matrix Spins Casino — HD Asset Generator")
    parser.add_argument("--game", help="Generate assets for a single game ID")
    parser.add_argument("--studios-only", action="store_true", help="Only generate studio logos")
    parser.add_argument("--detect", action="store_true", help="Only detect Fooocus instance")
    parser.add_argument("--gap-analysis", action="store_true", help="Audit existing assets")
    parser.add_argument("--fallback-only", action="store_true", help="Generate CSS/SVG fallbacks only")
    parser.add_argument("--update-manifest", action="store_true", help="Rebuild asset manifest")
    args = parser.parse_args()

    print("╔══════════════════════════════════════════════════╗")
    print("║  Matrix Spins Casino — Asset Generator v3.0.0   ║")
    print("╚══════════════════════════════════════════════════╝\n")

    ASSETS_DIR.mkdir(parents=True, exist_ok=True)

    # Load games
    games = load_games()

    # Gap analysis mode
    if args.gap_analysis:
        run_gap_analysis(games)
        return

    # Manifest update mode
    if args.update_manifest:
        update_manifest(games)
        return

    # Fallback-only mode
    if args.fallback_only:
        generate_all_fallbacks(games)
        update_manifest(games)
        return

    # Detect Fooocus
    base_url = detect_fooocus()

    if not base_url:
        print("\n╔══════════════════════════════════════════════════════════════╗")
        print("║  [INFO] No Fooocus instance detected on any port.          ║")
        print("║                                                             ║")
        print("║  To generate HD assets, launch Fooocus with:               ║")
        print("║    python entry_with_update.py --listen --port 8888         ║")
        print("║                               --enable-api                  ║")
        print("║                                                             ║")
        print("║  Falling back to CSS/SVG procedural generation...           ║")
        print("╚══════════════════════════════════════════════════════════════╝\n")

        if args.detect:
            return

        # Fall back to CSS/SVG
        generate_all_fallbacks(games)
        update_manifest(games)

        # Run gap analysis to summarize
        run_gap_analysis(games)
        return

    print(f"\n[OK] Fooocus detected at {base_url}\n")

    if args.detect:
        return

    # Generate studio logos first
    print("=== Generating Studio Logos ===\n")
    generate_studio_logos_fooocus(base_url)

    if args.studios_only:
        return

    # Filter to single game if requested
    target_games = games
    if args.game:
        target_games = [g for g in games if g["id"] == args.game]
        if not target_games:
            print(f"[ERROR] Game '{args.game}' not found")
            sys.exit(1)

    # Generate all game assets
    print(f"\n=== Generating HD Assets for {len(target_games)} Games ===\n")
    for i, game in enumerate(target_games, 1):
        generate_game_assets_fooocus(base_url, game, i, len(target_games))

    # Generate CSS/SVG fallbacks for any remaining gaps
    print("\n=== Filling Gaps with CSS/SVG Fallbacks ===")
    generate_all_fallbacks(target_games)

    # Update manifest
    update_manifest(games)

    # Final report
    print("\n=== Final Asset Report ===")
    run_gap_analysis(games)

    if FAILURES_LOG.exists():
        failures = [l for l in FAILURES_LOG.read_text().strip().split("\n") if l.strip()]
        if failures:
            print(f"\n[WARN] {len(failures)} failures logged to {FAILURES_LOG}")

    print("\n[DONE] Asset generation complete!")


if __name__ == "__main__":
    main()

        // Namespace to reduce global pollution
        window.MatrixSpins = window.MatrixSpins || {};

        // Game data loaded from shared/game-definitions.js
        // (60 game definitions moved to separate module)


        // ═══════════════════════════════════════════════════════
        // ═══ LOCAL AUTH SYSTEM (localStorage-based, no server) ═══
        // ═══════════════════════════════════════════════════════
        let authToken = localStorage.getItem(STORAGE_KEY_TOKEN);
        let currentUser = null;
        const LOCAL_TOKEN_PREFIX = 'local-';

        // Restore user from localStorage on load
        (function restoreUser() {
            const savedUser = localStorage.getItem(STORAGE_KEY_USER);
            if (savedUser) {
                try { currentUser = JSON.parse(savedUser); } catch (e) {}
            }
        })();

        // Legacy shared asset templates (used only as fallback for old CSS symbols)
        const assetTemplates = {
            diamond: `<img class="reel-symbol-img" src="assets/ui/sym_diamond.png" alt="Diamond" draggable="false">`,
            cherry: `<img class="reel-symbol-img" src="assets/ui/sym_cherry.png" alt="Cherry" draggable="false">`,
            seven: `<img class="reel-symbol-img" src="assets/ui/sym_seven.png" alt="Seven" draggable="false">`,
            crown: `<img class="reel-symbol-img" src="assets/ui/sym_seven.png" alt="Crown" draggable="false">`,
            star: `<img class="reel-symbol-img" src="assets/ui/sym_star.png" alt="Star" draggable="false">`,
            bell: `<img class="reel-symbol-img" src="assets/ui/sym_bell.png" alt="Bell" draggable="false">`,
            coin: `<img class="reel-symbol-img" src="assets/ui/sym_diamond.png" alt="Coin" draggable="false">`,
            bar: `<img class="reel-symbol-img" src="assets/ui/sym_bar.png" alt="BAR" draggable="false">`,
            clover: `<img class="reel-symbol-img" src="assets/ui/sym_star.png" alt="Clover" draggable="false">`,
            watermelon: `<img class="reel-symbol-img" src="assets/ui/sym_watermelon.png" alt="Watermelon" draggable="false">`,
            lemon: `<img class="reel-symbol-img" src="assets/ui/sym_lemon.png" alt="Lemon" draggable="false">`
        };
        // DEFAULT_BALANCE, DEFAULT_STATS, SLOT_SYMBOLS, ACHIEVEMENTS — from constants.js

        let currentFilter = 'all';
        let currentProviderFilter = 'all';
        let balance = DEFAULT_BALANCE;
        let currentGame = null;
        let spinning = false;
        let currentBet = DEFAULT_BET;
        let currentReels = ['diamond', 'diamond', 'diamond'];
        // 2D grid: currentGrid[col][row] — outer array = columns (reels), inner = rows
        let currentGrid = null;
        let lastMessage = { type: 'info', text: '' };
        let stats = createDefaultStats();
        // soundEnabled state now managed by sound-manager.js (SoundManager.soundEnabled)
        let deterministicSeed = null;
        let deterministicRng = null;
        let forcedSpinQueue = [];
        let qaToolsOpen = false;

        // ═══ Free Spins / Bonus State ═══
        let freeSpinsActive = false;
        let freeSpinsRemaining = 0;
        let freeSpinsTotalCount = 0;        // Total free spins awarded (for "X of Y" display)
        let freeSpinsTotalWin = 0;
        let freeSpinsMultiplier = 1;
        let freeSpinsCascadeLevel = 0;
        let freeSpinsExpandedSymbol = null; // For Book of Dead expanding symbol
        let expandingWildRespinsLeft = 0;   // For Starburst expanding wild respin
        let respinCount = 0;                // For Hot Chillies respin feature
        // ── Shared Reel Animation Helpers ──────────────────────────
        const REEL_CELL_ANIMATION_CLASSES = [
            'reel-landing', 'reel-win-glow', 'reel-wild-glow',
            'reel-scatter-glow', 'reel-celebrating', 'reel-mega-win',
            'reel-wild-expand', 'reel-big-win-glow',
            'reel-near-miss', 'reel-win-entrance',
            'reel-3d-pop', 'reel-3d-recede'
        ];

        // ═══════════════════════════════════════════════════
        // GAMBLE FEATURE
        // ═══════════════════════════════════════════════════
        let gambleState = { active: false, amount: 0, round: 0, maxRound: 5 };

        // REEL_STRIP_BUFFER, REEL_SPIN_PX_PER_SEC, REEL_SPIN_PX_PER_SEC_TURBO,
        // REEL_DECEL_DURATION, REEL_BOUNCE_OVERSHOOT, REEL_BOUNCE_DURATION,
        // REEL_CELL_DIMS, SLOT_TEMPLATES — from constants.js

        // ═══ Reel Strip State ═══
        let reelStripData = []; // Per-column: { stripEl, animFrameId, currentY, cellH, totalH, visibleH }

        // ===== Recently Played =====
        const RECENTLY_PLAYED_KEY = STORAGE_KEY_RECENTLY_PLAYED;
        // MAX_RECENTLY_PLAYED — from constants.js

        // ===== Jackpot Ticker =====
        let jackpotValue = JACKPOT_TICKER_BASE_VALUE + Math.floor(Math.random() * JACKPOT_TICKER_RANDOM_RANGE);

        // ═══════════════════════════════════════════════════════
        // SETTINGS PANEL
        // ═══════════════════════════════════════════════════════
        const settingsDefaults = {
            soundEnabled: true,
            volume: 50,
            particles: true,
            animations: true,
            confetti: true,
            turboDefault: false,
            autoSpinSpeed: 1500,
            animationQuality: 'ultra',
            ambientMusic: false,
            winSounds: true,
            uiSounds: true,
            soundTheme: 'auto'
        };

        // ===== XP / Level System =====
        // XP_TIERS — from constants.js
        const XP_STORAGE_KEY = STORAGE_KEY_XP;

        let playerXP = 0;
        let playerLevel = 1;

        // ===== Daily Bonus System =====
        const DAILY_BONUS_KEY = STORAGE_KEY_DAILY_BONUS;
        // DAILY_REWARDS — from constants.js

        let dailyBonusState = { streak: 0, lastClaim: null, claimedToday: false };

        // ===== Win Streak =====
        window._winStreak = 0;

        // ===== Bonus Wheel =====
        // WHEEL_SEGMENTS — from constants.js
        const WHEEL_STORAGE_KEY = STORAGE_KEY_BONUS_WHEEL;
        let wheelSpinning = false;
        let wheelAngle = 0;
        let wheelState = { lastSpin: null };

        // ===== Win Ticker =====
        // TICKER_NAMES — from constants.js

        let tickerInterval = null;

        // ===== Slot Jackpot Banner Ticker =====
        let _slotJackpotTickInterval = null;
        let _winCounterRaf = null;  // win amount counter animation RAF handle
        let _bigWinCloseTimer = null; // big win overlay auto-dismiss timer

        // ===== Auto-Spin =====
        let autoSpinActive = false;
        let autoSpinCount = 0;
        let autoSpinMax = 0;

        // ═══ Turbo spin mode ═══
        let turboMode = false;

        // ═══ Idle spin invitation timer ═══
        let _idleInviteTimer = null;
        let _reelResizeHandler = null; // debounced resize listener for rescaleReelGridToFit
        let _lastWinLines = [];       // [{cells:[[col,row],...], color}] for SVG payline visualiser

        // ═══════════════════════════════════════════════════════════
        // ENHANCED AUTOPLAY MODAL
        // ═══════════════════════════════════════════════════════════

        const AUTOPLAY_WIN_LIMITS  = [0, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
        const AUTOPLAY_LOSS_LIMITS = [0, 50, 100, 200, 500, 1000, 2000, 5000];

        let autoplaySelectedCount  = 50;
        let autoplayWinLimitIdx    = 0;
        let autoplayLossLimitIdx   = 0;
        let autoplayWinLimitAmount = 0;
        let autoplayLossLimitAmount= 0;
        let autoplayStartBalance   = 0;

        // ═══════════════════════════════════════════════════════
        // Feature Popup info descriptions
        // ═══════════════════════════════════════════════════════
        const featureInfo = {
            tumble: { icon: '\u{1F48E}', title: 'Tumbling Reels', desc: 'Winning symbols cascade away for consecutive wins!' },
            avalanche: { icon: '\u{1FAA8}', title: 'Avalanche Reels', desc: 'Winning symbols shatter and new ones fall into place!' },
            random_multiplier: { icon: '\u2728', title: 'Random Multipliers', desc: 'Multiplier symbols appear randomly to boost your wins!' },
            zeus_multiplier: { icon: '\u26A1', title: 'Divine Multipliers', desc: 'God-like multipliers rain down for legendary payouts!' },
            money_collect: { icon: '\u{1F4B0}', title: 'Money Collect', desc: 'Wild symbol collects all coin values on the reels!' },
            respin: { icon: '\u{1F504}', title: 'Respin Feature', desc: 'Matching pairs lock and remaining reels respin!' },
            stacked_wilds: { icon: '\u{1F525}', title: 'Stacked Wilds', desc: 'Wild symbols stack to fill entire reels!' },
            hold_and_win: { icon: '\u{1F3AF}', title: 'Hold & Win', desc: 'Lock coins in place and respin for jackpot prizes!' },
            fisherman_collect: { icon: '\u{1F3A3}', title: 'Fisherman Collect', desc: 'Wild fisherman collects all cash fish values!' },
            wheel_multiplier: { icon: '\u{1F3A1}', title: 'Wheel of Fortune', desc: 'Trigger the bonus wheel for massive multipliers!' },
            expanding_symbol: { icon: '\u{1F4D6}', title: 'Expanding Symbol', desc: 'A chosen symbol expands to fill entire reels in free spins!' },
            expanding_wild_respin: { icon: '\u{1F31F}', title: 'Expanding Wilds', desc: 'Wild symbols expand across the entire reel and trigger respins!' },
            sticky_wilds: { icon: '\u{1F36F}', title: 'Sticky Wilds', desc: 'Wilds stick in place for multiple spins!' },
            progressive: { icon: '\u{1F3C6}', title: 'Progressive Jackpot', desc: 'Every spin feeds the growing jackpot prize pool!' },
            mystery_symbols: { icon: '\u2753', title: 'Mystery Symbols', desc: 'Mystery symbols reveal matching icons for big combos!' },
            cascading: { icon: '\u{1F30A}', title: 'Cascading Wins', desc: 'Wins cascade into more wins with increasing multipliers!' },
            nudge: { icon: '\u{1F446}', title: 'Nudge Feature', desc: 'Reels nudge into winning positions for extra chances!' },
            trail_bonus: { icon: '\u{1F5FA}\uFE0F', title: 'Trail Bonus', desc: 'Advance along the trail to collect bigger prizes!' },
            pick_bonus: { icon: '\u{1F381}', title: 'Pick Bonus', desc: 'Pick hidden prizes for instant rewards!' },
            super_meter: { icon: '\u{1F4CA}', title: 'Super Meter Mode', desc: 'Activate super mode for enhanced payouts!' },
            lightning_respin: { icon: '\u26A1', title: 'Lightning Respins', desc: 'Lightning strikes lock high-value symbols in place!' },
            mega_symbols: { icon: '\u{1F52E}', title: 'Mega Symbols', desc: 'Giant symbols cover multiple positions for colossal wins!' }
        };

        // ═══════════════════════════════════════════════════════
        // MOBILE TOUCH STATE
        // ═══════════════════════════════════════════════════════

        let touchStartX = 0;
        let touchStartY = 0;
        let touchEndX = 0;
        let touchEndY = 0;

        // ═══ Utility functions needed for variable initialization ═══

        function createDefaultStats() {
            return {
                totalSpins: DEFAULT_STATS.totalSpins,
                totalWagered: DEFAULT_STATS.totalWagered,
                totalWon: DEFAULT_STATS.totalWon,
                biggestWin: DEFAULT_STATS.biggestWin,
                gamesPlayed: {},
                gameStats: {},
                achievements: []
            };
        }

        function formatMoney(amount) {
            return Number(amount || 0).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });
        }

        function parseStoredNumber(value, fallback) {
            const parsed = Number.parseFloat(value);
            return Number.isFinite(parsed) ? parsed : fallback;
        }

        function hashSeed(seedValue) {
            const seedText = String(seedValue ?? '').trim();
            let hash = FNV_OFFSET_BASIS;
            for (let i = 0; i < seedText.length; i++) {
                hash ^= seedText.charCodeAt(i);
                hash = Math.imul(hash, FNV_PRIME);
            }
            return hash >>> 0;
        }

        function createSeededRandom(seedValue) {
            let state = hashSeed(seedValue) || DEFAULT_SEED_STATE;
            return () => {
                state = (state + SEED_STEP_INCREMENT) >>> 0;
                let t = state;
                t = Math.imul(t ^ (t >>> 15), t | 1);
                t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
                return ((t ^ (t >>> 14)) >>> 0) / UINT32_MAX_PLUS_ONE;
            };
        }

        function setDeterministicSeed(seedValue) {
            if (seedValue === null || seedValue === undefined || String(seedValue).trim() === '') {
                deterministicSeed = null;
                deterministicRng = null;
                return false;
            }

            deterministicSeed = String(seedValue);
            deterministicRng = createSeededRandom(deterministicSeed);
            return true;
        }

        function getRandomNumber() {
            return deterministicRng ? deterministicRng() : Math.random();
        }

        function normalizeSymbol(symbol) {
            const normalized = String(symbol ?? '').trim().toLowerCase();
            // Check game-specific symbols first
            const gameSyms = getGameSymbols(currentGame);
            if (gameSyms.includes(normalized)) return normalized;
            // Fallback to legacy global symbols
            if (SLOT_SYMBOLS.includes(normalized)) return normalized;
            return null;
        }

        function normalizeOutcomeSymbols(input) {
            const parts = Array.isArray(input)
                ? input
                : String(input ?? '')
                    .split(',')
                    .map((part) => part.trim())
                    .filter(Boolean);

            if (parts.length !== 3) return null;
            const normalized = parts.map(normalizeSymbol);
            return normalized.every(Boolean) ? normalized : null;
        }

        function pickDifferentSymbol(excludedSymbols) {
            const excludedSet = new Set((excludedSymbols || []).filter(Boolean));
            const syms = getGameSymbols(currentGame);
            const available = syms.filter((symbol) => !excludedSet.has(symbol));
            if (available.length === 0) return syms[0];
            return available[Math.floor(getRandomNumber() * available.length)];
        }

        function buildForcedOutcome(type, preferredSymbol) {
            const mode = String(type ?? '').trim().toLowerCase();
            const gameSyms = getGameSymbols(currentGame);
            const anchor = normalizeSymbol(preferredSymbol) || gameSyms[0] || getRandomSymbol();

            if (mode === 'triple' || mode === 'jackpot' || mode === 'win3') {
                return [anchor, anchor, anchor];
            }
            if (mode === 'double' || mode === 'win2') {
                return [anchor, anchor, pickDifferentSymbol([anchor])];
            }
            if (mode === 'lose' || mode === 'loss' || mode === 'miss') {
                const second = pickDifferentSymbol([anchor]);
                const third = pickDifferentSymbol([anchor, second]);
                return [anchor, second, third];
            }
            return null;
        }

        // Settings state (initialized after loadSettings is defined)
        let appSettings = null;

        // ===== Favorites =====
        const FAVORITES_KEY = 'casinoFavorites';

        function loadFavorites() {
            try { return JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'); } catch(e) { return []; }
        }
        function saveFavorites(arr) {
            localStorage.setItem(FAVORITES_KEY, JSON.stringify(arr));
        }
        function toggleFavorite(gameId) {
            let favs = loadFavorites();
            const idx = favs.indexOf(gameId);
            if (idx === -1) favs.push(gameId);
            else favs.splice(idx, 1);
            saveFavorites(favs);
            return idx === -1; // true = now favorited
        }
        function isFavorite(gameId) {
            return loadFavorites().includes(gameId);
        }

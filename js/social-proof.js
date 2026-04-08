/* Matrix Spins - Social Proof Win Notifications */
(function() {
    'use strict';

    function cryptoRandom() {
      return crypto.getRandomValues(new Uint32Array(1))[0] / 0xFFFFFFFF;
    }

    const WINNER_NAMES = ['Lucky_Star', 'GoldRush99', 'SpinMaster', 'JackpotJane', 'SlotKing', 'WinnerCircle',
        'MegaSpin', 'FortuneX', 'DiamondDave', 'WildCard77', 'BonusHunter', 'CashFlow', 'HighRoller',
        'SpinQueen', 'GoldenEagle', 'NeonNights', 'ThunderBolt', 'StarChaser', 'MysticWolf', 'PhoenixFire'];
    
    const GAMES = ['Gates of Olympus', 'Sweet Bonanza', 'Wolf Gold', 'Buffalo Stampede', 'Dragon Hoard',
        'Pharaohs Legacy', 'Viking Forge', 'Olympus Thunder', 'Cosmic Cash', 'Golden Genie'];
    
    function randomFrom(arr) { return arr[Math.floor(cryptoRandom() * arr.length)]; }
    function randomWin() { return (cryptoRandom() * 490 + 10).toFixed(2); }
    
    function showWinToast() {
        const name = randomFrom(WINNER_NAMES);
        const game = randomFrom(GAMES);
        const amount = randomWin();
        
        const toast = document.createElement('div');
        toast.className = 'social-proof-toast';
        var icon = document.createElement('span'); icon.className = 'sp-icon'; icon.textContent = '\u{1F3C6}';
        var strong = document.createElement('strong'); strong.textContent = name;
        var amt = document.createElement('span'); amt.className = 'sp-amount'; amt.textContent = '$' + amount;
        toast.appendChild(icon); toast.append(' '); toast.appendChild(strong);
        toast.append(' just won '); toast.appendChild(amt); toast.append(' on ' + game + '!');
        document.body.appendChild(toast);
        
        requestAnimationFrame(function() { toast.classList.add('sp-show'); });
        setTimeout(function() {
            toast.classList.remove('sp-show');
            setTimeout(function() { toast.remove(); }, 500);
        }, 5000);
    }
    
    // Show a notification every 30-90 seconds
    function scheduleNext() {
        var delay = 30000 + cryptoRandom() * 60000;
        setTimeout(function() { showWinToast(); scheduleNext(); }, delay);
    }
    
    // Start after 10 seconds
    setTimeout(function() { showWinToast(); scheduleNext(); }, 10000);

    // Populate wins ticker
    function populateTicker() {
      var track = document.getElementById('winsTickerTrack');
      if (!track) return;
      var items = [];
      for (var i = 0; i < 20; i++) {
        var name = WINNER_NAMES[Math.floor(cryptoRandom() * WINNER_NAMES.length)];
        var game = GAMES[Math.floor(cryptoRandom() * GAMES.length)];
        var amount = (cryptoRandom() * 4900 + 100).toFixed(2);
        items.push('<span class="win-item"><strong>$' + amount + '</strong><span>' + name + '</span><span class="win-game">on ' + game + '</span></span>');
      }
      // Duplicate for seamless loop
      var html = items.join('') + items.join('');
      track.innerHTML = html;
    }
    populateTicker();
})();
document.addEventListener('DOMContentLoaded', () => {
    // --- Global State ---
    const wallet = new Wallet();
    let blackjackGame;
    const slotsGame = new SlotMachineGame();
    const rouletteGame = new RouletteGame();
    let currentBlackjackBet = 0;

    // --- UI Elements ---
    const balanceEl = document.getElementById('balance');
    const lobbyView = document.getElementById('lobby-view');
    const blackjackView = document.getElementById('blackjack-view');
    const slotsView = document.getElementById('slots-view');
    const rouletteView = document.getElementById('roulette-view');
    const videoPokerView = document.getElementById('video-poker-view');
    const lobbyBtn = document.getElementById('lobby-btn');
    const playBtns = document.querySelectorAll('.play-btn');
    const modal = document.getElementById('message-modal');
    const modalMessage = document.getElementById('modal-message');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const resetBalanceBtn = document.getElementById('reset-balance-btn');

    // Blackjack UI
    const placeBetBtn = document.getElementById('place-bet-btn');
    const betAmountInput = document.getElementById('bet-amount');
    const hitBtn = document.getElementById('hit-btn');
    const standBtn = document.getElementById('stand-btn');
    const playerScoreEl = document.getElementById('player-score');
    const dealerScoreEl = document.getElementById('dealer-score');
    const playerHandEl = document.getElementById('player-hand');
    const dealerHandEl = document.getElementById('dealer-hand');
    const blackjackMessageEl = document.getElementById('blackjack-message');

    // Slots UI
    const spinBtn = document.getElementById('spin-btn');
    const slotsBetInput = document.getElementById('slots-bet');
    const reelEls = [document.getElementById('reel1'), document.getElementById('reel2'), document.getElementById('reel3')];
    const slotsMessageEl = document.getElementById('slots-message');

    // Roulette UI
    const rouletteTableView = document.getElementById('roulette-table');
    const spinRouletteBtn = document.getElementById('spin-roulette-btn');
    const clearBetsBtn = document.getElementById('clear-bets-btn');
    const rouletteBetInput = document.getElementById('roulette-bet');
    const rouletteMessageEl = document.getElementById('roulette-message');
    const wheelInner = document.getElementById('wheel-inner');
    const ball = document.getElementById('ball');
    const winningNumberDisplay = document.getElementById('winning-number-display');

    // --- Modal Logic ---
    function showMessage(message) {
        modalMessage.textContent = message;
        modal.style.display = 'flex';
    }
    closeModalBtn.addEventListener('click', () => {
        modal.style.display = 'none';
    });

    // --- Wallet Class ---
    class Wallet {
        constructor() {
            const savedBalance = localStorage.getItem('casinoBalance');
            this.balance = savedBalance ? parseFloat(savedBalance) : 1000;
            this.updateBalance(0);
        }
        updateBalance(amount) {
            this.balance += amount;
            balanceEl.textContent = this.balance.toFixed(2);
            localStorage.setItem('casinoBalance', this.balance);
        }
        placeBet(amount) {
            if (amount > this.balance) {
                showMessage("Insufficient balance!");
                return false;
            }
            this.updateBalance(-amount);
            return true;
        }
    }

    // --- Blackjack Class ---
    class BlackjackGame {
        constructor() { this.deck = []; this.playerHand = []; this.dealerHand = []; this.gameOver = false; }
        createDeck() {
            const suits = ['♥', '♦', '♣', '♠'];
            const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
            this.deck = suits.flatMap(suit => values.map(value => ({ suit, value })));
        }
        shuffleDeck() { for (let i = this.deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]]; } }
        getCardValue(card) { if (['J', 'Q', 'K'].includes(card.value)) return 10; if (card.value === 'A') return 11; return parseInt(card.value); }
        calculateHandValue(hand) {
            let score = hand.reduce((sum, card) => sum + this.getCardValue(card), 0);
            let numAces = hand.filter(card => card.value === 'A').length;
            while (score > 21 && numAces > 0) { score -= 10; numAces--; }
            return score;
        }
        dealInitialCards() { this.playerHand.push(this.deck.pop(), this.deck.pop()); this.dealerHand.push(this.deck.pop(), this.deck.pop()); }
        get playerScore() { return this.calculateHandValue(this.playerHand); }
        get dealerScore() { return this.calculateHandValue(this.dealerHand); }
        hit() { if (!this.gameOver) { this.playerHand.push(this.deck.pop()); if (this.playerScore > 21) this.gameOver = true; } }
        stand() { if (!this.gameOver) { while (this.dealerScore < 17) { this.dealerHand.push(this.deck.pop()); } this.gameOver = true; } }
        determineWinner() {
            if (this.playerScore > 21) return 'Dealer';
            if (this.dealerScore > 21) return 'Player';
            if (this.playerScore > this.dealerScore) return 'Player';
            if (this.dealerScore > this.playerScore) return 'Dealer';
            return 'Push';
        }
    }

    // --- Slots Class ---
    class SlotMachineGame {
        constructor() {
            this.reels = [['🍒','🍋','🍊','🔔','⭐','💎'], ['🍒','🍋','🍊','🔔','⭐','💎'], ['🍒','🍋','🍊','🔔','⭐','💎']];
            this.payouts = { '🍒🍒🍒': 10, '🍋🍋🍋': 20, '🍊🍊🍊': 30, '🔔🔔🔔': 50, '⭐⭐⭐': 75, '💎💎💎': 100 };
        }
        spin() { return this.reels.map(reel => reel[Math.floor(Math.random() * reel.length)]); }
        calculatePayout(result, bet) {
            const resultString = result.join('');
            const payoutMultiplier = this.payouts[resultString] || 0;
            if (payoutMultiplier === 0 && (result[0] === result[1] || result[1] === result[2])) return bet * 0.5;
            return bet * payoutMultiplier;
        }
    }

    // --- Roulette Class ---
    class RouletteGame {
        constructor() {
            this.wheelNumbers = [];
            const reds = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
            for (let i = 1; i <= 36; i++) this.wheelNumbers.push({ number: i, color: reds.includes(i) ? 'red' : 'black', isEven: i % 2 === 0 });
            this.wheelNumbers.push({ number: 0, color: 'green' });
            this.bets = {};
        }
        placeBet(type, value, amount) { const key = `${type}_${value}`; this.bets[key] = (this.bets[key] || 0) + amount; }
        spin() { return this.wheelNumbers[Math.floor(Math.random() * this.wheelNumbers.length)]; }
        calculatePayouts(winningNumber) {
            let totalPayout = 0;
            for (const betKey in this.bets) {
                const [type, value] = betKey.split('_');
                const amount = this.bets[betKey];
                let isWinner = false;
                let payoutMultiplier = 0;
                if (type === 'number' && parseInt(value) === winningNumber.number) { isWinner = true; payoutMultiplier = 35; }
                else if (type === 'color' && value === winningNumber.color) { isWinner = true; payoutMultiplier = 1; }
                else if (type === 'evenOdd' && winningNumber.number !== 0 && (value === 'even') === winningNumber.isEven) { isWinner = true; payoutMultiplier = 1; }
                if (isWinner) totalPayout += amount + (amount * payoutMultiplier);
            }
            return totalPayout;
        }
        clearBets() { this.bets = {}; }
    }

    // --- Video Poker Class ---
    class VideoPokerGame {
        constructor() {
            this.deck = [];
            this.hand = [];
            this.payouts = {
                'Royal Flush': 800,
                'Straight Flush': 50,
                'Four of a Kind': 25,
                'Full House': 9,
                'Flush': 6,
                'Straight': 4,
                'Three of a Kind': 3,
                'Two Pair': 2,
                'Jacks or Better': 1
            };
        }

        createDeck() {
            const suits = ['♥', '♦', '♣', '♠'];
            const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
            this.deck = suits.flatMap(suit => values.map(value => ({ suit, value })));
        }

        shuffleDeck() {
            for (let i = this.deck.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
            }
        }

        dealHand() {
            this.hand = [];
            for (let i = 0; i < 5; i++) {
                this.hand.push(this.deck.pop());
            }
        }

        drawCards(heldIndices) {
            for (let i = 0; i < 5; i++) {
                if (!heldIndices.includes(i)) {
                    this.hand[i] = this.deck.pop();
                }
            }
        }

        evaluateHand() {
            const values = this.hand.map(c => 'A23456789TJQK'.indexOf(c.value) + 1).sort((a, b) => a - b);
            const suits = this.hand.map(c => c.suit);
            const isFlush = new Set(suits).size === 1;
            const isStraight = values.every((v, i) => i === 0 || v === values[i - 1] + 1) || (values[0] === 1 && values[1] === 10 && values[2] === 11 && values[3] === 12 && values[4] === 13); // Ace-high straight

            const counts = values.reduce((acc, v) => (acc[v] = (acc[v] || 0) + 1, acc), {});
            const pairs = Object.values(counts).filter(c => c === 2).length;
            const threes = Object.values(counts).some(c => c === 3);
            const fours = Object.values(counts).some(c => c === 4);

            if (isStraight && isFlush && values[0] === 1 && values[4] === 13) return 'Royal Flush';
            if (isStraight && isFlush) return 'Straight Flush';
            if (fours) return 'Four of a Kind';
            if (threes && pairs === 1) return 'Full House';
            if (isFlush) return 'Flush';
            if (isStraight) return 'Straight';
            if (threes) return 'Three of a Kind';
            if (pairs === 2) return 'Two Pair';
            if (pairs === 1 && (values.some(v => v >= 11) || values[0] === 1)) return 'Jacks or Better';
            return 'Nothing';
        }
    }

    // --- UI Navigation ---
    const views = { lobby: lobbyView, blackjack: blackjackView, slots: slotsView, roulette: rouletteView, 'video-poker': videoPokerView };
    function showView(viewId) { Object.values(views).forEach(v => v.style.display = 'none'); if (views[viewId]) views[viewId].style.display = 'block'; }
    lobbyBtn.addEventListener('click', () => showView('lobby'));
    playBtns.forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.game)));

    // --- Video Poker Loop ---
    const pokerBetInput = document.getElementById('poker-bet-amount');
    const dealPokerBtn = document.getElementById('deal-poker-btn');
    const drawBtn = document.getElementById('draw-btn');
    const pokerHandEl = document.getElementById('poker-hand');
    const pokerMessageEl = document.getElementById('poker-message');
    const videoPokerGame = new VideoPokerGame();

    dealPokerBtn.addEventListener('click', () => {
        const bet = parseInt(pokerBetInput.value);
        if (isNaN(bet) || bet <= 0) { showMessage("Invalid bet."); return; }
        if (wallet.placeBet(bet)) {
            videoPokerGame.createDeck();
            videoPokerGame.shuffleDeck();
            videoPokerGame.dealHand();
            renderPokerHand();
            pokerMessageEl.textContent = 'Hold cards and press Draw.';
            dealPokerBtn.disabled = true;
            drawBtn.disabled = false;
        }
    });

    drawBtn.addEventListener('click', () => {
        const heldIndices = [];
        document.querySelectorAll('#poker-hand .card.held').forEach((cardEl, index) => {
            heldIndices.push(parseInt(cardEl.dataset.index));
        });
        videoPokerGame.drawCards(heldIndices);
        const handRank = videoPokerGame.evaluateHand();
        const payoutMultiplier = videoPokerGame.payouts[handRank] || 0;
        const winnings = parseInt(pokerBetInput.value) * payoutMultiplier;

        if (winnings > 0) {
            wallet.updateBalance(winnings);
            pokerMessageEl.textContent = `${handRank}! You win $${winnings}.`;
        } else {
            pokerMessageEl.textContent = 'No win. Try again.';
        }

        renderPokerHand(true); // Render final hand without hold interaction
        dealPokerBtn.disabled = false;
        drawBtn.disabled = true;
    });

    function renderPokerHand(final = false) {
        pokerHandEl.innerHTML = '';
        videoPokerGame.hand.forEach((card, index) => {
            const cardEl = document.createElement('div');
            cardEl.innerHTML = createCardElement(card);
            cardEl.dataset.index = index;
            if (!final) {
                cardEl.addEventListener('click', () => {
                    cardEl.classList.toggle('held');
                });
            }
            pokerHandEl.appendChild(cardEl.firstElementChild);
        });
    }


    // --- Blackjack Loop ---
    placeBetBtn.addEventListener('click', () => {
        const bet = parseInt(betAmountInput.value);
        if (isNaN(bet) || bet <= 0) { showMessage("Invalid bet."); return; }
        if (wallet.placeBet(bet)) { currentBlackjackBet = bet; startBlackjack(); }
    });
    function startBlackjack() {
        document.getElementById('betting-area').style.display = 'none';
        document.getElementById('blackjack-actions').style.display = 'block';
        blackjackGame = new BlackjackGame();
        blackjackGame.createDeck(); blackjackGame.shuffleDeck(); blackjackGame.dealInitialCards();
        renderBlackjack();
    }
    hitBtn.addEventListener('click', () => { if (blackjackGame && !blackjackGame.gameOver) { blackjackGame.hit(); renderBlackjack(); } });
    standBtn.addEventListener('click', () => { if (blackjackGame && !blackjackGame.gameOver) { blackjackGame.stand(); renderBlackjack(); } });
    function renderBlackjack() {
        playerScoreEl.textContent = blackjackGame.playerScore;
        dealerScoreEl.textContent = blackjackGame.gameOver ? blackjackGame.dealerScore : '?';
        playerHandEl.innerHTML = blackjackGame.playerHand.map(createCardElement).join('');
        dealerHandEl.innerHTML = blackjackGame.dealerHand.length > 0 ? createCardElement(blackjackGame.dealerHand[0]) : '';
        if (blackjackGame.gameOver) { dealerHandEl.innerHTML = blackjackGame.dealerHand.map(createCardElement).join(''); }
        else if (blackjackGame.dealerHand.length > 1) { dealerHandEl.innerHTML += `<div class="card hidden"></div>`; }
        hitBtn.disabled = blackjackGame.gameOver;
        standBtn.disabled = blackjackGame.gameOver;
        if (blackjackGame.gameOver) handleBlackjackEnd();
    }
    function handleBlackjackEnd() {
        const winner = blackjackGame.determineWinner();
        let payout = 0; let message = '';
        if (winner === 'Player') { payout = currentBlackjackBet * 2; message = `You win $${payout}!`; }
        else if (winner === 'Push') { payout = currentBlackjackBet; message = 'Push!'; }
        else { message = 'Dealer wins.'; }
        wallet.updateBalance(payout);
        blackjackMessageEl.textContent = message;
        document.getElementById('betting-area').style.display = 'block';
        document.getElementById('blackjack-actions').style.display = 'none';
    }
    function createCardElement(card) { const color = ['♥', '♦'].includes(card.suit) ? 'red' : ''; return `<div class="card ${color}">${card.value}<span class="suit">${card.suit}</span></div>`; }

    // --- Slots Loop ---
    spinBtn.addEventListener('click', () => {
        const bet = parseInt(slotsBetInput.value);
        if (isNaN(bet) || bet <= 0) { showMessage("Invalid bet."); return; }
        if (wallet.placeBet(bet)) {
            spinBtn.disabled = true;
            slotsMessageEl.textContent = 'Spinning...';
            reelEls.forEach(r => r.classList.add('spinning'));
            setTimeout(() => {
                reelEls.forEach(r => r.classList.remove('spinning'));
                const result = slotsGame.spin();
                reelEls.forEach((r, i) => r.textContent = result[i]);
                const payout = slotsGame.calculatePayout(result, bet);
                if (payout > 0) { wallet.updateBalance(payout); slotsMessageEl.textContent = `You won $${payout.toFixed(2)}!`; }
                else { slotsMessageEl.textContent = 'You lose.'; }
                spinBtn.disabled = false;
            }, 500);
        }
    });

    // --- Roulette Loop ---
    function createRouletteTable() {
        rouletteTableView.innerHTML = '';
        const zero = document.createElement('div');
        zero.className = 'bet-spot green zero';
        zero.textContent = '0';
        zero.dataset.type = 'number';
        zero.dataset.value = '0';
        rouletteTableView.appendChild(zero);

        const reds = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
        for (let i = 1; i <= 36; i++) {
            const spot = document.createElement('div');
            spot.className = 'bet-spot number ' + (reds.includes(i) ? 'red' : 'black');
            spot.textContent = i;
            spot.dataset.type = 'number';
            spot.dataset.value = i;
            rouletteTableView.appendChild(spot);
        }
    }
    rouletteTableView.addEventListener('click', (e) => {
        if (e.target.classList.contains('bet-spot')) {
            const betAmount = parseInt(rouletteBetInput.value);
            if (isNaN(betAmount) || betAmount <= 0) { showMessage("Invalid bet."); return; }
            if (wallet.placeBet(betAmount)) {
                rouletteGame.placeBet(e.target.dataset.type, e.target.dataset.value, betAmount);
                const chip = document.createElement('div');
                chip.className = 'chip';
                chip.textContent = betAmount;
                e.target.appendChild(chip);
            }
        }
    });
    spinRouletteBtn.addEventListener('click', () => {
        if (Object.keys(rouletteGame.bets).length === 0) { showMessage("Please place a bet."); return; }
        spinRouletteBtn.disabled = true; clearBetsBtn.disabled = true;
        rouletteMessageEl.textContent = 'Spinning...';
        const degrees = Math.floor(Math.random() * 360) + 360 * 5;
        wheelInner.style.transform = `rotate(${degrees}deg)`;
        ball.style.transform = `rotate(${degrees + 90}deg)`;
        setTimeout(() => {
            const winningNumber = rouletteGame.spin();
            const payout = rouletteGame.calculatePayouts(winningNumber);
            winningNumberDisplay.textContent = winningNumber.number;
            winningNumberDisplay.style.display = 'block';
            if (payout > 0) { wallet.updateBalance(payout); rouletteMessageEl.textContent = `Winner: ${winningNumber.number}! You won $${payout.toFixed(2)}!`; }
            else { rouletteMessageEl.textContent = `Winner: ${winningNumber.number}. You lose.`; }
            spinRouletteBtn.disabled = false; clearBetsBtn.disabled = false;
        }, 4000);
    });
    clearBetsBtn.addEventListener('click', () => {
        const totalBet = Object.values(rouletteGame.bets).reduce((s, a) => s + a, 0);
        wallet.updateBalance(totalBet);
        rouletteGame.clearBets();
        document.querySelectorAll('.chip').forEach(c => c.remove());
    });

    resetBalanceBtn.addEventListener('click', () => {
        wallet.balance = 1000;
        wallet.updateBalance(0);
        showMessage("Your balance has been reset to $1000.");
    });

    // --- Initialization ---
    balanceEl.textContent = wallet.balance.toFixed(2);
    createRouletteTable();
    showView('lobby');
});
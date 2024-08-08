import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Coins, Gift } from "lucide-react";
import { Link } from "react-router-dom";

const Index = () => {
  const [balance, setBalance] = useState(1000);
  const [bet, setBet] = useState(10);
  const [reels, setReels] = useState([['🍒', '🍋', '🍇'], ['🍒', '🍋', '🍇'], ['🍒', '🍋', '🍇']]);
  const [spinning, setSpinning] = useState(false);
  const [winAmount, setWinAmount] = useState(0);

  const symbols = ['🍒', '🍋', '🍇', '🍊', '🍉', '💎', '7️⃣'];

  const games = [
    { name: "Neon Nights", image: "https://source.unsplash.com/random/300x200?neon" },
    { name: "Treasure Hunt", image: "https://source.unsplash.com/random/300x200?treasure" },
    { name: "Space Odyssey", image: "https://source.unsplash.com/random/300x200?space" },
    { name: "Mystic Forest", image: "https://source.unsplash.com/random/300x200?forest" },
  ];

  const spinReels = () => {
    if (balance < bet) {
      alert("Insufficient balance!");
      return;
    }

    setSpinning(true);
    setBalance(prevBalance => prevBalance - bet);
    setWinAmount(0);

    const newReels = reels.map(() =>
      Array.from({ length: 3 }, () => symbols[Math.floor(Math.random() * symbols.length)])
    );

    setTimeout(() => {
      setReels(newReels);
      setSpinning(false);
      checkWin(newReels);
    }, 1000);
  };

  const checkWin = (newReels) => {
    let win = 0;
    // Check rows
    for (let i = 0; i < 3; i++) {
      if (newReels[0][i] === newReels[1][i] && newReels[1][i] === newReels[2][i]) {
        win += bet * getMultiplier(newReels[0][i]);
      }
    }
    // Check diagonals
    if (newReels[0][0] === newReels[1][1] && newReels[1][1] === newReels[2][2]) {
      win += bet * getMultiplier(newReels[0][0]);
    }
    if (newReels[0][2] === newReels[1][1] && newReels[1][1] === newReels[2][0]) {
      win += bet * getMultiplier(newReels[0][2]);
    }

    if (win > 0) {
      setBalance(prevBalance => prevBalance + win);
      setWinAmount(win);
    }
  };

  const getMultiplier = (symbol) => {
    switch (symbol) {
      case '💎': return 10;
      case '7️⃣': return 7;
      case '🍉': return 5;
      case '🍊': return 4;
      case '🍇': return 3;
      case '🍋': return 2;
      case '🍒': return 1;
      default: return 0;
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-5xl font-bold text-white mb-8 text-center">Welcome to Matrix Slots</h1>
      
      {/* Featured Promotion */}
      <Card className="mb-8 bg-gradient-to-r from-yellow-400 to-orange-500 text-black">
        <CardContent className="flex items-center justify-between p-6">
          <div>
            <h2 className="text-2xl font-bold mb-2">Welcome Bonus</h2>
            <p className="text-lg">Get 200% bonus up to $1000 on your first deposit!</p>
          </div>
          <Button className="bg-black text-white hover:bg-gray-800">
            <Gift className="mr-2 h-4 w-4" />
            Claim Now
          </Button>
        </CardContent>
      </Card>

      {/* Matrix Slots Game */}
      <Card className="mb-8 bg-black/50 text-white">
        <CardHeader>
          <CardTitle className="text-center text-2xl">Matrix Slots</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 mb-6">
            {reels.map((reel, i) => (
              <div key={i} className="bg-gray-800 p-4 rounded-lg">
                {reel.map((symbol, j) => (
                  <div key={j} className="text-4xl text-center mb-2">{symbol}</div>
                ))}
              </div>
            ))}
          </div>
          <div className="flex justify-between items-center mb-6">
            <div className="text-xl">Balance: ${balance}</div>
            <div className="text-xl">Bet: ${bet}</div>
          </div>
          <div className="flex justify-center space-x-4 mb-6">
            <Button onClick={() => setBet(Math.max(1, bet - 1))} variant="secondary">-</Button>
            <Button onClick={() => setBet(Math.min(100, bet + 1))} variant="secondary">+</Button>
          </div>
          <Button 
            onClick={spinReels} 
            disabled={spinning} 
            className="w-full bg-gradient-to-r from-green-400 to-blue-500 hover:from-green-500 hover:to-blue-600"
          >
            {spinning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Coins className="mr-2 h-4 w-4" />}
            {spinning ? 'Spinning...' : 'Spin'}
          </Button>
          {winAmount > 0 && (
            <div className="mt-4 text-center text-2xl text-yellow-400">You won ${winAmount}!</div>
          )}
        </CardContent>
      </Card>

      {/* Other Games */}
      <h2 className="text-3xl font-bold text-white mb-4">More Games</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {games.map((game, index) => (
          <Card key={index} className="bg-black/50 text-white overflow-hidden">
            <img src={game.image} alt={game.name} className="w-full h-40 object-cover" />
            <CardContent className="p-4">
              <h3 className="text-xl font-bold mb-2">{game.name}</h3>
              <Button className="w-full bg-green-500 hover:bg-green-600 text-black">
                Play Now
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default Index;

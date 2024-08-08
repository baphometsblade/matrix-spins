import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Coins } from "lucide-react";

const Index = () => {
  const [balance, setBalance] = useState(1000);
  const [bet, setBet] = useState(10);
  const [reels, setReels] = useState([['🍒', '🍋', '🍇'], ['🍒', '🍋', '🍇'], ['🍒', '🍋', '🍇']]);
  const [spinning, setSpinning] = useState(false);
  const [winAmount, setWinAmount] = useState(0);

  const symbols = ['🍒', '🍋', '🍇', '🍊', '🍉', '💎', '7️⃣'];

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

  useEffect(() => {
    const handleMessage = (event) => {
      if (event.data.action === "generateImage" && event.data.prompt) {
        generateImage(event.data.prompt);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const generateImage = (prompt) => {
    document.getElementById('spinner').classList.remove('hidden');
    document.getElementById('imageContainer').innerHTML = '';

    fetch("https://backend.buildpicoapps.com/aero/run/image-generation-api?pk=v1-Z0FBQUFBQm1zN3RVWDV1dk5hY3hkaV9JZ05fR3BlN1dvMzdsMDVvampPVHBfcGhPS1J0eGE5aEs0cFdCY3ptU2VqVW8ya3ZEdWMxZE9FZkVXVGR5ZTAxQ2pZM3liT2x2OFE9PQ==", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: prompt })
    })
    .then(response => response.json())
    .then(data => {
      if (data.status === 'success') {
        const imageUrl = data.imageUrl;
        fetch("https://backend.buildpicoapps.com/db/create?app_id=boy-every&table_name=image_urls", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ row: [imageUrl] })
        })
        .then(() => {
          const imgElement = document.createElement('img');
          imgElement.src = imageUrl;
          imgElement.className = 'w-full h-auto rounded-lg shadow-md';
          document.getElementById('imageContainer').appendChild(imgElement);
        });
      } else {
        console.error('Error generating image:', data);
        alert('Failed to generate image. Please try again.');
      }
    })
    .catch(error => {
      console.log('Error fetching images:', error);
      alert('Error fetching images. Please try again.');
    })
    .finally(() => {
      document.getElementById('spinner').classList.add('hidden');
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-r from-purple-900 to-indigo-900 flex flex-col items-center justify-center p-4">
      <h1 className="text-5xl font-bold text-white mb-8">Matrix Slots</h1>
      <Card className="w-full max-w-3xl bg-black/50 text-white">
        <CardHeader>
          <CardTitle className="text-center text-2xl">Spin to Win!</CardTitle>
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
      <div id="imageContainer" className="mt-8 w-full max-w-3xl"></div>
      <div id="spinner" className="hidden mt-4">
        <Loader2 className="h-8 w-8 animate-spin text-white" />
      </div>
    </div>
  );
};

export default Index;

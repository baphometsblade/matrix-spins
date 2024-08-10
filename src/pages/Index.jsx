import { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Gift, Volume2, VolumeX, Zap, Settings, DollarSign, Sparkles, CreditCard, HelpCircle, Trophy, Star, RefreshCw, Lock, Unlock } from "lucide-react";
import { generateImage, formatCurrency, saveImage, generateSlotAssets } from '@/lib/utils';
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/components/ui/use-toast";
import PayTable from '../components/PayTable';
import LeaderBoard from '../components/LeaderBoard';
import BonusWheel from '../components/BonusWheel';
import DepositDialog from '../components/DepositDialog';
import HelpDialog from '../components/HelpDialog';
import SideBet from '../components/SideBet';
import { useQuery } from '@tanstack/react-query';

const Index = () => {
  const { toast } = useToast();
  const [balance, setBalance] = useState(1000);
  const [bet, setBet] = useState(10);
  const [reels, setReels] = useState([['🔵', '🟢', '🔴'], ['🟣', '🟡', '💊'], ['🕶️', '🖥️', '🔓'], ['⏳', '🔵', '🟢'], ['🔴', '🟣', '🟡']]);
  const [spinning, setSpinning] = useState(false);
  const [winAmount, setWinAmount] = useState(0);
  const [jackpot, setJackpot] = useState(10000);
  const [jackpotTicker, setJackpotTicker] = useState(10000);
  const [sound, setSound] = useState(true);
  const [autoPlay, setAutoPlay] = useState(false);
  const [autoPlayCount, setAutoPlayCount] = useState(0);
  const [selectedGame, setSelectedGame] = useState('matrix');
  const [paylines, setPaylines] = useState(20);
  const [bonusProgress, setBonusProgress] = useState(0);
  const [turboMode, setTurboMode] = useState(false);
  const [animationSpeed, setAnimationSpeed] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [showBonusWheel, setShowBonusWheel] = useState(false);
  const [lastWin, setLastWin] = useState(null);
  const [multiplier, setMultiplier] = useState(1);
  const [freeSpins, setFreeSpins] = useState(0);
  const [loyaltyPoints, setLoyaltyPoints] = useState(0);
  const [progressiveJackpot, setProgressiveJackpot] = useState(100000);
  const [showMiniGame, setShowMiniGame] = useState(false);
  const [winningLines, setWinningLines] = useState([]);
  const [recentWins, setRecentWins] = useState([]);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const symbols = ['🔵', '🟢', '🔴', '🟣', '🟡', '💊', '🕶️', '🖥️', '🔓', '⏳'];

  const { data: serverJackpot } = useQuery({
    queryKey: ['jackpot'],
    queryFn: async () => {
      // Simulating an API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      return Math.floor(Math.random() * 1000000) + 100000;
    },
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  useEffect(() => {
    if (serverJackpot) {
      setJackpot(serverJackpot);
    }
  }, [serverJackpot]);
  const [games, setGames] = useState([
    { id: 'matrix', name: "Matrix Reloaded", image: null, assets: [] },
    { id: 'cyber', name: "Cybernetic Spin", image: null, assets: [] },
    { id: 'quantum', name: "Quantum Quandary", image: null, assets: [] },
    { id: 'neural', name: "Neural Network", image: null, assets: [] },
  ]);

  useEffect(() => {
    const generateAndSaveGameImages = async () => {
      const updatedGames = await Promise.all(games.map(async (game) => {
        const imagePrompt = `${game.name} slot machine game, digital art style, vibrant colors, detailed`;
        const imageUrl = await generateImage(imagePrompt);
        const savedImagePath = await saveImage(imageUrl, `${game.id}.png`);
        return {
          ...game,
          image: savedImagePath
        };
      }));
      setGames(updatedGames);
    };
    generateAndSaveGameImages();
  }, []);

  const loyaltyTiers = useMemo(() => [
    { name: 'Bronze', points: 0, color: 'text-amber-600' },
    { name: 'Silver', points: 1000, color: 'text-gray-400' },
    { name: 'Gold', points: 5000, color: 'text-yellow-400' },
    { name: 'Platinum', points: 10000, color: 'text-blue-400' },
    { name: 'Diamond', points: 25000, color: 'text-purple-400' },
  ], []);

  const currentTier = useMemo(() => {
    return loyaltyTiers.reduce((acc, tier) => 
      loyaltyPoints >= tier.points ? tier : acc
    , loyaltyTiers[0]);
  }, [loyaltyPoints, loyaltyTiers]);

  useEffect(() => {
    const generateGameAssetsAndImages = async () => {
      const updatedGames = await Promise.all(games.map(async (game) => {
        const prompt = `Hyper-realistic 3D render of a ${game.name} themed slot machine, neon lights, futuristic casino environment, highly detailed, cinematic lighting, 8k resolution`;
        const imageUrl = await generateImage(prompt);
        const assets = await generateSlotAssets(game.name);
        return {
          ...game,
          image: imageUrl,
          assets: assets
        };
      }));
      setGames(updatedGames);
    };
    generateGameAssetsAndImages();
  }, []);

  const spinReels = useCallback(() => {
    if (freeSpins > 0) {
      setFreeSpins(prevFreeSpins => prevFreeSpins - 1);
    } else if (balance < bet) {
      toast({
        title: "Insufficient Balance",
        description: "Please deposit more funds to continue playing.",
        variant: "destructive",
      });
      return;
    } else {
      setBalance(prevBalance => prevBalance - bet);
      setProgressiveJackpot(prevJackpot => prevJackpot + bet * 0.01);
    }

    setSpinning(true);
    setWinAmount(0);
    setLastWin(null);
    setWinningLines([]);

    // Matrix-style reel animation
    const animateReels = (currentFrame) => {
      if (currentFrame < 20) { // 20 frames of animation
        const animatedReels = reels.map(() =>
          Array.from({ length: 3 }, () => {
            const randomAsset = games.find(g => g.id === selectedGame).assets[Math.floor(Math.random() * games.find(g => g.id === selectedGame).assets.length)];
            return randomAsset.image;
          })
        );
        setReels(animatedReels);
        setTimeout(() => animateReels(currentFrame + 1), 50);
      } else {
        // Final reel state
        const newReels = reels.map(() =>
          Array.from({ length: 3 }, () => {
            const randomAsset = games.find(g => g.id === selectedGame).assets[Math.floor(Math.random() * games.find(g => g.id === selectedGame).assets.length)];
            return randomAsset.image;
          })
        );
        setReels(newReels);
        setSpinning(false);
        const { win, lines } = checkWin(newReels);
        if (win > 0) {
          const totalWin = win * multiplier;
          setBalance(prevBalance => prevBalance + totalWin);
          setWinAmount(totalWin);
          setLastWin({ amount: totalWin, multiplier });
          setWinningLines(lines);
          setRecentWins(prevWins => [{ amount: totalWin, timestamp: Date.now() }, ...prevWins.slice(0, 4)]);
        
          // Matrix-style win animation
          animateWin(lines);
        }
        updateBonusProgress();
        updateLoyaltyPoints(bet);
      }
    };

    const spinDuration = turboMode ? 500 : 1000 / animationSpeed;
    setTimeout(() => animateReels(0), spinDuration);
  }, [balance, bet, freeSpins, multiplier, progressiveJackpot, reels, symbols, turboMode, animationSpeed, toast]);

  const animateWin = (lines) => {
    // Implement a Matrix-style "digital rain" animation over winning lines
    // This is a placeholder for the actual animation logic
    console.log("Animating win for lines:", lines);
  };

  const updateLoyaltyPoints = (betAmount) => {
    setLoyaltyPoints(prevPoints => prevPoints + Math.floor(betAmount * 0.1));
  };

  const checkForFreeSpins = (newReels) => {
    const scatterCount = newReels.flat().filter(symbol => symbol === '🃏').length;
    if (scatterCount >= 3) {
      const newFreeSpins = scatterCount * 5;
      setFreeSpins(prevFreeSpins => prevFreeSpins + newFreeSpins);
      setLastWin(prevWin => ({
        ...prevWin,
        freeSpins: newFreeSpins
      }));
    }
  };

  const checkWin = (newReels) => {
    let win = 0;
    let winningLines = [];

    // Matrix-style paylines
    const paylines = [
      [[0,0], [1,0], [2,0], [3,0], [4,0]], // Horizontal top
      [[0,1], [1,1], [2,1], [3,1], [4,1]], // Horizontal middle
      [[0,2], [1,2], [2,2], [3,2], [4,2]], // Horizontal bottom
      [[0,0], [1,1], [2,2], [3,1], [4,0]], // V-shape
      [[0,2], [1,1], [2,0], [3,1], [4,2]], // Inverted V-shape
      [[0,0], [1,0], [2,1], [3,2], [4,2]], // Zigzag top-left to bottom-right
      [[0,2], [1,2], [2,1], [3,0], [4,0]], // Zigzag bottom-left to top-right
      [[0,1], [1,0], [2,1], [3,2], [4,1]], // W-shape
      [[0,1], [1,2], [2,1], [3,0], [4,1]]  // M-shape
    ];

    paylines.forEach((line, index) => {
      const symbols = line.map(([x, y]) => newReels[x][y]);
      const uniqueSymbols = new Set(symbols);
    
      if (uniqueSymbols.size === 1) {
        const symbol = symbols[0];
        win += bet * getMultiplier(symbol) * 5;
        winningLines.push({ type: 'payline', index });
      } else if (uniqueSymbols.size === 2 && symbols.filter(s => s === '💊').length >= 3) {
        // Special case: At least 3 '💊' (red pill) symbols trigger a win
        win += bet * getMultiplier('💊') * 3;
        winningLines.push({ type: 'payline', index });
      }
    });

    if (win > 0) {
      setBalance(prevBalance => prevBalance + win);
      setWinAmount(win);
      if (win >= bet * 50) {
        triggerJackpot();
      }
    }

    // Check for scatter symbols (🕶️) to trigger free spins
    const scatterCount = newReels.flat().filter(symbol => symbol === '🕶️').length;
    if (scatterCount >= 3) {
      triggerFreeSpins(scatterCount);
    }

    return { win, lines: winningLines };
  };

  const triggerFreeSpins = (scatterCount) => {
    const freeSpinsAwarded = scatterCount * 5;
    setFreeSpins(prevFreeSpins => prevFreeSpins + freeSpinsAwarded);
    toast({
      title: "Free Spins Triggered!",
      description: `You've won ${freeSpinsAwarded} free spins!`,
      variant: "success",
    });
  };

  const getMultiplier = (symbol) => {
    switch (symbol) {
      case '⏳': return 100; // Time manipulation symbol
      case '🖥️': return 50; // Computer terminal symbol
      case '🕶️': return 25; // Sunglasses symbol (Neo's iconic accessory)
      case '💊': return 15; // Red pill symbol
      case '🔓': return 10; // Unlocked symbol (breaking free from the Matrix)
      case '🟣': return 5;  // Purple orb
      case '🔴': return 4;  // Red orb
      case '🟢': return 3;  // Green orb
      case '🔵': return 2;  // Blue orb
      case '🟡': return 1;  // Yellow orb
      default: return 0;
    }
  };

  const triggerJackpot = () => {
    setBalance(prevBalance => prevBalance + jackpot);
    setWinAmount(prevWin => prevWin + jackpot);
    setJackpot(10000); // Reset jackpot
  
    // Matrix-style jackpot animation
    toast({
      title: "JACKPOT!",
      description: `You've won the jackpot of ${formatCurrency(jackpot)}!`,
      variant: "success",
      duration: 5000,
    });

    // Trigger a full-screen Matrix-style "digital rain" animation
    const jackpotAnimation = document.createElement('div');
    jackpotAnimation.className = 'fixed inset-0 bg-black z-50 flex items-center justify-center';
    jackpotAnimation.innerHTML = `
      <div class="text-green-500 text-6xl font-bold animate-pulse">
        JACKPOT: ${formatCurrency(jackpot)}
      </div>
    `;
    document.body.appendChild(jackpotAnimation);

    // Remove the animation after 5 seconds
    setTimeout(() => {
      document.body.removeChild(jackpotAnimation);
    }, 5000);
  };

  const updateBonusProgress = () => {
    setBonusProgress(prev => {
      const newProgress = prev + 5;
      if (newProgress >= 100) {
        triggerBonusGame();
        return 0;
      }
      return newProgress;
    });
  };

  const triggerBonusGame = useCallback(() => {
    setShowBonusWheel(true);
  }, []);

  useEffect(() => {
    if (bonusProgress >= 100) {
      triggerBonusGame();
      setBonusProgress(0);
    }
  }, [bonusProgress, triggerBonusGame]);

  const handleBonusWheelResult = (result) => {
    setBalance(prevBalance => prevBalance + result);
    setShowBonusWheel(false);
    setLastWin({ amount: result, multiplier: 1, type: 'bonus' });
  };

  const toggleAutoPlay = () => {
    setAutoPlay(!autoPlay);
    if (!autoPlay) {
      setAutoPlayCount(10); // Start with 10 auto spins
      runAutoPlay();
    }
  };

  const runAutoPlay = () => {
    if (autoPlayCount > 0 && balance >= bet) {
      spinReels();
      setAutoPlayCount(prev => prev - 1);
      setTimeout(runAutoPlay, 2000);
    } else {
      setAutoPlay(false);
    }
  };

  useEffect(() => {
    const jackpotInterval = setInterval(() => {
      setJackpot(prevJackpot => prevJackpot + Math.floor(Math.random() * 10) + 1);
    }, 1000);

    const tickerInterval = setInterval(() => {
      setJackpotTicker(prevTicker => {
        const diff = jackpot - prevTicker;
        return prevTicker + Math.ceil(diff / 10);
      });
    }, 100);

    return () => {
      clearInterval(jackpotInterval);
      clearInterval(tickerInterval);
    };
  }, [jackpot]);

  const [backgroundImage, setBackgroundImage] = useState(null);

  useEffect(() => {
    const generateBackgroundImage = async () => {
      const imagePrompt = "Futuristic casino background with matrix-style digital rain, neon lights, and slot machines, photorealistic style";
      const imageUrl = await generateImage(imagePrompt, 1920, 1080);
      setBackgroundImage(imageUrl);
    };
    generateBackgroundImage();
  }, []);

  return (
    <div className="container mx-auto px-4 py-8" style={{backgroundImage: `url("${backgroundImage}")`, backgroundSize: 'cover', backgroundAttachment: 'fixed'}}>
      <AnimatePresence>
        {lastWin && (
          <motion.div
            initial={{ opacity: 0, y: -50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -50 }}
            transition={{ duration: 0.5 }}
          >
            <Alert className="mb-4 bg-green-500 text-white">
              <Sparkles className="h-4 w-4" />
              <AlertTitle>Big Win!</AlertTitle>
              <AlertDescription>
                You won {formatCurrency(lastWin.amount)} {lastWin.multiplier > 1 && `with a ${lastWin.multiplier}x multiplier`}
                {lastWin.type === 'bonus' && ' in the Bonus Game'}
                {lastWin.freeSpins && ` and ${lastWin.freeSpins} Free Spins!`}
              </AlertDescription>
            </Alert>
          </motion.div>
        )}
      </AnimatePresence>
      <img src="/logo.png" alt="Matrix Slots Extravaganza" className="mx-auto mb-8 w-64 object-cover" />
      
      {/* Loyalty Program Display */}
      <Card className="mb-8 bg-gradient-to-r from-green-600 to-blue-600 text-white overflow-hidden relative">
        <div className="absolute inset-0 opacity-20">
          {/* Matrix-style digital rain background */}
          <div className="matrix-rain"></div>
        </div>
        <CardContent className="flex items-center justify-between p-6 relative z-10">
          <div>
            <h2 className="text-2xl font-bold mb-2">Neural Network Rewards</h2>
            <p className="text-lg">
              Current Node: <span className={`font-bold ${currentTier.color}`}>{currentTier.name}</span>
            </p>
            <p>Data Points: {loyaltyPoints}</p>
          </div>
          <div className="text-right">
            <p className="text-sm mb-1">Next Node: {loyaltyTiers[loyaltyTiers.indexOf(currentTier) + 1]?.name || 'Singularity Achieved'}</p>
            <Progress value={(loyaltyPoints / (loyaltyTiers[loyaltyTiers.indexOf(currentTier) + 1]?.points || loyaltyPoints)) * 100} className="w-32" />
          </div>
          <div className="h-16 w-16 bg-blue-500 rounded-full flex items-center justify-center">
            <Zap className="h-10 w-10 text-white" />
          </div>
        </CardContent>
      </Card>
      
      {/* Featured Promotion */}
      <Card className="mb-8 bg-gradient-to-r from-purple-600 to-indigo-600 text-white">
        <CardContent className="flex items-center justify-between p-6">
          <div>
            <h2 className="text-3xl font-bold mb-2">Mega Welcome Package</h2>
            <p className="text-xl">Get 300% bonus up to $3000 + 100 Free Spins on your first 3 deposits!</p>
          </div>
          <Button className="bg-yellow-400 text-black hover:bg-yellow-500">
            <Gift className="mr-2 h-5 w-5" />
            Claim Now
          </Button>
        </CardContent>
      </Card>

      {/* User Actions */}
      <div className="flex justify-end space-x-4 mb-4">
        <DepositDialog onDeposit={(amount) => setBalance(prevBalance => prevBalance + amount)} />
        <HelpDialog />
      </div>

      {/* Game Selection Tabs */}
      <Tabs defaultValue={selectedGame} onValueChange={setSelectedGame} className="mb-8">
        <TabsList className="grid w-full grid-cols-4 bg-black/50">
          {games.map(game => (
            <TabsTrigger key={game.id} value={game.id} className="text-white data-[state=active]:bg-purple-600">
              {game.name}
            </TabsTrigger>
          ))}
        </TabsList>
        {games.map(game => (
          <TabsContent key={game.id} value={game.id}>
            <Card className="bg-black/50 text-white">
              <CardHeader>
                <CardTitle className="text-center text-3xl">{game.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-5 gap-2 mb-6">
                  {reels.map((reel, i) => (
                    <div key={i} className="bg-gray-800 p-2 rounded-lg">
                      {reel.map((symbolImage, j) => (
                        <div key={j} className="text-center mb-2">
                          <img src={symbolImage} alt="Slot Symbol" className="w-full h-auto" />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="flex justify-between items-center mb-6">
                  <div className="text-xl">Balance: {formatCurrency(balance)}</div>
                  <div className="text-xl">Bet: {formatCurrency(bet)}</div>
                  <div className="text-xl">Paylines: {paylines}</div>
                  {freeSpins > 0 && (
                    <div className="text-xl text-yellow-400">Free Spins: {freeSpins}</div>
                  )}
                </div>
                <div className="flex justify-center space-x-4 mb-6">
                  <Button onClick={() => setBet(Math.max(1, bet - 1))} variant="secondary">-</Button>
                  <Button onClick={() => setBet(Math.min(100, bet + 1))} variant="secondary">+</Button>
                  <Button onClick={() => setPaylines(Math.max(1, paylines - 1))} variant="secondary">-</Button>
                  <Button onClick={() => setPaylines(Math.min(25, paylines + 1))} variant="secondary">+</Button>
                </div>
                <div className="flex justify-center mb-6">
                  <Button
                    onClick={() => setIsLoggedIn(!isLoggedIn)}
                    className={`w-1/4 ${isLoggedIn ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'}`}
                  >
                    {isLoggedIn ? <Lock className="mr-2 h-5 w-5" /> : <Unlock className="mr-2 h-5 w-5" />}
                    {isLoggedIn ? 'Logout' : 'Login'}
                  </Button>
                </div>
                <div className="flex justify-between mb-6">
                  <Button 
                    onClick={spinReels} 
                    disabled={spinning || autoPlay} 
                    className="w-1/4 bg-gradient-to-r from-green-400 to-blue-500 hover:from-green-500 hover:to-blue-600"
                  >
                    {spinning ? (
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    ) : (
                      <Zap className="mr-2 h-5 w-5" />
                    )}
                    {spinning ? 'Spinning...' : 'Spin'}
                  </Button>
                  <Button 
                    onClick={toggleAutoPlay}
                    className={`w-1/5 ${autoPlay ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-500 hover:bg-blue-600'}`}
                  >
                    <RefreshCw className="mr-2 h-5 w-5" />
                    {autoPlay ? `Stop (${autoPlayCount})` : 'Auto Play'}
                  </Button>
                  <Button
                    onClick={() => setMultiplier(prevMultiplier => prevMultiplier < 5 ? prevMultiplier + 1 : 1)}
                    className="w-1/5 bg-purple-500 hover:bg-purple-600"
                  >
                    <DollarSign className="mr-2 h-5 w-5" />
                    {`Multiplier: ${multiplier}x`}
                  </Button>
                  <PayTable />
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button onClick={() => setSound(!sound)} variant="outline" className="w-12">
                          {sound ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{sound ? 'Mute' : 'Unmute'} game sounds</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <Dialog open={showSettings} onOpenChange={setShowSettings}>
                    <DialogTrigger asChild>
                      <Button variant="outline" className="w-12">
                        <Settings className="h-5 w-5" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="bg-gray-900 text-white">
                      <DialogHeader>
                        <DialogTitle>Game Settings</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="turbo-mode">Turbo Mode</Label>
                          <Switch
                            id="turbo-mode"
                            checked={turboMode}
                            onCheckedChange={setTurboMode}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="animation-speed">Animation Speed</Label>
                          <Slider
                            id="animation-speed"
                            min={0.5}
                            max={2}
                            step={0.1}
                            value={[animationSpeed]}
                            onValueChange={([value]) => setAnimationSpeed(value)}
                          />
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
                <div className="mt-4">
                  <h3 className="text-xl mb-2">Recent Wins</h3>
                  <div className="flex justify-between">
                    {recentWins.map((win, index) => (
                      <div key={index} className="text-center">
                        <p className="text-lg font-bold text-yellow-400">{formatCurrency(win.amount)}</p>
                        <p className="text-sm">{new Date(win.timestamp).toLocaleTimeString()}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <BonusWheel
                  isOpen={showBonusWheel}
                  onClose={() => setShowBonusWheel(false)}
                  onResult={handleBonusWheelResult}
                />
                {bonusProgress >= 80 && (
                  <div className="mt-4 text-center">
                    <Button
                      onClick={triggerBonusGame}
                      className="bg-yellow-400 text-black hover:bg-yellow-500 animate-pulse"
                    >
                      <Gift className="mr-2 h-5 w-5" />
                      Claim Bonus Spin!
                    </Button>
                  </div>
                )}
                {winAmount > 0 && (
                  <div className="mt-4 text-center">
                    <div className="text-3xl text-yellow-400 animate-bounce">
                      You won ${winAmount}!
                    </div>
                    <div className="mt-2">
                      <Sparkles className="inline-block mr-2 h-6 w-6 text-yellow-400" />
                      <span className="text-xl text-green-400">
                        {winAmount >= bet * 10 ? 'Big Win!' : winAmount >= bet * 5 ? 'Great Win!' : 'Nice Win!'}
                      </span>
                      <Sparkles className="inline-block ml-2 h-6 w-6 text-yellow-400" />
                    </div>
                  </div>
                )}
                <div className="mt-6">
                  <h3 className="text-xl mb-2">Bonus Progress</h3>
                  <Progress value={bonusProgress} className="w-full" />
                </div>
                <div className="mt-6 text-center">
                  <h3 className="text-2xl mb-2">Jackpot</h3>
                  <div className="text-4xl text-yellow-400 animate-pulse">
                    {formatCurrency(jackpotTicker)}
                  </div>
                </div>
                <div className="mt-6 text-center">
                  <h3 className="text-2xl mb-2">Progressive Jackpot</h3>
                  <div className="text-4xl text-green-400 animate-pulse">
                    {formatCurrency(progressiveJackpot)}
                  </div>
                </div>
                <div className="mt-6">
                  <h3 className="text-xl mb-2">Winning Lines</h3>
                  <div className="grid grid-cols-5 gap-2">
                    {winningLines.map((line, index) => (
                      <div key={index} className="bg-green-500 h-1"></div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      {/* Side Bet */}
      <div className="mb-8">
        <SideBet onWin={(amount) => setBalance(prevBalance => prevBalance + amount)} />
      </div>

      {/* Mini-Game */}
      {showMiniGame && (
        <Card className="mb-8 bg-gradient-to-r from-pink-500 to-purple-500 text-white">
          <CardContent className="p-6">
            <h3 className="text-2xl font-bold mb-4">Mini-Game: Double or Nothing</h3>
            <p className="mb-4">Choose Heads or Tails to double your last win!</p>
            <div className="flex justify-center space-x-4">
              <Button onClick={() => handleMiniGame('heads')} className="bg-yellow-400 text-black hover:bg-yellow-500">
                Heads
              </Button>
              <Button onClick={() => handleMiniGame('tails')} className="bg-yellow-400 text-black hover:bg-yellow-500">
                Tails
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Leaderboard */}
      <LeaderBoard />

      {/* Other Games */}
      <h2 className="text-3xl font-bold text-white mb-4">More Exciting Games</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {games.map((game, index) => (
          <Card key={index} className="bg-black/50 text-white overflow-hidden hover:shadow-lg transition-shadow duration-300">
            <div className="relative">
              {game.image ? (
                <img src={game.image.src} alt={game.name} className="w-full h-40 object-cover" />
              ) : (
                <div className="w-full h-40 bg-gray-700 flex items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-white" />
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent flex items-end p-4">
                <h3 className="text-xl font-bold text-white">{game.name}</h3>
              </div>
            </div>
            <CardContent className="p-4">
              <Button className="w-full bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white">
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

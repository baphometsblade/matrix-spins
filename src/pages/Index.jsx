import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Gift, Volume2, VolumeX, Zap, Settings, DollarSign, Sparkles, CreditCard, HelpCircle, Trophy, Star, RefreshCw, Lock, Unlock, CoinIcon, Calendar, Maximize2, Minimize2 } from "lucide-react";
import { formatCurrency, slotAssets, gameBackgrounds, safeGenerateImage } from '@/lib/utils';
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import DailyBonus from '../components/DailyBonus';
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
import { Badge } from "@/components/ui/badge";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";

const Index = () => {
  useEffect(() => {
    const generateImages = async () => {
      const symbolPrompts = [
        "Matrix-style slot machine symbol: Blue Orb",
        "Matrix-style slot machine symbol: Green Orb",
        "Matrix-style slot machine symbol: Red Orb",
        "Matrix-style slot machine symbol: Purple Orb",
        "Matrix-style slot machine symbol: Yellow Orb",
        "Matrix-style slot machine symbol: Red Pill",
        "Matrix-style slot machine symbol: Sunglasses",
        "Matrix-style slot machine symbol: Computer",
        "Matrix-style slot machine symbol: Unlock",
        "Matrix-style slot machine symbol: Hourglass"
      ];

      const backgroundPrompts = [
        "Matrix Reloaded game background",
        "Cybernetic Spin game background",
        "Quantum Quandary game background",
        "Neural Network game background"
      ];

      const symbolImages = await Promise.all(
        symbolPrompts.map((prompt, index) => 
          safeGenerateImage(prompt, 128, 128, `slot-${prompt.split(': ')[1].toLowerCase().replace(' ', '-')}.png`)
        )
      );

      const backgroundImages = await Promise.all(
        backgroundPrompts.map((prompt, index) => 
          safeGenerateImage(prompt, 1920, 1080, `${prompt.toLowerCase().replace(' ', '-')}-background.png`)
        )
      );

      setSymbols(symbolImages);
      setBackgrounds(backgroundImages);
    };

    generateImages();
  }, []);
  const { toast } = useToast();
  const [balance, setBalance] = useState(1000);
  const [bet, setBet] = useState(10);
  const [reels, setReels] = useState([
    ['/assets/matrix-blue-orb.png', '/assets/matrix-green-orb.png', '/assets/matrix-red-orb.png'],
    ['/assets/matrix-purple-orb.png', '/assets/matrix-yellow-orb.png', '/assets/matrix-pill.png'],
    ['/assets/matrix-sunglasses.png', '/assets/matrix-computer.png', '/assets/matrix-unlock.png'],
    ['/assets/matrix-hourglass.png', '/assets/matrix-blue-orb.png', '/assets/matrix-green-orb.png'],
    ['/assets/matrix-red-orb.png', '/assets/matrix-purple-orb.png', '/assets/matrix-yellow-orb.png']
  ]);
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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showStats, setShowStats] = useState(false);

  const symbols = [
    '/assets/matrix-blue-orb.png',
    '/assets/matrix-green-orb.png',
    '/assets/matrix-red-orb.png',
    '/assets/matrix-purple-orb.png',
    '/assets/matrix-yellow-orb.png',
    '/assets/matrix-pill.png',
    '/assets/matrix-sunglasses.png',
    '/assets/matrix-computer.png',
    '/assets/matrix-unlock.png',
    '/assets/matrix-hourglass.png'
  ];

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
        setIsFullscreen(false);
      }
    }
  };

  const playerStats = {
    totalSpins: 1000,
    totalWins: 500,
    biggestWin: 1000,
    currentStreak: 3,
    longestStreak: 7,
  };

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
    { id: 'matrix', name: "Matrix Reloaded", image: '/assets/matrix-reloaded-background.png', assets: slotAssets.matrix },
    { id: 'cyber', name: "Cybernetic Spin", image: '/assets/cybernetic-spin-background.png', assets: slotAssets.matrix },
    { id: 'quantum', name: "Quantum Quandary", image: '/assets/quantum-quandary-background.png', assets: slotAssets.matrix },
    { id: 'neural', name: "Neural Network", image: '/assets/neural-network-background.png', assets: slotAssets.matrix },
  ]);

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
          Array.from({ length: 3 }, () => symbols[Math.floor(Math.random() * symbols.length)])
        );
        setReels(animatedReels);
        setTimeout(() => animateReels(currentFrame + 1), 50);
      } else {
        // Final reel state
        const newReels = reels.map(() =>
          Array.from({ length: 3 }, () => symbols[Math.floor(Math.random() * symbols.length)])
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
      case '/assets/matrix-hourglass.png': return 100; // Time manipulation symbol
      case '/assets/matrix-computer.png': return 50; // Computer terminal symbol
      case '/assets/matrix-sunglasses.png': return 25; // Sunglasses symbol (Neo's iconic accessory)
      case '/assets/matrix-pill.png': return 15; // Red pill symbol
      case '/assets/matrix-unlock.png': return 10; // Unlocked symbol (breaking free from the Matrix)
      case '/assets/matrix-purple-orb.png': return 5;  // Purple orb
      case '/assets/matrix-red-orb.png': return 4;  // Red orb
      case '/assets/matrix-green-orb.png': return 3;  // Green orb
      case '/assets/matrix-blue-orb.png': return 2;  // Blue orb
      case '/assets/matrix-yellow-orb.png': return 1;  // Yellow orb
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

  const [backgroundImage, setBackgroundImage] = useState('/assets/matrix-background.png');
  const [specialEvent, setSpecialEvent] = useState(null);

  useEffect(() => {
    // Check for special events
    const currentDate = new Date();
    if (currentDate.getMonth() === 11 && currentDate.getDate() === 25) {
      setSpecialEvent({
        name: "Christmas Spins",
        description: "Get 50 free spins on Christmas Day!",
        icon: <Gift className="h-6 w-6 text-red-500" />
      });
    }
  }, []);

  return (
    <div className="container mx-auto px-4 py-8 relative">
      <div 
        className="absolute inset-0 z-0" 
        style={{
          backgroundImage: `url(${backgroundImage})`,
          backgroundSize: 'cover',
          backgroundAttachment: 'fixed',
          filter: 'blur(5px)',
          opacity: 0.3
        }}
      ></div>
      <div className="relative z-10">
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

      {/* Loyalty Benefits */}
      <Card className="mb-8 bg-black/50 text-white">
        <CardHeader>
          <CardTitle className="flex items-center">
            <Trophy className="mr-2 h-6 w-6 text-yellow-400" />
            Loyalty Benefits
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {loyaltyTiers.map((tier, index) => (
              <div key={index} className={`p-4 rounded-lg ${currentTier.name === tier.name ? 'bg-gradient-to-r from-green-500 to-blue-500' : 'bg-gray-800'}`}>
                <h3 className={`text-xl font-bold mb-2 ${tier.color}`}>{tier.name}</h3>
                <ul className="list-disc list-inside">
                  <li>Daily Bonus: {index * 5 + 5}%</li>
                  <li>Cashback: {index * 0.5 + 0.5}%</li>
                  <li>VIP Support: {index >= 2 ? 'Yes' : 'No'}</li>
                </ul>
              </div>
            ))}
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
        <TabsList className="flex w-full bg-gradient-to-r from-purple-600 to-indigo-600 p-1 rounded-lg">
          {games.map(game => (
            <TabsTrigger 
              key={game.id} 
              value={game.id} 
              className="flex-1 py-2 text-white data-[state=active]:bg-white data-[state=active]:text-purple-600 rounded-md transition-all duration-200"
            >
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
                <div className="relative w-full aspect-[16/9] mb-6 overflow-hidden rounded-lg bg-gradient-to-b from-gray-800 to-gray-900 shadow-2xl">
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="relative w-4/5 h-4/5 bg-gradient-to-b from-gray-700 to-gray-800 rounded-xl shadow-inner overflow-hidden">
                      <div className="absolute inset-0 flex">
                        {reels.map((reel, i) => (
                          <div key={i} className="flex-1 border-r-2 border-gray-600 last:border-r-0">
                            <div 
                              className="relative h-full transition-transform duration-1000 ease-in-out" 
                              style={{
                                transform: spinning ? `translateY(${-100 * (reel.length - 3)}%)` : 'translateY(0)',
                              }}
                            >
                              {[...reel, ...reel].map((symbolImage, j) => (
                                <div key={j} className="absolute inset-0" style={{top: `${j * (100 / 3)}%`}}>
                                  <img src={symbolImage} alt="Slot Symbol" className="w-full h-full object-contain p-2" />
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="absolute top-0 left-0 right-0 h-1/6 bg-gradient-to-b from-gray-900 to-transparent"></div>
                  <div className="absolute bottom-0 left-0 right-0 h-1/6 bg-gradient-to-t from-gray-900 to-transparent"></div>
                </div>
                {specialEvent && (
                  <Card className="mb-4 bg-gradient-to-r from-red-500 to-green-500 text-white">
                    <CardContent className="flex items-center justify-between p-4">
                      <div className="flex items-center">
                        {specialEvent.icon}
                        <div className="ml-4">
                          <h3 className="text-xl font-bold">{specialEvent.name}</h3>
                          <p>{specialEvent.description}</p>
                        </div>
                      </div>
                      <Button className="bg-white text-black hover:bg-gray-200">
                        Claim Now
                      </Button>
                    </CardContent>
                  </Card>
                )}
                <div className="flex justify-between items-center mb-6 bg-gradient-to-r from-gray-800 to-gray-900 p-4 rounded-lg shadow-lg">
                  <div className="flex items-center space-x-6">
                    <div className="text-2xl">
                      <span className="text-gray-400">Balance:</span> 
                      <span className="text-green-400 font-bold ml-2">{formatCurrency(balance)}</span>
                    </div>
                    {freeSpins > 0 && (
                      <div className="text-2xl">
                        <span className="text-gray-400">Free Spins:</span> 
                        <span className="text-yellow-400 font-bold ml-2">{freeSpins}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center space-x-6">
                    <div className="flex items-center bg-gray-700 rounded-lg overflow-hidden">
                      <Button onClick={() => setBet(Math.max(1, bet - 1))} variant="ghost" size="sm" className="text-white hover:bg-gray-600">-</Button>
                      <div className="px-4 py-2 bg-gray-800 text-white">
                        <span className="text-gray-400">Bet:</span> 
                        <span className="font-bold ml-2">{formatCurrency(bet)}</span>
                      </div>
                      <Button onClick={() => setBet(Math.min(100, bet + 1))} variant="ghost" size="sm" className="text-white hover:bg-gray-600">+</Button>
                    </div>
                    <div className="flex items-center bg-gray-700 rounded-lg overflow-hidden">
                      <Button onClick={() => setPaylines(Math.max(1, paylines - 1))} variant="ghost" size="sm" className="text-white hover:bg-gray-600">-</Button>
                      <div className="px-4 py-2 bg-gray-800 text-white">
                        <span className="text-gray-400">Lines:</span> 
                        <span className="font-bold ml-2">{paylines}</span>
                      </div>
                      <Button onClick={() => setPaylines(Math.min(25, paylines + 1))} variant="ghost" size="sm" className="text-white hover:bg-gray-600">+</Button>
                    </div>
                  </div>
                </div>
                <div className="flex justify-between mb-6">
                  <Button
                    onClick={() => setIsLoggedIn(!isLoggedIn)}
                    className={`w-1/4 ${isLoggedIn ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'}`}
                  >
                    {isLoggedIn ? <Lock className="mr-2 h-5 w-5" /> : <Unlock className="mr-2 h-5 w-5" />}
                    {isLoggedIn ? 'Logout' : 'Login'}
                  </Button>
                  <Button
                    onClick={toggleFullscreen}
                    className="w-1/4 bg-purple-500 hover:bg-purple-600"
                  >
                    {isFullscreen ? <Minimize2 className="mr-2 h-5 w-5" /> : <Maximize2 className="mr-2 h-5 w-5" />}
                    {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                  </Button>
                  <Drawer>
                    <DrawerTrigger asChild>
                      <Button className="w-1/4 bg-blue-500 hover:bg-blue-600">
                        <Trophy className="mr-2 h-5 w-5" />
                        Player Stats
                      </Button>
                    </DrawerTrigger>
                    <DrawerContent>
                      <DrawerHeader>
                        <DrawerTitle>Your Gaming Statistics</DrawerTitle>
                      </DrawerHeader>
                      <div className="p-4 space-y-4">
                        <div className="flex justify-between">
                          <span>Total Spins:</span>
                          <span>{playerStats.totalSpins}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Total Wins:</span>
                          <span>{playerStats.totalWins}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Biggest Win:</span>
                          <span>{formatCurrency(playerStats.biggestWin)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Current Streak:</span>
                          <span>{playerStats.currentStreak}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Longest Streak:</span>
                          <span>{playerStats.longestStreak}</span>
                        </div>
                      </div>
                    </DrawerContent>
                  </Drawer>
                </div>
                <div className="flex justify-center mb-6">
                  <Button 
                    onClick={spinReels} 
                    disabled={spinning || autoPlay} 
                    className="w-1/2 h-20 text-3xl font-bold bg-gradient-to-r from-green-400 to-blue-500 hover:from-green-500 hover:to-blue-600 text-white shadow-lg rounded-full transform hover:scale-105 transition-transform duration-200"
                  >
                    {spinning ? (
                      <Loader2 className="mr-2 h-10 w-10 animate-spin" />
                    ) : (
                      <Zap className="mr-2 h-10 w-10" />
                    )}
                    {spinning ? 'Spinning...' : 'SPIN'}
                  </Button>
                </div>
                <div className="flex justify-between mb-6">
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
                  <div className="grid grid-cols-3 gap-4">
                    {recentWins.map((win, index) => (
                      <Card key={index} className="bg-gradient-to-br from-yellow-400 to-yellow-600 text-black p-2">
                        <CardContent className="text-center">
                          <p className="text-lg font-bold">{formatCurrency(win.amount)}</p>
                          <p className="text-sm">{new Date(win.timestamp).toLocaleTimeString()}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
                <div className="mt-6">
                  <h3 className="text-xl mb-2">Hot and Cold Symbols</h3>
                  <div className="flex justify-between">
                    {symbols.slice(0, 5).map((symbol, index) => (
                      <div key={index} className="text-center">
                        <img src={symbol} alt={`Symbol ${index + 1}`} className="w-12 h-12 mx-auto mb-2" />
                        <Badge variant={index < 2 ? "success" : "destructive"}>
                          {index < 2 ? 'Hot' : 'Cold'}
                        </Badge>
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
            <p className="mb-4">Choose Heads or Tails to double your last win of {formatCurrency(lastWin?.amount || 0)}!</p>
            <div className="flex justify-center space-x-4">
              <Button onClick={() => handleMiniGame('heads')} className="bg-yellow-400 text-black hover:bg-yellow-500">
                <CoinIcon className="mr-2 h-5 w-5" />
                Heads
              </Button>
              <Button onClick={() => handleMiniGame('tails')} className="bg-yellow-400 text-black hover:bg-yellow-500">
                <CoinIcon className="mr-2 h-5 w-5" />
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
              <img src="/placeholder.svg" alt={game.name} className="w-full h-40 object-cover" />
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
      <DailyBonus />
    </div>
    </div>
  );
};

export default Index;

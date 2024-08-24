import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion, useAnimation } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { useSpring, animated } from '@react-spring/web';
import ReactConfetti from 'react-confetti';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Gift, Zap, Trophy, Star, Lock, Unlock, Minimize2, Maximize2, AlertTriangle, Info, RefreshCw, DollarSign, Volume2, VolumeX, Settings, ChevronLeft, ChevronRight, Coins, Sparkles, Home, Menu } from "lucide-react";
import { formatCurrency, getSlotAssets, getGameBackgrounds, getPromotionImages } from '@/lib/utils';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import DepositDialog from '@/components/DepositDialog';
import HelpDialog from '@/components/HelpDialog';
import BonusWheel from '@/components/BonusWheel';
import SideBet from '@/components/SideBet';
import LeaderBoard from '@/components/LeaderBoard';
import SpecialEventBanner from '@/components/SpecialEventBanner';
import DailyBonus from '@/components/DailyBonus';
import PayTable from '@/components/PayTable';
import LoyaltyProgramPopup from '@/components/LoyaltyProgramPopup';

const Index = () => {
  console.log("Index component rendering"); // Add this line for debugging
  const [slotAssets, setSlotAssets] = useState(getSlotAssets());
  const [gameBackgrounds, setGameBackgrounds] = useState(getGameBackgrounds());
  const [promotionImages, setPromotionImages] = useState(getPromotionImages());
  const [playerRank, setPlayerRank] = useState("3K+");
  const [playerScore, setPlayerScore] = useState(87.86);
  const [playerCredits, setPlayerCredits] = useState(8.78);
  const [showConfetti, setShowConfetti] = useState(false);
  const [dailyChallenge, setDailyChallenge] = useState(null);
  const [achievements, setAchievements] = useState([]);
  const [showLoyaltyPopup, setShowLoyaltyPopup] = useState(false);
  const [nextTier, setNextTier] = useState("Platinum");
  const [tierProgress, setTierProgress] = useState(65);
  const [hotStreak, setHotStreak] = useState(0);

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
    const currentTierIndex = loyaltyTiers.findIndex(tier => tier.name === currentTier.name);
    if (currentTierIndex < loyaltyTiers.length - 1) {
      setNextTier(loyaltyTiers[currentTierIndex + 1].name);
      const pointsToNextTier = loyaltyTiers[currentTierIndex + 1].points - currentTier.points;
      const progress = ((loyaltyPoints - currentTier.points) / pointsToNextTier) * 100;
      setTierProgress(Math.min(progress, 100));
    } else {
      setNextTier("Max Tier");
      setTierProgress(100);
    }
  }, [currentTier, loyaltyPoints, loyaltyTiers]);

  useEffect(() => {
    console.log("Assets loaded:", slotAssets, gameBackgrounds, promotionImages);
  }, [slotAssets, gameBackgrounds, promotionImages]);

  const updateHotStreak = (isWin) => {
    if (isWin) {
      setHotStreak(prev => prev + 1);
    } else {
      setHotStreak(0);
    }
  };
  const [showResponsibleGamingInfo, setShowResponsibleGamingInfo] = useState(false);
  const [timeSpent, setTimeSpent] = useState(0);

  useEffect(() => {
    // Start tracking time spent
    const interval = setInterval(() => {
      setTimeSpent(prevTime => prevTime + 1);
    }, 60000); // Update every minute

    return () => clearInterval(interval);
  }, []);

  // For debugging
  console.log("Index component rendered");

  useEffect(() => {
    // Check if the player has been playing for more than 2 hours
    if (timeSpent >= 120) {
      setShowResponsibleGamingInfo(true);
    }
  }, [timeSpent]);

  const { toast } = useToast();
  const [reels, setReels] = useState([]);

  useEffect(() => {
    if (slotAssets.length > 0) {
      setReels(Array(5).fill().map(() => 
        Array(3).fill().map(() => slotAssets[Math.floor(Math.random() * slotAssets.length)].image)
      ));
    }
  }, [slotAssets]);
  const [spinning, setSpinning] = useState(false);
  const [winAmount, setWinAmount] = useState(0);
  const [jackpot, setJackpot] = useLocalStorage('jackpot', 10000);
  const [jackpotTicker, setJackpotTicker] = useState(jackpot);
  const [sound, setSound] = useLocalStorage('sound', true);
  const [autoPlay, setAutoPlay] = useState(false);
  const [autoPlayCount, setAutoPlayCount] = useState(0);
  const [selectedGame, setSelectedGame] = useLocalStorage('selectedGame', 'matrix');
  const [paylines, setPaylines] = useLocalStorage('paylines', 20);
  const [bonusProgress, setBonusProgress] = useLocalStorage('bonusProgress', 0);
  const [turboMode, setTurboMode] = useLocalStorage('turboMode', false);
  const [animationSpeed, setAnimationSpeed] = useLocalStorage('animationSpeed', 1);
  const [showSettings, setShowSettings] = useState(false);
  const [showBonusWheel, setShowBonusWheel] = useState(false);
  const [lastWin, setLastWin] = useState(null);
  const [multiplier, setMultiplier] = useState(1);
  const [freeSpins, setFreeSpins] = useLocalStorage('freeSpins', 0);
  const [loyaltyPoints, setLoyaltyPoints] = useLocalStorage('loyaltyPoints', 2500);
  const [progressiveJackpot, setProgressiveJackpot] = useLocalStorage('progressiveJackpot', 100000);
  const [showMiniGame, setShowMiniGame] = useState(false);
  const [winningLines, setWinningLines] = useState([]);
  const [recentWins, setRecentWins] = useLocalStorage('recentWins', []);
  const [isLoggedIn, setIsLoggedIn] = useLocalStorage('isLoggedIn', false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [currentSymbolIndex, setCurrentSymbolIndex] = useState(0);

  const [symbols, setSymbols] = useState([]);

  useEffect(() => {
    if (slotAssets.length > 0) {
      setSymbols(slotAssets.map(asset => asset.image));
    }
  }, [slotAssets]);

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

  const [games, setGames] = useState([]);

  useEffect(() => {
    if (gameBackgrounds.length > 0 && slotAssets.length > 0) {
      setGames([
        { id: 'matrix', name: "Matrix Reloaded", image: gameBackgrounds[0]?.image, assets: slotAssets },
        { id: 'cyber', name: "Cybernetic Spin", image: gameBackgrounds[1]?.image, assets: slotAssets },
        { id: 'quantum', name: "Quantum Quandary", image: gameBackgrounds[2]?.image, assets: slotAssets },
        { id: 'neural', name: "Neural Network", image: gameBackgrounds[3]?.image, assets: slotAssets },
      ]);
    }
  }, [gameBackgrounds, slotAssets]);

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

    // Enhanced Matrix-style reel animation
    const animateReels = (currentFrame) => {
      if (currentFrame < 30) { // Increased to 30 frames for smoother animation
        const animatedReels = reels.map(() =>
          Array.from({ length: 3 }, () => symbols[Math.floor(Math.random() * symbols.length)])
        );
        setReels(animatedReels);
        requestAnimationFrame(() => animateReels(currentFrame + 1));
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
        
          // Enhanced Matrix-style win animation
          animateWin(lines);
          
          // Trigger confetti for big wins
          if (totalWin >= bet * 10) {
            setShowConfetti(true);
            setTimeout(() => setShowConfetti(false), 5000);
          }

          // Show mini-game option for big wins
          if (totalWin >= bet * 5) {
            setShowMiniGame(true);
          }

          // Check for achievements
          checkAchievements(totalWin);

          // Update hot streak
          updateHotStreak(true);
        } else {
          updateHotStreak(false);
        }
        updateBonusProgress();
        updateLoyaltyPoints(bet);
        checkForFreeSpins(newReels);
        updateDailyChallenge();
      }
    };

    const spinDuration = turboMode ? 300 : 600 / animationSpeed; // Adjusted for smoother animation
    setTimeout(() => animateReels(0), spinDuration);
  }, [balance, bet, freeSpins, multiplier, progressiveJackpot, reels, symbols, turboMode, animationSpeed, toast]);

  const checkAchievements = (totalWin) => {
    const newAchievements = [...achievements];
    if (totalWin >= 1000 && !achievements.includes('bigWin')) {
      newAchievements.push('bigWin');
      toast({
        title: "Achievement Unlocked!",
        description: "Big Winner: Win 1000 or more in a single spin",
        variant: "success",
      });
    }
    // Add more achievement checks here
    setAchievements(newAchievements);
  };

  const updateDailyChallenge = () => {
    if (dailyChallenge) {
      const updatedProgress = dailyChallenge.progress + 1;
      if (updatedProgress >= dailyChallenge.target) {
        toast({
          title: "Daily Challenge Completed!",
          description: `You've earned ${dailyChallenge.reward} free spins!`,
          variant: "success",
        });
        setFreeSpins(prevFreeSpins => prevFreeSpins + dailyChallenge.reward);
        setDailyChallenge(null);
      } else {
        setDailyChallenge({...dailyChallenge, progress: updatedProgress});
      }
    }
  };

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

  const [backgroundImage, setBackgroundImage] = useState('/placeholder.svg');
  const [specialEvent, setSpecialEvent] = useState(null);
  const matrixRainRef = useRef(null);
  const controls = useAnimation();

  useEffect(() => {
    // Matrix rain effect
    const canvas = matrixRainRef.current;
    if (canvas) {
      const context = canvas.getContext('2d');
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;

      const matrix = "ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789@#$%^&*()*&^%";
      const matrixArray = matrix.split("");
      const fontSize = 10;
      const columns = canvas.width / fontSize;
      const drops = [];

      for (let x = 0; x < columns; x++) {
        drops[x] = 1;
      }

      const drawMatrixRain = () => {
        context.fillStyle = "rgba(0, 0, 0, 0.04)";
        context.fillRect(0, 0, canvas.width, canvas.height);

        context.fillStyle = "#0F0";
        context.font = fontSize + "px arial";

        for (let i = 0; i < drops.length; i++) {
          const text = matrixArray[Math.floor(Math.random() * matrixArray.length)];
          context.fillText(text, i * fontSize, drops[i] * fontSize);

          if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
            drops[i] = 0;
          }

          drops[i]++;
        }
      };

      const matrixRainInterval = setInterval(drawMatrixRain, 33);

      // Check for special events
      const currentDate = new Date();
      if (currentDate.getMonth() === 11 && currentDate.getDate() === 25) {
        setSpecialEvent({
          name: "Christmas Spins",
          description: "Get 50 free spins on Christmas Day!",
          icon: <Gift className="h-6 w-6 text-red-500" />
        });
      }

      return () => clearInterval(matrixRainInterval);
    }
  }, []);

  const triggerWinAnimation = async () => {
    await controls.start({
      y: [-20, 0],
      opacity: [0, 1],
      transition: { duration: 0.5 }
    });
    await controls.start({
      scale: [1, 1.2, 1],
      transition: { duration: 0.3, times: [0, 0.5, 1] }
    });
  };

  const handleMiniGame = (choice) => {
    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    if (choice === result) {
      const doubledWin = lastWin.amount * 2;
      setBalance(prevBalance => prevBalance + doubledWin);
      setLastWin({ amount: doubledWin, multiplier: 2, type: 'mini-game' });
      toast({
        title: "Mini-Game Win!",
        description: `You've doubled your win to ${formatCurrency(doubledWin)}!`,
        variant: "success",
      });
    } else {
      toast({
        title: "Mini-Game Loss",
        description: "Better luck next time!",
        variant: "destructive",
      });
    }
    setShowMiniGame(false);
  };

  const [balance, setBalance] = useLocalStorage('balance', 1000);
  const [bet, setBet] = useState(10);

  const [springProps, setSpringProps] = useSpring(() => ({
    scale: 1,
    rotateZ: 0,
    config: { tension: 300, friction: 10 },
  }));

  useEffect(() => {
    if (!dailyChallenge) {
      setDailyChallenge({
        description: "Spin the reels 50 times",
        target: 50,
        progress: 0,
        reward: 10,
      });
    }
  }, []);

  return (
    <div className="container mx-auto px-4 py-8">
      <canvas ref={matrixRainRef} className="fixed inset-0 pointer-events-none" />
      {showConfetti && <ReactConfetti />}
      <div className="relative w-full max-w-4xl mx-auto bg-black rounded-lg overflow-hidden shadow-2xl">
        <div className="absolute top-0 left-0 right-0 h-16 bg-gradient-to-r from-green-600 to-blue-600 flex items-center justify-between px-4">
          <Button variant="ghost" className="text-white">
            <Home className="h-6 w-6" />
          </Button>
          <h1 className="text-2xl font-bold text-white">Matrix Slots Extravaganza</h1>
          <Button variant="ghost" className="text-white">
            <Menu className="h-6 w-6" />
          </Button>
        </div>
        <div className="mt-20 p-4">
          <div className="flex justify-between mb-4">
            {[5, 4, 3, 2, 1].map((num) => (
              <div key={num} className="text-center p-2 rounded-lg bg-gradient-to-r from-green-500 to-blue-500">
                <div className="text-sm font-bold">Level {num}</div>
                <div className="text-lg font-bold">{formatCurrency(num * 10000)}</div>
              </div>
            ))}
          </div>
          <div className="relative aspect-[16/9] bg-gradient-to-b from-gray-900 to-black rounded-lg overflow-hidden mb-4">
            <div className="absolute inset-0 grid grid-cols-6 gap-1 p-2">
              {reels.map((reel, i) => (
                <div key={i} className="flex flex-col space-y-1">
                  {reel.map((symbol, j) => (
                    <div key={j} className="aspect-square bg-gray-800 rounded-md overflow-hidden">
                      <img src={symbol} alt="Slot Symbol" className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
              ))}
            </div>
            {spinning && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-4xl font-bold text-green-400 animate-pulse">SPINNING...</div>
              </div>
            )}
          </div>
          <div className="flex justify-between items-center mb-4 bg-gray-800 p-4 rounded-lg">
            <div className="text-white">
              <div className="text-sm">TOTAL BET</div>
              <div className="text-xl font-bold">{formatCurrency(bet)}</div>
            </div>
            <Button 
              onClick={spinReels} 
              disabled={spinning || autoPlay}
              className="w-1/3 h-16 text-2xl font-bold bg-gradient-to-r from-green-400 to-blue-500 hover:from-green-500 hover:to-blue-600 text-white shadow-lg rounded-full"
            >
              {spinning ? <Loader2 className="h-8 w-8 animate-spin" /> : 'SPIN'}
            </Button>
            <div className="text-white text-right">
              <div className="text-sm">BALANCE</div>
              <div className="text-xl font-bold">{formatCurrency(balance)}</div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Button className="bg-purple-600 hover:bg-purple-700">
              BUY BONUS
            </Button>
            <Button variant="outline" className="border-2 border-yellow-400 text-yellow-400 hover:bg-yellow-400 hover:text-black">
              AUTO PLAY
            </Button>
            <Button variant="outline" className="border-2 border-blue-400 text-blue-400 hover:bg-blue-400 hover:text-black">
              <Settings className="h-6 w-6 mr-2" />
              SETTINGS
            </Button>
          </div>
        </div>
      </div>
      
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

      {showResponsibleGamingInfo && (
        <Card className="mb-4 bg-yellow-100 text-yellow-800">
          <CardContent className="flex items-center p-4">
            <AlertTriangle className="h-6 w-6 mr-2" />
            <p>You've been playing for 2 hours. Consider taking a break.</p>
            <Button className="ml-auto" onClick={() => setShowResponsibleGamingInfo(false)}>Dismiss</Button>
          </CardContent>
        </Card>
      )}

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
                <div className="relative w-full mb-6 overflow-hidden rounded-lg bg-gradient-to-b from-gray-800 to-gray-900 shadow-2xl">
                  <div className="bg-purple-900 text-white p-2 flex justify-between items-center">
                    <div className="flex items-center">
                      <Trophy className="h-6 w-6 text-yellow-400 mr-2" />
                      <span>Rank: {playerRank}</span>
                    </div>
                    <div>Score: {playerScore.toFixed(2)}</div>
                    <div className="flex items-center">
                      <Star className="h-6 w-6 text-yellow-400 mr-2" />
                      <span>Credits: {playerCredits.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="text-center text-white text-sm py-1 bg-purple-800">
                    Your rank will appear after you reach a score of 6226
                  </div>
                  <div className="relative aspect-[4/3] bg-gradient-to-b from-blue-900 to-purple-900">
                    <div className="absolute top-0 left-0 right-0 text-center py-2">
                      <h2 className="text-3xl font-bold text-yellow-400 drop-shadow-lg">Matrix Code Breaker</h2>
                    </div>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="grid grid-cols-5 gap-1 w-11/12 aspect-[5/3]">
                        {reels.map((reel, i) => (
                          <div key={i} className="bg-gray-800 rounded-lg overflow-hidden">
                            <motion.div 
                              className="relative h-full"
                              animate={spinning ? { y: [`0%`, `-${(reel.length - 3) * 100}%`] } : { y: '0%' }}
                              transition={{ duration: 2, ease: "easeInOut" }}
                            >
                              {[...reel, ...reel].map((symbolImage, j) => (
                                <motion.div 
                                  key={j} 
                                  className="absolute inset-0" 
                                  style={{top: `${j * (100 / 3)}%`}}
                                  whileHover={{ scale: 1.1 }}
                                  transition={{ type: "spring", stiffness: 300 }}
                                >
                                  <img src={symbolImage} alt="Slot Symbol" className="w-full h-full object-contain p-1" />
                                </motion.div>
                              ))}
                            </motion.div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="bg-gradient-to-r from-purple-800 to-blue-800 p-2 flex justify-between items-center">
                    <Button variant="outline" className="bg-gray-700 text-white">
                      <Settings className="h-5 w-5 mr-2" />
                      Settings
                    </Button>
                    <Button 
                      onClick={spinReels} 
                      disabled={spinning || autoPlay}
                      className="w-20 h-20 rounded-full bg-green-500 hover:bg-green-600 text-white font-bold text-xl"
                    >
                      {spinning ? <Loader2 className="h-10 w-10 animate-spin" /> : <RefreshCw className="h-10 w-10" />}
                    </Button>
                    <Button variant="outline" className="bg-purple-600 text-white">
                      Buy Feature
                    </Button>
                  </div>
                  <div className="flex justify-between bg-gray-800 text-white p-2">
                    <div>Balance: {formatCurrency(balance)}</div>
                    <div>Bet: {formatCurrency(bet)}</div>
                  </div>
                </div>
                {specialEvent && <SpecialEventBanner event={specialEvent} />}
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
                    className={`w-1/5 ${isLoggedIn ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'}`}
                  >
                    {isLoggedIn ? <Lock className="mr-2 h-5 w-5" /> : <Unlock className="mr-2 h-5 w-5" />}
                    {isLoggedIn ? 'Logout' : 'Login'}
                  </Button>
                  <Button
                    onClick={toggleFullscreen}
                    className="w-1/5 bg-purple-500 hover:bg-purple-600"
                  >
                    {isFullscreen ? <Minimize2 className="mr-2 h-5 w-5" /> : <Maximize2 className="mr-2 h-5 w-5" />}
                    {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                  </Button>
                  <Drawer>
                    <DrawerTrigger asChild>
                      <Button className="w-1/5 bg-blue-500 hover:bg-blue-600">
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
                  <Button
                    onClick={() => setShowResponsibleGamingInfo(true)}
                    className="w-1/5 bg-yellow-500 hover:bg-yellow-600"
                  >
                    <AlertTriangle className="mr-2 h-5 w-5" />
                    Responsible Gaming
                  </Button>
                  <Link to="/tournaments" className="w-1/5">
                    <Button className="w-full bg-orange-500 hover:bg-orange-600">
                      <Trophy className="mr-2 h-5 w-5" />
                      Tournaments
                    </Button>
                  </Link>
                  <Button
                    onClick={() => setShowRules(true)}
                    className="w-1/5 bg-blue-500 hover:bg-blue-600"
                  >
                    <Info className="mr-2 h-5 w-5" />
                    Game Rules
                  </Button>
                </div>
                <div className="mt-4 text-center">
                  <Button
                    onClick={() => window.location.href = '/responsible-gaming'}
                    className="bg-yellow-500 hover:bg-yellow-600 text-black"
                  >
                    <AlertTriangle className="mr-2 h-5 w-5" />
                    Learn More About Responsible Gaming
                  </Button>
                </div>
                <div className="flex justify-center mb-6">
                  <animated.div
                    style={springProps}
                    onMouseEnter={() => setSpringProps({ scale: 1.1, rotateZ: 5 })}
                    onMouseLeave={() => setSpringProps({ scale: 1, rotateZ: 0 })}
                  >
                    <Button 
                      onClick={() => {
                        spinReels();
                        setSpringProps({ scale: 0.9, rotateZ: -5 });
                        setTimeout(() => setSpringProps({ scale: 1, rotateZ: 0 }), 200);
                      }}
                      disabled={spinning || autoPlay} 
                      className="w-64 h-20 text-3xl font-bold bg-gradient-to-r from-green-400 to-blue-500 hover:from-green-500 hover:to-blue-600 text-white shadow-lg rounded-full"
                    >
                      {spinning ? (
                        <Loader2 className="mr-2 h-10 w-10 animate-spin" />
                      ) : (
                        <Zap className="mr-2 h-10 w-10" />
                      )}
                      {spinning ? 'Spinning...' : 'SPIN'}
                    </Button>
                  </animated.div>
                </div>
                {dailyChallenge && (
                  <Card className="mb-4 bg-gradient-to-r from-purple-500 to-pink-500 text-white">
                    <CardContent className="p-4">
                      <h3 className="text-xl font-bold mb-2">Daily Challenge</h3>
                      <p>{dailyChallenge.description}</p>
                      <Progress value={(dailyChallenge.progress / dailyChallenge.target) * 100} className="mt-2" />
                      <p className="mt-2">Progress: {dailyChallenge.progress} / {dailyChallenge.target}</p>
                      <p>Reward: {dailyChallenge.reward} Free Spins</p>
                    </CardContent>
                  </Card>
                )}
                <div className="flex justify-between mb-6">
                  <Button 
                    onClick={toggleAutoPlay}
                    className={`w-1/6 ${autoPlay ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-500 hover:bg-blue-600'}`}
                  >
                    <RefreshCw className="mr-2 h-5 w-5" />
                    {autoPlay ? `Stop (${autoPlayCount})` : 'Auto Play'}
                  </Button>
                  <Button
                    onClick={() => setMultiplier(prevMultiplier => prevMultiplier < 5 ? prevMultiplier + 1 : 1)}
                    className="w-1/6 bg-purple-500 hover:bg-purple-600"
                  >
                    <DollarSign className="mr-2 h-5 w-5" />
                    {`Multiplier: ${multiplier}x`}
                  </Button>
                  <PayTable />
                  <Button
                    className={`w-1/6 ${hotStreak > 0 ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-gray-500 hover:bg-gray-600'}`}
                  >
                    <Zap className="mr-2 h-5 w-5" />
                    {`Hot Streak: ${hotStreak}`}
                  </Button>
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
                  <div className="flex items-center justify-between">
                    <Button onClick={() => setCurrentSymbolIndex(prev => Math.max(0, prev - 1))} variant="ghost">
                      <ChevronLeft className="h-6 w-6" />
                    </Button>
                    <div className="flex justify-center space-x-4">
                      {symbols.slice(currentSymbolIndex, currentSymbolIndex + 5).map((symbol, index) => (
                        <div key={index} className="text-center">
                          <img src={symbol} alt={`Symbol ${index + 1}`} className="w-12 h-12 mx-auto mb-2" />
                          <Badge variant={index < 2 ? "success" : "destructive"}>
                            {index < 2 ? 'Hot' : 'Cold'}
                          </Badge>
                        </div>
                      ))}
                    </div>
                    <Button onClick={() => setCurrentSymbolIndex(prev => Math.min(symbols.length - 5, prev + 1))} variant="ghost">
                      <ChevronRight className="h-6 w-6" />
                    </Button>
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
                  <motion.div 
                    className="mt-4 text-center"
                    initial={{ opacity: 0, y: 20 }}
                    animate={controls}
                  >
                    <div className="text-3xl text-yellow-400">
                      You won {formatCurrency(winAmount)}!
                    </div>
                    <div className="mt-2">
                      <Sparkles className="inline-block mr-2 h-6 w-6 text-yellow-400" />
                      <span className="text-xl text-green-400">
                        {winAmount >= bet * 10 ? 'Big Win!' : winAmount >= bet * 5 ? 'Great Win!' : 'Nice Win!'}
                      </span>
                      <Sparkles className="inline-block ml-2 h-6 w-6 text-yellow-400" />
                    </div>
                    {/* Fireworks component removed */}
                  </motion.div>
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
      <Dialog open={showMiniGame} onOpenChange={setShowMiniGame}>
        <DialogContent className="bg-gradient-to-r from-pink-500 to-purple-500 text-white">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold">Mini-Game: Double or Nothing</DialogTitle>
          </DialogHeader>
          <div className="p-6">
            <p className="mb-4">Choose Heads or Tails to double your last win of {formatCurrency(lastWin?.amount || 0)}!</p>
            <div className="flex justify-center space-x-4">
              <Button onClick={() => handleMiniGame('heads')} className="bg-yellow-400 text-black hover:bg-yellow-500">
                <Coins className="mr-2 h-5 w-5" />
                Heads
              </Button>
              <Button onClick={() => handleMiniGame('tails')} className="bg-yellow-400 text-black hover:bg-yellow-500">
                <Coins className="mr-2 h-5 w-5" />
                Tails
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Leaderboard */}
      <LeaderBoard />

      {/* Other Games */}
      <h2 className="text-3xl font-bold text-white mb-4">More Exciting Games</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {games.map((game, index) => (
          <Card key={index} className="bg-black/50 text-white overflow-hidden hover:shadow-lg transition-shadow duration-300">
            <div className="relative">
              <img src={game.image} alt={game.name} className="w-full h-40 object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent flex items-end p-4">
                <h3 className="text-xl font-bold text-white">{game.name}</h3>
              </div>
            </div>
            <CardContent className="p-4">
              <Button 
                className="w-full bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white"
                onClick={() => setSelectedGame(game.id)}
              >
                Play Now
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      <DailyBonus />
      <LoyaltyProgramPopup
        isOpen={showLoyaltyPopup}
        onClose={() => setShowLoyaltyPopup(false)}
        loyaltyPoints={loyaltyPoints}
        currentTier={currentTier}
        nextTier={nextTier}
        tierProgress={tierProgress}
      />
      <Button
        onClick={() => setShowLoyaltyPopup(true)}
        className="fixed bottom-4 left-4 bg-gradient-to-r from-purple-500 to-indigo-500 text-white"
      >
        <Star className="mr-2 h-5 w-5" />
        Loyalty Program
      </Button>

      {/* Game Rules Dialog */}
      <Dialog open={showRules} onOpenChange={setShowRules}>
        <DialogContent className="bg-gray-900 text-white">
          <DialogHeader>
            <DialogTitle>Game Rules</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">How to Play</h3>
            <ul className="list-disc pl-5 space-y-2">
              <li>Set your bet amount and number of paylines.</li>
              <li>Click the Spin button to start the game.</li>
              <li>Match symbols across paylines to win.</li>
              <li>Special symbols can trigger bonus features.</li>
              <li>The Jackpot is won by getting 5 Star symbols on a payline.</li>
            </ul>
            <h3 className="text-lg font-semibold">Special Features</h3>
            <ul className="list-disc pl-5 space-y-2">
              <li>Free Spins: Get 3 or more Scatter symbols to trigger free spins.</li>
              <li>Multiplier: Increase your potential winnings with the multiplier feature.</li>
              <li>Bonus Wheel: Fill the bonus progress bar to spin the Bonus Wheel for extra prizes.</li>
              <li>Side Bet: Place an additional bet for a chance to win instant prizes.</li>
            </ul>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Index;

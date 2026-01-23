import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSpring, animated } from '@react-spring/web';
import ReactConfetti from 'react-confetti';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/use-toast";
import { Gift, Zap, Trophy, Star, Settings } from "lucide-react";
import { formatCurrency } from '@/lib/utils';
import { useAuth } from '../contexts/AuthContext';

import GameHeader from '@/components/GameHeader';
import GameControls from '@/components/GameControls';
import ReelGrid from '@/components/ReelGrid';
import WinDisplay from '@/components/WinDisplay';
import JackpotDisplay from '@/components/JackpotDisplay';
import BonusWheel from '@/components/BonusWheel';
import SideBet from '@/components/SideBet';
import DailyBonus from '@/components/DailyBonus';
import LoyaltyProgramPopup from '@/components/LoyaltyProgramPopup';
import { SYMBOLS } from '../lib/gameData';

const Game = () => {
  const [slotAssets, setSlotAssets] = useState(SYMBOLS);
  const [gameBackgrounds, setGameBackgrounds] = useState([]);
  const [promotionImages, setPromotionImages] = useState([]);
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
  const [balance, setBalance] = useState(0);
  const [bet, setBet] = useState(10);
  const [spinning, setSpinning] = useState(false);
  const [winAmount, setWinAmount] = useState(0);
  const [jackpot, setJackpot] = useState(10000);
  const [jackpotTicker, setJackpotTicker] = useState(jackpot);
  const [sound, setSound] = useState(true);
  const [autoPlay, setAutoPlay] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showBonusWheel, setShowBonusWheel] = useState(false);
  const [reels, setReels] = useState([]);
  const [symbols, setSymbols] = useState([]);
  const [progressiveJackpot, setProgressiveJackpot] = useState(100000);
  const [loyaltyPoints, setLoyaltyPoints] = useState(0);
  const matrixRainRef = useRef(null);
  const { toast } = useToast();
  const navigate = useNavigate();
  const { token, logout } = useAuth();

  useEffect(() => {
    const fetchUserData = async () => {
      if (!token) {
        navigate('/login');
        return;
      }

      try {
        const response = await fetch('http://localhost:3000/api/user/data', {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          setBalance(data.balance);
          setLoyaltyPoints(data.loyaltyPoints);
        } else {
          logout();
          navigate('/login');
        }
      } catch (error) {
        toast({
          title: 'Error',
          description: 'Could not connect to the server.',
          variant: 'destructive',
        });
        logout();
        navigate('/login');
      }
    };

    fetchUserData();
  }, [token, navigate, toast, logout]);

  useEffect(() => {
    if (slotAssets.length > 0) {
      setSymbols(slotAssets.map(asset => asset.image));
      setReels(Array(5).fill().map(() =>
        Array(3).fill().map(() => slotAssets[Math.floor(Math.random() * slotAssets.length)].image)
      ));
    }
  }, [slotAssets]);

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

  const spinReels = async () => {
    if (!token) {
      navigate('/login');
      return;
    }

    if (balance < bet) {
      toast({
        title: "Insufficient Balance",
        description: "Please deposit more funds to continue playing.",
        variant: "destructive",
      });
      return;
    }

    setSpinning(true);
    setWinAmount(0);

    try {
      const response = await fetch('http://localhost:3000/api/spin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ bet }),
      });

      if (response.ok) {
        const data = await response.json();

        // Animate the reels
        setTimeout(() => {
          const newReels = data.reels.map(reel => reel.map(symbolId => SYMBOLS.find(s => s.id === symbolId)?.image));
          setReels(newReels);

          setBalance(data.balance);
          setLoyaltyPoints(data.loyaltyPoints);
          setWinAmount(data.winAmount);

          if (data.isJackpotWin) {
            setShowConfetti(true);
            setTimeout(() => setShowConfetti(false), 10000);
          } else if (data.winAmount > 0 && data.winAmount >= bet * 10) {
            setShowConfetti(true);
            setTimeout(() => setShowConfetti(false), 5000);
          }

          setSpinning(false);
        }, 2000);

      } else {
        const errorData = await response.json();
        toast({
          title: 'Spin Failed',
          description: errorData.message || 'An error occurred.',
          variant: 'destructive',
        });
        setSpinning(false);
      }
    } catch (error) {
      toast({
        title: 'Spin Error',
        description: 'Could not connect to the server.',
        variant: 'destructive',
      });
      setSpinning(false);
    }
  };

  const handleBonusWheelResult = (result) => {
    setBalance(prevBalance => prevBalance + result);
    setShowBonusWheel(false);
    toast({
      title: "Bonus Win!",
      description: `You won ${formatCurrency(result)}!`,
      variant: "success",
    });
  };

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
        <GameHeader />

        <div className="mt-20 p-4">
          <ReelGrid reels={reels} spinning={spinning} symbols={symbols} />

          <GameControls
            balance={balance}
            bet={bet}
            setBet={setBet}
            spinning={spinning}
            spinReels={spinReels}
            sound={sound}
            setSound={setSound}
            autoPlay={autoPlay}
            showSettings={showSettings}
            setShowSettings={setShowSettings}
          />

          <WinDisplay winAmount={winAmount} bet={bet} />

          <JackpotDisplay
            jackpotTicker={jackpotTicker}
            progressiveJackpot={progressiveJackpot}
          />
        </div>
      </div>

      <BonusWheel
        isOpen={showBonusWheel}
        onClose={() => setShowBonusWheel(false)}
        onResult={handleBonusWheelResult}
      />

      <SideBet onWin={(amount) => setBalance(prevBalance => prevBalance + amount)} />

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
    </div>
  );
};

export default Game;

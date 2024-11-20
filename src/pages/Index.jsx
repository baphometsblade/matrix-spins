import React, { useState, useEffect, useRef } from 'react';
import { useSpring, animated } from '@react-spring/web';
import ReactConfetti from 'react-confetti';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/use-toast";
import { Gift, Zap, Trophy, Star, Settings } from "lucide-react";
import { formatCurrency } from '@/lib/utils';
import { useLocalStorage } from '@/hooks/useLocalStorage';

import GameHeader from '@/components/GameHeader';
import GameControls from '@/components/GameControls';
import ReelGrid from '@/components/ReelGrid';
import WinDisplay from '@/components/WinDisplay';
import JackpotDisplay from '@/components/JackpotDisplay';
import BonusWheel from '@/components/BonusWheel';
import SideBet from '@/components/SideBet';
import DailyBonus from '@/components/DailyBonus';
import LoyaltyProgramPopup from '@/components/LoyaltyProgramPopup';

const Index = () => {
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
  const [balance, setBalance] = useLocalStorage('balance', 1000);
  const [bet, setBet] = useState(10);
  const [spinning, setSpinning] = useState(false);
  const [winAmount, setWinAmount] = useState(0);
  const [jackpot, setJackpot] = useLocalStorage('jackpot', 10000);
  const [jackpotTicker, setJackpotTicker] = useState(jackpot);
  const [sound, setSound] = useLocalStorage('sound', true);
  const [autoPlay, setAutoPlay] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showBonusWheel, setShowBonusWheel] = useState(false);
  const [reels, setReels] = useState([]);
  const [symbols, setSymbols] = useState([]);
  const [progressiveJackpot, setProgressiveJackpot] = useLocalStorage('progressiveJackpot', 100000);
  const [loyaltyPoints, setLoyaltyPoints] = useLocalStorage('loyaltyPoints', 2500);
  const matrixRainRef = useRef(null);
  const { toast } = useToast();

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

  const spinReels = () => {
    if (balance < bet) {
      toast({
        title: "Insufficient Balance",
        description: "Please deposit more funds to continue playing.",
        variant: "destructive",
      });
      return;
    }

    setBalance(prevBalance => prevBalance - bet);
    setSpinning(true);
    setWinAmount(0);

    setTimeout(() => {
      const newReels = reels.map(() =>
        Array(3).fill().map(() => symbols[Math.floor(Math.random() * symbols.length)])
      );
      setReels(newReels);
      setSpinning(false);

      // Simulate a win
      const randomWin = Math.random() < 0.3 ? bet * Math.floor(Math.random() * 10 + 1) : 0;
      if (randomWin > 0) {
        setBalance(prevBalance => prevBalance + randomWin);
        setWinAmount(randomWin);
        if (randomWin >= bet * 10) {
          setShowConfetti(true);
          setTimeout(() => setShowConfetti(false), 5000);
        }
      }

      setProgressiveJackpot(prevJackpot => prevJackpot + bet * 0.01);
    }, 2000);
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

export default Index;
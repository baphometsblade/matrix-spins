import React, { useState, useEffect, useRef } from 'react';
import ReactConfetti from 'react-confetti';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/use-toast";
import { Gift, Zap, Trophy, Star, Flame, Sparkles } from "lucide-react";
import { formatCurrency, getGameBackgrounds, getPromotionImages, getSlotAssets } from '@/lib/utils';
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
import LeaderBoard from '@/components/LeaderBoard';
import SpecialEventBanner from '@/components/SpecialEventBanner';
import PayTable from '@/components/PayTable';
import DepositDialog from '@/components/DepositDialog';
import HelpDialog from '@/components/HelpDialog';

const Index = () => {
  const [slotAssets] = useState(getSlotAssets());
  const [gameBackgrounds] = useState(getGameBackgrounds());
  const [promotionImages] = useState(getPromotionImages());
  const [playerRank] = useState("3K+");
  const [playerScore] = useState(87.86);
  const [playerCredits] = useState(8.78);
  const [showConfetti, setShowConfetti] = useState(false);
  const [dailyChallenge, setDailyChallenge] = useState(null);
  const [achievements, setAchievements] = useState([]);
  const [showLoyaltyPopup, setShowLoyaltyPopup] = useState(false);
  const [currentTier] = useState("Gold");
  const [nextTier] = useState("Platinum");
  const [tierProgress] = useState(65);
  const [hotStreak] = useState(0);
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
  const [loyaltyPoints] = useLocalStorage('loyaltyPoints', 2500);
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
    const canvas = matrixRainRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    const letters = 'アァカサタナハマヤラワ0123456789';
    const fontSize = 16;
    let animationFrameId;
    let drops = [];

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const columns = Math.floor(canvas.width / fontSize);
      drops = Array.from({ length: columns }, () => Math.floor(Math.random() * (canvas.height / fontSize)));
    };

    const draw = () => {
      context.fillStyle = 'rgba(0, 0, 0, 0.08)';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#39ff14';
      context.font = `${fontSize}px monospace`;

      drops.forEach((drop, index) => {
        const text = letters.charAt(Math.floor(Math.random() * letters.length));
        context.fillText(text, index * fontSize, drop * fontSize);
        drops[index] = drop > canvas.height / fontSize && Math.random() > 0.975 ? 0 : drop + 1;
      });

      animationFrameId = requestAnimationFrame(draw);
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    draw();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

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

  useEffect(() => {
    if (!dailyChallenge) {
      setDailyChallenge({
        description: "Spin the reels 50 times",
        target: 50,
        progress: 12,
        reward: 10,
      });
    }
  }, [dailyChallenge]);

  useEffect(() => {
    if (achievements.length === 0) {
      setAchievements([
        { name: "Matrix Master", description: "Win 1000 times", completed: true },
        { name: "Lucky Streak", description: "Win 10 spins in a row", completed: true },
        { name: "Jackpot Hunter", description: "Trigger a progressive jackpot", completed: false },
      ]);
    }
  }, [achievements.length]);

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

  const handleDeposit = (amount) => {
    setBalance(prevBalance => prevBalance + amount);
    toast({
      title: "Deposit Successful",
      description: `Added ${formatCurrency(amount)} to your balance.`,
      variant: "success",
    });
  };

  const featuredPromotions = [
    {
      title: "Welcome Package",
      description: "Get up to $1000 + 200 Free Spins on your first 3 deposits.",
      image: promotionImages[0],
    },
    {
      title: "Daily Drops",
      description: "Win a share of $1,000,000 in daily tournaments.",
      image: promotionImages[3],
    },
    {
      title: "VIP Program",
      description: "Unlock exclusive rewards and personalized offers.",
      image: promotionImages[4],
    },
  ];

  const specialEvent = {
    name: "Neon Night Jackpot",
    description: "Double progressive jackpot growth for the next 6 hours.",
    icon: <Sparkles className="h-10 w-10 text-yellow-300" />,
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <canvas ref={matrixRainRef} className="fixed inset-0 pointer-events-none opacity-70" />
      {showConfetti && <ReactConfetti />}

      <SpecialEventBanner event={specialEvent} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <Card className="bg-black/70 text-white lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center text-2xl">
              <Trophy className="mr-2 h-6 w-6 text-yellow-400" />
              Player Status
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="text-sm text-gray-400">Rank</p>
              <p className="text-2xl font-bold text-green-400">{playerRank}</p>
              <p className="text-sm text-gray-400 mt-2">Loyalty Points</p>
              <p className="text-lg font-semibold">{loyaltyPoints.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-sm text-gray-400">Win Rate</p>
              <p className="text-2xl font-bold text-green-400">{playerScore}%</p>
              <div className="mt-4">
                <p className="text-sm text-gray-400">Progress to {nextTier}</p>
                <Progress value={tierProgress} className="h-2" />
              </div>
            </div>
            <div>
              <p className="text-sm text-gray-400">Credit Boost</p>
              <p className="text-2xl font-bold text-green-400">{playerCredits}x</p>
              <p className="text-sm text-gray-400 mt-2">Hot Streak</p>
              <p className="text-lg font-semibold flex items-center gap-2">
                <Flame className="h-4 w-4 text-orange-400" />
                {hotStreak} wins
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-black/70 text-white">
          <CardHeader>
            <CardTitle className="flex items-center text-2xl">
              <Gift className="mr-2 h-6 w-6 text-pink-400" />
              Daily Challenge
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">{dailyChallenge?.description}</p>
            <p className="text-sm text-gray-400 mt-2">Reward: {formatCurrency(dailyChallenge?.reward || 0)}</p>
            <div className="mt-4">
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>{dailyChallenge?.progress} / {dailyChallenge?.target}</span>
                <span>{Math.round(((dailyChallenge?.progress || 0) / (dailyChallenge?.target || 1)) * 100)}%</span>
              </div>
              <Progress value={(dailyChallenge?.progress || 0) / (dailyChallenge?.target || 1) * 100} className="h-2" />
            </div>
            <Button className="mt-4 w-full bg-gradient-to-r from-green-400 to-blue-500">
              Boost Spins
            </Button>
          </CardContent>
        </Card>
      </div>

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

          <div className="flex flex-wrap gap-3 justify-between items-center mb-6">
            <div className="flex flex-wrap gap-3">
              <DepositDialog onDeposit={handleDeposit} />
              <PayTable />
              <HelpDialog />
            </div>
            <Button
              onClick={() => setShowBonusWheel(true)}
              className="bg-gradient-to-r from-yellow-400 to-orange-500 text-black"
            >
              <Zap className="mr-2 h-5 w-5" />
              Bonus Wheel
            </Button>
          </div>

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

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-10">
        <Card className="bg-black/70 text-white lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center text-2xl">
              <Star className="mr-2 h-6 w-6 text-yellow-400" />
              Featured Worlds
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {gameBackgrounds.map((game) => (
              <div key={game.game} className="relative overflow-hidden rounded-lg border border-white/10">
                <img src={game.image} alt={game.game} className="h-40 w-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                <div className="absolute bottom-3 left-3">
                  <p className="text-lg font-semibold">{game.game}</p>
                  <p className="text-xs text-green-200">New missions & bonus reels</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="bg-black/70 text-white">
          <CardHeader>
            <CardTitle className="flex items-center text-2xl">
              <Trophy className="mr-2 h-6 w-6 text-yellow-400" />
              Recent Achievements
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {achievements.map((achievement) => (
              <div key={achievement.name} className="flex items-start justify-between">
                <div>
                  <p className="font-semibold">{achievement.name}</p>
                  <p className="text-xs text-gray-400">{achievement.description}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${achievement.completed ? 'bg-green-500/20 text-green-300' : 'bg-yellow-500/20 text-yellow-200'}`}>
                  {achievement.completed ? 'Completed' : 'In Progress'}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-10">
        <div className="lg:col-span-2">
          <LeaderBoard />
        </div>
        <SideBet onWin={(amount) => setBalance(prevBalance => prevBalance + amount)} />
      </section>

      <section className="mt-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-3xl font-bold text-white">Promotions Spotlight</h2>
          <Button variant="outline" className="text-white border-white/40 hover:bg-white/10">
            View All
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {featuredPromotions.map((promo) => (
            <Card key={promo.title} className="bg-black/70 text-white overflow-hidden">
              <img src={promo.image} alt={promo.title} className="h-40 w-full object-cover" />
              <CardContent className="p-4">
                <h3 className="text-xl font-semibold mb-2">{promo.title}</h3>
                <p className="text-sm text-gray-300 mb-4">{promo.description}</p>
                <Button className="w-full bg-gradient-to-r from-purple-500 to-indigo-500">
                  Claim Offer
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

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

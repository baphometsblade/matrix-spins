import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Gift, Calendar, Users, Zap, Trophy, Sparkles } from "lucide-react";
import { promotionImages } from '@/lib/utils';

const Promotions = () => {
  const [promotions, setPromotions] = useState([
    {
      title: "Welcome Package",
      description: "Get up to $1000 + 200 Free Spins on your first 3 deposits!",
      icon: <Gift className="h-8 w-8 text-yellow-400" />,
      color: "from-yellow-400 to-orange-500",
      prompt: "Casino welcome package with stacks of chips and free spin symbols",
    },
    {
      title: "Weekly Cashback",
      description: "Enjoy 15% cashback on your losses every week, up to $500!",
      icon: <Calendar className="h-8 w-8 text-green-400" />,
      color: "from-green-400 to-emerald-500",
      prompt: "Casino cashback promotion with calendar and money symbols",
    },
    {
      title: "Refer a Friend",
      description: "Get $100 for each friend you refer who makes a deposit!",
      icon: <Users className="h-8 w-8 text-blue-400" />,
      color: "from-blue-400 to-indigo-500",
      prompt: "Casino refer a friend promotion with people icons and money symbols",
    },
    {
      title: "Daily Drops & Wins",
      description: "Win a share of $1,000,000 in our daily tournaments!",
      icon: <Zap className="h-8 w-8 text-purple-400" />,
      color: "from-purple-400 to-pink-500",
      prompt: "Casino daily tournament promotion with trophy and lightning bolt symbols",
    },
    {
      title: "VIP Program",
      description: "Unlock exclusive rewards and personalized offers!",
      icon: <Trophy className="h-8 w-8 text-red-400" />,
      color: "from-red-400 to-rose-500",
      prompt: "Casino VIP program promotion with crown and exclusive access symbols",
    },
    {
      title: "Slot of the Week",
      description: "Get 50 free spins on our featured slot every week!",
      icon: <Sparkles className="h-8 w-8 text-cyan-400" />,
      color: "from-cyan-400 to-teal-500",
      prompt: "Casino slot of the week promotion with slot machine and sparkle symbols",
    },
  ]);

  useEffect(() => {
    const updatePromotionsWithImages = () => {
      const updatedPromotions = promotions.map((promo, index) => ({
        ...promo,
        image: promotionImages[index] || '/placeholder.svg'
      }));
      setPromotions(updatedPromotions);
    };

    updatePromotionsWithImages();
  }, []);
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-4xl font-bold text-white mb-8 text-center">Exciting Promotions</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {promotions.map((promo, index) => (
          <Card key={index} className={`bg-gradient-to-br ${promo.color} text-white overflow-hidden`}>
            <img src={promo.image} alt={promo.title} className="w-full h-48 object-cover" />
            <CardHeader className="flex flex-row items-center space-x-4 pb-2">
              {promo.icon}
              <CardTitle className="text-2xl font-bold">{promo.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-4 text-lg">{promo.description}</p>
              <Button className="w-full bg-white text-black hover:bg-gray-200">
                Claim Now
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default Promotions;

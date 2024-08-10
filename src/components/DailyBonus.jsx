import React, { useState, useEffect } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "lucide-react";

const DailyBonus = () => {
  const [lastClaimDate, setLastClaimDate] = useState(null);
  const [showBonus, setShowBonus] = useState(false);

  useEffect(() => {
    const storedDate = localStorage.getItem('lastDailyBonusClaim');
    if (storedDate) {
      setLastClaimDate(new Date(storedDate));
    }
    
    const today = new Date();
    if (!storedDate || new Date(storedDate).getDate() !== today.getDate()) {
      setShowBonus(true);
    }
  }, []);

  const claimBonus = () => {
    const today = new Date();
    localStorage.setItem('lastDailyBonusClaim', today.toISOString());
    setLastClaimDate(today);
    setShowBonus(false);
    // Add logic to credit the bonus to the player's account
  };

  if (!showBonus) return null;

  return (
    <Card className="fixed bottom-4 right-4 bg-gradient-to-r from-yellow-400 to-orange-500 text-white">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <Calendar className="h-8 w-8 mr-4" />
            <div>
              <h3 className="text-xl font-bold">Daily Bonus</h3>
              <p>Claim your free spins!</p>
            </div>
          </div>
          <Button onClick={claimBonus} className="bg-white text-black hover:bg-gray-200">
            Claim
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default DailyBonus;

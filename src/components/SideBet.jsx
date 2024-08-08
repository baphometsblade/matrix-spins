import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dice } from "lucide-react";

const SideBet = ({ onWin }) => {
  const [betAmount, setBetAmount] = useState(1);
  const [result, setResult] = useState(null);

  const placeBet = () => {
    const diceRoll = Math.floor(Math.random() * 6) + 1;
    setResult(diceRoll);
    if (diceRoll > 3) {
      onWin(betAmount * 2);
    }
  };

  return (
    <Card className="bg-purple-900 text-white">
      <CardHeader>
        <CardTitle className="flex items-center">
          <Dice className="mr-2 h-5 w-5" />
          Lucky Dice Side Bet
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between mb-4">
          <Button onClick={() => setBetAmount(Math.max(1, betAmount - 1))} variant="outline">-</Button>
          <span className="text-xl">Bet: ${betAmount}</span>
          <Button onClick={() => setBetAmount(betAmount + 1)} variant="outline">+</Button>
        </div>
        <Button onClick={placeBet} className="w-full bg-green-500 hover:bg-green-600">
          Roll Dice
        </Button>
        {result && (
          <div className="mt-4 text-center">
            <div className="text-3xl mb-2">🎲 {result}</div>
            <div className="text-xl">
              {result > 3 ? `You won $${betAmount * 2}!` : 'Better luck next time!'}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default SideBet;

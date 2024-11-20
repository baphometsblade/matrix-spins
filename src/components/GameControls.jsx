import React from 'react';
import { Button } from "@/components/ui/button";
import { RefreshCw, Settings, Volume2, VolumeX } from "lucide-react";
import { formatCurrency } from '@/lib/utils';

const GameControls = ({ 
  balance, 
  bet, 
  setBet, 
  spinning, 
  spinReels, 
  sound, 
  setSound, 
  autoPlay,
  showSettings,
  setShowSettings 
}) => {
  return (
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
        {spinning ? <RefreshCw className="h-8 w-8 animate-spin" /> : 'SPIN'}
      </Button>
      <div className="text-white text-right">
        <div className="text-sm">BALANCE</div>
        <div className="text-xl font-bold">{formatCurrency(balance)}</div>
      </div>
      <div className="flex gap-2 ml-4">
        <Button onClick={() => setSound(!sound)} variant="outline" className="w-12">
          {sound ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
        </Button>
        <Button onClick={() => setShowSettings(!showSettings)} variant="outline" className="w-12">
          <Settings className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
};

export default GameControls;
import React from 'react';
import { Button } from "@/components/ui/button";
import { RefreshCw, Settings, Volume2, VolumeX, Plus, Minus } from "lucide-react";
import { formatCurrency } from '@/lib/utils';
import { Slider } from "@/components/ui/slider";

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
  const handleBetChange = (value) => {
    setBet(value[0]);
  };

  return (
    <div className="flex flex-col gap-4 mb-4 bg-gray-800/90 p-6 rounded-xl backdrop-blur-sm shadow-xl">
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gray-700/50 p-4 rounded-lg">
          <div className="text-sm text-gray-400">TOTAL BET</div>
          <div className="text-2xl font-bold text-green-400">{formatCurrency(bet)}</div>
          <div className="mt-2 flex items-center gap-2">
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => setBet(Math.max(1, bet - 1))}
              className="bg-gray-600 hover:bg-gray-500"
            >
              <Minus className="h-4 w-4" />
            </Button>
            <Slider
              value={[bet]}
              min={1}
              max={100}
              step={1}
              onValueChange={handleBetChange}
              className="w-24"
            />
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => setBet(Math.min(100, bet + 1))}
              className="bg-gray-600 hover:bg-gray-500"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
        
        <Button 
          onClick={spinReels} 
          disabled={spinning || autoPlay}
          className="h-full text-2xl font-bold bg-gradient-to-r from-green-500 to-blue-500 hover:from-green-600 hover:to-blue-600 text-white shadow-lg rounded-xl transition-all duration-300 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
        >
          {spinning ? (
            <RefreshCw className="h-8 w-8 animate-spin" />
          ) : (
            <span className="flex flex-col items-center">
              <span className="text-sm">CLICK TO</span>
              <span className="text-2xl">SPIN</span>
            </span>
          )}
        </Button>

        <div className="bg-gray-700/50 p-4 rounded-lg text-right">
          <div className="text-sm text-gray-400">BALANCE</div>
          <div className="text-2xl font-bold text-green-400">{formatCurrency(balance)}</div>
          <div className="mt-2 flex justify-end gap-2">
            <Button 
              onClick={() => setSound(!sound)} 
              variant="outline" 
              size="sm"
              className="bg-gray-600 hover:bg-gray-500"
            >
              {sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </Button>
            <Button 
              onClick={() => setShowSettings(!showSettings)} 
              variant="outline" 
              size="sm"
              className="bg-gray-600 hover:bg-gray-500"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GameControls;
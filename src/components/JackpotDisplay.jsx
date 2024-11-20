import React from 'react';
import { formatCurrency } from '@/lib/utils';
import { Trophy, Star } from "lucide-react";

const JackpotDisplay = ({ jackpotTicker, progressiveJackpot }) => {
  return (
    <div className="grid grid-cols-2 gap-6 mt-6">
      <div className="bg-gradient-to-br from-yellow-500 to-yellow-700 p-6 rounded-xl text-center transform hover:scale-105 transition-transform duration-300">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Trophy className="h-6 w-6 text-yellow-300" />
          <h3 className="text-xl text-white font-bold">JACKPOT</h3>
        </div>
        <div className="text-4xl font-bold text-yellow-300 animate-pulse">
          {formatCurrency(jackpotTicker)}
        </div>
      </div>
      
      <div className="bg-gradient-to-br from-purple-500 to-blue-700 p-6 rounded-xl text-center transform hover:scale-105 transition-transform duration-300">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Star className="h-6 w-6 text-blue-300" />
          <h3 className="text-xl text-white font-bold">PROGRESSIVE</h3>
        </div>
        <div className="text-4xl font-bold text-blue-300 animate-pulse">
          {formatCurrency(progressiveJackpot)}
        </div>
      </div>
    </div>
  );
};

export default JackpotDisplay;
import React from 'react';
import { formatCurrency } from '@/lib/utils';

const JackpotDisplay = ({ jackpotTicker, progressiveJackpot }) => {
  return (
    <div className="mt-6 space-y-6">
      <div className="text-center">
        <h3 className="text-2xl mb-2">Jackpot</h3>
        <div className="text-4xl text-yellow-400 animate-pulse">
          {formatCurrency(jackpotTicker)}
        </div>
      </div>
      <div className="text-center">
        <h3 className="text-2xl mb-2">Progressive Jackpot</h3>
        <div className="text-4xl text-green-400 animate-pulse">
          {formatCurrency(progressiveJackpot)}
        </div>
      </div>
    </div>
  );
};

export default JackpotDisplay;
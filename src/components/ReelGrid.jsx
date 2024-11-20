import React from 'react';
import { motion } from 'framer-motion';
import { Loader2 } from "lucide-react";

const ReelGrid = ({ reels, spinning, symbols }) => {
  return (
    <div className="relative aspect-[16/9] bg-gradient-to-b from-gray-900 to-black rounded-lg overflow-hidden mb-4">
      <div className="absolute inset-0 grid grid-cols-6 gap-1 p-2">
        {reels.map((reel, i) => (
          <div key={i} className="flex flex-col space-y-1">
            {reel.map((symbol, j) => (
              <div key={j} className="aspect-square bg-gray-800 rounded-md overflow-hidden">
                <img src={symbol} alt="Slot Symbol" className="w-full h-full object-cover" />
              </div>
            ))}
          </div>
        ))}
      </div>
      {spinning && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-4xl font-bold text-green-400 animate-pulse">
            <Loader2 className="h-12 w-12 animate-spin" />
            SPINNING...
          </div>
        </div>
      )}
    </div>
  );
};

export default ReelGrid;
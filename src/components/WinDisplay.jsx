import React from 'react';
import { motion } from 'framer-motion';
import { Sparkles } from "lucide-react";
import { formatCurrency } from '@/lib/utils';

const WinDisplay = ({ winAmount, bet }) => {
  if (!winAmount) return null;

  const isJackpot = winAmount >= bet * 50;
  const isBigWin = winAmount >= bet * 10;
  const isGreatWin = winAmount >= bet * 5;

  return (
    <motion.div 
      className="mt-8 text-center"
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.5 }}
      transition={{ duration: 0.5, type: "spring" }}
    >
      <motion.div 
        className={`text-5xl font-bold mb-4 ${
          isJackpot ? 'text-yellow-400' : 
          isBigWin ? 'text-green-400' : 
          'text-white'
        }`}
        animate={{ scale: [1, 1.1, 1] }}
        transition={{ duration: 0.5, repeat: Infinity }}
      >
        {formatCurrency(winAmount)}
      </motion.div>
      <div className="flex items-center justify-center gap-2">
        <Sparkles className="h-6 w-6 text-yellow-400" />
        <span className={`text-2xl font-bold ${
          isJackpot ? 'text-yellow-400' :
          isBigWin ? 'text-green-400' :
          isGreatWin ? 'text-blue-400' :
          'text-white'
        }`}>
          {isJackpot ? 'JACKPOT!' :
           isBigWin ? 'BIG WIN!' :
           isGreatWin ? 'GREAT WIN!' :
           'NICE WIN!'}
        </span>
        <Sparkles className="h-6 w-6 text-yellow-400" />
      </div>
    </motion.div>
  );
};

export default WinDisplay;
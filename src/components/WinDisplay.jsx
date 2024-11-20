import React from 'react';
import { motion } from 'framer-motion';
import { Sparkles } from "lucide-react";
import { formatCurrency } from '@/lib/utils';

const WinDisplay = ({ winAmount, bet }) => {
  if (!winAmount) return null;

  return (
    <motion.div 
      className="mt-4 text-center"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <div className="text-3xl text-yellow-400">
        You won {formatCurrency(winAmount)}!
      </div>
      <div className="mt-2">
        <Sparkles className="inline-block mr-2 h-6 w-6 text-yellow-400" />
        <span className="text-xl text-green-400">
          {winAmount >= bet * 10 ? 'Big Win!' : winAmount >= bet * 5 ? 'Great Win!' : 'Nice Win!'}
        </span>
        <Sparkles className="inline-block ml-2 h-6 w-6 text-yellow-400" />
      </div>
    </motion.div>
  );
};

export default WinDisplay;
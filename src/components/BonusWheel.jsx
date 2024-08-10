import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

const BonusWheel = ({ isOpen, onClose, onResult }) => {
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState(null);

  const prizes = [100, 200, 300, 500, 1000, 2000, 5000, 10000];

  const spinWheel = () => {
    setSpinning(true);
    setTimeout(() => {
      const randomPrize = prizes[Math.floor(Math.random() * prizes.length)];
      setResult(randomPrize);
      setSpinning(false);
    }, 3000);
  };

  useEffect(() => {
    if (result !== null) {
      setTimeout(() => {
        onResult(result);
        setResult(null);
      }, 2000);
    }
  }, [result, onResult]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-gray-900 text-white">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">Matrix Bonus Wheel</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center">
          <motion.div
            className="w-64 h-64 rounded-full border-4 border-green-400 flex items-center justify-center mb-4 relative overflow-hidden"
            style={{
              background: 'conic-gradient(from 0deg, #00ff00, #003300, #00ff00, #003300, #00ff00, #003300, #00ff00, #003300)',
            }}
          >
            {spinning ? (
              <motion.div
                className="absolute inset-0"
                animate={{ rotate: 360 }}
                transition={{ duration: 3, ease: "easeInOut" }}
              >
                {prizes.map((prize, index) => (
                  <div
                    key={index}
                    className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2"
                    style={{ transform: `rotate(${index * (360 / prizes.length)}deg) translateY(-120px)` }}
                  >
                    <div className="text-sm font-bold">${prize}</div>
                  </div>
                ))}
              </motion.div>
            ) : result ? (
              <div className="text-4xl font-bold text-green-400">${result}</div>
            ) : (
              <div className="text-2xl font-bold text-green-400">Spin to Win!</div>
            )}
          </motion.div>
          <Button
            onClick={spinWheel}
            disabled={spinning || result !== null}
            className="bg-green-400 text-black hover:bg-green-500 font-bold px-8 py-2"
          >
            {spinning ? 'Decrypting...' : 'Hack the Matrix'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default BonusWheel;

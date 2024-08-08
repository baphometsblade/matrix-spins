import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const BonusWheel = ({ isOpen, onClose, onResult }) => {
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState(null);

  const prizes = [100, 200, 300, 500, 1000, 2000];

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
          <DialogTitle className="text-2xl font-bold">Bonus Wheel</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center">
          <div className="w-64 h-64 rounded-full border-4 border-yellow-400 flex items-center justify-center mb-4">
            {spinning ? (
              <div className="text-4xl animate-spin">🎡</div>
            ) : result ? (
              <div className="text-4xl">${result}</div>
            ) : (
              <div className="text-2xl">Spin to Win!</div>
            )}
          </div>
          <Button
            onClick={spinWheel}
            disabled={spinning || result !== null}
            className="bg-yellow-400 text-black hover:bg-yellow-500"
          >
            {spinning ? 'Spinning...' : 'Spin'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default BonusWheel;

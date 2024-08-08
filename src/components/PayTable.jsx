import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const PayTable = () => {
  const [isOpen, setIsOpen] = useState(false);

  const payTableData = [
    { symbol: '🌟', name: 'Star', payout: '100x' },
    { symbol: '🎰', name: 'Slot Machine', payout: '50x' },
    { symbol: '🃏', name: 'Joker', payout: '25x' },
    { symbol: '💎', name: 'Diamond', payout: '15x' },
    { symbol: '7️⃣', name: 'Seven', payout: '10x' },
    { symbol: '🍉', name: 'Watermelon', payout: '5x' },
    { symbol: '🍊', name: 'Orange', payout: '4x' },
    { symbol: '🍇', name: 'Grapes', payout: '3x' },
    { symbol: '🍋', name: 'Lemon', payout: '2x' },
    { symbol: '🍒', name: 'Cherry', payout: '1x' },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="bg-purple-600 text-white hover:bg-purple-700">
          Pay Table
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-gray-900 text-white">
        <DialogHeader>
          <DialogTitle className="text-2xl mb-4">Pay Table</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-4">
          {payTableData.map((item, index) => (
            <div key={index} className="flex items-center space-x-2">
              <span className="text-2xl">{item.symbol}</span>
              <div>
                <p className="font-bold">{item.name}</p>
                <p>{item.payout}</p>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PayTable;

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CreditCard } from "lucide-react";

const DepositDialog = ({ onDeposit }) => {
  const [amount, setAmount] = useState('');

  const handleDeposit = () => {
    const depositAmount = parseFloat(amount);
    if (depositAmount > 0) {
      onDeposit(depositAmount);
      setAmount('');
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="bg-green-500 hover:bg-green-600">
          <CreditCard className="mr-2 h-5 w-5" />
          Deposit
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-gray-900 text-white">
        <DialogHeader>
          <DialogTitle>Make a Deposit</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="deposit-amount">Amount</Label>
            <Input
              id="deposit-amount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="bg-gray-800 text-white"
              placeholder="Enter deposit amount"
            />
          </div>
          <Button onClick={handleDeposit} className="w-full bg-green-500 hover:bg-green-600">
            Confirm Deposit
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default DepositDialog;

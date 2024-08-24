import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Trophy, Star, Gift } from "lucide-react";

const LoyaltyProgramPopup = ({ isOpen, onClose, loyaltyPoints, currentTier, nextTier, tierProgress }) => {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-gradient-to-br from-purple-600 to-indigo-600 text-white">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold flex items-center">
            <Trophy className="mr-2 h-6 w-6 text-yellow-400" />
            Loyalty Program
          </DialogTitle>
        </DialogHeader>
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-lg">Current Tier:</span>
            <span className="text-xl font-bold">{currentTier}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-lg">Loyalty Points:</span>
            <span className="text-xl font-bold">{loyaltyPoints}</span>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span>Progress to {nextTier}:</span>
              <span>{tierProgress}%</span>
            </div>
            <Progress value={tierProgress} className="w-full" />
          </div>
          <div className="space-y-2">
            <h3 className="text-lg font-semibold">Tier Benefits:</h3>
            <ul className="list-disc list-inside">
              <li>Exclusive monthly bonuses</li>
              <li>Higher withdrawal limits</li>
              <li>Personal account manager</li>
              <li>Invitations to VIP events</li>
            </ul>
          </div>
          <Button className="w-full bg-yellow-400 text-black hover:bg-yellow-500">
            <Gift className="mr-2 h-5 w-5" />
            Claim Tier Rewards
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default LoyaltyProgramPopup;
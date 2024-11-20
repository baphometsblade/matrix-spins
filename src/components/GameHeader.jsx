import React from 'react';
import { Button } from "@/components/ui/button";
import { Home, Menu, HelpCircle } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

const GameHeader = () => {
  const { toast } = useToast();

  const handleHelp = () => {
    toast({
      title: "Help & Rules",
      description: "Match symbols across paylines to win. Get 3 or more scatter symbols for free spins!",
    });
  };

  return (
    <div className="absolute top-0 left-0 right-0 h-20 bg-gradient-to-r from-purple-600 via-blue-600 to-green-600 flex items-center justify-between px-6 shadow-lg z-10">
      <Button variant="ghost" className="text-white hover:bg-white/20">
        <Home className="h-6 w-6" />
      </Button>
      <div className="flex flex-col items-center">
        <h1 className="text-3xl font-bold text-white tracking-wider">Matrix Slots</h1>
        <div className="text-green-300 text-sm">Extravaganza</div>
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" className="text-white hover:bg-white/20" onClick={handleHelp}>
          <HelpCircle className="h-6 w-6" />
        </Button>
        <Button variant="ghost" className="text-white hover:bg-white/20">
          <Menu className="h-6 w-6" />
        </Button>
      </div>
    </div>
  );
};

export default GameHeader;
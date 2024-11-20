import React from 'react';
import { Button } from "@/components/ui/button";
import { Home, Menu } from "lucide-react";

const GameHeader = () => {
  return (
    <div className="absolute top-0 left-0 right-0 h-16 bg-gradient-to-r from-green-600 to-blue-600 flex items-center justify-between px-4">
      <Button variant="ghost" className="text-white">
        <Home className="h-6 w-6" />
      </Button>
      <h1 className="text-2xl font-bold text-white">Matrix Slots Extravaganza</h1>
      <Button variant="ghost" className="text-white">
        <Menu className="h-6 w-6" />
      </Button>
    </div>
  );
};

export default GameHeader;
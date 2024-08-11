import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trophy, Clock, Users, Zap } from "lucide-react";
import { formatCurrency } from '@/lib/utils';

const Tournaments = () => {
  const tournaments = [
    {
      name: "Matrix Mayhem",
      prize: 10000,
      entryFee: 50,
      players: 128,
      timeLeft: "2d 5h",
      game: "Matrix Reloaded",
    },
    {
      name: "Cyber Showdown",
      prize: 5000,
      entryFee: 25,
      players: 64,
      timeLeft: "1d 12h",
      game: "Cybernetic Spin",
    },
    {
      name: "Quantum Quest",
      prize: 15000,
      entryFee: 100,
      players: 256,
      timeLeft: "3d 8h",
      game: "Quantum Quandary",
    },
  ];

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-4xl font-bold text-white mb-8 text-center">Active Tournaments</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {tournaments.map((tournament, index) => (
          <Card key={index} className="bg-gradient-to-br from-purple-600 to-indigo-600 text-white">
            <CardHeader>
              <CardTitle className="flex items-center text-2xl">
                <Trophy className="mr-2 h-6 w-6 text-yellow-400" />
                {tournament.name}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 mb-4">
                <p className="flex items-center">
                  <Zap className="mr-2 h-5 w-5 text-yellow-400" />
                  Prize Pool: {formatCurrency(tournament.prize)}
                </p>
                <p className="flex items-center">
                  <Users className="mr-2 h-5 w-5 text-blue-400" />
                  Players: {tournament.players}
                </p>
                <p className="flex items-center">
                  <Clock className="mr-2 h-5 w-5 text-green-400" />
                  Time Left: {tournament.timeLeft}
                </p>
                <p>Game: {tournament.game}</p>
              </div>
              <Button className="w-full bg-green-500 hover:bg-green-600">
                Enter Tournament (Fee: {formatCurrency(tournament.entryFee)})
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default Tournaments;

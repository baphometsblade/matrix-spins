import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Trophy, Star, Zap, Coin, Clock } from "lucide-react";
import { formatCurrency } from '@/lib/utils';

const Profile = () => {
  const [username, setUsername] = useState('MatrixPlayer1');
  const [email, setEmail] = useState('player1@matrix.com');
  
  // Mock data for player statistics and achievements
  const playerStats = {
    totalWins: 1500,
    biggestWin: 5000,
    totalSpins: 10000,
    favoriteGame: "Matrix Reloaded",
    loyaltyPoints: 2500,
    currentTier: "Gold",
    nextTier: "Platinum",
    tierProgress: 65,
  };

  const achievements = [
    { name: "Matrix Master", description: "Win 1000 times", completed: true },
    { name: "Big Spender", description: "Bet 1,000,000 credits", completed: false },
    { name: "Lucky Streak", description: "Win 10 times in a row", completed: true },
    { name: "Jackpot Hunter", description: "Hit the progressive jackpot", completed: false },
    { name: "Big Winner", description: "Win 1000 or more in a single spin", completed: true },
    { name: "Daily Challenger", description: "Complete 10 daily challenges", completed: false },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-r from-purple-900 to-indigo-900 p-8">
      <h1 className="text-4xl font-bold text-white mb-8 text-center">Player Profile</h1>
      <div className="max-w-4xl mx-auto">
        <Tabs defaultValue="info" className="mb-8">
          <TabsList className="bg-black/50 p-1 rounded-lg">
            <TabsTrigger value="info" className="text-white">Personal Info</TabsTrigger>
            <TabsTrigger value="stats" className="text-white">Statistics</TabsTrigger>
            <TabsTrigger value="achievements" className="text-white">Achievements</TabsTrigger>
          </TabsList>
          <TabsContent value="info">
            <Card className="bg-black/50 text-white">
              <CardHeader>
                <CardTitle>Your Information</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <label htmlFor="username" className="block mb-1">Username</label>
                    <Input
                      id="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="w-full bg-gray-800 text-white"
                    />
                  </div>
                  <div>
                    <label htmlFor="email" className="block mb-1">Email</label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-gray-800 text-white"
                    />
                  </div>
                  <Button className="w-full bg-gradient-to-r from-green-400 to-blue-500 hover:from-green-500 hover:to-blue-600">
                    Update Profile
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="stats">
            <Card className="bg-black/50 text-white">
              <CardHeader>
                <CardTitle>Player Statistics</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center">
                    <Trophy className="mr-2 h-5 w-5 text-yellow-400" />
                    <span>Total Wins: {formatCurrency(playerStats.totalWins)}</span>
                  </div>
                  <div className="flex items-center">
                    <Star className="mr-2 h-5 w-5 text-yellow-400" />
                    <span>Biggest Win: {formatCurrency(playerStats.biggestWin)}</span>
                  </div>
                  <div className="flex items-center">
                    <Zap className="mr-2 h-5 w-5 text-blue-400" />
                    <span>Total Spins: {playerStats.totalSpins}</span>
                  </div>
                  <div className="flex items-center">
                    <CoinIcon className="mr-2 h-5 w-5 text-green-400" />
                    <span>Favorite Game: {playerStats.favoriteGame}</span>
                  </div>
                </div>
                <div className="mt-6">
                  <h3 className="text-lg font-semibold mb-2">Loyalty Program</h3>
                  <div className="flex items-center justify-between mb-2">
                    <span>Current Tier: {playerStats.currentTier}</span>
                    <span>Next Tier: {playerStats.nextTier}</span>
                  </div>
                  <Progress value={playerStats.tierProgress} className="h-2" />
                  <p className="mt-2">Loyalty Points: {playerStats.loyaltyPoints}</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="achievements">
            <Card className="bg-black/50 text-white">
              <CardHeader>
                <CardTitle>Achievements</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {achievements.map((achievement, index) => (
                    <div key={index} className="flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold">{achievement.name}</h3>
                        <p className="text-sm text-gray-400">{achievement.description}</p>
                      </div>
                      <Badge variant={achievement.completed ? "success" : "secondary"}>
                        {achievement.completed ? "Completed" : "In Progress"}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Profile;

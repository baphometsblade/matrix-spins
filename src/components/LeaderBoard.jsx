import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trophy } from "lucide-react";

const LeaderBoard = () => {
  const [leaderboard, setLeaderboard] = useState([]);

  useEffect(() => {
    // Simulating API call to fetch leaderboard data
    const fetchLeaderboard = async () => {
      // In a real application, this would be an API call
      const mockData = [
        { rank: 1, username: "MatrixMaster", score: 10000 },
        { rank: 2, username: "SlotKing", score: 9500 },
        { rank: 3, username: "LuckySpinner", score: 9000 },
        { rank: 4, username: "JackpotHunter", score: 8500 },
        { rank: 5, username: "ReelChamp", score: 8000 },
      ];
      setLeaderboard(mockData);
    };

    fetchLeaderboard();
  }, []);

  return (
    <Card className="mb-8 bg-black/50 text-white">
      <CardHeader>
        <CardTitle className="flex items-center text-2xl">
          <Trophy className="mr-2 h-6 w-6 text-yellow-400" />
          Top Players
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-white">Rank</TableHead>
              <TableHead className="text-white">Player</TableHead>
              <TableHead className="text-white text-right">Score</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leaderboard.map((player) => (
              <TableRow key={player.rank}>
                <TableCell className="font-medium">{player.rank}</TableCell>
                <TableCell>{player.username}</TableCell>
                <TableCell className="text-right">{player.score.toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};

export default LeaderBoard;

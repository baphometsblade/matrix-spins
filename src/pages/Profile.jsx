import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const Profile = () => {
  const [username, setUsername] = useState('MatrixPlayer1');
  const [email, setEmail] = useState('player1@matrix.com');

  return (
    <div className="min-h-screen bg-gradient-to-r from-purple-900 to-indigo-900 p-8">
      <h1 className="text-4xl font-bold text-white mb-8 text-center">Player Profile</h1>
      <Card className="max-w-md mx-auto bg-black/50 text-white">
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
    </div>
  );
};

export default Profile;

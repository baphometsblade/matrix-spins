import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const Promotions = () => {
  return (
    <div className="min-h-screen bg-gradient-to-r from-purple-900 to-indigo-900 p-8">
      <h1 className="text-4xl font-bold text-white mb-8 text-center">Promotions</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        <Card className="bg-black/50 text-white">
          <CardHeader>
            <CardTitle>Welcome Bonus</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4">Get 100% bonus up to $500 on your first deposit!</p>
            <Button className="w-full bg-gradient-to-r from-green-400 to-blue-500 hover:from-green-500 hover:to-blue-600">
              Claim Now
            </Button>
          </CardContent>
        </Card>
        <Card className="bg-black/50 text-white">
          <CardHeader>
            <CardTitle>Free Spins Friday</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4">Get 50 free spins every Friday when you deposit $50 or more!</p>
            <Button className="w-full bg-gradient-to-r from-green-400 to-blue-500 hover:from-green-500 hover:to-blue-600">
              Claim Now
            </Button>
          </CardContent>
        </Card>
        <Card className="bg-black/50 text-white">
          <CardHeader>
            <CardTitle>Refer a Friend</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4">Get $50 bonus for each friend you refer who makes a deposit!</p>
            <Button className="w-full bg-gradient-to-r from-green-400 to-blue-500 hover:from-green-500 hover:to-blue-600">
              Refer Now
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Promotions;

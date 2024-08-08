import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { HelpCircle } from "lucide-react";

const HelpDialog = () => {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-12">
          <HelpCircle className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-gray-900 text-white">
        <DialogHeader>
          <DialogTitle>How to Play</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Game Rules</h3>
          <ul className="list-disc pl-5 space-y-2">
            <li>Set your bet amount and number of paylines.</li>
            <li>Click the Spin button to start the game.</li>
            <li>Match symbols across paylines to win.</li>
            <li>Special symbols can trigger bonus features.</li>
            <li>The Jackpot is won by getting 5 Star symbols on a payline.</li>
          </ul>
          <h3 className="text-lg font-semibold">Bonus Features</h3>
          <ul className="list-disc pl-5 space-y-2">
            <li>Free Spins: Get 3 or more Scatter symbols to trigger free spins.</li>
            <li>Multiplier: Increase your potential winnings with the multiplier feature.</li>
            <li>Bonus Wheel: Fill the bonus progress bar to spin the Bonus Wheel for extra prizes.</li>
          </ul>
          <p>Good luck and enjoy playing Matrix Slots Extravaganza!</p>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default HelpDialog;

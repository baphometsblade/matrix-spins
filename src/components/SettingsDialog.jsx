import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

const SettingsDialog = ({
  open,
  onOpenChange,
  sound,
  setSound,
  autoPlay,
  setAutoPlay,
  showMatrixRain,
  setShowMatrixRain,
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-gray-900 text-white">
        <DialogHeader>
          <DialogTitle className="text-2xl">Game Settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="sound-toggle" className="text-base">Sound Effects</Label>
              <p className="text-xs text-gray-400">Toggle spin and win audio cues.</p>
            </div>
            <Switch
              id="sound-toggle"
              checked={sound}
              onCheckedChange={setSound}
            />
          </div>
          <Separator className="bg-gray-700" />
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="autoplay-toggle" className="text-base">Auto Play</Label>
              <p className="text-xs text-gray-400">Keep spinning with your current bet.</p>
            </div>
            <Switch
              id="autoplay-toggle"
              checked={autoPlay}
              onCheckedChange={setAutoPlay}
            />
          </div>
          <Separator className="bg-gray-700" />
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="matrix-toggle" className="text-base">Matrix Rain</Label>
              <p className="text-xs text-gray-400">Enable the animated background effect.</p>
            </div>
            <Switch
              id="matrix-toggle"
              checked={showMatrixRain}
              onCheckedChange={setShowMatrixRain}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SettingsDialog;

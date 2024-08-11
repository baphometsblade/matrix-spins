import React from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const SpecialEventBanner = ({ event }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: -50 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <Card className="mb-8 bg-gradient-to-r from-red-500 to-green-500 text-white overflow-hidden">
        <CardContent className="p-6 flex items-center justify-between">
          <div className="flex items-center">
            {event.icon}
            <div className="ml-4">
              <h3 className="text-2xl font-bold">{event.name}</h3>
              <p className="text-lg">{event.description}</p>
            </div>
          </div>
          <Button className="bg-white text-black hover:bg-gray-200">
            Claim Now
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
};

export default SpecialEventBanner;

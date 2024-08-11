import React, { useState, useEffect } from 'react';
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { navItems } from "./nav-items";
import Header from "./components/Header";
import Footer from "./components/Footer";
import { Loader2 } from "lucide-react";
import { slotAssets, gameBackgrounds } from './lib/utils';

const App = () => {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadAssets = async () => {
      await Promise.all([
        ...Object.values(slotAssets).flat().map(asset => new Promise(resolve => {
          const img = new Image();
          img.onload = resolve;
          img.src = asset.image;
        })),
        ...gameBackgrounds.map(bg => new Promise(resolve => {
          const img = new Image();
          img.onload = resolve;
          img.src = bg.image;
        }))
      ]);
      setLoading(false);
    };

    loadAssets();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-r from-purple-900 to-indigo-900">
        <Loader2 className="h-16 w-16 text-white animate-spin" />
      </div>
    );
  }

  return (
    <TooltipProvider>
      <Toaster />
      <BrowserRouter>
        <div className="flex flex-col min-h-screen bg-gradient-to-r from-purple-900 to-indigo-900">
          <Header />
          <main className="flex-grow">
            <Routes>
              {navItems.map(({ to, page }) => (
                <Route key={to} path={to} element={page} />
              ))}
            </Routes>
          </main>
          <Footer />
        </div>
      </BrowserRouter>
    </TooltipProvider>
  );
};

export default App;

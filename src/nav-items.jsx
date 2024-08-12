import React from 'react';
import { Home, Gift, User, Trophy } from "lucide-react";
import Promotions from "./pages/Promotions";
import Profile from "./pages/Profile";
import Tournaments from "./pages/Tournaments";

export const navItems = [
  {
    title: "Home",
    to: "/",
    icon: <Home className="h-4 w-4" />,
  },
  {
    title: "Promotions",
    to: "/promotions",
    icon: <Gift className="h-4 w-4" />,
    page: <Promotions />,
  },
  {
    title: "Profile",
    to: "/profile",
    icon: <User className="h-4 w-4" />,
    page: <Profile />,
  },
  {
    title: "Tournaments",
    to: "/tournaments",
    icon: <Trophy className="h-4 w-4" />,
    page: <Tournaments />,
  },
];

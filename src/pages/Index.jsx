import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import Game from './Game';
import { useAuth } from '../contexts/AuthContext';

const Index = () => {
  const { isAuthenticated } = useAuth();

  return (
    <div>
      {isAuthenticated ? (
        <Game />
      ) : (
        <div className="container mx-auto px-4 py-8 text-center text-white">
          <h1 className="text-4xl font-bold mb-4">Welcome to Matrix Slots</h1>
          <p className="text-lg mb-8">
            Please log in or register to start playing.
          </p>
          <div className="space-x-4">
            <Button asChild>
              <Link to="/login">Login</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/register">Register</Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Index;
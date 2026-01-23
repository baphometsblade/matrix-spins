import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { navItems } from "../nav-items";
import { useState, useEffect } from "react";

const Header = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem("token");
    setIsAuthenticated(!!token);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("token");
    setIsAuthenticated(false);
    navigate("/login");
  };

  return (
    <header className="bg-black/80 text-white p-4">
      <div className="container mx-auto flex justify-between items-center">
        <Link to="/" className="text-2xl font-bold">Matrix Slots</Link>
        <nav>
          <ul className="flex space-x-4">
            {navItems.map(({ title, to }) => (
              <li key={to}>
                <Link to={to} className="hover:text-green-400 transition-colors">{title}</Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex space-x-2">
          {isAuthenticated ? (
            <Button onClick={handleLogout} variant="outline" className="text-white border-white hover:bg-white hover:text-black">
              Logout
            </Button>
          ) : (
            <>
              <Button asChild variant="outline" className="text-white border-white hover:bg-white hover:text-black">
                <Link to="/login">Login</Link>
              </Button>
              <Button asChild className="bg-green-500 hover:bg-green-600 text-black">
                <Link to="/register">Sign Up</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;

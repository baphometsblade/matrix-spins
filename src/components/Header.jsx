import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { navItems } from "../nav-items";

const Header = () => (
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
        <Button variant="outline" className="text-white border-white hover:bg-white hover:text-black">
          Login
        </Button>
        <Button className="bg-green-500 hover:bg-green-600 text-black">Sign Up</Button>
      </div>
    </div>
  </header>
);

export default Header;

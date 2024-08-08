import { Link } from "react-router-dom";
import { Facebook, Twitter, Instagram } from "lucide-react";

const Footer = () => (
  <footer className="bg-black/80 text-white p-8">
    <div className="container mx-auto grid grid-cols-1 md:grid-cols-4 gap-8">
      <div>
        <h3 className="text-lg font-bold mb-4">About Us</h3>
        <p>Matrix Slots is your premier destination for online casino entertainment.</p>
      </div>
      <div>
        <h3 className="text-lg font-bold mb-4">Quick Links</h3>
        <ul className="space-y-2">
          <li><Link to="/terms" className="hover:text-green-400">Terms & Conditions</Link></li>
          <li><Link to="/privacy" className="hover:text-green-400">Privacy Policy</Link></li>
          <li><Link to="/responsible-gaming" className="hover:text-green-400">Responsible Gaming</Link></li>
        </ul>
      </div>
      <div>
        <h3 className="text-lg font-bold mb-4">Contact Us</h3>
        <p>Email: support@matrixslots.com</p>
        <p>Phone: +1 (888) 123-4567</p>
      </div>
      <div>
        <h3 className="text-lg font-bold mb-4">Follow Us</h3>
        <div className="flex space-x-4">
          <a href="#" className="hover:text-green-400"><Facebook /></a>
          <a href="#" className="hover:text-green-400"><Twitter /></a>
          <a href="#" className="hover:text-green-400"><Instagram /></a>
        </div>
      </div>
    </div>
    <div className="mt-8 text-center">
      <p>&copy; 2023 Matrix Slots. All rights reserved.</p>
    </div>
  </footer>
);

export default Footer;

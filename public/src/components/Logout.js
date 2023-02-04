import React from "react";
import { useNavigate } from "react-router-dom";
import { BiPowerOff } from "react-icons/bi";
import axios from "axios";
import "./Logout.css"
function Logout() {
  const navigate = useNavigate();
  const handleClick = async () => {
    localStorage.clear();
    navigate("/login");
  };
  return (
    <div className="button">
      <button onClick={handleClick}>
        <BiPowerOff />
      </button>
    </div>
  );
}

export default Logout;

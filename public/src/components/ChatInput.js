import React, { useState } from "react";
import { BsEmojiSmileFill } from "react-icons/bs";
import { IoMdSend } from "react-icons/io";
import styled from "styled-components";
import Picker from "emoji-picker-react";
import "./ChatInput.css"
function ChatInput({ handleSendMsg }) {
    const [msg, setMsg] = useState("");
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const handleEmojiPickerhideShow = () => {
      setShowEmojiPicker(!showEmojiPicker);
    };
  
    const handleEmojiClick = (event, emoji) => {
      console.log(emoji);
      let message = msg;
      message += emoji.emoji;
      setMsg(message);
    };
  
    const sendChat = (event) => {
      event.preventDefault();
      if (msg.length > 0) {
        handleSendMsg(msg);
        setMsg("");
      }
    };
  return (
    <>
    <div className="Containerrr">
      <div className="button-container">
        <div className="emoji">
          <BsEmojiSmileFill onClick={handleEmojiPickerhideShow}/>
          {showEmojiPicker && <Picker onEmojiClick={(emojiObject)=> setMsg((prevMsg)=> prevMsg + emojiObject.emoji)}/>}
        </div>
      </div>
      <form className="input-container" onSubmit={(e)=> sendChat(e)}>
        <input
          type="text"
          placeholder="type your message here"
          onChange={(e) => setMsg(e.target.value)}
          value={msg}
        />
        <button type="submit">
          <IoMdSend />
        </button>
      </form>
    </div>
    </>
  );
}

export default ChatInput
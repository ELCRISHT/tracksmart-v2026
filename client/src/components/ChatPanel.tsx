import React, { useEffect, useRef, useState } from 'react';
import { socket } from '../lib/socket';
import { Send, MessageSquare } from 'lucide-react';

interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  role: 'host' | 'participant';
  text: string;
  timestamp: number;
}

interface ChatPanelProps {
  myIdentity: string | null;
  sessionId: string | undefined;
  role: string; // 'host' or 'participant'
  messages: ChatMessage[]; // Lifted to Session.tsx — survives tab switches
}

const ChatPanel: React.FC<ChatPanelProps> = ({ myIdentity, sessionId, role, messages }) => {
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom whenever messages change or on first mount
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const sendMessage = () => {
    const text = inputText.trim();
    if (!text) return;

    setSending(true);
    // Include sessionId in payload as a fallback for the server in case
    // socket.data gets cleared (React StrictMode reconnect / edge cases).
    socket.emit('ts:chat_message', { text, sessionId });
    setInputText('');
    setSending(false);

    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const isTeacher = role === 'host';

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 shrink-0">
        <MessageSquare className="w-4 h-4 text-track-teal" />
        <h3 className="font-bold text-slate-700 dark:text-slate-200 text-sm">Class Chat</h3>
        {messages.length > 0 && (
          <span className="ml-auto text-[10px] text-slate-400 font-medium">{messages.length} messages</span>
        )}
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4 py-10 opacity-50">
            <MessageSquare className="w-8 h-8 text-slate-400 dark:text-slate-600 mb-3" />
            <p className="text-xs text-slate-400 dark:text-slate-500 font-medium leading-relaxed">
              No messages yet. Say something to the class!
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMine = msg.senderId === myIdentity;
            const isTeacherMsg = msg.role === 'host';

            return (
              <div
                key={msg.id}
                className={`flex flex-col gap-1 ${isMine ? 'items-end' : 'items-start'}`}
              >
                {/* Sender label — only shown for messages from others */}
                {!isMine && (
                  <div className="flex items-center gap-1.5 px-1">
                    <span className={`text-[10px] font-black uppercase tracking-wider ${isTeacherMsg ? 'text-track-teal' : 'text-slate-400 dark:text-slate-500'}`}>
                      {isTeacherMsg ? '👨‍🏫 ' : ''}{msg.senderName}
                    </span>
                    {isTeacherMsg && (
                      <span className="text-[8px] bg-track-teal/20 text-track-teal font-black px-1.5 py-0.5 rounded-full uppercase tracking-widest">
                        Teacher
                      </span>
                    )}
                  </div>
                )}

                {/* Bubble */}
                <div
                  className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-relaxed wrap-break-word shadow-sm ${
                    isMine
                      ? 'bg-track-teal text-slate-900 rounded-tr-sm font-medium'
                      : isTeacherMsg
                      ? 'bg-track-navy dark:bg-slate-800 text-white rounded-tl-sm border border-track-teal/20'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-tl-sm'
                  }`}
                >
                  {msg.text}
                </div>

                {/* Timestamp */}
                <span className="text-[10px] text-slate-400 dark:text-slate-600 px-1">
                  {isMine ? 'You · ' : ''}{formatTime(msg.timestamp)}
                </span>
              </div>
            );
          })
        )}
        {/* Auto-scroll anchor */}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="p-3 border-t border-slate-200 dark:border-slate-800 shrink-0">
        <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 px-3 py-2 focus-within:border-track-teal focus-within:ring-1 focus-within:ring-track-teal/30 transition-all">
          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isTeacher ? 'Message the class...' : 'Message the teacher...'}
            className="flex-1 bg-transparent text-sm text-slate-800 dark:text-slate-200 placeholder:text-slate-400 outline-none font-medium"
            maxLength={500}
          />
          <button
            onClick={sendMessage}
            disabled={!inputText.trim() || sending}
            className="p-1.5 rounded-xl bg-track-teal hover:bg-teal-400 text-slate-900 transition-all disabled:opacity-30 disabled:pointer-events-none active:scale-95 shrink-0"
            title="Send message (Enter)"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="text-[9px] text-slate-400 dark:text-slate-600 mt-1.5 text-center font-medium">
          Press <kbd className="bg-slate-200 dark:bg-slate-700 px-1 rounded text-[9px]">Enter</kbd> to send
        </p>
      </div>
    </div>
  );
};

export default ChatPanel;

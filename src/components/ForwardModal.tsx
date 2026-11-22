import React, { useState } from 'react';
import { Forward, Search, Send, X } from 'lucide-react';
import type { ChatMessage, ConversationSummary } from '../types.ts';
import { Avatar } from './Avatar.tsx';

interface ForwardModalProps {
  message: ChatMessage;
  conversations: ConversationSummary[];
  onClose: () => void;
  onForward: (targetConversationId: string, message: ChatMessage) => Promise<void>;
}

export const ForwardModal: React.FC<ForwardModalProps> = ({
  message,
  conversations,
  onClose,
  onForward,
}) => {
  const [q, setQ] = useState('');
  const [sendingId, setSendingId] = useState<string | null>(null);

  const filtered = conversations.filter((c) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return c.title.toLowerCase().includes(s) || c.subtitle.toLowerCase().includes(s);
  });

  const handleSelect = async (convId: string) => {
    setSendingId(convId);
    try {
      await onForward(convId, message);
      onClose();
    } finally {
      setSendingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-[#202C33] border border-[#D1D7DB] dark:border-[#2A3942] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
        <div className="px-5 py-4 border-b border-[#E9EDEF] dark:border-[#2A3942] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Forward className="w-5 h-5 text-[#00A884]" />
            <h3 className="font-display text-base font-semibold text-[#111B21] dark:text-[#E9EDEF]">
              Forward Message
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-[#F0F2F5] dark:hover:bg-[#2A3942]"
          >
            <X className="w-5 h-5 text-[#54656F] dark:text-[#8696A0]" />
          </button>
        </div>

        <div className="p-3 border-b border-[#E9EDEF] dark:border-[#2A3942]">
          <div className="relative flex items-center">
            <Search className="w-4 h-4 text-[#54656F] dark:text-[#8696A0] absolute left-3 pointer-events-none" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search chats or groups..."
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#F0F2F5] dark:bg-[#111B21] text-sm text-[#111B21] dark:text-[#E9EDEF] focus:outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-[#E9EDEF] dark:divide-[#2A3942]">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-xs text-[#54656F] dark:text-[#8696A0]">
              No matching conversations.
            </div>
          ) : (
            filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={sendingId === c.id}
                onClick={() => handleSelect(c.id)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-[#F0F2F5] dark:hover:bg-[#2A3942] transition-colors text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar src={c.avatarUrl} name={c.title} size="sm" isGroup={c.type === 'group'} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[#111B21] dark:text-[#E9EDEF] truncate">
                      {c.title}
                    </div>
                    <div className="text-xs text-[#54656F] dark:text-[#8696A0] truncate">
                      {c.subtitle}
                    </div>
                  </div>
                </div>
                <Send className="w-4 h-4 text-[#00A884] shrink-0" />
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

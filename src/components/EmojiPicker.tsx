import React, { useState } from 'react';

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

const EMOJI_CATEGORIES = [
  {
    label: 'Smileys',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇',
      '🙂', '😉', '😍', '🥰', '😘', '😋', '😜', '🤪', '🤨', '🧐',
      '🤓', '😎', '🥳', '😏', '😒', '😔', '😢', '😭', '😤', '🤯',
      '😳', '🥺', '🤔', '🤭', '🤫', '🤥', '😶', '😴', '🤒', '🤮',
    ],
  },
  {
    label: 'Gestures',
    emojis: [
      '👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '👏', '🙌', '👐',
      '🙏', '🤝', '💪', '👋', '🤚', '🖐️', '☝️', '👀', '🧠', '🫶',
    ],
  },
  {
    label: 'Hearts & Objects',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '💖',
      '🔥', '✨', '🎉', '🎊', '🏆', '💯', '✅', '⚡', '🚀', '☕',
    ],
  },
];

export const EmojiPicker: React.FC<{ onSelect: (emoji: string) => void }> = ({ onSelect }) => {
  const [activeCategory, setActiveCategory] = useState(0);

  return (
    <div className="w-64 bg-white dark:bg-[#233138] border border-[#D1D7DB] dark:border-[#2A3942] rounded-2xl shadow-xl overflow-hidden">
      <div className="flex border-b border-[#E9EDEF] dark:border-[#2A3942] bg-[#F7F8FA] dark:bg-[#182229]">
        {EMOJI_CATEGORIES.map((cat, idx) => (
          <button
            key={cat.label}
            type="button"
            onClick={() => setActiveCategory(idx)}
            className={`flex-1 py-2 text-[11px] font-semibold transition-colors ${
              activeCategory === idx
                ? 'text-[#00A884] border-b-2 border-[#00A884]'
                : 'text-[#54656F] dark:text-[#8696A0]'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>
      <div className="p-2.5 grid grid-cols-8 gap-1 max-h-48 overflow-y-auto">
        {EMOJI_CATEGORIES[activeCategory].emojis.map((em) => (
          <button
            key={em}
            type="button"
            onClick={() => onSelect(em)}
            className="w-7 h-7 rounded-lg hover:bg-[#F0F2F5] dark:hover:bg-[#2A3942] flex items-center justify-center text-lg transition-transform hover:scale-110"
          >
            {em}
          </button>
        ))}
      </div>
    </div>
  );
};

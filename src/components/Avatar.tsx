import React from 'react';
import { Users } from 'lucide-react';

interface AvatarProps {
  src?: string | null;
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  isGroup?: boolean;
  isOnline?: boolean;
}

const SIZE_MAP = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-11 h-11 text-sm',
  lg: 'w-14 h-14 text-base',
  xl: 'w-20 h-20 text-2xl',
};

const DOT_MAP = {
  xs: 'w-2 h-2',
  sm: 'w-2.5 h-2.5',
  md: 'w-3 h-3',
  lg: 'w-3.5 h-3.5',
  xl: 'w-4 h-4',
};

function getInitials(name: string): string {
  const parts = (name || '?').trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
  }
  return (name || '?').slice(0, 2).toUpperCase();
}

export const Avatar: React.FC<AvatarProps> = ({
  src,
  name,
  size = 'md',
  isGroup = false,
  isOnline = false,
}) => {
  return (
    <div className="relative inline-flex shrink-0">
      {src ? (
        <img
          src={src}
          alt={name}
          referrerPolicy="no-referrer"
          className={`${SIZE_MAP[size]} rounded-full object-cover bg-[#DFE5E7] dark:bg-[#2A3942]`}
        />
      ) : (
        <div
          className={`${SIZE_MAP[size]} rounded-full bg-[#00A884]/15 text-[#008F6F] dark:text-[#00A884] font-semibold flex items-center justify-center select-none`}
        >
          {isGroup ? <Users className="w-1/2 h-1/2" /> : getInitials(name)}
        </div>
      )}
      {isOnline && !isGroup && (
        <span
          className={`absolute bottom-0 right-0 ${DOT_MAP[size]} rounded-full bg-[#25D366] ring-2 ring-white dark:ring-[#111B21]`}
        />
      )}
    </div>
  );
};

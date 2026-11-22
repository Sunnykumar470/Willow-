import React, { useState } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ExternalLink,
  Hash,
  LogOut,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  SmilePlus,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  GOOGLE_CHAT_CONSOLE_URL,
  GoogleChatApiError,
  type GoogleChatMembership,
  type GoogleChatMessage,
  type GoogleChatSpace,
} from '../lib/googleChat.ts';
import { formatTime } from '../lib/format.ts';

export const GoogleSignInButton: React.FC<{
  onClick: () => void;
  disabled?: boolean;
}> = ({ onClick, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="w-full inline-flex items-center justify-center gap-3 px-4 py-2.5 rounded-full bg-white hover:bg-[#F8F9FA] active:bg-[#E8EAED] text-[#1F1F1F] border border-[#747775] font-medium text-sm shadow-xs transition-colors disabled:opacity-60 cursor-pointer"
  >
    <span className="w-5 h-5 shrink-0">
      <svg
        version="1.1"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 48 48"
        className="w-5 h-5 block"
      >
        <path
          fill="#EA4335"
          d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
        />
        <path
          fill="#4285F4"
          d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
        />
        <path
          fill="#FBBC05"
          d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
        />
        <path
          fill="#34A853"
          d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
        />
        <path fill="none" d="M0 0h48v48H0z" />
      </svg>
    </span>
    <span>{disabled ? 'Connecting to Google...' : 'Sign in with Google'}</span>
  </button>
);

export interface GoogleChatConfirmationRequest {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<void>;
}

export const ConfirmMutationModal: React.FC<{
  request: GoogleChatConfirmationRequest;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ request, busy, onCancel, onConfirm }) => (
  <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
    <div className="w-full max-w-sm bg-white dark:bg-[#202C33] border border-[#D1D7DB] dark:border-[#2A3942] rounded-2xl shadow-2xl p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div
          className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
            request.destructive
              ? 'bg-red-100 dark:bg-red-950/50 text-red-600 dark:text-red-400'
              : 'bg-[#00A884]/15 text-[#00A884]'
          }`}
        >
          <AlertTriangle className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h3 className="font-display text-sm font-bold text-[#111B21] dark:text-[#E9EDEF]">
            {request.title}
          </h3>
          <p className="mt-1 text-xs text-[#54656F] dark:text-[#8696A0] leading-relaxed break-words">
            {request.description}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="px-3.5 py-2 rounded-xl border border-[#D1D7DB] dark:border-[#2A3942] text-xs font-medium text-[#111B21] dark:text-[#E9EDEF] hover:bg-[#F0F2F5] dark:hover:bg-[#2A3942]"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className={`px-4 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-50 ${
            request.destructive
              ? 'bg-red-600 hover:bg-red-700'
              : 'bg-[#00A884] hover:bg-[#008F6F]'
          }`}
        >
          {busy ? 'Processing...' : request.confirmLabel}
        </button>
      </div>
    </div>
  </div>
);

function getSpaceDisplayTitle(space: GoogleChatSpace): string {
  if (space.displayName) return space.displayName;
  if (space.spaceType === 'DIRECT_MESSAGE' || space.type === 'DM') {
    return 'Direct Message';
  }
  return space.name.replace('spaces/', 'Space ');
}

function getSpaceKindLabel(space: GoogleChatSpace): string {
  const kind = space.spaceType || space.type || 'SPACE';
  if (kind === 'DIRECT_MESSAGE' || kind === 'DM') return 'Direct Message';
  if (kind === 'GROUP_CHAT') return 'Group Chat';
  return 'Space';
}

export const GoogleChatErrorBanner: React.FC<{
  error: unknown;
  onRetrySignIn?: () => void;
}> = ({ error, onRetrySignIn }) => {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  const isApiErr = error instanceof GoogleChatApiError;
  const isAppNotConfigured = isApiErr && error.isAppNotConfigured;
  const isAuthExpired = isApiErr && error.isAuthExpired;

  return (
    <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 text-xs space-y-2">
      <div className="font-semibold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span>
          {isAppNotConfigured
            ? 'Google Chat App Setup Required'
            : isAuthExpired
              ? 'Google Session Expired'
              : 'Google Chat Notice'}
        </span>
      </div>
      <p className="text-amber-800 dark:text-amber-300 leading-relaxed break-words">
        {msg}
      </p>
      {isAppNotConfigured && (
        <div className="space-y-1.5 pt-1">
          <p className="text-[11px] text-amber-800/90 dark:text-amber-300/90">
            Configure the Chat App name, avatar, and description in Google Cloud Console using a Google Workspace Business or Enterprise account.
          </p>
          <a
            href={GOOGLE_CHAT_CONSOLE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#00A884] text-white font-semibold hover:bg-[#008F6F]"
          >
            <span>Open Google Chat Configuration</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      )}
      {isAuthExpired && onRetrySignIn && (
        <button
          type="button"
          onClick={onRetrySignIn}
          className="px-3 py-1.5 rounded-lg bg-[#00A884] text-white font-semibold"
        >
          Reconnect Google Account
        </button>
      )}
    </div>
  );
};

interface GoogleChatSidebarProps {
  googleUser: FirebaseUser | null;
  needsAuth: boolean;
  signingIn: boolean;
  spaces: GoogleChatSpace[];
  selectedSpace: GoogleChatSpace | null;
  loadingSpaces: boolean;
  error: unknown;
  onSignIn: () => void;
  onSignOut: () => void;
  onRefreshSpaces: () => void;
  onSelectSpace: (space: GoogleChatSpace) => void;
  onCreateSpaceRequest: (displayName: string, spaceType: 'SPACE' | 'GROUP_CHAT') => void;
}

export const GoogleChatSidebar: React.FC<GoogleChatSidebarProps> = ({
  googleUser,
  needsAuth,
  signingIn,
  spaces,
  selectedSpace,
  loadingSpaces,
  error,
  onSignIn,
  onSignOut,
  onRefreshSpaces,
  onSelectSpace,
  onCreateSpaceRequest,
}) => {
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'SPACE' | 'GROUP_CHAT'>('SPACE');

  const filteredSpaces = spaces.filter((s) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      getSpaceDisplayTitle(s).toLowerCase().includes(q) ||
      s.name.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#111B21]">
      <div className="px-4 py-3.5 border-b border-[#E9EDEF] dark:border-[#222E35] space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-lg font-bold text-[#111B21] dark:text-[#E9EDEF]">
              Google Chat
            </h2>
            {googleUser?.email && !needsAuth && (
              <p className="text-[11px] text-[#54656F] dark:text-[#8696A0] truncate max-w-[200px]">
                {googleUser.email}
              </p>
            )}
          </div>
          {!needsAuth && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onRefreshSpaces}
                disabled={loadingSpaces}
                className="p-2 rounded-full hover:bg-[#F0F2F5] dark:hover:bg-[#202C33] text-[#54656F] dark:text-[#8696A0]"
                title="Refresh spaces"
              >
                <RefreshCw className={`w-4 h-4 ${loadingSpaces ? 'animate-spin' : ''}`} />
              </button>
              <button
                type="button"
                onClick={() => setCreating((v) => !v)}
                className="p-2 rounded-full hover:bg-[#F0F2F5] dark:hover:bg-[#202C33] text-[#00A884]"
                title="Create Google Chat space"
              >
                <Plus className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={onSignOut}
                className="p-2 rounded-full hover:bg-[#F0F2F5] dark:hover:bg-[#202C33] text-[#54656F] dark:text-[#8696A0]"
                title="Sign out of Google Chat"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {!needsAuth && (
          <div className="relative flex items-center">
            <Search className="w-4 h-4 text-[#54656F] dark:text-[#8696A0] absolute left-3 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter Google Chat spaces..."
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-sm text-[#111B21] dark:text-[#E9EDEF] placeholder-[#54656F] dark:placeholder-[#8696A0] focus:outline-none"
            />
          </div>
        )}
      </div>

      {needsAuth ? (
        <div className="flex-1 overflow-y-auto p-5 flex flex-col justify-center space-y-4">
          <div className="p-4 rounded-2xl bg-[#F7F8FA] dark:bg-[#202C33] border border-[#E9EDEF] dark:border-[#2A3942] space-y-3">
            <div className="w-10 h-10 rounded-xl bg-[#00A884]/15 text-[#00A884] flex items-center justify-center">
              <MessageSquare className="w-5 h-5" />
            </div>
            <h3 className="font-display text-sm font-bold text-[#111B21] dark:text-[#E9EDEF]">
              Connect Google Chat
            </h3>
            <p className="text-xs text-[#54656F] dark:text-[#8696A0] leading-relaxed">
              Sign in with a Google Workspace Business or Enterprise account to view your spaces, read messages, send replies, and react with emojis.
            </p>
            <GoogleSignInButton onClick={onSignIn} disabled={signingIn} />
          </div>
          {error ? <GoogleChatErrorBanner error={error} onRetrySignIn={onSignIn} /> : null}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {creating && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!newName.trim()) return;
                onCreateSpaceRequest(newName.trim(), newType);
                setNewName('');
                setCreating(false);
              }}
              className="p-3.5 border-b border-[#E9EDEF] dark:border-[#222E35] bg-[#F7F8FA] dark:bg-[#202C33] space-y-2.5"
            >
              <div className="flex items-center justify-between text-xs font-semibold text-[#111B21] dark:text-[#E9EDEF]">
                <span>New Google Chat Space</span>
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className="text-[#54656F] hover:text-[#111B21]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <input
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Space name..."
                className="w-full px-3 py-2 rounded-lg bg-white dark:bg-[#111B21] border border-[#D1D7DB] dark:border-[#2A3942] text-xs text-[#111B21] dark:text-[#E9EDEF] focus:outline-none"
              />
              <div className="flex items-center gap-2">
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as 'SPACE' | 'GROUP_CHAT')}
                  className="flex-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#111B21] border border-[#D1D7DB] dark:border-[#2A3942] text-xs text-[#111B21] dark:text-[#E9EDEF]"
                >
                  <option value="SPACE">Named Space</option>
                  <option value="GROUP_CHAT">Group Chat</option>
                </select>
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg bg-[#00A884] text-white text-xs font-semibold"
                >
                  Create
                </button>
              </div>
            </form>
          )}

          {error ? (
            <div className="p-3">
              <GoogleChatErrorBanner error={error} onRetrySignIn={onSignIn} />
            </div>
          ) : null}

          {loadingSpaces && spaces.length === 0 ? (
            <div className="p-6 text-center text-xs text-[#54656F] dark:text-[#8696A0]">
              Loading Google Chat spaces...
            </div>
          ) : filteredSpaces.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#54656F] dark:text-[#8696A0]">
              {spaces.length === 0
                ? 'No Google Chat spaces found for this account.'
                : 'No spaces matched your filter.'}
            </div>
          ) : (
            <div className="divide-y divide-[#E9EDEF]/60 dark:divide-[#222E35]/60">
              {filteredSpaces.map((space) => {
                const isActive = selectedSpace?.name === space.name;
                return (
                  <button
                    key={space.name}
                    type="button"
                    onClick={() => onSelectSpace(space)}
                    className={`w-full px-3.5 py-3 flex items-center gap-3 text-left transition-colors ${
                      isActive
                        ? 'bg-[#F0F2F5] dark:bg-[#2A3942]'
                        : 'hover:bg-[#F5F6F6] dark:hover:bg-[#202C33]'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-full bg-[#00A884]/15 text-[#00A884] flex items-center justify-center shrink-0">
                      <Hash className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-[#111B21] dark:text-[#E9EDEF] truncate">
                        {getSpaceDisplayTitle(space)}
                      </div>
                      <div className="text-xs text-[#54656F] dark:text-[#8696A0] truncate">
                        {getSpaceKindLabel(space)}
                        {space.membershipCount?.joinedDirectHumanUserCount
                          ? ` · ${space.membershipCount.joinedDirectHumanUserCount} members`
                          : ''}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface GoogleChatConversationProps {
  space: GoogleChatSpace;
  messages: GoogleChatMessage[];
  members: GoogleChatMembership[];
  loadingMessages: boolean;
  error: unknown;
  onBack: () => void;
  onRefresh: () => void;
  onRequestSendMessage: (text: string) => void;
  onRequestEditMessage: (message: GoogleChatMessage, nextText: string) => void;
  onRequestDeleteMessage: (message: GoogleChatMessage) => void;
  onRequestReactMessage: (message: GoogleChatMessage, emoji: string) => void;
  onRequestDeleteSpace: (space: GoogleChatSpace) => void;
}

const QUICK_GCHAT_EMOJIS = ['👍', '❤️', '😂', '🎉', '🙌'];

export const GoogleChatConversation: React.FC<GoogleChatConversationProps> = ({
  space,
  messages,
  members,
  loadingMessages,
  error,
  onBack,
  onRefresh,
  onRequestSendMessage,
  onRequestEditMessage,
  onRequestDeleteMessage,
  onRequestReactMessage,
  onRequestDeleteSpace,
}) => {
  const [text, setText] = useState('');
  const [showMembers, setShowMembers] = useState(false);
  const [editingMsg, setEditingMsg] = useState<GoogleChatMessage | null>(null);
  const [editDraft, setEditDraft] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    if (editingMsg) {
      onRequestEditMessage(editingMsg, text.trim());
      setEditingMsg(null);
      setEditDraft('');
      setText('');
      return;
    }
    onRequestSendMessage(text.trim());
    setText('');
  };

  return (
    <div className="flex-1 flex flex-col h-full min-w-0 bg-[#EFEAE2] dark:bg-[#0B141A]">
      {/* Header */}
      <header className="px-4 py-3 bg-[#F0F2F5] dark:bg-[#202C33] border-b border-[#D1D7DB] dark:border-[#222E35] flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="md:hidden p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-[#54656F] dark:text-[#8696A0]"
            aria-label="Back to spaces"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-9 h-9 rounded-full bg-[#00A884]/15 text-[#00A884] flex items-center justify-center shrink-0">
            <Hash className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-[#111B21] dark:text-[#E9EDEF] truncate">
              {getSpaceDisplayTitle(space)}
            </div>
            <div className="text-xs text-[#54656F] dark:text-[#8696A0] truncate">
              Google Chat · {getSpaceKindLabel(space)}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onRefresh}
            className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-[#54656F] dark:text-[#8696A0]"
            title="Refresh messages"
          >
            <RefreshCw className={`w-4 h-4 ${loadingMessages ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => setShowMembers((v) => !v)}
            className={`p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 ${
              showMembers ? 'text-[#00A884]' : 'text-[#54656F] dark:text-[#8696A0]'
            }`}
            title="Space members"
          >
            <Users className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onRequestDeleteSpace(space)}
            className="p-2 rounded-full hover:bg-red-500/10 text-red-500"
            title="Delete Google Chat space"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 sm:px-8 space-y-3 chat-wallpaper">
          {error ? <GoogleChatErrorBanner error={error} /> : null}

          {loadingMessages && messages.length === 0 ? (
            <div className="text-center py-8 text-xs text-[#54656F] dark:text-[#8696A0]">
              Loading messages from Google Chat...
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-10">
              <span className="inline-block px-4 py-2 rounded-xl bg-white/90 dark:bg-[#202C33] text-xs text-[#54656F] dark:text-[#8696A0] shadow-xs">
                No messages in this Google Chat space yet.
              </span>
            </div>
          ) : (
            messages.map((m) => (
              <div
                key={m.name}
                className="group max-w-2xl bg-white dark:bg-[#202C33] border border-[#E9EDEF] dark:border-[#2A3942] rounded-2xl px-3.5 py-2.5 shadow-xs space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#008F6F] dark:text-[#00A884]">
                    {m.sender?.displayName || m.sender?.name || 'Workspace Member'}
                  </span>
                  <div className="flex items-center gap-1">
                    {m.createTime && (
                      <span className="text-[11px] text-[#54656F] dark:text-[#8696A0] tabular-nums">
                        {formatTime(m.createTime)}
                      </span>
                    )}
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 ml-1">
                      {QUICK_GCHAT_EMOJIS.slice(0, 3).map((em) => (
                        <button
                          key={em}
                          type="button"
                          onClick={() => onRequestReactMessage(m, em)}
                          className="p-1 rounded hover:bg-[#F0F2F5] dark:hover:bg-[#2A3942] text-xs"
                          title={`React ${em}`}
                        >
                          {em}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          setEditingMsg(m);
                          setEditDraft(m.text || '');
                          setText(m.text || '');
                        }}
                        className="p-1 rounded hover:bg-[#F0F2F5] dark:hover:bg-[#2A3942] text-[#54656F] dark:text-[#8696A0]"
                        title="Edit message"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRequestDeleteMessage(m)}
                        className="p-1 rounded hover:bg-red-500/10 text-red-500"
                        title="Delete message"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

                <p className="text-sm text-[#111B21] dark:text-[#E9EDEF] whitespace-pre-wrap break-words">
                  {m.text || m.formattedText || '(Attachment or card message)'}
                </p>

                {m.emojiReactionSummaries && m.emojiReactionSummaries.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {m.emojiReactionSummaries.map((r, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          if (r.emoji?.unicode) {
                            onRequestReactMessage(m, r.emoji.unicode);
                          }
                        }}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#F0F2F5] dark:bg-[#111B21] border border-[#D1D7DB] dark:border-[#2A3942] text-xs"
                      >
                        <span>{r.emoji?.unicode || '👍'}</span>
                        <span className="text-[10px] font-semibold tabular-nums text-[#54656F] dark:text-[#8696A0]">
                          {r.reactionCount || 1}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {showMembers && (
          <aside className="w-64 shrink-0 border-l border-[#D1D7DB] dark:border-[#222E35] bg-white dark:bg-[#111B21] overflow-y-auto p-3.5 space-y-2.5">
            <div className="text-xs font-semibold text-[#111B21] dark:text-[#E9EDEF] flex items-center justify-between">
              <span>Members ({members.length})</span>
              <button
                type="button"
                onClick={() => setShowMembers(false)}
                className="text-[#54656F] hover:text-[#111B21]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {members.length === 0 ? (
              <p className="text-xs text-[#54656F] dark:text-[#8696A0]">
                No member records returned.
              </p>
            ) : (
              <div className="space-y-1.5">
                {members.map((mb) => (
                  <div
                    key={mb.name}
                    className="p-2 rounded-xl bg-[#F7F8FA] dark:bg-[#202C33] text-xs"
                  >
                    <div className="font-medium text-[#111B21] dark:text-[#E9EDEF] truncate">
                      {mb.member?.displayName || mb.member?.name || 'Member'}
                    </div>
                    <div className="text-[11px] text-[#54656F] dark:text-[#8696A0]">
                      {mb.role || 'ROLE_MEMBER'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </aside>
        )}
      </div>

      {/* Composer */}
      <div className="px-3 sm:px-4 py-2.5 bg-[#F0F2F5] dark:bg-[#202C33] border-t border-[#D1D7DB] dark:border-[#222E35] shrink-0 space-y-2">
        {editingMsg && (
          <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-white dark:bg-[#111B21] text-xs">
            <span className="text-[#00A884] font-medium truncate">
              Editing message: {editDraft}
            </span>
            <button
              type="button"
              onClick={() => {
                setEditingMsg(null);
                setEditDraft('');
                setText('');
              }}
              className="text-[#54656F] hover:text-[#111B21]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-0.5 text-[#54656F] dark:text-[#8696A0]">
            <SmilePlus className="w-4 h-4 mr-1" />
          </div>
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              editingMsg
                ? 'Edit Google Chat message...'
                : `Message ${getSpaceDisplayTitle(space)}...`
            }
            className="flex-1 px-4 py-2.5 rounded-xl bg-white dark:bg-[#2A3942] text-sm text-[#111B21] dark:text-[#E9EDEF] placeholder-[#54656F] dark:placeholder-[#8696A0] focus:outline-none"
          />
          <button
            type="submit"
            disabled={!text.trim()}
            className="w-10 h-10 rounded-full bg-[#00A884] hover:bg-[#008F6F] disabled:opacity-50 text-white flex items-center justify-center shrink-0 transition-colors"
            title={editingMsg ? 'Save edit' : 'Send to Google Chat'}
          >
            {editingMsg ? <Check className="w-4 h-4" /> : <Send className="w-4 h-4" />}
          </button>
        </form>
      </div>
    </div>
  );
};

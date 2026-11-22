import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowLeft,
  Ban,
  Check,
  CheckCheck,
  ChevronDown,
  Copy,
  Download,
  Edit3,
  FileText,
  Forward,
  Image as ImageIcon,
  Mic,
  MoreVertical,
  Paperclip,
  Pin,
  Plus,
  Reply,
  Search,
  Send,
  Smile,
  Square,
  Star,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { uploadFile } from '../lib/api.ts';
import {
  formatDateDivider,
  formatDuration,
  formatFileSize,
  formatLastSeen,
  formatTime,
  isSafeHttpUrl,
} from '../lib/format.ts';
import type { ChatMessage, ConversationSummary, MessageReaction, TypingUser } from '../types.ts';
import { Avatar } from './Avatar.tsx';
import { EmojiPicker, QUICK_REACTIONS } from './EmojiPicker.tsx';

interface ChatAreaProps {
  conversation: ConversationSummary;
  messages: ChatMessage[];
  hasMore: boolean;
  loadingMessages: boolean;
  currentUserId: string;
  typingUsers: TypingUser[];
  jumpMessageId: string | null;
  onClearJump: () => void;
  onBack: () => void;
  onLoadMore: () => Promise<void>;
  onSendMessage: (payload: {
    type: 'text' | 'image' | 'video' | 'document' | 'audio';
    content?: string;
    mediaUrl?: string;
    mediaName?: string;
    mediaMime?: string;
    mediaSize?: number;
    mediaDuration?: number;
    replyToId?: string | null;
  }) => Promise<void>;
  onTypingSignal: (isTyping: boolean) => void;
  onReactMessage: (messageId: string, emoji: string) => Promise<void>;
  onEditMessage: (messageId: string, content: string) => Promise<void>;
  onDeleteMessage: (messageId: string) => Promise<void>;
  onStarMessage: (messageId: string) => Promise<void>;
  onForwardRequest: (message: ChatMessage) => void;
  onOpenDrawer: (mode: 'info' | 'search') => void;
  onToggleArchive: () => Promise<void>;
  onTogglePin: () => Promise<void>;
  onToggleMute: () => Promise<void>;
  onExportChat: () => Promise<void>;
}

function renderTextWithLinks(text: string) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('http://') || part.startsWith('https://')) {
      if (isSafeHttpUrl(part)) {
        return (
          <a
            key={idx}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-[#027EB5] dark:text-[#53BDEB] break-all"
          >
            {part}
          </a>
        );
      }
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

function groupReactions(reactions: MessageReaction[], currentUserId: string) {
  const map = new Map<
    string,
    { emoji: string; count: number; reactedByMe: boolean; usernames: string[] }
  >();
  for (const r of reactions) {
    const entry = map.get(r.emoji) || {
      emoji: r.emoji,
      count: 0,
      reactedByMe: false,
      usernames: [],
    };
    entry.count += 1;
    if (r.userId === currentUserId) entry.reactedByMe = true;
    entry.usernames.push(`@${r.username}`);
    map.set(r.emoji, entry);
  }
  return Array.from(map.values());
}

export const ChatArea: React.FC<ChatAreaProps> = ({
  conversation,
  messages,
  hasMore,
  loadingMessages,
  currentUserId,
  typingUsers,
  jumpMessageId,
  onClearJump,
  onBack,
  onLoadMore,
  onSendMessage,
  onTypingSignal,
  onReactMessage,
  onEditMessage,
  onDeleteMessage,
  onStarMessage,
  onForwardRequest,
  onOpenDrawer,
  onToggleArchive,
  onTogglePin,
  onToggleMute,
  onExportChat,
}) => {
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editingMsg, setEditingMsg] = useState<ChatMessage | null>(null);
  const [showEmojiComposer, setShowEmojiComposer] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [reactingMsgId, setReactingMsgId] = useState<string | null>(null);
  const [fullReactPickerMsgId, setFullReactPickerMsgId] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Voice recording state
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const recordStartRef = useRef<number>(0);

  const listRef = useRef<HTMLDivElement | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const isTypingRef = useRef(false);
  const shouldStickBottomRef = useRef(true);
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const docInputRef = useRef<HTMLInputElement | null>(null);

  const isBlocked = Boolean(conversation.peer?.isBlocked || conversation.peer?.blockedByPeer);

  useEffect(() => {
    setText('');
    setReplyTo(null);
    setEditingMsg(null);
    setShowEmojiComposer(false);
    setShowAttachMenu(false);
    setShowMoreMenu(false);
    setReactingMsgId(null);
    setFullReactPickerMsgId(null);
    setSendError(null);
    shouldStickBottomRef.current = true;
    isTypingRef.current = false;
  }, [conversation.id]);

  // Scroll to bottom when new messages arrive if near bottom
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (shouldStickBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, typingUsers.length]);

  // Jump to searched or replied message
  useEffect(() => {
    if (!jumpMessageId) return;
    const target = document.getElementById(`msg-${jumpMessageId}`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedId(jumpMessageId);
      setTimeout(() => setHighlightedId(null), 2000);
    }
    onClearJump();
  }, [jumpMessageId, onClearJump]);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldStickBottomRef.current = distanceFromBottom < 120;
    setShowScrollBottom(distanceFromBottom > 320);
  };

  const emitTyping = (nextValue: string) => {
    if (isBlocked || editingMsg) return;
    const hasText = nextValue.trim().length > 0;
    if (hasText && !isTypingRef.current) {
      isTypingRef.current = true;
      onTypingSignal(true);
    }
    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current);
    }
    if (hasText) {
      typingTimeoutRef.current = window.setTimeout(() => {
        if (isTypingRef.current) {
          isTypingRef.current = false;
          onTypingSignal(false);
        }
      }, 2500);
    } else if (isTypingRef.current) {
      isTypingRef.current = false;
      onTypingSignal(false);
    }
  };

  const stopTypingImmediately = () => {
    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    if (isTypingRef.current) {
      isTypingRef.current = false;
      onTypingSignal(false);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || isBlocked) return;
    setSendError(null);
    stopTypingImmediately();

    try {
      if (editingMsg) {
        await onEditMessage(editingMsg.id, trimmed);
        setEditingMsg(null);
        setText('');
      } else {
        setText('');
        const replyId = replyTo?.id || null;
        setReplyTo(null);
        shouldStickBottomRef.current = true;
        await onSendMessage({
          type: 'text',
          content: trimmed,
          replyToId: replyId,
        });
      }
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send message');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, kind: 'media' | 'doc') => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setShowAttachMenu(false);
    setUploading(true);
    setSendError(null);
    try {
      const up = await uploadFile(file);
      let msgType: 'image' | 'video' | 'document' | 'audio' = 'document';
      if (kind === 'media') {
        if (up.mime.startsWith('image/')) msgType = 'image';
        else if (up.mime.startsWith('video/')) msgType = 'video';
      } else if (up.mime.startsWith('audio/')) {
        msgType = 'audio';
      }
      shouldStickBottomRef.current = true;
      await onSendMessage({
        type: msgType,
        content: '',
        mediaUrl: up.url,
        mediaName: up.name,
        mediaMime: up.mime,
        mediaSize: up.size,
        replyToId: replyTo?.id || null,
      });
      setReplyTo(null);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const startRecording = async () => {
    setSendError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      recordStartRef.current = Date.now();
      setRecordSeconds(0);
      setRecording(true);
      recordTimerRef.current = window.setInterval(() => {
        setRecordSeconds(Math.floor((Date.now() - recordStartRef.current) / 1000));
      }, 500);
    } catch {
      setSendError('Microphone access is needed to record voice messages.');
    }
  };

  const stopRecording = (send: boolean) => {
    const recorder = mediaRecorderRef.current;
    if (recordTimerRef.current) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    if (!recorder) {
      setRecording(false);
      return;
    }

    const durationSec = Math.max(1, Math.round((Date.now() - recordStartRef.current) / 1000));
    recorder.onstop = async () => {
      recorder.stream.getTracks().forEach((t) => t.stop());
      if (send && audioChunksRef.current.length > 0) {
        setUploading(true);
        try {
          const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
          const up = await uploadFile(blob, `voice_${Date.now()}.webm`);
          shouldStickBottomRef.current = true;
          await onSendMessage({
            type: 'audio',
            mediaUrl: up.url,
            mediaName: 'Voice message',
            mediaMime: up.mime,
            mediaSize: up.size,
            mediaDuration: durationSec,
            replyToId: replyTo?.id || null,
          });
          setReplyTo(null);
        } catch (err) {
          setSendError(err instanceof Error ? err.message : 'Failed to send voice note');
        } finally {
          setUploading(false);
        }
      }
      audioChunksRef.current = [];
    };
    recorder.stop();
    mediaRecorderRef.current = null;
    setRecording(false);
  };

  const handleCopy = async (msg: ChatMessage) => {
    await navigator.clipboard.writeText(msg.content || msg.mediaName || '');
    setCopiedId(msg.id);
    setTimeout(() => setCopiedId(null), 1600);
  };

  const subtitleText = useMemo(() => {
    if (typingUsers.length > 0) {
      if (conversation.type === 'direct') return 'typing...';
      if (typingUsers.length === 1) return `@${typingUsers[0].username} is typing...`;
      return `${typingUsers.length} people are typing...`;
    }
    if (conversation.type === 'group') return conversation.subtitle;
    if (conversation.peer?.isOnline) return 'online';
    if (conversation.peer?.lastSeenAt) return formatLastSeen(conversation.peer.lastSeenAt);
    return `@${conversation.peer?.username || ''}`;
  }, [typingUsers, conversation]);

  return (
    <div className="flex-1 flex flex-col h-full min-w-0 relative">
      {/* Header */}
      <header className="h-16 px-3 sm:px-4 bg-[#F0F2F5] dark:bg-[#202C33] border-b border-[#D1D7DB] dark:border-[#222E35] flex items-center justify-between gap-3 shrink-0 z-10">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="md:hidden p-2 -ml-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-[#54656F] dark:text-[#8696A0]"
            aria-label="Back to chats"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={() => onOpenDrawer('info')}
            className="flex items-center gap-3 min-w-0 text-left group"
          >
            <Avatar
              src={conversation.avatarUrl}
              name={conversation.title}
              size="md"
              isGroup={conversation.type === 'group'}
              isOnline={conversation.peer?.isOnline}
            />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[#111B21] dark:text-[#E9EDEF] truncate group-hover:underline">
                {conversation.title}
              </div>
              <div
                className={`text-xs truncate ${
                  typingUsers.length > 0
                    ? 'text-[#00A884] font-semibold'
                    : conversation.peer?.isOnline
                      ? 'text-[#00A884]'
                      : 'text-[#54656F] dark:text-[#8696A0]'
                }`}
              >
                {subtitleText}
              </div>
            </div>
          </button>
        </div>

        <div className="flex items-center gap-1 shrink-0 relative">
          <button
            type="button"
            onClick={() => onOpenDrawer('search')}
            className="p-2.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-[#54656F] dark:text-[#8696A0]"
            title="Search messages"
          >
            <Search className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => setShowMoreMenu((v) => !v)}
            className="p-2.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-[#54656F] dark:text-[#8696A0]"
            title="Chat options"
          >
            <MoreVertical className="w-5 h-5" />
          </button>

          {showMoreMenu && (
            <div className="absolute right-0 top-12 w-52 bg-white dark:bg-[#233138] border border-[#D1D7DB] dark:border-[#2A3942] rounded-xl shadow-xl py-1.5 z-30">
              <button
                type="button"
                onClick={() => {
                  setShowMoreMenu(false);
                  onOpenDrawer('info');
                }}
                className="w-full px-4 py-2 text-left text-xs font-medium text-[#111B21] dark:text-[#E9EDEF] hover:bg-[#F0F2F5] dark:hover:bg-[#182229] flex items-center gap-2.5"
              >
                <span>{conversation.type === 'group' ? 'Group info' : 'Contact info'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowMoreMenu(false);
                  void onTogglePin();
                }}
                className="w-full px-4 py-2 text-left text-xs font-medium text-[#111B21] dark:text-[#E9EDEF] hover:bg-[#F0F2F5] dark:hover:bg-[#182229] flex items-center gap-2.5"
              >
                <Pin className="w-3.5 h-3.5" />
                <span>{conversation.pinned ? 'Unpin chat' : 'Pin chat'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowMoreMenu(false);
                  void onToggleMute();
                }}
                className="w-full px-4 py-2 text-left text-xs font-medium text-[#111B21] dark:text-[#E9EDEF] hover:bg-[#F0F2F5] dark:hover:bg-[#182229] flex items-center gap-2.5"
              >
                {conversation.muted ? (
                  <Volume2 className="w-3.5 h-3.5" />
                ) : (
                  <VolumeX className="w-3.5 h-3.5" />
                )}
                <span>{conversation.muted ? 'Unmute notifications' : 'Mute notifications'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowMoreMenu(false);
                  void onToggleArchive();
                }}
                className="w-full px-4 py-2 text-left text-xs font-medium text-[#111B21] dark:text-[#E9EDEF] hover:bg-[#F0F2F5] dark:hover:bg-[#182229] flex items-center gap-2.5"
              >
                <Archive className="w-3.5 h-3.5" />
                <span>{conversation.archived ? 'Unarchive chat' : 'Archive chat'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowMoreMenu(false);
                  void onExportChat();
                }}
                className="w-full px-4 py-2 text-left text-xs font-medium text-[#111B21] dark:text-[#E9EDEF] hover:bg-[#F0F2F5] dark:hover:bg-[#182229] flex items-center gap-2.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export chat</span>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Messages Timeline */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3 sm:px-6 lg:px-12 py-4 space-y-2 chat-wallpaper-light dark:chat-wallpaper-dark relative"
      >
        {hasMore && (
          <div className="flex justify-center pb-2">
            <button
              type="button"
              disabled={loadingMessages}
              onClick={() => void onLoadMore()}
              className="px-3.5 py-1.5 rounded-full bg-white/90 dark:bg-[#202C33]/90 border border-[#D1D7DB] dark:border-[#2A3942] text-xs font-medium text-[#111B21] dark:text-[#E9EDEF] shadow-xs hover:bg-white dark:hover:bg-[#2A3942]"
            >
              {loadingMessages ? 'Loading older...' : 'Load older messages'}
            </button>
          </div>
        )}

        {messages.length === 0 && !loadingMessages ? (
          <div className="h-full flex items-center justify-center">
            <div className="px-4 py-2.5 rounded-xl bg-white/90 dark:bg-[#202C33]/90 border border-[#E9EDEF] dark:border-[#2A3942] text-xs text-[#54656F] dark:text-[#8696A0] shadow-xs">
              Send a message to start your conversation with {conversation.title}.
            </div>
          </div>
        ) : (
          messages.map((msg, idx) => {
            const prevMsg = idx > 0 ? messages[idx - 1] : null;
            const dateLabel = formatDateDivider(msg.createdAt);
            const prevDateLabel = prevMsg ? formatDateDivider(prevMsg.createdAt) : null;
            const showDate = dateLabel !== prevDateLabel;

            if (msg.type === 'system') {
              return (
                <React.Fragment key={msg.id}>
                  {showDate && (
                    <div className="flex justify-center my-2">
                      <span className="px-3 py-1 rounded-lg bg-white/90 dark:bg-[#182229]/90 text-[11px] font-medium text-[#54656F] dark:text-[#8696A0] shadow-xs">
                        {dateLabel}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-center my-1.5">
                    <span className="px-3 py-1 rounded-lg bg-white/85 dark:bg-[#182229]/85 text-xs text-[#54656F] dark:text-[#8696A0] shadow-xs">
                      {msg.content}
                    </span>
                  </div>
                </React.Fragment>
              );
            }

            const isMine = msg.senderId === currentUserId;
            const groupedReactions = groupReactions(msg.reactions || [], currentUserId);
            const showGroupAuthor =
              conversation.type === 'group' &&
              !isMine &&
              (!prevMsg || prevMsg.senderId !== msg.senderId || prevMsg.type === 'system');

            return (
              <React.Fragment key={msg.id}>
                {showDate && (
                  <div className="flex justify-center my-2">
                    <span className="px-3 py-1 rounded-lg bg-white/90 dark:bg-[#182229]/90 text-[11px] font-medium text-[#54656F] dark:text-[#8696A0] shadow-xs">
                      {dateLabel}
                    </span>
                  </div>
                )}

                <div
                  id={`msg-${msg.id}`}
                  className={`flex flex-col ${isMine ? 'items-end' : 'items-start'} ${
                    highlightedId === msg.id ? 'ring-2 ring-[#00A884] rounded-xl p-1' : ''
                  }`}
                >
                  <div className={`group relative max-w-[85%] sm:max-w-[70%] flex items-end gap-1.5 ${isMine ? 'flex-row-reverse' : 'flex-row'}`}>
                    {/* Message Bubble */}
                    <div
                      className={`rounded-2xl px-3.5 py-2 shadow-xs relative ${
                        isMine
                          ? 'bg-[#D9FDD3] dark:bg-[#005C4B] text-[#111B21] dark:text-[#E9EDEF] rounded-tr-xs'
                          : 'bg-white dark:bg-[#202C33] text-[#111B21] dark:text-[#E9EDEF] rounded-tl-xs'
                      }`}
                    >
                      {showGroupAuthor && (
                        <div className="text-[11px] font-semibold text-[#00A884] mb-0.5">
                          {msg.senderDisplayName}{' '}
                          <span className="font-mono font-normal opacity-75">
                            @{msg.senderUsername}
                          </span>
                        </div>
                      )}

                      {msg.forwardedFromId && !msg.isDeleted && (
                        <div className="flex items-center gap-1 text-[11px] italic text-[#54656F] dark:text-[#8696A0] mb-1">
                          <Forward className="w-3 h-3" />
                          <span>Forwarded</span>
                        </div>
                      )}

                      {msg.replyTo && !msg.isDeleted && (
                        <button
                          type="button"
                          onClick={() => {
                            const target = document.getElementById(`msg-${msg.replyTo!.id}`);
                            if (target) {
                              target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                              setHighlightedId(msg.replyTo!.id);
                              setTimeout(() => setHighlightedId(null), 1600);
                            }
                          }}
                          className="w-full text-left mb-1.5 p-2 rounded-lg bg-black/5 dark:bg-black/25 hover:bg-black/10 transition-colors"
                        >
                          <div className="text-[11px] font-semibold text-[#00A884]">
                            {msg.replyTo.senderDisplayName}
                          </div>
                          <div className="text-xs text-[#54656F] dark:text-[#8696A0] truncate max-w-xs">
                            {msg.replyTo.isDeleted
                              ? 'This message was deleted'
                              : msg.replyTo.content || msg.replyTo.mediaName || msg.replyTo.type}
                          </div>
                        </button>
                      )}

                      {msg.isDeleted ? (
                        <p className="text-sm italic text-[#54656F] dark:text-[#8696A0]">
                          This message was deleted
                        </p>
                      ) : (
                        <>
                          {msg.type === 'image' && msg.mediaUrl && (
                            <button
                              type="button"
                              onClick={() => setLightboxUrl(msg.mediaUrl)}
                              className="block mb-1 rounded-xl overflow-hidden"
                            >
                              <img
                                src={msg.mediaUrl}
                                alt={msg.mediaName || 'Shared image'}
                                className="max-h-72 w-auto rounded-xl object-cover"
                              />
                            </button>
                          )}

                          {msg.type === 'video' && msg.mediaUrl && (
                            <video
                              src={msg.mediaUrl}
                              controls
                              className="max-h-72 rounded-xl mb-1 bg-black"
                            />
                          )}

                          {msg.type === 'audio' && msg.mediaUrl && (
                            <div className="flex flex-col gap-1 min-w-[220px] py-1">
                              <audio src={msg.mediaUrl} controls className="h-9 max-w-[260px]" />
                              {msg.mediaDuration ? (
                                <span className="text-[11px] font-mono text-[#54656F] dark:text-[#8696A0] tabular-nums">
                                  Voice note · {formatDuration(msg.mediaDuration)}
                                </span>
                              ) : null}
                            </div>
                          )}

                          {msg.type === 'document' && msg.mediaUrl && (
                            <a
                              href={msg.mediaUrl}
                              download={msg.mediaName || 'document'}
                              className="flex items-center gap-3 p-2.5 rounded-xl bg-black/5 dark:bg-black/25 hover:bg-black/10 transition-colors min-w-[210px]"
                            >
                              <div className="w-9 h-9 rounded-lg bg-[#00A884]/15 text-[#00A884] flex items-center justify-center shrink-0">
                                <FileText className="w-5 h-5" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-semibold truncate">
                                  {msg.mediaName || 'Document'}
                                </div>
                                <div className="text-[11px] text-[#54656F] dark:text-[#8696A0] tabular-nums">
                                  {formatFileSize(msg.mediaSize)}
                                </div>
                              </div>
                              <Download className="w-4 h-4 text-[#54656F] dark:text-[#8696A0] shrink-0" />
                            </a>
                          )}

                          {msg.content && (
                            <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
                              {renderTextWithLinks(msg.content)}
                            </p>
                          )}
                        </>
                      )}

                      {/* Timestamp & Delivery Status */}
                      <div className="flex items-center justify-end gap-1.5 mt-1 text-[10px] text-[#54656F] dark:text-[#8696A0] tabular-nums select-none">
                        {msg.isStarred && <Star className="w-3 h-3 fill-amber-400 text-amber-400" />}
                        {msg.isEdited && !msg.isDeleted && <span>Edited</span>}
                        <span>{formatTime(msg.createdAt)}</span>
                        {isMine && !msg.isDeleted && (
                          <span title={msg.status}>
                            {msg.status === 'read' ? (
                              <CheckCheck className="w-3.5 h-3.5 text-[#53BDEB]" />
                            ) : msg.status === 'delivered' ? (
                              <CheckCheck className="w-3.5 h-3.5" />
                            ) : (
                              <Check className="w-3.5 h-3.5" />
                            )}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Hover Actions Bar */}
                    {!msg.isDeleted && (
                      <div
                        className={`opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex items-center gap-0.5 bg-white dark:bg-[#233138] border border-[#D1D7DB] dark:border-[#2A3942] rounded-xl px-1 py-0.5 shadow-sm shrink-0 ${
                          reactingMsgId === msg.id ? 'opacity-100' : ''
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setReactingMsgId((cur) => (cur === msg.id ? null : msg.id));
                            setFullReactPickerMsgId(null);
                          }}
                          className="p-1.5 rounded-lg hover:bg-[#F0F2F5] dark:hover:bg-[#2A3942] text-[#54656F] dark:text-[#8696A0]"
                          title="React"
                        >
                          <Smile className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingMsg(null);
                            setReplyTo(msg);
                          }}
                          className="p-1.5 rounded-lg hover:bg-[#F0F2F5] dark:hover:bg-[#2A3942] text-[#54656F] dark:text-[#8696A0]"
                          title="Reply"
                        >
                          <Reply className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onForwardRequest(msg)}
                          className="p-1.5 rounded-lg hover:bg-[#F0F2F5] dark:hover:bg-[#2A3942] text-[#54656F] dark:text-[#8696A0]"
                          title="Forward"
                        >
                          <Forward className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void onStarMessage(msg.id)}
                          className="p-1.5 rounded-lg hover:bg-[#F0F2F5] dark:hover:bg-[#2A3942] text-[#54656F] dark:text-[#8696A0]"
                          title={msg.isStarred ? 'Unstar' : 'Star'}
                        >
                          <Star
                            className={`w-3.5 h-3.5 ${
                              msg.isStarred ? 'fill-amber-400 text-amber-400' : ''
                            }`}
                          />
                        </button>
                        {msg.content && (
                          <button
                            type="button"
                            onClick={() => void handleCopy(msg)}
                            className="p-1.5 rounded-lg hover:bg-[#F0F2F5] dark:hover:bg-[#2A3942] text-[#54656F] dark:text-[#8696A0]"
                            title="Copy"
                          >
                            {copiedId === msg.id ? (
                              <Check className="w-3.5 h-3.5 text-[#00A884]" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}
                        {isMine && msg.type === 'text' && (
                          <button
                            type="button"
                            onClick={() => {
                              setReplyTo(null);
                              setEditingMsg(msg);
                              setText(msg.content);
                            }}
                            className="p-1.5 rounded-lg hover:bg-[#F0F2F5] dark:hover:bg-[#2A3942] text-[#54656F] dark:text-[#8696A0]"
                            title="Edit"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {isMine && (
                          <button
                            type="button"
                            onClick={() => void onDeleteMessage(msg.id)}
                            className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 text-red-500"
                            title="Delete for everyone"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )}

                    {/* Quick Reaction Popover */}
                    {reactingMsgId === msg.id && (
                      <div
                        className={`absolute -top-11 z-30 flex items-center gap-1 px-2 py-1 rounded-full bg-white dark:bg-[#233138] border border-[#D1D7DB] dark:border-[#2A3942] shadow-lg ${
                          isMine ? 'right-0' : 'left-0'
                        }`}
                      >
                        {QUICK_REACTIONS.map((em) => (
                          <button
                            key={em}
                            type="button"
                            onClick={() => {
                              setReactingMsgId(null);
                              void onReactMessage(msg.id, em);
                            }}
                            className="w-7 h-7 flex items-center justify-center rounded-full text-lg hover:bg-[#F0F2F5] dark:hover:bg-[#2A3942] hover:scale-110 transition-transform"
                          >
                            {em}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() =>
                            setFullReactPickerMsgId((cur) => (cur === msg.id ? null : msg.id))
                          }
                          className="w-7 h-7 flex items-center justify-center rounded-full bg-[#F0F2F5] dark:bg-[#2A3942] text-[#54656F] dark:text-[#8696A0] hover:text-[#111B21]"
                          title="More emojis"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    )}

                    {fullReactPickerMsgId === msg.id && (
                      <div
                        className={`absolute top-8 z-40 ${isMine ? 'right-0' : 'left-0'}`}
                      >
                        <EmojiPicker
                          onSelect={(em) => {
                            setFullReactPickerMsgId(null);
                            setReactingMsgId(null);
                            void onReactMessage(msg.id, em);
                          }}
                        />
                      </div>
                    )}
                  </div>

                  {/* Attached Reactions Below Message */}
                  {groupedReactions.length > 0 && !msg.isDeleted && (
                    <div className="flex flex-wrap items-center gap-1 mt-1 px-1">
                      {groupedReactions.map((gr) => (
                        <button
                          key={gr.emoji}
                          type="button"
                          onClick={() => void onReactMessage(msg.id, gr.emoji)}
                          title={`Reacted by ${gr.usernames.join(', ')}`}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border shadow-2xs transition-colors ${
                            gr.reactedByMe
                              ? 'bg-[#00A884]/15 border-[#00A884] text-[#008F6F] dark:text-[#00A884] font-semibold'
                              : 'bg-white dark:bg-[#202C33] border-[#D1D7DB] dark:border-[#2A3942] text-[#111B21] dark:text-[#E9EDEF]'
                          }`}
                        >
                          <span>{gr.emoji}</span>
                          {gr.count > 1 && <span className="tabular-nums text-[11px]">{gr.count}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </React.Fragment>
            );
          })
        )}

        {/* Live Typing Indicator Bubble */}
        {typingUsers.length > 0 && (
          <div className="flex items-start pt-1">
            <div className="px-3.5 py-2.5 rounded-2xl rounded-tl-xs bg-white dark:bg-[#202C33] shadow-xs flex items-center gap-2">
              <span className="text-xs font-medium text-[#00A884]">
                {conversation.type === 'group'
                  ? `${typingUsers.map((u) => `@${u.username}`).join(', ')} typing`
                  : 'typing'}
              </span>
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#00A884] animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-[#00A884] animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-[#00A884] animate-bounce" />
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Scroll to bottom floating button */}
      {showScrollBottom && (
        <button
          type="button"
          onClick={() => {
            if (listRef.current) {
              listRef.current.scrollTop = listRef.current.scrollHeight;
            }
          }}
          className="absolute right-5 bottom-24 z-20 p-2.5 rounded-full bg-white dark:bg-[#202C33] border border-[#D1D7DB] dark:border-[#2A3942] shadow-lg text-[#54656F] dark:text-[#8696A0] hover:text-[#111B21]"
          title="Jump to latest"
        >
          <ChevronDown className="w-5 h-5" />
        </button>
      )}

      {/* Reply / Edit Banner */}
      {(replyTo || editingMsg) && (
        <div className="px-4 py-2 bg-[#F0F2F5] dark:bg-[#202C33] border-t border-[#D1D7DB] dark:border-[#222E35] flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1 bg-white dark:bg-[#111B21] rounded-xl px-3 py-2">
            <div className="text-xs font-semibold text-[#00A884]">
              {editingMsg ? 'Editing message' : `Replying to ${replyTo?.senderDisplayName}`}
            </div>
            <div className="text-xs text-[#54656F] dark:text-[#8696A0] truncate">
              {editingMsg
                ? editingMsg.content
                : replyTo?.content || replyTo?.mediaName || replyTo?.type}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setReplyTo(null);
              setEditingMsg(null);
              if (editingMsg) setText('');
            }}
            className="p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-[#54656F] dark:text-[#8696A0]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {sendError && (
        <div className="px-4 py-1.5 bg-red-50 dark:bg-red-950/50 text-xs text-red-600 dark:text-red-300 flex items-center justify-between">
          <span>{sendError}</span>
          <button type="button" onClick={() => setSendError(null)}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Composer */}
      {isBlocked ? (
        <div className="px-4 py-3.5 bg-[#F0F2F5] dark:bg-[#202C33] border-t border-[#D1D7DB] dark:border-[#222E35] flex items-center justify-center gap-2 text-xs text-[#54656F] dark:text-[#8696A0]">
          <Ban className="w-4 h-4 text-red-500" />
          <span>
            {conversation.peer?.isBlocked
              ? 'You blocked this user. Unblock from Contact Info to message.'
              : 'You cannot send messages to this user.'}
          </span>
        </div>
      ) : (
        <footer className="px-3 sm:px-4 py-2.5 bg-[#F0F2F5] dark:bg-[#202C33] border-t border-[#D1D7DB] dark:border-[#222E35] flex items-end gap-2 relative">
          {showEmojiComposer && (
            <div className="absolute bottom-16 left-3 z-30">
              <EmojiPicker
                onSelect={(em) => {
                  const next = text + em;
                  setText(next);
                  emitTyping(next);
                }}
              />
            </div>
          )}

          {showAttachMenu && (
            <div className="absolute bottom-16 left-12 z-30 w-48 bg-white dark:bg-[#233138] border border-[#D1D7DB] dark:border-[#2A3942] rounded-xl shadow-xl py-1.5">
              <button
                type="button"
                onClick={() => mediaInputRef.current?.click()}
                className="w-full px-4 py-2 text-left text-xs font-medium text-[#111B21] dark:text-[#E9EDEF] hover:bg-[#F0F2F5] dark:hover:bg-[#182229] flex items-center gap-2.5"
              >
                <ImageIcon className="w-4 h-4 text-[#00A884]" />
                <span>Photo or Video</span>
              </button>
              <button
                type="button"
                onClick={() => docInputRef.current?.click()}
                className="w-full px-4 py-2 text-left text-xs font-medium text-[#111B21] dark:text-[#E9EDEF] hover:bg-[#F0F2F5] dark:hover:bg-[#182229] flex items-center gap-2.5"
              >
                <FileText className="w-4 h-4 text-indigo-500" />
                <span>Document or Audio</span>
              </button>
            </div>
          )}

          <input
            ref={mediaInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
            onChange={(e) => void handleFileUpload(e, 'media')}
            className="hidden"
          />
          <input
            ref={docInputRef}
            type="file"
            accept=".pdf,.txt,.csv,.json,.md,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.mp3,.wav,.ogg,.m4a"
            onChange={(e) => void handleFileUpload(e, 'doc')}
            className="hidden"
          />

          {recording ? (
            <div className="flex-1 flex items-center justify-between bg-white dark:bg-[#2A3942] rounded-xl px-4 py-2.5">
              <div className="flex items-center gap-2.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-sm font-medium text-[#111B21] dark:text-[#E9EDEF]">
                  Recording voice message...
                </span>
                <span className="text-xs font-mono text-[#54656F] dark:text-[#8696A0] tabular-nums">
                  {formatDuration(recordSeconds)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => stopRecording(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:bg-red-500/10"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => stopRecording(true)}
                  className="px-3 py-1.5 rounded-lg bg-[#00A884] text-white text-xs font-semibold flex items-center gap-1"
                >
                  <Square className="w-3 h-3 fill-current" />
                  <span>Send</span>
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setShowEmojiComposer((v) => !v);
                  setShowAttachMenu(false);
                }}
                className="p-2.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-[#54656F] dark:text-[#8696A0] shrink-0"
                title="Emojis"
              >
                <Smile className="w-5 h-5" />
              </button>

              <button
                type="button"
                disabled={uploading}
                onClick={() => {
                  setShowAttachMenu((v) => !v);
                  setShowEmojiComposer(false);
                }}
                className="p-2.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-[#54656F] dark:text-[#8696A0] shrink-0"
                title="Attach file"
              >
                <Paperclip className="w-5 h-5" />
              </button>

              <textarea
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  emitTyping(e.target.value);
                }}
                onKeyDown={handleKeyDown}
                onBlur={() => stopTypingImmediately()}
                placeholder={uploading ? 'Uploading attachment...' : 'Type a message'}
                rows={1}
                className="flex-1 max-h-32 min-h-[42px] py-2.5 px-4 rounded-xl bg-white dark:bg-[#2A3942] text-sm text-[#111B21] dark:text-[#E9EDEF] placeholder-[#54656F] dark:placeholder-[#8696A0] resize-none focus:outline-none"
              />

              {text.trim() ? (
                <button
                  type="button"
                  onClick={() => void handleSubmit()}
                  className="p-2.5 rounded-full bg-[#00A884] hover:bg-[#008F6F] text-white shrink-0 transition-colors"
                  title="Send message"
                >
                  <Send className="w-5 h-5" />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => void startRecording()}
                  className="p-2.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-[#54656F] dark:text-[#8696A0] shrink-0"
                  title="Record voice message"
                >
                  <Mic className="w-5 h-5" />
                </button>
              )}
            </>
          )}
        </footer>
      )}

      {/* Image Lightbox Modal */}
      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
        >
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/15 text-white hover:bg-white/25"
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={lightboxUrl}
            alt="Full size preview"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg"
          />
        </div>
      )}
    </div>
  );
};

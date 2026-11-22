import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  AtSign,
  Check,
  CheckCheck,
  CircleDashed,
  MessageSquare,
  MessageSquarePlus,
  MessagesSquare,
  Moon,
  Pin,
  Search,
  Settings,
  Star,
  Sun,
  UserPlus,
  Users,
  VolumeX,
} from 'lucide-react';
import type { User as FirebaseUser } from 'firebase/auth';
import { AuthView } from './components/AuthView.tsx';
import { Avatar } from './components/Avatar.tsx';
import { ChatArea } from './components/ChatArea.tsx';
import { ForwardModal } from './components/ForwardModal.tsx';
import {
  ConfirmMutationModal,
  GoogleChatConversation,
  GoogleChatSidebar,
  GoogleSignInButton,
  type GoogleChatConfirmationRequest,
} from './components/GoogleChatView.tsx';
import { InfoDrawer } from './components/InfoDrawer.tsx';
import { NewGroupModal } from './components/NewGroupModal.tsx';
import { SettingsPanel } from './components/SettingsPanel.tsx';
import { StatusPanel } from './components/StatusPanel.tsx';
import { UserProfileModal } from './components/UserProfileModal.tsx';
import { apiRequest, getSessionToken, setSessionToken } from './lib/api.ts';
import { formatConversationTime, formatTime } from './lib/format.ts';
import {
  createGoogleChatReaction,
  createGoogleChatSpace,
  deleteGoogleChatMessage,
  deleteGoogleChatSpace,
  getGoogleChatAccessToken,
  GoogleChatApiError,
  googleChatSignIn,
  googleChatSignOut,
  initGoogleChatAuth,
  listGoogleChatMembers,
  listGoogleChatMessages,
  listGoogleChatSpaces,
  sendGoogleChatMessage,
  updateGoogleChatMessage,
  type GoogleChatMembership,
  type GoogleChatMessage,
  type GoogleChatSpace,
} from './lib/googleChat.ts';
import type {
  ChatMessage,
  ConversationSummary,
  OwnAccount,
  StatusGroup,
  TypingUser,
  UserProfile,
} from './types.ts';

type SidebarTab =
  | 'chats'
  | 'status'
  | 'groups'
  | 'starred'
  | 'contacts'
  | 'archived'
  | 'gchat'
  | 'settings';

function highlightMatch(text: string, query: string): React.ReactNode {
  const cleaned = query.trim().replace(/^@+/, '');
  if (!cleaned || !text) return text;
  const lowerText = text.toLowerCase();
  const lowerQuery = cleaned.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let matchIdx = lowerText.indexOf(lowerQuery, cursor);
  let key = 0;
  while (matchIdx !== -1) {
    if (matchIdx > cursor) {
      parts.push(text.slice(cursor, matchIdx));
    }
    parts.push(
      <mark
        key={key++}
        className="bg-[#00A884]/20 text-[#008F6F] dark:text-[#25D366] font-bold rounded-xs px-0.5"
      >
        {text.slice(matchIdx, matchIdx + lowerQuery.length)}
      </mark>
    );
    cursor = matchIdx + lowerQuery.length;
    matchIdx = lowerText.indexOf(lowerQuery, cursor);
  }
  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }
  return parts.length > 0 ? <>{parts}</> : text;
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<OwnAccount | null>(null);

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  const [activeTab, setActiveTab] = useState<SidebarTab>('chats');
  const [chatFilter, setChatFilter] = useState<'all' | 'unread' | 'groups'>('all');
  const [sidebarQuery, setSidebarQuery] = useState('');

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const [contacts, setContacts] = useState<UserProfile[]>([]);
  const [discoveredUsers, setDiscoveredUsers] = useState<UserProfile[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [exactUsernameInput, setExactUsernameInput] = useState('');
  const [exactError, setExactError] = useState<string | null>(null);

  const [statusGroups, setStatusGroups] = useState<StatusGroup[]>([]);
  const [starredMessages, setStarredMessages] = useState<ChatMessage[]>([]);

  const [typingByConv, setTypingByConv] = useState<Record<string, TypingUser[]>>({});
  const [drawerMode, setDrawerMode] = useState<'info' | 'search' | null>(null);
  const [jumpMessageId, setJumpMessageId] = useState<string | null>(null);

  const [inspectedProfile, setInspectedProfile] = useState<UserProfile | null>(null);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [forwardingMessage, setForwardingMessage] = useState<ChatMessage | null>(null);

  const [notificationsEnabled, setNotificationsEnabled] = useState(
    typeof Notification !== 'undefined' && Notification.permission === 'granted'
  );

  // Google Chat integration state
  const [gchatUser, setGChatUser] = useState<FirebaseUser | null>(null);
  const [gchatNeedsAuth, setGChatNeedsAuth] = useState(true);
  const [gchatSigningIn, setGChatSigningIn] = useState(false);
  const [gchatSpaces, setGChatSpaces] = useState<GoogleChatSpace[]>([]);
  const [selectedGChatSpace, setSelectedGChatSpace] = useState<GoogleChatSpace | null>(null);
  const [gchatMessages, setGChatMessages] = useState<GoogleChatMessage[]>([]);
  const [gchatMembers, setGChatMembers] = useState<GoogleChatMembership[]>([]);
  const [gchatLoadingSpaces, setGChatLoadingSpaces] = useState(false);
  const [gchatLoadingMessages, setGChatLoadingMessages] = useState(false);
  const [gchatSidebarError, setGChatSidebarError] = useState<unknown>(null);
  const [gchatConvError, setGChatConvError] = useState<unknown>(null);
  const [pendingGChatConfirm, setPendingGChatConfirm] =
    useState<GoogleChatConfirmationRequest | null>(null);
  const [gchatConfirmBusy, setGChatConfirmBusy] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const activeConvIdRef = useRef<string | null>(null);
  const userRef = useRef<OwnAccount | null>(null);
  const typingExpiryTimers = useRef<Map<string, number>>(new Map());

  activeConvIdRef.current = activeConvId;
  userRef.current = user;

  // Apply Tailwind dark class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  const toggleTheme = async () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    if (user) {
      try {
        const res = await apiRequest<{ user: OwnAccount }>('/profile', {
          method: 'PATCH',
          body: JSON.stringify({ theme: next }),
        });
        setUser(res.user);
      } catch {
        // local theme still toggles cleanly
      }
    }
  };

  const refreshConversations = useCallback(async () => {
    if (!userRef.current) return;
    const res = await apiRequest<{ conversations: ConversationSummary[] }>('/conversations');
    setConversations(res.conversations);
  }, []);

  const refreshContacts = useCallback(async () => {
    if (!userRef.current) return;
    const res = await apiRequest<{ contacts: UserProfile[] }>('/contacts');
    setContacts(res.contacts);
  }, []);

  const refreshStatuses = useCallback(async () => {
    if (!userRef.current) return;
    const res = await apiRequest<{ statusGroups: StatusGroup[] }>('/statuses');
    setStatusGroups(res.statusGroups);
  }, []);

  const refreshStarred = useCallback(async () => {
    if (!userRef.current) return;
    const res = await apiRequest<{ messages: ChatMessage[] }>('/starred');
    setStarredMessages(res.messages);
  }, []);

  // Google Chat helpers & auth listener
  const loadGChatSpaces = useCallback(async (tokenOverride?: string) => {
    const token = tokenOverride || getGoogleChatAccessToken();
    if (!token) {
      setGChatNeedsAuth(true);
      return;
    }
    setGChatLoadingSpaces(true);
    setGChatSidebarError(null);
    try {
      const list = await listGoogleChatSpaces(token);
      setGChatSpaces(list);
      setGChatNeedsAuth(false);
    } catch (err) {
      setGChatSidebarError(err);
      if (err instanceof GoogleChatApiError && err.isAuthExpired) {
        setGChatNeedsAuth(true);
      }
    } finally {
      setGChatLoadingSpaces(false);
    }
  }, []);

  const loadGChatSpaceDetails = useCallback(
    async (space: GoogleChatSpace, tokenOverride?: string) => {
      const token = tokenOverride || getGoogleChatAccessToken();
      if (!token) {
        setGChatNeedsAuth(true);
        return;
      }
      setSelectedGChatSpace(space);
      setGChatLoadingMessages(true);
      setGChatConvError(null);
      try {
        const [msgs, members] = await Promise.all([
          listGoogleChatMessages(token, space.name),
          listGoogleChatMembers(token, space.name).catch(() => [] as GoogleChatMembership[]),
        ]);
        setGChatMessages(msgs);
        setGChatMembers(members);
      } catch (err) {
        setGChatConvError(err);
        if (err instanceof GoogleChatApiError && err.isAuthExpired) {
          setGChatNeedsAuth(true);
        }
      } finally {
        setGChatLoadingMessages(false);
      }
    },
    []
  );

  useEffect(() => {
    const unsubscribe = initGoogleChatAuth(
      (fbUser, token) => {
        setGChatUser(fbUser);
        setGChatNeedsAuth(false);
        void loadGChatSpaces(token);
      },
      () => {
        setGChatUser(null);
        setGChatNeedsAuth(true);
        setGChatSpaces([]);
        setSelectedGChatSpace(null);
        setGChatMessages([]);
        setGChatMembers([]);
      }
    );
    return () => unsubscribe();
  }, [loadGChatSpaces]);

  const handleGChatSignIn = async () => {
    setGChatSigningIn(true);
    setGChatSidebarError(null);
    try {
      const { user: fbUser, accessToken } = await googleChatSignIn();
      setGChatUser(fbUser);
      setGChatNeedsAuth(false);
      await loadGChatSpaces(accessToken);
    } catch (err) {
      setGChatSidebarError(err);
    } finally {
      setGChatSigningIn(false);
    }
  };

  const handleGChatSignOut = async () => {
    await googleChatSignOut();
    setGChatUser(null);
    setGChatNeedsAuth(true);
    setGChatSpaces([]);
    setSelectedGChatSpace(null);
    setGChatMessages([]);
    setGChatMembers([]);
    setGChatSidebarError(null);
    setGChatConvError(null);
  };

  const handleCreateSpaceRequest = (displayName: string, spaceType: 'SPACE' | 'GROUP_CHAT') => {
    setPendingGChatConfirm({
      title: 'Create Google Chat Space',
      description: `Create a new ${spaceType === 'GROUP_CHAT' ? 'Group Chat' : 'Space'} named "${displayName}" in your Google Workspace account?`,
      confirmLabel: 'Create Space',
      onConfirm: async () => {
        const token = getGoogleChatAccessToken();
        if (!token) {
          setGChatNeedsAuth(true);
          return;
        }
        const created = await createGoogleChatSpace(token, displayName, spaceType);
        await loadGChatSpaces(token);
        await loadGChatSpaceDetails(created, token);
      },
    });
  };

  const handleGChatSendMessageRequest = (text: string) => {
    if (!selectedGChatSpace) return;
    const space = selectedGChatSpace;
    setPendingGChatConfirm({
      title: 'Send Google Chat Message',
      description: `Post "${text}" to ${space.displayName || space.name}?`,
      confirmLabel: 'Send Message',
      onConfirm: async () => {
        const token = getGoogleChatAccessToken();
        if (!token) {
          setGChatNeedsAuth(true);
          return;
        }
        await sendGoogleChatMessage(token, space.name, text);
        await loadGChatSpaceDetails(space, token);
      },
    });
  };

  const handleGChatEditMessageRequest = (message: GoogleChatMessage, nextText: string) => {
    if (!selectedGChatSpace) return;
    const space = selectedGChatSpace;
    setPendingGChatConfirm({
      title: 'Edit Google Chat Message',
      description: `Update this message in Google Chat to "${nextText}"?`,
      confirmLabel: 'Save Edit',
      onConfirm: async () => {
        const token = getGoogleChatAccessToken();
        if (!token) {
          setGChatNeedsAuth(true);
          return;
        }
        await updateGoogleChatMessage(token, message.name, nextText);
        await loadGChatSpaceDetails(space, token);
      },
    });
  };

  const handleGChatDeleteMessageRequest = (message: GoogleChatMessage) => {
    if (!selectedGChatSpace) return;
    const space = selectedGChatSpace;
    setPendingGChatConfirm({
      title: 'Delete Google Chat Message',
      description: 'Permanently delete this message from Google Chat? This action cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: async () => {
        const token = getGoogleChatAccessToken();
        if (!token) {
          setGChatNeedsAuth(true);
          return;
        }
        await deleteGoogleChatMessage(token, message.name);
        await loadGChatSpaceDetails(space, token);
      },
    });
  };

  const handleGChatReactMessageRequest = (message: GoogleChatMessage, emoji: string) => {
    if (!selectedGChatSpace) return;
    const space = selectedGChatSpace;
    setPendingGChatConfirm({
      title: 'Add Reaction',
      description: `Add ${emoji} reaction to this Google Chat message?`,
      confirmLabel: `React ${emoji}`,
      onConfirm: async () => {
        const token = getGoogleChatAccessToken();
        if (!token) {
          setGChatNeedsAuth(true);
          return;
        }
        await createGoogleChatReaction(token, message.name, emoji);
        await loadGChatSpaceDetails(space, token);
      },
    });
  };

  const handleGChatDeleteSpaceRequest = (space: GoogleChatSpace) => {
    setPendingGChatConfirm({
      title: 'Delete Google Chat Space',
      description: `Permanently delete "${space.displayName || space.name}" and its conversation history? This cannot be undone.`,
      confirmLabel: 'Delete Space',
      destructive: true,
      onConfirm: async () => {
        const token = getGoogleChatAccessToken();
        if (!token) {
          setGChatNeedsAuth(true);
          return;
        }
        await deleteGoogleChatSpace(token, space.name);
        setSelectedGChatSpace(null);
        setGChatMessages([]);
        setGChatMembers([]);
        await loadGChatSpaces(token);
      },
    });
  };

  const executePendingGChatConfirm = async () => {
    if (!pendingGChatConfirm) return;
    setGChatConfirmBusy(true);
    try {
      await pendingGChatConfirm.onConfirm();
      setPendingGChatConfirm(null);
    } catch (err) {
      if (selectedGChatSpace) {
        setGChatConvError(err);
      } else {
        setGChatSidebarError(err);
      }
      if (err instanceof GoogleChatApiError && err.isAuthExpired) {
        setGChatNeedsAuth(true);
      }
      setPendingGChatConfirm(null);
    } finally {
      setGChatConfirmBusy(false);
    }
  };

  // Boot session check
  useEffect(() => {
    let cancelled = false;
    void apiRequest<{ user: OwnAccount }>('/auth/me')
      .then((res) => {
        if (cancelled) return;
        setUser(res.user);
        setTheme(res.user.theme || 'light');
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setBooting(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Initial data load when authenticated
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void Promise.all([
      refreshConversations(),
      refreshContacts(),
      refreshStatuses(),
      refreshStarred(),
    ]).catch((err) => {
      if (cancelled) return;
      if (err instanceof Error && err.message.toLowerCase().includes('authentication')) {
        setSessionToken(null);
        setUser(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id, refreshConversations, refreshContacts, refreshStatuses, refreshStarred]);

  // WebSocket real-time connection with auto-reconnect
  useEffect(() => {
    if (!user) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      return;
    }

    let closedIntentionally = false;
    let reconnectTimer: number | null = null;
    let pingTimer: number | null = null;
    let backoff = 1000;

    const connect = () => {
      if (closedIntentionally) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const token = getSessionToken();
      const wsUrl = token
        ? `${proto}//${window.location.host}/ws?token=${encodeURIComponent(token)}`
        : `${proto}//${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        backoff = 1000;
        void refreshConversations().catch(() => {});
        pingTimer = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 25000);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as { type: string; payload: unknown };
          if (msg.type === 'typing:update') {
            const p = msg.payload as TypingUser;
            const key = `${p.conversationId}:${p.userId}`;
            const oldTimer = typingExpiryTimers.current.get(key);
            if (oldTimer) {
              window.clearTimeout(oldTimer);
              typingExpiryTimers.current.delete(key);
            }

            setTypingByConv((prev) => {
              const existing = prev[p.conversationId] || [];
              const filtered = existing.filter((u) => u.userId !== p.userId);
              if (p.isTyping) {
                return { ...prev, [p.conversationId]: [...filtered, p] };
              }
              return { ...prev, [p.conversationId]: filtered };
            });

            if (p.isTyping) {
              const timer = window.setTimeout(() => {
                setTypingByConv((prev) => ({
                  ...prev,
                  [p.conversationId]: (prev[p.conversationId] || []).filter(
                    (u) => u.userId !== p.userId
                  ),
                }));
              }, 4500);
              typingExpiryTimers.current.set(key, timer);
            }
          } else if (msg.type === 'message:new') {
            const incoming = msg.payload as ChatMessage;
            const currentOpenId = activeConvIdRef.current;

            if (incoming.conversationId === currentOpenId) {
              setMessages((prev) => {
                if (prev.some((m) => m.id === incoming.id)) return prev;
                return [...prev, incoming];
              });
              if (incoming.senderId !== userRef.current?.id) {
                void apiRequest(`/conversations/${incoming.conversationId}/read`, {
                  method: 'POST',
                }).catch(() => {});
              }
            }

            // Immediately update existing conversation summary & move it to the top of chat list
            setConversations((prev) => {
              const exists = prev.some((c) => c.id === incoming.conversationId);
              if (!exists) return prev;
              const isOpen = incoming.conversationId === currentOpenId;
              const isIncomingFromPeer = incoming.senderId !== userRef.current?.id;
              const nextList = prev.map((c) => {
                if (c.id !== incoming.conversationId) return c;
                const nextUnread = isOpen
                  ? 0
                  : isIncomingFromPeer && incoming.type !== 'system'
                    ? c.unreadCount + 1
                    : c.unreadCount;
                return {
                  ...c,
                  lastMessage: incoming,
                  updatedAt: incoming.createdAt,
                  archived: false,
                  unreadCount: nextUnread,
                };
              });
              nextList.sort((a, b) => {
                if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
                return b.updatedAt.localeCompare(a.updatedAt);
              });
              return nextList;
            });

            // Desktop notification for incoming messages when not viewing or window unfocused
            if (
              incoming.senderId !== userRef.current?.id &&
              incoming.type !== 'system' &&
              typeof Notification !== 'undefined' &&
              Notification.permission === 'granted' &&
              (document.hidden || incoming.conversationId !== currentOpenId)
            ) {
              new Notification(`${incoming.senderDisplayName} (@${incoming.senderUsername})`, {
                body: incoming.content || `Sent a ${incoming.type}`,
              });
            }

            void refreshConversations().catch(() => {});
          } else if (msg.type === 'message:status') {
            const p = msg.payload as {
              conversationId: string;
              messageId: string;
              status: ChatMessage['status'];
            };
            if (p.conversationId === activeConvIdRef.current) {
              setMessages((prev) =>
                prev.map((m) => (m.id === p.messageId ? { ...m, status: p.status } : m))
              );
            }
            setConversations((prev) =>
              prev.map((c) =>
                c.id === p.conversationId && c.lastMessage?.id === p.messageId
                  ? { ...c, lastMessage: { ...c.lastMessage, status: p.status } }
                  : c
              )
            );
          } else if (msg.type === 'message:updated') {
            const updated = msg.payload as ChatMessage;
            if (updated.conversationId === activeConvIdRef.current) {
              setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
            }
            void refreshConversations();
          } else if (msg.type === 'message:reaction') {
            const p = msg.payload as {
              conversationId: string;
              messageId: string;
              reactions: ChatMessage['reactions'];
            };
            if (p.conversationId === activeConvIdRef.current) {
              setMessages((prev) =>
                prev.map((m) => (m.id === p.messageId ? { ...m, reactions: p.reactions } : m))
              );
            }
          } else if (msg.type === 'presence:update') {
            const p = msg.payload as {
              userId: string;
              isOnline: boolean;
              lastSeenAt: string | null;
            };
            setConversations((prev) =>
              prev.map((c) =>
                c.peer && c.peer.id === p.userId
                  ? { ...c, peer: { ...c.peer, isOnline: p.isOnline, lastSeenAt: p.lastSeenAt } }
                  : c
              )
            );
            setContacts((prev) =>
              prev.map((ct) =>
                ct.id === p.userId
                  ? { ...ct, isOnline: p.isOnline, lastSeenAt: p.lastSeenAt }
                  : ct
              )
            );
          } else if (
            msg.type === 'conversation:updated' ||
            msg.type === 'profile:updated' ||
            msg.type === 'contact:updated'
          ) {
            void refreshConversations().catch(() => {});
            void refreshContacts().catch(() => {});
          } else if (msg.type === 'status:new' || msg.type === 'status:viewed') {
            void refreshStatuses().catch(() => {});
          }
        } catch {
          // ignore malformed event
        }
      };

      ws.onclose = () => {
        if (pingTimer) {
          window.clearInterval(pingTimer);
          pingTimer = null;
        }
        if (!closedIntentionally) {
          reconnectTimer = window.setTimeout(connect, backoff);
          backoff = Math.min(backoff * 2, 10000);
        }
      };
    };

    connect();

    return () => {
      closedIntentionally = true;
      if (pingTimer) window.clearInterval(pingTimer);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [user?.id, refreshConversations, refreshContacts, refreshStatuses]);

  // Load messages when active conversation changes
  const openConversation = useCallback(
    async (convId: string) => {
      setSelectedGChatSpace(null);
      setActiveConvId(convId);
      setDrawerMode(null);
      setLoadingMessages(true);
      try {
        const res = await apiRequest<{ messages: ChatMessage[]; hasMore: boolean }>(
          `/conversations/${convId}/messages?limit=40`
        );
        setMessages(res.messages);
        setHasMoreMessages(res.hasMore);
        await apiRequest(`/conversations/${convId}/read`, { method: 'POST' });
        setConversations((prev) =>
          prev.map((c) => (c.id === convId ? { ...c, unreadCount: 0 } : c))
        );
      } catch {
        // ignore transient load failure
      } finally {
        setLoadingMessages(false);
      }
    },
    []
  );

  // Username discovery live search
  useEffect(() => {
    if (!user) return;
    const q = sidebarQuery.trim();
    if (!q || (activeTab !== 'contacts' && activeTab !== 'chats')) {
      setDiscoveredUsers([]);
      return;
    }
    let cancelled = false;
    setDiscovering(true);
    const timer = setTimeout(async () => {
      try {
        const res = await apiRequest<{ users: UserProfile[] }>(
          `/users/search?q=${encodeURIComponent(q)}`
        );
        if (!cancelled) setDiscoveredUsers(res.users);
      } catch {
        if (!cancelled) setDiscoveredUsers([]);
      } finally {
        if (!cancelled) setDiscovering(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sidebarQuery, activeTab, user]);

  const handleLoadMore = async () => {
    if (!activeConvId || messages.length === 0) return;
    setLoadingMessages(true);
    try {
      const oldest = messages[0].createdAt;
      const res = await apiRequest<{ messages: ChatMessage[]; hasMore: boolean }>(
        `/conversations/${activeConvId}/messages?before=${encodeURIComponent(oldest)}&limit=40`
      );
      setMessages((prev) => [...res.messages, ...prev]);
      setHasMoreMessages(res.hasMore);
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleSendMessage = async (payload: {
    type: 'text' | 'image' | 'video' | 'document' | 'audio';
    content?: string;
    mediaUrl?: string;
    mediaName?: string;
    mediaMime?: string;
    mediaSize?: number;
    mediaDuration?: number;
    replyToId?: string | null;
  }) => {
    if (!activeConvId) return;
    const res = await apiRequest<{ message: ChatMessage }>(
      `/conversations/${activeConvId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
    setMessages((prev) => {
      if (prev.some((m) => m.id === res.message.id)) return prev;
      return [...prev, res.message];
    });
    void refreshConversations();
  };

  const handleTypingSignal = (isTyping: boolean) => {
    if (!activeConvId || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(
      JSON.stringify({
        type: isTyping ? 'typing:start' : 'typing:stop',
        conversationId: activeConvId,
      })
    );
  };

  const handleReactMessage = async (messageId: string, emoji: string) => {
    const res = await apiRequest<{ message: ChatMessage }>(`/messages/${messageId}/react`, {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    });
    setMessages((prev) => prev.map((m) => (m.id === messageId ? res.message : m)));
  };

  const handleEditMessage = async (messageId: string, content: string) => {
    const res = await apiRequest<{ message: ChatMessage }>(`/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    });
    setMessages((prev) => prev.map((m) => (m.id === messageId ? res.message : m)));
    void refreshConversations();
  };

  const handleDeleteMessage = async (messageId: string) => {
    const res = await apiRequest<{ message: ChatMessage }>(`/messages/${messageId}`, {
      method: 'DELETE',
    });
    setMessages((prev) => prev.map((m) => (m.id === messageId ? res.message : m)));
    void refreshConversations();
  };

  const handleStarMessage = async (messageId: string) => {
    const res = await apiRequest<{ isStarred: boolean }>(`/messages/${messageId}/star`, {
      method: 'POST',
    });
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, isStarred: res.isStarred } : m))
    );
    void refreshStarred();
  };

  const handleForwardMessage = async (targetConvId: string, original: ChatMessage) => {
    await apiRequest(`/conversations/${targetConvId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        type: original.type === 'system' ? 'text' : original.type,
        content: original.content,
        mediaUrl: original.mediaUrl,
        mediaName: original.mediaName,
        mediaMime: original.mediaMime,
        mediaSize: original.mediaSize,
        mediaDuration: original.mediaDuration,
        forwardedFromId: original.id,
      }),
    });
    await refreshConversations();
    await openConversation(targetConvId);
  };

  const handleStartDirectByUser = async (targetUser: UserProfile) => {
    const res = await apiRequest<{ conversation: ConversationSummary }>('/conversations/direct', {
      method: 'POST',
      body: JSON.stringify({ userId: targetUser.id }),
    });
    setInspectedProfile(null);
    await refreshConversations();
    setActiveTab('chats');
    await openConversation(res.conversation.id);
  };

  const handleStartDirectExactUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    setExactError(null);
    if (!exactUsernameInput.trim()) return;
    try {
      const res = await apiRequest<{ profile: UserProfile }>(
        `/users/${encodeURIComponent(exactUsernameInput.trim().replace(/^@+/, ''))}`
      );
      setExactUsernameInput('');
      setInspectedProfile(res.profile);
    } catch (err) {
      setExactError(err instanceof Error ? err.message : 'User not found.');
    }
  };

  const handleToggleNotifications = async () => {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'granted') {
      setNotificationsEnabled((v) => !v);
      return;
    }
    const perm = await Notification.requestPermission();
    setNotificationsEnabled(perm === 'granted');
  };

  const handleLogout = async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } catch {
      // clear client session even if request fails
    }
    setSessionToken(null);
    setUser(null);
    setConversations([]);
    setActiveConvId(null);
    setMessages([]);
  };

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConvId) || null,
    [conversations, activeConvId]
  );

  const visibleConversations = useMemo(() => {
    const q = sidebarQuery.trim().toLowerCase();
    return conversations.filter((c) => {
      if (activeTab === 'archived') {
        if (!c.archived) return false;
      } else if (activeTab === 'groups') {
        if (c.type !== 'group' || c.archived) return false;
      } else {
        if (c.archived) return false;
        if (chatFilter === 'unread' && c.unreadCount === 0) return false;
        if (chatFilter === 'groups' && c.type !== 'group') return false;
      }
      if (!q) return true;
      return (
        c.title.toLowerCase().includes(q) ||
        c.subtitle.toLowerCase().includes(q) ||
        (c.lastMessage?.content || '').toLowerCase().includes(q)
      );
    });
  }, [conversations, activeTab, chatFilter, sidebarQuery]);

  const totalUnread = useMemo(
    () => conversations.filter((c) => !c.archived).reduce((sum, c) => sum + c.unreadCount, 0),
    [conversations]
  );

  const archivedCount = useMemo(
    () => conversations.filter((c) => c.archived).length,
    [conversations]
  );

  const hasUnviewedStatuses = useMemo(
    () => statusGroups.some((g) => !g.isMine && g.hasUnviewed),
    [statusGroups]
  );

  if (booting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F0F2F5] dark:bg-[#0B141A]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-[#00A884] text-white flex items-center justify-center shadow-md">
            <MessageSquare className="w-6 h-6" />
          </div>
          <span className="text-sm font-medium text-[#54656F] dark:text-[#8696A0]">
            Loading Willow...
          </span>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <AuthView
        theme={theme}
        onToggleTheme={() => void toggleTheme()}
        onAuthenticated={(loggedInUser, token) => {
          if (token) setSessionToken(token);
          setUser(loggedInUser);
          setTheme(loggedInUser.theme || theme);
        }}
      />
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#F0F2F5] dark:bg-[#0B141A] flex flex-col">
      {/* Main Workspace */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Desktop & Tablet Navigation Rail */}
        <nav className="hidden md:flex w-16 shrink-0 bg-[#F0F2F5] dark:bg-[#202C33] border-r border-[#D1D7DB] dark:border-[#222E35] flex-col items-center justify-between py-3">
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('chats')}
              className={`relative w-11 h-11 rounded-xl flex items-center justify-center transition-colors ${
                activeTab === 'chats'
                  ? 'bg-[#00A884]/15 text-[#00A884]'
                  : 'text-[#54656F] dark:text-[#8696A0] hover:bg-black/5 dark:hover:bg-white/10'
              }`}
              title="Chats"
            >
              <MessageSquare className="w-5 h-5" />
              {totalUnread > 0 && (
                <span className="absolute top-1 right-1 min-w-[17px] h-[17px] px-1 rounded-full bg-[#00A884] text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                  {totalUnread > 99 ? '99+' : totalUnread}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('status')}
              className={`relative w-11 h-11 rounded-xl flex items-center justify-center transition-colors ${
                activeTab === 'status'
                  ? 'bg-[#00A884]/15 text-[#00A884]'
                  : 'text-[#54656F] dark:text-[#8696A0] hover:bg-black/5 dark:hover:bg-white/10'
              }`}
              title="Status updates"
            >
              <CircleDashed className="w-5 h-5" />
              {hasUnviewedStatuses && (
                <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[#00A884]" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('groups')}
              className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors ${
                activeTab === 'groups'
                  ? 'bg-[#00A884]/15 text-[#00A884]'
                  : 'text-[#54656F] dark:text-[#8696A0] hover:bg-black/5 dark:hover:bg-white/10'
              }`}
              title="Groups"
            >
              <Users className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('contacts')}
              className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors ${
                activeTab === 'contacts'
                  ? 'bg-[#00A884]/15 text-[#00A884]'
                  : 'text-[#54656F] dark:text-[#8696A0] hover:bg-black/5 dark:hover:bg-white/10'
              }`}
              title="Find @username & Contacts"
            >
              <UserPlus className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('starred');
                void refreshStarred();
              }}
              className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors ${
                activeTab === 'starred'
                  ? 'bg-[#00A884]/15 text-[#00A884]'
                  : 'text-[#54656F] dark:text-[#8696A0] hover:bg-black/5 dark:hover:bg-white/10'
              }`}
              title="Starred messages"
            >
              <Star className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('archived')}
              className={`relative w-11 h-11 rounded-xl flex items-center justify-center transition-colors ${
                activeTab === 'archived'
                  ? 'bg-[#00A884]/15 text-[#00A884]'
                  : 'text-[#54656F] dark:text-[#8696A0] hover:bg-black/5 dark:hover:bg-white/10'
              }`}
              title="Archived chats"
            >
              <Archive className="w-5 h-5" />
              {archivedCount > 0 && (
                <span className="absolute top-1 right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-[#54656F] text-white text-[9px] font-bold flex items-center justify-center tabular-nums">
                  {archivedCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('gchat');
                setActiveConvId(null);
              }}
              className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors ${
                activeTab === 'gchat'
                  ? 'bg-[#00A884]/15 text-[#00A884]'
                  : 'text-[#54656F] dark:text-[#8696A0] hover:bg-black/5 dark:hover:bg-white/10'
              }`}
              title="Google Chat"
            >
              <MessagesSquare className="w-5 h-5" />
            </button>
          </div>

          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => void toggleTheme()}
              className="w-11 h-11 rounded-xl flex items-center justify-center text-[#54656F] dark:text-[#8696A0] hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors ${
                activeTab === 'settings'
                  ? 'bg-[#00A884]/15 text-[#00A884]'
                  : 'text-[#54656F] dark:text-[#8696A0] hover:bg-black/5 dark:hover:bg-white/10'
              }`}
              title="Settings"
            >
              <Settings className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className="p-0.5 rounded-full hover:ring-2 hover:ring-[#00A884] transition-all"
              title={`@${user.username}`}
            >
              <Avatar src={user.avatarUrl} name={user.displayName} size="sm" isOnline />
            </button>
          </div>
        </nav>

        {/* Left Sidebar Panel */}
        <aside
          className={`${
            activeConvId || (activeTab === 'gchat' && selectedGChatSpace) ? 'hidden md:flex' : 'flex'
          } w-full md:w-[340px] lg:w-[385px] shrink-0 flex-col bg-white dark:bg-[#111B21] border-r border-[#D1D7DB] dark:border-[#222E35] h-full`}
        >
          {activeTab === 'gchat' ? (
            <GoogleChatSidebar
              googleUser={gchatUser}
              needsAuth={gchatNeedsAuth}
              signingIn={gchatSigningIn}
              spaces={gchatSpaces}
              selectedSpace={selectedGChatSpace}
              loadingSpaces={gchatLoadingSpaces}
              error={gchatSidebarError}
              onSignIn={() => void handleGChatSignIn()}
              onSignOut={() => void handleGChatSignOut()}
              onRefreshSpaces={() => void loadGChatSpaces()}
              onSelectSpace={(space) => {
                setActiveConvId(null);
                void loadGChatSpaceDetails(space);
              }}
              onCreateSpaceRequest={handleCreateSpaceRequest}
            />
          ) : activeTab === 'status' ? (
            <StatusPanel
              currentUser={user}
              statusGroups={statusGroups}
              onRefresh={refreshStatuses}
            />
          ) : activeTab === 'settings' ? (
            <SettingsPanel
              user={user}
              conversations={conversations}
              notificationsEnabled={notificationsEnabled}
              onToggleNotifications={() => void handleToggleNotifications()}
              onUserUpdated={(updated) => {
                setUser(updated);
                setTheme(updated.theme);
              }}
              onLogout={() => void handleLogout()}
              onAccountDeleted={() => {
                setSessionToken(null);
                setUser(null);
                setConversations([]);
                setActiveConvId(null);
              }}
            />
          ) : activeTab === 'starred' ? (
            <div className="flex flex-col h-full">
              <div className="px-4 py-3.5 border-b border-[#E9EDEF] dark:border-[#222E35]">
                <h2 className="font-display text-lg font-bold text-[#111B21] dark:text-[#E9EDEF]">
                  Starred Messages
                </h2>
                <p className="text-xs text-[#54656F] dark:text-[#8696A0]">
                  Saved messages across your conversations
                </p>
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-[#E9EDEF] dark:divide-[#222E35]">
                {starredMessages.length === 0 ? (
                  <div className="p-8 text-center text-xs text-[#54656F] dark:text-[#8696A0]">
                    No starred messages yet. Hover any message and click the star icon to save it here.
                  </div>
                ) : (
                  starredMessages.map((msg) => (
                    <button
                      key={msg.id}
                      type="button"
                      onClick={() => {
                        void openConversation(msg.conversationId).then(() => {
                          setJumpMessageId(msg.id);
                        });
                      }}
                      className="w-full p-4 text-left hover:bg-[#F0F2F5] dark:hover:bg-[#202C33] transition-colors space-y-1.5"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-[#111B21] dark:text-[#E9EDEF]">
                          {msg.senderDisplayName}{' '}
                          <span className="font-mono font-normal text-[#00A884]">
                            @{msg.senderUsername}
                          </span>
                        </span>
                        <span className="text-[#54656F] dark:text-[#8696A0] tabular-nums">
                          {formatTime(msg.createdAt)}
                        </span>
                      </div>
                      <p className="text-sm text-[#111B21] dark:text-[#E9EDEF] line-clamp-2">
                        {msg.content || msg.mediaName || msg.type}
                      </p>
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : activeTab === 'contacts' ? (
            <div className="flex flex-col h-full">
              <div className="px-4 py-3.5 border-b border-[#E9EDEF] dark:border-[#222E35] space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-lg font-bold text-[#111B21] dark:text-[#E9EDEF]">
                    Find by @username
                  </h2>
                  <button
                    type="button"
                    onClick={() => setNewGroupOpen(true)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#00A884]/15 text-[#008F6F] dark:text-[#00A884] text-xs font-semibold"
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span>New Group</span>
                  </button>
                </div>

                {/* Exact Username Lookup */}
                <form onSubmit={handleStartDirectExactUsername} className="flex gap-2">
                  <div className="relative flex-1 flex items-center">
                    <AtSign className="w-4 h-4 text-[#54656F] dark:text-[#8696A0] absolute left-3 pointer-events-none" />
                    <input
                      type="text"
                      value={exactUsernameInput}
                      onChange={(e) => {
                        setExactUsernameInput(e.target.value);
                        setExactError(null);
                      }}
                      placeholder="Enter exact username..."
                      className="w-full pl-8 pr-3 py-2 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-sm text-[#111B21] dark:text-[#E9EDEF] focus:outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    className="px-3.5 py-2 rounded-xl bg-[#00A884] hover:bg-[#008F6F] text-white text-xs font-semibold shrink-0"
                  >
                    Open
                  </button>
                </form>
                {exactError && <p className="text-xs text-red-500">{exactError}</p>}

                {/* Live Username Search */}
                <div className="relative flex items-center">
                  <Search className="w-4 h-4 text-[#54656F] dark:text-[#8696A0] absolute left-3 pointer-events-none" />
                  <input
                    type="text"
                    value={sidebarQuery}
                    onChange={(e) => setSidebarQuery(e.target.value)}
                    placeholder="Search people by username or name..."
                    className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-sm text-[#111B21] dark:text-[#E9EDEF] focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto divide-y divide-[#E9EDEF] dark:divide-[#222E35]">
                {sidebarQuery.trim() ? (
                  discovering ? (
                    <div className="p-6 text-center text-xs text-[#54656F] dark:text-[#8696A0]">
                      Searching users...
                    </div>
                  ) : discoveredUsers.length === 0 ? (
                    <div className="p-6 text-center text-xs text-[#54656F] dark:text-[#8696A0]">
                      No users found matching &ldquo;{sidebarQuery}&rdquo;.
                    </div>
                  ) : (
                    discoveredUsers.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => setInspectedProfile(u)}
                        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-[#F0F2F5] dark:hover:bg-[#202C33] transition-colors text-left"
                      >
                        <Avatar src={u.avatarUrl} name={u.displayName} size="md" isOnline={u.isOnline} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-[#111B21] dark:text-[#E9EDEF] truncate">
                            {highlightMatch(u.displayName, sidebarQuery)}
                          </div>
                          <div className="text-xs font-mono text-[#00A884] truncate">
                            @{highlightMatch(u.username, sidebarQuery)}
                          </div>
                        </div>
                      </button>
                    ))
                  )
                ) : (
                  <>
                    <div className="px-4 py-2 text-xs font-semibold text-[#54656F] dark:text-[#8696A0] bg-[#F7F8FA] dark:bg-[#111B21]">
                      Saved Contacts ({contacts.length})
                    </div>
                    {contacts.length === 0 ? (
                      <div className="p-8 text-center text-xs text-[#54656F] dark:text-[#8696A0]">
                        Search any @username above to inspect their profile, add them as a contact, or start a chat.
                      </div>
                    ) : (
                      contacts.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setInspectedProfile(c)}
                          className="w-full px-4 py-3 flex items-center gap-3 hover:bg-[#F0F2F5] dark:hover:bg-[#202C33] transition-colors text-left"
                        >
                          <Avatar src={c.avatarUrl} name={c.displayName} size="md" isOnline={c.isOnline} />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-[#111B21] dark:text-[#E9EDEF] truncate">
                              {c.displayName}
                            </div>
                            <div className="text-xs font-mono text-[#54656F] dark:text-[#8696A0] truncate">
                              @{c.username}
                            </div>
                          </div>
                        </button>
                      ))
                    )}
                  </>
                )}
              </div>
            </div>
          ) : (
            /* Chats / Groups / Archived List */
            <div className="flex flex-col h-full">
              <div className="px-4 py-3.5 border-b border-[#E9EDEF] dark:border-[#222E35] space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-xl font-bold text-[#111B21] dark:text-[#E9EDEF]">
                    {activeTab === 'archived'
                      ? 'Archived'
                      : activeTab === 'groups'
                        ? 'Groups'
                        : 'Willow'}
                  </h2>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setActiveTab('contacts')}
                      className="p-2 rounded-full hover:bg-[#F0F2F5] dark:hover:bg-[#202C33] text-[#54656F] dark:text-[#8696A0]"
                      title="New chat by @username"
                    >
                      <MessageSquarePlus className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewGroupOpen(true)}
                      className="p-2 rounded-full hover:bg-[#F0F2F5] dark:hover:bg-[#202C33] text-[#54656F] dark:text-[#8696A0]"
                      title="Create group"
                    >
                      <Users className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                <div className="relative flex items-center">
                  <Search className="w-4 h-4 text-[#54656F] dark:text-[#8696A0] absolute left-3 pointer-events-none" />
                  <input
                    type="text"
                    value={sidebarQuery}
                    onChange={(e) => setSidebarQuery(e.target.value)}
                    placeholder="Search chats or @username..."
                    className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-sm text-[#111B21] dark:text-[#E9EDEF] placeholder-[#54656F] dark:placeholder-[#8696A0] focus:outline-none"
                  />
                </div>

                {activeTab === 'chats' && (
                  <div className="flex items-center gap-1.5">
                    {(['all', 'unread', 'groups'] as const).map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setChatFilter(f)}
                        className={`px-3 py-1 rounded-lg text-xs font-medium capitalize transition-colors ${
                          chatFilter === f
                            ? 'bg-[#00A884]/15 text-[#008F6F] dark:text-[#00A884]'
                            : 'bg-[#F0F2F5] dark:bg-[#202C33] text-[#54656F] dark:text-[#8696A0] hover:text-[#111B21]'
                        }`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto divide-y divide-[#E9EDEF]/60 dark:divide-[#222E35]/60">
                {visibleConversations.length === 0 ? (
                  <div className="p-8 text-center space-y-3">
                    <p className="text-xs text-[#54656F] dark:text-[#8696A0]">
                      {activeTab === 'archived'
                        ? 'No archived chats.'
                        : activeTab === 'groups'
                          ? 'You are not in any groups yet.'
                          : 'No conversations yet. Find someone by @username to start chatting!'}
                    </p>
                    {activeTab !== 'archived' && (
                      <button
                        type="button"
                        onClick={() =>
                          activeTab === 'groups' ? setNewGroupOpen(true) : setActiveTab('contacts')
                        }
                        className="px-4 py-2 rounded-xl bg-[#00A884] text-white text-xs font-semibold"
                      >
                        {activeTab === 'groups' ? 'Create Group' : 'Find @username'}
                      </button>
                    )}
                  </div>
                ) : (
                  visibleConversations.map((c) => {
                    const isActive = c.id === activeConvId;
                    const convTyping = typingByConv[c.id] || [];
                    const lm = c.lastMessage;
                    const lmPreview = lm
                      ? lm.isDeleted
                        ? 'This message was deleted'
                        : lm.content ||
                          (lm.type === 'image'
                            ? 'Photo'
                            : lm.type === 'video'
                              ? 'Video'
                              : lm.type === 'audio'
                                ? 'Voice message'
                                : lm.mediaName || 'Attachment')
                      : c.subtitle;

                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => void openConversation(c.id)}
                        className={`w-full px-3.5 py-3 flex items-center gap-3 text-left transition-colors ${
                          isActive
                            ? 'bg-[#F0F2F5] dark:bg-[#2A3942]'
                            : 'hover:bg-[#F5F6F6] dark:hover:bg-[#202C33]'
                        }`}
                      >
                        <Avatar
                          src={c.avatarUrl}
                          name={c.title}
                          size="md"
                          isGroup={c.type === 'group'}
                          isOnline={c.peer?.isOnline}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-[#111B21] dark:text-[#E9EDEF] truncate">
                              {highlightMatch(c.title, sidebarQuery)}
                              {sidebarQuery.trim() && c.peer && (
                                <span className="ml-1.5 text-xs font-mono font-normal text-[#54656F] dark:text-[#8696A0]">
                                  @{highlightMatch(c.peer.username, sidebarQuery)}
                                </span>
                              )}
                            </span>
                            <span
                              className={`text-[11px] tabular-nums shrink-0 ${
                                c.unreadCount > 0
                                  ? 'text-[#00A884] font-semibold'
                                  : 'text-[#54656F] dark:text-[#8696A0]'
                              }`}
                            >
                              {formatConversationTime(c.updatedAt)}
                            </span>
                          </div>

                          <div className="flex items-center justify-between gap-2 mt-0.5">
                            <div className="flex items-center gap-1 min-w-0 text-xs">
                              {convTyping.length > 0 ? (
                                <span className="text-[#00A884] font-semibold truncate">
                                  {c.type === 'group'
                                    ? `@${convTyping[0].username} is typing...`
                                    : 'typing...'}
                                </span>
                              ) : (
                                <>
                                  {lm && lm.senderId === user.id && !lm.isDeleted && lm.type !== 'system' && (
                                    <span className="shrink-0 text-[#54656F] dark:text-[#8696A0]">
                                      {lm.status === 'read' ? (
                                        <CheckCheck className="w-3.5 h-3.5 text-[#53BDEB]" />
                                      ) : lm.status === 'delivered' ? (
                                        <CheckCheck className="w-3.5 h-3.5" />
                                      ) : (
                                        <Check className="w-3.5 h-3.5" />
                                      )}
                                    </span>
                                  )}
                                  <span className="text-[#54656F] dark:text-[#8696A0] truncate">
                                    {highlightMatch(lmPreview, sidebarQuery)}
                                  </span>
                                </>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              {c.muted && <VolumeX className="w-3.5 h-3.5 text-[#8696A0]" />}
                              {c.pinned && <Pin className="w-3.5 h-3.5 text-[#8696A0]" />}
                              {c.unreadCount > 0 && (
                                <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#00A884] text-white text-[11px] font-bold flex items-center justify-center tabular-nums">
                                  {c.unreadCount}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}

                {/* Quick username discovery results directly in Chats search */}
                {activeTab === 'chats' && sidebarQuery.trim() && discoveredUsers.length > 0 && (
                  <div className="pt-2">
                    <div className="px-4 py-1.5 text-[11px] font-semibold text-[#00A884] bg-[#F7F8FA] dark:bg-[#111B21]">
                      People on Willow
                    </div>
                    {discoveredUsers.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => setInspectedProfile(u)}
                        className="w-full px-3.5 py-2.5 flex items-center gap-3 hover:bg-[#F5F6F6] dark:hover:bg-[#202C33] text-left"
                      >
                        <Avatar src={u.avatarUrl} name={u.displayName} size="sm" isOnline={u.isOnline} />
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-[#111B21] dark:text-[#E9EDEF] truncate">
                            {highlightMatch(u.displayName, sidebarQuery)}
                          </div>
                          <div className="text-xs font-mono text-[#00A884] truncate">
                            @{highlightMatch(u.username, sidebarQuery)}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </aside>

        {/* Right Active Conversation or Empty State */}
        <main
          className={`${
            activeConvId || (activeTab === 'gchat' && selectedGChatSpace) ? 'flex' : 'hidden md:flex'
          } flex-1 min-w-0 h-full bg-[#EFEAE2] dark:bg-[#0B141A]`}
        >
          {activeTab === 'gchat' && selectedGChatSpace ? (
            <GoogleChatConversation
              space={selectedGChatSpace}
              messages={gchatMessages}
              members={gchatMembers}
              loadingMessages={gchatLoadingMessages}
              error={gchatConvError}
              onBack={() => setSelectedGChatSpace(null)}
              onRefresh={() => void loadGChatSpaceDetails(selectedGChatSpace)}
              onRequestSendMessage={handleGChatSendMessageRequest}
              onRequestEditMessage={handleGChatEditMessageRequest}
              onRequestDeleteMessage={handleGChatDeleteMessageRequest}
              onRequestReactMessage={handleGChatReactMessageRequest}
              onRequestDeleteSpace={handleGChatDeleteSpaceRequest}
            />
          ) : activeTab === 'gchat' ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#F8F9FA] dark:bg-[#222E35]">
              <div className="max-w-sm space-y-4">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-[#00A884]/15 text-[#00A884] flex items-center justify-center">
                  <MessagesSquare className="w-7 h-7" />
                </div>
                <div className="space-y-1.5">
                  <h2 className="font-display text-xl font-bold text-[#111B21] dark:text-[#E9EDEF]">
                    Google Chat
                  </h2>
                  <p className="text-xs text-[#54656F] dark:text-[#8696A0] leading-relaxed">
                    {gchatNeedsAuth
                      ? 'Sign in with your Google Workspace Business or Enterprise account to browse spaces and exchange messages.'
                      : 'Select a Google Chat space from the sidebar or create a new one.'}
                  </p>
                </div>
                {gchatNeedsAuth && (
                  <div className="pt-1">
                    <GoogleSignInButton
                      onClick={() => void handleGChatSignIn()}
                      disabled={gchatSigningIn}
                    />
                  </div>
                )}
              </div>
            </div>
          ) : activeConversation ? (
            <div className="flex-1 flex min-w-0 h-full">
              <ChatArea
                conversation={activeConversation}
                messages={messages}
                hasMore={hasMoreMessages}
                loadingMessages={loadingMessages}
                currentUserId={user.id}
                typingUsers={typingByConv[activeConversation.id] || []}
                jumpMessageId={jumpMessageId}
                onClearJump={() => setJumpMessageId(null)}
                onBack={() => setActiveConvId(null)}
                onLoadMore={handleLoadMore}
                onSendMessage={handleSendMessage}
                onTypingSignal={handleTypingSignal}
                onReactMessage={handleReactMessage}
                onEditMessage={handleEditMessage}
                onDeleteMessage={handleDeleteMessage}
                onStarMessage={handleStarMessage}
                onForwardRequest={(m) => setForwardingMessage(m)}
                onOpenDrawer={(mode) => setDrawerMode((cur) => (cur === mode ? null : mode))}
                onToggleArchive={async () => {
                  await apiRequest(`/conversations/${activeConversation.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ archived: !activeConversation.archived }),
                  });
                  await refreshConversations();
                  if (!activeConversation.archived) setActiveConvId(null);
                }}
                onTogglePin={async () => {
                  await apiRequest(`/conversations/${activeConversation.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ pinned: !activeConversation.pinned }),
                  });
                  await refreshConversations();
                }}
                onToggleMute={async () => {
                  await apiRequest(`/conversations/${activeConversation.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ muted: !activeConversation.muted }),
                  });
                  await refreshConversations();
                }}
                onExportChat={async () => {
                  const res = await apiRequest<Record<string, unknown>>(
                    `/conversations/${activeConversation.id}/export`
                  );
                  const blob = new Blob([JSON.stringify(res, null, 2)], {
                    type: 'application/json',
                  });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `willow-chat-${activeConversation.id}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              />

              {drawerMode && (
                <InfoDrawer
                  mode={drawerMode}
                  conversation={activeConversation}
                  currentUserId={user.id}
                  onClose={() => setDrawerMode(null)}
                  onRefreshConversation={refreshConversations}
                  onJumpToMessage={(id) => setJumpMessageId(id)}
                  onLeftGroup={() => {
                    setDrawerMode(null);
                    setActiveConvId(null);
                    void refreshConversations();
                  }}
                />
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#F8F9FA] dark:bg-[#222E35]">
              <div className="max-w-md space-y-5">
                <img
                  src="/src/assets/images/welcome_hero_card_1795381202408.jpg"
                  alt="Willow Web"
                  referrerPolicy="no-referrer"
                  className="w-72 h-48 mx-auto rounded-2xl object-cover border border-[#E9EDEF] dark:border-[#2A3942] shadow-xs"
                />
                <div className="space-y-2">
                  <h2 className="font-display text-2xl font-bold text-[#111B21] dark:text-[#E9EDEF]">
                    Willow Web
                  </h2>
                  <p className="text-sm text-[#54656F] dark:text-[#8696A0] leading-relaxed">
                    Signed in as <span className="font-mono font-semibold text-[#00A884]">@{user.username}</span>.
                    Select a conversation on the left or find someone by their unique username.
                  </p>
                </div>
                <div className="flex items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => setActiveTab('contacts')}
                    className="px-4 py-2.5 rounded-xl bg-[#00A884] hover:bg-[#008F6F] text-white text-xs font-semibold transition-colors"
                  >
                    Find @username
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewGroupOpen(true)}
                    className="px-4 py-2.5 rounded-xl border border-[#D1D7DB] dark:border-[#2A3942] bg-white dark:bg-[#202C33] text-xs font-semibold text-[#111B21] dark:text-[#E9EDEF] hover:bg-[#F0F2F5] dark:hover:bg-[#2A3942] transition-colors"
                  >
                    Create Group
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Mobile Bottom Tab Navigation (hidden when chat is open) */}
      {!activeConvId && !(activeTab === 'gchat' && selectedGChatSpace) && (
        <nav className="md:hidden h-14 shrink-0 bg-white dark:bg-[#202C33] border-t border-[#D1D7DB] dark:border-[#222E35] grid grid-cols-6 items-center">
          {(
            [
              { id: 'chats', label: 'Chats', icon: MessageSquare },
              { id: 'status', label: 'Status', icon: CircleDashed },
              { id: 'groups', label: 'Groups', icon: Users },
              { id: 'contacts', label: 'People', icon: UserPlus },
              { id: 'gchat', label: 'G Chat', icon: MessagesSquare },
              { id: 'settings', label: 'Settings', icon: Settings },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  if (item.id === 'gchat') setActiveConvId(null);
                }}
                className={`flex flex-col items-center justify-center h-full text-[10px] font-medium ${
                  active ? 'text-[#00A884]' : 'text-[#54656F] dark:text-[#8696A0]'
                }`}
              >
                <Icon className="w-5 h-5 mb-0.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      )}

      {/* Modals */}
      {inspectedProfile && (
        <UserProfileModal
          profile={inspectedProfile}
          onClose={() => setInspectedProfile(null)}
          onStartChat={(u) => void handleStartDirectByUser(u)}
          onProfileChanged={() => {
            void refreshContacts();
            void refreshConversations();
          }}
        />
      )}

      {newGroupOpen && (
        <NewGroupModal
          contacts={contacts}
          onClose={() => setNewGroupOpen(false)}
          onCreated={(conv) => {
            setNewGroupOpen(false);
            void refreshConversations().then(() => openConversation(conv.id));
          }}
        />
      )}

      {forwardingMessage && (
        <ForwardModal
          message={forwardingMessage}
          conversations={conversations}
          onClose={() => setForwardingMessage(null)}
          onForward={handleForwardMessage}
        />
      )}

      {pendingGChatConfirm && (
        <ConfirmMutationModal
          request={pendingGChatConfirm}
          busy={gchatConfirmBusy}
          onCancel={() => {
            if (!gchatConfirmBusy) setPendingGChatConfirm(null);
          }}
          onConfirm={() => void executePendingGChatConfirm()}
        />
      )}
    </div>
  );
}

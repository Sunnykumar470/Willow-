import React, { useEffect, useState } from 'react';
import {
  Ban,
  FileText,
  LogOut,
  Search,
  Shield,
  ShieldOff,
  UserMinus,
  UserPlus,
  X,
} from 'lucide-react';
import { apiRequest } from '../lib/api.ts';
import { formatLastSeen, formatTime } from '../lib/format.ts';
import type { ChatMessage, ConversationSummary, GroupMember } from '../types.ts';
import { Avatar } from './Avatar.tsx';

interface InfoDrawerProps {
  mode: 'info' | 'search';
  conversation: ConversationSummary;
  currentUserId: string;
  onClose: () => void;
  onRefreshConversation: () => Promise<void>;
  onJumpToMessage: (messageId: string) => void;
  onLeftGroup: () => void;
}

export const InfoDrawer: React.FC<InfoDrawerProps> = ({
  mode,
  conversation,
  currentUserId,
  onClose,
  onRefreshConversation,
  onJumpToMessage,
  onLeftGroup,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ChatMessage[]>([]);
  const [searching, setSearching] = useState(false);

  const [members, setMembers] = useState<GroupMember[]>([]);
  const [sharedMedia, setSharedMedia] = useState<ChatMessage[]>([]);
  const [addMemberUsername, setAddMemberUsername] = useState('');
  const [groupName, setGroupName] = useState(conversation.group?.name || '');
  const [groupDesc, setGroupDesc] = useState(conversation.group?.description || '');
  const [editingGroup, setEditingGroup] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setGroupName(conversation.group?.name || '');
    setGroupDesc(conversation.group?.description || '');
  }, [conversation.id, conversation.group?.name, conversation.group?.description]);

  useEffect(() => {
    if (mode !== 'info') return;
    let cancelled = false;
    void Promise.all([
      apiRequest<{ members: GroupMember[] }>(`/conversations/${conversation.id}`),
      apiRequest<{ items: ChatMessage[] }>(`/conversations/${conversation.id}/media`),
    ])
      .then(([detailRes, mediaRes]) => {
        if (cancelled) return;
        setMembers(detailRes.members || []);
        setSharedMedia(mediaRes.items || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [mode, conversation.id]);

  useEffect(() => {
    if (mode !== 'search') return;
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await apiRequest<{ messages: ChatMessage[] }>(
          `/conversations/${conversation.id}/messages?q=${encodeURIComponent(q)}&limit=50`
        );
        if (!cancelled) setSearchResults(res.messages);
      } catch {
        if (!cancelled) setSearchResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mode, searchQuery, conversation.id]);

  const reloadDetails = async () => {
    const res = await apiRequest<{ members: GroupMember[] }>(`/conversations/${conversation.id}`);
    setMembers(res.members || []);
    await onRefreshConversation();
  };

  const handleToggleContact = async () => {
    if (!conversation.peer) return;
    setBusy(true);
    try {
      if (conversation.peer.isContact) {
        await apiRequest(`/contacts/${conversation.peer.id}`, { method: 'DELETE' });
      } else {
        await apiRequest('/contacts', {
          method: 'POST',
          body: JSON.stringify({ userId: conversation.peer.id }),
        });
      }
      await onRefreshConversation();
    } finally {
      setBusy(false);
    }
  };

  const handleToggleBlock = async () => {
    if (!conversation.peer) return;
    setBusy(true);
    try {
      if (conversation.peer.isBlocked) {
        await apiRequest(`/blocks/${conversation.peer.id}`, { method: 'DELETE' });
      } else {
        await apiRequest('/blocks', {
          method: 'POST',
          body: JSON.stringify({ userId: conversation.peer.id }),
        });
      }
      await onRefreshConversation();
    } finally {
      setBusy(false);
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addMemberUsername.trim()) return;
    setBusy(true);
    setFeedback(null);
    try {
      await apiRequest(`/conversations/${conversation.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ username: addMemberUsername.trim() }),
      });
      setAddMemberUsername('');
      await reloadDetails();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Failed to add member');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveGroupInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      await apiRequest(`/conversations/${conversation.id}/group`, {
        method: 'PATCH',
        body: JSON.stringify({ name: groupName, description: groupDesc }),
      });
      setEditingGroup(false);
      await reloadDetails();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Failed to update group');
    } finally {
      setBusy(false);
    }
  };

  const handleRoleChange = async (targetUserId: string, role: 'admin' | 'member') => {
    await apiRequest(`/conversations/${conversation.id}/members/${targetUserId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
    await reloadDetails();
  };

  const handleRemoveMember = async (targetUserId: string) => {
    await apiRequest(`/conversations/${conversation.id}/members/${targetUserId}`, {
      method: 'DELETE',
    });
    if (targetUserId === currentUserId) {
      onLeftGroup();
    } else {
      await reloadDetails();
    }
  };

  const amGroupAdmin = conversation.group?.myRole === 'admin';

  return (
    <aside className="w-80 lg:w-96 shrink-0 border-l border-[#D1D7DB] dark:border-[#222E35] bg-white dark:bg-[#111B21] flex flex-col h-full">
      <div className="px-4 py-3.5 border-b border-[#E9EDEF] dark:border-[#222E35] flex items-center justify-between">
        <h3 className="font-display text-sm font-bold text-[#111B21] dark:text-[#E9EDEF]">
          {mode === 'search'
            ? 'Search Messages'
            : conversation.type === 'group'
              ? 'Group Info'
              : 'Contact Info'}
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-full hover:bg-[#F0F2F5] dark:hover:bg-[#202C33] text-[#54656F] dark:text-[#8696A0]"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {mode === 'search' ? (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="p-3 border-b border-[#E9EDEF] dark:border-[#222E35]">
            <div className="relative flex items-center">
              <Search className="w-4 h-4 text-[#54656F] dark:text-[#8696A0] absolute left-3 pointer-events-none" />
              <input
                type="text"
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search in conversation..."
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-sm text-[#111B21] dark:text-[#E9EDEF] focus:outline-none"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-[#E9EDEF] dark:divide-[#222E35]">
            {!searchQuery.trim() ? (
              <div className="p-8 text-center text-xs text-[#54656F] dark:text-[#8696A0]">
                Type keywords to search message history.
              </div>
            ) : searching ? (
              <div className="p-8 text-center text-xs text-[#54656F] dark:text-[#8696A0]">
                Searching...
              </div>
            ) : searchResults.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#54656F] dark:text-[#8696A0]">
                No matching messages found.
              </div>
            ) : (
              searchResults.map((msg) => (
                <button
                  key={msg.id}
                  type="button"
                  onClick={() => onJumpToMessage(msg.id)}
                  className="w-full p-3.5 text-left hover:bg-[#F0F2F5] dark:hover:bg-[#202C33] space-y-1"
                >
                  <div className="flex items-center justify-between text-[11px] text-[#54656F] dark:text-[#8696A0]">
                    <span className="font-semibold text-[#00A884]">@{msg.senderUsername}</span>
                    <span className="tabular-nums">{formatTime(msg.createdAt)}</span>
                  </div>
                  <p className="text-xs text-[#111B21] dark:text-[#E9EDEF] line-clamp-2">
                    {msg.content || msg.mediaName || msg.type}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Header Avatar & Bio */}
          <div className="flex flex-col items-center text-center space-y-2 pb-4 border-b border-[#E9EDEF] dark:border-[#222E35]">
            <Avatar
              src={conversation.avatarUrl}
              name={conversation.title}
              size="xl"
              isGroup={conversation.type === 'group'}
              isOnline={conversation.peer?.isOnline}
            />
            <div className="font-bold text-base text-[#111B21] dark:text-[#E9EDEF]">
              {conversation.title}
            </div>
            {conversation.peer ? (
              <>
                <div className="text-xs font-mono text-[#00A884]">@{conversation.peer.username}</div>
                <div className="text-xs text-[#54656F] dark:text-[#8696A0]">
                  {conversation.peer.isOnline
                    ? 'online'
                    : conversation.peer.lastSeenAt
                      ? formatLastSeen(conversation.peer.lastSeenAt)
                      : 'last seen hidden'}
                </div>
                {conversation.peer.bio && (
                  <p className="text-xs text-[#111B21] dark:text-[#E9EDEF] bg-[#F0F2F5] dark:bg-[#202C33] w-full p-3 rounded-xl text-left">
                    {conversation.peer.bio}
                  </p>
                )}
              </>
            ) : (
              <>
                <div className="text-xs text-[#54656F] dark:text-[#8696A0]">
                  Group · {members.length} members
                </div>
                {conversation.group?.description && !editingGroup && (
                  <p className="text-xs text-[#111B21] dark:text-[#E9EDEF] bg-[#F0F2F5] dark:bg-[#202C33] w-full p-3 rounded-xl text-left">
                    {conversation.group.description}
                  </p>
                )}
                {amGroupAdmin && !editingGroup && (
                  <button
                    type="button"
                    onClick={() => setEditingGroup(true)}
                    className="text-xs text-[#00A884] font-semibold hover:underline"
                  >
                    Edit group details
                  </button>
                )}
              </>
            )}
          </div>

          {editingGroup && amGroupAdmin && (
            <form onSubmit={handleSaveGroupInfo} className="space-y-2.5 p-3 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33]">
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                required
                placeholder="Group name"
                className="w-full px-3 py-2 rounded-lg bg-white dark:bg-[#111B21] text-xs text-[#111B21] dark:text-[#E9EDEF]"
              />
              <textarea
                value={groupDesc}
                onChange={(e) => setGroupDesc(e.target.value)}
                rows={2}
                placeholder="Description"
                className="w-full px-3 py-2 rounded-lg bg-white dark:bg-[#111B21] text-xs text-[#111B21] dark:text-[#E9EDEF]"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditingGroup(false)}
                  className="flex-1 py-1.5 rounded-lg border border-[#D1D7DB] dark:border-[#2A3942] text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="flex-1 py-1.5 rounded-lg bg-[#00A884] text-white text-xs font-semibold"
                >
                  Save
                </button>
              </div>
            </form>
          )}

          {feedback && (
            <div className="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-300 text-xs">
              {feedback}
            </div>
          )}

          {/* Direct actions */}
          {conversation.peer && (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleToggleContact()}
                className="py-2 px-3 rounded-xl border border-[#D1D7DB] dark:border-[#2A3942] hover:bg-[#F0F2F5] dark:hover:bg-[#202C33] text-xs font-medium flex items-center justify-center gap-1.5"
              >
                {conversation.peer.isContact ? (
                  <>
                    <UserMinus className="w-3.5 h-3.5" />
                    <span>Remove Friend</span>
                  </>
                ) : (
                  <>
                    <UserPlus className="w-3.5 h-3.5 text-[#00A884]" />
                    <span>Add Friend</span>
                  </>
                )}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleToggleBlock()}
                className="py-2 px-3 rounded-xl border border-[#D1D7DB] dark:border-[#2A3942] hover:bg-red-50 dark:hover:bg-red-950/30 text-xs font-medium text-red-600 dark:text-red-400 flex items-center justify-center gap-1.5"
              >
                <Ban className="w-3.5 h-3.5" />
                <span>{conversation.peer.isBlocked ? 'Unblock' : 'Block'}</span>
              </button>
            </div>
          )}

          {/* Group Members */}
          {conversation.type === 'group' && (
            <div className="space-y-3">
              <div className="text-xs font-semibold text-[#54656F] dark:text-[#8696A0]">
                Members ({members.length})
              </div>

              {amGroupAdmin && (
                <form onSubmit={handleAddMember} className="flex gap-1.5">
                  <input
                    type="text"
                    value={addMemberUsername}
                    onChange={(e) => setAddMemberUsername(e.target.value)}
                    placeholder="Add @username..."
                    className="flex-1 px-3 py-1.5 rounded-lg bg-[#F0F2F5] dark:bg-[#202C33] text-xs text-[#111B21] dark:text-[#E9EDEF] focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={busy}
                    className="px-3 py-1.5 rounded-lg bg-[#00A884] text-white text-xs font-semibold"
                  >
                    Add
                  </button>
                </form>
              )}

              <div className="space-y-1.5">
                {members.map((m) => (
                  <div
                    key={m.userId}
                    className="flex items-center justify-between gap-2 p-2 rounded-xl bg-[#F7F8FA] dark:bg-[#202C33]"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar src={m.avatarUrl} name={m.displayName} size="sm" isOnline={m.isOnline} />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-[#111B21] dark:text-[#E9EDEF] truncate">
                          {m.displayName} {m.userId === currentUserId ? '(You)' : ''}
                        </div>
                        <div className="text-[11px] font-mono text-[#00A884] truncate">
                          @{m.username}{' '}
                          {m.role === 'admin' && (
                            <span className="ml-1 px-1.5 py-0.5 rounded bg-[#00A884]/15 text-[10px]">
                              admin
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    {amGroupAdmin && m.userId !== currentUserId && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            void handleRoleChange(m.userId, m.role === 'admin' ? 'member' : 'admin')
                          }
                          title={m.role === 'admin' ? 'Dismiss admin' : 'Make admin'}
                          className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 text-[#54656F] dark:text-[#8696A0]"
                        >
                          {m.role === 'admin' ? (
                            <ShieldOff className="w-3.5 h-3.5" />
                          ) : (
                            <Shield className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRemoveMember(m.userId)}
                          title="Remove from group"
                          className="p-1 rounded hover:bg-red-500/10 text-red-500"
                        >
                          <UserMinus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => void handleRemoveMember(currentUserId)}
                className="w-full py-2 rounded-xl border border-red-200 dark:border-red-900 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 flex items-center justify-center gap-1.5"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Leave Group</span>
              </button>
            </div>
          )}

          {/* Shared Media & Docs */}
          <div className="space-y-2 pt-2 border-t border-[#E9EDEF] dark:border-[#222E35]">
            <div className="text-xs font-semibold text-[#54656F] dark:text-[#8696A0]">
              Shared Media & Files ({sharedMedia.length})
            </div>
            {sharedMedia.length === 0 ? (
              <p className="text-xs text-[#54656F] dark:text-[#8696A0]">No media shared yet.</p>
            ) : (
              <div className="grid grid-cols-3 gap-1.5">
                {sharedMedia.slice(0, 12).map((item) =>
                  item.type === 'image' && item.mediaUrl ? (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onJumpToMessage(item.id)}
                      className="aspect-square rounded-lg overflow-hidden bg-[#F0F2F5] dark:bg-[#202C33]"
                    >
                      <img
                        src={item.mediaUrl}
                        alt={item.mediaName || 'Shared'}
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ) : (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onJumpToMessage(item.id)}
                      className="aspect-square rounded-lg bg-[#F0F2F5] dark:bg-[#202C33] p-1.5 flex flex-col items-center justify-center text-[10px] text-[#54656F] dark:text-[#8696A0]"
                    >
                      <FileText className="w-4 h-4 mb-1 text-[#00A884]" />
                      <span className="truncate w-full text-center">
                        {item.mediaName || item.type}
                      </span>
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
};

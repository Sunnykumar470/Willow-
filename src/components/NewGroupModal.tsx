import React, { useState } from 'react';
import { Check, Users, X } from 'lucide-react';
import { apiRequest } from '../lib/api.ts';
import type { ConversationSummary, UserProfile } from '../types.ts';
import { Avatar } from './Avatar.tsx';

interface NewGroupModalProps {
  contacts: UserProfile[];
  onClose: () => void;
  onCreated: (conv: ConversationSummary) => void;
}

export const NewGroupModal: React.FC<NewGroupModalProps> = ({
  contacts,
  onClose,
  onCreated,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedUsernames, setSelectedUsernames] = useState<string[]>([]);
  const [manualUsername, setManualUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleUsername = (uname: string) => {
    setSelectedUsernames((prev) =>
      prev.includes(uname) ? prev.filter((u) => u !== uname) : [...prev, uname]
    );
  };

  const addManual = () => {
    const cleaned = manualUsername.trim().replace(/^@+/, '').toLowerCase();
    if (!cleaned) return;
    if (!selectedUsernames.includes(cleaned)) {
      setSelectedUsernames((prev) => [...prev, cleaned]);
    }
    setManualUsername('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiRequest<{ conversation: ConversationSummary }>('/conversations/group', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          memberUsernames: selectedUsernames,
        }),
      });
      onCreated(res.conversation);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create group');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-[#202C33] border border-[#D1D7DB] dark:border-[#2A3942] rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E9EDEF] dark:border-[#2A3942] flex items-center justify-between">
          <div className="flex items-center gap-2 font-display font-bold text-sm text-[#111B21] dark:text-[#E9EDEF]">
            <Users className="w-4 h-4 text-[#00A884]" />
            <span>Create New Group</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-[#F0F2F5] dark:hover:bg-[#2A3942] text-[#54656F] dark:text-[#8696A0]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-300 text-xs">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-[#54656F] dark:text-[#8696A0] mb-1">
              Group Name
            </label>
            <input
              type="text"
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Weekend Crew"
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#111B21] text-sm text-[#111B21] dark:text-[#E9EDEF] focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#54656F] dark:text-[#8696A0] mb-1">
              Description (optional)
            </label>
            <input
              type="text"
              maxLength={300}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this group about?"
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#111B21] text-sm text-[#111B21] dark:text-[#E9EDEF] focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-[#54656F] dark:text-[#8696A0]">
              Add Members by @username
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={manualUsername}
                onChange={(e) => setManualUsername(e.target.value)}
                placeholder="@username"
                className="flex-1 px-3 py-2 rounded-xl bg-[#F0F2F5] dark:bg-[#111B21] text-xs text-[#111B21] dark:text-[#E9EDEF] focus:outline-none"
              />
              <button
                type="button"
                onClick={addManual}
                className="px-3 py-2 rounded-xl bg-[#F0F2F5] dark:bg-[#2A3942] text-xs font-semibold text-[#00A884]"
              >
                Add
              </button>
            </div>

            {selectedUsernames.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {selectedUsernames.map((uname) => (
                  <span
                    key={uname}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#00A884]/15 text-[#008F6F] dark:text-[#00A884] text-xs font-mono"
                  >
                    @{uname}
                    <button type="button" onClick={() => toggleUsername(uname)}>
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {contacts.length > 0 && (
              <div className="max-h-40 overflow-y-auto divide-y divide-[#E9EDEF] dark:divide-[#2A3942] border border-[#E9EDEF] dark:border-[#2A3942] rounded-xl">
                {contacts.map((c) => {
                  const selected = selectedUsernames.includes(c.username);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleUsername(c.username)}
                      className="w-full px-3 py-2 flex items-center justify-between hover:bg-[#F0F2F5] dark:hover:bg-[#111B21] text-left"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar src={c.avatarUrl} name={c.displayName} size="sm" />
                        <div className="min-w-0">
                          <div className="text-xs font-semibold truncate">{c.displayName}</div>
                          <div className="text-[11px] font-mono text-[#54656F] dark:text-[#8696A0]">
                            @{c.username}
                          </div>
                        </div>
                      </div>
                      {selected && <Check className="w-4 h-4 text-[#00A884] shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="w-full py-2.5 rounded-xl bg-[#00A884] hover:bg-[#008F6F] disabled:opacity-50 text-white text-sm font-semibold"
          >
            {busy ? 'Creating...' : 'Create Group'}
          </button>
        </form>
      </div>
    </div>
  );
};

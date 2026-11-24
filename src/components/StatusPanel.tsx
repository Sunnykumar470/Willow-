import React, { useState } from 'react';
import { Eye, Plus, Send, Trash2, Upload, X } from 'lucide-react';
import { apiRequest, uploadFile } from '../lib/api.ts';
import { formatTime } from '../lib/format.ts';
import type { OwnAccount, StatusGroup } from '../types.ts';
import { Avatar } from './Avatar.tsx';

interface StatusPanelProps {
  currentUser: OwnAccount;
  statusGroups: StatusGroup[];
  onRefresh: () => Promise<void>;
}

const STATUS_COLORS = ['#00A884', '#128C7E', '#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#334155'];

export const StatusPanel: React.FC<StatusPanelProps> = ({
  currentUser,
  statusGroups,
  onRefresh,
}) => {
  const [composing, setComposing] = useState(false);
  const [content, setContent] = useState('');
  const [bgColor, setBgColor] = useState(STATUS_COLORS[0]);
  const [visibility, setVisibility] = useState(currentUser.privacyStatus);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [viewingGroup, setViewingGroup] = useState<StatusGroup | null>(null);
  const [viewingIndex, setViewingIndex] = useState(0);

  const openGroup = async (group: StatusGroup) => {
    setViewingGroup(group);
    setViewingIndex(0);
    const first = group.items[0];
    if (first && !group.isMine && !first.viewedByMe) {
      await apiRequest(`/statuses/${first.id}/view`, { method: 'POST' }).catch(() => {});
      void onRefresh();
    }
  };

  const stepStatus = async (delta: number) => {
    if (!viewingGroup) return;
    const nextIdx = viewingIndex + delta;
    if (nextIdx < 0 || nextIdx >= viewingGroup.items.length) {
      setViewingGroup(null);
      return;
    }
    setViewingIndex(nextIdx);
    const item = viewingGroup.items[nextIdx];
    if (item && !viewingGroup.isMine && !item.viewedByMe) {
      await apiRequest(`/statuses/${item.id}/view`, { method: 'POST' }).catch(() => {});
      void onRefresh();
    }
  };

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() && !mediaFile) return;
    setSubmitting(true);
    try {
      let type: 'text' | 'image' | 'video' = 'text';
      let mediaUrl: string | null = null;
      if (mediaFile) {
        const uploaded = await uploadFile(mediaFile);
        mediaUrl = uploaded.url;
        type = mediaFile.type.startsWith('video/') ? 'video' : 'image';
      }
      await apiRequest('/statuses', {
        method: 'POST',
        body: JSON.stringify({
          type,
          content: content.trim(),
          mediaUrl,
          bgColor,
          visibility,
        }),
      });
      setContent('');
      setMediaFile(null);
      setComposing(false);
      await onRefresh();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteStatus = async (id: string) => {
    await apiRequest(`/statuses/${id}`, { method: 'DELETE' });
    setViewingGroup(null);
    await onRefresh();
  };

  const myGroup = statusGroups.find((g) => g.isMine) || null;
  const others = statusGroups.filter((g) => !g.isMine);
  const currentItem = viewingGroup?.items[viewingIndex] || null;

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#111B21]">
      <div className="px-4 py-3.5 border-b border-[#E9EDEF] dark:border-[#222E35] flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-bold text-[#111B21] dark:text-[#E9EDEF]">
            Status Updates
          </h2>
          <p className="text-xs text-[#54656F] dark:text-[#8696A0]">
            24-hour disappearing stories
          </p>
        </div>
        <button
          type="button"
          onClick={() => setComposing((v) => !v)}
          className="p-2 rounded-full bg-[#00A884]/15 text-[#00A884] hover:bg-[#00A884]/25"
          title="Post status"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>

      {composing && (
        <form onSubmit={handlePublish} className="p-4 border-b border-[#E9EDEF] dark:border-[#222E35] bg-[#F7F8FA] dark:bg-[#202C33] space-y-3">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={2}
            placeholder="Share a 24-hour update..."
            className="w-full px-3 py-2 rounded-xl bg-white dark:bg-[#111B21] text-sm text-[#111B21] dark:text-[#E9EDEF] focus:outline-none"
          />

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              {STATUS_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setBgColor(c)}
                  className={`w-5 h-5 rounded-full ${bgColor === c ? 'ring-2 ring-offset-1 ring-[#111B21] dark:ring-white' : ''}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <label className="cursor-pointer inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-[#111B21] text-xs font-medium">
              <Upload className="w-3.5 h-3.5 text-[#00A884]" />
              <span>{mediaFile ? mediaFile.name.slice(0, 12) : 'Photo/Video'}</span>
              <input
                type="file"
                accept="image/*,video/*"
                onChange={(e) => setMediaFile(e.target.files?.[0] || null)}
                className="hidden"
              />
            </label>
          </div>

          <div className="flex items-center justify-between gap-2">
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as 'everyone' | 'contacts')}
              className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#111B21] text-xs text-[#111B21] dark:text-[#E9EDEF]"
            >
              <option value="everyone">Visible to Everyone</option>
              <option value="contacts">My Contacts Only</option>
            </select>
            <button
              type="submit"
              disabled={submitting || (!content.trim() && !mediaFile)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#00A884] text-white text-xs font-semibold disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{submitting ? 'Posting...' : 'Post'}</span>
            </button>
          </div>
        </form>
      )}

      <div className="flex-1 overflow-y-auto divide-y divide-[#E9EDEF] dark:divide-[#222E35]">
        <button
          type="button"
          onClick={() => {
            if (myGroup) {
              void openGroup(myGroup);
            } else {
              setComposing(true);
            }
          }}
          className="w-full px-4 py-3 flex items-center gap-3 hover:bg-[#F0F2F5] dark:hover:bg-[#202C33] text-left"
        >
          <div className={`rounded-full p-0.5 ${myGroup ? 'ring-2 ring-[#00A884]' : ''}`}>
            <Avatar src={currentUser.avatarUrl} name={currentUser.displayName} size="md" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-[#111B21] dark:text-[#E9EDEF]">
              My Status
            </div>
            <div className="text-xs text-[#54656F] dark:text-[#8696A0]">
              {myGroup ? `${myGroup.items.length} active update(s)` : 'Tap to add a status update'}
            </div>
          </div>
        </button>

        {others.length === 0 ? (
          <div className="p-8 text-center text-xs text-[#54656F] dark:text-[#8696A0]">
            No recent status updates from your contacts.
          </div>
        ) : (
          others.map((g) => (
            <button
              key={g.userId}
              type="button"
              onClick={() => void openGroup(g)}
              className="w-full px-4 py-3 flex items-center gap-3 hover:bg-[#F0F2F5] dark:hover:bg-[#202C33] text-left"
            >
              <div className={`rounded-full p-0.5 ${g.hasUnviewed ? 'ring-2 ring-[#00A884]' : 'ring-2 ring-[#8696A0]/40'}`}>
                <Avatar src={g.avatarUrl} name={g.displayName} size="md" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[#111B21] dark:text-[#E9EDEF] truncate">
                  {g.displayName}
                </div>
                <div className="text-xs text-[#54656F] dark:text-[#8696A0]">
                  @{g.username} · {formatTime(g.items[g.items.length - 1]?.createdAt || '')}
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      {/* Fullscreen Status Viewer Modal */}
      {viewingGroup && currentItem && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center p-4 text-white"
          style={{ backgroundColor: currentItem.bgColor || '#0B141A' }}
        >
          <div className="w-full max-w-md flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <Avatar src={viewingGroup.avatarUrl} name={viewingGroup.displayName} size="sm" />
              <div>
                <div className="text-sm font-semibold">{viewingGroup.displayName}</div>
                <div className="text-[11px] opacity-80">
                  @{viewingGroup.username} · {formatTime(currentItem.createdAt)}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {viewingGroup.isMine && (
                <button
                  type="button"
                  onClick={() => void handleDeleteStatus(currentItem.id)}
                  className="p-2 rounded-full bg-black/25 hover:bg-black/40"
                  title="Delete status"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setViewingGroup(null)}
                className="p-2 rounded-full bg-black/25 hover:bg-black/40"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div
            onClick={() => void stepStatus(1)}
            className="w-full max-w-md flex-1 flex flex-col items-center justify-center text-center cursor-pointer space-y-4"
          >
            {currentItem.type === 'image' && currentItem.mediaUrl && (
              <img
                src={currentItem.mediaUrl}
                alt="Status"
                className="max-h-[65vh] rounded-2xl object-contain"
              />
            )}
            {currentItem.type === 'video' && currentItem.mediaUrl && (
              <video
                src={currentItem.mediaUrl}
                controls
                className="max-h-[65vh] rounded-2xl"
                onClick={(e) => e.stopPropagation()}
              />
            )}
            {currentItem.content && (
              <p className="text-xl font-medium leading-relaxed px-4 break-words">
                {currentItem.content}
              </p>
            )}
          </div>

          <div className="w-full max-w-md flex items-center justify-between pt-3 text-xs opacity-90">
            <button
              type="button"
              onClick={() => void stepStatus(-1)}
              className="px-3 py-1.5 rounded-lg bg-black/25"
            >
              Prev
            </button>
            {viewingGroup.isMine && (
              <span className="inline-flex items-center gap-1">
                <Eye className="w-4 h-4" />
                {currentItem.viewCount} views
              </span>
            )}
            <button
              type="button"
              onClick={() => void stepStatus(1)}
              className="px-3 py-1.5 rounded-lg bg-black/25"
            >
              Next ({viewingIndex + 1}/{viewingGroup.items.length})
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

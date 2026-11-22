import React, { useState } from 'react';
import {
  Ban,
  Flag,
  MessageSquare,
  ShieldAlert,
  UserMinus,
  UserPlus,
  X,
} from 'lucide-react';
import { apiRequest } from '../lib/api.ts';
import { formatLastSeen } from '../lib/format.ts';
import type { UserProfile } from '../types.ts';
import { Avatar } from './Avatar.tsx';

interface UserProfileModalProps {
  profile: UserProfile;
  onClose: () => void;
  onStartChat: (user: UserProfile) => void;
  onProfileChanged: () => void;
}

export const UserProfileModal: React.FC<UserProfileModalProps> = ({
  profile,
  onClose,
  onStartChat,
  onProfileChanged,
}) => {
  const [localProfile, setLocalProfile] = useState(profile);
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportReason, setReportReason] = useState('Spam or unwanted messages');
  const [reportDetails, setReportDetails] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const toggleContact = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      if (localProfile.isContact) {
        await apiRequest(`/contacts/${localProfile.id}`, { method: 'DELETE' });
        setLocalProfile((p) => ({ ...p, isContact: false }));
        setFeedback(`Removed @${localProfile.username} from friends.`);
      } else {
        await apiRequest('/contacts', {
          method: 'POST',
          body: JSON.stringify({ userId: localProfile.id }),
        });
        setLocalProfile((p) => ({ ...p, isContact: true }));
        setFeedback(`Saved @${localProfile.username} to your friends and chat list!`);
      }
      onProfileChanged();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const toggleBlock = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      if (localProfile.isBlocked) {
        await apiRequest(`/blocks/${localProfile.id}`, { method: 'DELETE' });
        setLocalProfile((p) => ({ ...p, isBlocked: false }));
      } else {
        await apiRequest('/blocks', {
          method: 'POST',
          body: JSON.stringify({ userId: localProfile.id }),
        });
        setLocalProfile((p) => ({ ...p, isBlocked: true }));
      }
      onProfileChanged();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const submitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await apiRequest('/reports', {
        method: 'POST',
        body: JSON.stringify({
          userId: localProfile.id,
          reason: reportReason,
          details: reportDetails,
        }),
      });
      setReporting(false);
      setFeedback('Report submitted. Thank you for helping keep Willow safe.');
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Failed to submit report');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-[#202C33] border border-[#D1D7DB] dark:border-[#2A3942] rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E9EDEF] dark:border-[#2A3942] flex items-center justify-between">
          <h3 className="font-display text-base font-semibold text-[#111B21] dark:text-[#E9EDEF]">
            User Profile
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-[#F0F2F5] dark:hover:bg-[#2A3942] text-[#54656F] dark:text-[#8696A0]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 flex flex-col items-center text-center space-y-3">
          <Avatar
            src={localProfile.avatarUrl}
            name={localProfile.displayName}
            size="xl"
            isOnline={localProfile.isOnline}
          />
          <div>
            <h4 className="text-xl font-bold text-[#111B21] dark:text-[#E9EDEF]">
              {localProfile.displayName}
            </h4>
            <p className="text-sm font-mono text-[#00A884]">@{localProfile.username}</p>
            <p className="text-xs text-[#54656F] dark:text-[#8696A0] mt-1">
              {localProfile.isOnline
                ? 'online'
                : localProfile.lastSeenAt
                  ? formatLastSeen(localProfile.lastSeenAt)
                  : 'last seen hidden'}
            </p>
          </div>

          {localProfile.bio && (
            <div className="w-full p-3.5 rounded-xl bg-[#F0F2F5] dark:bg-[#111B21] text-left">
              <div className="text-[11px] font-medium text-[#54656F] dark:text-[#8696A0] mb-1">
                About
              </div>
              <p className="text-sm text-[#111B21] dark:text-[#E9EDEF] break-words">
                {localProfile.bio}
              </p>
            </div>
          )}

          {feedback && (
            <div className="w-full p-2.5 rounded-xl bg-[#00A884]/10 text-[#008F6F] dark:text-[#00A884] text-xs">
              {feedback}
            </div>
          )}

          {!reporting ? (
            <div className="w-full space-y-2.5 pt-2">
              <button
                type="button"
                disabled={busy || localProfile.isBlocked || localProfile.blockedByPeer}
                onClick={() => onStartChat(localProfile)}
                className="w-full py-2.5 px-4 rounded-xl bg-[#00A884] hover:bg-[#008F6F] disabled:opacity-50 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                <MessageSquare className="w-4 h-4" />
                <span>
                  {localProfile.isBlocked
                    ? 'Unblock to Message'
                    : localProfile.blockedByPeer
                      ? 'Messaging Unavailable'
                      : 'Send Message'}
                </span>
              </button>

              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={toggleContact}
                  className="py-2 px-3 rounded-xl border border-[#D1D7DB] dark:border-[#2A3942] hover:bg-[#F0F2F5] dark:hover:bg-[#2A3942] text-xs font-medium text-[#111B21] dark:text-[#E9EDEF] flex items-center justify-center gap-1.5 transition-colors"
                >
                  {localProfile.isContact ? (
                    <>
                      <UserMinus className="w-4 h-4 text-[#54656F]" />
                      <span>Remove Friend</span>
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-4 h-4 text-[#00A884]" />
                      <span>Add Friend</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  disabled={busy}
                  onClick={toggleBlock}
                  className="py-2 px-3 rounded-xl border border-[#D1D7DB] dark:border-[#2A3942] hover:bg-red-50 dark:hover:bg-red-950/30 text-xs font-medium text-red-600 dark:text-red-400 flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Ban className="w-4 h-4" />
                  <span>{localProfile.isBlocked ? 'Unblock User' : 'Block User'}</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => setReporting(true)}
                className="w-full py-2 text-xs text-[#54656F] dark:text-[#8696A0] hover:text-red-500 flex items-center justify-center gap-1.5"
              >
                <Flag className="w-3.5 h-3.5" />
                <span>Report @{localProfile.username}</span>
              </button>
            </div>
          ) : (
            <form onSubmit={submitReport} className="w-full text-left space-y-3 pt-2">
              <div className="flex items-center gap-2 text-xs font-medium text-red-600 dark:text-red-400">
                <ShieldAlert className="w-4 h-4" />
                <span>Report @{localProfile.username}</span>
              </div>
              <select
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[#F0F2F5] dark:bg-[#111B21] text-sm text-[#111B21] dark:text-[#E9EDEF]"
              >
                <option>Spam or unwanted messages</option>
                <option>Harassment or abuse</option>
                <option>Impersonation</option>
                <option>Inappropriate media</option>
              </select>
              <textarea
                value={reportDetails}
                onChange={(e) => setReportDetails(e.target.value)}
                placeholder="Additional details (optional)"
                rows={2}
                className="w-full px-3 py-2 rounded-xl bg-[#F0F2F5] dark:bg-[#111B21] text-sm text-[#111B21] dark:text-[#E9EDEF] focus:outline-none"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setReporting(false)}
                  className="flex-1 py-2 rounded-xl border border-[#D1D7DB] dark:border-[#2A3942] text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="flex-1 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
                >
                  Submit Report
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

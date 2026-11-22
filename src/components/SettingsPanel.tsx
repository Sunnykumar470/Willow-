import React, { useEffect, useState } from 'react';
import {
  Bell,
  Check,
  Cloud,
  Lock,
  LogOut,
  Moon,
  Shield,
  Sun,
  Trash2,
  Upload,
  UserX,
} from 'lucide-react';
import { onAuthStateChanged, signInWithPopup, signOut, type User as FirebaseUser } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { apiRequest, uploadFile } from '../lib/api.ts';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase.ts';
import type { ConversationSummary, OwnAccount, PrivacyScope, StatusVisibility } from '../types.ts';
import { Avatar } from './Avatar.tsx';
import { PRESET_AVATARS } from './AuthView.tsx';

interface BlockedUserItem {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  blockedAt: string;
}

interface CloudBackupRecord {
  id: string;
  backupLabel: string;
  conversationCount: number;
  messageCount: number;
  username: string;
}

interface SettingsPanelProps {
  user: OwnAccount;
  conversations: ConversationSummary[];
  initialTab?: 'profile' | 'privacy' | 'account';
  notificationsEnabled: boolean;
  onToggleNotifications: () => void;
  onUserUpdated: (user: OwnAccount) => void;
  onLogout: () => void;
  onAccountDeleted: () => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  user,
  conversations,
  initialTab = 'profile',
  notificationsEnabled,
  onToggleNotifications,
  onUserUpdated,
  onLogout,
  onAccountDeleted,
}) => {
  const [tab, setTab] = useState<'profile' | 'privacy' | 'account'>(initialTab);
  const [displayName, setDisplayName] = useState(user.displayName);
  const [bio, setBio] = useState(user.bio);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [blockedUsers, setBlockedUsers] = useState<BlockedUserItem[]>([]);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Firebase Cloud Sync state
  const [fbUser, setFbUser] = useState<FirebaseUser | null>(auth.currentUser);
  const [cloudBackups, setCloudBackups] = useState<CloudBackupRecord[]>([]);
  const [backingUp, setBackingUp] = useState(false);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    setDisplayName(user.displayName);
    setBio(user.bio);
  }, [user.displayName, user.bio]);

  useEffect(() => {
    if (tab !== 'privacy') return;
    void apiRequest<{ blocked: BlockedUserItem[] }>('/blocks')
      .then((res) => setBlockedUsers(res.blocked))
      .catch(() => {});
  }, [tab]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setFbUser(u));
    return unsub;
  }, []);

  useEffect(() => {
    if (!fbUser || !fbUser.emailVerified) {
      setCloudBackups([]);
      return;
    }
    const backupsPath = `users/${fbUser.uid}/backups`;
    const q = query(collection(db, backupsPath), orderBy('updatedAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: CloudBackupRecord[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            backupLabel: String(data.backupLabel || 'Backup'),
            conversationCount: Number(data.conversationCount || 0),
            messageCount: Number(data.messageCount || 0),
            username: String(data.username || user.username),
          };
        });
        setCloudBackups(list);
      },
      (err) => handleFirestoreError(err, OperationType.GET, backupsPath)
    );
    return unsub;
  }, [fbUser, user.username]);

  const updateProfileFields = async (patch: Record<string, unknown>, label = 'Saved') => {
    setSaving(true);
    setError(null);
    setSavedMsg(null);
    try {
      const res = await apiRequest<{ user: OwnAccount }>('/profile', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      onUserUpdated(res.user);
      setSavedMsg(label);
      setTimeout(() => setSavedMsg(null), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const up = await uploadFile(file);
      await updateProfileFields({ avatarUrl: up.url }, 'Profile photo updated');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload photo');
    }
  };

  const handleUnblock = async (targetId: string) => {
    await apiRequest(`/blocks/${targetId}`, { method: 'DELETE' });
    setBlockedUsers((prev) => prev.filter((u) => u.id !== targetId));
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSavedMsg(null);
    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setError('New passwords do not match.');
      return;
    }
    setSaving(true);
    try {
      await apiRequest('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setSavedMsg('Password updated');
      setTimeout(() => setSavedMsg(null), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change password');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    setSaving(true);
    try {
      await apiRequest('/auth/account', { method: 'DELETE' });
      onAccountDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete account');
      setSaving(false);
    }
  };

  const handleConnectGoogleBackup = async () => {
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in cancelled');
    }
  };

  const handleSaveCloudBackup = async () => {
    if (!fbUser) return;
    setBackingUp(true);
    setError(null);
    const profilePath = `users/${fbUser.uid}/profile/main`;
    const backupId = `bkp_${Date.now()}`;
    const backupPath = `users/${fbUser.uid}/backups/${backupId}`;
    try {
      await setDoc(doc(db, profilePath), {
        uid: fbUser.uid,
        username: user.username,
        displayName: user.displayName,
        bio: user.bio,
        updatedAt: serverTimestamp(),
      });
      await setDoc(doc(db, backupPath), {
        ownerUid: fbUser.uid,
        username: user.username,
        backupLabel: `Snapshot (${new Date().toLocaleDateString()})`,
        conversationCount: conversations.length,
        messageCount: conversations.reduce((acc, c) => acc + (c.lastMessage ? 1 : 0) + c.unreadCount, 0),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setSavedMsg('Cloud snapshot saved to Firestore');
      setTimeout(() => setSavedMsg(null), 2500);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, backupPath);
    } finally {
      setBackingUp(false);
    }
  };

  const handleDeleteCloudBackup = async (backupId: string) => {
    if (!fbUser) return;
    const backupPath = `users/${fbUser.uid}/backups/${backupId}`;
    try {
      await deleteDoc(doc(db, backupPath));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, backupPath);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#111B21]">
      <div className="px-4 py-3.5 border-b border-[#E9EDEF] dark:border-[#222E35]">
        <h2 className="font-display text-lg font-bold text-[#111B21] dark:text-[#E9EDEF]">
          Settings & Profile
        </h2>
        <div className="mt-3 flex items-center gap-1 p-1 bg-[#F0F2F5] dark:bg-[#202C33] rounded-xl">
          {(['profile', 'privacy', 'account'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`flex-1 py-1.5 text-xs font-medium rounded-lg capitalize transition-colors ${
                tab === t
                  ? 'bg-white dark:bg-[#111B21] text-[#111B21] dark:text-[#E9EDEF] shadow-xs'
                  : 'text-[#54656F] dark:text-[#8696A0]'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {savedMsg && (
          <div className="p-2.5 rounded-xl bg-[#00A884]/15 text-[#008F6F] dark:text-[#00A884] text-xs font-medium flex items-center gap-2">
            <Check className="w-4 h-4" />
            <span>{savedMsg}</span>
          </div>
        )}
        {error && (
          <div className="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-300 text-xs">
            {error}
          </div>
        )}

        {tab === 'profile' && (
          <div className="space-y-5">
            <div className="flex flex-col items-center gap-3 py-2">
              <Avatar src={user.avatarUrl} name={user.displayName} size="xl" isOnline />
              <div className="text-center">
                <div className="font-mono text-sm font-semibold text-[#00A884]">
                  @{user.username}
                </div>
                <div className="text-[11px] font-mono text-[#54656F] dark:text-[#8696A0]">
                  ID: {user.id}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {PRESET_AVATARS.map((p) => (
                  <button
                    key={p.url}
                    type="button"
                    onClick={() => updateProfileFields({ avatarUrl: p.url }, 'Avatar updated')}
                    className={`rounded-full p-0.5 ${
                      user.avatarUrl === p.url ? 'ring-2 ring-[#00A884]' : 'opacity-75 hover:opacity-100'
                    }`}
                  >
                    <img
                      src={p.url}
                      alt={p.label}
                      referrerPolicy="no-referrer"
                      className="w-8 h-8 rounded-full object-cover"
                    />
                  </button>
                ))}
                <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#D1D7DB] dark:border-[#2A3942] text-xs font-medium text-[#111B21] dark:text-[#E9EDEF] hover:bg-[#F0F2F5] dark:hover:bg-[#202C33]">
                  <Upload className="w-3.5 h-3.5" />
                  <span>Change Photo</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={handleAvatarUpload}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[#54656F] dark:text-[#8696A0] mb-1">
                  Display Name
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={60}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-sm text-[#111B21] dark:text-[#E9EDEF] focus:outline-none focus:ring-2 focus:ring-[#00A884]/40"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#54656F] dark:text-[#8696A0] mb-1">
                  About / Bio
                </label>
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  rows={2}
                  maxLength={200}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-sm text-[#111B21] dark:text-[#E9EDEF] focus:outline-none focus:ring-2 focus:ring-[#00A884]/40 resize-none"
                />
              </div>
              <button
                type="button"
                disabled={saving}
                onClick={() => updateProfileFields({ displayName, bio }, 'Profile saved')}
                className="w-full py-2.5 rounded-xl bg-[#00A884] hover:bg-[#008F6F] disabled:opacity-50 text-white text-sm font-semibold transition-colors"
              >
                {saving ? 'Saving...' : 'Save Profile'}
              </button>
            </div>
          </div>
        )}

        {tab === 'privacy' && (
          <div className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#00A884]">
                <Shield className="w-4 h-4" />
                <span>Visibility Controls</span>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#54656F] dark:text-[#8696A0] mb-1">
                  Last Seen
                </label>
                <select
                  value={user.privacyLastSeen}
                  onChange={(e) =>
                    updateProfileFields({ privacyLastSeen: e.target.value as PrivacyScope }, 'Privacy updated')
                  }
                  className="w-full px-3 py-2 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-sm text-[#111B21] dark:text-[#E9EDEF]"
                >
                  <option value="everyone">Everyone</option>
                  <option value="contacts">My Contacts</option>
                  <option value="nobody">Nobody</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#54656F] dark:text-[#8696A0] mb-1">
                  Profile Photo
                </label>
                <select
                  value={user.privacyProfilePhoto}
                  onChange={(e) =>
                    updateProfileFields(
                      { privacyProfilePhoto: e.target.value as PrivacyScope },
                      'Privacy updated'
                    )
                  }
                  className="w-full px-3 py-2 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-sm text-[#111B21] dark:text-[#E9EDEF]"
                >
                  <option value="everyone">Everyone</option>
                  <option value="contacts">My Contacts</option>
                  <option value="nobody">Nobody</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#54656F] dark:text-[#8696A0] mb-1">
                  Online Status
                </label>
                <select
                  value={user.privacyOnline}
                  onChange={(e) =>
                    updateProfileFields(
                      { privacyOnline: e.target.value as 'everyone' | 'nobody' },
                      'Privacy updated'
                    )
                  }
                  className="w-full px-3 py-2 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-sm text-[#111B21] dark:text-[#E9EDEF]"
                >
                  <option value="everyone">Everyone</option>
                  <option value="nobody">Nobody</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#54656F] dark:text-[#8696A0] mb-1">
                  Default Status Visibility
                </label>
                <select
                  value={user.privacyStatus}
                  onChange={(e) =>
                    updateProfileFields(
                      { privacyStatus: e.target.value as StatusVisibility },
                      'Privacy updated'
                    )
                  }
                  className="w-full px-3 py-2 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-sm text-[#111B21] dark:text-[#E9EDEF]"
                >
                  <option value="everyone">Everyone</option>
                  <option value="contacts">My Contacts Only</option>
                </select>
              </div>

              <label className="flex items-center justify-between p-3 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] cursor-pointer">
                <div>
                  <div className="text-sm font-medium text-[#111B21] dark:text-[#E9EDEF]">
                    Read Receipts
                  </div>
                  <div className="text-xs text-[#54656F] dark:text-[#8696A0]">
                    Send blue read checkmarks when opening chats
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={user.privacyReadReceipts}
                  onChange={(e) =>
                    updateProfileFields({ privacyReadReceipts: e.target.checked }, 'Privacy updated')
                  }
                  className="w-4 h-4 accent-[#00A884]"
                />
              </label>
            </div>

            <div className="pt-2 border-t border-[#E9EDEF] dark:border-[#222E35]">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#54656F] dark:text-[#8696A0] mb-2">
                <UserX className="w-4 h-4" />
                <span>Blocked Users ({blockedUsers.length})</span>
              </div>
              {blockedUsers.length === 0 ? (
                <p className="text-xs text-[#54656F] dark:text-[#8696A0]">No blocked users.</p>
              ) : (
                <div className="space-y-2">
                  {blockedUsers.map((b) => (
                    <div
                      key={b.id}
                      className="flex items-center justify-between p-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33]"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar src={b.avatarUrl} name={b.displayName} size="sm" />
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{b.displayName}</div>
                          <div className="text-xs font-mono text-[#54656F] dark:text-[#8696A0]">
                            @{b.username}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleUnblock(b.id)}
                        className="px-2.5 py-1 rounded-lg border border-[#D1D7DB] dark:border-[#2A3942] text-xs font-medium hover:bg-white dark:hover:bg-[#111B21]"
                      >
                        Unblock
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'account' && (
          <div className="space-y-4">
            {/* Appearance & Notifications */}
            <div className="space-y-2">
              <button
                type="button"
                onClick={() =>
                  updateProfileFields(
                    { theme: user.theme === 'dark' ? 'light' : 'dark' },
                    'Theme updated'
                  )
                }
                className="w-full p-3 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] flex items-center justify-between text-left"
              >
                <div className="flex items-center gap-3">
                  {user.theme === 'dark' ? (
                    <Moon className="w-4 h-4 text-[#00A884]" />
                  ) : (
                    <Sun className="w-4 h-4 text-[#00A884]" />
                  )}
                  <div>
                    <div className="text-sm font-medium text-[#111B21] dark:text-[#E9EDEF]">
                      Appearance
                    </div>
                    <div className="text-xs text-[#54656F] dark:text-[#8696A0] capitalize">
                      {user.theme} mode active
                    </div>
                  </div>
                </div>
                <span className="text-xs font-medium text-[#00A884]">Switch</span>
              </button>

              <button
                type="button"
                onClick={onToggleNotifications}
                className="w-full p-3 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] flex items-center justify-between text-left"
              >
                <div className="flex items-center gap-3">
                  <Bell className="w-4 h-4 text-[#00A884]" />
                  <div>
                    <div className="text-sm font-medium text-[#111B21] dark:text-[#E9EDEF]">
                      Desktop Notifications
                    </div>
                    <div className="text-xs text-[#54656F] dark:text-[#8696A0]">
                      {notificationsEnabled ? 'Enabled for new messages' : 'Click to enable alerts'}
                    </div>
                  </div>
                </div>
                <span className="text-xs font-medium text-[#00A884]">
                  {notificationsEnabled ? 'On' : 'Enable'}
                </span>
              </button>
            </div>

            {/* Change Password */}
            <form
              onSubmit={handleChangePassword}
              className="p-3.5 rounded-xl border border-[#E9EDEF] dark:border-[#2A3942] space-y-2.5"
            >
              <div className="flex items-center gap-2 text-xs font-semibold text-[#111B21] dark:text-[#E9EDEF]">
                <Lock className="w-4 h-4 text-[#00A884]" />
                <span>Account Password</span>
              </div>
              <p className="text-xs text-[#54656F] dark:text-[#8696A0]">
                Update the password used to sign in as @{user.username}.
              </p>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Current password"
                autoComplete="current-password"
                required
                className="w-full px-3 py-2 rounded-lg bg-[#F0F2F5] dark:bg-[#202C33] text-xs text-[#111B21] dark:text-[#E9EDEF] focus:outline-none focus:ring-2 focus:ring-[#00A884]/40"
              />
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password (min 6 characters)"
                autoComplete="new-password"
                minLength={6}
                required
                className="w-full px-3 py-2 rounded-lg bg-[#F0F2F5] dark:bg-[#202C33] text-xs text-[#111B21] dark:text-[#E9EDEF] focus:outline-none focus:ring-2 focus:ring-[#00A884]/40"
              />
              <input
                type="password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                placeholder="Confirm new password"
                autoComplete="new-password"
                minLength={6}
                required
                className="w-full px-3 py-2 rounded-lg bg-[#F0F2F5] dark:bg-[#202C33] text-xs text-[#111B21] dark:text-[#E9EDEF] focus:outline-none focus:ring-2 focus:ring-[#00A884]/40"
              />
              <button
                type="submit"
                disabled={saving || !currentPassword || !newPassword || !confirmNewPassword}
                className="w-full py-2 rounded-lg bg-[#00A884] hover:bg-[#008F6F] disabled:opacity-50 text-white text-xs font-semibold transition-colors"
              >
                {saving ? 'Updating...' : 'Update Password'}
              </button>
            </form>

            {/* Cloud Backup (Firebase Firestore) */}
            <div className="p-3.5 rounded-xl border border-[#E9EDEF] dark:border-[#2A3942] space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#111B21] dark:text-[#E9EDEF]">
                  <Cloud className="w-4 h-4 text-[#00A884]" />
                  <span>Cloud Backup Sync</span>
                </div>
                {fbUser && (
                  <button
                    type="button"
                    onClick={() => signOut(auth)}
                    className="text-[11px] text-[#54656F] dark:text-[#8696A0] hover:underline"
                  >
                    Disconnect
                  </button>
                )}
              </div>
              {!fbUser ? (
                <button
                  type="button"
                  onClick={handleConnectGoogleBackup}
                  className="w-full py-2 px-3 rounded-xl border border-[#D1D7DB] dark:border-[#2A3942] hover:bg-[#F0F2F5] dark:hover:bg-[#202C33] text-xs font-medium text-[#111B21] dark:text-[#E9EDEF]"
                >
                  Connect Cloud Backup Account
                </button>
              ) : (
                <div className="space-y-2">
                  <div className="text-xs text-[#54656F] dark:text-[#8696A0] truncate">
                    Connected: {fbUser.email}
                  </div>
                  <button
                    type="button"
                    disabled={backingUp}
                    onClick={handleSaveCloudBackup}
                    className="w-full py-2 rounded-xl bg-[#00A884] hover:bg-[#008F6F] text-white text-xs font-semibold"
                  >
                    {backingUp ? 'Backing up...' : 'Save Snapshot Now'}
                  </button>
                  {cloudBackups.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      {cloudBackups.map((b) => (
                        <div
                          key={b.id}
                          className="flex items-center justify-between text-xs p-2 rounded-lg bg-[#F0F2F5] dark:bg-[#202C33]"
                        >
                          <div className="min-w-0">
                            <div className="font-medium truncate">{b.backupLabel}</div>
                            <div className="text-[11px] text-[#54656F] dark:text-[#8696A0] tabular-nums">
                              {b.conversationCount} chats · @{b.username}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteCloudBackup(b.id)}
                            className="p-1 text-red-500 hover:bg-red-500/10 rounded"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Logout & Delete Account */}
            <div className="pt-2 space-y-2 border-t border-[#E9EDEF] dark:border-[#222E35]">
              <button
                type="button"
                onClick={onLogout}
                className="w-full py-2.5 px-4 rounded-xl border border-[#D1D7DB] dark:border-[#2A3942] hover:bg-[#F0F2F5] dark:hover:bg-[#202C33] text-sm font-medium text-[#111B21] dark:text-[#E9EDEF] flex items-center justify-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                <span>Log Out</span>
              </button>

              {!confirmDelete ? (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="w-full py-2.5 px-4 rounded-xl text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 flex items-center justify-center gap-1.5"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Delete Account Permanently</span>
                </button>
              ) : (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 space-y-2.5">
                  <p className="text-xs text-red-700 dark:text-red-300">
                    This permanently deletes @{user.username}, your profile, contacts, and messages.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="flex-1 py-1.5 rounded-lg border border-red-300 dark:border-red-800 text-xs font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={handleDeleteAccount}
                      className="flex-1 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold"
                    >
                      Confirm Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

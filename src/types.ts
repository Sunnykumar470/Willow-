export type PrivacyScope = 'everyone' | 'contacts' | 'nobody';
export type StatusVisibility = 'everyone' | 'contacts';

export interface OwnAccount {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  isOnline: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  privacyLastSeen: PrivacyScope;
  privacyProfilePhoto: PrivacyScope;
  privacyOnline: 'everyone' | 'nobody';
  privacyReadReceipts: boolean;
  privacyStatus: StatusVisibility;
  theme: 'light' | 'dark';
}

export interface UserProfile {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  isOnline: boolean;
  lastSeenAt: string | null;
  isContact: boolean;
  isBlocked: boolean;
  blockedByPeer?: boolean;
}

export interface MessageReaction {
  emoji: string;
  userId: string;
  username: string;
  displayName: string;
  createdAt: string;
}

export interface ReplyPreview {
  id: string;
  senderId: string;
  senderUsername: string;
  senderDisplayName: string;
  type: ChatMessage['type'];
  content: string;
  mediaName: string | null;
  isDeleted: boolean;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderUsername: string;
  senderDisplayName: string;
  senderAvatarUrl: string | null;
  type: 'text' | 'image' | 'video' | 'document' | 'audio' | 'system';
  content: string;
  mediaUrl: string | null;
  mediaName: string | null;
  mediaMime: string | null;
  mediaSize: number | null;
  mediaDuration: number | null;
  replyToId: string | null;
  replyTo: ReplyPreview | null;
  forwardedFromId: string | null;
  isEdited: boolean;
  isDeleted: boolean;
  status: 'sent' | 'delivered' | 'read';
  reactions: MessageReaction[];
  isStarred: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationGroupInfo {
  name: string;
  description: string;
  avatarUrl: string | null;
  memberCount: number;
  myRole: 'admin' | 'member';
}

export interface ConversationSummary {
  id: string;
  type: 'direct' | 'group';
  title: string;
  subtitle: string;
  avatarUrl: string | null;
  peer: UserProfile | null;
  group: ConversationGroupInfo | null;
  lastMessage: ChatMessage | null;
  unreadCount: number;
  archived: boolean;
  muted: boolean;
  pinned: boolean;
  updatedAt: string;
}

export interface GroupMember {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  role: 'admin' | 'member';
  isOnline: boolean;
  lastSeenAt: string | null;
  joinedAt: string;
}

export interface TypingUser {
  conversationId: string;
  userId: string;
  username: string;
  displayName: string;
  isTyping: boolean;
}

export interface StatusViewer {
  viewerId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  viewedAt: string;
}

export interface StatusItem {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  type: 'text' | 'image' | 'video';
  content: string;
  mediaUrl: string | null;
  bgColor: string;
  visibility: StatusVisibility;
  createdAt: string;
  expiresAt: string;
  viewedByMe: boolean;
  viewCount: number;
  viewers?: StatusViewer[];
}

export interface StatusGroup {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isMine: boolean;
  hasUnviewed: boolean;
  items: StatusItem[];
}

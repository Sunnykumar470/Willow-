import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  type User as FirebaseUser,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { auth } from './firebase.ts';

export const GOOGLE_CHAT_PROJECT_ID = firebaseConfig.projectId;
export const GOOGLE_CHAT_CONSOLE_URL = `https://console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat?project=${encodeURIComponent(
  GOOGLE_CHAT_PROJECT_ID
)}`;

export const GOOGLE_CHAT_SCOPES = [
  'https://www.googleapis.com/auth/chat.admin.delete',
  'https://www.googleapis.com/auth/chat.admin.memberships',
  'https://www.googleapis.com/auth/chat.admin.memberships.readonly',
  'https://www.googleapis.com/auth/chat.admin.spaces',
  'https://www.googleapis.com/auth/chat.admin.spaces.readonly',
  'https://www.googleapis.com/auth/chat.customemojis',
  'https://www.googleapis.com/auth/chat.customemojis.readonly',
  'https://www.googleapis.com/auth/chat.delete',
  'https://www.googleapis.com/auth/chat.memberships',
  'https://www.googleapis.com/auth/chat.memberships.app',
  'https://www.googleapis.com/auth/chat.memberships.readonly',
  'https://www.googleapis.com/auth/chat.messages',
  'https://www.googleapis.com/auth/chat.messages.create',
  'https://www.googleapis.com/auth/chat.messages.reactions',
  'https://www.googleapis.com/auth/chat.messages.reactions.create',
  'https://www.googleapis.com/auth/chat.messages.reactions.readonly',
  'https://www.googleapis.com/auth/chat.messages.readonly',
  'https://www.googleapis.com/auth/chat.spaces',
  'https://www.googleapis.com/auth/chat.spaces.create',
  'https://www.googleapis.com/auth/chat.spaces.readonly',
  'https://www.googleapis.com/auth/chat.users.readstate',
  'https://www.googleapis.com/auth/chat.users.readstate.readonly',
  'https://www.googleapis.com/auth/chat.users.sections',
  'https://www.googleapis.com/auth/chat.users.sections.readonly',
  'https://www.googleapis.com/auth/chat.users.spacesettings',
] as const;

const chatGoogleProvider = new GoogleAuthProvider();
for (const scope of GOOGLE_CHAT_SCOPES) {
  chatGoogleProvider.addScope(scope);
}

// Strict in-memory cache (never stored in localStorage or sessionStorage)
let isSigningIn = false;
let cachedAccessToken: string | null = null;

export function initGoogleChatAuth(
  onAuthSuccess?: (user: FirebaseUser, token: string) => void,
  onAuthFailure?: () => void
) {
  return onAuthStateChanged(auth, (user) => {
    if (user) {
      if (cachedAccessToken) {
        onAuthSuccess?.(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        onAuthFailure?.();
      }
    } else {
      cachedAccessToken = null;
      onAuthFailure?.();
    }
  });
}

export async function googleChatSignIn(): Promise<{
  user: FirebaseUser;
  accessToken: string;
}> {
  isSigningIn = true;
  try {
    const result = await signInWithPopup(auth, chatGoogleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Could not obtain a Google Workspace access token.');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
}

export function getGoogleChatAccessToken(): string | null {
  return cachedAccessToken;
}

export async function googleChatSignOut(): Promise<void> {
  cachedAccessToken = null;
  await auth.signOut();
}

export interface GoogleChatSpace {
  name: string;
  type?: 'ROOM' | 'DM' | 'SPACE' | 'GROUP_CHAT' | 'DIRECT_MESSAGE' | string;
  spaceType?: 'SPACE' | 'GROUP_CHAT' | 'DIRECT_MESSAGE' | string;
  displayName?: string;
  singleUserBotDm?: boolean;
  threaded?: boolean;
  spaceThreadingState?: string;
  spaceHistoryState?: string;
  membershipCount?: {
    joinedDirectHumanUserCount?: number;
    joinedGroupCount?: number;
  };
}

export interface GoogleChatReactionSummary {
  emoji?: {
    unicode?: string;
    customEmoji?: { uid?: string; name?: string; emojiName?: string };
  };
  reactionCount?: number;
}

export interface GoogleChatMessage {
  name: string;
  sender?: {
    name?: string;
    displayName?: string;
    type?: 'HUMAN' | 'BOT' | string;
  };
  createTime?: string;
  lastUpdateTime?: string;
  text?: string;
  formattedText?: string;
  emojiReactionSummaries?: GoogleChatReactionSummary[];
}

export interface GoogleChatMembership {
  name: string;
  role?: string;
  state?: string;
  member?: {
    name?: string;
    displayName?: string;
    type?: 'HUMAN' | 'BOT' | string;
  };
}

export class GoogleChatApiError extends Error {
  status: number;
  isAppNotConfigured: boolean;
  isConsumerUnsupported: boolean;
  isAuthExpired: boolean;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'GoogleChatApiError';
    this.status = status;
    const lower = message.toLowerCase();
    this.isAppNotConfigured =
      status === 404 && lower.includes('google chat app not found');
    this.isConsumerUnsupported =
      status === 403 ||
      lower.includes('workspace') ||
      lower.includes('consumer') ||
      lower.includes('insufficient');
    this.isAuthExpired = status === 401;
  }
}

async function chatFetch<T>(
  path: string,
  accessToken: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${accessToken}`);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`https://chat.googleapis.com/v1${path}`, {
    ...options,
    headers,
  });

  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  if (text) {
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = { error: { message: text } };
    }
  }

  if (!res.ok) {
    const errObj = parsed.error as { message?: string } | undefined;
    const msg =
      errObj?.message || `Google Chat API request failed (${res.status})`;
    if (res.status === 401) {
      cachedAccessToken = null;
    }
    throw new GoogleChatApiError(msg, res.status);
  }

  return parsed as T;
}

export async function listGoogleChatSpaces(
  accessToken: string
): Promise<GoogleChatSpace[]> {
  const data = await chatFetch<{ spaces?: GoogleChatSpace[] }>(
    '/spaces?pageSize=50',
    accessToken
  );
  return data.spaces || [];
}

export async function createGoogleChatSpace(
  accessToken: string,
  displayName: string,
  spaceType: 'SPACE' | 'GROUP_CHAT' = 'SPACE'
): Promise<GoogleChatSpace> {
  return chatFetch<GoogleChatSpace>('/spaces', accessToken, {
    method: 'POST',
    body: JSON.stringify({
      spaceType,
      displayName: displayName.trim(),
    }),
  });
}

export async function deleteGoogleChatSpace(
  accessToken: string,
  spaceName: string
): Promise<void> {
  await chatFetch(`/${spaceName}`, accessToken, {
    method: 'DELETE',
  });
}

export async function listGoogleChatMessages(
  accessToken: string,
  spaceName: string
): Promise<GoogleChatMessage[]> {
  const data = await chatFetch<{ messages?: GoogleChatMessage[] }>(
    `/${spaceName}/messages?pageSize=50&orderBy=createTime%20desc`,
    accessToken
  );
  return [...(data.messages || [])].reverse();
}

export async function sendGoogleChatMessage(
  accessToken: string,
  spaceName: string,
  text: string
): Promise<GoogleChatMessage> {
  return chatFetch<GoogleChatMessage>(`/${spaceName}/messages`, accessToken, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

export async function updateGoogleChatMessage(
  accessToken: string,
  messageName: string,
  text: string
): Promise<GoogleChatMessage> {
  return chatFetch<GoogleChatMessage>(
    `/${messageName}?updateMask=text`,
    accessToken,
    {
      method: 'PATCH',
      body: JSON.stringify({ text }),
    }
  );
}

export async function deleteGoogleChatMessage(
  accessToken: string,
  messageName: string
): Promise<void> {
  await chatFetch(`/${messageName}`, accessToken, {
    method: 'DELETE',
  });
}

export async function createGoogleChatReaction(
  accessToken: string,
  messageName: string,
  unicodeEmoji: string
): Promise<void> {
  await chatFetch(`/${messageName}/reactions`, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      emoji: { unicode: unicodeEmoji },
    }),
  });
}

export async function listGoogleChatMembers(
  accessToken: string,
  spaceName: string
): Promise<GoogleChatMembership[]> {
  const data = await chatFetch<{ memberships?: GoogleChatMembership[] }>(
    `/${spaceName}/memberships?pageSize=50`,
    accessToken
  );
  return data.memberships || [];
}

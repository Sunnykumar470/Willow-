let memorySessionToken: string | null = null;

export function setSessionToken(token: string | null): void {
  memorySessionToken = token;
}

export function getSessionToken(): string | null {
  return memorySessionToken;
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set('X-Requested-With', 'WillowClient');
  if (memorySessionToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${memorySessionToken}`);
  }
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  const text = await res.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      data = { error: text };
    }
  }

  if (!res.ok) {
    const msg = typeof data.error === 'string' ? data.error : `Request failed (${res.status})`;
    throw new Error(msg);
  }

  return data as T;
}

export async function uploadFile(file: File | Blob, filename?: string): Promise<{
  url: string;
  name: string;
  mime: string;
  size: number;
}> {
  const form = new FormData();
  if (file instanceof File) {
    form.append('file', file);
  } else {
    form.append('file', file, filename || `recording_${Date.now()}.webm`);
  }

  const headers: Record<string, string> = { 'X-Requested-With': 'WillowClient' };
  if (memorySessionToken) {
    headers.Authorization = `Bearer ${memorySessionToken}`;
  }

  const res = await fetch('/api/upload', {
    method: 'POST',
    headers,
    body: form,
    credentials: 'include',
  });

  const data = (await res.json()) as {
    url?: string;
    name?: string;
    mime?: string;
    size?: number;
    error?: string;
  };
  if (!res.ok || !data.url) {
    throw new Error(data.error || 'File upload failed');
  }

  return {
    url: data.url,
    name: data.name || 'attachment',
    mime: data.mime || 'application/octet-stream',
    size: data.size || 0,
  };
}

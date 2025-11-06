import { API_BASE_URL } from '../config';

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  return {};
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  const url = resolveUrl(path);
  const response = await fetch(url, {
    ...init,
    headers: {
      ...getAuthHeaders(),
      ...(init?.headers ?? {}),
    },
    credentials: 'include',
    cache: 'no-store',
  });

  if (!response.ok) {
    const message = await extractError(response);
    throw new Error(message);
  }

  return (await response.json()) as T;
}

export async function apiPost<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
  const url = resolveUrl(path);
  const response = await fetch(url, {
    ...init,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...(init?.headers ?? {}),
    },
    body: JSON.stringify(body),
    credentials: 'include',
    cache: 'no-store',
  });

  if (!response.ok) {
    const message = await extractError(response);
    throw new Error(message);
  }

  return (await response.json()) as T;
}

export async function apiDelete<T>(path: string, init?: RequestInit): Promise<T> {
  const url = resolveUrl(path);
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      ...getAuthHeaders(),
      ...(init?.headers ?? {}),
    },
    credentials: 'include',
    cache: 'no-store',
    ...init,
  });

  if (!response.ok) {
    const message = await extractError(response);
    throw new Error(message);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return (await response.json()) as T;
}

async function extractError(response: Response): Promise<string> {
  try {
    const payload = await response.json();
    return payload.error ?? payload.message ?? response.statusText;
  } catch {
    return response.statusText;
  }
}

function resolveUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }

  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...options, credentials: 'same-origin', headers });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json().catch(() => null) : null;
  if (!response.ok) {
    const message = (data && typeof data.error === 'string' && data.error) || `Request failed with status ${response.status}`;
    throw new ApiError(message, response.status);
  }
  return data as T;
}

export async function publicRequest<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin' });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError((data && typeof data.error === 'string' && data.error) || `Request failed with status ${response.status}`, response.status);
  return data as T;
}

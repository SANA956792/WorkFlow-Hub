export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export const UNAUTHORIZED_EVENT = 'wo:unauthorized';

const RETRYABLE_GATEWAY_STATUSES = new Set([502, 503, 504]);
const MAX_GET_RETRIES = 2; // up to 2 additional attempts (3 total)
const BASE_BACKOFF_MS = 400;

function isIframeContext(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (typeof error === 'object' &&
      error !== null &&
      (error as any).name === 'AbortError')
  );
}

function formatReadableError(status: number, serverError: unknown): string {
  if (status === 401) {
    return typeof serverError === 'string' && serverError.trim()
      ? serverError
      : 'Your session expired. Please enter your Company Access Code.';
  }
  if (RETRYABLE_GATEWAY_STATUSES.has(status)) {
    return 'Server is temporarily busy. Please try again in a moment.';
  }
  if (typeof serverError === 'string' && serverError.trim()) {
    const cleaned = serverError.trim();
    if (cleaned.startsWith('<') || cleaned.length > 240) {
      return 'Unable to reach the server cleanly. Please try again.';
    }
    return cleaned;
  }
  if (status >= 500) {
    return 'Unable to load data from the server right now. Please try again.';
  }
  return `Request could not be completed (status ${status}).`;
}

function sleepWithSignal(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function fetchWithSafeGetRetry(
  path: string,
  options: RequestInit
): Promise<Response> {
  const method = (options.method || 'GET').toUpperCase();
  const isSafeRead = method === 'GET' || method === 'HEAD';
  const maxAttempts = isSafeRead ? 1 + MAX_GET_RETRIES : 1;

  const headers = new Headers(options.headers || {});
  headers.set('X-Requested-With', 'XMLHttpRequest');
  if (isIframeContext()) {
    headers.set('X-Embedded-Context', 'iframe');
  }
  if (
    options.body &&
    !(options.body instanceof FormData) &&
    !headers.has('Content-Type')
  ) {
    headers.set('Content-Type', 'application/json');
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (options.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    try {
      const response = await fetch(path, {
        ...options,
        credentials: 'same-origin',
        headers,
      });

      if (
        isSafeRead &&
        RETRYABLE_GATEWAY_STATUSES.has(response.status) &&
        attempt < maxAttempts - 1
      ) {
        const delayMs = BASE_BACKOFF_MS * Math.pow(2, attempt);
        await sleepWithSignal(delayMs, options.signal);
        continue;
      }

      return response;
    } catch (err) {
      if (isAbortError(err)) {
        throw err;
      }
      lastError = err;
      if (!isSafeRead || attempt >= maxAttempts - 1) {
        throw new ApiError(
          'Connection error. Please check your internet connection and try again.',
          0
        );
      }
      const delayMs = BASE_BACKOFF_MS * Math.pow(2, attempt);
      await sleepWithSignal(delayMs, options.signal);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new ApiError(
        'Connection error. Please check your internet connection and try again.',
        0
      );
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetchWithSafeGetRetry(path, options);

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : null;

  if (!response.ok) {
    if (response.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    }
    const message = formatReadableError(response.status, data?.error);
    throw new ApiError(message, response.status);
  }

  return data as T;
}

export async function publicRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetchWithSafeGetRetry(path, options);

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : null;

  if (!response.ok) {
    throw new ApiError(
      formatReadableError(response.status, data?.error),
      response.status
    );
  }
  return data as T;
}

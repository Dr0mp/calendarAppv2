import { session, onUnauthorized } from './state/session.js';
import { t, has } from './i18n/index.js';

export class ApiError extends Error {
  /** @param {number} status @param {string} code @param {any} [details] */
  constructor(status, code, details) {
    super(code);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** The translated, user-facing message for this error. */
  get text() {
    return errorText(this.code);
  }

  /** Field errors: {path: code}. */
  get fields() {
    return /** @type {Record<string,string>} */ (this.details?.fields ?? {});
  }
}

/** @param {string} code */
export function errorText(code) {
  return has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic');
}

/**
 * Call the JSON API. Adds the CSRF token and If-Match, maps error codes, and
 * sends the app back to sign-in on 401.
 * @param {'GET'|'POST'|'PUT'|'PATCH'|'DELETE'} method
 * @param {string} path  relative to /api/v1
 * @param {{body?: unknown, version?: number, signal?: AbortSignal, query?: Record<string, unknown>}} [opts]
 */
export async function api(method, path, opts = {}) {
  /** @type {Record<string,string>} */
  const headers = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const csrf = session.value?.csrfToken;
  if (csrf && method !== 'GET') headers['X-CSRF-Token'] = csrf;
  if (opts.version !== undefined) headers['If-Match'] = `W/"${opts.version}"`;
  let url = `/api/v1${path}`;
  if (opts.query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query)) {
      if (v === undefined || v === null || v === '') continue;
      if (Array.isArray(v)) v.forEach((x) => qs.append(k, String(x)));
      else qs.set(k, String(v));
    }
    const s = qs.toString();
    if (s) url += `?${s}`;
  }
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
      credentials: 'same-origin',
    });
  } catch (err) {
    if (/** @type {any} */ (err)?.name === 'AbortError') throw err;
    throw new ApiError(0, 'network_error');
  }
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('application/json') ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const code = data?.error?.code ?? (res.status >= 500 ? 'server_error' : 'generic');
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized();
    throw new ApiError(res.status, code, data?.error?.details);
  }
  return data;
}

export const get = (path, query, signal) => api('GET', path, { query, signal });
export const post = (path, body) => api('POST', path, { body });
export const patch = (path, body, version) => api('PATCH', path, { body, version });
export const put = (path, body, version) => api('PUT', path, { body, version });
export const del = (path, version, query) => api('DELETE', path, { version, query });

/**
 * Upload a file with progress (fetch has no upload progress, so XHR).
 * @param {File|Blob} file
 * @param {{onProgress?: (fraction: number) => void, signal?: AbortSignal, name?: string}} [opts]
 * @returns {Promise<any>}
 */
export function upload(file, opts = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/v1/media');
    xhr.responseType = 'json';
    const csrf = session.value?.csrfToken;
    if (csrf) xhr.setRequestHeader('X-CSRF-Token', csrf);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-Filename', encodeURIComponent(opts.name ?? /** @type {File} */ (file).name ?? 'file'));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
      else {
        if (xhr.status === 401) onUnauthorized();
        reject(new ApiError(xhr.status, xhr.response?.error?.code ?? 'upload_failed', xhr.response?.error?.details));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, 'network_error'));
    xhr.onabort = () => reject(new ApiError(0, 'aborted'));
    opts.signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(file);
  });
}

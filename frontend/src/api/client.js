import { getAccessToken, setAccessToken, getCollegeCode, clearSession } from '@/lib/authStorage';

export class ApiError extends Error {
  constructor(status, detail, body) {
    super(detail || `Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
    this.body = body;
  }
}

const BASE_URL = '/api/v1';

let refreshPromise = null;

// ARCNAVE modernization P0 (PDF 5.1 / clash C6): the refresh token is
// an httpOnly cookie now — `credentials: 'include'` is what makes the
// browser attach it, there is no token for this function to read or
// write on the JS side at all anymore.
async function doRefresh() {
  const collegeCode = getCollegeCode();
  const res = await fetch(`${BASE_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      ...(collegeCode ? { 'X-College-Code': collegeCode } : {}),
    },
  });
  if (!res.ok) {
    clearSession();
    throw new ApiError(res.status, 'Session expired');
  }
  const data = await res.json();
  setAccessToken(data.access_token);
  return data.access_token;
}

// Single flight: concurrent 401s trigger one refresh, not one per request.
export function refreshOnce() {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function request(path, { method = 'GET', body, headers = {}, isRetry = false, signal } = {}) {
  const token = getAccessToken();
  const collegeCode = getCollegeCode();

  const finalHeaders = { ...headers };
  if (body !== undefined) finalHeaders['Content-Type'] = 'application/json';
  if (token) finalHeaders['Authorization'] = `Bearer ${token}`;
  if (collegeCode) finalHeaders['X-College-Code'] = collegeCode;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: finalHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
    // Only /auth/login, /auth/refresh and /auth/logout actually carry
    // the httpOnly refresh-token cookie (it's path-scoped server-side
    // to /api/v1/auth) — harmless to set on every request rather than
    // special-casing three paths here.
    credentials: 'include',
  });

  if (res.status === 401 && !isRetry && token) {
    try {
      await refreshOnce();
      return request(path, { method, body, headers, isRetry: true, signal });
    } catch {
      window.location.assign('/login');
      throw new ApiError(401, 'Session expired');
    }
  }

  if (res.status === 204) return null;

  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : await res.blob();

  if (!res.ok) {
    throw new ApiError(res.status, data && data.detail, data);
  }

  return data;
}

export const api = {
  get: (path, opts) => request(path, { ...opts, method: 'GET' }),
  post: (path, body, opts) => request(path, { ...opts, method: 'POST', body }),
  put: (path, body, opts) => request(path, { ...opts, method: 'PUT', body }),
  patch: (path, body, opts) => request(path, { ...opts, method: 'PATCH', body }),
  delete: (path, opts) => request(path, { ...opts, method: 'DELETE' }),
};

export async function postMultipart(path, formData) {
  const token = getAccessToken();
  const collegeCode = getCollegeCode();
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (collegeCode) headers['X-College-Code'] = collegeCode;

  const res = await fetch(`${BASE_URL}${path}`, { method: 'POST', headers, body: formData });

  if (res.status === 401 && token) {
    await refreshOnce().catch(() => {
      window.location.assign('/login');
      throw new ApiError(401, 'Session expired');
    });
    return postMultipart(path, formData);
  }

  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    throw new ApiError(res.status, data && data.detail, data);
  }
  return data;
}

async function fetchAuthenticatedBlob(path) {
  const token = getAccessToken();
  const collegeCode = getCollegeCode();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(collegeCode ? { 'X-College-Code': collegeCode } : {}),
    },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data && data.detail, data);
  }
  return res.blob();
}

export async function downloadFile(path, fallbackFileName) {
  const blob = await fetchAuthenticatedBlob(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fallbackFileName || 'download';
  a.click();
  URL.revokeObjectURL(url);
}

// A generated image needs an in-page <img src> preview, not just a
// save-to-disk click — the download endpoint requires a Bearer token
// (GET /documents/:id/download), so a plain <img src="..."> can never
// work; this fetches the same authenticated blob and hands back an
// object URL the caller owns and must revoke (URL.revokeObjectURL) once
// it's no longer displayed, same lifecycle discipline downloadFile's own
// short-lived object URL above already follows.
export async function fetchBlobUrl(path) {
  const blob = await fetchAuthenticatedBlob(path);
  return URL.createObjectURL(blob);
}

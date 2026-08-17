// Access token lives in memory only (module-level, not localStorage) to
// limit XSS blast radius. Refresh token + college code persist in
// sessionStorage so a reload doesn't force a re-login within the tab.
// Ported unchanged from the production auth contract — this is
// functional wiring, not visual design, and must match the real
// backend exactly.
let accessToken = null;

export function getAccessToken() {
  return accessToken;
}

export function setAccessToken(token) {
  accessToken = token;
}

const REFRESH_KEY = 'arcnave.refresh_token';
const COLLEGE_KEY = 'arcnave.college_code';

export function getRefreshToken() {
  return sessionStorage.getItem(REFRESH_KEY);
}

export function setRefreshToken(token) {
  if (token) sessionStorage.setItem(REFRESH_KEY, token);
  else sessionStorage.removeItem(REFRESH_KEY);
}

export function getCollegeCode() {
  return sessionStorage.getItem(COLLEGE_KEY);
}

export function setCollegeCode(code) {
  if (code) sessionStorage.setItem(COLLEGE_KEY, code);
  else sessionStorage.removeItem(COLLEGE_KEY);
}

export function clearSession() {
  accessToken = null;
  sessionStorage.removeItem(REFRESH_KEY);
}

// Decodes the JWT payload only — never trust this for authorization,
// it's for reading sub/college_id/role to hydrate UI state. The server
// re-verifies the signature on every request.
export function decodeJwt(token) {
  if (!token) return null;
  try {
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch {
    return null;
  }
}

// Access token lives in memory only (module-level, not localStorage) to
// limit XSS blast radius. College code persists in sessionStorage so a
// reload doesn't force a re-login within the tab — it's not a secret,
// just a routing hint.
//
// ARCNAVE modernization P0 (PDF 5.1 / clash C6): the refresh token no
// longer lives in any browser-script-readable storage at all. The
// backend now sets it as an httpOnly, SameSite=Strict cookie
// (routes/auth.js / routes/positionAccounts.js) that the browser
// attaches automatically to /auth/refresh and /auth/logout — no
// client-side script, including an XSS payload, can read or exfiltrate
// it anymore. See api/client.js's `credentials: 'include'` fetch calls
// for the other half of this fix.
let accessToken = null;

export function getAccessToken() {
  return accessToken;
}

export function setAccessToken(token) {
  accessToken = token;
}

const COLLEGE_KEY = 'arcnave.college_code';

export function getCollegeCode() {
  return sessionStorage.getItem(COLLEGE_KEY);
}

export function setCollegeCode(code) {
  if (code) sessionStorage.setItem(COLLEGE_KEY, code);
  else sessionStorage.removeItem(COLLEGE_KEY);
}

export function clearSession() {
  accessToken = null;
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

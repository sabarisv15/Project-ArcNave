'use strict';

// ARCNAVE modernization P0 (PDF 5.1 / clash C6) — the refresh-token
// cookie helpers, used by routes/auth.js's login/mfa-verify/refresh/
// logout handlers and routes/positionAccounts.js's mirror of the same
// shape. `createRefreshCookieHelpers` is a small factory rather than
// one fixed export so both call sites can bind their own cookie
// descriptor (config.js's `refreshCookie`/`positionRefreshCookie`) —
// name/path differ, but the flag set and the get/set/clear logic must
// stay identical, which one factory guarantees better than two
// hand-copies would.

const config = require('../config');

function createRefreshCookieHelpers(cookieConfig) {
  const options = {
    httpOnly: cookieConfig.httpOnly,
    sameSite: cookieConfig.sameSite,
    secure: cookieConfig.secure,
    path: cookieConfig.path,
    domain: cookieConfig.domain,
    maxAge: config.refreshTokenExpireDays * 24 * 60 * 60 * 1000,
  };

  function setRefreshCookie(res, refreshToken) {
    res.cookie(cookieConfig.name, refreshToken, options);
  }

  function clearRefreshCookie(res) {
    // clearCookie must be called with the SAME path/domain the cookie
    // was set with, or the browser treats it as a different cookie and
    // leaves the real one in place — maxAge is deliberately omitted,
    // express's clearCookie doesn't need it.
    res.clearCookie(cookieConfig.name, {
      httpOnly: options.httpOnly,
      sameSite: options.sameSite,
      secure: options.secure,
      path: options.path,
      domain: options.domain,
    });
  }

  function getRefreshTokenFromRequest(req) {
    return req.cookies ? req.cookies[cookieConfig.name] : undefined;
  }

  return { setRefreshCookie, clearRefreshCookie, getRefreshTokenFromRequest };
}

module.exports = {
  createRefreshCookieHelpers,
  ...createRefreshCookieHelpers(config.refreshCookie),
};

// Browser replacement for server/src/auth.js. Same exports and behaviour, without node:crypto.
// Everything runs in the visitor's own browser, so this protects nothing; it keeps roles and
// scoping working exactly as on the real server.
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const hash = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };
const b64 = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

export function setSecret() {}
export const hashPassword = (pw) => `demo$${hash(pw)}`;
export const verifyPassword = (pw, stored) => hashPassword(pw) === stored;
export const signToken = (userId) => `${b64(JSON.stringify({ uid: userId, exp: Date.now() + TOKEN_TTL_MS }))}.demo`;
export function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  try { const d = JSON.parse(unb64(token.split('.')[0])); return d.exp > Date.now() ? d : null; } catch { return null; }
}
export function publicUser(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u; // eslint-disable-line no-unused-vars
  return rest;
}
export function makeAuth(db) {
  const getUser = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1');
  return function auth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
    const data = verifyToken(token);
    const user = data && getUser.get(data.uid);
    if (!user) return res.status(401).json({ error: 'Not signed in or session expired' });
    req.user = publicUser(user);
    next();
  };
}
export const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Not permitted for your role' });

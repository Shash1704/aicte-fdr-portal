// Encryption at rest: AES-256-GCM for uploaded documents and sensitive fields (bank account numbers).
// The key comes from FDR_VAULT_KEY (64 hex chars) or a key generated once and kept in the settings table.
// In production the key would live in an HSM / key-management service, not in the database.
import crypto from 'node:crypto';

let KEY = process.env.FDR_VAULT_KEY ? Buffer.from(process.env.FDR_VAULT_KEY, 'hex') : null;
export const VAULT_MODE = 'aes-256-gcm';

export function initVault(db) {
  if (KEY) return;
  let hex = db.prepare("SELECT value FROM settings WHERE key = 'vault_key'").get()?.value;
  if (!hex) {
    hex = crypto.randomBytes(32).toString('hex');
    db.prepare("INSERT INTO settings (key, value) VALUES ('vault_key', ?)").run(hex);
  }
  KEY = Buffer.from(hex.replace(/"/g, ''), 'hex');
}

/** bytes → iv(12) | tag(16) | ciphertext */
export function encryptBytes(bytes) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const out = Buffer.concat([c.update(Buffer.from(bytes)), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), out]);
}
export function decryptBytes(blob) {
  const b = Buffer.from(blob);
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]);
}
export const encryptText = (s) => (s ? encryptBytes(Buffer.from(String(s), 'utf8')).toString('base64') : null);
export const decryptText = (s) => (s ? decryptBytes(Buffer.from(s, 'base64')).toString('utf8') : null);

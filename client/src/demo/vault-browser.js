// Browser stand-in for server/src/vault.js. The demo runs entirely in the visitor's browser, so
// there is nothing to protect: values are only base64-wrapped. The real server uses AES-256-GCM.
export const VAULT_MODE = 'demo';
export function initVault() {}
export const encryptBytes = (b) => b;
export const decryptBytes = (b) => b;
export const encryptText = (s) => (s ? `demo:${btoa(unescape(encodeURIComponent(String(s))))}` : null);
export const decryptText = (s) => (s ? decodeURIComponent(escape(atob(String(s).replace(/^demo:/, '')))) : null);

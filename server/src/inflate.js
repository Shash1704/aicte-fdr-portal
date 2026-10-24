// Decompresses FlateDecode PDF streams on the server (the browser demo substitutes a no-op).
import zlib from 'node:zlib';

export function inflate(bytes) {
  try { return new Uint8Array(zlib.inflateSync(Buffer.from(bytes))); } catch { return null; }
}

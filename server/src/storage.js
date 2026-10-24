// Document store: files are encrypted before they touch the disk.
import fs from 'node:fs';
import path from 'node:path';
import { UPLOAD_DIR } from './db.js';
import { encryptBytes, decryptBytes } from './vault.js';

export function makeStore() {
  return {
    save(name, bytes) { fs.writeFileSync(path.join(UPLOAD_DIR, path.basename(name)), encryptBytes(bytes)); },
    read(name) {
      const file = path.join(UPLOAD_DIR, path.basename(name));
      return fs.existsSync(file) ? decryptBytes(fs.readFileSync(file)) : null;
    },
  };
}

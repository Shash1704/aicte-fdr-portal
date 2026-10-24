// Browser stand-in for server/src/storage.js: documents live in a table inside the demo database.
export function makeStore(db) {
  db.exec('CREATE TABLE IF NOT EXISTS demo_blobs (name TEXT PRIMARY KEY, data BLOB);');
  const put = db.prepare('INSERT OR REPLACE INTO demo_blobs (name, data) VALUES (?,?)');
  const get = db.prepare('SELECT data FROM demo_blobs WHERE name = ?');
  return {
    save(name, bytes) { put.run(name, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)); },
    read(name) { return get.get(name)?.data ?? null; },
  };
}

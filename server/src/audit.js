// Tamper-evident audit trail: each entry stores the hash of the previous one, so editing or
// deleting any past entry breaks the chain from that point on (see verifyAuditChain).
import { nowIso } from './dbutil.js';
import { sha256 } from './sha256.js';

const GENESIS = '0'.repeat(64);
const entryHash = (prev, e) => sha256(`${prev}|${e.at}|${e.user_id ?? ''}|${e.action}|${e.entity ?? ''}|${e.entity_id ?? ''}|${e.details ?? ''}`);

export function makeAudit(db) {
  const last = db.prepare('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1');
  const ins = db.prepare('INSERT INTO audit_log (at, user_id, action, entity, entity_id, details, ip, prev_hash, hash) VALUES (?,?,?,?,?,?,?,?,?)');
  return (user, action, entity, entityId, details, ip = null) => {
    const e = { at: nowIso(), user_id: user?.id ?? null, action, entity: entity ?? null, entity_id: entityId == null ? null : String(entityId), details: details ? JSON.stringify(details) : null };
    const prev = last.get()?.hash ?? GENESIS;
    ins.run(e.at, e.user_id, e.action, e.entity, e.entity_id, e.details, ip, prev, entryHash(prev, e));
  };
}

/** Recomputes the whole chain. Returns { ok, checked, brokenAt } (brokenAt = first bad entry id). */
export function verifyAuditChain(db) {
  let prev = GENESIS;
  let checked = 0;
  for (const e of db.prepare('SELECT * FROM audit_log ORDER BY id').all()) {
    if (e.prev_hash !== prev || entryHash(prev, e) !== e.hash) return { ok: false, checked, brokenAt: e.id };
    prev = e.hash;
    checked++;
  }
  return { ok: true, checked, brokenAt: null };
}

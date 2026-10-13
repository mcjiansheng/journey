import { transaction } from './db.mjs';
import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync,chmodSync } from 'node:fs';

// This independent identity/authority ledger stays current when business data is restored.
// It contains password hashes and authorization boundaries, never itinerary payloads.
export function openSecurityLedger(path, db, { allocateEpoch = true } = {}) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const ledger = new DatabaseSync(path);
  if (path !== ':memory:') chmodSync(path, 0o600);
  ledger.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;
    CREATE TABLE IF NOT EXISTS authority(tripId TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS identities(userId TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS revoked_sessions(tokenHash TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS runtime(key TEXT PRIMARY KEY,value INTEGER NOT NULL);
    INSERT OR IGNORE INTO runtime VALUES('epoch',0);`);

  function captureTrip(tripId) {
    const purge = db.prepare('SELECT * FROM purges WHERE tripId=?').get(tripId);
    if (purge) return { tripId, purge };
    const row = db.prepare('SELECT data FROM trips WHERE id=?').get(tripId);
    if (!row) return null;
    const trip = JSON.parse(row.data);
    return {
      tripId, ownerId: trip.ownerId, teamMode: trip.teamMode,
      members: db.prepare('SELECT * FROM members WHERE tripId=? ORDER BY joinOrder').all(tripId),
      removals: db.prepare('SELECT * FROM removals WHERE tripId=? ORDER BY userId').all(tripId),
      invites: db.prepare('SELECT * FROM invites WHERE tripId=? ORDER BY id').all(tripId),
    };
  }

  function replay() {
    transaction(db, () => {
      // A newer member may not exist in an older business backup. Restore the same
      // account id and credential, preserving identities already present in the backup.
      for (const row of ledger.prepare('SELECT data FROM identities').all()) {
        const { user, password } = JSON.parse(row.data);
        if (!db.prepare('SELECT 1 FROM users WHERE id=?').get(user.id)) {
          const collision = db.prepare('SELECT id FROM users WHERE identifier=?').get(user.identifier);
          if (collision) throw new Error('RESTORE_IDENTITY_CONFLICT: restore the current identity database before startup');
          db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(user.id, user.identifier, user.displayName, user.isAdmin, user.preferences);
          if (password) db.prepare('INSERT INTO passwords VALUES(?,?,?)').run(user.id, password.salt, password.digest);
        }
      }
      for (const row of ledger.prepare('SELECT data FROM authority').all()) {
        const state = JSON.parse(row.data), t = state.tripId;
        if (state.purge) {
          db.prepare('INSERT INTO purges VALUES(?,?,?) ON CONFLICT(tripId) DO UPDATE SET purgedAt=excluded.purgedAt,purgedOrder=excluded.purgedOrder').run(t, state.purge.purgedAt, state.purge.purgedOrder);
          db.prepare('DELETE FROM trips WHERE id=?').run(t);
          db.prepare('UPDATE navigation SET lastTripId=NULL WHERE lastTripId=?').run(t);
          continue;
        }
        const current = db.prepare('SELECT data FROM trips WHERE id=?').get(t);
        if (!current) continue;
        const trip = JSON.parse(current.data);
        trip.ownerId = state.ownerId;
        trip.teamMode = state.teamMode;
        db.prepare('UPDATE trips SET data=? WHERE id=?').run(JSON.stringify(trip), t);
        db.prepare('DELETE FROM members WHERE tripId=?').run(t);
        for (const m of state.members) db.prepare('INSERT INTO members VALUES(?,?,?,?,?,?)').run(t, m.userId, m.isAdmin, m.canInvite, m.joinOrder, m.archived);
        db.prepare('DELETE FROM removals WHERE tripId=?').run(t);
        for (const r of state.removals) db.prepare('INSERT INTO removals VALUES(?,?,?)').run(t, r.userId, r.removedOrder);
        db.prepare('DELETE FROM invites WHERE tripId=?').run(t);
        for (const i of state.invites) db.prepare('INSERT INTO invites VALUES(?,?,?,?,?,?,?)').run(i.id, t, i.tokenHash, i.issuedBy, i.issuedOrder, i.expiresAt, i.revokedAt);
        const maxOrder = Math.max(0, ...state.members.map(m => m.joinOrder), ...state.removals.map(r => r.removedOrder), ...state.invites.map(i => i.issuedOrder));
        db.prepare('UPDATE trips SET sequence=MAX(sequence,?) WHERE id=?').run(maxOrder, t);
        db.prepare('DELETE FROM expressions WHERE tripId=? AND userId NOT IN (SELECT userId FROM members WHERE tripId=?)').run(t, t);
        db.prepare('DELETE FROM contexts WHERE tripId=? AND userId NOT IN (SELECT userId FROM members WHERE tripId=?)').run(t, t);
      }
      for (const r of ledger.prepare('SELECT tokenHash FROM revoked_sessions').all()) db.prepare('DELETE FROM sessions WHERE tokenHash=?').run(r.tokenHash);
    });
  }

  function checkpoint(scope, result) {
    const tripIds = typeof scope.tripIds === 'function' ? scope.tripIds(result) : scope.tripIds || [];
    const userIds = typeof scope.userIds === 'function' ? scope.userIds(result) : scope.userIds || [];
    if (!tripIds.length && !userIds.length) return;
    ledger.exec('BEGIN IMMEDIATE');
    try {
      for (const id of new Set(userIds)) {
        const user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
        if (!user) continue;
        const password = db.prepare('SELECT salt,digest FROM passwords WHERE userId=?').get(id);
        ledger.prepare('INSERT INTO identities VALUES(?,?) ON CONFLICT(userId) DO UPDATE SET data=excluded.data').run(id, JSON.stringify({ user, password }));
      }
      for (const id of new Set(tripIds)) {
        const state = captureTrip(id);
        if (state) ledger.prepare('INSERT INTO authority VALUES(?,?) ON CONFLICT(tripId) DO UPDATE SET data=excluded.data').run(id, JSON.stringify(state));
      }
      ledger.exec('COMMIT');
    } catch (error) {
      ledger.exec('ROLLBACK');
      throw error;
    }
  }

  // The authority decision becomes durable before business commit. An interrupted
  // commit is completed by replay before another request receives authorization.
  function transact(fn, scope = {}) {
    try {
      return transaction(db, () => { const value = fn(); checkpoint(scope, value); return value; });
    } catch (error) {
      if (scope.tripIds || scope.userIds) replay();
      throw error;
    }
  }
  function revokeSession(tokenHash) {
    ledger.prepare('INSERT OR IGNORE INTO revoked_sessions VALUES(?)').run(tokenHash);
    db.prepare('DELETE FROM sessions WHERE tokenHash=?').run(tokenHash);
  }

  replay();
  // A business backup may have an older cursor. Every process lifetime receives a
  // higher epoch from this non-rolled-back authority store before serving snapshots.
  const epoch = allocateEpoch
    ? transaction(ledger, () => ledger.prepare("UPDATE runtime SET value=value+1 WHERE key='epoch' RETURNING value").get().value)
    : db.prepare('SELECT epoch FROM sync_meta WHERE id=1').get()?.epoch || 0;
  if (allocateEpoch) db.prepare('INSERT INTO sync_meta VALUES(1,?) ON CONFLICT(id) DO UPDATE SET epoch=excluded.epoch').run(epoch);
  // Adopt identities from a pre-ledger database once, so subsequent old backups
  // have a complete identity baseline without scanning accounts on every edit.
  const missing = db.prepare('SELECT id FROM users').all().filter(u => !ledger.prepare('SELECT 1 FROM identities WHERE userId=?').get(u.id));
  checkpoint({ userIds: missing.map(u => u.id) });
  return { epoch, transact, revokeSession, replay, close: () => ledger.close(), path };
}

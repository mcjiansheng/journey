import { DatabaseSync } from 'node:sqlite';
import { mkdirSync,chmodSync } from 'node:fs';
import { dirname } from 'node:path';
export function openDatabase(path) {
 if(path!==':memory:') mkdirSync(dirname(path),{recursive:true});
 const db=new DatabaseSync(path); if(path!==':memory:')chmodSync(path,0o600); db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON; PRAGMA busy_timeout=5000;');
 db.exec(`CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY);
 CREATE TABLE IF NOT EXISTS sync_meta(id INTEGER PRIMARY KEY CHECK(id=1),epoch INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,identifier TEXT UNIQUE NOT NULL,displayName TEXT NOT NULL,isAdmin INTEGER NOT NULL DEFAULT 0,preferences TEXT NOT NULL DEFAULT '{}');
 CREATE TABLE IF NOT EXISTS passwords(userId TEXT PRIMARY KEY REFERENCES users(id),salt TEXT NOT NULL,digest TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS auth_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,untilAt INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(tokenHash TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expiresAt INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS challenges(id TEXT PRIMARY KEY,identifier TEXT NOT NULL,codeHash TEXT NOT NULL,expiresAt INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,used INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS leases(id TEXT PRIMARY KEY,userId TEXT NOT NULL,deviceId TEXT NOT NULL,serverTime INTEGER NOT NULL,expiresAt INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS trips(id TEXT PRIMARY KEY,data TEXT NOT NULL,cursor INTEGER NOT NULL DEFAULT 0,sequence INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS members(tripId TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,userId TEXT NOT NULL REFERENCES users(id),isAdmin INTEGER NOT NULL,canInvite INTEGER NOT NULL,joinOrder INTEGER NOT NULL,archived INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(tripId,userId));
 CREATE TABLE IF NOT EXISTS objects(id TEXT NOT NULL,tripId TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,kind TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL,generation INTEGER NOT NULL,clocks TEXT NOT NULL,PRIMARY KEY(tripId,id));
 CREATE TABLE IF NOT EXISTS expressions(tripId TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,objectId TEXT NOT NULL,userId TEXT NOT NULL,data TEXT NOT NULL,clocks TEXT NOT NULL,PRIMARY KEY(tripId,objectId,userId));
 CREATE TABLE IF NOT EXISTS invites(id TEXT PRIMARY KEY,tripId TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,tokenHash TEXT UNIQUE NOT NULL,issuedBy TEXT NOT NULL,issuedOrder INTEGER NOT NULL,expiresAt INTEGER NOT NULL,revokedAt INTEGER);
 CREATE TABLE IF NOT EXISTS removals(tripId TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,userId TEXT NOT NULL,removedOrder INTEGER NOT NULL,PRIMARY KEY(tripId,userId));
 CREATE TABLE IF NOT EXISTS receipts(tripId TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,userId TEXT NOT NULL,operationId TEXT NOT NULL,requestHash TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(tripId,userId,operationId));
 CREATE TABLE IF NOT EXISTS navigation(userId TEXT PRIMARY KEY,lastTripId TEXT);
 CREATE TABLE IF NOT EXISTS contexts(userId TEXT NOT NULL,tripId TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,data TEXT NOT NULL,PRIMARY KEY(userId,tripId));
 CREATE TABLE IF NOT EXISTS purges(tripId TEXT PRIMARY KEY,purgedAt INTEGER NOT NULL,purgedOrder INTEGER NOT NULL);
 INSERT OR IGNORE INTO migrations VALUES(1);
 INSERT OR IGNORE INTO migrations VALUES(2);
 INSERT OR IGNORE INTO migrations VALUES(3);`);
 return db;
}
export function transaction(db,fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}

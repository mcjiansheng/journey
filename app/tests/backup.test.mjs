import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { openDatabase } from '../server/db.mjs';
import { openSecurityLedger } from '../server/security.mjs';
import { createBackup, restoreBackup } from '../ops/backup.mjs';

async function fixture(t) {
 const dir=await mkdtemp(join(tmpdir(),'journey-backup-test-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const options={mainPath:join(dir,'journey.sqlite'),securityPath:join(dir,'security.sqlite'),keyPath:join(dir,'key'),backupDir:join(dir,'backups')};
 await writeFile(options.keyPath,randomBytes(32),{mode:0o600});
 const db=openDatabase(options.mainPath), security=openSecurityLedger(options.securityPath,db);
 security.transact(()=>{
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run('u','user@example.com','User',0,'{}');
  db.prepare('INSERT INTO trips VALUES(?,?,0,0)').run('t',JSON.stringify({id:'t',ownerId:'u',teamMode:'equal',name:'Before'}));
  db.prepare('INSERT INTO members VALUES(?,?,0,1,1,0)').run('t','u');
 },{userIds:['u'],tripIds:['t']});
 return {options,db,security};
}
test('encrypted restore recovers business payload and preserves latest authority ledger byte for byte',async t=>{
 const {options,db,security}=await fixture(t);
 const backupPath=await createBackup(options);
 assert.equal((await readFile(join(backupPath,'main.enc'))).includes(Buffer.from('Before')),false);
 // Permanently purge after taking backup; the latest ledger must prevent revival.
 security.transact(()=>{
  db.prepare('INSERT INTO purges VALUES(?,123,2)').run('t');
  db.prepare('DELETE FROM trips WHERE id=?').run('t');
 },{tripIds:['t']});
 security.close();db.close();
 const ledger=await readFile(options.securityPath);
 const result=await restoreBackup({...options,backupPath,serviceStopped:true});
 assert.deepEqual(await readFile(options.securityPath),ledger);
 const restored=openDatabase(options.mainPath);
 assert.equal(JSON.parse(restored.prepare('SELECT data FROM trips WHERE id=?').get('t').data).name,'Before');
 const latest=openSecurityLedger(options.securityPath,restored);
 assert.equal(restored.prepare('SELECT 1 FROM trips WHERE id=?').get('t'),undefined);
 assert.equal(restored.prepare('SELECT purgedAt FROM purges WHERE tripId=?').get('t').purgedAt,123);
 latest.close();restored.close();
 const rollback=openDatabase(result.rollback);
 assert.equal(rollback.prepare('SELECT 1 FROM trips WHERE id=?').get('t'),undefined);rollback.close();
});
for (const name of ['main','security']) test(`tampered ${name} ciphertext is rejected before installing business data`,async t=>{
 const {options,db,security}=await fixture(t),backupPath=await createBackup(options);
 security.close();db.close();
 const before=await readFile(options.mainPath),ledger=await readFile(options.securityPath);
 const target=join(backupPath,`${name}.enc`),bytes=await readFile(target);bytes[Math.floor(bytes.length/2)]^=1;await writeFile(target,bytes);
 await assert.rejects(restoreBackup({...options,backupPath,serviceStopped:true}));
 assert.deepEqual(await readFile(options.mainPath),before);assert.deepEqual(await readFile(options.securityPath),ledger);
});
test('missing current ledger and absent explicit service stop are rejected',async t=>{
 const {options,db,security}=await fixture(t),backupPath=await createBackup(options);
 security.close();db.close();
 await assert.rejects(restoreBackup({...options,backupPath}),/SERVICE_STOP_REQUIRED/);
 await rm(options.securityPath);
 await assert.rejects(restoreBackup({...options,backupPath,serviceStopped:true}),/LATEST_SECURITY_LEDGER_REQUIRED/);
});
test('backup key must be exactly 32 bytes and private',async t=>{
 const {options,db,security}=await fixture(t);t.after(()=>{security.close();db.close();});
 await writeFile(options.keyPath,Buffer.alloc(31));await assert.rejects(createBackup(options),/BACKUP_KEY_LENGTH/);
 await writeFile(options.keyPath,randomBytes(32));await chmod(options.keyPath,0o644);await assert.rejects(createBackup(options),/BACKUP_KEY_PERMISSIONS/);
});

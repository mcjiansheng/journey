import { DatabaseSync, backup } from 'node:sqlite';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, chmod, mkdir, mkdtemp, readFile, rename, rm, stat, readdir, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const aad = name => Buffer.from(`journey-backup-v1:${name}`);
async function keyBytes(path) {
  const key = await readFile(path);
  if (key.length !== 32) throw new Error('BACKUP_KEY_LENGTH: expected exactly 32 binary bytes');
  if ((await stat(path)).mode & 0o077) throw new Error('BACKUP_KEY_PERMISSIONS: use mode 0600');
  return key;
}
function checkDatabase(path, ledger = false) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('DATABASE_CORRUPT');
    const required = ledger ? ['authority','identities','revoked_sessions','runtime'] : ['trips','users','purges'];
    for (const table of required) if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) throw new Error(`DATABASE_SCHEMA_MISSING: ${table}`);
  } finally { db.close(); }
}
async function snapshot(source, target) {
  await access(source);
  const db = new DatabaseSync(source, { readOnly: true });
  try { await backup(db, target); await chmod(target, 0o600); } finally { db.close(); }
}
async function encrypt(source, target, key, name) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(name));
  await pipeline(createReadStream(source), cipher, createWriteStream(target, { mode: 0o600, flags: 'wx' }));
  return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex') };
}
async function decrypt(source, target, key, name, metadata) {
  if (!/^[a-f0-9]{24}$/.test(metadata?.iv) || !/^[a-f0-9]{32}$/.test(metadata?.tag)) throw new Error('BACKUP_METADATA_INVALID');
  const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(metadata.iv, 'hex'));
  cipher.setAAD(aad(name)); cipher.setAuthTag(Buffer.from(metadata.tag, 'hex'));
  await pipeline(createReadStream(source), cipher, createWriteStream(target, { mode: 0o600, flags: 'wx' }));
}
export async function createBackup({ mainPath, securityPath, keyPath, backupDir }) {
  if (resolve(mainPath) === resolve(securityPath)) throw new Error('INDEPENDENT_LEDGER_REQUIRED');
  checkDatabase(securityPath, true);
  const key = await keyBytes(keyPath);
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  const work = await mkdtemp(join(backupDir, '.pending-'));
  const plain = await mkdtemp(join(tmpdir(), 'journey-snapshot-'));
  try {
    // Ledger snapshot follows main snapshot: authorization decisions are durable
    // before business commits, so its authority cannot precede the main copy.
    await snapshot(mainPath, join(plain, 'main'));
    await snapshot(securityPath, join(plain, 'security'));
    const metadata = { version: 1, createdAt: new Date().toISOString(), files: {} };
    for (const name of ['main','security']) metadata.files[name] = await encrypt(join(plain,name), join(work,`${name}.enc`),key,name);
    await writeFile(join(work,'manifest.json'), JSON.stringify(metadata,null,2)+'\n', { mode: 0o600 });
    const target = join(backupDir, `backup-${metadata.createdAt.replace(/[:.]/g,'-')}-${randomBytes(4).toString('hex')}`);
    await rename(work,target); return target;
  } catch (error) { await rm(work,{recursive:true,force:true}); throw error; }
  finally { await rm(plain,{recursive:true,force:true}); }
}
export async function restoreBackup({ backupPath, mainPath, securityPath, keyPath, serviceStopped = false }) {
  if (!serviceStopped) throw new Error('SERVICE_STOP_REQUIRED: explicitly stop journey.service before restoring');
  if (resolve(mainPath) === resolve(securityPath)) throw new Error('INDEPENDENT_LEDGER_REQUIRED');
  try { await access(securityPath); } catch { throw new Error('LATEST_SECURITY_LEDGER_REQUIRED: restore refused'); }
  checkDatabase(securityPath,true);
  const key = await keyBytes(keyPath), metadata = JSON.parse(await readFile(join(backupPath,'manifest.json'),'utf8'));
  if (metadata.version !== 1) throw new Error('BACKUP_VERSION_UNSUPPORTED');
  await mkdir(dirname(mainPath),{recursive:true,mode:0o700});
  const work = await mkdtemp(join(dirname(mainPath),'.restore-'));
  try {
    // Authenticate both copies, but never install the historical security copy.
    for (const name of ['main','security']) await decrypt(join(backupPath,`${name}.enc`),join(work,name),key,name,metadata.files?.[name]);
    checkDatabase(join(work,'main')); checkDatabase(join(work,'security'),true);
    const rollback = `${mainPath}.bak-${Date.now()}-${randomBytes(4).toString('hex')}`;
    if (await stat(mainPath).catch(e=>{if(e.code==='ENOENT')return null;throw e;})) {
      // Preserve the current business database as a consistent SQLite snapshot.
      await snapshot(mainPath,rollback);
      // Checkpoint while stopped before replacing a WAL database. Old sidecars
      // must never be applied to the newly restored main database.
      const current = new DatabaseSync(mainPath);
      try { const state=current.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get(); if(state.busy)throw new Error('DATABASE_BUSY'); } finally { current.close(); }
    }
    for (const suffix of ['-wal','-shm']) await rm(mainPath+suffix,{force:true});
    await rename(join(work,'main'),mainPath); await chmod(mainPath,0o600);
    return { mainPath, rollback };
  } finally { await rm(work,{recursive:true,force:true}); }
}
export async function retainBackups(backupDir, days = 30, now = Date.now()) {
  for (const entry of await readdir(backupDir,{withFileTypes:true})) {
    if (!entry.isDirectory() || !/^backup-\d{4}-\d{2}-\d{2}T/.test(entry.name)) continue;
    const path=join(backupDir,entry.name);
    if ((await stat(path)).mtimeMs < now-days*86400000) await rm(path,{recursive:true});
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.umask(0o077);
  const options = { mainPath:process.env.DATABASE_PATH||'/var/lib/journey/journey.sqlite', securityPath:process.env.SECURITY_DATABASE_PATH||'/var/lib/journey/security.sqlite', keyPath:process.env.BACKUP_KEY_PATH||'/etc/journey/backup.key', backupDir:process.env.BACKUP_DIR||'/var/backups/journey' };
  try {
    if (process.argv[2]==='backup') { console.log(await createBackup(options)); await retainBackups(options.backupDir); }
    else if (process.argv[2]==='restore' && process.argv[3] && process.argv[4]==='--service-stopped') {
      const state=execFileSync('systemctl',['show','journey.service','--property=ActiveState','--property=MainPID'],{encoding:'utf8'});
      if (!/^ActiveState=(inactive|failed)$/m.test(state)||!/^MainPID=0$/m.test(state)) throw new Error('SERVICE_STILL_RUNNING');
      console.log(await restoreBackup({...options,backupPath:resolve(process.argv[3]),serviceStopped:true}));
    } else throw new Error('Usage: node ops/backup.mjs backup | restore <backup-directory> --service-stopped');
  } catch(error) { console.error(error.message); process.exitCode=1; }
}

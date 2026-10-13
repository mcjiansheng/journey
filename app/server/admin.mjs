import { openDatabase } from './db.mjs';
import { loadConfig } from './config.mjs';
import { openSecurityLedger } from './security.mjs';
const identifier = process.argv[2]?.trim().toLowerCase();
if (!identifier) { console.error('Usage: node server/admin.mjs <registered-email-or-phone>'); process.exit(1); }
const config = loadConfig(), db = openDatabase(config.databasePath);
const security = openSecurityLedger(config.securityPath || config.databasePath + '.security.sqlite', db, { allocateEpoch: false });
try {
  const user = db.prepare('SELECT * FROM users WHERE identifier=?').get(identifier);
  if (!user) throw new Error('Account must first register and sign in.');
  security.transact(() => db.prepare('UPDATE users SET isAdmin=1 WHERE id=?').run(user.id), { userIds: [user.id] });
  console.log(`Operations administrator enabled for user ${user.id}. Trip membership permissions remain independent.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { security.close(); db.close(); }

// Run inside the staged release after installing only production dependencies.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// The smoke test uses an isolated database and no external service credentials.
for (const key of Object.keys(process.env)) {
 if (/^(AMAP_|SMTP_|TENCENT_)/.test(key)) delete process.env[key];
}
const { createApp, shutdownServer } = await import(pathToFileURL(resolve('server/index.mjs')));
const app = createApp({ config: {
 databasePath: ':memory:', securityPath: ':memory:', basePath: '/',
 appOrigin: 'http://127.0.0.1', secureCookies: false,
} });
const server = app.listen(0, '127.0.0.1');
try {
 await once(server, 'listening');
 const origin = `http://127.0.0.1:${server.address().port}`;
 const health = await fetch(`${origin}/api/health`);
 assert.equal(health.status, 200);
 assert.equal((await health.json()).ok, true);
 const expected = JSON.parse(await readFile('dist/build.json', 'utf8'));
 const build = await fetch(`${origin}/build.json`);
 assert.equal(build.status, 200);
 assert.deepEqual(await build.json(), expected);
 const index = await fetch(origin);
 assert.equal(index.status, 200);
 assert.equal(await index.text(), await readFile('dist/index.html', 'utf8'));
 for (const name of expected.assets) {
  const response = await fetch(`${origin}/${name}`);
  assert.equal(response.status, 200, `Missing release asset: ${name}`);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(resolve('dist', name)));
 }
 console.log(`Production release smoke passed: API, build ${expected.buildId}, ${expected.assets.length} assets`);
} finally {
 await shutdownServer(server, app);
}

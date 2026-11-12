// Runs src/lib/liveupdate.js against a fake phone: Capacitor's WebView, App and Filesystem
// are swapped for stand-ins (mock-*.mjs) backed by a temp folder, and a local HTTP server
// plays the sheaf-live branch. Walks through first update, a second update, a build that
// fails to start, an update that needs a new APK, and installing that APK.
//
//   npm run build && npm run test:live

import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(tmpdir(), 'sheaf-live-sim');
const SHEAF = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
await fs.rm(ROOT, { recursive: true, force: true });
await fs.mkdir(ROOT, { recursive: true });
const bundled = join(ROOT, 'bundled');
await fs.cp(join(SHEAF, 'dist'), bundled, { recursive: true });

// Rebuild sheaf-files.json the same way vite.config.js does.
async function relist(dir) {
  const walk = async (d) => (await Promise.all((await fs.readdir(d, { withFileTypes: true })).map((e) => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))).flat();
  const files = {};
  for (const full of (await walk(dir)).sort()) {
    const path = full.slice(dir.length + 1);
    if (path === 'sheaf-files.json') continue;
    const data = await fs.readFile(full);
    files[path] = [createHash('sha256').update(data).digest('hex'), data.length];
  }
  const all = createHash('sha256');
  for (const [p, [h]] of Object.entries(files)) all.update(`${p}\0${h}\n`);
  await fs.writeFile(join(dir, 'sheaf-files.json'), JSON.stringify({ version: all.digest('hex').slice(0, 12), files }));
  return JSON.parse(await fs.readFile(join(dir, 'sheaf-files.json')));
}
async function variant(name, marker) {
  const dir = join(ROOT, name);
  await fs.cp(bundled, dir, { recursive: true });
  const js = (await fs.readdir(join(dir, 'assets'))).find((f) => /^index-.*\.js$/.test(f));
  await fs.appendFile(join(dir, 'assets', js), `\n//${marker}`);
  const list = await relist(dir);
  const feed = join(ROOT, `feed-${name}`);
  execFileSync('node', [join(SHEAF, 'scripts/live-feed.mjs'), dir, feed], { cwd: SHEAF, env: { ...process.env, GITHUB_TOKEN: '' } });
  return { list, feed };
}
const B = await variant('B', 'b');
const C = await variant('C', 'c');

let feedDir = B.feed;
let blobHits = 0;
const server = http.createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  if (path.startsWith('/blobs/')) blobHits++;
  try { res.end(await fs.readFile(join(feedDir, path))); } catch { res.statusCode = 404; res.end(); }
}).listen(0);
await new Promise((r) => server.on('listening', r));
process.env.FEED = `http://127.0.0.1:${server.address().port}/`;

const store = {};
globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => delete store[k] };
Object.defineProperty(globalThis.navigator, 'onLine', { value: true });
globalThis.FileReader = class { readAsDataURL(b) { b.arrayBuffer().then((a) => { this.result = 'data:x;base64,' + Buffer.from(a).toString('base64'); this.onload(); }); } };
globalThis.location = { assign: (u) => { SIM.opened = u; } };
const dataDir = join(ROOT, 'data');
await fs.mkdir(dataDir);
globalThis.SIM = { basePath: 'public', persisted: '', nativeCode: 101, dataDir, reloads: 0, writes: 0, copies: 0 };
const realFetch = fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).startsWith('/')) {
    const dir = SIM.basePath === 'public' ? bundled : SIM.basePath;
    try { return new Response(await fs.readFile(join(dir, url))); } catch { return new Response('', { status: 404 }); }
  }
  return realFetch(url, opts);
};
const realTimeout = setTimeout;
let pending = [];
globalThis.setTimeout = (fn, ms, ...a) => { if (ms === 3000 && String(fn).includes('check(')) { pending.push(fn); return { unref() {} }; } return realTimeout(fn, ms, ...a); };

let n = 0;
async function boot() {
  const mod = await import(`${SHEAF}/src/lib/liveupdate.js?${n++}`);
  const notes = [];
  pending = [];
  await mod.startLiveUpdates({ isIdle: () => true, notify: (text, label, action) => notes.push({ text, label, action }) });
  for (const fn of pending) await fn();
  await new Promise((r) => realTimeout(r, 300));
  return { notes, mod };
}
const ok = (cond, msg) => { console.log(cond ? 'PASS' : 'FAIL', msg); if (!cond) process.exitCode = 1; };
const state = () => JSON.parse(store['sheaf-live'] || '{}');
const ver = (p) => p.split('/').pop();

// 1. First launch on the APK's own build, feed B is out.
let r = await boot();
ok(r.notes[0]?.label === 'Restart', `1 offers restart: ${r.notes[0]?.text}`);
ok(blobHits === 1, `1 downloads only the changed file (${blobHits} downloads, ${SIM.writes} writes)`);
ok(state().ready === B.list.version, '1 marks B ready');
await r.notes[0].action();
ok(ver(SIM.basePath) === B.list.version && SIM.persisted === '', '1 switches to B, not persisted yet');

// 2. B starts and confirms.
r = await boot();
ok(SIM.persisted === SIM.basePath, '2 B persisted after starting');
ok(r.notes.length === 0, '2 nothing more to do');

// 3. Feed C. Files come from B on disk this time.
feedDir = C.feed; blobHits = 0; SIM.copies = 0;
r = await boot();
ok(blobHits === 1 && SIM.copies === Object.keys(C.list.files).length - 1, `3 one download, ${SIM.copies} local copies`);
ok(state().ready === C.list.version, '3 C ready, restart ignored');
// Next cold start applies C right away.
const reloads = SIM.reloads;
await boot();
ok(SIM.reloads === reloads + 1 && ver(SIM.basePath) === C.list.version, '3 cold start switches to C');
// C is broken and never confirms. Person closes the app: Capacitor reopens on the persisted B.
SIM.basePath = SIM.persisted;
r = await boot();
ok(state().bad.includes(C.list.version), '3 C marked bad after failing to start');
ok(r.notes.length === 0 && ver(SIM.basePath) === B.list.version, '3 stays on B, C not offered again');
const left = await fs.readdir(join(dataDir, 'live'));
ok(left.length === 1 && left[0] === B.list.version, `3 old folders cleaned: ${left}`);

// 4. A feed that needs a newer APK.
const m = JSON.parse(await fs.readFile(join(C.feed, 'manifest.json')));
const D = { ...m, version: 'dddddddddddd', minNativeCode: 102, apk: { version: '0.1.2', code: 102, url: 'https://example.invalid/Sheaf-0.1.2-android.apk' } };
await fs.writeFile(join(C.feed, 'manifest.json'), JSON.stringify(D));
r = await boot();
ok(r.notes[0]?.label === 'Download', `4 asks for APK: ${r.notes[0]?.text}`);
await r.notes[0].action();
ok(SIM.opened === D.apk.url, '4 opens the APK link');
r = await boot();
ok(r.notes.length === 0, '4 asks only once');
// Same, but no such APK has been released yet: stay quiet.
await fs.writeFile(join(C.feed, 'manifest.json'), JSON.stringify({ ...D, version: 'eeeeeeeeeeee', minNativeCode: 103 }));
r = await boot();
ok(r.notes.length === 0, '4 quiet while the needed APK does not exist');

// 5. New APK installed: Capacitor resets to the bundled build, old downloads go.
SIM.nativeCode = 103; SIM.basePath = 'public';
await boot();
const after = await fs.readdir(join(dataDir, 'live'));
ok(state().native === 103 && !after.includes(B.list.version) && state().ready === 'eeeeeeeeeeee', `5 new APK drops old downloads and takes the feed it now qualifies for: ${after}`);

server.close();

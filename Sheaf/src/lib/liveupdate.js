// Live updates for the Android app.
//
// The APK ships with one copy of the web app. When a change lands on main, the "Sheaf live
// update" workflow publishes the new build to the sheaf-live branch: manifest.json lists
// every file with its SHA-256, and blobs/<sha256> holds the bytes. This module checks that
// feed, downloads only the files that changed (unchanged ones are copied from the build
// already on the phone), and points Capacitor's local web server at the new folder.
//
// Safety net: a new build is switched to for one launch only. It has to start up and call
// back here before it is made permanent. If it breaks, closing and reopening the app lands
// back on the previous build, and the broken one is never tried again.
//
// Native code (Java, Capacitor plugins) can't change this way. The feed says which APK a
// build needs, and older apps are pointed at the download instead of being updated.

import { App } from '@capacitor/app';
import { WebView } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';

const FEED = (import.meta.env.VITE_SHEAF_LIVE_URL || 'https://raw.githubusercontent.com/s-rakim/watching/sheaf-live/').replace(/\/?$/, '/');
const ROOT = 'live';
const KEY = 'sheaf-live';
const CHECK_EVERY = 60 * 60 * 1000;

const load = () => {
  try { return { bad: [], ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { bad: [] }; }
};
const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* nothing to do */ } };

/** Folder name of the build being served right now, or null for the one inside the APK. */
export function versionFromPath(path) {
  const m = /\/live\/([0-9a-f]{6,64})\/?$/.exec(path || '');
  return m ? m[1] : null;
}

/**
 * Works out what to do for each file of a new build. A file whose hash matches the running
 * build is copied locally; anything else is downloaded.
 */
export function plan(local, remote) {
  const copy = [];
  const fetchList = [];
  for (const [path, [hash, size]] of Object.entries(remote.files)) {
    if (local?.files?.[path]?.[0] === hash) copy.push(path);
    else fetchList.push({ path, hash, size });
  }
  return { copy, fetch: fetchList };
}

/** Which notice, if any, a feed calls for on an app with this native build number. */
export function verdict(state, feed, running, nativeCode) {
  if (!feed?.version || feed.version === running || state.bad.includes(feed.version)) return 'none';
  if ((feed.minNativeCode || 0) > nativeCode) {
    return feed.apk && feed.apk.code >= feed.minNativeCode && state.toldApk !== feed.apk.code ? 'apk' : 'none';
  }
  if (state.ready === feed.version) return 'ready';
  return 'download';
}

const uri = async (path) => decodeURI((await Filesystem.getUri({ directory: Directory.Data, path })).uri.replace(/^file:\/\//, ''));
const exists = (path) => Filesystem.stat({ directory: Directory.Data, path }).then(() => true, () => false);
const rm = (path) => Filesystem.rmdir({ directory: Directory.Data, path, recursive: true }).catch(() => {});

const toBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).slice(String(r.result).indexOf(',') + 1));
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

async function sha256(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function writeBlob(path, blob) {
  await Filesystem.writeFile({ directory: Directory.Data, path, data: await toBase64(blob), recursive: true });
}

async function mkParent(path) {
  const dir = path.slice(0, path.lastIndexOf('/'));
  if (dir) await Filesystem.mkdir({ directory: Directory.Data, path: dir, recursive: true }).catch(() => {});
}

/** Runs jobs a few at a time. Phones on mobile data don't like 30 parallel downloads. */
async function pool(items, size, job) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) await job(items[i++]);
  }));
}

async function download(feed, here, local) {
  // `here` is the folder being served (null inside the APK), `local` its file list.
  const part = `${ROOT}/${feed.version}.part`;
  await rm(part);
  const todo = plan(local, feed);
  await pool(todo.copy, 4, async (path) => {
    const to = `${part}/${path}`;
    if (here && await exists(`${ROOT}/${here}/${path}`)) {
      await mkParent(to);
      await Filesystem.copy({ directory: Directory.Data, toDirectory: Directory.Data, from: `${ROOT}/${here}/${path}`, to });
    } else {
      // Still on the build inside the APK: read it back from the app's own web server.
      const res = await fetch(`/${path}`);
      if (!res.ok) throw new Error(`Could not read ${path} from the app (${res.status})`);
      await writeBlob(to, await res.blob());
    }
  });
  await pool(todo.fetch, 3, async ({ path, hash, size }) => {
    const res = await fetch(`${FEED}blobs/${hash}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Download of ${path} failed (${res.status})`);
    const blob = await res.blob();
    if (blob.size !== size || await sha256(blob) !== hash) throw new Error(`${path} arrived damaged`);
    await writeBlob(`${part}/${path}`, blob);
  });
  // The new build's own file list, so the next update knows what it already has.
  await writeBlob(`${part}/sheaf-files.json`, new Blob([JSON.stringify({ version: feed.version, files: feed.files })]));
  await rm(`${ROOT}/${feed.version}`);
  await Filesystem.rename({ directory: Directory.Data, toDirectory: Directory.Data, from: part, to: `${ROOT}/${feed.version}` });
}

async function apply(version) {
  const s = load();
  s.trying = version;
  s.ready = null;
  save(s);
  // Not persisted yet: that happens once the new build has started (see confirm below).
  await WebView.setServerBasePath({ path: await uri(`${ROOT}/${version}`) });
}

async function prune(keep) {
  try {
    const { files } = await Filesystem.readdir({ directory: Directory.Data, path: ROOT });
    for (const f of files) if (!keep.includes(f.name)) await rm(`${ROOT}/${f.name}`);
  } catch { /* no live folder yet */ }
}

let busy = false;
let lastCheck = 0;

async function check(here, local, nativeCode, notify) {
  if (busy || !navigator.onLine) return;
  busy = true;
  lastCheck = Date.now();
  try {
    const res = await fetch(`${FEED}manifest.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const feed = await res.json();
    const s = load();
    switch (verdict(s, feed, local?.version, nativeCode)) {
      case 'apk':
        s.toldApk = feed.apk.code;
        save(s);
        notify(`Sheaf ${feed.apk.version} needs a new install of the app.`, 'Download', () => location.assign(feed.apk.url));
        return;
      case 'download':
        await download(feed, here, local);
        save({ ...load(), ready: feed.version });
      // fall through
      case 'ready':
        notify('A new version of Sheaf is ready.', 'Restart', () => apply(feed.version));
        return;
      default:
    }
  } catch (err) {
    console.warn('Live update check failed:', err);
  } finally {
    busy = false;
  }
}

/**
 * Call once the app has finished starting. `notify(text, label, action)` shows a notice
 * with one button. `isIdle()` says whether it's fine to switch builds without asking.
 */
export async function startLiveUpdates({ notify, isIdle }) {
  const [{ path }, info, local] = await Promise.all([
    WebView.getServerBasePath(),
    App.getInfo(),
    fetch('/sheaf-files.json').then((r) => (r.ok ? r.json() : null), () => null),
  ]);
  const nativeCode = Number(info.build) || 0;
  const here = versionFromPath(path);
  let s = load();

  // A new APK resets Capacitor to the build inside it, so old downloads are useless.
  if (s.native !== nativeCode) {
    s = { bad: [], native: nativeCode };
    save(s);
    await prune([]);
  }

  if (s.trying) {
    if (s.trying === here) {
      // This build started fine. Keep it across launches.
      await WebView.persistServerBasePath();
      s.current = here;
    } else {
      // The app was reopened on the old build, so the new one never got this far.
      s.bad = [...s.bad, s.trying].slice(-20);
      await rm(`${ROOT}/${s.trying}`);
    }
    s.trying = null;
    save(s);
  }
  await prune([here, s.ready].filter(Boolean));

  // Downloaded last time but not switched to yet: switch now, before any file is opened.
  if (s.ready && s.ready !== here && !s.bad.includes(s.ready) && isIdle() && await exists(`${ROOT}/${s.ready}/index.html`)) {
    await apply(s.ready);
    return;
  }

  setTimeout(() => check(here, local, nativeCode, notify), 3000);
  App.addListener('resume', () => {
    if (Date.now() - lastCheck > CHECK_EVERY) check(here, local, nativeCode, notify);
  });
}

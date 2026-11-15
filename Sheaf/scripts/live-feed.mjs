// Turns a finished build (dist/) into the live-update feed the Android app reads:
//
//   <out>/manifest.json   version, file list, and which APK the build needs
//   <out>/blobs/<sha256>  one file per distinct file content
//
// Usage: node scripts/live-feed.mjs <dist> <out>
// Run from inside the git checkout. GITHUB_REPOSITORY and GITHUB_TOKEN are used to look up
// which APK releases exist; without them the feed simply carries no APK details.

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dist = 'dist', out = 'live-feed'] = process.argv.slice(2);
const repo = process.env.GITHUB_REPOSITORY || 's-rakim/watching';
const token = process.env.GITHUB_TOKEN;

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const top = git('rev-parse', '--show-toplevel');

// Same formula as the Android workflow: 0.2.3 -> 203.
const codeOf = (version) => {
  const [a = 0, b = 0, c = 0] = version.split('.').map(Number);
  return a * 10000 + b * 100 + c;
};

// What a web build can rely on from the APK: the Android project, the Capacitor config and
// the Capacitor plugins in package.json. Release notes don't count.
const NATIVE = ['Sheaf/android', 'Sheaf/capacitor.config.json', ':(exclude)Sheaf/android/RELEASE_NOTES.md'];
function capacitorDeps(ref) {
  try {
    const pkg = JSON.parse(git('show', `${ref}:Sheaf/package.json`));
    return JSON.stringify(Object.entries(pkg.dependencies || {}).filter(([n]) => n.startsWith('@capacitor/')).sort());
  } catch {
    return '';
  }
}
function sameNative(ref) {
  try {
    execFileSync('git', ['diff', '--quiet', ref, 'HEAD', '--', ...NATIVE], { cwd: top });
  } catch {
    return false;
  }
  return capacitorDeps(ref) === capacitorDeps('HEAD');
}

async function hasApk(tag) {
  if (!token) return true;
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) return false;
  const release = await res.json();
  return release.assets?.some((a) => a.name.endsWith('-android.apk')) ?? false;
}

// Newest release first. Only tags whose release actually has an APK attached count.
const tags = git('tag', '--list', 'sheaf-v*', '--sort=-v:refname').split('\n').filter(Boolean);
const releases = [];
for (const tag of tags) if (await hasApk(tag)) releases.push({ tag, version: tag.slice('sheaf-v'.length) });

// The oldest APK that already has this build's native side. Every APK from there on can
// take the update; older ones are told to install a new APK instead. If even the newest
// APK is behind, the bar sits just above it until the next APK release.
let minNativeCode = 0;
if (releases.length) {
  minNativeCode = codeOf(releases[0].version) + 1;
  for (const r of releases) {
    if (!sameNative(r.tag)) break;
    minNativeCode = codeOf(r.version);
  }
}
const latest = releases[0];
const apk = latest && {
  version: latest.version,
  code: codeOf(latest.version),
  url: `https://github.com/${repo}/releases/download/${latest.tag}/Sheaf-${latest.version}-android.apk`,
  page: `https://github.com/${repo}/releases/tag/${latest.tag}`,
};

const list = JSON.parse(readFileSync(join(dist, 'sheaf-files.json'), 'utf8'));
mkdirSync(join(out, 'blobs'), { recursive: true });
for (const [path, [hash]] of Object.entries(list.files)) copyFileSync(join(dist, path), join(out, 'blobs', hash));

const manifest = {
  version: list.version,
  commit: git('rev-parse', 'HEAD'),
  built: new Date().toISOString(),
  minNativeCode,
  apk: apk || null,
  files: list.files,
};
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`Feed ${manifest.version} from ${manifest.commit.slice(0, 7)}: ${Object.keys(list.files).length} files, needs APK build ${minNativeCode}${apk ? `, newest APK ${apk.version}` : ', no APK released yet'}`);

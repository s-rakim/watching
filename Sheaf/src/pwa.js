// Install button, offline support and update notice. The service worker only exists in
// production builds and only in a secure context: https, or http://localhost.

import { isNativeApp } from './lib/native.js';

let installPrompt = null;

/** Header button for browsers that let a page offer installation (Chrome, Edge, Android). */
export function installButton(icon) {
  return `<button type="button" class="btn btn-ghost install" ${installPrompt ? '' : 'hidden'}>${icon('install', 16)} Install</button>`;
}

const showInstall = (on) => document.querySelectorAll('.install').forEach((b) => { b.hidden = !on; });

addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  showInstall(true);
});
addEventListener('appinstalled', () => { installPrompt = null; showInstall(false); });
document.addEventListener('click', async (e) => {
  if (!e.target.closest('.install') || !installPrompt) return;
  const p = installPrompt;
  installPrompt = null;
  showInstall(false);
  await p.prompt();
});

// The Android app already has every file on the phone, so it skips the service worker.
if ('serviceWorker' in navigator && import.meta.env.PROD && !isNativeApp) {
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) location.reload();
  });
  addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
      reg.addEventListener('updatefound', () => {
        const next = reg.installing;
        next?.addEventListener('statechange', () => {
          // Only an update, not the first install, and never a reload without asking:
          // someone may be halfway through signing a document.
          if (next.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(next);
        });
      });
    } catch (err) {
      console.warn('Offline support is not available here:', err);
    }
  });
  function offerUpdate(worker) {
    const el = document.createElement('div');
    el.className = 'toast info';
    el.setAttribute('role', 'status');
    el.innerHTML = '<span>A new version of Sheaf is ready.</span><button type="button" class="btn btn-cta">Reload</button>';
    el.querySelector('button').onclick = () => { reloading = true; worker.postMessage('skip-waiting'); };
    document.body.append(el);
  }
}

// The Android app runs this same build inside a WebView. A WebView ignores <a download>
// and has no navigator.share for files, so results are written out through Capacitor.
import { Capacitor } from '@capacitor/core';

export const isNativeApp = Capacitor.isNativePlatform();

const toBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).slice(String(r.result).indexOf(',') + 1));
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

/** Finds a name in Documents/Sheaf that isn't taken yet: report.pdf, report-2.pdf, ... */
async function freeName(Filesystem, Directory, name) {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 1; i < 500; i++) {
    const candidate = i === 1 ? name : `${stem}-${i}${ext}`;
    try { await Filesystem.stat({ path: `Sheaf/${candidate}`, directory: Directory.Documents }); }
    catch { return candidate; }
  }
  return `${stem}-${Date.now()}${ext}`;
}

/** Saves to Documents/Sheaf on the phone. Returns the path shown to the person. */
export async function saveToDevice(blob, name) {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  try {
    const perm = await Filesystem.checkPermissions();
    if (perm.publicStorage !== 'granted') await Filesystem.requestPermissions();
  } catch { /* Android 11+ doesn't need it for files the app creates */ }
  const finalName = await freeName(Filesystem, Directory, name);
  await Filesystem.writeFile({
    path: `Sheaf/${finalName}`, data: await toBase64(blob), directory: Directory.Documents, recursive: true,
  });
  return `Documents/Sheaf/${finalName}`;
}

/** Opens the Android share sheet with the file, for Drive, mail, chat apps and so on. */
export async function shareFromDevice(blob, name) {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
  const { uri } = await Filesystem.writeFile({
    path: `share/${name}`, data: await toBase64(blob), directory: Directory.Cache, recursive: true,
  });
  await Share.share({ title: name, files: [uri] });
}

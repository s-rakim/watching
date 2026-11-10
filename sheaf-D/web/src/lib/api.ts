export interface Health {
  ok: boolean;
  qpdf: boolean;
  ghostscript: boolean;
  libreoffice: boolean;
  ocr: boolean;
  poppler: boolean;
  python: boolean;
  chromium: boolean;
  languages: string[];
  maxUploadMb: number;
}

export interface Result {
  blob: Blob;
  name: string;
  /** How many documents are inside (more than one means a zip). */
  count: number;
  inputBytes: number;
}

export async function fetchHealth(): Promise<Health | null> {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) return null;
    return (await res.json()) as Health;
  } catch {
    return null;
  }
}

function filenameFrom(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) return decodeURIComponent(star[1]);
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1] : fallback;
}

export interface RunHandle {
  promise: Promise<Result>;
  cancel: () => void;
}

/**
 * Sends files to a tool on the local server. `onProgress` gets 0..1 while
 * uploading and then null once the server is busy, since it can't say how
 * far along it is.
 */
export function runTool(
  tool: string,
  files: File[],
  options: Record<string, unknown>,
  onProgress: (fraction: number | null) => void,
  extra: Record<string, File> = {},
): RunHandle {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<Result>((resolve, reject) => {
    const form = new FormData();
    for (const f of files) form.append('files', f, f.name);
    for (const [field, f] of Object.entries(extra)) form.append(field, f, f.name);
    form.append('options', JSON.stringify(options));

    xhr.open('POST', `/api/tools/${tool}`);
    xhr.responseType = 'blob';
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.upload.onload = () => onProgress(null);
    xhr.onerror = () => reject(new Error('Could not reach the Sheaf server. Is it still running?'));
    xhr.onabort = () => reject(new DOMException('Cancelled', 'AbortError'));
    xhr.onload = async () => {
      const blob = xhr.response as Blob;
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({
          blob,
          name: filenameFrom(xhr.getResponseHeader('Content-Disposition'), 'result.pdf'),
          count: parseInt(xhr.getResponseHeader('X-Sheaf-Files') ?? '1', 10) || 1,
          inputBytes: files.reduce((sum, f) => sum + f.size, 0),
        });
        return;
      }
      let message = 'Something went wrong while processing that file.';
      try {
        message = JSON.parse(await blob.text()).error ?? message;
      } catch {
        // keep the generic message
      }
      reject(new Error(message));
    };
    xhr.send(form);
  });
  return { promise, cancel: () => xhr.abort() };
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

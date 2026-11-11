// Taps every tool's file picker on an emulated Android phone and on a desktop browser,
// then feeds it the kind of file Android file apps actually hand back.
// Run with `npm run test:pickers` (needs `npx playwright install chromium` once).
import { chromium, devices } from 'playwright';
import { preview } from 'vite';
import { TOOLS } from '../src/tools.js';

// One blank page. Named and typed the way Drive or a download manager can deliver it.
function tinyPdf() {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>'];
  let out = '%PDF-1.4\n';
  const offs = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
// 1×1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const server = await preview({ preview: { port: 0, host: '127.0.0.1' }, logLevel: 'silent' });
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch();
const failures = [];
const fail = (msg) => { failures.push(msg); console.log(`  ✗ ${msg}`); };

async function run(label, ctxOpts, android) {
  console.log(`\n${label}`);
  const ctx = await browser.newContext(ctxOpts);
  for (const tool of TOOLS) {
    const page = await ctx.newPage();
    await page.goto(`${base}#/${tool.id}`);
    const button = page.locator('.upload .btn-cta');
    await button.waitFor();
    const input = button.locator('input[type=file]');

    // The tap has to land on the input itself, not on a label pointing at a hidden one.
    const box = await button.boundingBox();
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.matches('input[type=file]'), [box.x + box.width / 2, box.y + box.height / 2]);
    if (!hit) fail(`${tool.id}: the button's centre is not the file input`);

    const accept = await input.getAttribute('accept');
    const images = tool.mode === 'images';
    if (android && !images && accept) fail(`${tool.id}: Android picker still filtered by "${accept}"`);
    if (!android && !accept) fail(`${tool.id}: desktop picker lost its filter`);

    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 3000 }).catch(() => null),
      android ? button.tap() : button.click(),
    ]);
    if (!chooser) { fail(`${tool.id}: tapping the button did not open a picker`); await page.close(); continue; }

    const n = tool.min || 1;
    const files = images
      ? Array.from({ length: n }, (_, i) => ({ name: `photo${i}.png`, mimeType: 'image/png', buffer: PNG }))
      : Array.from({ length: n }, (_, i) => ({ name: `document${i}`, mimeType: 'application/octet-stream', buffer: tinyPdf() }));
    await chooser.setFiles(chooser.isMultiple() ? files : files[0]);
    const opened = await page.locator('.work').waitFor({ timeout: 8000 }).then(() => true, () => false);
    if (!opened) fail(`${tool.id}: picked file did not open (${(await page.locator('.toast').allInnerTexts()).join(' ') || 'no message'})`);
    else console.log(`  ✓ ${tool.id}`);
    await page.close();
  }
  await ctx.close();
}

try {
  await run('Android phone', devices['Pixel 7'], true);
  await run('Desktop', { viewport: { width: 1280, height: 800 } }, false);
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
if (failures.length) { console.log(`\n${failures.length} problem(s)`); process.exit(1); }
console.log('\nEvery picker opens and takes its files.');

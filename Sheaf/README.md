# Sheaf

PDF tools that run entirely in the browser. Nothing is uploaded: files are read, changed and saved on the device. There's no server and no Docker, just a static site.

For Word, Excel and PowerPoint conversions, OCR and the other tools that need real software behind them, use [Sheaf-D](../sheaf-D/), the Docker version.

## Tools

| Group | Tools |
| --- | --- |
| Organize | Merge, Split, Remove pages, Extract pages, Organize, Scan to PDF |
| Optimize | Compress, Repair |
| Convert | JPG to PDF, PDF to JPG, PDF to Markdown / text |
| Edit | Edit (change existing text, add text, images, shapes, drawing, highlights, white out), Rotate, Page numbers, Watermark, Crop |
| Security | Sign, Protect (AES-256), Unlock, Redact, Compare |

Every tool follows the same three steps: pick files, set options next to a live preview, download the result. Several outputs are packed into one zip.

## Setup

You need Node 20 or newer.

```sh
git clone https://github.com/s-rakim/watching.git
cd watching/Sheaf
npm install
npm run dev
```

Then open <http://localhost:5173>. Edits reload in place.

### Building it for hosting

```sh
npm run build      # writes the static site to dist/
npm run preview    # serves dist/ on http://localhost:4173 to check it
```

Put the contents of `dist/` on any static host (Nginx, Caddy, GitHub Pages, Netlify and so on). It has to be served over HTTP: opening `dist/index.html` straight from disk (`file://`) won't work, because the browser blocks the module scripts and the pdf.js worker there. The build assumes it sits at the root of a domain; to host it under a sub-path, build with `npx vite build --base=/your/path/`.

Scan to PDF uses the camera, which browsers only allow on `localhost` or over HTTPS.

## How it is put together

- `src/tools.js` lists every tool: its category, workspace type and option fields. Adding a tool starts here.
- `src/lib/ops.js` holds the PDF work itself (pdf-lib for writing, pdf.js for rendering and text).
- `src/main.js` is the shell: routing, upload, the options panel, file and page grids, the result screen.
- `src/editor.js` is the page editor behind Edit, Sign, Redact and Crop.

## Notes

- Compress re-encodes embedded JPEGs and leaves text and vector content alone, so files that are mostly text will not shrink much.
- Redact flattens the pages it touches into images so the hidden content is gone from the file, not just covered.
- Office conversions (Word, Excel, PowerPoint), OCR, HTML to PDF and PDF/A need a server or a large model download and are not included.

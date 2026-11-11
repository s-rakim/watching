# Sheaf

PDF tools that run entirely in the browser. Nothing is uploaded: files are read, changed and saved on the device. There's no server and no Docker, just a static site.

For Word, Excel, PowerPoint and HTML to PDF, PDF/A and chained workflows, which need real software behind them, use [Sheaf-D](../sheaf-D/), the Docker version.

## Tools

| Group | Tools |
| --- | --- |
| Organize | Merge, Split, Remove pages, Extract pages, Organize, Scan to PDF |
| Optimize | Compress, Repair, OCR |
| Convert | JPG to PDF, PDF to JPG, PDF to Word, PDF to Excel, PDF to PowerPoint, PDF to Markdown / text |
| Edit | Edit (change existing text, add text, images, shapes, drawing, highlights in six colours or any custom colour, white out), Rotate, Page numbers, Watermark, Crop |
| Security | Sign, Protect (AES-256), Unlock, Redact, Compare |
| Read & translate | Summarize, Translate |

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

To use it from your other devices over Tailscale, `npm run serve` builds it and serves it on port 8080 on all interfaces. The [Access over Tailscale](../README.md#access-over-tailscale) section of the main README covers the firewall rule, HTTPS with `tailscale serve`, and troubleshooting.

## How it is put together

- `src/tools.js` lists every tool: its category, workspace type and option fields. Adding a tool starts here.
- `src/lib/ops.js` holds the PDF work itself (pdf-lib for writing, pdf.js for rendering and text).
- `src/lib/convert.js` has PDF to Word, Excel and PowerPoint, OCR, Summarize and Translate; `src/lib/office.js` writes the .docx, .xlsx and .pptx files.
- `scripts/copy-ocr.mjs` copies Tesseract and its language data into `public/ocr` before `dev` and `build`, so OCR never fetches anything from a CDN.
- `src/main.js` is the shell: routing, upload, the options panel, file and page grids, the result screen.
- `src/editor.js` is the page editor behind Edit, Sign, Redact and Crop.

## Notes

- Compress re-encodes embedded JPEGs and leaves text and vector content alone, so files that are mostly text will not shrink much.
- Redact flattens the pages it touches into images so the hidden content is gone from the file, not just covered.
- OCR runs Tesseract compiled to WebAssembly. English, Spanish, French, German, Italian and Portuguese are bundled (about 30 MB, loaded only when you use OCR). It's slower than Sheaf-D's OCR on big scans.
- PDF to Word keeps the text, headings and lists, not the exact layout or images. PDF to Excel splits lines into columns where the gaps are, which works well on reports and statements made from spreadsheets. PDF to PowerPoint puts a picture of each page on its own slide.
- Summarize uses the summariser built into recent Chrome when there is one, and otherwise picks the key sentences from the text itself.
- Translate has two engines. **Automatic** (the default) uses DeepL when it's set up and the browser's own translator otherwise; you can also pick either. DeepL: Put your key in `Sheaf/.env` as `DEEPL_AUTH_KEY=your-key` (the free plan works) and start Sheaf with `npm run serve` or `npm run dev`: the Vite server relays the calls and adds the key, so the browser never sees it and DeepL's block on calls from web pages doesn't apply. On a plain static host there is no relay, so pick "On this device" instead, which uses Chrome's built-in translator (Chrome 138+ on desktop) and sends nothing anywhere. Either way you get the translated text as Word or Markdown; layout isn't kept. For a translated PDF with the layout intact, use Sheaf-D.
- Word, Excel, PowerPoint and HTML to PDF, PDF/A and workflows need real software (LibreOffice, Chromium, Ghostscript) and live in Sheaf-D.

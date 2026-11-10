# Sheaf

PDF tools that run entirely in the browser. Nothing is uploaded: files are read, changed and saved on the device.

## Tools

| Group | Tools |
| --- | --- |
| Organize | Merge, Split, Remove pages, Extract pages, Organize, Scan to PDF |
| Optimize | Compress, Repair |
| Convert | JPG to PDF, PDF to JPG, PDF to Markdown / text |
| Edit | Edit (text, images, shapes, white out), Rotate, Page numbers, Watermark, Crop |
| Security | Sign, Protect (AES-256), Unlock, Redact, Compare |

Every tool follows the same three steps: pick files, set options next to a live preview, download the result. Several outputs are packed into one zip.

## Run it

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
```

## How it is put together

- `src/tools.js` lists every tool: its category, workspace type and option fields. Adding a tool starts here.
- `src/lib/ops.js` holds the PDF work itself (pdf-lib for writing, pdf.js for rendering and text).
- `src/main.js` is the shell: routing, upload, the options panel, file and page grids, the result screen.
- `src/editor.js` is the page editor behind Edit, Sign, Redact and Crop.

## Notes

- Compress re-encodes embedded JPEGs and leaves text and vector content alone, so files that are mostly text will not shrink much.
- Redact flattens the pages it touches into images so the hidden content is gone from the file, not just covered.
- Office conversions (Word, Excel, PowerPoint), OCR, HTML to PDF and PDF/A need a server or a large model download and are not included.

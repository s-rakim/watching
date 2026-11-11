# Sheaf-D

A PDF toolkit you host yourself. It does what the big online PDF sites do (merge, split, compress, convert, sign, edit and so on) but everything runs on your own machine, so your files never go anywhere.

It's the full version of the toolkit: alongside the everyday tools it converts Word, Excel and PowerPoint, runs OCR, makes PDF/A and turns web pages into PDFs, because the container ships LibreOffice, Tesseract, Ghostscript and Chromium. If you only need what a browser can do on its own, [Sheaf](../Sheaf/) is lighter and needs no Docker.

There are 32 tools. You pick one, drop your files in, set a few options, and download the result.

## Setup

You need Docker with Compose (Docker Desktop on Mac and Windows has both; on Linux install `docker-ce` and `docker-compose-plugin`).

```sh
git clone https://github.com/s-rakim/watching.git
cd watching/sheaf-D
docker compose up -d --build
```

Then open <http://localhost:8080>.

The first build takes a while because it pulls in LibreOffice, Chromium and the OCR language data. The finished image is around 2 GB. After that it starts in a couple of seconds.

To stop it: `docker compose down`. To update: `git pull`, then `docker compose up -d --build` again.

By default the app is only reachable from the computer it runs on. If you want other devices on your network to use it, change the port line in `docker-compose.yml` from `127.0.0.1:8080:8080` to `8080:8080`. There are no user accounts, so only do that on a network you trust.

To reach it from your own devices anywhere, Tailscale is the safer option: `tailscale serve --bg 8080` gives you an HTTPS address on your tailnet and needs no change to the port line. See [Access over Tailscale](../README.md#access-over-tailscale).

## What's in it

| Family | Tools |
| --- | --- |
| Organize | Merge PDF, Split PDF, Remove pages, Extract pages, Organize PDF, Scan to PDF, Workflow |
| Optimize | Compress PDF, Repair PDF, OCR PDF |
| Convert to PDF | JPG to PDF, Word to PDF, PowerPoint to PDF, Excel to PDF, HTML to PDF |
| Convert from PDF | PDF to JPG, PDF to Word, PDF to PowerPoint, PDF to Excel, PDF to PDF/A |
| Edit | Edit PDF, Rotate PDF, Add page numbers, Add watermark, Crop PDF |
| Security | Unlock PDF, Protect PDF, Sign PDF, Redact PDF, Compare PDF |
| Read & translate | Summarize PDF, Translate PDF (optional, see below) |

A few things worth knowing:

- **Edit, Sign, Redact, Crop and Compare run entirely in the browser.** The file isn't even sent to the local server.
- **Redact really removes things.** Pages with black boxes on them are rebuilt as images, so the text underneath is gone from the file, not just covered. Those pages lose their selectable text; run OCR afterwards if you want it back.
- **Sign adds a visible signature**, drawn, typed or uploaded. It is not a certificate-based digital signature.
- **Scan to PDF uses your camera**, which browsers only allow on `localhost` or over HTTPS.
- **HTML to PDF fetches the address you give it** from the machine running Sheaf-D. That is the one tool that talks to the outside world, and only when you ask it to.
- **Edit's highlighter comes in six colours** plus a picker for any other colour. Pen, shapes and text have their own colour row.
- **Workflow chains tools.** Pick up to eight steps from Merge, Rotate, Compress, Repair, OCR, Page numbers, Watermark (text), PDF/A, Unlock and Protect. Each step works on what the one before it produced. Merge can only go first and Protect only last.
- **Summarize picks the key sentences** from the PDF's own text and lists its main sections. No language model is involved, so it's quick and works on any machine. Scanned PDFs need OCR first.
- **Translate runs offline with Argos Translate**, but it is off unless you switch it on at build time (next section), because each language adds a few hundred MB to the image. Layout isn't kept: you get the translated text as a Word or Markdown file.
- **Uploads are deleted as soon as the result has been sent back.** In the Docker setup they only ever exist in memory.

## Settings

Set these under `environment:` in `docker-compose.yml`.

| Variable | Default | What it does |
| --- | --- | --- |
| `MAX_UPLOAD_MB` | `500` | Largest file the server accepts |
| `PORT` | `8080` | Port the server listens on inside the container |
| `WORK_DIR` | `/work` | Where files sit while a job runs |

OCR ships with English, German, French, Spanish, Italian, Portuguese and Dutch. To pick your own set, pass Tesseract language codes at build time:

```sh
docker compose build --build-arg OCR_LANGS="deu jpn chi_sim"
```

Translate PDF needs language packs, which aren't installed by default. List two-letter codes when you build and English to and from each one gets installed (other pairs go through English):

```sh
TRANSLATE_LANGS="es fr de" docker compose up -d --build
```

This adds Argos Translate and a CPU-only build of PyTorch, roughly 1 GB on top of the usual image, plus 100 to 200 MB per language. Downloading the packs is the only part of the build that needs the Argos package index; once built, translating never leaves the machine.

The gear icon in the app opens a small settings panel with the theme (light, dark or follow the system), the background colour, and a list of which engines the server found.

## Running without Docker

You need Node 20 or newer. Then:

```sh
./scripts/start.sh
```

Every tool that needs an outside program will tell you when that program is missing, and the rest keep working. For the full set, install:

| Program | Used by |
| --- | --- |
| qpdf | Merge, Split, Remove, Extract, Organize, Rotate, Protect, Unlock, Repair |
| Ghostscript | Compress, Repair |
| LibreOffice | Word, PowerPoint and Excel to PDF, PDF to PowerPoint |
| OCRmyPDF and Tesseract | OCR, PDF to PDF/A |
| Poppler (`pdftoppm`, `pdfimages`) | PDF to JPG |
| Chromium or Chrome | HTML to PDF |
| Python 3 with `pdf2docx`, `pdfplumber`, `openpyxl`, `Pillow` | PDF to Word, PDF to Excel, JPG to PDF, Scan to PDF, Summarize |
| `argostranslate` (optional) | Translate. Install it with pip, then run `python3 server/py/install_argos.py es fr` for the languages you want |

On Debian or Ubuntu that is roughly:

```sh
sudo apt install qpdf ghostscript poppler-utils ocrmypdf tesseract-ocr libreoffice chromium python3-pip
pip install pdf2docx pdfplumber openpyxl pillow
```

If a program lives somewhere unusual, point to it with `SOFFICE_BIN`, `OCRMYPDF_BIN`, `CHROMIUM_BIN` or `PYTHON_BIN`.

## Working on it

```sh
npm install
npm run dev
```

That starts the server on port 8080 and the web app on <http://localhost:5173> with hot reload.

```
web/      the interface: Vite, React, TypeScript, pdf.js for viewing, pdf-lib for in-browser edits
server/   a small Express server that hands files to the tools above
  src/tools/   one file per group of tools
  py/          Python helpers for the conversions Node can't do well
design/   colour and spacing tokens the whole interface is built on
docs/     the design guide
```

Other commands:

```sh
npm test            # server unit tests
npm run typecheck   # both packages
npm run build       # production build of the web app
```

Adding a server tool: write a function in `server/src/tools/` that takes the uploaded files and options and returns output files, register it in `server/src/index.ts`, then describe its name, icon and options in `web/src/tools.ts`. The options form, upload, progress and download screens come for free.

## Credits

Sheaf-D is glue around some excellent open source software: qpdf, Ghostscript, LibreOffice, OCRmyPDF, Tesseract, Poppler, Chromium, pdf.js, pdf-lib, pdf2docx and, if you turn it on, Argos Translate. Each has its own licence. Ghostscript in particular is AGPL, which matters if you plan to offer this as a service to other people.

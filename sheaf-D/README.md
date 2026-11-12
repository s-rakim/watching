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
| Read & translate | Summarize PDF, Translate PDF (DeepL key or offline packs, see below) |

A few things worth knowing:

- **Edit, Sign, Redact, Crop and Compare run entirely in the browser.** The file isn't even sent to the local server.
- **Redact really removes things.** Pages with black boxes on them are rebuilt as images, so the text underneath is gone from the file, not just covered. Those pages lose their selectable text; run OCR afterwards if you want it back.
- **Sign adds a visible signature**, drawn, typed or uploaded. It is not a certificate-based digital signature.
- **Scan to PDF uses your camera**, which browsers only allow on `localhost` or over HTTPS.
- **HTML to PDF and DeepL translation are the only things that talk to the outside world**, and only when you use them. HTML to PDF fetches the address you give it. Translating with DeepL sends your file to DeepL; the offline engine doesn't.
- **Edit's highlighter comes in six colours** plus a picker for any other colour. Pen, shapes and text have their own colour row.
- **Workflow chains tools.** Pick up to eight steps from Merge, Rotate, Compress, Repair, OCR, Page numbers, Watermark (text), PDF/A, Unlock and Protect. Each step works on what the one before it produced. Merge can only go first and Protect only last.
- **Summarize picks the key sentences** from the PDF's own text and lists its main sections. No language model is involved, so it's quick and works on any machine. Scanned PDFs need OCR first.
- **Translate has two engines you can swap between** in the Translator option. **DeepL** gives the best quality and can hand back a translated PDF with the original layout, but it sends your file to DeepL and needs your own API key. **Offline** uses Argos Translate on this machine: nothing leaves it, but you get the text as Word or Markdown, without layout. **Automatic** (the default) uses DeepL when a key is set and the offline engine otherwise. Setup for both is in the next section.
- **Uploads are deleted as soon as the result has been sent back.** In the Docker setup they only ever exist in memory.

## Phones, tablets and computers

The server runs on Linux, macOS (Docker Desktop, Intel or Apple Silicon) and Windows (Docker Desktop with WSL 2). The web app it serves works in:

| Browser | Oldest version that works |
| --- | --- |
| Safari on iPhone and iPad | iOS / iPadOS 16.4 |
| Safari on macOS | 16.4 |
| Chrome, Edge, Brave, Opera | 111 |
| Firefox (including ESR on Linux) | 115 |
| Samsung Internet | 22 |

On a phone or tablet:

- The layout drops to one scrolling column under 1024px, with the action button pinned at the bottom and the side menu behind the button in the breadcrumb bar.
- In Organize, Remove, Extract and the file list, press and hold a page or file briefly, then drag to move it. A plain swipe scrolls.
- In the editor, one finger scrolls the document while the arrow or Text tool is picked. Pick Draw, Highlight, a shape, White out or Redact to mark the page; scroll with the bar or from outside the page.
- Tap with the Text tool to add text. Tap a text box once to select it and again to type in it (a double-click still works with a mouse).
- Resize handles grow to finger size on touch screens.
- After a job, phones and tablets get a **Share** button next to Download (**Save to Files or share** on iOS).

To put Sheaf-D on a home screen: on iPhone and iPad, Safari's Share > **Add to Home Screen**; on Android, **Add to Home screen** or **Install app** in the browser menu; on a computer, the install icon in Chrome or Edge's address bar. Chrome only offers install on a secure address (`https://`, or `localhost` on the same machine), so on a tailnet use `tailscale serve` (see the main README). Sheaf-D needs its server for most tools, so unlike Sheaf it does not work offline.

### Other CPUs

The image builds for both `linux/amd64` (most PCs and servers) and `linux/arm64` (Apple Silicon Macs, Raspberry Pi 4 and 5 on a 64-bit OS, Ampere and AWS Graviton). `docker compose up -d --build` builds for whatever machine it runs on, so on an M-series Mac or a Pi you get a native arm64 image with no extra steps. 32-bit ARM (older Pi OS images) is not supported: several of the PDF libraries have no 32-bit ARM builds.

To build both at once and push them to a registry as one image:

```sh
docker buildx create --use --name sheaf-builder   # once
docker buildx build --platform linux/amd64,linux/arm64 \
  -t ghcr.io/<you>/sheaf-d:latest --push .
```

The repository also has a GitHub Actions workflow, **Sheaf-D image** (`.github/workflows/sheaf-d-image.yml`), that does the same and publishes `ghcr.io/s-rakim/sheaf-d`. It only runs when started from the Actions tab or when a tag like `sheaf-d-v1.0.0` is pushed. To use the published image instead of building, replace `build: .` in `docker-compose.yml` with `image: ghcr.io/s-rakim/sheaf-d:latest` and run `docker compose up -d`.

The arm64 half is built under emulation on GitHub's runners, so the first run takes a while (LibreOffice and Chromium are large). Later runs reuse the cache.

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

Translate PDF needs at least one of two things. You can set up both and choose per job.

**DeepL (online).** Get an API key from your account page at deepl.com (the free plan works, 500,000 characters a month, and a PDF costs at least 50,000 of them however short it is). Put it in a file called `.env` next to `docker-compose.yml`:

```sh
DEEPL_AUTH_KEY=your-key-here
```

and run `docker compose up -d` again. The key stays on the server: the browser never sees it. `.env` is ignored by git and by the Docker build.

**Offline (Argos Translate).** Language packs aren't installed by default. List two-letter codes when you build and English to and from each one gets installed (other pairs go through English):

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
| Python 3 with `pdf2docx` (which brings PyMuPDF and NumPy), `pdfplumber`, `openpyxl`, `Pillow` | PDF to Word, PDF to Excel, JPG to PDF, Scan to PDF, Summarize |
| `deepl` (pip) and a `DEEPL_AUTH_KEY` environment variable | Translate with DeepL |
| `argostranslate` (optional, pip) | Translate offline. Run `python3 server/py/install_argos.py es fr` for the languages you want |

On Debian or Ubuntu that is roughly:

```sh
sudo apt install qpdf ghostscript poppler-utils ocrmypdf tesseract-ocr libreoffice chromium python3-pip
pip install pdf2docx pdfplumber openpyxl pillow deepl
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

Sheaf-D is glue around some excellent open source software: qpdf, Ghostscript, LibreOffice, OCRmyPDF, Tesseract, Poppler, Chromium, pdf.js, pdf-lib, pdf2docx, DeepL's Python library and, if you turn it on, Argos Translate. Each has its own licence. Ghostscript in particular is AGPL, which matters if you plan to offer this as a service to other people.

Full setup, serving and troubleshooting: [../docs/guide.md](../docs/guide.md).

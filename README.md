# watching

Two PDF toolkits that keep your files on your own machine. They share a look and most of a tool list, but they're built differently, so pick the one that fits.

| | [Sheaf](Sheaf/) | [Sheaf-D](sheaf-D/) |
| --- | --- | --- |
| Runs as | A static site in your browser | A Docker container with a small server |
| Needs | Node 20+ to build it, then any web server | Docker with Compose |
| Tools | 27: organise, compress, repair, OCR, JPG ↔ PDF, PDF to Word, Excel, PowerPoint and Markdown, edit, sign, protect, unlock, redact, compare, summarise, translate and more | 32: everything in Sheaf except PDF to Markdown, plus Word, Excel, PowerPoint and HTML to PDF, PDF/A and workflows that chain several tools |
| Files go | Nowhere. The browser does all the work | To the container on your machine, held in memory and dropped once you've downloaded the result |

## Sheaf (browser)

You need Node 20 or newer.

```sh
git clone https://github.com/s-rakim/watching.git
cd watching/Sheaf
npm install
npm run dev
```

Open <http://localhost:5173>.

To host it, run `npm run build` and serve the `dist/` folder from any static host. It has to come over HTTP, so opening `dist/index.html` from disk won't work. `npm run preview` serves the build locally on <http://localhost:4173> if you want to check it first.

More in [Sheaf/README.md](Sheaf/README.md).

## Sheaf-D (Docker)

You need Docker with Compose.

```sh
git clone https://github.com/s-rakim/watching.git
cd watching/sheaf-D
docker compose up -d --build
```

Open <http://localhost:8080>.

The first build is slow and the image ends up around 2 GB, because it bundles LibreOffice, Chromium, Ghostscript and the OCR language data. After that it starts in seconds. Stop it with `docker compose down`.

It only listens on this computer by default. Settings, extra OCR languages and running it without Docker are covered in [sheaf-D/README.md](sheaf-D/README.md).

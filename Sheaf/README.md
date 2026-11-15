# Sheaf

PDF tools that run entirely in the browser. Nothing is uploaded: files are read, changed and saved on the device. There's no server and no Docker, just a static site.

For Excel, PowerPoint and HTML to PDF, PDF/A and chained workflows, which need real software behind them, use [Sheaf-D](../sheaf-D/), the Docker version.

## Tools

| Group | Tools |
| --- | --- |
| Organize | Merge, Split, Remove pages, Extract pages, Organize, Scan to PDF |
| Optimize | Compress, Repair, OCR |
| Convert | JPG to PDF, PDF to JPG, PDF to Word, PDF to Excel, PDF to PowerPoint, PDF to Markdown / text |
| Word | Edit Word (a full word processor), Convert Word (to PDF, DOCX, ODT, RTF, HTML, Markdown, text) |
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
- `src/lib/convert.js` has PDF to Word, Excel and PowerPoint, OCR, Summarize and Translate; `src/lib/office.js` writes the .docx, .xlsx and .pptx files. `src/lib/wordlayout.js` reads each page's text, fonts, colours, boxes, lines and pictures, and `src/lib/docxflow.js` turns them into an editable Word file or PowerPoint deck (Sheaf-D uses the same file).
- `scripts/copy-ocr.mjs` copies Tesseract and its language data into `public/ocr` before `dev` and `build`, so OCR never fetches anything from a CDN.
- `src/main.js` is the shell: routing, upload, the options panel, file and page grids, the result screen.
- `src/editor.js` is the page editor behind Edit, Sign, Redact and Crop.
- `src/wordedit.js` is the Edit Word screen, and `src/lib/wordcraft.js` talks to the WordCraft frame (open a file, take saves, run commands such as Export as PDF).

## Word documents

Edit Word and Convert Word are [WordCraft](https://github.com/storytold/wordcraft), an open source word processor written in Rust, built for the browser and kept in `public/wordcraft`. It runs in a frame inside Sheaf and never sends the document anywhere.

- **Edit Word** opens .docx, .doc, .odt, .rtf, .md, .txt and .html files, or starts a blank document. WordCraft brings its own ribbon: styles, fonts, lists, tables, pictures and shapes, headers and footers, page setup, track changes and comments, find and replace, spelling. Save hands the file back to Sheaf, which downloads it (in the Android app it goes to Documents/Sheaf). PDF exports a PDF with real, selectable text.
- **Convert Word** runs the same editor out of sight: it opens each file and saves it in the format you pick.
- After **PDF to Word**, the result screen has an **Edit it in Sheaf** button that opens the new .docx in the editor.
- The editor draws with WebGPU, or WebGL2 where WebGPU is missing, so it needs a browser from the last few years. On phones it starts on WebGL2, which is the more reliable of the two there.
- The first open downloads the editor (about 18 MB over the network, 52 MB unpacked). After that the browser keeps a copy, and the installed app works offline.

To move to a newer WordCraft, change `WORDCRAFT_REV` in `scripts/build-wordcraft.sh` and run it. It needs Rust with the `wasm32-unknown-unknown` target and `trunk` (`cargo install trunk --locked`). WordCraft is MIT OR Apache-2.0; its licence files and NOTICE ship in `public/wordcraft`.

## Phones, tablets and computers

Sheaf runs on Android, iPhone, iPad, Linux, macOS and Windows. Nothing is installed on the device except, if you want it, a home-screen icon.

| Browser | Oldest version that works |
| --- | --- |
| Safari on iPhone and iPad | iOS / iPadOS 16.4 |
| Safari on macOS | 16.4 |
| Chrome, Edge, Brave, Opera | 111 |
| Firefox (including ESR on Linux) | 115 |
| Samsung Internet | 22 |

### Using it on a touch screen

- Every tool works with a finger, a stylus or an Apple Pencil. The layout switches to one column under 900px wide, and the main button stays pinned to the bottom of the screen.
- To reorder files or pages (Merge, Organize, JPG to PDF), press and hold one for a moment, then drag it. A normal swipe scrolls.
- In Edit, Sign, Redact and Crop, the tools also sit in the bar above the page. The page scrolls under one finger unless Draw, Highlight, Shape, White out or Redact is picked; with those, scroll from outside the page.
- Tap a line of text with Edit text to retype it. Tap a placed item, then its red button, to remove it.
- Scan to PDF opens the camera straight away on phones.

### Saving results

On a computer the file downloads as usual. On a phone or tablet there is also a **Share** button (**Save to Files or share** on iOS), which is the easy way to put the file in Files, iCloud Drive, Google Drive, a mail or a chat. On iOS, Safari also asks before downloading; the file then lands in the Downloads folder in Files.

### Installing it as an app

Sheaf is a progressive web app. Once installed it opens in its own window, and it works with no connection at all, since every tool runs on the device anyway.

- **Android (Chrome, Edge, Samsung Internet):** tap **Install** in Sheaf's header, or **Add to Home screen** in the browser menu.
- **iPhone and iPad:** in Safari, tap Share, then **Add to Home Screen**.
- **macOS:** Safari 17+ has File > **Add to Dock**. Chrome and Edge show an install icon in the address bar, or use the **Install** button in Sheaf's header.
- **Linux and Windows:** Chrome or Edge, same as macOS. Firefox doesn't install web apps but runs Sheaf fine in a tab.

When a new version is deployed, an open Sheaf shows "A new version of Sheaf is ready" with a Reload button. It never reloads by itself, so nothing you are working on gets lost.

Installing and offline use need a secure address: `https://`, or `http://localhost` on the same machine. Over plain `http://` from another device (for example `http://my-pc:8080` on a tailnet) every tool still works, but there is no install option, no offline copy and no share sheet. `tailscale serve` gives you an `https://` address; see the main README.

### Big files

Phones have far less memory than computers, and iOS caps each browser tab. Sheaf renders page previews only as they scroll into view, keeps them as small images, and scales down very large pages and 48 MP photos to stay under Safari's canvas limit. Files of a few hundred pages are fine on a recent phone. If a huge scan fails on an older iPhone, split it first or run that job on a computer.

## Android app

There's an APK on the repo's Releases page. It's this same app wrapped with [Capacitor](https://capacitorjs.com), so every tool runs on the phone and works offline. Results go to `Documents/Sheaf` when you tap Save, or anywhere through Share. DeepL translation isn't available in the APK because there's no relay server behind it; the on-device translator still works. The Word editor ships inside the APK, which makes it about 20 MB bigger.

To cut a new release, push a tag and the `Sheaf Android` workflow builds and uploads the APK:

```bash
git tag sheaf-v0.2.0 && git push origin sheaf-v0.2.0
```

You can also start it from the Actions tab and type a version.

To sign with your own key instead of a debug key, make one once and add it as repository secrets (`SHEAF_KEYSTORE_BASE64`, `SHEAF_KEYSTORE_PASSWORD`, `SHEAF_KEY_ALIAS`, `SHEAF_KEY_PASSWORD`):

```bash
keytool -genkeypair -v -keystore sheaf.jks -alias sheaf -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 sheaf.jks   # paste the output into SHEAF_KEYSTORE_BASE64
```

Keep that file somewhere safe. Android only accepts an update signed with the same key as the installed app.

Building it yourself needs Android Studio (or the Android SDK) and JDK 21:

```bash
npm run android          # builds the web app and copies it into android/
cd android && ./gradlew assembleRelease
```

## Notes

- Compress re-encodes embedded JPEGs and leaves text and vector content alone, so files that are mostly text will not shrink much.
- Redact flattens the pages it touches into images so the hidden content is gone from the file, not just covered.
- OCR runs Tesseract compiled to WebAssembly. English, Spanish, French, German, Italian and Portuguese are bundled (about 30 MB, loaded only when you use OCR). It's slower than Sheaf-D's OCR on big scans.
- PDF to Word has two layouts. Same layout (the default) rebuilds each page out of ordinary Word parts: ruled tables become real tables with their borders and shading, coloured or outlined boxes become boxes, rules stay rules, photos and logos are separate pictures, and text is paragraphs in its own font, size, weight and colour that reflow when you edit them. A faint watermark sits behind the text, anchored to the page, so moving a table doesn't move it. Charts and other drawings Word has no editable version of come across as a picture of just that drawing. Word uses the PDF's fonts if they're installed and a similar one if not, so lines can wrap a little differently. Flowing text gives plain paragraphs, headings and lists instead. PDF to Excel splits lines into columns where the gaps are, which works well on reports and statements made from spreadsheets. PDF to PowerPoint makes editable slides the same way (text boxes, shapes and pictures where they were on the page), or a picture of each page if you pick that.
- Summarize uses the summariser built into recent Chrome when there is one, and otherwise picks the key sentences from the text itself.
- Translate has two engines. **Automatic** (the default) uses DeepL when it's set up and the browser's own translator otherwise; you can also pick either. DeepL: Put your key in `Sheaf/.env` as `DEEPL_AUTH_KEY=your-key` (the free plan works) and start Sheaf with `npm run serve` or `npm run dev`: the Vite server relays the calls and adds the key, so the browser never sees it and DeepL's block on calls from web pages doesn't apply. On a plain static host there is no relay, so pick "On this device" instead, which uses Chrome's built-in translator (Chrome 138+ on desktop) and sends nothing anywhere. Either way you get the translated text as Word or Markdown; layout isn't kept. For a translated PDF with the layout intact, use Sheaf-D.
- Word, Excel, PowerPoint and HTML to PDF, PDF/A and workflows need real software (LibreOffice, Chromium, Ghostscript) and live in Sheaf-D.
- Tested with Playwright on Pixel 7, iPhone 13 (portrait and landscape) and iPad viewports with emulated touch, plus a 1280px desktop: touch reordering, scrolling vs. drawing, tap-to-type, saving, and loading with the network off.

Full setup, serving and troubleshooting: [../docs/guide.md](../docs/guide.md).

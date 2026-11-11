# Sheaf and Sheaf-D: the full guide

Everything in one place: installing, turning on the optional features, serving it to other devices, keeping it running, and fixing things when they break. For the five-minute version, see [Quick setup](../README.md#quick-setup) in the main README.

Contents

1. [Which one do I want?](#1-which-one-do-i-want)
2. [Install Sheaf (browser)](#2-install-sheaf-browser)
3. [Install Sheaf-D (Docker)](#3-install-sheaf-d-docker)
4. [Optional features](#4-optional-features)
5. [Serving it to other devices](#5-serving-it-to-other-devices)
6. [Keeping it running](#6-keeping-it-running)
7. [Updating and removing](#7-updating-and-removing)
8. [Settings reference](#8-settings-reference)
9. [Troubleshooting](#9-troubleshooting)
10. [Privacy](#10-privacy)

---

## 1. Which one do I want?

| | Sheaf | Sheaf-D |
| --- | --- | --- |
| What it is | A static website. The browser does all the work | A Docker container with a small server behind the same kind of interface |
| You need | Node 20 or newer, once, to build it | Docker with Compose |
| Tools | 27 | 32 |
| Only here | PDF to Markdown, runs offline once installed | Word, Excel, PowerPoint and HTML to PDF, PDF/A, Workflow, translated PDFs that keep the layout |
| Your files | Never leave the device | Go to the container on your own machine, held in memory, deleted after you download the result |
| Good for | Phones, tablets, quick jobs, no setup on the host | Office conversions, big OCR jobs, a shared box on your network |

You can run both. They don't depend on each other. If you just want to try it, start with Sheaf.

---

## 2. Install Sheaf (browser)

You need [Node.js](https://nodejs.org) 20 or newer. Check with `node --version`.

```sh
git clone https://github.com/s-rakim/watching.git
cd watching/Sheaf
npm install
```

Pick how to run it:

| You want | Run | Then open |
| --- | --- | --- |
| To try it or work on it | `npm run dev` | <http://localhost:5173> |
| To use it, and share it with other devices | `npm run serve` | <http://localhost:8080> |
| To check a build before hosting | `npm run build`, then `npm run preview` | <http://localhost:4173> |
| A folder to put on any web host | `npm run build` | serve the `dist/` folder |

`npm run serve` builds the site, then serves it on port 8080 on every network interface. Leave the window open while you use it. Press Ctrl+C to stop.

Every `dev` and `build` first runs a small script that copies the OCR engine and language data into `public/ocr`. That's expected, and it's why the first run takes a few seconds longer.

### Hosting the built files somewhere else

After `npm run build`, copy `dist/` to Nginx, Caddy, GitHub Pages, Netlify, an S3 bucket, anything that serves static files. Two rules:

- It has to come over HTTP or HTTPS. Opening `dist/index.html` from disk won't work, because browsers block the scripts and the PDF worker on `file://`.
- The build assumes it sits at the root of a domain. For a sub-path, build with `npx vite build --base=/your/path/`.

On a plain static host there is no DeepL relay (see [section 4](#4-optional-features)), so Translate falls back to the browser's own translator.

---

## 3. Install Sheaf-D (Docker)

You need Docker with Compose. Docker Desktop on Mac and Windows has both. On Linux, install `docker-ce` and the `docker-compose-plugin`. Check with `docker compose version`.

```sh
git clone https://github.com/s-rakim/watching.git
cd watching/sheaf-D
docker compose up -d --build
```

Open <http://localhost:8080>.

The first build is slow, around ten minutes, and the image ends up near 2 GB, because it bundles LibreOffice, Chromium, Ghostscript, Tesseract and its language data. After that it starts in seconds.

Useful commands, all run from the `sheaf-D` folder:

| Command | What it does |
| --- | --- |
| `docker compose ps` | Shows whether it's running and healthy |
| `docker compose logs --tail 100 sheaf-d` | The last 100 log lines |
| `docker compose logs -f sheaf-d` | Follow the log live |
| `docker compose restart` | Restart it |
| `docker compose down` | Stop and remove the container (your files are never stored, so nothing is lost) |

It builds natively on Intel/AMD and on 64-bit ARM (Apple Silicon, Raspberry Pi 4 and 5). Older 32-bit ARM systems aren't supported.

### Without Docker

You need Node 20 or newer and, for the full tool set, the programs below. Each tool tells you if its program is missing, and the rest keep working.

| Program | Used by |
| --- | --- |
| qpdf | Merge, Split, Remove, Extract, Organize, Rotate, Protect, Unlock, Repair |
| Ghostscript | Compress, Repair |
| LibreOffice | Word, PowerPoint and Excel to PDF, PDF to PowerPoint |
| OCRmyPDF and Tesseract | OCR, PDF to PDF/A |
| Poppler (`pdftoppm`, `pdfimages`) | PDF to JPG |
| Chromium or Chrome | HTML to PDF |
| Python 3 with `pdf2docx`, `pdfplumber`, `openpyxl`, `Pillow`, `deepl` | PDF to Word, PDF to Excel, JPG to PDF, Scan to PDF, Summarize, Translate with DeepL |

On Debian or Ubuntu:

```sh
sudo apt install qpdf ghostscript poppler-utils ocrmypdf tesseract-ocr libreoffice chromium python3-pip
pip install pdf2docx pdfplumber openpyxl pillow deepl
```

Then, from `sheaf-D`:

```sh
./scripts/start.sh
```

That installs the Node packages, builds the web app and starts the server on port 8080. If a program lives somewhere unusual, point to it with `SOFFICE_BIN`, `OCRMYPDF_BIN`, `CHROMIUM_BIN` or `PYTHON_BIN`.

---

## 4. Optional features

### Translate with DeepL

DeepL gives the best translations. It needs your own API key.

**Get a key.** Sign up at deepl.com and choose the free "DeepL API" plan. It's separate from the regular DeepL app, and it asks for a card but only charges if you upgrade. Then open your account page, find the API Keys tab and copy the key. Free-plan keys end in `:fx`. The free plan gives 500,000 characters a month.

**Give it to the app.** Make a file called `.env` and put one line in it:

```
DEEPL_AUTH_KEY=your-key-here
```

| App | Where the file goes | Then |
| --- | --- | --- |
| Sheaf | `Sheaf/.env` | restart `npm run serve` or `npm run dev` |
| Sheaf-D (Docker) | `sheaf-D/.env`, next to `docker-compose.yml` | `docker compose up -d` |
| Sheaf-D (no Docker) | export it in the shell: `export DEEPL_AUTH_KEY=your-key-here` | `./scripts/start.sh` |

Don't paste the key into chat, screenshots or a commit. Git and the Docker build both ignore `.env`.

**How it behaves.**

- In Sheaf-D, "Save as PDF" sends the file to DeepL's document translation and hands back a PDF with the layout kept. A PDF costs at least 50,000 characters of your quota however short it is, so Word or Markdown output, which translates the text only, stretches a free key much further.
- In Sheaf, the Vite server relays the calls and adds the key. The browser never sees it, and DeepL's refusal of calls straight from web pages doesn't matter. You get Word or Markdown, not a PDF.
- With DeepL, the text (or file) goes to DeepL. Nothing else in the apps talks to a third party.

### Translate offline

No key, nothing leaves your machine, lower quality, text output only.

- **Sheaf:** pick "On this device" under Translator. It uses the translator built into Chrome 138 or newer on desktop. The first time you use a language pair, the browser downloads it once.
- **Sheaf-D:** build with the languages you want. English to and from each one is installed, and other pairs go through English:

  ```sh
  TRANSLATE_LANGS="es fr de" docker compose up -d --build
  ```

  This adds Argos Translate and a CPU-only PyTorch, around 1 GB, plus 100 to 200 MB per language. Without Docker: `pip install argostranslate`, then `python3 server/py/install_argos.py es fr`.

The Translator option has three settings. **Automatic** uses DeepL when it's set up and offline otherwise. **DeepL** and **Offline** force one. Offline output is Word or Markdown, because only DeepL can rebuild a PDF.

### More OCR languages

- **Sheaf** bundles English, Spanish, French, German, Italian and Portuguese.
- **Sheaf-D** ships English, German, French, Spanish, Italian, Portuguese and Dutch. To change the set, pass [Tesseract language codes](https://tesseract-ocr.github.io/tessdoc/Data-Files-in-different-versions.html) at build time:

  ```sh
  docker compose build --build-arg OCR_LANGS="deu jpn chi_sim"
  docker compose up -d
  ```

### Installing Sheaf as an app

Sheaf is a progressive web app, so it can be installed on a phone, tablet or computer and works offline afterwards. Browsers only allow this on `https://` or `http://localhost`. See [serving over HTTPS](#https) below.

- **Android (Chrome, Edge, Samsung Internet):** tap **Install** in Sheaf's header, or "Add to Home screen" in the browser menu.
- **iPhone and iPad:** Safari, Share, then "Add to Home Screen".
- **Mac:** Safari 17 and later has File, then "Add to Dock". Chrome and Edge show an install icon in the address bar.
- **Windows and Linux:** Chrome or Edge. Firefox runs Sheaf fine in a tab but doesn't install web apps.

---

## 5. Serving it to other devices

By default both apps only answer on the computer they run on. Pick the option that matches how far you want to reach.

| You want | Use | Safe? |
| --- | --- | --- |
| Only this computer | the defaults | Yes |
| Your own devices from anywhere | [Tailscale](#tailscale-recommended) | Yes. Only your devices can reach it |
| Everything on your home or office network | [Open the port to your LAN](#everyone-on-your-local-network) | Only on a network you trust |
| A real domain on the internet | [A reverse proxy with a login in front](#on-the-internet) | Only with real authentication added |

Neither app has accounts or logins. Anyone who can reach the address can use it. That's fine on your own devices and not fine on the open internet.

### Tailscale (recommended)

[Tailscale](https://tailscale.com) joins your devices into a private network. Install it on the machine running Sheaf and on the phone or laptop you want to use it from, and sign in to the same account on both.

1. On the host, start the app.
   - Sheaf: `npm run serve` (leave it open).
   - Sheaf-D: `docker compose up -d`.
2. Get an HTTPS address: `tailscale serve --bg 8080`. It prints something like `https://my-pc.your-tailnet.ts.net`. The first time, it may send you to the Tailscale admin console to turn on HTTPS certificates under **DNS**. Do that and run the command again.
3. Open that address on any device on your tailnet.

HTTPS matters. Without it, Sheaf can't be installed as an app or used offline, the Share button on phones is missing, and Sheaf-D's Scan to PDF can't use the camera.

For the plain-IP route, the Windows firewall rule, MagicDNS and the many ways it can go wrong, the main README's [Access over Tailscale](../README.md#access-over-tailscale) section goes through everything step by step, including its own troubleshooting list.

Don't use `tailscale funnel`. That puts the app on the public internet with no login.

### Everyone on your local network

**Sheaf:** `npm run serve` already listens on all interfaces. Find the host's address (`ipconfig` on Windows, `ip addr` or `ifconfig` elsewhere) and open `http://192.168.x.x:8080` from another device. Vite only accepts IP addresses and `.ts.net` names, so a short host name will show "Blocked request". Add other names to `allowedHosts` in `Sheaf/vite.config.js` if you need them. Allow TCP port 8080 through the host's firewall.

**Sheaf-D:** edit `docker-compose.yml` and change the port line from `"127.0.0.1:8080:8080"` to `"8080:8080"`, then `docker compose up -d`. Allow the port through the firewall.

Over plain `http://` from another device, every tool works, but there is no app install, no offline copy, no Share button, and no camera in Sheaf-D's Scan to PDF.

### HTTPS

You need an `https://` address for the app install, offline use, the Share button and the camera. Options:

- **Tailscale:** `tailscale serve --bg 8080`, as above. Easiest.
- **Caddy**, which gets certificates by itself when you have a domain:

  ```sh
  caddy reverse-proxy --from sheaf.example.com --to localhost:8080
  ```

- **Nginx** or another proxy. Raise the upload and timeout limits, or big files fail:

  ```nginx
  server {
      server_name sheaf.example.com;
      client_max_body_size 600m;     # Sheaf-D allows 500 MB per file by default
      proxy_read_timeout 600s;       # OCR and Office conversions can take minutes
      location / {
          proxy_pass http://127.0.0.1:8080;
          proxy_set_header Host $host;
      }
  }
  ```

### On the internet

Don't expose it as is. If you must, put a proxy in front that makes people log in (Authelia, Authentik, Cloudflare Access, basic auth in the proxy) and use HTTPS. Sheaf-D can run heavy jobs, so an open instance can be used to burn your CPU.

### Another port

If 8080 is taken, pick another. For Sheaf: `npx vite preview --host --port 8081` (Vite quietly moves to the next free port if the one you ask for is busy, so read the address it prints). For Sheaf-D: change the left side of the port line in `docker-compose.yml` to `8081`. Use the new number in firewall rules, `tailscale serve`, proxies and the address.

---

## 6. Keeping it running

**Sheaf-D in Docker** restarts itself after a crash or a reboot (`restart: unless-stopped` is already set). On Windows and Mac, Docker Desktop has to be running first, and it doesn't start at login by default. Turn that on in its settings.

**Sheaf** is a normal process, so you decide how it starts.

- **Quick and simple:** leave the `npm run serve` window open.
- **Linux, with systemd.** Save as `/etc/systemd/system/sheaf.service`, fixing the user and paths:

  ```ini
  [Unit]
  Description=Sheaf
  After=network.target

  [Service]
  User=youruser
  WorkingDirectory=/home/youruser/watching/Sheaf
  ExecStart=/usr/bin/npm run serve
  Restart=on-failure

  [Install]
  WantedBy=multi-user.target
  ```

  Then `sudo systemctl enable --now sheaf`. Check with `systemctl status sheaf` and `journalctl -u sheaf -f`.
- **Any system, with pm2:** `npm install -g pm2`, then `pm2 start "npm run serve" --name sheaf`, `pm2 save` and `pm2 startup` (it prints the one command to run so it starts at boot).
- **Windows:** Task Scheduler, a task that runs `npm run serve` in the `Sheaf` folder at log on.
- **No Node on the host:** build once elsewhere, copy `dist/` over, and serve it with anything. Python works: `python3 -m http.server 8080 --directory dist` (use `py` on Windows).

---

## 7. Updating and removing

**Update**

```sh
cd watching
git pull
```

- Sheaf: `cd Sheaf`, `npm install`, then restart `npm run serve`. An already-open Sheaf shows "A new version of Sheaf is ready" with a Reload button. It never reloads by itself, so you don't lose work.
- Sheaf-D: `cd sheaf-D`, then `docker compose up -d --build`.

**Remove**

- Sheaf: delete the folder. If you installed it as an app, remove it like any other app, and clear the site's data in the browser if you want the offline copy gone.
- Sheaf-D: `docker compose down`, then `docker rmi sheaf-d:latest` to free the 2 GB. Delete the folder.

---

## 8. Settings reference

**Sheaf-D**, under `environment:` in `docker-compose.yml`:

| Variable | Default | What it does |
| --- | --- | --- |
| `MAX_UPLOAD_MB` | `500` | Largest file the server accepts |
| `PORT` | `8080` | Port the server listens on inside the container |
| `HOST` | `0.0.0.0` | Address it binds to (Compose limits access with the port mapping) |
| `WORK_DIR` | `/work` | Where files sit while a job runs |
| `DEEPL_AUTH_KEY` | empty | Turns on DeepL translation. Set it in `.env` |
| `SOFFICE_BIN`, `OCRMYPDF_BIN`, `CHROMIUM_BIN`, `PYTHON_BIN` | found on `PATH` | Where the outside programs live when you run without Docker |

Build arguments, passed at build time: `OCR_LANGS` (Tesseract codes) and `TRANSLATE_LANGS` (two-letter codes for offline translation).

Jobs also run in a 4 GB in-memory folder (the `tmpfs` line in the compose file), and Chromium gets 1 GB of shared memory (`shm_size`). Raise either if big batches fail.

The gear icon in the app opens a small panel with the theme (light, dark or follow the system), the background colour, and a list of which engines the server found. That list is the quickest way to see what's missing.

**Sheaf**: the only setting is `DEEPL_AUTH_KEY` in `Sheaf/.env`. The port for `npm run serve` is set in the `serve` line of `Sheaf/package.json`.

---

## 9. Troubleshooting

Start with the quickest checks: is it running, and can you open `http://localhost:8080` on the host? If that works, the problem is how you reach it from elsewhere (section 5). If it doesn't, work through the lists below.

For problems reaching the app over Tailscale (timeouts, "Blocked request", MagicDNS, certificates, firewall rules), see the troubleshooting list in the main README's [Access over Tailscale](../README.md#access-over-tailscale) section.

### Installing and starting

**`npm install` fails or `node: command not found`.** Install Node 20 or newer from nodejs.org and check `node --version`. On Linux, the version in the distro's package manager is often too old.

**`npm run serve` or `npm run build` fails at the OCR step.** The script copies files from `node_modules`. Run `npm install` again so the OCR packages are there, and make sure the disk isn't full (about 100 MB is needed).

**"Port 8080 is in use" or "port is already allocated".** Something else has the port. Windows: `Get-Process -Id (Get-NetTCPConnection -LocalPort 8080 -State Listen).OwningProcess`. Mac and Linux: `lsof -i :8080`. Stop that program or use another port (section 5).

**Opening `dist/index.html` shows a blank page.** Browsers block the scripts on `file://`. Serve the folder over HTTP: `npm run preview`, or any static server.

**`docker compose` isn't a command.** You have the old standalone `docker-compose`, or an old Docker. Install the Compose plugin, or use `docker-compose` with a hyphen.

**Docker build fails downloading packages.** The build needs internet. Retry, check proxy and VPN settings, and make sure there's disk space (it needs several GB while building). Behind a corporate proxy, pass it as a build argument or set it in Docker's settings.

**Docker build is killed or stuck.** Docker Desktop's memory limit is too low for the build. Give it at least 4 GB under Settings, Resources.

**The container keeps restarting, or `docker compose ps` doesn't say "healthy".** Read the log: `docker compose logs --tail 100 sheaf-d`. The reason is almost always in the last few lines. On Windows and Mac, Docker Desktop must be running first.

### In the app

**A tool says a program is missing** ("needs python", "needs libreoffice"). In Docker this shouldn't happen, so rebuild with `docker compose up -d --build`. Without Docker, install the program from the table in section 3. The gear icon in Sheaf-D lists what the server found.

**Word, Excel or PowerPoint conversion fails or takes forever.** LibreOffice starts from scratch for each job, so the first file is slow, and very large files can take minutes. Check `docker compose logs`. Complex documents can fail to convert: re-save the original in its own app first, or export it to a simpler format.

**HTML to PDF can't load the page.** The server fetches the address itself, so the page has to be reachable from the machine running Sheaf-D, not just from your browser. Pages that need a login or block automated visitors won't load. As a workaround, save the page to an HTML file and upload that.

**OCR output looks wrong.** Pick the right language, or several. Low-resolution or skewed scans do badly: try Sheaf-D's "Straighten crooked scans". In Sheaf, OCR uses WebAssembly, which is slower and a bit less accurate than Sheaf-D's, so for big or tricky scans use Sheaf-D.

**Sheaf's OCR never starts or says it can't load.** The OCR files live in `public/ocr` and are copied there by `npm run dev` or `npm run build`. If you built with something else, run `npm run build` again. On a static host, make sure the `ocr/` folder came along with `dist/`.

**Translate says there's no translator.**
- *"DeepL needs an API key" / "not set up":* the key isn't being read. Check the `.env` file is in the right folder (section 4), has no spaces or quotes around the key, and that you restarted after creating it.
- *"DeepL turned down the API key":* the key is wrong, expired or revoked. Copy it again from your DeepL account. Free-plan keys end in `:fx`.
- *"Your DeepL quota is used up":* you've hit the monthly limit. Wait for it to reset, upgrade, or switch Translator to Offline.
- *"Offline translation is not installed":* build Sheaf-D with `TRANSLATE_LANGS` (section 4).
- *Sheaf says the browser has no on-device translator:* it needs Chrome 138 or newer on a desktop. Use DeepL, or Sheaf-D.
- *Sheaf's DeepL says it isn't set up even with a key:* DeepL only works through `npm run serve` or `npm run dev`. A plain static host has no relay.
- *The translator hangs in Chrome:* some Chromium builds expose the translation API without a model. Update Chrome, or pick DeepL.

**Scan to PDF can't open the camera.** Browsers only allow the camera on `https://` or `http://localhost`. Use an HTTPS address (section 5).

**Can't install Sheaf as an app, or it doesn't work offline.** Same cause: it needs `https://` or localhost. Plain `http://` from another device works for the tools but not for installing.

**I updated but still see the old Sheaf.** Close every tab of it and reopen, or press the Reload button on the "new version" banner. If it still looks old, clear the site's data in the browser settings. That also removes the offline copy, which it then fetches again.

**Big files fail or crawl.**
- Sheaf works inside the browser, so the limit is the device's memory. A huge PDF can stall a phone that a laptop handles fine. Split it first or use a computer.
- Sheaf-D rejects files over `MAX_UPLOAD_MB` (500 by default). Raise it in `docker-compose.yml`.
- Batches that fail part way may have filled the 4 GB in-memory work folder. Do fewer files at a time or raise the `tmpfs` size.
- Behind your own proxy, check its upload size and timeout limits (section 5 has the Nginx settings).

**A PDF won't open.** Try Repair PDF. If a PDF needs a password, Sheaf asks for it when you add the file. Sheaf-D's Unlock needs the password too.

**The result looks different from the original.** PDF to Word and Excel rebuild the content from the text, so exact layout isn't kept. PDF to PowerPoint puts a picture of each page on a slide. For a translation that keeps the layout, use Sheaf-D with DeepL and Save as PDF.

### Still stuck

Open the browser's developer console (F12, then Console) and look for red errors. For Sheaf-D, look at `docker compose logs`. Those two places hold the real reason in nearly every case. If you file an issue, include the error text, the tool, and whether it's Sheaf or Sheaf-D.

---

## 10. Privacy

- **Sheaf:** files are read, changed and saved in the browser. There's no server and nothing is uploaded. The one exception is Translate with DeepL, which sends the text to DeepL through your own Sheaf server.
- **Sheaf-D:** files go to the container on your machine and live in memory only until you've downloaded the result. Two things reach outside: HTML to PDF fetches the address you give it, and Translate with DeepL sends your file to DeepL. Offline translation and everything else stay on your machine.
- Neither app has analytics or accounts.
- Redact flattens the affected pages into images, so the hidden text is removed from the file. Edit's "change existing text" covers the old text rather than removing it from the file, so don't use it to hide something sensitive. Use Redact for that.

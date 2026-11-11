# watching

Two PDF toolkits that keep your files on your own machine. They share a look and most of a tool list, but they're built differently, so pick the one that fits.

| | [Sheaf](Sheaf/) | [Sheaf-D](sheaf-D/) |
| --- | --- | --- |
| Runs as | A static site in your browser | A Docker container with a small server |
| Needs | Node 20+ to build it, then any web server | Docker with Compose |
| Tools | 27: organise, compress, repair, OCR, JPG ↔ PDF, PDF to Word, Excel, PowerPoint and Markdown, edit, sign, protect, unlock, redact, compare, summarise, translate and more | 32: everything in Sheaf except PDF to Markdown, plus Word, Excel, PowerPoint and HTML to PDF, PDF/A and workflows that chain several tools |
| Files go | Nowhere. The browser does all the work | To the container on your machine, held in memory and dropped once you've downloaded the result |

Both work on Android, iPhone, iPad, Linux, macOS and Windows: touch-friendly layouts for phones and tablets, drag to reorder with a finger, and a home-screen icon if you want one. Sheaf also works offline once installed. The Sheaf-D image builds for Intel/AMD and ARM (Apple Silicon, Raspberry Pi). Each folder's README has a "Phones, tablets and computers" section with the details and the browser versions.

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

## Access over Tailscale

If your phone, laptop and the machine running Sheaf are all on the same [Tailscale](https://tailscale.com) network (your "tailnet"), you can open Sheaf from any of them without putting it on the open internet. Neither app has logins, so a tailnet is a good fit: only your own devices can reach it.

The examples use Windows PowerShell, since that's the most common host. The `tailscale` and `npm` commands are the same on macOS and Linux.

### Find the host's Tailscale address

On the machine that runs Sheaf:

```powershell
tailscale ip -4      # e.g. 100.101.102.103
tailscale status     # first line is this machine and its name
```

With MagicDNS on (it is by default), the machine also has a name. The short form is just the machine name, like `my-pc`. The full form is `my-pc.your-tailnet.ts.net`, and you can see it on the [Machines page](https://login.tailscale.com/admin/machines) of the admin console.

### Sheaf (browser)

Sheaf is a static site, so all you need is something serving the built files on a port the tailnet can reach. From the `Sheaf` folder:

```powershell
npm install
npm run serve
```

`npm run serve` builds the site and serves it on port 8080 on every network interface, Tailscale included. Leave that window open. From another device on the tailnet, open:

- `http://100.101.102.103:8080` (the IP from `tailscale ip -4`), or
- `http://my-pc.your-tailnet.ts.net:8080` (the full MagicDNS name).

The short name (`http://my-pc:8080`) gets a "Blocked request" page, because Vite only lets through IP addresses and names ending in `.ts.net` (see `Sheaf/vite.config.js`). Use one of the two above.

Windows Firewall blocks the port until you allow it. In an **administrator** PowerShell, run this once:

```powershell
New-NetFirewallRule -DisplayName "Allow Port 8080 on Tailscale" -Direction Inbound -Protocol TCP -LocalPort 8080 -RemoteAddress 100.64.0.0/10 -Action Allow
```

`100.64.0.0/10` is the range Tailscale hands out addresses from, so the rule lets your tailnet in and nothing else. To undo it: `Remove-NetFirewallRule -DisplayName "Allow Port 8080 on Tailscale"`.

#### With HTTPS

Plain HTTP over Tailscale is already encrypted end to end by WireGuard, and every Sheaf tool works over it. What you lose without HTTPS is installing Sheaf as an app, using it offline, and the Share button on phones: browsers only allow those on `https://` addresses. The browser will still call the page "Not secure", and some browsers nag about downloads from non-HTTPS pages. To get a real `https://` address, let Tailscale put a certificate in front of the port:

```powershell
tailscale serve --bg 8080
```

It prints the address, something like `https://my-pc.your-tailnet.ts.net`. That's the one to bookmark. The first time, it may send you to the admin console to turn on HTTPS certificates (under **DNS**); do that and run the command again. The very first page load can take a few seconds while the certificate is issued.

`tailscale serve` talks to the port on `localhost`, and it only answers on the Tailscale interface, so the firewall rule above isn't needed for this route. `--bg` keeps it running after you close the window and across reboots. Useful extras:

```powershell
tailscale serve status            # what is being served, and where
tailscale serve --https=443 off   # stop serving
```

`npm run serve` still has to be running for this to work, since Tailscale is only passing requests through to it.

#### Without Node on the host

If the machine that will host it doesn't have Node, build Sheaf somewhere that does (`npm run build`) and copy the `dist` folder over. Any static file server works, because Sheaf keeps its page in the `#` part of the address and never needs URL rewrites. Python's is fine:

```powershell
py -m http.server 8080 --directory dist   # use python3 on macOS and Linux
```

Then open it the same way as above, with or without `tailscale serve --bg 8080`.

### Sheaf-D (Docker)

`tailscale serve` is the easy route here too, and it needs no changes to `docker-compose.yml`. The container listens on `127.0.0.1:8080`, which is exactly where `tailscale serve` looks:

```powershell
cd sheaf-D
docker compose up -d --build
tailscale serve --bg 8080
```

Open the `https://…ts.net` address it prints. HTTPS matters more here than for Sheaf: Sheaf-D's Scan to PDF uses the live camera, and browsers only allow that on `localhost` or HTTPS.

If you'd rather use `http://100.101.102.103:8080` directly, change the port line in `docker-compose.yml` from `"127.0.0.1:8080:8080"` to `"8080:8080"`, run `docker compose up -d`, and add the firewall rule above. Be aware that `8080:8080` opens it to your local network as well as the tailnet. Scan to PDF won't get the camera over plain HTTP.

Don't use `tailscale funnel` for either app. Funnel puts it on the public internet, and with no logins anyone who finds the address could use it.

### Troubleshooting

Work through these in order. Each one rules out a layer.

1. **Is the server up?** On the host, open `http://localhost:8080`. For Sheaf-D you can also run `curl.exe http://localhost:8080/api/health`. If this fails, the problem isn't Tailscale; see "Nothing is listening" below.
2. **Are both devices on the tailnet?** Run `tailscale status` on each. Both should be listed and neither should say `offline`. If one is missing, sign it in to the same account.
3. **Can they reach each other?** From the other device, `tailscale ping my-pc`. You should get a `pong` within a few seconds.
4. **Is the port reachable?** From the other device, open `http://100.101.102.103:8080` (or, for HTTPS, run `tailscale serve status` on the host and use exactly the address it shows).

**Nothing is listening on 8080**

- Sheaf: the `npm run serve` window has to stay open. If it closed, start it again. On Windows you can check with `Get-NetTCPConnection -LocalPort 8080 -State Listen`.
- Sheaf-D: `docker compose ps` should show the container as `running (healthy)`. If it isn't, `docker compose logs --tail 100 sheaf-d` usually says why, and `docker compose up -d` starts it again. On Windows, Docker Desktop has to be running before any of this works, and by default it doesn't start at login (Settings → General → "Start Docker Desktop when you sign in").

**"Port 8080 is in use" or "port is already allocated"**

Something else has the port. Find it:

```powershell
Get-Process -Id (Get-NetTCPConnection -LocalPort 8080 -State Listen).OwningProcess
```

On macOS or Linux: `lsof -i :8080`. Either stop that program or pick another port, say 8081: run `npx vite preview --host --port 8081` for Sheaf (or change the left side of the compose port line to `8081` for Sheaf-D), then use 8081 in the firewall rule, in `tailscale serve --bg 8081`, and in the address. Note that Vite quietly moves to the next free port if 8080 is taken, so read the address it prints.

**Works on the host, times out from other devices**

Almost always the firewall. Check the rule exists and is enabled:

```powershell
Get-NetFirewallRule -DisplayName "Allow Port 8080 on Tailscale" | Format-List DisplayName, Enabled, Action
```

If Windows put the Tailscale adapter in the "Public" profile and you have other software firewalls (antivirus suites often ship one), allow the port there too. On Linux, `sudo ufw allow in on tailscale0 to any port 8080 proto tcp` does the same job. `tailscale serve` avoids all of this, so try the HTTPS route if you're stuck.

**Times out from some devices but not others**

Your tailnet's access rules may block them. The default policy allows everything, but if you've edited it, check **Access controls** in the admin console and make sure the device (or your user) is allowed to reach the host on port 8080 (direct) or 443 (`tailscale serve`). The [policy preview](https://login.tailscale.com/admin/acls) tells you whether a given connection is allowed.

**The name doesn't resolve, but the IP works**

MagicDNS is off, or the device you're on is ignoring Tailscale's DNS. Turn MagicDNS on under **DNS** in the admin console, and on the client run `tailscale set --accept-dns=true` (or tick "Use Tailscale DNS settings" in the Tailscale menu). Corporate VPNs and some "secure DNS" browser settings can override it as well. Until it's sorted, use the IP.

**"Blocked request. This host is not allowed"**

That's Vite refusing a host name it doesn't recognise. Use the IP or the full `.ts.net` name. If you need another name to work, add it to `allowedHosts` in `Sheaf/vite.config.js`, then restart `npm run serve`.

**`tailscale serve` complains**

- About HTTPS not being enabled: turn on HTTPS certificates under **DNS** in the admin console. MagicDNS has to be on for this.
- "Access denied" on Linux: run it with `sudo`, or let your user manage Tailscale with `sudo tailscale set --operator=$USER`.
- A certificate warning on the first visit: wait a minute while the certificate is issued, then reload.

One thing to know: Tailscale's certificates are public, so your machine name and tailnet name appear in Certificate Transparency logs. Nothing else is exposed, but don't name the machine something you'd mind people seeing.

**Camera, "Not secure" warnings or blocked downloads**

These come from browsers treating plain HTTP as insecure. Sheaf-D's live camera needs HTTPS, and some browsers warn before saving a file from an HTTP page. Use the `https://` address from `tailscale serve` and they go away.

Don't mix addresses, either. `http://100.x.x.x:8080` and `https://my-pc…ts.net` count as different sites to the browser, so the theme and colour you picked on one won't show on the other, and an HTTPS page can't call an HTTP one (mixed content). Pick one address and stick with it.

**Big files fail or crawl**

- Sheaf works inside the browser, so the size limit is the device's memory. Very large PDFs can stall a phone where a laptop copes fine.
- Sheaf-D turns away files over `MAX_UPLOAD_MB` (500 by default) with "Files can be up to 500 MB each". Raise it in `docker-compose.yml`. Jobs also run in a 4 GB in-memory folder (the `tmpfs` line), which a big batch can fill.
- `tailscale serve` doesn't cap upload size. If you put another proxy in front instead, check its limits. Nginx, for example, stops at 1 MB by default (`client_max_body_size`) and gives up on responses after 60 seconds (`proxy_read_timeout`), which OCR or Office conversions on a big file can exceed.
- If `tailscale ping` says `via DERP`, traffic is being relayed through Tailscale's servers rather than going direct, and large uploads will be slow. A direct connection usually needs outbound UDP allowed on both networks. `tailscale netcheck` shows what's getting in the way.

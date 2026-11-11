import { defineConfig } from 'vite';

export default defineConfig({
  // Vite turns away requests for host names it doesn't recognise. Tailscale
  // MagicDNS names end in .ts.net, so let those through when the site is
  // opened by name from another device on the tailnet.
  server: { allowedHosts: ['.ts.net'] },
  preview: { allowedHosts: ['.ts.net'] },
});

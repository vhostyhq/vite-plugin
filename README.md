# vite-plugin-vhosty

Runs your Vite dev server through [vhosty](https://github.com/zacksmash/vhosty), with
HTTPS and hot reload at `https://<port>.<your-domain>`, from any device on your tailnet.

```
  ➜  Local:   http://127.0.0.1:5173/
  ➜  vhosty:  https://5173.vhosty.link/
```

- **Zero config on vhosty machines.** It reads your domain from `~/.vhosty/config`.
- **Safe for teammates.** Without vhosty, the plugin does nothing and Vite behaves normally.
- **Runs several projects at once.** Each project gets the next free port and its matching hostname.
- **Works with Laravel.** `public/hot` gets the `https://` URL, so `@vite` loads assets through vhosty.

## Install

```bash
npm i -D vite-plugin-vhosty
```

```js
// vite.config.js
import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';
import vue from '@vitejs/plugin-vue';
import vhosty from 'vite-plugin-vhosty';

export default defineConfig({
    plugins: [
        vhosty(),
        laravel({ input: ['resources/css/app.css', 'resources/js/app.js'], refresh: true }),
        vue(),
    ],
});
```

Run `npm run dev` as usual.

## What it does

When the dev server starts (`vite` / `npm run dev`, but not `build` or `preview`) on a
machine with a vhosty domain, the plugin:

- **Picks a free port** starting at `server.port` (default 5173). It checks both `127.0.0.1`
  and `::1`, so it never lands on a port another dev server holds over IPv6.
- **Points Vite at `https://<port>.<domain>`:** `server.origin`, HMR over a secure
  WebSocket on port 443, and `allowedHosts` for that hostname.
- **Binds to `127.0.0.1` only.** vhosty's Caddy is the way in, so the dev server isn't
  exposed on your network.
- **Allows CORS from `https://*.<domain>`,** so your app loads the assets whether it's at
  `escrow.vhosty.link`, a proxied name, or another port.
- **Deletes a stale `public/fonts-manifest.dev.json`,** which laravel-vite-plugin can
  leave pointing at an old hostname.

## Options

```js
vhosty({
    domain: 'vhosty.link',     // default: VHOSTY_DOMAIN, then ~/.vhosty/config
    port: 5173,                // first port to try (default: server.port, or 5173)
    cleanFontsManifest: true,  // delete a stale fonts-manifest.dev.json on start
    configPath: '/Users/you/.vhosty/config', // default: ~/.vhosty/config
})
```

The plugin looks for the domain in this order:

1. the `domain` option
2. `VHOSTY_DOMAIN` in the project's `.env`
3. `VITE_HMR_DOMAIN` (the older name, still supported)
4. `VHOSTY_DOMAIN` in `~/.vhosty/config`

If none is set, the plugin does nothing. To turn it off for one project on a vhosty
machine, set `VHOSTY=false` in that project's `.env`.

## Laravel

Set the app's URL in `.env`, then run `php artisan config:clear`:

```dotenv
APP_URL=https://escrow.vhosty.link
```

When vhosty serves the app through PHP-FPM, Laravel already generates `https://` links.
See the [vhosty Laravel guide](https://github.com/zacksmash/vhosty/blob/main/docs/laravel-vite.md)
for `artisan serve` and Octane.

## Troubleshooting

| Symptom | Fix |
|---|---|
| No `vhosty:` line on startup | No domain found. Check `~/.vhosty/config`, or set `VHOSTY_DOMAIN`. |
| Assets load from `http://localhost:5173` | `vhosty()` must come **before** `laravel()` in `plugins`. |
| 502 on `https://<port>.<domain>` | Vite isn't running, or vhosty's Caddy isn't. Run `vhosty doctor`. |
| `EOF` in Caddy's log | Vite is serving HTTPS itself (`basicSsl()`, `detectTls`, `server.https`). Remove it; vhosty handles HTTPS. |

## Requirements

Vite 5 or newer, Node 18 or newer, and an ESM `vite.config` (the default for Vite and Laravel).

## License

MIT

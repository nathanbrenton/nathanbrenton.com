# Public server plan

## Separation

```text
/var/www/nathanbrenton.com/current/   # zero-build static personal site
/var/www/hiplingo.com/current/        # contents of audio-player/dist
/var/www/hiplingo.com/media/          # sanitized public publication packages
```

`metadata-editor`, private masters, ingest folders, and internal administrative applications do not live under either nginx document root.

## nathanbrenton.com

Deploy the files in the personal-site project directly to `/var/www/nathanbrenton.com/current/`.

No Node.js process is required on the server.

## hiplingo.com

Build the existing React/Vite `audio-player` project before deployment:

```bash
npm ci
npm test
npm run build
```

Deploy the *contents* of `dist/` to `/var/www/hiplingo.com/current/`.

The React application continues requesting `/media/catalog.json` and release assets from the same origin. nginx maps `/media/` to `/var/www/hiplingo.com/media/`, keeping app code and published media independently deployable.

This means the browser sees:

```text
https://hiplingo.com/                 -> React SPA
https://hiplingo.com/releases/...     -> React SPA route
https://hiplingo.com/listen           -> React SPA route
https://hiplingo.com/assets/...       -> Vite build assets
https://hiplingo.com/media/catalog.json
https://hiplingo.com/media/...        -> published artwork/waveforms/HLS
```

## Initial nginx enablement

Copy the two `.conf` files to `/etc/nginx/sites-available/`, symlink them into `sites-enabled`, then validate with `nginx -t` before reload.

Do not add HTTPS redirects or HSTS until DNS points at the server and certificates have been successfully issued. TLS/certificate configuration and final security headers belong to the server hardening pass.

## Later Jam Agreement backend

The Jam Agreement manager itself remains private. A separate participant-facing API can eventually listen only on localhost (for example `127.0.0.1:4175`) and nginx can reverse proxy only `/api/jam/` to it. Do not expose the administrative UI or its database directly.

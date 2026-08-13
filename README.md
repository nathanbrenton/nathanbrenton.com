# nathanbrenton.com

Mobile-first static personal/business-card site.

## Why static

This site intentionally has no runtime framework or build dependency. nginx can serve it directly, which keeps it independent from the Hiplingo React/Vite deployment.

## Before deployment

1. Keep the responsive header artwork at `assets/banner-mobile.webp` and `assets/banner-desktop.webp`.
2. Replace `assets/profile.jpg` with the final profile image.
3. Put the public resume PDF at `resume/Nathan-Brenton-Resume.pdf`.
4. Add public URLs in `site-data.js` for LinkedIn, GitHub, YouTube, and Instagram.
5. Review resume/profile wording against the final resume before publishing.

## Local preview

From this directory:

```bash
python3 -m http.server 8080
```

Open `http://127.0.0.1:8080/`.

## Proposed server layout

```text
/var/www/nathanbrenton.com/
  releases/
    <deployment-id>/
  current -> releases/<deployment-id>/

/var/www/hiplingo.com/
  app/
    releases/
      <deployment-id>/
    current -> releases/<deployment-id>/
  published-media/
    catalog.json
    releases/
```

The two domains use separate nginx `server` blocks. Hiplingo serves its React/Vite production build from `app/current/` while `/media/` maps independently to `published-media/`, so frontend deployments cannot overwrite published releases.

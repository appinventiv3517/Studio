# Deploying live: Vercel + Render + Railway

```
Browser ──> Vercel (website, screens)
              │  /api/*  is forwarded (next.config.mjs, API_URL)
              ▼
            Render (backend: the API, same code, `npm run start`)
              │  LIBSQL_URL + LIBSQL_AUTH_TOKEN
              ▼
            Railway (database: SQLite server "libSQL", with a Volume)
```

Why a database *server*: SQLite is a file, and Render's free plan has no permanent disk, so the file cannot live
there. Railway runs a SQLite server (libSQL / sqld) with a Volume, and the backend talks to it over HTTPS.
Locally and in the desktop app nothing changes: no `LIBSQL_URL` means the plain SQLite file in `DATABASE_URL`.

Do the three steps in this order. Push the repo to GitHub first.

## 1. Database on Railway

1. Locally run `npm run db:make-key`. It prints `SQLD_AUTH_JWT_KEY` and `LIBSQL_AUTH_TOKEN`. Keep both.
2. Railway → New Project → Deploy from GitHub repo → this repo. In the service **Settings**, set *Root directory* to `deploy/railway` (it holds the Dockerfile).
3. **Variables**: `SQLD_AUTH_JWT_KEY` = the value from step 1.
4. **Volumes**: add one, mount path `/var/lib/sqld`.
5. **Settings → Networking → Generate domain**, port `8080`. That address (`https://….up.railway.app`) is your `LIBSQL_URL`.
6. Create the tables and the owner login, from your computer:
   ```bash
   export LIBSQL_URL=https://….up.railway.app LIBSQL_AUTH_TOKEN=…
   export DATABASE_URL=file:./unused.db SESSION_SECRET=any-long-random-text
   npm run db:push-remote
   npx tsx prisma/seed.ts --empty        # owner login only; add OWNER_PASSWORD=yourpassword to choose it. Without --empty you get demo data.
   ```

## 2. Backend on Render

1. Render → New → Blueprint → this repo (it reads `render.yaml`). Or New Web Service with build `npm ci && npm run build`, start `npm run start`.
2. Environment: `LIBSQL_URL`, `LIBSQL_AUTH_TOKEN` (from Railway), `SITE_URL` (your Vercel address, set it after step 3 and redeploy). `SESSION_SECRET` is generated for you; `DATABASE_URL` is `file:./unused.db`.
3. Note the address, e.g. `https://salon-studio-api.onrender.com`. Check `…/api/public/branding` answers.

The free plan sleeps after 15 minutes idle, so the first request after a break takes about a minute.

## 3. Website on Vercel

1. Vercel → Add New Project → this repo. Framework: Next.js. Build command: `npm run build` (default from package.json).
2. Environment: `API_URL` = the Render address (no trailing slash), `SITE_URL` = the Vercel address, plus `DATABASE_URL` = `file:./unused.db` and `SESSION_SECRET` (the same value as on Render).
3. Deploy. Sign in at the Vercel address.

## Notes

- Sign-in cookies are set on the Vercel domain (the browser never talks to Render directly), so there is no CORS setup.
- Back up the Railway Volume (Railway has volume backups), as it holds all the records.
- Changing the tables later: `npm run db:push-remote` only creates what is missing; it does not alter existing tables.
- `npm run reset-2fa` and other scripts work against the live database when `LIBSQL_URL` and `LIBSQL_AUTH_TOKEN` are exported.
- The `Dockerfile` uses the `SQLD_AUTH_JWT_KEY` variable name; if the sqld version you get rejects it, use a key file with `SQLD_AUTH_JWT_KEY_FILE` instead.

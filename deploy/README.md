# Deploying live: Vercel + Render + MongoDB Atlas

```
Browser ──> Vercel (website, screens)
              │  /api/*  is forwarded (next.config.mjs, API_URL)
              ▼
            Render (backend: the API, same code, `npm run start`)
              │  DATABASE_URL
              ▼
            MongoDB Atlas (database, free M0 cluster)
```

Do the steps in this order. Push the repo to GitHub first.

## 1. Database on MongoDB Atlas (free)

1. Sign up at mongodb.com/atlas, create a free **M0** cluster (any region near Render's).
2. **Database Access** → add a user with a password (use letters and digits only, or URL-encode symbols).
3. **Network Access** → add `0.0.0.0/0` (Render's free plan has no fixed address; the password protects it).
4. **Connect → Drivers** → copy the string and put a database name before the `?`:
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/salon?retryWrites=true&w=majority`
5. From your computer, create the collections and the owner login:
   ```bash
   export DATABASE_URL="mongodb+srv://…/salon?retryWrites=true&w=majority"
   export SESSION_SECRET=any-long-random-text
   npx prisma db push
   OWNER_PASSWORD=yourpassword npx tsx prisma/seed.ts --empty   # owner login only (admin@salon.com). Drop --empty for demo data.
   ```

## 2. Backend on Render

1. Render → New → Blueprint → this repo (it reads `render.yaml`). Or New Web Service with build `npm ci && npm run build`, start `npm run start`.
2. Environment: `DATABASE_URL` (the Atlas string), `SITE_URL` (your Vercel address; set it after step 3 and redeploy). `SESSION_SECRET` is generated for you; copy its value for Vercel.
3. Note the address, e.g. `https://salon-studio-api.onrender.com`. Check `…/api/public/branding` answers.

The free plan sleeps after 15 minutes idle, so the first request after a break takes about a minute.

## 3. Website on Vercel

1. Vercel → Add New Project → this repo. Framework: Next.js (default build command).
2. Environment: `API_URL` = the Render address (no trailing slash), `SITE_URL` = the Vercel address, `SESSION_SECRET` = the same value as on Render.
3. Deploy. Sign in at the Vercel address.

## Notes

- Sign-in cookies are set on the Vercel domain (the browser never talks to Render directly), so there is no CORS setup.
- Atlas M0 has no automatic backups; export with `mongodump` now and then, or use a paid tier for backups.
- After changing `prisma/schema.prisma`, run `npx prisma db push` against the live `DATABASE_URL` to update the indexes.
- `npm run reset-2fa` and the other scripts work against the live database when `DATABASE_URL` is exported.

# Deploying MegaConstruct (Vercel backend, Cloudflare Pages frontend, Supabase DB, SendGrid email)

This file outlines exact steps and environment variables to set in the vendor UIs. Use copy-paste when configuring Vercel, Cloudflare Pages, Supabase, and SendGrid.

## 1) GitHub repo
- Repo: https://github.com/fsm-blip/megaconstruct
- Ensure your backend is in `backend/` and frontend in `client/` (the repo is already split).

## 2) Supabase (Postgres)
1. Create project on https://app.supabase.com.
2. In Project → Settings → Database → Connection string, copy the connection string (postgres://user:pass@db.<project>.supabase.co:5432/postgres). This is your `DATABASE_URL`.
3. Optional: create a role/user and restrict if you want. Save the full connection string for Vercel.
4. Configure backups if you need them.

## 3) SendGrid (Email)
1. Create an account at https://sendgrid.com.
2. Create an API key with "Full Access" or at least Mail Send.
3. You will use SMTP with nodemailer: host `smtp.sendgrid.net`, port `587`, user `apikey`, pass `<API_KEY>`.
4. Configure domain authentication (DKIM/SPF) and add the records to Cloudflare DNS (see Cloudflare section).

## 4) Vercel (backend)
1. Sign in to https://vercel.com and import the GitHub repo `fsm-blip/megaconstruct`.
2. When configuring the project, set Root Directory to `/backend` (so Vercel builds and runs the server there).
3. Build & Run settings:
   - Build command: `npm --prefix backend install && npm --prefix backend run build || true`
   - Output directory: leave blank (this is a Node server)
   - Framework preset: Other
   - Start command: `node server.js`
4. Environment variables (set in Project → Settings → Environment Variables):
   - `DATABASE_URL` = `postgres://...` (from Supabase)
   - `JWT_SECRET` = a long random string
   - `EMAIL_HOST` = smtp.sendgrid.net
   - `EMAIL_PORT` = 587
   - `EMAIL_USER` = apikey
   - `EMAIL_PASS` = <SendGrid API Key>
   - `OWNER_EMAIL` = your owner email
   - `NODE_ENV` = production
5. Deploy.
6. Vercel will provide a domain like `megaconstruct-backend-xxxxx.vercel.app`. We'll map `api.construct.co.uk` to this later via Cloudflare.

## 5) Cloudflare Pages (frontend)
1. Create a Pages project at https://dash.cloudflare.com/pages and connect the repo.
2. Configure build settings:
   - Production branch: `main` (or the branch you use)
   - Build command: `npm --prefix client install && npm --prefix client run build`
   - Build output directory: `client/dist`
3. Add Environment variable in Pages:
   - `VITE_API_URL` = `https://api.construct.co.uk` (or the Vercel backend url while testing)
4. Deploy; Cloudflare Pages will give you a preview domain and production domain after you configure DNS.

## 6) Cloudflare DNS & Namecheap
Option A (recommended): Use Cloudflare nameservers
1. In Cloudflare add your domain `construct.co.uk`.
2. Cloudflare gives two nameservers. In Namecheap → Domain List → Manage → Nameservers: set them to Cloudflare's.
3. In Cloudflare DNS add records:
   - A/ALIAS/CNAME for Pages will be handled by Cloudflare when you add Pages custom domain.
   - CNAME `api` -> `<your-vercel-hostname>` (note: Vercel may ask you to verify via TXT/CNAME; use their provided target). Set DNS entry to DNS only (gray-cloud) if Vercel requires direct connection; if you proxy through Cloudflare, use Full (strict) TLS.
   - Add DKIM CNAME entries provided by SendGrid.
   - Add SPF TXT `v=spf1 include:sendgrid.net ~all`
4. In Vercel, add Custom Domain `api.construct.co.uk` mapped to your project, follow verification steps.
5. In Cloudflare Pages, set custom domain `construct.co.uk` and follow verification; ensure `VITE_API_URL` matches `https://api.construct.co.uk`.

## 7) Final checks
- Visit `https://construct.co.uk` (Cloudflare Pages) and ensure assets load and API calls go to `api.construct.co.uk`.
- Login as owner (seeded account) or create via environment-defined owner.
- Test email flows; confirm in SendGrid activity logs.

## Notes
- Vercel will automatically set `PORT` via env and should start server.js. Ensure your server uses `process.env.PORT` (server.js already does).
- Supabase may require you to allow external connections; the connection string provided is usable from Vercel.

If you want, I can generate the exact DNS record entries for the Cloudflare console (copy-paste) and a `vercel.json` configuration for the backend. I can also prepare a `scripts/migrate_sqlite_to_postgres.js` to export local data to Supabase if you need it.

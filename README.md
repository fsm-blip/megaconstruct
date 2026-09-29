# MegaConstruct Portal

MegaConstruct is a Node/Express + React/Vite portal for staff timesheets, client/manager approval, owner oversight, and draft invoice generation.

## Stack

- Backend: Node.js, Express, JWT auth, bcrypt password hashing, nodemailer email hooks
- Database: Postgres/Supabase when `DATABASE_URL` is set; explicit SQLite fallback for local dev when it is not
- Frontend: React 18 + Vite

## Local setup

### Backend

```bash
cd backend
cp ../.env.example .env
npm install
npm run env:check
npm run dev
```

Minimum recommended `backend/.env`:

```env
PORT=3000
NODE_ENV=development
JWT_SECRET=replace-with-a-long-random-local-secret
DATABASE_URL=postgresql://db_user:db_password@localhost:5432/megaconstruct
OWNER_EMAIL=owner@example.com
```

If `DATABASE_URL` is blank, the backend logs that it is using local SQLite fallback. It no longer silently connects to a hidden default Postgres URL.

### Frontend

Create `frontend/client/.env`:

```env
VITE_API_URL=http://localhost:3000
```

Then run:

```bash
cd frontend/client
npm install
npm run dev
```

## Owner password reset

If an existing owner password is unknown, use the local helper. It reads `backend/.env` and never needs the password committed or pasted into chat.

```bash
cd backend
OWNER_NEW_PASSWORD="replace-with-new-local-password" node scripts/reset_owner_password.js
```

The message must say `using Postgres/Supabase` when your backend is using Postgres. If it says `using SQLite`, your `DATABASE_URL` is not being loaded.

## Verification commands

```bash
cd backend
npm run env:check
node --check server.js
```

```bash
cd frontend/client
npm run build
```

A backend authenticated endpoint can be checked without logging in:

```bash
curl -i http://localhost:3000/api/clients
```

`401 Missing auth` is expected and confirms the backend is reachable.

## Repository hygiene

Do not commit:

- `.env` files
- local SQLite DB/WAL/SHM files
- `node_modules`
- Vite `dist` build output
- local logs
- key-like access files

These are ignored by `.gitignore`; if accidentally tracked, untrack them with `git rm --cached` rather than deleting local working copies.

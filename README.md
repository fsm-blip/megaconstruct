
# Mega Construct — Prototype Portal

This repository contains a minimal prototype for the Mega Construct online portal.

Overview
- Staff can register/login and submit timesheets.
- Clients can login and approve timesheets submitted by staff assigned to them.
- Owner receives email notifications when timesheets are approved.

Tech stack (prototype)
- Node.js + Express
- lowdb for simple JSON file storage (prototype only)
- JWT for simple auth
- Nodemailer for email hooks (Ethereal or SMTP)
- Static frontend in `public/`

Quick start

1. Copy `.env.example` to `.env` and fill values (or use defaults for local testing):

	 - `PORT` (default 3000)
	 - `JWT_SECRET` (change for production)
	 - `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS` (for email sending)
	 - `OWNER_EMAIL` (owner notification target)

2. Install dependencies:

```bash
npm install
```

3. Start the server:

```bash
npm start
```

Seeded users
- On first run the server will seed a default owner and a sample client if not present. The seeded credentials are logged to console. Default passwords (change via env):
	- Owner: `OWNER_PASSWORD` or `ownerpass`
	- Client: `SEED_CLIENT_PASSWORD` or `clientpass`

Smoke test script

A small smoke test script is provided at `scripts/smoke_test.sh` which performs a quick end-to-end flow using curl (register a staff user, submit a timesheet, client approves, owner lists approved timesheets).

Notes & next steps
- This is a local prototype. For production: use a real DB, secure secrets, add input validation and rate limiting, serve over HTTPS, and add proper UX.


# megaconstruct

# Backend maintenance scripts

## Reset owner password locally

Use `reset_owner_password.js` to update the existing owner password in the database your backend is configured to use.

The script reads `backend/.env` and uses:

- `DATABASE_URL` for Postgres/Supabase, when present
- `backend/megaconstruct.sqlite` as fallback when `DATABASE_URL` is absent
- `OWNER_EMAIL` to identify the owner account
- `OWNER_NEW_PASSWORD` or `NEW_PASSWORD` for the replacement password

Run from the backend folder:

```bash
cd backend
OWNER_NEW_PASSWORD="your-new-password" node scripts/reset_owner_password.js
```

Do not commit `.env` or paste passwords into chat.

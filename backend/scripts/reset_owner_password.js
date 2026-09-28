#!/usr/bin/env node
const path = require('path');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const Database = require('better-sqlite3');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ownerEmail = process.env.OWNER_EMAIL;
const newPassword = process.env.OWNER_NEW_PASSWORD || process.env.NEW_PASSWORD;
const databaseUrl = process.env.DATABASE_URL;

if (!ownerEmail) {
  console.error('OWNER_EMAIL is required. Set it in backend/.env or before running this script.');
  process.exit(1);
}

if (!newPassword || newPassword.length < 10) {
  console.error('Set OWNER_NEW_PASSWORD or NEW_PASSWORD to a new password of at least 10 characters.');
  console.error('Example: OWNER_NEW_PASSWORD="your-new-password" node scripts/reset_owner_password.js');
  process.exit(1);
}

const passwordHash = bcrypt.hashSync(newPassword, 8);

async function resetPostgres() {
  const poolConfig = { connectionString: databaseUrl };
  if (process.env.NODE_ENV === 'production' || /supabase\.co/i.test(databaseUrl)) {
    poolConfig.ssl = { rejectUnauthorized: false };
  }
  const pool = new Pool(poolConfig);
  try {
    const result = await pool.query(
      "UPDATE users SET password=$1 WHERE role='owner' AND email=$2 RETURNING id,email,role",
      [passwordHash, ownerEmail]
    );
    if (result.rowCount === 0) {
      console.error(`No owner found for OWNER_EMAIL=${ownerEmail}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Owner password reset for ${result.rows[0].email} using Postgres/Supabase.`);
  } finally {
    await pool.end();
  }
}

function resetSqlite() {
  const dbPath = process.env.SQLITE_DB_PATH || path.join(__dirname, '..', 'megaconstruct.sqlite');
  const db = new Database(dbPath);
  try {
    const owner = db.prepare("SELECT id,email,role FROM users WHERE role = ? AND email = ?").get('owner', ownerEmail);
    if (!owner) {
      console.error(`No owner found for OWNER_EMAIL=${ownerEmail} in SQLite ${dbPath}`);
      process.exitCode = 1;
      return;
    }
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(passwordHash, owner.id);
    console.log(`Owner password reset for ${owner.email} using SQLite.`);
  } finally {
    db.close();
  }
}

(async () => {
  try {
    if (databaseUrl) {
      await resetPostgres();
    } else {
      resetSqlite();
    }
  } catch (err) {
    console.error('Password reset failed:', err.message);
    process.exit(1);
  }
})();

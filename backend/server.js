const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const path = require('path');
const { Pool } = require('pg');
// nanoid is an ES module; use crypto.randomUUID() instead for unique ids in CommonJS
const Database = require('better-sqlite3');
require('dotenv').config();

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'secret';

let useSqlite = false;
let pool = null;
let sqliteDb = null;

async function initDb() {
  // Try Postgres first if DATABASE_URL is set, otherwise try default Postgres connection
  const tryConn = process.env.DATABASE_URL || 'postgres://postgres:pass@localhost:5432/megaconstruct';
  try {
    // When running in production (Vercel/Supabase) we need to enable TLS/SSL.
    const poolConfig = { connectionString: tryConn };
    if (process.env.NODE_ENV === 'production') {
      poolConfig.ssl = { rejectUnauthorized: false };
    }
    pool = new Pool(poolConfig);
    await pool.query('SELECT 1');
    console.log('Connected to Postgres');
  } catch (e) {
    console.warn('Postgres not available or connection failed, falling back to SQLite:', e.message);
    useSqlite = true;
  }

  if (useSqlite) {
    sqliteDb = new Database(path.join(__dirname, 'megaconstruct.sqlite'));
    sqliteDb.pragma('journal_mode = WAL');
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS timesheets (
        id TEXT PRIMARY KEY,
        staff_id TEXT,
        client_id TEXT,
        date TEXT,
        hours REAL,
        notes TEXT,
        status TEXT,
        created_at TEXT,
        approved_at TEXT
      );
      CREATE TABLE IF NOT EXISTS password_resets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used INTEGER DEFAULT 0
      );
    `);
    // add client_id column to users if missing
    try {
      sqliteDb.prepare("ALTER TABLE users ADD COLUMN client_id TEXT").run();
    } catch (e) {
      // ignore if column exists
    }
  } else {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id text PRIMARY KEY,
        name text NOT NULL,
        email text UNIQUE NOT NULL,
        password text NOT NULL,
        role text NOT NULL
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS timesheets (
        id text PRIMARY KEY,
        staff_id text REFERENCES users(id),
        client_id text REFERENCES users(id),
        date date,
        hours numeric,
        notes text,
        status text,
        created_at timestamptz,
        approved_at timestamptz
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_resets (
        id text PRIMARY KEY,
        user_id text NOT NULL,
        token text NOT NULL,
        expires_at timestamptz NOT NULL,
        used boolean DEFAULT false
      );
    `);
    // ensure client_id column exists
    try {
      await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS client_id text");
    } catch (e) { /* ignore */ }
  }

  // seed owner and client if missing (owner credentials requested)
  const ownerEmail = process.env.OWNER_EMAIL || 'tsvet.spasov';
  const ownerPw = process.env.OWNER_PASSWORD || 'viki_2505';
  const clientEmail = process.env.SEED_CLIENT_EMAIL || 'client@example.com';
  const clientPw = process.env.SEED_CLIENT_PASSWORD || 'clientpass';

  if (useSqlite) {
    const row = sqliteDb.prepare('SELECT id FROM users WHERE role = ? LIMIT 1').get('owner');
    if (!row) {
  const id = crypto.randomUUID();
      sqliteDb.prepare('INSERT INTO users(id,name,email,password,role) VALUES(?,?,?,?,?)').run(id, 'Owner', ownerEmail, bcrypt.hashSync(ownerPw, 8), 'owner');
      console.log('Seeded owner ->', { email: ownerEmail, password: ownerPw, id });
    }
    const crow = sqliteDb.prepare('SELECT id FROM users WHERE role = ? LIMIT 1').get('client');
    if (!crow) {
  const id = crypto.randomUUID();
      sqliteDb.prepare('INSERT INTO users(id,name,email,password,role) VALUES(?,?,?,?,?)').run(id, 'Client A', clientEmail, bcrypt.hashSync(clientPw, 8), 'client');
      console.log('Seeded client ->', { email: clientEmail, password: clientPw, id });
    }
  } else {
    const ownerRes = await pool.query('SELECT id FROM users WHERE role=$1 LIMIT 1', ['owner']);
    if (ownerRes.rowCount === 0) {
      const id = crypto.randomUUID();
      await pool.query('INSERT INTO users(id,name,email,password,role) VALUES($1,$2,$3,$4,$5)', [id, 'Owner', ownerEmail, bcrypt.hashSync(ownerPw, 8), 'owner']);
      console.log('Seeded owner ->', { email: ownerEmail, password: ownerPw, id });
    }
    const clientRes = await pool.query('SELECT id FROM users WHERE role=$1 LIMIT 1', ['client']);
    if (clientRes.rowCount === 0) {
      const id = crypto.randomUUID();
      await pool.query('INSERT INTO users(id,name,email,password,role) VALUES($1,$2,$3,$4,$5)', [id, 'Client A', clientEmail, bcrypt.hashSync(clientPw, 8), 'client']);
      console.log('Seeded client ->', { email: clientEmail, password: clientPw, id });
    }
  }
}

initDb().catch(err => { console.error('DB init error', err); process.exit(1); });

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// email helpers (Ethereal fallback for local dev)
let transporter = null;
async function ensureTransporter() {
  if (transporter) return transporter;
  if (process.env.EMAIL_HOST) {
    transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: Number(process.env.EMAIL_PORT) || 587,
      auth: process.env.EMAIL_USER ? { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } : undefined,
    });
    return transporter;
  }
  const testAccount = await nodemailer.createTestAccount();
  transporter = nodemailer.createTransport({
    host: testAccount.smtp.host,
    port: testAccount.smtp.port,
    secure: testAccount.smtp.secure,
    auth: { user: testAccount.user, pass: testAccount.pass }
  });
  console.log('Using Ethereal account for email preview:', testAccount.user);
  return transporter;
}

async function sendEmail(to, subject, text, html) {
  try {
    const t = await ensureTransporter();
    const info = await t.sendMail({ from: 'no-reply@megaconstruct.co.uk', to, subject, text, html });
    if (nodemailer.getTestMessageUrl && info) {
      console.log('Preview URL:', nodemailer.getTestMessageUrl(info));
    }
    return info;
  } catch (e) {
    console.error('Email send error', e);
  }
}

async function sendOwnerNotification(timesheet) {
  const owner = process.env.OWNER_EMAIL || 'tsvet.spasov';
  if (!owner) return;
  await sendEmail(owner, `Timesheet approved: ${timesheet.id}`, `Timesheet ${timesheet.id} has been approved.`);
}

function generateToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}

function makeResetToken() {
  return crypto.randomBytes(24).toString('hex');
}

async function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Missing auth' });
  const token = auth.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (useSqlite) {
      const row = sqliteDb.prepare('SELECT id,name,email,role FROM users WHERE id = ?').get(payload.id);
      if (!row) return res.status(401).json({ error: 'Invalid user' });
      req.user = row;
    } else {
      const userRes = await pool.query('SELECT id,name,email,role FROM users WHERE id=$1', [payload.id]);
      if (userRes.rowCount === 0) return res.status(401).json({ error: 'Invalid user' });
      req.user = userRes.rows[0];
    }
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// routes
// Disable public register: only owner may create users via /api/users
app.post('/api/register', async (req, res) => {
  return res.status(403).json({ error: 'Public registration is disabled. Owner must create users.' });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    let user;
    if (useSqlite) {
      user = sqliteDb.prepare('SELECT id,name,email,password,role FROM users WHERE email = ?').get(email);
    } else {
      const userRes = await pool.query('SELECT id,name,email,password,role FROM users WHERE email=$1', [email]);
      user = userRes.rowCount ? userRes.rows[0] : null;
    }
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });
    const ok = bcrypt.compareSync(password, user.password);
    if (!ok) return res.status(400).json({ error: 'Invalid credentials' });
    res.json({ token: generateToken(user), user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/timesheets', authMiddleware, async (req, res) => {
  if (req.user.role !== 'staff') return res.status(403).json({ error: 'Forbidden' });
  const { date, hours, clientId, notes } = req.body;
  if (!date || !hours || !clientId) return res.status(400).json({ error: 'Missing fields' });
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  try {
    if (useSqlite) {
      sqliteDb.prepare('INSERT INTO timesheets(id,staff_id,client_id,date,hours,notes,status,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id, req.user.id, clientId, date, hours, notes || '', 'submitted', createdAt);
      const clientRow = sqliteDb.prepare('SELECT email FROM users WHERE id = ? AND role = ?').get(clientId, 'client');
  if (clientRow && clientRow.email) sendEmail(clientRow.email, 'Timesheet submitted for your approval', `A timesheet (${id}) has been submitted.`).catch(e=>console.error(e));
      res.json({ id, staffId: req.user.id, date, hours, clientId, notes, status: 'submitted', createdAt });
    } else {
      await pool.query('INSERT INTO timesheets(id,staff_id,client_id,date,hours,notes,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [id, req.user.id, clientId, date, hours, notes || '', 'submitted', createdAt]);
      const clientRes = await pool.query('SELECT email FROM users WHERE id=$1 AND role=$2', [clientId, 'client']);
  if (clientRes.rowCount > 0 && clientRes.rows[0].email) sendEmail(clientRes.rows[0].email, 'Timesheet submitted for your approval', `A timesheet (${id}) has been submitted.`).catch(e=>console.error(e));
      res.json({ id, staffId: req.user.id, date, hours, clientId, notes, status: 'submitted', createdAt });
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Owner can create new users (client or staff)
app.post('/api/users', authMiddleware, async (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Forbidden' });
  const { name, email, password, role, clientId } = req.body;
  if (!name || !email || !password || !role) return res.status(400).json({ error: 'Missing fields' });
  if (!['staff','client'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  try {
    // If user exists, return it (idempotent)
    if (useSqlite) {
      const existing = sqliteDb.prepare('SELECT id,name,email,role FROM users WHERE email = ?').get(email);
      if (existing) return res.json(existing);
      const hashed = bcrypt.hashSync(password, 8);
      const id = crypto.randomUUID();
  sqliteDb.prepare('INSERT INTO users(id,name,email,password,role,client_id) VALUES(?,?,?,?,?,?)').run(id, name, email, hashed, role, clientId || null);
      // send invitation email
      await sendEmail(email, 'You have been invited to Mega Construct', `Hello ${name},\n\nAn account was created for you. Email: ${email}\nPlease use the password provided by the owner to login. You can reset your password if needed.`);
      return res.json({ id, name, email, role });
    } else {
      const existingRes = await pool.query('SELECT id,name,email,role FROM users WHERE email=$1', [email]);
      if (existingRes.rowCount > 0) return res.json(existingRes.rows[0]);
      const hashed = bcrypt.hashSync(password, 8);
      const id = crypto.randomUUID();
  await pool.query('INSERT INTO users(id,name,email,password,role,client_id) VALUES($1,$2,$3,$4,$5,$6)', [id, name, email, hashed, role, clientId || null]);
      await sendEmail(email, 'You have been invited to Mega Construct', `Hello ${name},\n\nAn account was created for you. Email: ${email}\nPlease use the password provided by the owner to login. You can reset your password if needed.`);
      return res.json({ id, name, email, role });
    }
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: 'Could not create user (maybe email exists)' });
  }
});

// Owner: list users
app.get('/api/users', authMiddleware, async (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Forbidden' });
  try {
    if (useSqlite) {
      const rows = sqliteDb.prepare('SELECT id,name,email,role,client_id FROM users').all();
      return res.json(rows);
    }
    const r = await pool.query('SELECT id,name,email,role,client_id FROM users');
    res.json(r.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// current user info
app.get('/api/me', authMiddleware, async (req, res) => {
  try {
    if (useSqlite) {
      const u = sqliteDb.prepare('SELECT id,name,email,role,client_id FROM users WHERE id = ?').get(req.user.id);
      return res.json(u);
    }
    const r = await pool.query('SELECT id,name,email,role,client_id FROM users WHERE id=$1', [req.user.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Owner: delete a user (and send deletion email)
app.delete('/api/users/:id', authMiddleware, async (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Forbidden' });
  const id = req.params.id;
  try {
    // Protect owner deletion
    let userRow;
    if (useSqlite) userRow = sqliteDb.prepare('SELECT id,name,email,role FROM users WHERE id = ?').get(id);
    else {
      const r = await pool.query('SELECT id,name,email,role FROM users WHERE id=$1', [id]);
      userRow = r.rowCount ? r.rows[0] : null;
    }
    if (!userRow) return res.status(404).json({ error: 'Not found' });
    if (userRow.role === 'owner') return res.status(400).json({ error: 'Cannot delete owner' });

    // Check timesheets belonging to or approved by this user
    let timesheets = [];
    if (useSqlite) {
      timesheets = sqliteDb.prepare('SELECT * FROM timesheets WHERE staff_id = ? OR client_id = ?').all(id, id);
    } else {
      const ts = await pool.query('SELECT * FROM timesheets WHERE staff_id=$1 OR client_id=$1', [id]);
      timesheets = ts.rows;
    }
    const force = req.query.force === 'true';
    if (timesheets.length > 0 && !force) {
      // return timesheets so owner can review before deleting
      return res.status(409).json({ error: 'User has timesheets', timesheets });
    }

    // proceed to delete (force or no timesheets)
    if (useSqlite) sqliteDb.prepare('DELETE FROM users WHERE id = ?').run(id);
    else await pool.query('DELETE FROM users WHERE id=$1', [id]);
    if (userRow && userRow.email) await sendEmail(userRow.email, 'Account deleted at Mega Construct', `Hello ${userRow.name || ''},\n\nYour account has been deleted by the owner.`);
    res.json({ ok: true, deleted: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Owner: view timesheets for a given user id (either staff submissions or client approvals)
app.get('/api/users/:id/timesheets', authMiddleware, async (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Forbidden' });
  const id = req.params.id;
  try {
    if (useSqlite) {
      const rows = sqliteDb.prepare('SELECT * FROM timesheets WHERE staff_id = ? OR client_id = ? ORDER BY COALESCE(approved_at, created_at) DESC').all(id, id);
      return res.json(rows);
    }
    const r = await pool.query('SELECT * FROM timesheets WHERE staff_id=$1 OR client_id=$1 ORDER BY COALESCE(approved_at, created_at) DESC', [id]);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Owner: delete a specific timesheet
app.delete('/api/timesheets/:id', authMiddleware, async (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Forbidden' });
  const id = req.params.id;
  try {
    if (useSqlite) {
      sqliteDb.prepare('DELETE FROM timesheets WHERE id = ?').run(id);
    } else {
      await pool.query('DELETE FROM timesheets WHERE id=$1', [id]);
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Owner: clear all timesheets
app.delete('/api/timesheets', authMiddleware, async (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Forbidden' });
  try {
    if (useSqlite) sqliteDb.prepare('DELETE FROM timesheets').run(); else await pool.query('DELETE FROM timesheets');
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// When users change password via reset confirm, send confirmation email
const origPasswordConfirm = null;
// We already have /api/password-reset/confirm above; we'll wrap the logic by adding an email send after password update inside that route (no extra route needed). 

// Password reset: request token
app.post('/api/password-reset/request', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Missing email' });
  try {
    let user;
    if (useSqlite) user = sqliteDb.prepare('SELECT id,email FROM users WHERE email = ?').get(email);
    else {
      const r = await pool.query('SELECT id,email FROM users WHERE email=$1', [email]);
      user = r.rowCount ? r.rows[0] : null;
    }
    if (!user) return res.status(400).json({ error: 'No such user' });
    const token = makeResetToken();
    const id = crypto.randomUUID();
    const expires = new Date(Date.now() + 1000 * 60 * 60).toISOString();
    if (useSqlite) sqliteDb.prepare('INSERT INTO password_resets(id,user_id,token,expires_at,used) VALUES(?,?,?,?,?)').run(id, user.id, token, expires, 0);
    else await pool.query('INSERT INTO password_resets(id,user_id,token,expires_at,used) VALUES($1,$2,$3,$4,$5)', [id, user.id, token, expires, false]);
    const resetLink = `${req.protocol}://${req.get('host')}/reset.html?token=${token}`;
    await sendEmail(email, 'Password reset for Mega Construct', `Click to reset: ${resetLink}`);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Password reset: confirm token & set
app.post('/api/password-reset/confirm', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Missing fields' });
  try {
    let row;
    if (useSqlite) row = sqliteDb.prepare('SELECT id,user_id,token,expires_at,used FROM password_resets WHERE token = ?').get(token);
    else {
      const r = await pool.query('SELECT id,user_id,token,expires_at,used FROM password_resets WHERE token=$1', [token]);
      row = r.rowCount ? r.rows[0] : null;
    }
    if (!row) return res.status(400).json({ error: 'Invalid token' });
    if (row.used) return res.status(400).json({ error: 'Token used' });
    if (new Date(row.expires_at) < new Date()) return res.status(400).json({ error: 'Expired' });
    const hashed = bcrypt.hashSync(password, 8);
    if (useSqlite) {
      sqliteDb.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, row.user_id);
      sqliteDb.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(row.id);
      const u = sqliteDb.prepare('SELECT email,name FROM users WHERE id = ?').get(row.user_id);
      if (u && u.email) await sendEmail(u.email, 'Your password was changed', `Hello ${u.name || ''},\n\nYour account password has been updated.`);
    } else {
      await pool.query('UPDATE users SET password=$1 WHERE id=$2', [hashed, row.user_id]);
      await pool.query('UPDATE password_resets SET used = true WHERE id=$1', [row.id]);
      const ur = await pool.query('SELECT email,name FROM users WHERE id=$1', [row.user_id]);
      if (ur.rowCount > 0 && ur.rows[0].email) await sendEmail(ur.rows[0].email, 'Your password was changed', `Hello ${ur.rows[0].name || ''},\n\nYour account password has been updated.`);
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/timesheets/pending', authMiddleware, async (req, res) => {
  if (req.user.role !== 'client') return res.status(403).json({ error: 'Forbidden' });
  try {
    if (useSqlite) {
      const rows = sqliteDb.prepare('SELECT * FROM timesheets WHERE client_id = ? AND status = ?').all(req.user.id, 'submitted');
      const users = {};
      sqliteDb.prepare('SELECT id,name,email FROM users').all().forEach(u => { users[u.id] = u; users[String(u.id)] = u; });
      const out = rows.map(r => ({ ...r, staff_name: (users[r.staff_id] && users[r.staff_id].name) || null, staff_email: (users[r.staff_id] && users[r.staff_id].email) || null }));
      return res.json(out);
    }
    const q = `SELECT t.*, u.name as staff_name, u.email as staff_email FROM timesheets t LEFT JOIN users u ON u.id = t.staff_id WHERE t.client_id=$1 AND t.status=$2`;
    const r = await pool.query(q, [req.user.id, 'submitted']);
    res.json(r.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Staff: their timesheets (history)
app.get('/api/timesheets/staff', authMiddleware, async (req, res) => {
  if (req.user.role !== 'staff') return res.status(403).json({ error: 'Forbidden' });
  try {
    if (useSqlite) {
      const rows = sqliteDb.prepare('SELECT * FROM timesheets WHERE staff_id = ? ORDER BY created_at DESC').all(req.user.id);
      return res.json(rows);
    }
    const r = await pool.query('SELECT * FROM timesheets WHERE staff_id=$1 ORDER BY created_at DESC', [req.user.id]);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Staff: their pending submissions
app.get('/api/timesheets/staff/pending', authMiddleware, async (req, res) => {
  if (req.user.role !== 'staff') return res.status(403).json({ error: 'Forbidden' });
  try {
    if (useSqlite) {
      const rows = sqliteDb.prepare('SELECT * FROM timesheets WHERE staff_id = ? AND status = ? ORDER BY created_at DESC').all(req.user.id, 'submitted');
      return res.json(rows);
    }
    const r = await pool.query('SELECT * FROM timesheets WHERE staff_id=$1 AND status=$2 ORDER BY created_at DESC', [req.user.id, 'submitted']);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Client: approved history (client-side view)
app.get('/api/timesheets/client/history', authMiddleware, async (req, res) => {
  if (req.user.role !== 'client') return res.status(403).json({ error: 'Forbidden' });
  try {
    if (useSqlite) {
      const rows = sqliteDb.prepare('SELECT * FROM timesheets WHERE client_id = ? AND status = ? ORDER BY approved_at DESC').all(req.user.id, 'approved');
      const users = {};
      sqliteDb.prepare('SELECT id,name,email FROM users').all().forEach(u => { users[u.id] = u; users[String(u.id)] = u; });
      const out = rows.map(r => ({ ...r, staff_name: (users[r.staff_id] && users[r.staff_id].name) || null, staff_email: (users[r.staff_id] && users[r.staff_id].email) || null }));
      return res.json(out);
    }
    const q = `SELECT t.*, u.name as staff_name, u.email as staff_email FROM timesheets t LEFT JOIN users u ON u.id = t.staff_id WHERE t.client_id=$1 AND t.status=$2 ORDER BY t.approved_at DESC`;
    const r = await pool.query(q, [req.user.id, 'approved']);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Owner: pending submissions
app.get('/api/timesheets/owner/pending', authMiddleware, async (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Forbidden' });
  try {
    if (useSqlite) {
      const rows = sqliteDb.prepare('SELECT * FROM timesheets WHERE status = ? ORDER BY created_at DESC').all('submitted');
      return res.json(rows);
    }
    const r = await pool.query('SELECT * FROM timesheets WHERE status=$1 ORDER BY created_at DESC', ['submitted']);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Owner: full history (all timesheets)
app.get('/api/timesheets/owner/history', authMiddleware, async (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Forbidden' });
  try {
    if (useSqlite) {
      const rows = sqliteDb.prepare('SELECT * FROM timesheets ORDER BY COALESCE(approved_at, created_at) DESC').all();
      return res.json(rows);
    }
    const r = await pool.query('SELECT * FROM timesheets ORDER BY COALESCE(approved_at, created_at) DESC');
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Clients list for staff selection
app.get('/api/clients', authMiddleware, async (req, res) => {
  if (!['staff','owner','client'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  try {
    if (useSqlite) {
      const rows = sqliteDb.prepare("SELECT id,name,email FROM users WHERE role = 'client'").all();
      return res.json(rows);
    }
    const r = await pool.query("SELECT id,name,email FROM users WHERE role = 'client'");
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Staff list (for owner modal reassign)
app.get('/api/staffs', authMiddleware, async (req, res) => {
  if (!['owner','staff'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  try {
    if (useSqlite) {
      const rows = sqliteDb.prepare("SELECT id,name,email FROM users WHERE role = 'staff'").all();
      return res.json(rows);
    }
    const r = await pool.query("SELECT id,name,email FROM users WHERE role = 'staff'");
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Reassign a timesheet to another staff (owner only)
app.post('/api/timesheets/:id/reassign', authMiddleware, async (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Forbidden' });
  const id = req.params.id;
  const { toStaffId } = req.body;
  if (!toStaffId) return res.status(400).json({ error: 'Missing toStaffId' });
  try {
    if (useSqlite) {
      const ts = sqliteDb.prepare('SELECT * FROM timesheets WHERE id = ?').get(id);
      if (!ts) return res.status(404).json({ error: 'Timesheet not found' });
      sqliteDb.prepare('UPDATE timesheets SET staff_id = ? WHERE id = ?').run(toStaffId, id);
      const updated = sqliteDb.prepare('SELECT * FROM timesheets WHERE id = ?').get(id);
      return res.json(updated);
    }
    const tsr = await pool.query('SELECT * FROM timesheets WHERE id=$1', [id]);
    if (tsr.rowCount === 0) return res.status(404).json({ error: 'Timesheet not found' });
    await pool.query('UPDATE timesheets SET staff_id=$1 WHERE id=$2', [toStaffId, id]);
    const updated = await pool.query('SELECT * FROM timesheets WHERE id=$1', [id]);
    res.json(updated.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Archive a timesheet (owner only) - marks status as 'archived'
app.post('/api/timesheets/:id/archive', authMiddleware, async (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Forbidden' });
  const id = req.params.id;
  try {
    if (useSqlite) {
      const ts = sqliteDb.prepare('SELECT * FROM timesheets WHERE id = ?').get(id);
      if (!ts) return res.status(404).json({ error: 'Timesheet not found' });
      sqliteDb.prepare('UPDATE timesheets SET status = ? WHERE id = ?').run('archived', id);
      const updated = sqliteDb.prepare('SELECT * FROM timesheets WHERE id = ?').get(id);
      return res.json(updated);
    }
    const tsr = await pool.query('SELECT * FROM timesheets WHERE id=$1', [id]);
    if (tsr.rowCount === 0) return res.status(404).json({ error: 'Timesheet not found' });
    await pool.query('UPDATE timesheets SET status=$1 WHERE id=$2', ['archived', id]);
    const updated = await pool.query('SELECT * FROM timesheets WHERE id=$1', [id]);
    res.json(updated.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/timesheets/:id/approve', authMiddleware, async (req, res) => {
  if (req.user.role !== 'client') return res.status(403).json({ error: 'Forbidden' });
  const id = req.params.id;
  try {
    if (useSqlite) {
      const ts = sqliteDb.prepare('SELECT * FROM timesheets WHERE id = ? AND client_id = ?').get(id, req.user.id);
      if (!ts) return res.status(404).json({ error: 'Timesheet not found' });
      const approvedAt = new Date().toISOString();
      sqliteDb.prepare('UPDATE timesheets SET status = ?, approved_at = ? WHERE id = ?').run('approved', approvedAt, id);
      const updated = sqliteDb.prepare('SELECT * FROM timesheets WHERE id = ?').get(id);
      sendOwnerNotification(updated);
      return res.json(updated);
    }
    const tsRes = await pool.query('SELECT * FROM timesheets WHERE id=$1 AND client_id=$2', [id, req.user.id]);
    if (tsRes.rowCount === 0) return res.status(404).json({ error: 'Timesheet not found' });
    const approvedAt = new Date().toISOString();
    await pool.query('UPDATE timesheets SET status=$1, approved_at=$2 WHERE id=$3', ['approved', approvedAt, id]);
    const updated = await pool.query('SELECT * FROM timesheets WHERE id=$1', [id]);
    sendOwnerNotification(updated.rows[0]);
    res.json(updated.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/timesheets/approved', authMiddleware, async (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Forbidden' });
  try {
    if (useSqlite) {
      const rows = sqliteDb.prepare('SELECT * FROM timesheets WHERE status = ?').all('approved');
      return res.json(rows);
    }
    const r = await pool.query('SELECT * FROM timesheets WHERE status=$1', ['approved']);
    res.json(r.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/timesheets', authMiddleware, async (req, res) => {
  try {
    if (useSqlite) {
      const rows = sqliteDb.prepare('SELECT * FROM timesheets').all();
      return res.json(rows);
    }
    const r = await pool.query('SELECT * FROM timesheets');
    res.json(r.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));


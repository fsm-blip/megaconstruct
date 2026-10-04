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
let Database = null;
require('dotenv').config();

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

if (!process.env.JWT_SECRET && NODE_ENV === 'production') {
  console.error('JWT_SECRET is required in production. Refusing to start.');
  process.exit(1);
}
if (!process.env.JWT_SECRET) {
  console.warn('JWT_SECRET is not set; using an ephemeral development secret for this process. Set JWT_SECRET in backend/.env for stable local sessions.');
}
if (!DATABASE_URL && NODE_ENV === 'production') {
  console.error('DATABASE_URL is required in production. Refusing to start.');
  process.exit(1);
}

let useSqlite = false;
let pool = null;
let sqliteDb = null;

async function initDb() {
  if (DATABASE_URL) {
    try {
      const poolConfig = { connectionString: DATABASE_URL };
      if (NODE_ENV === 'production' || /supabase\.co/i.test(DATABASE_URL)) {
        poolConfig.ssl = { rejectUnauthorized: false };
      }
      pool = new Pool(poolConfig);
      await pool.query('SELECT 1');
      console.log('Connected to Postgres via DATABASE_URL');
    } catch (e) {
      console.warn('Postgres connection failed, falling back to SQLite:', e.message);
      useSqlite = true;
    }
  } else {
    console.log('DATABASE_URL is not set; using local SQLite fallback.');
    useSqlite = true;
  }

  if (useSqlite) {
    if (!Database) Database = require('better-sqlite3');
    sqliteDb = new Database(path.join(__dirname, 'megaconstruct.sqlite'));
    sqliteDb.pragma('journal_mode = WAL');
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL,
        joined_at TEXT
      );
      CREATE TABLE IF NOT EXISTS timesheets (
        id TEXT PRIMARY KEY,
        staff_id TEXT,
        client_id TEXT,
        date TEXT,
        hours REAL,
        overtime_week_hours REAL DEFAULT 0,
        overtime_weekend_hours REAL DEFAULT 0,
        overtime_bank_holiday_hours REAL DEFAULT 0,
        notes TEXT,
        status TEXT,
        created_at TEXT,
        approved_at TEXT,
        period_start TEXT,
        period_end TEXT,
        submitted_at TEXT,
        returned_at TEXT,
        return_reason TEXT,
        invoiced_at TEXT,
        updated_at TEXT,
        pricing_model TEXT,
        day_rate REAL DEFAULT 495,
        shift_payload TEXT,
        shift_count REAL DEFAULT 0,
        calculated_amount REAL DEFAULT 0,
        consultant_fee_amount REAL DEFAULT 0,
        interim_amount REAL DEFAULT 0,
        vat_amount REAL DEFAULT 0,
        invoice_amount REAL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS timesheet_entries (
        id TEXT PRIMARY KEY,
        timesheet_id TEXT NOT NULL,
        work_date TEXT NOT NULL,
        hours REAL NOT NULL,
        break_minutes INTEGER DEFAULT 0,
        start_time TEXT,
        end_time TEXT,
        site_name TEXT,
        job_role TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(timesheet_id, work_date, notes)
      );
      CREATE TABLE IF NOT EXISTS timesheet_events (
        id TEXT PRIMARY KEY,
        timesheet_id TEXT NOT NULL,
        actor_id TEXT,
        event_type TEXT NOT NULL,
        from_status TEXT,
        to_status TEXT,
        comment TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS password_resets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        invoice_number TEXT UNIQUE NOT NULL,
        client_id TEXT NOT NULL,
        period_type TEXT NOT NULL,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        total_hours REAL NOT NULL,
        hourly_rate REAL NOT NULL,
        total_amount REAL NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        issued_at TEXT
      );
      CREATE TABLE IF NOT EXISTS invoice_lines (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL,
        timesheet_id TEXT NOT NULL UNIQUE,
        staff_id TEXT,
        work_date TEXT NOT NULL,
        hours REAL NOT NULL,
        hourly_rate REAL NOT NULL,
        overtime_week_hours REAL DEFAULT 0,
        overtime_week_rate REAL DEFAULT 0,
        overtime_weekend_hours REAL DEFAULT 0,
        overtime_weekend_rate REAL DEFAULT 0,
        overtime_bank_holiday_hours REAL DEFAULT 0,
        overtime_bank_holiday_rate REAL DEFAULT 0,
        line_amount REAL NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL
      );
    `);
    // add client_id column to users if missing
    try {
      sqliteDb.prepare("ALTER TABLE users ADD COLUMN client_id TEXT").run();
    } catch (e) {
      // ignore if column exists
    }
    try {
      sqliteDb.prepare("ALTER TABLE users ADD COLUMN joined_at TEXT").run();
    } catch (e) {
      // ignore if column exists
    }
    sqliteDb.prepare("UPDATE users SET joined_at = COALESCE(joined_at, ?)").run(new Date().toISOString());
    const sqliteTimesheetColumns = [
      ['invoice_id', 'TEXT'],
      ['overtime_week_hours', 'REAL DEFAULT 0'],
      ['overtime_weekend_hours', 'REAL DEFAULT 0'],
      ['overtime_bank_holiday_hours', 'REAL DEFAULT 0'],
      ['period_start', 'TEXT'],
      ['period_end', 'TEXT'],
      ['submitted_at', 'TEXT'],
      ['returned_at', 'TEXT'],
      ['return_reason', 'TEXT'],
      ['invoiced_at', 'TEXT'],
      ['updated_at', 'TEXT'],
      ['pricing_model', 'TEXT'],
      ['day_rate', 'REAL DEFAULT 495'],
      ['shift_payload', 'TEXT'],
      ['shift_count', 'REAL DEFAULT 0'],
      ['calculated_amount', 'REAL DEFAULT 0'],
      ['consultant_fee_amount', 'REAL DEFAULT 0'],
      ['interim_amount', 'REAL DEFAULT 0'],
      ['vat_amount', 'REAL DEFAULT 0'],
      ['invoice_amount', 'REAL DEFAULT 0']
    ];
    sqliteTimesheetColumns.forEach(([column, type]) => {
      try {
        sqliteDb.prepare(`ALTER TABLE timesheets ADD COLUMN ${column} ${type}`).run();
      } catch (e) {
        // ignore if column exists
      }
    });
    const sqliteInvoiceLineColumns = [
      ['overtime_week_hours', 'REAL DEFAULT 0'],
      ['overtime_week_rate', 'REAL DEFAULT 0'],
      ['overtime_weekend_hours', 'REAL DEFAULT 0'],
      ['overtime_weekend_rate', 'REAL DEFAULT 0'],
      ['overtime_bank_holiday_hours', 'REAL DEFAULT 0'],
      ['overtime_bank_holiday_rate', 'REAL DEFAULT 0']
    ];
    sqliteInvoiceLineColumns.forEach(([column, type]) => {
      try { sqliteDb.prepare(`ALTER TABLE invoice_lines ADD COLUMN ${column} ${type}`).run(); } catch (e) {}
    });
    sqliteDb.exec(`
      CREATE INDEX IF NOT EXISTS idx_timesheets_staff_status ON timesheets(staff_id, status);
      CREATE INDEX IF NOT EXISTS idx_timesheets_client_status ON timesheets(client_id, status);
      CREATE INDEX IF NOT EXISTS idx_timesheets_period ON timesheets(period_start, period_end);
      CREATE INDEX IF NOT EXISTS idx_timesheets_invoice ON timesheets(invoice_id);
      CREATE INDEX IF NOT EXISTS idx_timesheet_entries_parent ON timesheet_entries(timesheet_id);
      CREATE INDEX IF NOT EXISTS idx_timesheet_events_parent ON timesheet_events(timesheet_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines(invoice_id);
    `);
  } else {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id text PRIMARY KEY,
        name text NOT NULL,
        email text UNIQUE NOT NULL,
        password text NOT NULL,
        role text NOT NULL,
        joined_at timestamptz
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS timesheets (
        id text PRIMARY KEY,
        staff_id text REFERENCES users(id),
        client_id text REFERENCES users(id),
        date date,
        hours numeric,
        overtime_week_hours numeric DEFAULT 0,
        overtime_weekend_hours numeric DEFAULT 0,
        overtime_bank_holiday_hours numeric DEFAULT 0,
        notes text,
        status text,
        created_at timestamptz,
        approved_at timestamptz,
        period_start date,
        period_end date,
        submitted_at timestamptz,
        returned_at timestamptz,
        return_reason text,
        invoiced_at timestamptz,
        updated_at timestamptz,
        pricing_model text,
        day_rate numeric DEFAULT 495,
        shift_payload text,
        shift_count numeric DEFAULT 0,
        calculated_amount numeric DEFAULT 0,
        consultant_fee_amount numeric DEFAULT 0,
        interim_amount numeric DEFAULT 0,
        vat_amount numeric DEFAULT 0,
        invoice_amount numeric DEFAULT 0
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS timesheet_entries (
        id text PRIMARY KEY,
        timesheet_id text NOT NULL REFERENCES timesheets(id) ON DELETE CASCADE,
        work_date date NOT NULL,
        hours numeric NOT NULL,
        break_minutes integer DEFAULT 0,
        start_time text,
        end_time text,
        site_name text,
        job_role text,
        notes text,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        UNIQUE(timesheet_id, work_date, notes)
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS timesheet_events (
        id text PRIMARY KEY,
        timesheet_id text NOT NULL REFERENCES timesheets(id) ON DELETE CASCADE,
        actor_id text REFERENCES users(id),
        event_type text NOT NULL,
        from_status text,
        to_status text,
        comment text,
        created_at timestamptz NOT NULL
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
    await pool.query(`
      CREATE TABLE IF NOT EXISTS invoices (
        id text PRIMARY KEY,
        invoice_number text UNIQUE NOT NULL,
        client_id text NOT NULL REFERENCES users(id),
        period_type text NOT NULL,
        period_start date NOT NULL,
        period_end date NOT NULL,
        total_hours numeric NOT NULL,
        hourly_rate numeric NOT NULL,
        total_amount numeric NOT NULL,
        status text NOT NULL,
        created_at timestamptz NOT NULL,
        issued_at timestamptz
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS invoice_lines (
        id text PRIMARY KEY,
        invoice_id text NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        timesheet_id text NOT NULL UNIQUE REFERENCES timesheets(id),
        staff_id text REFERENCES users(id),
        work_date date NOT NULL,
        hours numeric NOT NULL,
        hourly_rate numeric NOT NULL,
        overtime_week_hours numeric DEFAULT 0,
        overtime_week_rate numeric DEFAULT 0,
        overtime_weekend_hours numeric DEFAULT 0,
        overtime_weekend_rate numeric DEFAULT 0,
        overtime_bank_holiday_hours numeric DEFAULT 0,
        overtime_bank_holiday_rate numeric DEFAULT 0,
        line_amount numeric NOT NULL,
        notes text,
        created_at timestamptz NOT NULL
      );
    `);
    // ensure client_id column exists
    try {
      await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS client_id text");
      await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS joined_at timestamptz");
      await pool.query(`
        UPDATE users u
        SET joined_at = COALESCE(u.joined_at, first_seen.first_at, NOW())
        FROM (
          SELECT u2.id, MIN(t.created_at)::timestamptz AS first_at
          FROM users u2
          LEFT JOIN timesheets t ON t.staff_id = u2.id OR t.client_id = u2.id
          GROUP BY u2.id
        ) first_seen
        WHERE u.id = first_seen.id AND u.joined_at IS NULL
      `);
    } catch (e) { /* ignore */ }
    try {
      await pool.query("ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS invoice_id text REFERENCES invoices(id)");
      await pool.query("ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS overtime_week_hours numeric DEFAULT 0");
      await pool.query("ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS overtime_weekend_hours numeric DEFAULT 0");
      await pool.query("ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS overtime_bank_holiday_hours numeric DEFAULT 0");
      await pool.query("ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS period_start date");
      await pool.query("ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS period_end date");
      await pool.query("ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS submitted_at timestamptz");
      await pool.query("ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS returned_at timestamptz");
      await pool.query("ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS return_reason text");
      await pool.query("ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS invoiced_at timestamptz");
      await pool.query("ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS updated_at timestamptz");
      await pool.query("ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS pricing_model text");
      await pool.query("ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS day_rate numeric DEFAULT 495");
      await pool.query("ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS shift_payload text");
      await pool.query("ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS shift_count numeric DEFAULT 0");
      await pool.query("ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS calculated_amount numeric DEFAULT 0");
      await pool.query("ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS consultant_fee_amount numeric DEFAULT 0");
      await pool.query("ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS interim_amount numeric DEFAULT 0");
      await pool.query("ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS vat_amount numeric DEFAULT 0");
      await pool.query("ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS invoice_amount numeric DEFAULT 0");
      await pool.query("ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS overtime_week_hours numeric DEFAULT 0");
      await pool.query("ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS overtime_week_rate numeric DEFAULT 0");
      await pool.query("ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS overtime_weekend_hours numeric DEFAULT 0");
      await pool.query("ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS overtime_weekend_rate numeric DEFAULT 0");
      await pool.query("ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS overtime_bank_holiday_hours numeric DEFAULT 0");
      await pool.query("ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS overtime_bank_holiday_rate numeric DEFAULT 0");
      await pool.query("CREATE INDEX IF NOT EXISTS idx_timesheets_staff_status ON timesheets(staff_id, status)");
      await pool.query("CREATE INDEX IF NOT EXISTS idx_timesheets_client_status ON timesheets(client_id, status)");
      await pool.query("CREATE INDEX IF NOT EXISTS idx_timesheets_period ON timesheets(period_start, period_end)");
      await pool.query("CREATE INDEX IF NOT EXISTS idx_timesheets_invoice ON timesheets(invoice_id)");
      await pool.query("CREATE INDEX IF NOT EXISTS idx_timesheet_entries_parent ON timesheet_entries(timesheet_id)");
      await pool.query("CREATE INDEX IF NOT EXISTS idx_timesheet_events_parent ON timesheet_events(timesheet_id, created_at)");
      await pool.query("CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines(invoice_id)");
    } catch (e) { /* ignore */ }
  }

  await backfillTimesheetDomain();

  // seed owner and client if missing (owner credentials requested)
  const ownerEmail = process.env.OWNER_EMAIL || 'owner@example.com';
  const ownerPw = process.env.OWNER_PASSWORD || crypto.randomBytes(18).toString('hex');
  const clientEmail = process.env.SEED_CLIENT_EMAIL || 'client@example.com';
  const clientPw = process.env.SEED_CLIENT_PASSWORD || crypto.randomBytes(18).toString('hex');

  if (useSqlite) {
    const row = sqliteDb.prepare('SELECT id FROM users WHERE role = ? LIMIT 1').get('owner');
    if (!row) {
  const id = crypto.randomUUID();
      sqliteDb.prepare('INSERT INTO users(id,name,email,password,role,joined_at) VALUES(?,?,?,?,?,?)').run(id, 'Owner', ownerEmail, bcrypt.hashSync(ownerPw, 8), 'owner', new Date().toISOString());
      console.log('Seeded owner ->', { email: ownerEmail, id });
    }
    const crow = sqliteDb.prepare('SELECT id FROM users WHERE role = ? LIMIT 1').get('client');
    if (!crow) {
  const id = crypto.randomUUID();
      sqliteDb.prepare('INSERT INTO users(id,name,email,password,role,joined_at) VALUES(?,?,?,?,?,?)').run(id, 'Client A', clientEmail, bcrypt.hashSync(clientPw, 8), 'client', new Date().toISOString());
      console.log('Seeded client ->', { email: clientEmail, id });
    }
  } else {
    const ownerRes = await pool.query('SELECT id FROM users WHERE role=$1 LIMIT 1', ['owner']);
    if (ownerRes.rowCount === 0) {
      const id = crypto.randomUUID();
      await pool.query('INSERT INTO users(id,name,email,password,role,joined_at) VALUES($1,$2,$3,$4,$5,$6)', [id, 'Owner', ownerEmail, bcrypt.hashSync(ownerPw, 8), 'owner', new Date().toISOString()]);
      console.log('Seeded owner ->', { email: ownerEmail, id });
    }
    const clientRes = await pool.query('SELECT id FROM users WHERE role=$1 LIMIT 1', ['client']);
    if (clientRes.rowCount === 0) {
      const id = crypto.randomUUID();
      await pool.query('INSERT INTO users(id,name,email,password,role,joined_at) VALUES($1,$2,$3,$4,$5,$6)', [id, 'Client A', clientEmail, bcrypt.hashSync(clientPw, 8), 'client', new Date().toISOString()]);
      console.log('Seeded client ->', { email: clientEmail, id });
    }
  }
}

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

function normalizeDateOnly(value) {
  if (!value) return null;
  const raw = String(value).trim();

  // Native <input type="date"> values and API callers should use ISO yyyy-mm-dd.
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return raw;

  // The current React staff form is a plain text input, so users commonly type dd/mm/yyyy.
  const uk = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (uk) {
    const day = Number(uk[1]);
    const month = Number(uk[2]);
    const year = Number(uk[3]);
    const d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day) {
      return d.toISOString().slice(0, 10);
    }
    return null;
  }

  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function invoiceNumber(periodType) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `MC-${periodType.toUpperCase().slice(0, 1)}-${stamp}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

function toMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function nonNegativeNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

function overtimeFromBody(body = {}) {
  return {
    overtimeWeekHours: nonNegativeNumber(body.overtimeWeekHours ?? body.overtime_week_hours),
    overtimeWeekendHours: nonNegativeNumber(body.overtimeWeekendHours ?? body.overtime_weekend_hours),
    overtimeBankHolidayHours: nonNegativeNumber(body.overtimeBankHolidayHours ?? body.overtime_bank_holiday_hours)
  };
}

function overtimeFromRow(row = {}) {
  return {
    overtimeWeekHours: Number(row.overtime_week_hours || row.overtimeWeekHours || 0),
    overtimeWeekendHours: Number(row.overtime_weekend_hours || row.overtimeWeekendHours || 0),
    overtimeBankHolidayHours: Number(row.overtime_bank_holiday_hours || row.overtimeBankHolidayHours || 0)
  };
}

function timesheetPeriodForDate(value) {
  const date = normalizeDateOnly(value);
  return { periodStart: date, periodEnd: date };
}

const DEFAULT_DAILY_RATE = 495;
const SHIFT_LABELS = {
  day: 'Day shift',
  night: 'Night shift',
  bank_holiday_day: 'Bank holiday day',
  bank_holiday_night: 'Bank holiday night'
};
function addIsoDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function weekPeriodForDate(value) {
  const date = normalizeDateOnly(value);
  return { periodStart: date, periodEnd: date ? addIsoDays(date, 6) : null };
}
function shiftMultiplier(workDate, shiftType) {
  const type = String(shiftType || '').trim();
  if (!type) return 0;
  if (type === 'bank_holiday_day' || type === 'bank_holiday_night') return 2;
  const d = new Date(`${workDate}T00:00:00Z`);
  const day = d.getUTCDay();
  if (day === 0) return 2;
  if (day === 6) return type === 'night' ? 2 : 1.5;
  return type === 'night' ? 1.5 : 1;
}
function readWeeklyTimesheet(body = {}) {
  const weekStart = normalizeDateOnly(body.weekStart || body.periodStart || body.date);
  const dayRate = Number(body.dayRate || body.day_rate || DEFAULT_DAILY_RATE);
  const raw = body.shifts || body.shiftPayload || body.shift_payload || {};
  let parsed = raw;
  if (typeof raw === 'string') { try { parsed = JSON.parse(raw); } catch (_) { parsed = {}; } }
  const days = [];
  if (weekStart) {
    for (let i = 0; i < 7; i += 1) {
      const date = addIsoDays(weekStart, i);
      const shiftType = String(parsed[date] || '').trim();
      if (shiftType) {
        const multiplier = shiftMultiplier(date, shiftType);
        days.push({ date, shiftType, label: SHIFT_LABELS[shiftType] || shiftType, multiplier, amount: toMoney(dayRate * multiplier) });
      }
    }
  }
  const netAmount = toMoney(days.reduce((sum, d) => sum + d.amount, 0));
  const consultantFeeAmount = toMoney(netAmount * 0.10);
  const interimAmount = toMoney(netAmount - consultantFeeAmount);
  const vatAmount = toMoney(netAmount * 0.20);
  const invoiceAmount = toMoney(netAmount + vatAmount);
  return { weekStart, dayRate, days, shiftPayload: JSON.stringify(days), shiftCount: days.length, calculatedAmount: netAmount, consultantFeeAmount, interimAmount, vatAmount, invoiceAmount, periodStart: weekStart, periodEnd: weekStart ? addIsoDays(weekStart, 6) : null };
}
function weeklyShiftSummary(row = {}) {
  const raw = row.shift_payload || row.shiftPayload;
  if (!raw) return '';
  try {
    const days = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(days)) return '';
    return days.map(d => `${d.date}: ${d.label || d.shiftType} x${d.multiplier}`).join('; ');
  } catch (_) { return ''; }
}

function serializeTimesheet(row, entries = []) {
  if (!row) return row;
  return {
    ...row,
    staffId: row.staff_id,
    clientId: row.client_id,
    overtimeWeekHours: Number(row.overtime_week_hours || 0),
    overtimeWeekendHours: Number(row.overtime_weekend_hours || 0),
    overtimeBankHolidayHours: Number(row.overtime_bank_holiday_hours || 0),
    periodStart: normalizeDateOnly(row.period_start || row.date),
    periodEnd: normalizeDateOnly(row.period_end || row.date),
    submittedAt: row.submitted_at || row.created_at || null,
    approvedAt: row.approved_at || null,
    returnedAt: row.returned_at || null,
    returnReason: row.return_reason || null,
    invoicedAt: row.invoiced_at || null,
    updatedAt: row.updated_at || row.created_at || null,
    pricingModel: row.pricing_model || null,
    dayRate: Number(row.day_rate || 0),
    shiftPayload: row.shift_payload || null,
    shiftCount: Number(row.shift_count || 0),
    calculatedAmount: Number(row.calculated_amount || 0),
    consultantFeeAmount: Number(row.consultant_fee_amount || 0),
    interimAmount: Number(row.interim_amount || 0),
    vatAmount: Number(row.vat_amount || 0),
    invoiceAmount: Number(row.invoice_amount || row.calculated_amount || 0),
    shiftSummary: weeklyShiftSummary(row),
    entries
  };
}

async function logTimesheetEvent(timesheetId, actorId, eventType, fromStatus, toStatus, comment = '') {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  if (useSqlite) {
    sqliteDb.prepare('INSERT INTO timesheet_events(id,timesheet_id,actor_id,event_type,from_status,to_status,comment,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(id, timesheetId, actorId || null, eventType, fromStatus || null, toStatus || null, comment || '', createdAt);
    return;
  }
  await pool.query('INSERT INTO timesheet_events(id,timesheet_id,actor_id,event_type,from_status,to_status,comment,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [id, timesheetId, actorId || null, eventType, fromStatus || null, toStatus || null, comment || '', createdAt]);
}

async function createTimesheetEntry(timesheetId, workDate, hours, notes = '', extras = {}) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const breakMinutes = Number(extras.breakMinutes || extras.break_minutes || 0);
  if (useSqlite) {
    sqliteDb.prepare('INSERT INTO timesheet_entries(id,timesheet_id,work_date,hours,break_minutes,start_time,end_time,site_name,job_role,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, timesheetId, workDate, Number(hours), breakMinutes, extras.startTime || extras.start_time || null, extras.endTime || extras.end_time || null, extras.siteName || extras.site_name || null, extras.jobRole || extras.job_role || null, notes || '', now, now);
    return id;
  }
  await pool.query('INSERT INTO timesheet_entries(id,timesheet_id,work_date,hours,break_minutes,start_time,end_time,site_name,job_role,notes,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
    [id, timesheetId, workDate, Number(hours), breakMinutes, extras.startTime || extras.start_time || null, extras.endTime || extras.end_time || null, extras.siteName || extras.site_name || null, extras.jobRole || extras.job_role || null, notes || '', now, now]);
  return id;
}

async function backfillTimesheetDomain() {
  const now = new Date().toISOString();
  if (useSqlite) {
    sqliteDb.prepare(`
      UPDATE timesheets
      SET period_start = COALESCE(period_start, date),
          period_end = COALESCE(period_end, date),
          submitted_at = COALESCE(submitted_at, created_at),
          updated_at = COALESCE(updated_at, created_at, ?),
          invoiced_at = CASE WHEN status = 'invoiced' THEN COALESCE(invoiced_at, approved_at, created_at, ?) ELSE invoiced_at END
    `).run(now, now);
    const rows = sqliteDb.prepare(`
      SELECT t.* FROM timesheets t
      LEFT JOIN timesheet_entries e ON e.timesheet_id = t.id
      WHERE e.id IS NULL AND t.date IS NOT NULL
    `).all();
    const insert = sqliteDb.prepare('INSERT INTO timesheet_entries(id,timesheet_id,work_date,hours,break_minutes,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)');
    const event = sqliteDb.prepare('INSERT INTO timesheet_events(id,timesheet_id,actor_id,event_type,from_status,to_status,comment,created_at) VALUES(?,?,?,?,?,?,?,?)');
    const tx = sqliteDb.transaction(() => {
      rows.forEach(r => {
        insert.run(crypto.randomUUID(), r.id, normalizeDateOnly(r.date), Number(r.hours || 0), 0, r.notes || '', r.created_at || now, r.updated_at || r.created_at || now);
        event.run(crypto.randomUUID(), r.id, null, 'backfilled', null, r.status || null, 'Created Phase 2 timesheet entry from legacy timesheet row.', now);
      });
    });
    tx();
    return;
  }
  await pool.query(`
    WITH parsed AS (
      SELECT id,
             CASE
               WHEN date::text ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN date::date
               WHEN date::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}$' THEN to_date(date::text, 'DD/MM/YYYY')
               ELSE NULL
             END AS work_date
      FROM timesheets
      WHERE date IS NOT NULL
    )
    UPDATE timesheets t
    SET period_start = COALESCE(t.period_start, p.work_date),
        period_end = COALESCE(t.period_end, p.work_date),
        submitted_at = COALESCE(t.submitted_at, t.created_at::timestamptz),
        updated_at = COALESCE(t.updated_at, t.created_at::timestamptz, $1::timestamptz),
        invoiced_at = CASE WHEN t.status = 'invoiced' THEN COALESCE(t.invoiced_at, t.approved_at::timestamptz, t.created_at::timestamptz, $1::timestamptz) ELSE t.invoiced_at END
    FROM parsed p
    WHERE t.id = p.id AND p.work_date IS NOT NULL
  `, [now]);
  await pool.query(`
    WITH parsed AS (
      SELECT t.*,
             CASE
               WHEN t.date::text ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN t.date::date
               WHEN t.date::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}$' THEN to_date(t.date::text, 'DD/MM/YYYY')
               ELSE NULL
             END AS work_date
      FROM timesheets t
      WHERE t.date IS NOT NULL
    )
    INSERT INTO timesheet_entries(id,timesheet_id,work_date,hours,break_minutes,notes,created_at,updated_at)
    SELECT md5(random()::text || clock_timestamp()::text), p.id, p.work_date, COALESCE(p.hours, 0), 0, COALESCE(p.notes, ''), COALESCE(p.created_at::timestamptz, $1::timestamptz), COALESCE(p.updated_at::timestamptz, p.created_at::timestamptz, $1::timestamptz)
    FROM parsed p
    WHERE p.work_date IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM timesheet_entries e WHERE e.timesheet_id = p.id)
  `, [now]);
}

async function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Missing auth' });
  const token = auth.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (useSqlite) {
      const row = sqliteDb.prepare('SELECT id,name,email,role,client_id,joined_at FROM users WHERE id = ?').get(payload.id);
      if (!row) return res.status(401).json({ error: 'Invalid user' });
      req.user = row;
    } else {
      const userRes = await pool.query('SELECT id,name,email,role,client_id,joined_at FROM users WHERE id=$1', [payload.id]);
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
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '').trim();
  try {
    let user;
    if (useSqlite) {
      user = sqliteDb.prepare('SELECT id,name,email,password,role,client_id FROM users WHERE lower(email) = lower(?)').get(email);
    } else {
      const userRes = await pool.query('SELECT id,name,email,password,role,client_id FROM users WHERE lower(email)=lower($1)', [email]);
      user = userRes.rowCount ? userRes.rows[0] : null;
    }
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });
    const ok = bcrypt.compareSync(password, user.password);
    if (!ok) return res.status(400).json({ error: 'Invalid credentials' });
    res.json({ token: generateToken(user), user: { id: user.id, name: user.name, email: user.email, role: user.role, client_id: user.client_id || null } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/timesheets', authMiddleware, async (req, res) => {
  if (!['staff','consultant','owner'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  const { clientId, notes } = req.body;
  const weekly = readWeeklyTimesheet(req.body);
  if (!weekly.weekStart || weekly.dayRate <= 0 || weekly.shiftCount <= 0 || !clientId) return res.status(400).json({ error: 'Select a week and at least one day/night shift' });
  if (req.user.role === 'staff' && (!req.user.client_id || clientId !== req.user.client_id)) return res.status(403).json({ error: 'Interim can only submit timesheets to their assigned client' });
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const workDate = weekly.periodStart;
  const numericHours = weekly.shiftCount;
  const overtime = { overtimeWeekHours: 0, overtimeWeekendHours: 0, overtimeBankHolidayHours: 0 };
  const { periodStart, periodEnd } = weekly;
  try {
    if (useSqlite) {
      const tx = sqliteDb.transaction(() => {
        sqliteDb.prepare('INSERT INTO timesheets(id,staff_id,client_id,date,hours,overtime_week_hours,overtime_weekend_hours,overtime_bank_holiday_hours,notes,status,created_at,period_start,period_end,submitted_at,updated_at,pricing_model,day_rate,shift_payload,shift_count,calculated_amount,consultant_fee_amount,interim_amount,vat_amount,invoice_amount) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(id, req.user.id, clientId, workDate, numericHours, overtime.overtimeWeekHours, overtime.overtimeWeekendHours, overtime.overtimeBankHolidayHours, notes || '', 'submitted', createdAt, periodStart, periodEnd, createdAt, createdAt, 'weekly_shift', weekly.dayRate, weekly.shiftPayload, weekly.shiftCount, weekly.calculatedAmount, weekly.consultantFeeAmount, weekly.interimAmount, weekly.vatAmount, weekly.invoiceAmount);
        sqliteDb.prepare('INSERT INTO timesheet_entries(id,timesheet_id,work_date,hours,break_minutes,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
          .run(crypto.randomUUID(), id, workDate, numericHours, 0, notes || '', createdAt, createdAt);
        sqliteDb.prepare('INSERT INTO timesheet_events(id,timesheet_id,actor_id,event_type,from_status,to_status,comment,created_at) VALUES(?,?,?,?,?,?,?,?)')
          .run(crypto.randomUUID(), id, req.user.id, 'submitted', null, 'submitted', 'Staff submitted timesheet.', createdAt);
      });
      tx();
      const clientRow = sqliteDb.prepare('SELECT email FROM users WHERE id = ? AND role = ?').get(clientId, 'client');
      if (clientRow && clientRow.email) sendEmail(clientRow.email, 'Timesheet submitted for your approval', `A timesheet (${id}) has been submitted.`).catch(e=>console.error(e));
      return res.json(serializeTimesheet({ id, staff_id: req.user.id, client_id: clientId, date: workDate, hours: numericHours, overtime_week_hours: overtime.overtimeWeekHours, overtime_weekend_hours: overtime.overtimeWeekendHours, overtime_bank_holiday_hours: overtime.overtimeBankHolidayHours, notes: notes || '', status: 'submitted', created_at: createdAt, period_start: periodStart, period_end: periodEnd, submitted_at: createdAt, updated_at: createdAt, pricing_model: 'weekly_shift', day_rate: weekly.dayRate, shift_payload: weekly.shiftPayload, shift_count: weekly.shiftCount, calculated_amount: weekly.calculatedAmount, consultant_fee_amount: weekly.consultantFeeAmount, interim_amount: weekly.interimAmount, vat_amount: weekly.vatAmount, invoice_amount: weekly.invoiceAmount }));
    }
    await pool.query('BEGIN');
    await pool.query('INSERT INTO timesheets(id,staff_id,client_id,date,hours,overtime_week_hours,overtime_weekend_hours,overtime_bank_holiday_hours,notes,status,created_at,period_start,period_end,submitted_at,updated_at,pricing_model,day_rate,shift_payload,shift_count,calculated_amount,consultant_fee_amount,interim_amount,vat_amount,invoice_amount) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)',
      [id, req.user.id, clientId, workDate, numericHours, overtime.overtimeWeekHours, overtime.overtimeWeekendHours, overtime.overtimeBankHolidayHours, notes || '', 'submitted', createdAt, periodStart, periodEnd, createdAt, createdAt, 'weekly_shift', weekly.dayRate, weekly.shiftPayload, weekly.shiftCount, weekly.calculatedAmount, weekly.consultantFeeAmount, weekly.interimAmount, weekly.vatAmount, weekly.invoiceAmount]);
    await pool.query('INSERT INTO timesheet_entries(id,timesheet_id,work_date,hours,break_minutes,notes,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [crypto.randomUUID(), id, workDate, numericHours, 0, notes || '', createdAt, createdAt]);
    await pool.query('INSERT INTO timesheet_events(id,timesheet_id,actor_id,event_type,from_status,to_status,comment,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [crypto.randomUUID(), id, req.user.id, 'submitted', null, 'submitted', 'Staff submitted timesheet.', createdAt]);
    await pool.query('COMMIT');
    const clientRes = await pool.query('SELECT email FROM users WHERE id=$1 AND role=$2', [clientId, 'client']);
    if (clientRes.rowCount > 0 && clientRes.rows[0].email) sendEmail(clientRes.rows[0].email, 'Timesheet submitted for your approval', `A timesheet (${id}) has been submitted.`).catch(e=>console.error(e));
    res.json(serializeTimesheet({ id, staff_id: req.user.id, client_id: clientId, date: workDate, hours: numericHours, overtime_week_hours: overtime.overtimeWeekHours, overtime_weekend_hours: overtime.overtimeWeekendHours, overtime_bank_holiday_hours: overtime.overtimeBankHolidayHours, notes: notes || '', status: 'submitted', created_at: createdAt, period_start: periodStart, period_end: periodEnd, submitted_at: createdAt, updated_at: createdAt, pricing_model: 'weekly_shift', day_rate: weekly.dayRate, shift_payload: weekly.shiftPayload, shift_count: weekly.shiftCount, calculated_amount: weekly.calculatedAmount, consultant_fee_amount: weekly.consultantFeeAmount, interim_amount: weekly.interimAmount, vat_amount: weekly.vatAmount, invoice_amount: weekly.invoiceAmount }));
  } catch (e) {
    if (!useSqlite) { try { await pool.query('ROLLBACK'); } catch (_) {} }
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Owner can create new users (client or staff)
app.post('/api/users', authMiddleware, async (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Forbidden' });
  const { name, email, password, role, clientId } = req.body;
  if (!name || !email || !password || !role) return res.status(400).json({ error: 'Missing fields' });
  if (!['staff','consultant','client'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  try {
    // If user exists, return it (idempotent)
    if (useSqlite) {
      const existing = sqliteDb.prepare('SELECT id,name,email,role,client_id,joined_at FROM users WHERE email = ?').get(email);
      if (existing) return res.json(existing);
      const hashed = bcrypt.hashSync(password, 8);
      const id = crypto.randomUUID();
  sqliteDb.prepare('INSERT INTO users(id,name,email,password,role,client_id,joined_at) VALUES(?,?,?,?,?,?,?)').run(id, name, email, hashed, role, clientId || null, new Date().toISOString());
      // Send invitation email in the background so user creation is not blocked by SMTP/test-mail latency.
      sendEmail(email, 'You have been invited to Mega Construct', `Hello ${name},\n\nAn account was created for you. Email: ${email}\nPlease use the password provided by the owner to login. You can reset your password if needed.`)
        .catch(e => console.error('Invitation email failed', e));
      return res.json({ id, name, email, role, client_id: clientId || null, joined_at: new Date().toISOString() });
    } else {
      const existingRes = await pool.query('SELECT id,name,email,role,client_id,joined_at FROM users WHERE email=$1', [email]);
      if (existingRes.rowCount > 0) return res.json(existingRes.rows[0]);
      const hashed = bcrypt.hashSync(password, 8);
      const id = crypto.randomUUID();
  await pool.query('INSERT INTO users(id,name,email,password,role,client_id,joined_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, name, email, hashed, role, clientId || null, new Date().toISOString()]);
      sendEmail(email, 'You have been invited to Mega Construct', `Hello ${name},\n\nAn account was created for you. Email: ${email}\nPlease use the password provided by the owner to login. You can reset your password if needed.`)
        .catch(e => console.error('Invitation email failed', e));
      return res.json({ id, name, email, role, client_id: clientId || null, joined_at: new Date().toISOString() });
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
      const rows = sqliteDb.prepare('SELECT id,name,email,role,client_id,joined_at FROM users').all();
      return res.json(rows);
    }
    const r = await pool.query('SELECT id,name,email,role,client_id,joined_at FROM users');
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
      const u = sqliteDb.prepare('SELECT id,name,email,role,client_id,joined_at FROM users WHERE id = ?').get(req.user.id);
      return res.json(u);
    }
    const r = await pool.query('SELECT id,name,email,role,client_id,joined_at FROM users WHERE id=$1', [req.user.id]);
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
    if (useSqlite) userRow = sqliteDb.prepare('SELECT id,name,email,role,client_id,joined_at FROM users WHERE id = ?').get(id);
    else {
      const r = await pool.query('SELECT id,name,email,role,client_id,joined_at FROM users WHERE id=$1', [id]);
      userRow = r.rowCount ? r.rows[0] : null;
    }
    if (!userRow) return res.status(404).json({ error: 'Not found' });
    if (userRow.role === 'owner') return res.status(400).json({ error: 'Cannot delete owner' });

    if (userRow.role === 'client') {
      const assignedStaff = useSqlite
        ? sqliteDb.prepare('SELECT id,name,email FROM users WHERE role = ? AND client_id = ?').all('staff', id)
        : (await pool.query('SELECT id,name,email FROM users WHERE role=$1 AND client_id=$2', ['staff', id])).rows;
      if (assignedStaff.length > 0) {
        return res.status(400).json({
          error: 'Cannot delete client while staff are assigned to them. Delete or reassign the staff first.',
          assignedStaff
        });
      }
    }

    // Check timesheets belonging to or associated with this user
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

    const invoicedTimesheets = timesheets.filter(t => t.status === 'invoiced' || t.invoice_id);
    if (force && invoicedTimesheets.length > 0) {
      return res.status(400).json({ error: 'Cannot delete user because they have invoiced timesheets. Invoice history must remain intact.' });
    }

    // proceed to delete (force also removes non-invoiced associated timesheets)
    if (useSqlite) {
      const tx = sqliteDb.transaction(() => {
        if (force && timesheets.length > 0) {
          const deleteEntries = sqliteDb.prepare('DELETE FROM timesheet_entries WHERE timesheet_id = ?');
          const deleteEvents = sqliteDb.prepare('DELETE FROM timesheet_events WHERE timesheet_id = ?');
          const deleteTimesheet = sqliteDb.prepare('DELETE FROM timesheets WHERE id = ?');
          timesheets.forEach(t => {
            deleteEntries.run(t.id);
            deleteEvents.run(t.id);
            deleteTimesheet.run(t.id);
          });
        }
        sqliteDb.prepare('DELETE FROM users WHERE id = ?').run(id);
      });
      tx();
    } else {
      await pool.query('BEGIN');
      if (force && timesheets.length > 0) {
        const ids = timesheets.map(t => t.id);
        await pool.query('DELETE FROM timesheet_entries WHERE timesheet_id = ANY($1)', [ids]);
        await pool.query('DELETE FROM timesheet_events WHERE timesheet_id = ANY($1)', [ids]);
        await pool.query('DELETE FROM timesheets WHERE id = ANY($1)', [ids]);
      }
      await pool.query('DELETE FROM users WHERE id=$1', [id]);
      await pool.query('COMMIT');
    }
    if (userRow && userRow.email) sendEmail(userRow.email, 'Account deleted at Mega Construct', `Hello ${userRow.name || ''},\n\nYour account has been deleted by the owner.`).catch(e => console.error('Deletion email failed', e));
    res.json({ ok: true, deleted: true, deletedTimesheets: force ? timesheets.length : 0 });
  } catch (e) {
    if (!useSqlite) { try { await pool.query('ROLLBACK'); } catch (_) {} }
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
    const r = await pool.query('SELECT * FROM timesheets WHERE staff_id=$1 OR client_id=$1 ORDER BY COALESCE(approved_at::timestamptz, created_at::timestamptz) DESC', [id]);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Owner: delete a specific timesheet
app.delete('/api/timesheets/:id', authMiddleware, async (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Forbidden' });
  const id = req.params.id;
  try {
    if (useSqlite) {
      const ts = sqliteDb.prepare('SELECT * FROM timesheets WHERE id = ?').get(id);
      sqliteDb.prepare('DELETE FROM timesheet_entries WHERE timesheet_id = ?').run(id);
      await logTimesheetEvent(id, req.user.id, 'deleted', ts && ts.status, null, 'Owner deleted timesheet.');
      sqliteDb.prepare('DELETE FROM timesheet_events WHERE timesheet_id = ?').run(id);
      sqliteDb.prepare('DELETE FROM timesheets WHERE id = ?').run(id);
    } else {
      const tsr = await pool.query('SELECT * FROM timesheets WHERE id=$1', [id]);
      if (tsr.rowCount > 0) await logTimesheetEvent(id, req.user.id, 'deleted', tsr.rows[0].status, null, 'Owner deleted timesheet.');
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
    if (useSqlite) {
      sqliteDb.prepare('DELETE FROM timesheet_entries').run();
      sqliteDb.prepare('DELETE FROM timesheet_events').run();
      sqliteDb.prepare('DELETE FROM timesheets').run();
    } else {
      await pool.query('DELETE FROM timesheets');
    }
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
  if (!['staff','consultant','owner'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
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
  if (!['staff','consultant','owner'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  try {
    if (useSqlite) {
      const rows = sqliteDb.prepare('SELECT * FROM timesheets WHERE staff_id = ? AND status = ? ORDER BY created_at DESC').all(req.user.id, 'submitted');
      return res.json(rows);
    }
    const r = await pool.query('SELECT * FROM timesheets WHERE staff_id=$1 AND status=$2 ORDER BY created_at DESC', [req.user.id, 'submitted']);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Client: reviewed history (approved, returned, and invoiced client-side view)
app.get('/api/timesheets/client/history', authMiddleware, async (req, res) => {
  if (req.user.role !== 'client') return res.status(403).json({ error: 'Forbidden' });
  try {
    const statuses = ['approved', 'returned', 'invoiced'];
    if (useSqlite) {
      const rows = sqliteDb.prepare(`SELECT * FROM timesheets WHERE client_id = ? AND status IN (${statuses.map(() => '?').join(',')}) ORDER BY COALESCE(approved_at, returned_at, invoiced_at, updated_at, created_at) DESC`).all(req.user.id, ...statuses);
      const users = {};
      sqliteDb.prepare('SELECT id,name,email FROM users').all().forEach(u => { users[u.id] = u; users[String(u.id)] = u; });
      const out = rows.map(r => ({ ...r, staff_name: (users[r.staff_id] && users[r.staff_id].name) || null, staff_email: (users[r.staff_id] && users[r.staff_id].email) || null }));
      return res.json(out);
    }
    const q = `SELECT t.*, u.name as staff_name, u.email as staff_email,
      ev.event_type as latest_client_event_type, ev.comment as latest_client_event_comment, ev.created_at as latest_client_event_at
      FROM timesheets t
      LEFT JOIN users u ON u.id = t.staff_id
      LEFT JOIN LATERAL (
        SELECT event_type, comment, created_at
        FROM timesheet_events e
        WHERE e.timesheet_id = t.id AND e.actor_id = $1 AND e.event_type IN ('approved', 'returned')
        ORDER BY e.created_at DESC
        LIMIT 1
      ) ev ON true
      WHERE t.client_id=$1 AND t.status = ANY($2::text[])
      ORDER BY COALESCE(t.approved_at::timestamptz, t.returned_at::timestamptz, t.invoiced_at::timestamptz, t.updated_at::timestamptz, t.created_at::timestamptz) DESC`;
    const r = await pool.query(q, [req.user.id, statuses]);
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
    const r = await pool.query('SELECT * FROM timesheets ORDER BY COALESCE(approved_at::timestamptz, created_at::timestamptz) DESC');
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});


// Owner dashboard summary for Phase 5 oversight cards.
app.get('/api/owner/summary', authMiddleware, async (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Forbidden' });
  try {
    if (useSqlite) {
      const userRows = sqliteDb.prepare('SELECT role, COUNT(*) as count FROM users GROUP BY role').all();
      const timesheetRows = sqliteDb.prepare('SELECT status, COUNT(*) as count, COALESCE(SUM(hours), 0) as hours FROM timesheets GROUP BY status').all();
      const invoiceRows = sqliteDb.prepare('SELECT status, COUNT(*) as count, COALESCE(SUM(total_amount), 0) as amount FROM invoices GROUP BY status').all();
      return res.json({ users: userRows, timesheets: timesheetRows, invoices: invoiceRows });
    }
    const users = (await pool.query('SELECT role, COUNT(*)::int as count FROM users GROUP BY role ORDER BY role')).rows;
    const timesheets = (await pool.query('SELECT status, COUNT(*)::int as count, COALESCE(SUM(hours), 0)::float as hours FROM timesheets GROUP BY status ORDER BY status')).rows;
    const invoices = (await pool.query('SELECT status, COUNT(*)::int as count, COALESCE(SUM(total_amount), 0)::float as amount FROM invoices GROUP BY status ORDER BY status')).rows;
    res.json({ users, timesheets, invoices });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Clients list for staff selection
app.get('/api/clients', authMiddleware, async (req, res) => {
  if (!['staff','consultant','owner','client'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  try {
    if (useSqlite) {
      const rows = sqliteDb.prepare("SELECT id,name,email,joined_at FROM users WHERE role = 'client'").all();
      return res.json(rows);
    }
    const r = await pool.query("SELECT id,name,email,joined_at FROM users WHERE role = 'client'");
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Staff list (for owner modal reassign)
app.get('/api/staffs', authMiddleware, async (req, res) => {
  if (!['owner','staff','consultant','client'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  try {
    if (useSqlite) {
      const rows = sqliteDb.prepare("SELECT id,name,email,joined_at,role,client_id FROM users WHERE role IN ('staff','consultant','owner')").all();
      return res.json(rows);
    }
    const r = await pool.query("SELECT id,name,email,joined_at,role,client_id FROM users WHERE role IN ('staff','consultant','owner')");
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Staff: create a draft timesheet header for richer Phase 2 flows.
app.post('/api/timesheets/draft', authMiddleware, async (req, res) => {
  if (!['staff','consultant','owner'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  const { clientId, periodStart, periodEnd, notes } = req.body;
  const start = normalizeDateOnly(periodStart);
  const end = normalizeDateOnly(periodEnd || periodStart);
  if (!clientId || !start || !end) return res.status(400).json({ error: 'Missing or invalid fields' });
  if (new Date(start) > new Date(end)) return res.status(400).json({ error: 'periodStart must be before periodEnd' });
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    if (useSqlite) {
      sqliteDb.prepare('INSERT INTO timesheets(id,staff_id,client_id,date,hours,notes,status,created_at,period_start,period_end,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, req.user.id, clientId, start, 0, notes || '', 'draft', now, start, end, now);
      await logTimesheetEvent(id, req.user.id, 'created', null, 'draft', 'Staff created draft timesheet.');
      return res.json(serializeTimesheet({ id, staff_id: req.user.id, client_id: clientId, date: start, hours: 0, notes: notes || '', status: 'draft', created_at: now, period_start: start, period_end: end, updated_at: now }));
    }
    await pool.query('INSERT INTO timesheets(id,staff_id,client_id,date,hours,notes,status,created_at,period_start,period_end,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [id, req.user.id, clientId, start, 0, notes || '', 'draft', now, start, end, now]);
    await logTimesheetEvent(id, req.user.id, 'created', null, 'draft', 'Staff created draft timesheet.');
    res.json(serializeTimesheet({ id, staff_id: req.user.id, client_id: clientId, date: start, hours: 0, notes: notes || '', status: 'draft', created_at: now, period_start: start, period_end: end, updated_at: now }));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Staff: add a line entry to a draft or returned timesheet. Existing UI does not depend on this yet.
app.post('/api/timesheets/:id/entries', authMiddleware, async (req, res) => {
  if (!['staff','consultant','owner'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  const id = req.params.id;
  const workDate = normalizeDateOnly(req.body.workDate || req.body.date);
  const hours = Number(req.body.hours);
  if (!workDate || !hours || hours <= 0) return res.status(400).json({ error: 'Missing or invalid fields' });
  try {
    let ts;
    if (useSqlite) ts = sqliteDb.prepare('SELECT * FROM timesheets WHERE id = ? AND staff_id = ?').get(id, req.user.id);
    else {
      const r = await pool.query('SELECT * FROM timesheets WHERE id=$1 AND staff_id=$2', [id, req.user.id]);
      ts = r.rowCount ? r.rows[0] : null;
    }
    if (!ts) return res.status(404).json({ error: 'Timesheet not found' });
    if (!['draft', 'returned'].includes(ts.status)) return res.status(400).json({ error: 'Only draft or returned timesheets can be edited' });
    const entryId = await createTimesheetEntry(id, workDate, hours, req.body.notes || '', req.body);
    const now = new Date().toISOString();
    const newHours = Number(ts.hours || 0) + hours;
    if (useSqlite) {
      sqliteDb.prepare('UPDATE timesheets SET hours = ?, updated_at = ?, date = COALESCE(date, ?), period_start = MIN(COALESCE(period_start, ?), ?), period_end = MAX(COALESCE(period_end, ?), ?) WHERE id = ?')
        .run(newHours, now, workDate, workDate, workDate, workDate, workDate, id);
    } else {
      await pool.query('UPDATE timesheets SET hours=$1, updated_at=$2, date=COALESCE(date, $3), period_start=LEAST(COALESCE(period_start, $3), $3), period_end=GREATEST(COALESCE(period_end, $3), $3) WHERE id=$4', [newHours, now, workDate, id]);
    }
    await logTimesheetEvent(id, req.user.id, 'entry_added', ts.status, ts.status, `Staff added entry ${entryId}.`);
    res.json({ ok: true, entryId });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Staff: submit a draft or returned timesheet.
app.post('/api/timesheets/:id/submit', authMiddleware, async (req, res) => {
  if (!['staff','consultant','owner'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  const id = req.params.id;
  const now = new Date().toISOString();
  try {
    let ts;
    let entryCount = 0;
    if (useSqlite) {
      ts = sqliteDb.prepare('SELECT * FROM timesheets WHERE id = ? AND staff_id = ?').get(id, req.user.id);
      entryCount = sqliteDb.prepare('SELECT COUNT(*) as count FROM timesheet_entries WHERE timesheet_id = ?').get(id).count;
    } else {
      const r = await pool.query('SELECT * FROM timesheets WHERE id=$1 AND staff_id=$2', [id, req.user.id]);
      ts = r.rowCount ? r.rows[0] : null;
      entryCount = Number((await pool.query('SELECT COUNT(*) as count FROM timesheet_entries WHERE timesheet_id=$1', [id])).rows[0].count);
    }
    if (!ts) return res.status(404).json({ error: 'Timesheet not found' });
    if (!['draft', 'returned'].includes(ts.status)) return res.status(400).json({ error: 'Only draft or returned timesheets can be submitted' });
    if (!entryCount) return res.status(400).json({ error: 'Add at least one entry before submitting' });
    if (useSqlite) sqliteDb.prepare('UPDATE timesheets SET status = ?, submitted_at = ?, returned_at = NULL, return_reason = NULL, updated_at = ? WHERE id = ?').run('submitted', now, now, id);
    else await pool.query('UPDATE timesheets SET status=$1, submitted_at=$2, returned_at=NULL, return_reason=NULL, updated_at=$3::timestamptz WHERE id=$4', ['submitted', now, now, id]);
    await logTimesheetEvent(id, req.user.id, 'submitted', ts.status, 'submitted', 'Staff submitted timesheet.');
    res.json({ ok: true, status: 'submitted' });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});


// Staff: update the legacy/single entry on a returned timesheet, then resubmit for approval.
app.patch('/api/timesheets/:id', authMiddleware, async (req, res) => {
  if (!['staff','consultant','owner'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  const id = req.params.id;
  const weekly = readWeeklyTimesheet(req.body);
  const notes = req.body.notes || '';
  if (!weekly.weekStart || weekly.dayRate <= 0 || weekly.shiftCount <= 0) return res.status(400).json({ error: 'Select a week and at least one day/night shift' });
  const workDate = weekly.periodStart;
  const hours = weekly.shiftCount;
  const overtime = { overtimeWeekHours: 0, overtimeWeekendHours: 0, overtimeBankHolidayHours: 0 };
  const now = new Date().toISOString();
  const { periodStart, periodEnd } = weekly;
  try {
    let ts;
    if (useSqlite) ts = sqliteDb.prepare('SELECT * FROM timesheets WHERE id = ? AND staff_id = ?').get(id, req.user.id);
    else {
      const r = await pool.query('SELECT * FROM timesheets WHERE id=$1 AND staff_id=$2', [id, req.user.id]);
      ts = r.rowCount ? r.rows[0] : null;
    }
    if (!ts) return res.status(404).json({ error: 'Timesheet not found' });
    if (!['draft', 'returned'].includes(ts.status)) return res.status(400).json({ error: 'Only draft or returned timesheets can be edited' });
    if (useSqlite) {
      const tx = sqliteDb.transaction(() => {
        sqliteDb.prepare('UPDATE timesheets SET date = ?, hours = ?, overtime_week_hours = ?, overtime_weekend_hours = ?, overtime_bank_holiday_hours = ?, notes = ?, period_start = ?, period_end = ?, updated_at = ?, pricing_model = ?, day_rate = ?, shift_payload = ?, shift_count = ?, calculated_amount = ?, consultant_fee_amount = ?, interim_amount = ?, vat_amount = ?, invoice_amount = ? WHERE id = ?')
          .run(workDate, hours, overtime.overtimeWeekHours, overtime.overtimeWeekendHours, overtime.overtimeBankHolidayHours, notes, periodStart, periodEnd, now, 'weekly_shift', weekly.dayRate, weekly.shiftPayload, weekly.shiftCount, weekly.calculatedAmount, weekly.consultantFeeAmount, weekly.interimAmount, weekly.vatAmount, weekly.invoiceAmount, id);
        const entry = sqliteDb.prepare('SELECT id FROM timesheet_entries WHERE timesheet_id = ? ORDER BY created_at LIMIT 1').get(id);
        if (entry) {
          sqliteDb.prepare('UPDATE timesheet_entries SET work_date = ?, hours = ?, notes = ?, updated_at = ? WHERE id = ?')
            .run(workDate, hours, notes, now, entry.id);
        } else {
          sqliteDb.prepare('INSERT INTO timesheet_entries(id,timesheet_id,work_date,hours,break_minutes,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
            .run(crypto.randomUUID(), id, workDate, hours, 0, notes, now, now);
        }
      });
      tx();
      await logTimesheetEvent(id, req.user.id, 'edited', ts.status, ts.status, 'Staff edited returned/draft timesheet.');
      return res.json(sqliteDb.prepare('SELECT * FROM timesheets WHERE id = ?').get(id));
    }
    await pool.query('BEGIN');
    await pool.query('UPDATE timesheets SET date=$1, hours=$2, overtime_week_hours=$3, overtime_weekend_hours=$4, overtime_bank_holiday_hours=$5, notes=$6, period_start=$7, period_end=$8, updated_at=$9, pricing_model=$10, day_rate=$11, shift_payload=$12, shift_count=$13, calculated_amount=$14, consultant_fee_amount=$15, interim_amount=$16, vat_amount=$17, invoice_amount=$18 WHERE id=$19', [workDate, hours, overtime.overtimeWeekHours, overtime.overtimeWeekendHours, overtime.overtimeBankHolidayHours, notes, periodStart, periodEnd, now, 'weekly_shift', weekly.dayRate, weekly.shiftPayload, weekly.shiftCount, weekly.calculatedAmount, weekly.consultantFeeAmount, weekly.interimAmount, weekly.vatAmount, weekly.invoiceAmount, id]);
    const er = await pool.query('SELECT id FROM timesheet_entries WHERE timesheet_id=$1 ORDER BY created_at LIMIT 1', [id]);
    if (er.rowCount > 0) {
      await pool.query('UPDATE timesheet_entries SET work_date=$1, hours=$2, notes=$3, updated_at=$4 WHERE id=$5', [workDate, hours, notes, now, er.rows[0].id]);
    } else {
      await pool.query('INSERT INTO timesheet_entries(id,timesheet_id,work_date,hours,break_minutes,notes,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [crypto.randomUUID(), id, workDate, hours, 0, notes, now, now]);
    }
    await pool.query('COMMIT');
    await logTimesheetEvent(id, req.user.id, 'edited', ts.status, ts.status, 'Staff edited returned/draft timesheet.');
    const updated = await pool.query('SELECT * FROM timesheets WHERE id=$1', [id]);
    res.json(updated.rows[0]);
  } catch (e) {
    if (!useSqlite) { try { await pool.query('ROLLBACK'); } catch (_) {} }
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Client: return a submitted timesheet to staff with a reason.
app.post('/api/timesheets/:id/return', authMiddleware, async (req, res) => {
  if (req.user.role !== 'client') return res.status(403).json({ error: 'Forbidden' });
  const id = req.params.id;
  const reason = String(req.body.reason || req.body.comment || '').trim();
  if (!reason) return res.status(400).json({ error: 'Return reason is required' });
  const now = new Date().toISOString();
  try {
    let ts;
    if (useSqlite) ts = sqliteDb.prepare('SELECT * FROM timesheets WHERE id = ? AND client_id = ?').get(id, req.user.id);
    else {
      const r = await pool.query('SELECT * FROM timesheets WHERE id=$1 AND client_id=$2', [id, req.user.id]);
      ts = r.rowCount ? r.rows[0] : null;
    }
    if (!ts) return res.status(404).json({ error: 'Timesheet not found' });
    if (ts.status !== 'submitted') return res.status(400).json({ error: 'Only submitted timesheets can be returned' });
    if (useSqlite) {
      sqliteDb.prepare('UPDATE timesheets SET status = ?, returned_at = ?, return_reason = ?, updated_at = ? WHERE id = ?').run('returned', now, reason, now, id);
      await logTimesheetEvent(id, req.user.id, 'returned', ts.status, 'returned', reason);
      return res.json(sqliteDb.prepare('SELECT * FROM timesheets WHERE id = ?').get(id));
    }
    await pool.query('UPDATE timesheets SET status=$1, returned_at=$2, return_reason=$3, updated_at=$4::timestamptz WHERE id=$5', ['returned', now, reason, now, id]);
    await logTimesheetEvent(id, req.user.id, 'returned', ts.status, 'returned', reason);
    const updated = await pool.query('SELECT * FROM timesheets WHERE id=$1', [id]);
    res.json(updated.rows[0]);
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
      sqliteDb.prepare('UPDATE timesheets SET staff_id = ?, updated_at = ? WHERE id = ?').run(toStaffId, new Date().toISOString(), id);
      await logTimesheetEvent(id, req.user.id, 'reassigned', ts.status, ts.status, `Owner reassigned staff from ${ts.staff_id} to ${toStaffId}.`);
      const updated = sqliteDb.prepare('SELECT * FROM timesheets WHERE id = ?').get(id);
      return res.json(updated);
    }
    const tsr = await pool.query('SELECT * FROM timesheets WHERE id=$1', [id]);
    if (tsr.rowCount === 0) return res.status(404).json({ error: 'Timesheet not found' });
    await pool.query('UPDATE timesheets SET staff_id=$1, updated_at=$2 WHERE id=$3', [toStaffId, new Date().toISOString(), id]);
    await logTimesheetEvent(id, req.user.id, 'reassigned', tsr.rows[0].status, tsr.rows[0].status, `Owner reassigned staff from ${tsr.rows[0].staff_id} to ${toStaffId}.`);
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
      sqliteDb.prepare('UPDATE timesheets SET status = ?, updated_at = ? WHERE id = ?').run('archived', new Date().toISOString(), id);
      await logTimesheetEvent(id, req.user.id, 'archived', ts.status, 'archived', 'Owner archived timesheet.');
      const updated = sqliteDb.prepare('SELECT * FROM timesheets WHERE id = ?').get(id);
      return res.json(updated);
    }
    const tsr = await pool.query('SELECT * FROM timesheets WHERE id=$1', [id]);
    if (tsr.rowCount === 0) return res.status(404).json({ error: 'Timesheet not found' });
    await pool.query('UPDATE timesheets SET status=$1, updated_at=$2 WHERE id=$3', ['archived', new Date().toISOString(), id]);
    await logTimesheetEvent(id, req.user.id, 'archived', tsr.rows[0].status, 'archived', 'Owner archived timesheet.');
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
      if (ts.status !== 'submitted') return res.status(400).json({ error: 'Only submitted timesheets can be approved' });
      const approvedAt = new Date().toISOString();
      sqliteDb.prepare('UPDATE timesheets SET status = ?, approved_at = ?, return_reason = NULL, updated_at = ? WHERE id = ?').run('approved', approvedAt, approvedAt, id);
      await logTimesheetEvent(id, req.user.id, 'approved', ts.status, 'approved', 'Client approved timesheet.');
      const updated = sqliteDb.prepare('SELECT * FROM timesheets WHERE id = ?').get(id);
      sendOwnerNotification(updated);
      return res.json(updated);
    }
    const tsRes = await pool.query('SELECT * FROM timesheets WHERE id=$1 AND client_id=$2', [id, req.user.id]);
    if (tsRes.rowCount === 0) return res.status(404).json({ error: 'Timesheet not found' });
    if (tsRes.rows[0].status !== 'submitted') return res.status(400).json({ error: 'Only submitted timesheets can be approved' });
    const approvedAt = new Date().toISOString();
    await pool.query('UPDATE timesheets SET status=$1, approved_at=$2, return_reason=NULL, updated_at=$3::timestamptz WHERE id=$4', ['approved', approvedAt, approvedAt, id]);
    await logTimesheetEvent(id, req.user.id, 'approved', tsRes.rows[0].status, 'approved', 'Client approved timesheet.');
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

// Timesheet detail with Phase 2 entries and audit events.
app.get('/api/timesheets/:id', authMiddleware, async (req, res) => {
  const id = req.params.id;
  try {
    let ts;
    let entries = [];
    let events = [];
    if (useSqlite) {
      ts = sqliteDb.prepare('SELECT * FROM timesheets WHERE id = ?').get(id);
      if (!ts) return res.status(404).json({ error: 'Timesheet not found' });
      entries = sqliteDb.prepare('SELECT * FROM timesheet_entries WHERE timesheet_id = ? ORDER BY work_date, created_at').all(id);
      events = sqliteDb.prepare('SELECT * FROM timesheet_events WHERE timesheet_id = ? ORDER BY created_at').all(id);
    } else {
      const r = await pool.query('SELECT * FROM timesheets WHERE id=$1', [id]);
      if (r.rowCount === 0) return res.status(404).json({ error: 'Timesheet not found' });
      ts = r.rows[0];
      entries = (await pool.query('SELECT * FROM timesheet_entries WHERE timesheet_id=$1 ORDER BY work_date, created_at', [id])).rows;
      events = (await pool.query('SELECT * FROM timesheet_events WHERE timesheet_id=$1 ORDER BY created_at', [id])).rows;
    }
    const canSee = req.user.role === 'owner' || req.user.id === ts.staff_id || req.user.id === ts.client_id;
    if (!canSee) return res.status(403).json({ error: 'Forbidden' });
    res.json({ ...serializeTimesheet(ts, entries), events });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});


function invoiceLineFromTimesheet(row, rates) {
  const isWeeklyShift = row.pricing_model === 'weekly_shift';
  const hours = Number(row.shift_count || row.hours || 0);
  const ot = isWeeklyShift ? { overtimeWeekHours: 0, overtimeWeekendHours: 0, overtimeBankHolidayHours: 0 } : overtimeFromRow(row);
  const baseRate = isWeeklyShift ? Number(row.day_rate || DEFAULT_DAILY_RATE) : Number(rates.hourlyRate || 0);
  const overtimeWeekRate = isWeeklyShift ? 0 : Number(rates.overtimeWeekRate || 0);
  const overtimeWeekendRate = isWeeklyShift ? 0 : Number(rates.overtimeWeekendRate || 0);
  const overtimeBankHolidayRate = isWeeklyShift ? 0 : Number(rates.overtimeBankHolidayRate || 0);
  const lineAmount = isWeeklyShift ? toMoney(row.invoice_amount || row.calculated_amount || 0) : toMoney(
    (hours * baseRate) +
    (ot.overtimeWeekHours * overtimeWeekRate) +
    (ot.overtimeWeekendHours * overtimeWeekendRate) +
    (ot.overtimeBankHolidayHours * overtimeBankHolidayRate)
  );
  return {
    timesheet_id: row.id,
    staff_id: row.staff_id,
    staff_name: row.staff_name || null,
    staff_email: row.staff_email || null,
    work_date: normalizeDateOnly(row.date || row.period_start),
    hours,
    hourly_rate: baseRate,
    overtime_week_hours: ot.overtimeWeekHours,
    overtime_week_rate: overtimeWeekRate,
    overtime_weekend_hours: ot.overtimeWeekendHours,
    overtime_weekend_rate: overtimeWeekendRate,
    overtime_bank_holiday_hours: ot.overtimeBankHolidayHours,
    overtime_bank_holiday_rate: overtimeBankHolidayRate,
    line_amount: lineAmount,
    notes: [row.notes || '', weeklyShiftSummary(row), isWeeklyShift ? `Net £${toMoney(row.calculated_amount || 0).toFixed(2)}, consultant £${toMoney(row.consultant_fee_amount || 0).toFixed(2)}, interim £${toMoney(row.interim_amount || 0).toFixed(2)}, VAT £${toMoney(row.vat_amount || 0).toFixed(2)}` : ''].filter(Boolean).join(' — ')
  };
}

function invoicePreviewPayload(rows, rates) {
  const lines = rows.map(r => invoiceLineFromTimesheet(r, rates));
  const totalHours = lines.reduce((sum, r) => sum + Number(r.hours || 0), 0);
  const totalOvertimeWeekHours = lines.reduce((sum, r) => sum + Number(r.overtime_week_hours || 0), 0);
  const totalOvertimeWeekendHours = lines.reduce((sum, r) => sum + Number(r.overtime_weekend_hours || 0), 0);
  const totalOvertimeBankHolidayHours = lines.reduce((sum, r) => sum + Number(r.overtime_bank_holiday_hours || 0), 0);
  const totalAmount = toMoney(lines.reduce((sum, r) => sum + Number(r.line_amount || 0), 0));
  return { totalHours, totalOvertimeWeekHours, totalOvertimeWeekendHours, totalOvertimeBankHolidayHours, ...rates, totalAmount, count: lines.length, lines };
}

async function findApprovedInvoiceTimesheets({ clientId, periodStart, periodEnd, lock = false }) {
  if (useSqlite) {
    return clientId
      ? sqliteDb.prepare("SELECT t.*, u.name as staff_name, u.email as staff_email FROM timesheets t LEFT JOIN users u ON u.id = t.staff_id WHERE t.status = ? AND t.invoice_id IS NULL AND t.client_id = ? AND t.date BETWEEN ? AND ? ORDER BY t.date, u.name").all('approved', clientId, periodStart, periodEnd)
      : sqliteDb.prepare("SELECT t.*, u.name as staff_name, u.email as staff_email FROM timesheets t LEFT JOIN users u ON u.id = t.staff_id WHERE t.status = ? AND t.invoice_id IS NULL AND t.date BETWEEN ? AND ? ORDER BY t.client_id, t.date, u.name").all('approved', periodStart, periodEnd);
  }
  const params = ['approved', periodStart, periodEnd];
  let where = "t.status=$1 AND t.invoice_id IS NULL AND t.date BETWEEN $2 AND $3";
  if (clientId) { params.push(clientId); where += ` AND t.client_id=$${params.length}`; }
  const sql = `SELECT t.*, u.name as staff_name, u.email as staff_email FROM timesheets t LEFT JOIN users u ON u.id = t.staff_id WHERE ${where} ORDER BY t.client_id, t.date, u.name${lock ? ' FOR UPDATE OF t' : ''}`;
  const r = await pool.query(sql, params);
  return r.rows;
}

function readInvoiceRequest(body) {
  const periodType = body.periodType === 'monthly' ? 'monthly' : 'weekly';
  const periodStart = normalizeDateOnly(body.periodStart);
  const periodEnd = normalizeDateOnly(body.periodEnd);
  const clientId = body.clientId || null;
  const hourlyRate = Number(body.hourlyRate || process.env.DEFAULT_DAILY_RATE || DEFAULT_DAILY_RATE);
  const overtimeWeekRate = Number(body.overtimeWeekRate || body.overtime_week_rate || 0);
  const overtimeWeekendRate = Number(body.overtimeWeekendRate || body.overtime_weekend_rate || 0);
  const overtimeBankHolidayRate = Number(body.overtimeBankHolidayRate || body.overtime_bank_holiday_rate || 0);
  return { periodType, periodStart, periodEnd, clientId, hourlyRate, overtimeWeekRate, overtimeWeekendRate, overtimeBankHolidayRate };
}

function validateInvoiceRequest({ periodStart, periodEnd, hourlyRate, overtimeWeekRate = 0, overtimeWeekendRate = 0, overtimeBankHolidayRate = 0 }) {
  if (!periodStart || !periodEnd) return 'Invalid periodStart or periodEnd';
  if (new Date(periodStart) > new Date(periodEnd)) return 'periodStart must be before periodEnd';
  if (!hourlyRate || hourlyRate < 0) return 'daily/hourly rate must be greater than zero';
  if ([overtimeWeekRate, overtimeWeekendRate, overtimeBankHolidayRate].some(v => !Number.isFinite(Number(v)) || Number(v) < 0)) return 'Overtime rates must be zero or greater';
  return null;
}

// Owner: preview approved, uninvoiced timesheets before invoice generation.
app.post('/api/invoices/preview', authMiddleware, async (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Forbidden' });
  const request = readInvoiceRequest(req.body);
  const validationError = validateInvoiceRequest(request);
  if (validationError) return res.status(400).json({ error: validationError });
  try {
    const rows = await findApprovedInvoiceTimesheets(request);
    if (rows.length === 0) return res.json({ ...request, count: 0, totalHours: 0, totalAmount: 0, lines: [], message: 'No approved uninvoiced timesheets found for this period' });
    const invoiceClientId = request.clientId || rows[0].client_id;
    if (!request.clientId && rows.some(r => r.client_id !== invoiceClientId)) return res.status(400).json({ error: 'Select a client when multiple clients have approved timesheets in the period' });
    res.json({ ...request, clientId: invoiceClientId, ...invoicePreviewPayload(rows, request) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Owner: create a draft invoice from approved, uninvoiced timesheets.
app.post('/api/invoices/generate', authMiddleware, async (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Forbidden' });
  const { periodType, periodStart, periodEnd, clientId, hourlyRate, overtimeWeekRate, overtimeWeekendRate, overtimeBankHolidayRate } = readInvoiceRequest(req.body);
  const validationError = validateInvoiceRequest({ periodStart, periodEnd, hourlyRate, overtimeWeekRate, overtimeWeekendRate, overtimeBankHolidayRate });
  if (validationError) return res.status(400).json({ error: validationError });

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const number = invoiceNumber(periodType);
  try {
    if (useSqlite) {
      const rows = await findApprovedInvoiceTimesheets({ clientId, periodStart, periodEnd });
      if (rows.length === 0) return res.status(400).json({ error: 'No approved uninvoiced timesheets found for this period' });
      const invoiceClientId = clientId || rows[0].client_id;
      if (!clientId && rows.some(r => r.client_id !== invoiceClientId)) return res.status(400).json({ error: 'Select a client when multiple clients have approved timesheets in the period' });
      const preview = invoicePreviewPayload(rows, { hourlyRate, overtimeWeekRate, overtimeWeekendRate, overtimeBankHolidayRate });
      const tx = sqliteDb.transaction(() => {
        sqliteDb.prepare('INSERT INTO invoices(id,invoice_number,client_id,period_type,period_start,period_end,total_hours,hourly_rate,total_amount,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
          .run(id, number, invoiceClientId, periodType, periodStart, periodEnd, preview.totalHours, hourlyRate, preview.totalAmount, 'draft', createdAt);
        const insertLine = sqliteDb.prepare('INSERT INTO invoice_lines(id,invoice_id,timesheet_id,staff_id,work_date,hours,hourly_rate,overtime_week_hours,overtime_week_rate,overtime_weekend_hours,overtime_weekend_rate,overtime_bank_holiday_hours,overtime_bank_holiday_rate,line_amount,notes,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
        const update = sqliteDb.prepare('UPDATE timesheets SET status = ?, invoice_id = ?, invoiced_at = ?, updated_at = ? WHERE id = ?');
        const event = sqliteDb.prepare('INSERT INTO timesheet_events(id,timesheet_id,actor_id,event_type,from_status,to_status,comment,created_at) VALUES(?,?,?,?,?,?,?,?)');
        preview.lines.forEach(line => {
          insertLine.run(crypto.randomUUID(), id, line.timesheet_id, line.staff_id, line.work_date, line.hours, line.hourly_rate, line.overtime_week_hours, line.overtime_week_rate, line.overtime_weekend_hours, line.overtime_weekend_rate, line.overtime_bank_holiday_hours, line.overtime_bank_holiday_rate, line.line_amount, line.notes, createdAt);
        });
        rows.forEach(r => {
          update.run('invoiced', id, createdAt, createdAt, r.id);
          event.run(crypto.randomUUID(), r.id, req.user.id, 'invoiced', r.status, 'invoiced', `Locked to invoice ${number}.`, createdAt);
        });
      });
      tx();
      return res.json({ id, invoice_number: number, client_id: invoiceClientId, period_type: periodType, period_start: periodStart, period_end: periodEnd, total_hours: preview.totalHours, hourly_rate: hourlyRate, total_amount: preview.totalAmount, status: 'draft', created_at: createdAt, timesheets: rows, lines: preview.lines });
    }

    await pool.query('BEGIN');
    const rows = await findApprovedInvoiceTimesheets({ clientId, periodStart, periodEnd, lock: true });
    if (rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(400).json({ error: 'No approved uninvoiced timesheets found for this period' });
    }
    const invoiceClientId = clientId || rows[0].client_id;
    if (!clientId && rows.some(r => r.client_id !== invoiceClientId)) {
      await pool.query('ROLLBACK');
      return res.status(400).json({ error: 'Select a client when multiple clients have approved timesheets in the period' });
    }
    const preview = invoicePreviewPayload(rows, { hourlyRate, overtimeWeekRate, overtimeWeekendRate, overtimeBankHolidayRate });
    await pool.query('INSERT INTO invoices(id,invoice_number,client_id,period_type,period_start,period_end,total_hours,hourly_rate,total_amount,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [id, number, invoiceClientId, periodType, periodStart, periodEnd, preview.totalHours, hourlyRate, preview.totalAmount, 'draft', createdAt]);
    for (const line of preview.lines) {
      await pool.query('INSERT INTO invoice_lines(id,invoice_id,timesheet_id,staff_id,work_date,hours,hourly_rate,overtime_week_hours,overtime_week_rate,overtime_weekend_hours,overtime_weekend_rate,overtime_bank_holiday_hours,overtime_bank_holiday_rate,line_amount,notes,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)', [crypto.randomUUID(), id, line.timesheet_id, line.staff_id, line.work_date, line.hours, line.hourly_rate, line.overtime_week_hours, line.overtime_week_rate, line.overtime_weekend_hours, line.overtime_weekend_rate, line.overtime_bank_holiday_hours, line.overtime_bank_holiday_rate, line.line_amount, line.notes, createdAt]);
    }
    await pool.query('UPDATE timesheets SET status=$1, invoice_id=$2, invoiced_at=$3, updated_at=$4::timestamptz WHERE id = ANY($5)', ['invoiced', id, createdAt, createdAt, rows.map(r => r.id)]);
    for (const r of rows) {
      await logTimesheetEvent(r.id, req.user.id, 'invoiced', r.status, 'invoiced', `Locked to invoice ${number}.`);
    }
    await pool.query('COMMIT');
    res.json({ id, invoice_number: number, client_id: invoiceClientId, period_type: periodType, period_start: periodStart, period_end: periodEnd, total_hours: preview.totalHours, hourly_rate: hourlyRate, total_amount: preview.totalAmount, status: 'draft', created_at: createdAt, timesheets: rows, lines: preview.lines });
  } catch (e) {
    if (!useSqlite) { try { await pool.query('ROLLBACK'); } catch (_) {} }
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Owner: list invoices with client names.
app.get('/api/invoices', authMiddleware, async (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Forbidden' });
  try {
    if (useSqlite) {
      const rows = sqliteDb.prepare(`SELECT i.*, u.name as client_name, u.email as client_email FROM invoices i LEFT JOIN users u ON u.id = i.client_id ORDER BY i.created_at DESC`).all();
      return res.json(rows);
    }
    const r = await pool.query(`SELECT i.*, u.name as client_name, u.email as client_email FROM invoices i LEFT JOIN users u ON u.id = i.client_id ORDER BY i.created_at DESC`);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Owner: invoice detail including the timesheets locked to it.
app.get('/api/invoices/:id', authMiddleware, async (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Forbidden' });
  try {
    if (useSqlite) {
      const invoice = sqliteDb.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
      if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
      const timesheets = sqliteDb.prepare('SELECT * FROM timesheets WHERE invoice_id = ? ORDER BY date').all(req.params.id);
      const lines = sqliteDb.prepare('SELECT il.*, u.name as staff_name, u.email as staff_email FROM invoice_lines il LEFT JOIN users u ON u.id = il.staff_id WHERE il.invoice_id = ? ORDER BY il.work_date, u.name').all(req.params.id);
      return res.json({ ...invoice, timesheets, lines });
    }
    const invoice = await pool.query('SELECT * FROM invoices WHERE id=$1', [req.params.id]);
    if (invoice.rowCount === 0) return res.status(404).json({ error: 'Invoice not found' });
    const timesheets = await pool.query('SELECT * FROM timesheets WHERE invoice_id=$1 ORDER BY date', [req.params.id]);
    const lines = await pool.query('SELECT il.*, u.name as staff_name, u.email as staff_email FROM invoice_lines il LEFT JOIN users u ON u.id = il.staff_id WHERE il.invoice_id=$1 ORDER BY il.work_date, u.name', [req.params.id]);
    res.json({ ...invoice.rows[0], timesheets: timesheets.rows, lines: lines.rows });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

const dbReady = initDb();

if (process.env.VERCEL) {
  module.exports = async (req, res) => {
    try {
      await dbReady;
      return app(req, res);
    } catch (err) {
      console.error('DB init error', err);
      res.statusCode = 500;
      res.end('Server initialization failed');
    }
  };
} else {
  dbReady
    .then(() => {
      app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
    })
    .catch(err => {
      console.error('DB init error', err);
      process.exit(1);
    });
}


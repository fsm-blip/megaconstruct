#!/usr/bin/env node
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const requiredAlways = ['PORT', 'JWT_SECRET', 'OWNER_EMAIL'];
const requiredProduction = ['DATABASE_URL'];
const recommendedLocal = ['DATABASE_URL'];
const frontendRequired = ['VITE_API_URL'];

function has(name) {
  return Boolean((process.env[name] || '').trim());
}

function line(status, name, detail = '') {
  console.log(`${status} ${name}${detail ? ` - ${detail}` : ''}`);
}

let failed = false;
console.log('Backend environment check (values are not printed)');
for (const name of requiredAlways) {
  if (has(name)) line('OK ', name);
  else {
    line('ERR', name, 'required');
    failed = true;
  }
}

if (process.env.NODE_ENV === 'production') {
  for (const name of requiredProduction) {
    if (has(name)) line('OK ', name);
    else {
      line('ERR', name, 'required in production');
      failed = true;
    }
  }
} else {
  for (const name of recommendedLocal) {
    if (has(name)) line('OK ', name);
    else line('INFO', name, 'not set; backend will use local SQLite fallback');
  }
}

console.log('\nFrontend environment reminder');
for (const name of frontendRequired) {
  line('REQ', `frontend/client/.env:${name}`, name === 'VITE_API_URL' ? 'set to backend URL, e.g. http://localhost:3000' : 'required');
}

if (failed) process.exit(1);

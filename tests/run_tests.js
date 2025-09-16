const axios = require('axios');

const BASE = process.env.BASE || 'http://localhost:3000';

async function main() {
  console.log('Running integration test against', BASE);
  // login owner
  const ownerRes = await axios.post(`${BASE}/api/login`, { email: process.env.OWNER_EMAIL || 'tsvet.spasov', password: process.env.OWNER_PASSWORD || 'viki_2505' });
  const ownerToken = ownerRes.data.token;
  console.log('Owner token:', !!ownerToken);

  // create staff & client
  const staff = await axios.post(`${BASE}/api/users`, { name: 'IT Staff', email: 'it.staff@example.com', password: 'staffpass', role: 'staff' }, { headers: { Authorization: `Bearer ${ownerToken}` } });
  const client = await axios.post(`${BASE}/api/users`, { name: 'ACME Client', email: 'acme@example.com', password: 'clientpass', role: 'client' }, { headers: { Authorization: `Bearer ${ownerToken}` } });
  console.log('Created staff/client', staff.data.id, client.data.id);

  // staff login
  const sL = await axios.post(`${BASE}/api/login`, { email: 'it.staff@example.com', password: 'staffpass' });
  const sToken = sL.data.token;

  // submit timesheet
  const ts = await axios.post(`${BASE}/api/timesheets`, { date: '2025-09-13', hours: 7.5, clientId: client.data.id, notes: 'Integration test' }, { headers: { Authorization: `Bearer ${sToken}` } });
  console.log('Submitted', ts.data.id);

  // client login
  const cL = await axios.post(`${BASE}/api/login`, { email: 'acme@example.com', password: 'clientpass' });
  const cToken = cL.data.token;

  // client approve
  await axios.post(`${BASE}/api/timesheets/${ts.data.id}/approve`, {}, { headers: { Authorization: `Bearer ${cToken}` } });
  console.log('Approved');

  // owner list approved
  const ok = await axios.get(`${BASE}/api/timesheets/approved`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  if (ok.data.find(t => t.id === ts.data.id)) console.log('Integration test passed'); else { console.error('Not found'); process.exit(1); }

  // delete the staff user
  await axios.delete(`${BASE}/api/users/${staff.data.id}`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  console.log('Deleted staff');

  // request password reset for client
  await axios.post(`${BASE}/api/password-reset/request`, { email: 'acme@example.com' });
  console.log('Requested password reset for client (check logs/emails for token)');

  // clear timesheet by id
  await axios.delete(`${BASE}/api/timesheets/${ts.data.id}`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  console.log('Deleted timesheet');

  // create another timesheet and clear all
  const staff2 = await axios.post(`${BASE}/api/users`, { name: 'Temp Staff', email: 'temp.staff@example.com', password: 'tp', role: 'staff' }, { headers: { Authorization: `Bearer ${ownerToken}` } });
  const sL2 = await axios.post(`${BASE}/api/login`, { email: 'temp.staff@example.com', password: 'tp' });
  const sToken2 = sL2.data.token;
  const ts2 = await axios.post(`${BASE}/api/timesheets`, { date: '2025-09-13', hours: 4, clientId: client.data.id, notes: 'Second' }, { headers: { Authorization: `Bearer ${sToken2}` } });
  await axios.post(`${BASE}/api/timesheets/${ts2.data.id}/approve`, {}, { headers: { Authorization: `Bearer ${cToken}` } });
  await axios.delete(`${BASE}/api/timesheets`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  console.log('Cleared all timesheets');
}

main().catch(err => { console.error(err.response ? err.response.data : err.message); process.exit(1); });

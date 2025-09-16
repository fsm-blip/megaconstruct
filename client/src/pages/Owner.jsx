import React, { useState, useEffect } from 'react'
import axios from 'axios'
const API = import.meta.env.VITE_API_URL || ''
export default function OwnerPage({ token }) {
  const [users, setUsers] = useState([])
  const [times, setTimes] = useState([])
  useEffect(()=>{ if (token) { loadUsers(); loadTimes(); } }, [token])
  async function loadUsers() { const r = await axios.get(`${API}/api/users`, { headers: { Authorization: `Bearer ${token}` } }); setUsers(r.data) }
  async function loadTimes() { const r = await axios.get(`${API}/api/timesheets/approved`, { headers: { Authorization: `Bearer ${token}` } }); setTimes(r.data) }
  return (
    <div className="card">
      <h3>Owner (React) Console</h3>
      <button onClick={loadUsers}>Refresh users</button>
      <ul>{users.map(u=> <li key={u.id}>{u.name} ({u.email}) - {u.role}</li>)}</ul>
      <h4>Approved</h4>
      <button onClick={loadTimes}>Refresh times</button>
      <ul>{times.map(t=> <li key={t.id}>{t.date} - {t.hours}h</li>)}</ul>
    </div>
  )
}

import React, { useState, useEffect } from 'react'
import axios from 'axios'
const API = import.meta.env.VITE_API_URL || ''

export default function StaffPage({ token }) {
  const [clients, setClients] = useState([])
  const [date, setDate] = useState('')
  const [hours, setHours] = useState(8)
  const [clientId, setClientId] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(()=>{ if (token) loadClients(); }, [token])
  async function loadClients() {
    const res = await axios.get(`${API}/api/clients`, { headers: { Authorization: `Bearer ${token}` } })
    setClients(res.data)
    if (res.data[0]) setClientId(res.data[0].id)
  }
  async function submit() {
    try {
      await axios.post(`${API}/api/timesheets`, { date, hours, clientId, notes }, { headers: { Authorization: `Bearer ${token}` } })
      alert('Submitted')
    } catch (e) { alert('Failed') }
  }
  return (
    <div className="card">
      <h3>Staff (React) - Submit</h3>
      <select value={clientId} onChange={e=>setClientId(e.target.value)}>
        {clients.map(c=> <option key={c.id} value={c.id}>{c.name} ({c.email})</option>)}
      </select>
      <input placeholder="date" value={date} onChange={e=>setDate(e.target.value)} />
      <input placeholder="hours" value={hours} onChange={e=>setHours(e.target.value)} />
      <textarea placeholder="notes" value={notes} onChange={e=>setNotes(e.target.value)} />
      <button onClick={submit}>Submit</button>
    </div>
  )
}

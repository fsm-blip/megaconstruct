import React, { useState, useEffect } from 'react'
import axios from 'axios'
const API = import.meta.env.VITE_API_URL || ''

export default function StaffPage({ token }) {
  const [clients, setClients] = useState([])
  const [date, setDate] = useState('')
  const [hours, setHours] = useState(8)
  const [clientId, setClientId] = useState('')
  const [notes, setNotes] = useState('')
  const [history, setHistory] = useState([])
  const [editingId, setEditingId] = useState('')

  useEffect(()=>{ if (token) { loadClients(); loadHistory() } }, [token])

  async function loadClients() {
    const res = await axios.get(`${API}/api/clients`, { headers: { Authorization: `Bearer ${token}` } })
    setClients(res.data)
    if (res.data[0]) setClientId(res.data[0].id)
  }

  async function loadHistory() {
    try {
      const res = await axios.get(`${API}/api/timesheets/staff`, { headers: { Authorization: `Bearer ${token}` } })
      setHistory(res.data)
    } catch (e) { console.error('loadHistory', e) }
  }

  function resetForm() {
    setDate('')
    setHours(8)
    setNotes('')
    setEditingId('')
  }

  function editReturned(t) {
    setEditingId(t.id)
    setClientId(t.client_id || t.clientId || clientId)
    setDate(t.date || '')
    setHours(t.hours || 8)
    setNotes(t.notes || '')
  }

  async function submit() {
    try {
      if (editingId) {
        await axios.patch(`${API}/api/timesheets/${editingId}`, { date, hours, notes }, { headers: { Authorization: `Bearer ${token}` } })
        await axios.post(`${API}/api/timesheets/${editingId}/submit`, {}, { headers: { Authorization: `Bearer ${token}` } })
        alert('Updated and resubmitted')
      } else {
        await axios.post(`${API}/api/timesheets`, { date, hours, clientId, notes }, { headers: { Authorization: `Bearer ${token}` } })
        alert('Submitted')
      }
      resetForm()
      loadHistory()
    } catch (e) {
      console.error('submit', e)
      alert(e.response?.data?.error || 'Failed')
    }
  }

  return (
    <div className="card">
      <h3>Staff (React) - {editingId ? 'Edit returned timesheet' : 'Submit'}</h3>
      {!editingId && (
        <select value={clientId} onChange={e=>setClientId(e.target.value)}>
          {clients.map(c=> <option key={c.id} value={c.id}>{c.name} ({c.email})</option>)}
        </select>
      )}
      <input placeholder="date" value={date} onChange={e=>setDate(e.target.value)} />
      <input placeholder="hours" value={hours} onChange={e=>setHours(e.target.value)} />
      <textarea placeholder="notes" value={notes} onChange={e=>setNotes(e.target.value)} />
      <button onClick={submit}>{editingId ? 'Update and resubmit' : 'Submit'}</button>
      {editingId && <button onClick={resetForm} style={{marginLeft:8}}>Cancel edit</button>}

      <hr />
      <h4>My timesheets</h4>
      <button onClick={loadHistory}>Refresh history</button>
      {history.length === 0 ? <p>No timesheets yet</p> : (
        <ul>
          {history.map(t => (
            <li key={t.id}>
              {t.date} - {t.hours}h - {t.status} - {t.notes}
              {t.return_reason && <div><strong>Return reason:</strong> {t.return_reason}</div>}
              {t.status === 'returned' && <button onClick={()=>editReturned(t)}>Edit and resubmit</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

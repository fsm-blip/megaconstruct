import React, { useState, useEffect } from 'react'
import axios from 'axios'
const API = import.meta.env.VITE_API_URL || ''

export default function ClientPage({ token }) {
  const [list, setList] = useState([])
  const [history, setHistory] = useState([])
  const [staffMap, setStaffMap] = useState({})

  useEffect(() => { if (token) { loadStaffs(); load(); loadHistory() } }, [token])

  async function loadStaffs() {
    try {
      const res = await axios.get(`${API}/api/staffs`, { headers: { Authorization: `Bearer ${token}` } })
      const map = {}
      res.data.forEach(s => { const label = `${s.name} (${s.email})`; map[s.id] = label; map[String(s.id)] = label })
      setStaffMap(map)
    } catch (e) { console.error('loadStaffs', e) }
  }

  async function load() {
    try {
      const res = await axios.get(`${API}/api/timesheets/pending`, { headers: { Authorization: `Bearer ${token}` } })
      setList(res.data)
    } catch (e) { console.error('load pending', e) }
  }

  async function loadHistory() {
    try {
      const res = await axios.get(`${API}/api/timesheets/client/history`, { headers: { Authorization: `Bearer ${token}` } })
      setHistory(res.data)
    } catch (e) { console.error('load history', e) }
  }

  async function approve(id) {
    try {
      await axios.post(`${API}/api/timesheets/${id}/approve`, {}, { headers: { Authorization: `Bearer ${token}` } })
      alert('Approved')
      load(); loadHistory()
    } catch (e) { alert(e.response?.data?.error || 'Approve failed') }
  }

  async function returnTimesheet(id) {
    const reason = prompt('Why are you returning this timesheet?')
    if (!reason || !reason.trim()) return
    try {
      await axios.post(`${API}/api/timesheets/${id}/return`, { reason }, { headers: { Authorization: `Bearer ${token}` } })
      alert('Returned to staff')
      load(); loadHistory()
    } catch (e) { alert(e.response?.data?.error || 'Return failed') }
  }

  function staffName(t) {
    const sid = (t.staff_id || t.staffId || '') + ''
    return t.staff_name || staffMap[sid] || staffMap[Number(sid)] || sid || 'unknown'
  }

  return (
    <div className="card">
      <h3>Client (React): Pending approvals</h3>
      <button onClick={()=>{ load(); loadHistory() }}>Refresh</button>
      {list.length === 0 ? <p>No pending timesheets</p> : (
        <ul>
          {list.map(t=> (
            <li key={t.id}>
              {t.date} - {t.hours}h by {staffName(t)} - {t.notes}
              <button onClick={()=>approve(t.id)} style={{marginLeft:8}}>Approve</button>
              <button onClick={()=>returnTimesheet(t.id)} style={{marginLeft:8}}>Return</button>
            </li>
          ))}
        </ul>
      )}

      <hr />
      <h4>Reviewed timesheets</h4>
      {history.length === 0 ? <p>No reviewed timesheets</p> : (
        <ul>
          {history.map(t => (
            <li key={t.id}>
              {t.date} - {t.hours}h by {staffName(t)} - {t.status}
              {t.return_reason && <div><strong>Return reason:</strong> {t.return_reason}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

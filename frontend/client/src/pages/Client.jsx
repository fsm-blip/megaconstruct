import React, { useState, useEffect } from 'react'
import axios from 'axios'
const API = import.meta.env.VITE_API_URL || ''

export default function ClientPage({ token }) {
  const [list, setList] = useState([])
  const [staffMap, setStaffMap] = useState({})

  useEffect(() => { if (token) loadStaffs(); }, [token])

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

  async function approve(id) {
    try {
      await axios.post(`${API}/api/timesheets/${id}/approve`, {}, { headers: { Authorization: `Bearer ${token}` } })
      alert('Approved')
      load()
    } catch (e) { alert('Approve failed') }
  }

  return (
    <div className="card">
      <h3>Client (React): Pending</h3>
      <button onClick={load}>Refresh</button>
      <ul>
        {list.map(t=> {
          const sid = (t.staff_id || t.staffId || '') + ''
          const staffName = t.staff_name || staffMap[sid] || staffMap[Number(sid)] || sid || 'unknown'
          return <li key={t.id}>{t.date} - {t.hours}h by {staffName} - <button onClick={()=>approve(t.id)}>Approve</button></li>
        })}
      </ul>
    </div>
  )
}

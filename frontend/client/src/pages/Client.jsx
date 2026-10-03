import React, { useState, useEffect } from 'react'
import axios from 'axios'
const API = import.meta.env.VITE_API_URL || ''
const cleanDate = value => value ? String(value).slice(0, 10) : ''
const cleanDateTime = value => value ? new Date(value).toLocaleString() : ''
const h = value => Number(value || 0)

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

  function timeSummary(t) {
    return `${h(t.hours)}h standard, ${h(t.overtime_week_hours || t.overtimeWeekHours)}h OT weekday, ${h(t.overtime_weekend_hours || t.overtimeWeekendHours)}h OT weekend, ${h(t.overtime_bank_holiday_hours || t.overtimeBankHolidayHours)}h OT bank holiday`
  }

  return (
    <div className="panel-card">
      <div className="section-heading">
        <div>
          <h3>Client approvals</h3>
          <p>Approve or return submitted staff timesheets.</p>
        </div>
        <button className="secondary" onClick={()=>{ load(); loadHistory() }}>Refresh</button>
      </div>
      {list.length === 0 ? <p>No pending timesheets</p> : (
        <ul className="record-list">
          {list.map(t=> (
            <li key={t.id}>
              <strong>{cleanDate(t.date)}</strong> — {timeSummary(t)} by {staffName(t)} — {t.notes}
              <div className="button-row compact"><button onClick={()=>approve(t.id)}>Approve</button><button className="secondary" onClick={()=>returnTimesheet(t.id)}>Return</button></div>
            </li>
          ))}
        </ul>
      )}

      <hr />
      <h4>Reviewed timesheets</h4>
      {history.length === 0 ? <p>No reviewed timesheets</p> : (
        <ul className="record-list">
          {history.map(t => (
            <li key={t.id}>
              <strong>{cleanDate(t.date)}</strong> — {timeSummary(t)} by {staffName(t)} — {t.status}
              {(t.latest_client_event_type || t.approved_at || t.returned_at) && <div><strong>Client action:</strong> {t.latest_client_event_type || (t.approved_at ? 'approved' : 'returned')} {cleanDateTime(t.latest_client_event_at || t.approved_at || t.returned_at)}</div>}
              {t.approved_at && <div><strong>Approved at:</strong> {cleanDateTime(t.approved_at)}</div>}
              {t.return_reason && <div><strong>Return reason:</strong> {t.return_reason}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

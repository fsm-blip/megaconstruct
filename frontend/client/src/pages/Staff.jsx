import React, { useState, useEffect } from 'react'
import axios from 'axios'
const API = import.meta.env.VITE_API_URL || ''
const cleanDate = value => value ? String(value).slice(0, 10) : ''
const moneyHours = value => Number(value || 0)

export default function StaffPage({ token, user }) {
  const [clients, setClients] = useState([])
  const [date, setDate] = useState('')
  const [hours, setHours] = useState(8)
  const [overtimeWeekHours, setOvertimeWeekHours] = useState(0)
  const [overtimeWeekendHours, setOvertimeWeekendHours] = useState(0)
  const [overtimeBankHolidayHours, setOvertimeBankHolidayHours] = useState(0)
  const [clientId, setClientId] = useState('')
  const [notes, setNotes] = useState('')
  const [history, setHistory] = useState([])
  const [editingId, setEditingId] = useState('')

  useEffect(()=>{ if (token) { loadClients(); loadHistory() } }, [token])

  async function loadClients() {
    const res = await axios.get(`${API}/api/clients`, { headers: { Authorization: `Bearer ${token}` } })
    const assignedClientId = user?.client_id || user?.clientId
    const visibleClients = assignedClientId ? res.data.filter(c => c.id === assignedClientId) : []
    setClients(visibleClients)
    if (visibleClients[0]) setClientId(visibleClients[0].id)
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
    setOvertimeWeekHours(0)
    setOvertimeWeekendHours(0)
    setOvertimeBankHolidayHours(0)
    setNotes('')
    setEditingId('')
  }

  function editReturned(t) {
    setEditingId(t.id)
    setClientId(t.client_id || t.clientId || clientId)
    setDate(cleanDate(t.date || t.period_start || t.periodStart))
    setHours(t.hours || 8)
    setOvertimeWeekHours(t.overtime_week_hours || t.overtimeWeekHours || 0)
    setOvertimeWeekendHours(t.overtime_weekend_hours || t.overtimeWeekendHours || 0)
    setOvertimeBankHolidayHours(t.overtime_bank_holiday_hours || t.overtimeBankHolidayHours || 0)
    setNotes(t.notes || '')
  }

  function payload() {
    return { date, hours, clientId, notes, overtimeWeekHours, overtimeWeekendHours, overtimeBankHolidayHours }
  }

  async function submit() {
    try {
      if (editingId) {
        await axios.patch(`${API}/api/timesheets/${editingId}`, payload(), { headers: { Authorization: `Bearer ${token}` } })
        await axios.post(`${API}/api/timesheets/${editingId}/submit`, {}, { headers: { Authorization: `Bearer ${token}` } })
        alert('Updated and resubmitted')
      } else {
        await axios.post(`${API}/api/timesheets`, payload(), { headers: { Authorization: `Bearer ${token}` } })
        alert('Submitted')
      }
      resetForm()
      loadHistory()
    } catch (e) {
      console.error('submit', e)
      alert(e.response?.data?.error || 'Failed')
    }
  }

  function overtimeLabel(t) {
    const week = moneyHours(t.overtime_week_hours || t.overtimeWeekHours)
    const weekend = moneyHours(t.overtime_weekend_hours || t.overtimeWeekendHours)
    const bank = moneyHours(t.overtime_bank_holiday_hours || t.overtimeBankHolidayHours)
    return `OT weekday ${week}h, weekend ${weekend}h, bank holiday ${bank}h`
  }

  return (
    <div className="panel-card">
      <div className="section-heading">
        <div>
          <h3>Staff timesheet</h3>
          <p>{editingId ? 'Edit the returned timesheet and resubmit it.' : 'Submit regular and overtime hours to your assigned client.'}</p>
        </div>
      </div>

      {clients.length === 0 ? <p className="notice danger">No assigned client found. Ask the owner to assign this staff account to a client.</p> : (
        <div className="form-grid">
          {!editingId && (
            <label>Assigned client
              <select value={clientId} onChange={e=>setClientId(e.target.value)} disabled>
                {clients.map(c=> <option key={c.id} value={c.id}>{c.name} ({c.email})</option>)}
              </select>
            </label>
          )}
          <label>Work date<input type="date" value={date} onChange={e=>setDate(e.target.value)} /></label>
          <label>Standard hours<input type="number" min="0" step="0.25" value={hours} onChange={e=>setHours(e.target.value)} /></label>
          <label>Overtime weekday hours<input type="number" min="0" step="0.25" value={overtimeWeekHours} onChange={e=>setOvertimeWeekHours(e.target.value)} /></label>
          <label>Overtime weekend hours<input type="number" min="0" step="0.25" value={overtimeWeekendHours} onChange={e=>setOvertimeWeekendHours(e.target.value)} /></label>
          <label>Overtime bank holiday hours<input type="number" min="0" step="0.25" value={overtimeBankHolidayHours} onChange={e=>setOvertimeBankHolidayHours(e.target.value)} /></label>
          <label className="span-2">Notes<textarea placeholder="notes" value={notes} onChange={e=>setNotes(e.target.value)} /></label>
          <div className="button-row span-2">
            <button onClick={submit}>{editingId ? 'Update and resubmit' : 'Submit timesheet'}</button>
            {editingId && <button className="secondary" onClick={resetForm}>Cancel edit</button>}
          </div>
        </div>
      )}

      <hr />
      <div className="section-heading">
        <div><h4>My timesheets</h4><p>Returned rows can be edited and resubmitted.</p></div>
        <button className="secondary" onClick={loadHistory}>Refresh history</button>
      </div>
      {history.length === 0 ? <p>No timesheets yet</p> : (
        <ul className="record-list">
          {history.map(t => (
            <li key={t.id}>
              <strong>{cleanDate(t.date)}</strong> — {t.hours}h standard — {overtimeLabel(t)} — {t.status} — {t.notes}
              {t.return_reason && <div><strong>Return reason:</strong> {t.return_reason}</div>}
              {t.status === 'returned' && <button onClick={()=>editReturned(t)}>Edit and resubmit</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

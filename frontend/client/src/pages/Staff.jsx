import React, { useState, useEffect } from 'react'
import axios from 'axios'
const API = import.meta.env.VITE_API_URL || ''
const cleanDate = value => value ? String(value).slice(0, 10) : ''
const gbp = value => `£${Number(value || 0).toFixed(2)}`
const SHIFT_LABELS = { day: 'Day', night: 'Night', bank_holiday_day: 'Bank holiday day', bank_holiday_night: 'Bank holiday night' }

function addDays(isoDate, days) {
  if (!isoDate) return ''
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function shiftMultiplier(date, type) {
  if (!date || !type) return 0
  if (type === 'bank_holiday_day' || type === 'bank_holiday_night') return 2
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  if (day === 0) return 2
  if (day === 6) return type === 'night' ? 2 : 1.5
  return type === 'night' ? 1.5 : 1
}

function parseShiftPayload(value) {
  if (!value) return {}
  try {
    const rows = typeof value === 'string' ? JSON.parse(value) : value
    if (!Array.isArray(rows)) return {}
    return rows.reduce((acc, row) => { if (row.date && row.shiftType) acc[row.date] = row.shiftType; return acc }, {})
  } catch (_) { return {} }
}

export default function StaffPage({ token, user }) {
  const [clients, setClients] = useState([])
  const [weekStart, setWeekStart] = useState('')
  const [dayRate] = useState(495)
  const [shifts, setShifts] = useState({})
  const [clientId, setClientId] = useState('')
  const [notes, setNotes] = useState('')
  const [history, setHistory] = useState([])
  const [editingId, setEditingId] = useState('')

  useEffect(()=>{ if (token) { loadClients(); loadHistory() } }, [token])

  async function loadClients() {
    const res = await axios.get(`${API}/api/clients`, { headers: { Authorization: `Bearer ${token}` } })
    const assignedClientId = user?.client_id || user?.clientId
    const visibleClients = user?.role === 'staff' ? (assignedClientId ? res.data.filter(c => c.id === assignedClientId) : []) : res.data
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
    setWeekStart('')
    setShifts({})
    setNotes('')
    setEditingId('')
  }

  function editReturned(t) {
    setEditingId(t.id)
    setClientId(t.client_id || t.clientId || clientId)
    setWeekStart(cleanDate(t.period_start || t.periodStart || t.date))
    setShifts(parseShiftPayload(t.shift_payload || t.shiftPayload))
    setNotes(t.notes || '')
  }

  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).filter(Boolean)
  const selectedRows = weekDates.map(date => ({ date, type: shifts[date], multiplier: shiftMultiplier(date, shifts[date]) })).filter(r => r.type)
  const totalAmount = selectedRows.reduce((sum, r) => sum + (dayRate * r.multiplier), 0)

  function setShift(date, type) {
    setShifts(current => {
      const next = { ...current }
      if (type) next[date] = type
      else delete next[date]
      return next
    })
  }

  function payload() {
    return { weekStart, dayRate, shifts, clientId, notes }
  }

  async function submit() {
    if (!weekStart) return alert('Select week start')
    if (selectedRows.length === 0) return alert('Select at least one shift in the week')
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

  function timesheetLabel(t) {
    if ((t.pricing_model || t.pricingModel) === 'weekly_shift') {
      return `${cleanDate(t.period_start || t.periodStart || t.date)} to ${cleanDate(t.period_end || t.periodEnd)} — ${Number(t.shift_count || t.shiftCount || t.hours || 0)} shift(s) — ${t.status}`
    }
    return `${cleanDate(t.date)} — ${t.hours}h standard — ${t.status}`
  }

  return (
    <div className="panel-card">
      <div className="section-heading">
        <div>
          <h3>{user?.role === 'staff' ? 'Interim weekly timesheet' : 'Consultant weekly timesheet'}</h3>
          <p>{editingId ? 'Edit the returned weekly timesheet and resubmit it.' : 'Submit a weekly timesheet. The owner will see calculated prices; submitters only enter worked shifts.'}</p>
        </div>
      </div>

      {clients.length === 0 ? <p className="notice danger">No assigned client found. Ask the owner to assign this interim account to a client.</p> : (
        <div className="form-grid">
          {!editingId && (
            <label>Assigned client
              <select value={clientId} onChange={e=>setClientId(e.target.value)} disabled>
                {clients.map(c=> <option key={c.id} value={c.id}>{c.name} ({c.email})</option>)}
              </select>
            </label>
          )}
          <label>Week start<input type="date" value={weekStart} onChange={e=>{ setWeekStart(e.target.value); setShifts({}) }} /></label>
          <div className="span-2 inline-panel">
            <h4>Weekly shifts</h4>
            <p>Weeknight and Saturday day = x1.5. Sunday day, Saturday night, Sunday night, bank holiday day/night = x2.</p>
            {weekDates.length === 0 ? <p>Select a week start to enter shifts.</p> : weekDates.map(date => (
              <label key={date}>{date}
                <select value={shifts[date] || ''} onChange={e=>setShift(date, e.target.value)}>
                  <option value="">Not worked</option>
                  <option value="day">Day shift x{shiftMultiplier(date, 'day')}</option>
                  <option value="night">Night shift x{shiftMultiplier(date, 'night')}</option>
                  <option value="bank_holiday_day">Bank holiday day x2</option>
                  <option value="bank_holiday_night">Bank holiday night x2</option>
                </select>
              </label>
            ))}
            <p><strong>Selected:</strong> {selectedRows.length} shift(s)</p>
          </div>
          <label className="span-2">Notes<textarea placeholder="notes" value={notes} onChange={e=>setNotes(e.target.value)} /></label>
          <div className="button-row span-2">
            <button onClick={submit}>{editingId ? 'Update and resubmit' : 'Submit weekly timesheet'}</button>
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
              <strong>{timesheetLabel(t)}</strong>{t.notes ? ` — ${t.notes}` : ''}
              {t.shiftSummary && <div>{t.shiftSummary}</div>}
              {t.return_reason && <div><strong>Return reason:</strong> {t.return_reason}</div>}
              {t.status === 'returned' && <button onClick={()=>editReturned(t)}>Edit and resubmit</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

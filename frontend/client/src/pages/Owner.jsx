import React, { useState, useEffect } from 'react'
import axios from 'axios'
const API = import.meta.env.VITE_API_URL || ''
const cleanDate = value => value ? String(value).slice(0, 10) : ''
const n = value => Number(value || 0)
const gbp = value => `£${Number(value || 0).toFixed(2)}`

function addDays(isoDate, days) {
  if (!isoDate) return ''
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function endOfMonth(isoDate) {
  if (!isoDate) return ''
  const d = new Date(`${isoDate}T00:00:00Z`)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10)
}

export default function OwnerPage({ token }) {
  const [activeTab, setActiveTab] = useState('summary')
  const [users, setUsers] = useState([])
  const [times, setTimes] = useState([])
  const [clients, setClients] = useState([])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('staff')
  const [assignClient, setAssignClient] = useState('')
  const [viewMode, setViewMode] = useState('pending')
  const [invoices, setInvoices] = useState([])
  const [invoicePeriodType, setInvoicePeriodType] = useState('weekly')
  const [invoiceClientId, setInvoiceClientId] = useState('')
  const [invoiceStart, setInvoiceStart] = useState('')
  const [invoiceEnd, setInvoiceEnd] = useState('')
  const [invoiceRate, setInvoiceRate] = useState('')
  const [overtimeWeekRate, setOvertimeWeekRate] = useState('')
  const [overtimeWeekendRate, setOvertimeWeekendRate] = useState('')
  const [overtimeBankHolidayRate, setOvertimeBankHolidayRate] = useState('')
  const [invoicePreview, setInvoicePreview] = useState(null)
  const [selectedInvoice, setSelectedInvoice] = useState(null)
  const [summary, setSummary] = useState(null)

  useEffect(()=>{ if (token) { refreshAll() } }, [token])

  function headers() { return { Authorization: `Bearer ${token}` } }
  function refreshAll() { loadUsers(); loadClients(); loadSummary(); loadTimes(viewMode); loadInvoices() }
  function invoicePayload() {
    return { clientId: invoiceClientId, periodType: invoicePeriodType, periodStart: invoiceStart, periodEnd: invoiceEnd, hourlyRate: Number(invoiceRate), overtimeWeekRate: Number(overtimeWeekRate || 0), overtimeWeekendRate: Number(overtimeWeekendRate || 0), overtimeBankHolidayRate: Number(overtimeBankHolidayRate || 0) }
  }
  function setPeriodType(value) { setInvoicePeriodType(value); if (invoiceStart) setInvoiceEnd(value === 'monthly' ? endOfMonth(invoiceStart) : addDays(invoiceStart, 6)); setInvoicePreview(null) }
  function setPeriodStart(value) { setInvoiceStart(value); setInvoiceEnd(value ? (invoicePeriodType === 'monthly' ? endOfMonth(value) : addDays(value, 6)) : ''); setInvoicePreview(null) }

  async function loadUsers() { try { const r = await axios.get(`${API}/api/users`, { headers: headers() }); setUsers(r.data) } catch (e) { console.error('loadUsers', e); alert('Failed loading users') } }
  async function loadSummary() { try { const r = await axios.get(`${API}/api/owner/summary`, { headers: headers() }); setSummary(r.data) } catch (e) { console.error('loadSummary', e) } }
  async function loadClients() {
    try {
      const r = await axios.get(`${API}/api/clients`, { headers: headers() })
      setClients(r.data)
      if (r.data[0]) { setAssignClient(current => current && r.data.some(c => c.id === current) ? current : r.data[0].id); setInvoiceClientId(current => current && r.data.some(c => c.id === current) ? current : r.data[0].id) }
      else { setAssignClient(''); setInvoiceClientId('') }
    } catch (e) { console.error('loadClients', e) }
  }
  async function loadTimes(mode = 'pending') { try { const url = mode === 'pending' ? `${API}/api/timesheets/owner/pending` : `${API}/api/timesheets/approved`; const r = await axios.get(url, { headers: headers() }); setTimes(r.data) } catch (e) { console.error('loadTimes', e); alert('Failed loading times') } }
  async function loadInvoices() { try { const r = await axios.get(`${API}/api/invoices`, { headers: headers() }); setInvoices(r.data) } catch (e) { console.error('loadInvoices', e); alert('Failed loading invoices') } }

  async function createUser() {
    if (!name || !email || !password || !role) return alert('Please fill all fields')
    try {
      const payload = { name, email, password, role }
      if (role === 'staff' && assignClient) payload.clientId = assignClient
      await axios.post(`${API}/api/users`, payload, { headers: headers() })
      alert('User created (invitation sent)')
      setName(''); setEmail(''); setPassword(''); setRole('staff')
      loadUsers(); loadClients(); loadSummary()
    } catch (e) { console.error('createUser', e); alert(e.response?.data?.error || 'Create failed') }
  }

  async function previewInvoice() {
    if (!invoiceClientId || !invoiceStart || !invoiceEnd || !invoiceRate) return alert('Select client, period and standard hourly rate')
    try { const r = await axios.post(`${API}/api/invoices/preview`, invoicePayload(), { headers: headers() }); setInvoicePreview(r.data) }
    catch (e) { console.error('previewInvoice', e); alert(e.response?.data?.error || 'Invoice preview failed') }
  }
  async function generateInvoice() {
    if (!invoiceClientId || !invoiceStart || !invoiceEnd || !invoiceRate) return alert('Select client, period and standard hourly rate')
    if (!invoicePreview || invoicePreview.count === 0) return alert('Preview the invoice first and confirm it has approved uninvoiced timesheets')
    try {
      const r = await axios.post(`${API}/api/invoices/generate`, invoicePayload(), { headers: headers() })
      alert('Draft invoice generated')
      setInvoicePreview(null); setSelectedInvoice(r.data)
      loadInvoices(); loadTimes(viewMode); loadSummary()
    } catch (e) { console.error('generateInvoice', e); alert(e.response?.data?.error || 'Invoice generation failed') }
  }
  async function viewInvoice(id) { try { const r = await axios.get(`${API}/api/invoices/${id}`, { headers: headers() }); setSelectedInvoice(r.data) } catch (e) { console.error('viewInvoice', e); alert('Failed loading invoice detail') } }

  async function deleteUser(id) {
    if (!confirm('Delete this user?')) return
    try { await axios.delete(`${API}/api/users/${id}`, { headers: headers() }); alert('User deleted'); refreshAll() }
    catch (e) {
      if (e.response && e.response.status === 409) {
        const proceed = confirm('User has non-invoiced timesheets. Delete user and associated timesheets?')
        if (proceed) { try { await axios.delete(`${API}/api/users/${id}?force=true`, { headers: headers() }); alert('User deleted (with timesheets)'); refreshAll(); return } catch (err) { console.error('force delete', err); alert(err.response?.data?.error || 'Force delete failed') } }
      }
      console.error('deleteUser', e); alert(e.response?.data?.error || 'Delete failed')
    }
  }

  async function deleteTimesheet(id) {
    if (!confirm('Delete this timesheet?')) return
    try { await axios.delete(`${API}/api/timesheets/${id}`, { headers: headers() }); loadTimes(viewMode); loadSummary() } catch (e) { alert(e.response?.data?.error || 'Failed') }
  }

  const userMap = users.reduce((acc, u) => { acc[u.id] = u; return acc }, {})
  const grouped = times.reduce((acc, t) => { acc[t.staff_id] = acc[t.staff_id] || []; acc[t.staff_id].push(t); return acc }, {})
  const previewLines = invoicePreview?.lines || []
  const detailLines = selectedInvoice?.lines || []
  const summaryValue = (group, key, field = 'count') => Number((summary?.[group] || []).find(r => r.status === key || r.role === key)?.[field] || 0)
  const totalUsers = (summary?.users || []).reduce((sum, r) => sum + Number(r.count || 0), 0)
  const totalInvoiceAmount = (summary?.invoices || []).reduce((sum, r) => sum + Number(r.amount || 0), 0)
  const otText = t => `${n(t.overtime_week_hours || t.overtimeWeekHours)}h weekday OT, ${n(t.overtime_weekend_hours || t.overtimeWeekendHours)}h weekend OT, ${n(t.overtime_bank_holiday_hours || t.overtimeBankHolidayHours)}h bank holiday OT`
  const lineText = l => `${cleanDate(l.work_date)} - ${l.staff_name || l.staff_id} - ${n(l.hours)}h x ${gbp(l.hourly_rate)} + OT ${n(l.overtime_week_hours)}h/${gbp(l.overtime_week_rate)}, ${n(l.overtime_weekend_hours)}h/${gbp(l.overtime_weekend_rate)}, ${n(l.overtime_bank_holiday_hours)}h/${gbp(l.overtime_bank_holiday_rate)} = ${gbp(l.line_amount)}`

  return (
    <div className="panel-card owner-console">
      <div className="section-heading">
        <div><h3>Owner Console</h3><p>Oversight, users, timesheets, and invoice operations.</p></div>
        <button className="secondary" onClick={refreshAll}>Refresh all</button>
      </div>
      <div className="tabs">
        {['summary','users','timesheets','invoices'].map(tab => <button key={tab} className={activeTab === tab ? 'active' : 'secondary'} onClick={()=>setActiveTab(tab)}>{tab[0].toUpperCase()+tab.slice(1)}</button>)}
      </div>

      {activeTab === 'summary' && summary && (
        <div className="summary-grid">
          <div className="metric-card"><span>Pending approval</span><strong>{summaryValue('timesheets', 'submitted')}</strong></div>
          <div className="metric-card"><span>Returned</span><strong>{summaryValue('timesheets', 'returned')}</strong></div>
          <div className="metric-card"><span>Approved uninvoiced</span><strong>{summaryValue('timesheets', 'approved')} / {summaryValue('timesheets', 'approved', 'hours')}h</strong></div>
          <div className="metric-card"><span>Invoiced value</span><strong>{gbp(totalInvoiceAmount)}</strong></div>
          <div className="metric-card"><span>Users</span><strong>{totalUsers}</strong></div>
          <div className="metric-card"><span>Staff</span><strong>{summaryValue('users', 'staff')}</strong></div>
          <div className="metric-card"><span>Clients</span><strong>{summaryValue('users', 'client')}</strong></div>
          <div className="metric-card"><span>Draft invoices</span><strong>{summaryValue('invoices', 'draft')}</strong></div>
        </div>
      )}

      {activeTab === 'users' && (
        <div className="two-column">
          <section>
            <h4>Create user</h4>
            <div className="form-grid single">
              <input placeholder="name" value={name} onChange={e=>setName(e.target.value)} />
              <input placeholder="email" value={email} onChange={e=>setEmail(e.target.value)} />
              <input placeholder="password" value={password} onChange={e=>setPassword(e.target.value)} />
              <select value={role} onChange={e=>setRole(e.target.value)}><option value="staff">staff</option><option value="client">client</option></select>
              {role === 'staff' && <label>Assign client<select value={assignClient} onChange={e=>setAssignClient(e.target.value)}>{clients.map(c=> <option key={c.id} value={c.id}>{c.name} ({c.email})</option>)}</select></label>}
              <button onClick={createUser}>Create</button>
            </div>
          </section>
          <section>
            <div className="section-heading"><h4>Users</h4><button className="secondary" onClick={loadUsers}>Refresh users</button></div>
            <ul className="record-list">{users.map(u => <li key={u.id}><strong>{u.name}</strong> ({u.email}) — {u.role} {u.client_id ? `— assigned client ${userMap[u.client_id]?.name || u.client_id}` : ''}<button onClick={()=>deleteUser(u.id)}>Delete</button></li>)}</ul>
          </section>
        </div>
      )}

      {activeTab === 'timesheets' && (
        <section>
          <div className="section-heading"><div><h4>Timesheets</h4><p>Review pending or approved-uninvoiced rows. Invoiced rows are locked to invoices.</p></div><div className="button-row"><button onClick={()=>{ setViewMode('pending'); loadTimes('pending') }}>Load pending</button><button className="secondary" onClick={()=>{ setViewMode('approved'); loadTimes('approved') }}>Load approved uninvoiced</button><button className="danger" onClick={()=>{ if (confirm('Delete ALL timesheets? This is permanent.')) { axios.delete(`${API}/api/timesheets`, { headers: headers() }).then(()=>{ loadTimes(viewMode); loadSummary() }).catch(()=>alert('Failed')) } }}>Delete all timesheets</button></div></div>
          {Object.keys(grouped).length === 0 ? <p>No timesheets</p> : Object.keys(grouped).map(staffId => <div key={staffId} className="group-block"><h5>Staff: {userMap[staffId]?.name || staffId}</h5><ul className="record-list">{grouped[staffId].map(t => <li key={t.id}><strong>{cleanDate(t.date)}</strong> — {n(t.hours)}h standard — {otText(t)} — {t.status} — Client: {userMap[t.client_id]?.name || t.client_id}<div>{t.notes}</div>{t.return_reason && <div><strong>Return reason:</strong> {t.return_reason}</div>}<button onClick={()=>deleteTimesheet(t.id)}>Delete</button></li>)}</ul></div>)}
        </section>
      )}

      {activeTab === 'invoices' && (
        <div className="two-column invoices-layout">
          <section>
            <h4>Generate draft invoice</h4>
            <div className="form-grid single">
              <select value={invoiceClientId} onChange={e=>{ setInvoiceClientId(e.target.value); setInvoicePreview(null) }}><option value="">Select client</option>{clients.map(c=> <option key={c.id} value={c.id}>{c.name} ({c.email})</option>)}</select>
              <select value={invoicePeriodType} onChange={e=>setPeriodType(e.target.value)}><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select>
              <label>Period start<input type="date" value={invoiceStart} onChange={e=>setPeriodStart(e.target.value)} /></label>
              <label>Period end<input type="date" value={invoiceEnd} onChange={e=>{ setInvoiceEnd(e.target.value); setInvoicePreview(null) }} /></label>
              <input placeholder="standard hourly rate" value={invoiceRate} onChange={e=>{ setInvoiceRate(e.target.value); setInvoicePreview(null) }} />
              <input placeholder="overtime weekday hourly rate" value={overtimeWeekRate} onChange={e=>{ setOvertimeWeekRate(e.target.value); setInvoicePreview(null) }} />
              <input placeholder="overtime weekend hourly rate" value={overtimeWeekendRate} onChange={e=>{ setOvertimeWeekendRate(e.target.value); setInvoicePreview(null) }} />
              <input placeholder="overtime bank holiday hourly rate" value={overtimeBankHolidayRate} onChange={e=>{ setOvertimeBankHolidayRate(e.target.value); setInvoicePreview(null) }} />
              <button onClick={previewInvoice}>Preview invoice</button><button onClick={generateInvoice}>Generate draft invoice</button><button className="secondary" onClick={loadInvoices}>Refresh invoices</button>
            </div>
            {invoicePreview && <div className="inline-panel"><h5>Invoice preview</h5>{invoicePreview.count === 0 ? <p>{invoicePreview.message || 'No approved uninvoiced timesheets found.'}</p> : <><p>{invoicePreview.count} line(s), {n(invoicePreview.totalHours)}h standard, {n(invoicePreview.totalOvertimeWeekHours)}h weekday OT, {n(invoicePreview.totalOvertimeWeekendHours)}h weekend OT, {n(invoicePreview.totalOvertimeBankHolidayHours)}h bank holiday OT, {gbp(invoicePreview.totalAmount)}</p><ul className="record-list compact-list">{previewLines.map(l => <li key={l.timesheet_id}>{lineText(l)}</li>)}</ul></>}</div>}
          </section>
          <section>
            <h4>Invoices</h4>
            {invoices.length === 0 ? <p>No invoices yet</p> : <ul className="record-list">{invoices.map(i => <li key={i.id}><strong>{i.invoice_number}</strong> — {i.client_name || i.client_id} — {cleanDate(i.period_start)} to {cleanDate(i.period_end)} — {n(i.total_hours)}h — {gbp(i.total_amount)} — {i.status}<button onClick={()=>viewInvoice(i.id)}>View</button></li>)}</ul>}
            {selectedInvoice && <div className="inline-panel"><h5>Invoice detail</h5><p>{selectedInvoice.invoice_number} — {cleanDate(selectedInvoice.period_start)} to {cleanDate(selectedInvoice.period_end)} — {n(selectedInvoice.total_hours)}h — {gbp(selectedInvoice.total_amount)} — {selectedInvoice.status}</p>{detailLines.length > 0 ? <ul className="record-list compact-list">{detailLines.map(l => <li key={l.id || l.timesheet_id}>{lineText(l)} {l.notes ? `— ${l.notes}` : ''}</li>)}</ul> : <p>No invoice line detail stored for this invoice.</p>}</div>}
          </section>
        </div>
      )}
    </div>
  )
}

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

function Modal({ title, onClose, children, wide = false }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal-card ${wide ? 'wide' : ''}`} onClick={e=>e.stopPropagation()}>
        <div className="section-heading"><h3>{title}</h3><button className="secondary" onClick={onClose}>Close</button></div>
        {children}
      </div>
    </div>
  )
}

export default function OwnerPage({ token }) {
  const [activeTab, setActiveTab] = useState('summary')
  const [peopleTab, setPeopleTab] = useState('clients')
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
  const [invoicePreview, setInvoicePreview] = useState(null)
  const [selectedInvoice, setSelectedInvoice] = useState(null)
  const [summary, setSummary] = useState(null)
  const [showCreateUser, setShowCreateUser] = useState(false)
  const [showGenerateInvoice, setShowGenerateInvoice] = useState(false)
  const [showInvoiceDetail, setShowInvoiceDetail] = useState(false)

  useEffect(()=>{ if (token) refreshAll() }, [token])

  function headers() { return { Authorization: `Bearer ${token}` } }
  function refreshAll() { loadUsers(); loadClients(); loadSummary(); loadTimes(viewMode); loadInvoices() }
  function invoicePayload() { return { clientId: invoiceClientId, periodType: invoicePeriodType, periodStart: invoiceStart, periodEnd: invoiceEnd } }
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
      if (['staff','consultant'].includes(role) && assignClient) payload.clientId = assignClient
      await axios.post(`${API}/api/users`, payload, { headers: headers() })
      alert('User created (invitation sent)')
      setName(''); setEmail(''); setPassword(''); setRole('staff'); setShowCreateUser(false)
      loadUsers(); loadClients(); loadSummary()
    } catch (e) { console.error('createUser', e); alert(e.response?.data?.error || 'Create failed') }
  }

  async function previewInvoice() {
    if (!invoiceClientId || !invoiceStart || !invoiceEnd) return alert('Select client and period')
    try { const r = await axios.post(`${API}/api/invoices/preview`, invoicePayload(), { headers: headers() }); setInvoicePreview(r.data) }
    catch (e) { console.error('previewInvoice', e); alert(e.response?.data?.error || 'Invoice preview failed') }
  }
  async function generateInvoice() {
    if (!invoiceClientId || !invoiceStart || !invoiceEnd) return alert('Select client and period')
    if (!invoicePreview || invoicePreview.count === 0) return alert('Preview the invoice first and confirm it has approved uninvoiced timesheets')
    try {
      const r = await axios.post(`${API}/api/invoices/generate`, invoicePayload(), { headers: headers() })
      alert('Invoice generated')
      setInvoicePreview(null); setSelectedInvoice(r.data); setShowGenerateInvoice(false); setShowInvoiceDetail(true)
      loadInvoices(); loadTimes(viewMode); loadSummary()
    } catch (e) { console.error('generateInvoice', e); alert(e.response?.data?.error || 'Invoice generation failed') }
  }
  async function viewInvoice(id) { try { const r = await axios.get(`${API}/api/invoices/${id}`, { headers: headers() }); setSelectedInvoice(r.data); setShowInvoiceDetail(true) } catch (e) { console.error('viewInvoice', e); alert('Failed loading invoice detail') } }

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
  async function deleteTimesheet(id) { if (!confirm('Delete this timesheet?')) return; try { await axios.delete(`${API}/api/timesheets/${id}`, { headers: headers() }); loadTimes(viewMode); loadSummary() } catch (e) { alert(e.response?.data?.error || 'Failed') } }

  const ownerUsers = users.filter(u => u.role === 'owner')
  const staffUsers = users.filter(u => u.role === 'staff')
  const consultantUsers = users.filter(u => u.role === 'consultant')
  const clientUsers = users.filter(u => u.role === 'client')
  const manageableUsers = users.filter(u => u.role !== 'owner')
  const userMap = users.reduce((acc, u) => { acc[u.id] = u; return acc }, {})
  const submittersByClient = clientUsers.reduce((acc, c) => { acc[c.id] = [...staffUsers, ...consultantUsers].filter(s => s.client_id === c.id); return acc }, {})
  const staffByClient = clientUsers.reduce((acc, c) => { acc[c.id] = staffUsers.filter(s => s.client_id === c.id); return acc }, {})
  const consultantsByClient = clientUsers.reduce((acc, c) => { acc[c.id] = consultantUsers.filter(s => s.client_id === c.id); return acc }, {})
  const unassignedStaff = staffUsers.filter(s => !s.client_id || !userMap[s.client_id])
  const unassignedConsultants = consultantUsers.filter(s => !s.client_id || !userMap[s.client_id])
  const grouped = times.reduce((acc, t) => { acc[t.staff_id] = acc[t.staff_id] || []; acc[t.staff_id].push(t); return acc }, {})
  const previewLines = invoicePreview?.lines || []
  const detailLines = selectedInvoice?.lines || []
  const summaryValue = (group, key, field = 'count') => Number((summary?.[group] || []).find(r => r.status === key || r.role === key)?.[field] || 0)
  const managedUserCount = manageableUsers.length
  const totalInvoiceAmount = (summary?.invoices || []).reduce((sum, r) => sum + Number(r.amount || 0), 0)
  const otText = t => (t.pricing_model || t.pricingModel) === 'weekly_shift' ? `${n(t.shift_count || t.shiftCount || t.hours)} shift(s), net ${gbp(t.calculated_amount || t.calculatedAmount)}, consultant ${gbp(t.consultant_fee_amount || t.consultantFeeAmount)}, interim ${gbp(t.interim_amount || t.interimAmount)}, VAT ${gbp(t.vat_amount || t.vatAmount)}, total ${gbp(t.invoice_amount || t.invoiceAmount || t.calculated_amount || t.calculatedAmount)}` : `${n(t.overtime_week_hours || t.overtimeWeekHours)}h weekday OT, ${n(t.overtime_weekend_hours || t.overtimeWeekendHours)}h weekend OT, ${n(t.overtime_bank_holiday_hours || t.overtimeBankHolidayHours)}h bank holiday OT`
  const lineText = l => `${cleanDate(l.work_date)} - ${l.staff_name || l.staff_id} - ${n(l.hours)} shift/day(s) x ${gbp(l.hourly_rate)} = ${gbp(l.line_amount)}${l.notes ? ` — ${l.notes}` : ''}`

  const createUserForm = (
    <div className="form-grid single">
      <input placeholder="name" value={name} onChange={e=>setName(e.target.value)} />
      <input placeholder="email" value={email} onChange={e=>setEmail(e.target.value)} />
      <input placeholder="password" value={password} onChange={e=>setPassword(e.target.value)} />
      <select value={role} onChange={e=>setRole(e.target.value)}><option value="staff">interim</option><option value="consultant">consultant</option><option value="client">client</option></select>
      {['staff','consultant'].includes(role) && <label>Assign client<select value={assignClient} onChange={e=>setAssignClient(e.target.value)}>{clients.map(c=> <option key={c.id} value={c.id}>{c.name} ({c.email})</option>)}</select></label>}
      <button onClick={createUser}>Create</button>
    </div>
  )

  const invoiceGenerator = (
    <div className="form-grid single">
      <select value={invoiceClientId} onChange={e=>{ setInvoiceClientId(e.target.value); setInvoicePreview(null) }}><option value="">Select client</option>{clients.map(c=> <option key={c.id} value={c.id}>{c.name} ({c.email})</option>)}</select>
      <select value={invoicePeriodType} onChange={e=>setPeriodType(e.target.value)}><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select>
      <label>Period start<input type="date" value={invoiceStart} onChange={e=>setPeriodStart(e.target.value)} /></label>
      <label>Period end<input type="date" value={invoiceEnd} onChange={e=>{ setInvoiceEnd(e.target.value); setInvoicePreview(null) }} /></label>
      <p className="notice">Rates are calculated automatically from approved timesheets.</p>
      <div className="button-row"><button onClick={previewInvoice}>Preview invoice</button><button onClick={generateInvoice}>Generate invoice</button></div>
      {invoicePreview && <div className="inline-panel"><h5>Invoice preview</h5>{invoicePreview.count === 0 ? <p>{invoicePreview.message || 'No approved uninvoiced timesheets found.'}</p> : <><p>{invoicePreview.count} line(s), {n(invoicePreview.totalHours)} shift/day(s), {gbp(invoicePreview.totalAmount)}</p><ul className="record-list compact-list">{previewLines.map(l => <li key={l.timesheet_id}>{lineText(l)}</li>)}</ul></>}</div>}
    </div>
  )

  const invoiceDetail = selectedInvoice && (
    <div className="inline-panel flat"><p><strong>{selectedInvoice.invoice_number}</strong> — {cleanDate(selectedInvoice.period_start)} to {cleanDate(selectedInvoice.period_end)} — {n(selectedInvoice.total_hours)}h — {gbp(selectedInvoice.total_amount)} — {selectedInvoice.status}</p>{detailLines.length > 0 ? <ul className="record-list compact-list">{detailLines.map(l => <li key={l.id || l.timesheet_id}>{lineText(l)} {l.notes ? `— ${l.notes}` : ''}</li>)}</ul> : <p>No invoice line detail stored for this invoice.</p>}</div>
  )

  return (
    <div className="panel-card owner-console">
      <div className="section-heading"><div><h3>Owner Console</h3><p>Oversight, users, timesheets, and invoice operations.</p></div><button className="secondary" onClick={refreshAll}>Refresh all</button></div>
      <div className="tabs">{['summary','users','timesheets','invoices'].map(tab => <button key={tab} className={activeTab === tab ? 'active' : 'secondary'} onClick={()=>setActiveTab(tab)}>{tab[0].toUpperCase()+tab.slice(1)}</button>)}</div>

      {activeTab === 'summary' && summary && <div className="summary-grid">
        <div className="metric-card"><span>Pending approval</span><strong>{summaryValue('timesheets', 'submitted')}</strong></div><div className="metric-card"><span>Returned</span><strong>{summaryValue('timesheets', 'returned')}</strong></div><div className="metric-card"><span>Approved uninvoiced</span><strong>{summaryValue('timesheets', 'approved')} / {summaryValue('timesheets', 'approved', 'hours')}h</strong></div><div className="metric-card"><span>Invoiced value</span><strong>{gbp(totalInvoiceAmount)}</strong></div><div className="metric-card"><span>Managed users</span><strong>{managedUserCount}</strong></div><div className="metric-card"><span>Interim</span><strong>{staffUsers.length}</strong></div><div className="metric-card"><span>Consultants</span><strong>{consultantUsers.length}</strong></div><div className="metric-card"><span>Clients</span><strong>{clientUsers.length}</strong></div><div className="metric-card"><span>Draft invoices</span><strong>{summaryValue('invoices', 'draft')}</strong></div>
      </div>}

      {activeTab === 'users' && <section>
        <div className="section-heading"><div><h4>People</h4><p>Owners are kept out of operational user management. Clients, interim workers and consultants show their assignments.</p></div><div className="button-row"><button onClick={()=>setShowCreateUser(true)}>Create user</button><button className="secondary" onClick={loadUsers}>Refresh users</button></div></div>
        {ownerUsers.length > 0 && <p className="notice">Owner account is excluded from the operational lists: {ownerUsers.map(o => o.email).join(', ')}</p>}
        <div className="tabs compact-tabs"><button className={peopleTab === 'clients' ? 'active' : 'secondary'} onClick={()=>setPeopleTab('clients')}>Clients</button><button className={peopleTab === 'staff' ? 'active' : 'secondary'} onClick={()=>setPeopleTab('staff')}>Interim</button><button className={peopleTab === 'consultants' ? 'active' : 'secondary'} onClick={()=>setPeopleTab('consultants')}>Consultants</button></div>
        {peopleTab === 'clients' && <ul className="record-list">{clientUsers.map(c => <li key={c.id}><strong>{c.name}</strong> ({c.email}) — Joined: {cleanDate(c.joined_at) || 'n/a'} — {staffByClient[c.id]?.length || 0} interim, {consultantsByClient[c.id]?.length || 0} consultant(s){submittersByClient[c.id]?.length > 0 && <div className="chips">{submittersByClient[c.id].map(s => <span key={s.id}>{s.name} ({s.email}) — {s.role === 'staff' ? 'interim' : s.role}</span>)}</div>}<button onClick={()=>deleteUser(c.id)}>Delete client</button></li>)}</ul>}
        {peopleTab === 'staff' && <ul className="record-list">{staffUsers.map(s => <li key={s.id}><strong>{s.name}</strong> ({s.email}) — Joined: {cleanDate(s.joined_at) || 'n/a'} — assigned client: {userMap[s.client_id]?.name || 'Unassigned'}{!userMap[s.client_id] && <span className="badge danger-badge">needs assignment</span>}<button onClick={()=>deleteUser(s.id)}>Delete interim</button></li>)}{unassignedStaff.length === 0 && staffUsers.length === 0 && <li>No interim users.</li>}</ul>}

        {peopleTab === 'consultants' && <ul className="record-list">{consultantUsers.map(c => <li key={c.id}><strong>{c.name}</strong> ({c.email}) — Joined: {cleanDate(c.joined_at) || 'n/a'} — assigned client: {userMap[c.client_id]?.name || 'Unassigned'}{!userMap[c.client_id] && <span className="badge danger-badge">needs assignment</span>}<button onClick={()=>deleteUser(c.id)}>Delete consultant</button></li>)}{unassignedConsultants.length === 0 && consultantUsers.length === 0 && <li>No consultant users.</li>}</ul>}
      </section>}

      {activeTab === 'timesheets' && <section>
        <div className="section-heading"><div><h4>Timesheets</h4><p>Review pending or approved rows. Invoiced rows are locked to invoices.</p></div><div className="button-row"><button onClick={()=>{ setViewMode('pending'); loadTimes('pending') }}>Pending</button><button className="secondary" onClick={()=>{ setViewMode('approved'); loadTimes('approved') }}>Approved</button></div></div>
        {Object.keys(grouped).length === 0 ? <p>No timesheets</p> : Object.keys(grouped).map(staffId => <div key={staffId} className="group-block"><h5>Submitter: {userMap[staffId]?.name || staffId}</h5><ul className="record-list">{grouped[staffId].map(t => <li key={t.id}><strong>{cleanDate(t.period_start || t.periodStart || t.date)}{(t.period_end || t.periodEnd) ? ` to ${cleanDate(t.period_end || t.periodEnd)}` : ''}</strong> — {otText(t)} — {t.status} — Client: {userMap[t.client_id]?.name || t.client_id}<div>{t.notes}</div>{t.shiftSummary && <div>{t.shiftSummary}</div>}{t.return_reason && <div><strong>Return reason:</strong> {t.return_reason}</div>}<button onClick={()=>deleteTimesheet(t.id)}>Delete</button></li>)}</ul></div>)}
      </section>}

      {activeTab === 'invoices' && <section>
        <div className="section-heading"><div><h4>Invoices</h4><p>Invoice generation and invoice detail open in modal pages to keep this tab clean.</p></div><div className="button-row"><button onClick={()=>setShowGenerateInvoice(true)}>Generate invoice</button><button className="secondary" onClick={loadInvoices}>Refresh invoices</button></div></div>
        {invoices.length === 0 ? <p>No invoices yet</p> : <ul className="record-list">{invoices.map(i => <li key={i.id}><strong>{i.invoice_number}</strong> — {i.client_name || i.client_id} — {cleanDate(i.period_start)} to {cleanDate(i.period_end)} — {n(i.total_hours)}h — {gbp(i.total_amount)} — {i.status}<button onClick={()=>viewInvoice(i.id)}>View detail</button></li>)}</ul>}
      </section>}

      {showCreateUser && <Modal title="Create user" onClose={()=>setShowCreateUser(false)}>{createUserForm}</Modal>}
      {showGenerateInvoice && <Modal title="Generate invoice" onClose={()=>setShowGenerateInvoice(false)} wide>{invoiceGenerator}</Modal>}
      {showInvoiceDetail && selectedInvoice && <Modal title="Invoice detail" onClose={()=>setShowInvoiceDetail(false)} wide>{invoiceDetail}</Modal>}
    </div>
  )
}

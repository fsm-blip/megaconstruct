import React, { useState } from 'react'
import axios from 'axios'
import StaffPage from './pages/Staff'
import ClientPage from './pages/Client'
import OwnerPage from './pages/Owner'

const API = import.meta.env.VITE_API_URL || ''

function Login({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('staff')
  const [resetEmail, setResetEmail] = useState('')

  async function handleLogin(e) {
    e.preventDefault()
    try {
      const res = await axios.post(`${API}/api/login`, { email, password })
      onLogin(res.data)
    } catch (e) {
      alert('Login failed')
    }
  }

  async function requestReset(e) {
    e.preventDefault()
    if (!resetEmail) return alert('Enter email')
    try {
      await axios.post(`${API}/api/password-reset/request`, { email: resetEmail })
      alert('If that email exists, a reset link was sent')
      setResetEmail('')
    } catch (e) { alert('Request failed') }
  }

  return (
    <form onSubmit={handleLogin} className="card">
      <h3>Login</h3>
      <input placeholder="email" value={email} onChange={e=>setEmail(e.target.value)} />
      <input placeholder="password" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
      <select value={role} onChange={e=>setRole(e.target.value)}>
        <option value="staff">Staff</option>
        <option value="client">Client</option>
        <option value="owner">Owner</option>
      </select>
      <button type="submit">Login</button>
      <div style={{marginTop:10}}>
        <h4>Forgot password</h4>
        <input placeholder="email" value={resetEmail} onChange={e=>setResetEmail(e.target.value)} />
        <button onClick={requestReset}>Request password reset</button>
      </div>
    </form>
  )
}

function StaffPanel({ token }) {
  const [clientId, setClientId] = useState('')
  const [date, setDate] = useState('')
  const [hours, setHours] = useState(8)
  const [notes, setNotes] = useState('')

  async function submit() {
    try {
      await axios.post(`${API}/api/timesheets`, { date, hours, clientId, notes }, { headers: { Authorization: `Bearer ${token}` } })
      alert('Submitted')
    } catch (e) { alert('Fail') }
  }

  return (
    <div className="card">
      <h3>Staff: Submit Timesheet</h3>
      <input placeholder="clientId" value={clientId} onChange={e=>setClientId(e.target.value)} />
      <input placeholder="date" value={date} onChange={e=>setDate(e.target.value)} />
      <input placeholder="hours" value={hours} onChange={e=>setHours(e.target.value)} />
      <textarea placeholder="notes" value={notes} onChange={e=>setNotes(e.target.value)} />
      <button onClick={submit}>Submit</button>
    </div>
  )
}

function ClientPanel({ token }) {
  const [list, setList] = useState([])
  async function load() {
    const res = await axios.get(`${API}/api/timesheets/pending`, { headers: { Authorization: `Bearer ${token}` } })
    setList(res.data)
  }
  async function approve(id) {
    await axios.post(`${API}/api/timesheets/${id}/approve`, {}, { headers: { Authorization: `Bearer ${token}` } })
    load()
  }
  return (
    <div className="card">
      <h3>Client: Pending</h3>
      <button onClick={load}>Refresh</button>
      <ul>
        {list.map(t=> (
          <li key={t.id}>{t.date} - {t.hours}h - <button onClick={()=>approve(t.id)}>Approve</button></li>
        ))}
      </ul>
    </div>
  )
}

function OwnerPanel({ token }) {
  const [timesheets, setTimesheets] = useState([])
  const [users, setUsers] = useState([])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('staff')

  async function loadTimesheets() {
    const res = await axios.get(`${API}/api/timesheets/approved`, { headers: { Authorization: `Bearer ${token}` } })
    // sort by approved_at or created_at descending
    const rows = res.data.sort((a,b)=> new Date(b.approved_at || b.created_at) - new Date(a.approved_at || a.created_at))
    setTimesheets(rows)
  }

  async function loadUsers() {
    const res = await axios.get(`${API}/api/users`, { headers: { Authorization: `Bearer ${token}` } })
    setUsers(res.data)
  }

  async function createUser() {
    try {
      await axios.post(`${API}/api/users`, { name, email, password, role }, { headers: { Authorization: `Bearer ${token}` } })
      alert('User created (invitation sent)')
      setName(''); setEmail(''); setPassword('')
      loadUsers()
    } catch (e) { alert('Create failed') }
  }

  async function deleteUser(id) {
    if (!confirm('Delete this user?')) return
    try {
      await axios.delete(`${API}/api/users/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      loadUsers()
    } catch (e) { alert('Delete failed') }
  }

  async function clearTimesheet(id) {
    if (id) {
      if (!confirm('Delete this timesheet?')) return
      await axios.delete(`${API}/api/timesheets/${id}`, { headers: { Authorization: `Bearer ${token}` } })
    } else {
      if (!confirm('Delete ALL timesheets?')) return
      await axios.delete(`${API}/api/timesheets`, { headers: { Authorization: `Bearer ${token}` } })
    }
    loadTimesheets()
  }

  // group timesheets by staff name
  const grouped = timesheets.reduce((acc, t) => {
    acc[t.staff_id] = acc[t.staff_id] || []
    acc[t.staff_id].push(t)
    return acc
  }, {})

  return (
    <div className="card">
      <h3>Owner Console</h3>
      <div style={{display:'flex',gap:12}}>
        <div style={{flex:1}}>
          <h4>Create user</h4>
          <input placeholder="name" value={name} onChange={e=>setName(e.target.value)} />
          <input placeholder="email" value={email} onChange={e=>setEmail(e.target.value)} />
          <input placeholder="password" value={password} onChange={e=>setPassword(e.target.value)} />
          <select value={role} onChange={e=>setRole(e.target.value)}>
            <option value="staff">staff</option>
            <option value="client">client</option>
          </select>
          <button onClick={createUser}>Create</button>
          <hr />
          <button onClick={loadUsers}>Refresh users</button>
          <ul>
            {users.map(u => (
              <li key={u.id}>{u.name} ({u.email}) - {u.role} <button onClick={()=>deleteUser(u.id)}>Delete</button></li>
            ))}
          </ul>
        </div>
        <div style={{flex:2}}>
          <h4>Approved timesheets (latest first)</h4>
          <button onClick={loadTimesheets}>Refresh</button>
          <button onClick={()=>clearTimesheet(null)} style={{marginLeft:8}}>Clear all timesheets</button>
          {Object.keys(grouped).length === 0 ? <p>No approved timesheets</p> : Object.keys(grouped).map(staffId => (
            <div key={staffId} style={{marginTop:12}}>
              <h5>Staff: {staffId} <button onClick={()=>{ /* no-op */ }}> </button></h5>
              <ul>
                {grouped[staffId].map(t => (
                  <li key={t.id}>{t.date} - {t.hours}h - {t.notes} <button onClick={()=>clearTimesheet(t.id)}>Delete</button></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState(null)
  const [token, setToken] = useState(null)

  function onLogin(data) {
    setUser(data.user); setToken(data.token)
  }

  return (
    <div className="app">
      {!user ? <Login onLogin={onLogin} /> : (
        <div>
          <h2>Welcome {user.name} ({user.role})</h2>
          {user.role === 'staff' && <StaffPage token={token} />}
          {user.role === 'client' && <ClientPage token={token} />}
          {user.role === 'owner' && <OwnerPage token={token} />}
        </div>
      )}
    </div>
  )
}

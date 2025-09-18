import React, { useState, useEffect } from 'react'
import axios from 'axios'
const API = import.meta.env.VITE_API_URL || ''
export default function OwnerPage({ token }) {
  const [users, setUsers] = useState([])
  const [times, setTimes] = useState([])
  const [clients, setClients] = useState([])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('staff')
  const [assignClient, setAssignClient] = useState('')
  const [viewMode, setViewMode] = useState('pending')

  useEffect(()=>{ if (token) { loadUsers(); loadClients(); loadTimes(); } }, [token])

  async function loadUsers() {
    try {
      const r = await axios.get(`${API}/api/users`, { headers: { Authorization: `Bearer ${token}` } })
      setUsers(r.data)
    } catch (e) { console.error('loadUsers', e); alert('Failed loading users') }
  }

  async function loadClients() {
    try {
      const r = await axios.get(`${API}/api/clients`, { headers: { Authorization: `Bearer ${token}` } })
      setClients(r.data)
      if (r.data[0]) setAssignClient(r.data[0].id)
    } catch (e) { console.error('loadClients', e) }
  }

  async function loadTimes(mode = 'pending') {
    try {
      const url = mode === 'pending' ? `${API}/api/timesheets/owner/pending` : `${API}/api/timesheets/approved`
      const r = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } })
      setTimes(r.data)
    } catch (e) { console.error('loadTimes', e); alert('Failed loading times') }
  }

  async function createUser() {
    if (!name || !email || !password || !role) return alert('Please fill all fields')
    try {
      const payload = { name, email, password, role }
      if (role === 'staff' && assignClient) payload.clientId = assignClient
      await axios.post(`${API}/api/users`, payload, { headers: { Authorization: `Bearer ${token}` } })
      alert('User created (invitation sent)')
      setName(''); setEmail(''); setPassword(''); setRole('staff')
      loadUsers(); loadClients()
    } catch (e) { console.error('createUser', e); alert('Create failed') }
  }

  async function deleteUser(id) {
    if (!confirm('Delete this user?')) return
    try {
      await axios.delete(`${API}/api/users/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      alert('User deleted')
      loadUsers()
    } catch (e) {
      if (e.response && e.response.status === 409) {
        const proceed = confirm('User has timesheets. Delete user and associated timesheets?')
        if (proceed) {
          try {
            await axios.delete(`${API}/api/users/${id}?force=true`, { headers: { Authorization: `Bearer ${token}` } })
            alert('User deleted (with timesheets)')
            loadUsers()
            return
          } catch (err) { console.error('force delete', err); alert('Force delete failed') }
        }
      }
      console.error('deleteUser', e)
      alert('Delete failed')
    }
  }

  // group timesheets by staff id and include friendly names when possible
  const userMap = users.reduce((acc, u) => { acc[u.id] = u; return acc }, {})
  const grouped = times.reduce((acc, t) => { acc[t.staff_id] = acc[t.staff_id] || []; acc[t.staff_id].push(t); return acc }, {})

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
          {role === 'staff' && (
            <div>
              <label>Assign client</label>
              <select value={assignClient} onChange={e=>setAssignClient(e.target.value)}>
                {clients.map(c=> <option key={c.id} value={c.id}>{c.name} ({c.email})</option>)}
              </select>
            </div>
          )}
          <button onClick={createUser}>Create</button>
          <hr />
          <button onClick={loadUsers}>Refresh users</button>
          <ul>
            {users.map(u => (
              <li key={u.id}>{u.name} ({u.email}) - {u.role} {u.client_id ? `(client ${u.client_id})` : ''} <button onClick={()=>deleteUser(u.id)}>Delete</button></li>
            ))}
          </ul>
        </div>
        <div style={{flex:2}}>
          <h4>Timesheets (Owner)</h4>
          <div style={{marginBottom:8}}>
            <button onClick={()=>{ setViewMode('pending'); loadTimes('pending') }}>Load pending</button>
            <button onClick={()=>{ setViewMode('approved'); loadTimes('approved') }} style={{marginLeft:8}}>Load approved</button>
            <button onClick={()=>{ if (confirm('Delete ALL timesheets?')) { axios.delete(`${API}/api/timesheets`, { headers: { Authorization: `Bearer ${token}` } }).then(()=>loadTimes(viewMode)).catch(()=>alert('Failed')) } }} style={{marginLeft:8}}>Clear all</button>
          </div>
          {Object.keys(grouped).length === 0 ? <p>No timesheets</p> : Object.keys(grouped).map(staffId => (
            <div key={staffId} style={{marginTop:12}}>
              <h5>Staff: {userMap[staffId] ? userMap[staffId].name : staffId}</h5>
              <ul>
                {grouped[staffId].map(t => (
                  <li key={t.id}>{t.date} - {t.hours}h - {t.notes} - Client: {userMap[t.client_id] ? userMap[t.client_id].name : t.client_id} <button onClick={()=>{ if (confirm('Delete this timesheet?')) axios.delete(`${API}/api/timesheets/${t.id}`, { headers: { Authorization: `Bearer ${token}` } }).then(()=>loadTimes(viewMode)).catch(()=>alert('Failed')) }}>Delete</button></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const axios = require('axios')
const API = process.env.API_URL || 'http://localhost:3000'

async function run() {
  try {
    // use seeded owner to request staff mapping
    console.log('POST', `${API}/api/login`)
    const login = await axios.post(`${API}/api/login`, { email: process.env.TEST_OWNER_EMAIL || 'tsvet.spasov', password: process.env.TEST_OWNER_PASSWORD || 'viki_2505' })
    const token = login.data.token
    if (!token) throw new Error('no token')
    console.log('login OK, token present')

    console.log('GET', `${API}/api/staffs`)
    let staffs
    try {
      staffs = await axios.get(`${API}/api/staffs`, { headers: { Authorization: `Bearer ${token}` } })
      console.log('staffs.length=' + (staffs.data.length || 0))
    } catch (e) {
      // fallback: some deployments may not expose /api/staffs; use /api/users and filter
      if (e.response && e.response.status === 404) {
        console.log('/api/staffs not present, falling back to /api/users')
        const all = await axios.get(`${API}/api/users`, { headers: { Authorization: `Bearer ${token}` } })
        const filtered = (all.data || []).filter(u => u.role === 'staff')
        console.log('staffs.length=' + (filtered.length || 0))
        if (!filtered.length) { console.error('No staffs found'); process.exit(2) }
      } else {
        throw e
      }
    }

    console.log('GET', `${API}/api/clients`)
    try {
      const clients = await axios.get(`${API}/api/clients`, { headers: { Authorization: `Bearer ${token}` } })
      console.log('clients.length=' + (clients.data.length || 0))
      if (!clients.data.length) { console.error('No clients found'); process.exit(3) }
    } catch (e) {
      if (e.response && e.response.status === 404) {
        console.log('/api/clients not present, falling back to /api/users')
        const all = await axios.get(`${API}/api/users`, { headers: { Authorization: `Bearer ${token}` } })
        const filtered = (all.data || []).filter(u => u.role === 'client')
        console.log('clients.length=' + (filtered.length || 0))
        if (!filtered.length) { console.error('No clients found'); process.exit(3) }
      } else {
        throw e
      }
    }

    console.log('SMOKE: OK')
    process.exit(0)
  } catch (e) {
    if (e.response) {
      console.error('Request failed:', e.response.status, e.response.data)
    } else {
      console.error('Request error:', e.message || e)
    }
    process.exit(1)
  }
}

run()

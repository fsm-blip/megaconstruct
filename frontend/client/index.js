// Minimal React-like app using direct DOM manipulation to avoid bundler for prototype
// This file is intentionally simple so you can open it in the browser via static server.

async function post(path, body, token){
  const res = await fetch(path, { method: 'POST', headers: {'content-type':'application/json', ...(token?{authorization:'Bearer '+token}: {})}, body: JSON.stringify(body) });
  return res.json();
}

async function get(path, token){
  const res = await fetch(path, { headers: {...(token?{authorization:'Bearer '+token}: {})} });
  return res.json();
}

function el(tag, attrs={}, children=[]) {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k,v])=>{ if (k==='text') e.textContent=v; else e.setAttribute(k,v) });
  (Array.isArray(children)?children:[children]).forEach(c=>{ if (!c) return; if (typeof c==='string') e.appendChild(document.createTextNode(c)); else e.appendChild(c)});
  return e;
}

const root = document.getElementById('root');
root.appendChild(el('h1',{text:'Mega Construct Portal (basic React-free client)'}));
root.appendChild(el('p',{text:'Use the /public pages for quick interactive prototype UI, or this minimal client.'}));

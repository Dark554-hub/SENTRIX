const $ = id => document.getElementById(id);
let T = '', registering = false, map = null, cities = [], markers = {};
try { T = localStorage.getItem('sx_token') || ''; } catch (e) { /* almacenamiento bloqueado */ }
const mxn = n => n == null ? '—' : (n < 0 ? '−$' : '$') + Math.abs(Number(n)).toLocaleString('es-MX');
const num = n => Number(n).toLocaleString('es-MX');
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

async function api(path, method = 'GET', body) {
  const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + T }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(Array.isArray(j.detail) ? 'Revisa los datos capturados' : (j.detail || 'Error ' + r.status));
  return j;
}

/* ---------- mapa (mismo estilo que el observatorio) ---------- */
async function initMap() {
  try { cities = (await (await fetch('/cities')).json()).cities; } catch (e) { cities = []; }
  if (!window.maplibregl) return;
  map = new maplibregl.Map({ container: 'map', style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    center: [-101.5, 23.6], zoom: 4.3, attributionControl: false, interactive: true, dragRotate: false });
  map.scrollZoom.disable();
  cities.forEach(c => {
    const e = el('div', 'mk');
    markers[c.ciudad] = { e, m: new maplibregl.Marker({ element: e }).setLngLat([c.lon, c.lat]).addTo(map), c };
  });
}
function focusCity(name) {
  Object.values(markers).forEach(x => x.e.classList.remove('sel'));
  const x = markers[name]; if (!x || !map) return;
  x.e.classList.add('sel');
  map.flyTo({ center: [x.c.lon, x.c.lat], zoom: 6.2, duration: 1800, essential: true });
}

/* ---------- acceso ---------- */
function setMode(reg) {
  registering = reg;
  $('f-title').textContent = reg ? 'Crea tu cuenta' : 'Entra a tu cuenta';
  $('f-go').firstChild.textContent = reg ? 'Crear cuenta ' : 'Entrar ';
  $('f-toggle').textContent = reg ? '¿Ya tienes cuenta? Entrar' : '¿No tienes cuenta? Crear una';
  document.querySelector('.reg').classList.toggle('hide', !reg);
  $('pw').autocomplete = reg ? 'new-password' : 'current-password';
  $('aerr').textContent = '';
}
$('f-toggle').addEventListener('click', () => setMode(!registering));
$('f-auth').addEventListener('submit', async e => {
  e.preventDefault(); $('aerr').textContent = ''; $('f-go').disabled = true;
  try {
    const j = await api('/auth/' + (registering ? 'register' : 'login'), 'POST',
      { email: $('email').value.trim(), password: $('pw').value, empresa: $('empresa').value.trim() });
    T = j.token; try { localStorage.setItem('sx_token', T); } catch (x) { /* ok */ }
    $('pw').value = ''; boot();
  } catch (x) { $('aerr').textContent = x.message; }
  $('f-go').disabled = false;
});
function logout() { try { localStorage.removeItem('sx_token'); } catch (e) { /* ok */ } T = ''; location.reload(); }
$('logout').addEventListener('click', logout);

/* ---------- sesión ---------- */
let ME = null;
async function boot() {
  if (!T) return;
  try {
    ME = await api('/me');
    $('v-out').classList.add('hide'); $('v-in').classList.remove('hide'); $('app').classList.remove('hide');
    document.querySelectorAll('.priv').forEach(a => a.classList.remove('hide'));
    $('who').textContent = ME.empresa || ME.email;
    $('a-idx').textContent = 'SENTRIX / ' + (ME.empresa || 'MI CUENTA').toUpperCase();
    $('a-t1').textContent = 'Tu operación,'; $('a-t2').textContent = 'en números.';
    $('ciudad').innerHTML = ''; cities.forEach(c => $('ciudad').appendChild(el('option', '', c.ciudad)));
    const s = await api('/settings');
    for (const k in s) if ($(k)) $(k).value = s[k];
    renderPlans(ME.plan); report();
  } catch (e) { logout(); }
}

async function save() {
  $('serr').textContent = ''; $('save').disabled = true;
  try {
    await api('/settings', 'PUT', { ciudad: $('ciudad').value, lam: +$('lam').value, margen_c: +$('margen_c').value,
      precio_agua_mxn_m3: +$('precio_agua_mxn_m3').value, precio_kwh_mxn: +$('precio_kwh_mxn').value,
      precio_escasez_mxn_m3: +$('precio_escasez_mxn_m3').value });
    $('opt').textContent = ''; await report();
    document.getElementById('ahorro').scrollIntoView({ behavior: 'smooth' });
  } catch (e) { $('serr').textContent = e.message; }
  $('save').disabled = false;
}
$('save').addEventListener('click', save);

async function report() {
  const box = $('kpis'); box.textContent = 'Calculando con el modelo…'; box.classList.add('mono');
  try {
    const { resultado: r } = await api('/report');
    box.classList.remove('mono'); box.textContent = '';
    const k = (v, l, neg) => { const d = el('div'); const b = el('b', neg ? 'neg' : '', v); d.append(b, el('span', 'mono', l)); return d; };
    box.append(k(num(r.agua_ahorrada_l) + ' L', 'agua ahorrada · ' + r.agua_ahorrada_pct + ' %'),
      k(mxn(r.ahorro_agua_mxn), 'valor del agua ahorrada'), k(mxn(r.costo_energia_extra_mxn), 'energía extra'),
      k(mxn(r.beneficio_neto_mxn), 'beneficio neto', r.beneficio_neto_mxn < 0));
    $('p-city').textContent = r.ciudad; $('q-pct').textContent = r.agua_ahorrada_pct + '%';
    $('q-l').textContent = num(r.agua_ahorrada_l); $('q-net').textContent = mxn(r.beneficio_neto_mxn);
    $('q-net').className = r.beneficio_neto_mxn < 0 ? 'neg' : '';
    $('q-plan').textContent = ME.plan_info.nombre;
    $('q-note').textContent = r.beneficio_neto_mxn < 0
      ? 'Con tus precios, ahorrar agua cuesta más en energía de lo que vale. Prueba el optimizador o el valor por escasez.'
      : r.horas_inseguras_evitables + ' horas inseguras evitables en 2026.';
    focusCity(r.ciudad);
  } catch (e) { box.classList.remove('mono'); box.textContent = e.message; }
}

/* ---------- optimizador ---------- */
$('opt-btn').addEventListener('click', async () => {
  const o = $('opt'); o.textContent = 'Probando configuraciones…'; o.className = 'opt mono';
  try {
    const r = await api('/report/optimize'); o.className = 'opt'; o.textContent = '';
    o.appendChild(el('p', 'msg' + (r.recomendacion.accion === 'usar_ia' ? '' : ' no'), r.recomendacion.mensaje));
    const t = el('table', 't'); const h = t.insertRow();
    ['Peso agua/energía', 'Agua ahorrada (L)', 'Neto (MXN)'].forEach(x => h.appendChild(el('th', '', x)));
    const best = Math.max(...r.candidatos.map(c => c.beneficio_neto_mxn));
    r.candidatos.forEach(c => { const tr = t.insertRow(); if (c.beneficio_neto_mxn === best && best > 0) tr.className = 'best';
      [c.lam, num(c.agua_ahorrada_l), mxn(c.beneficio_neto_mxn)].forEach(v => tr.insertCell().textContent = v); });
    o.appendChild(t);
  } catch (e) { o.className = 'opt'; o.textContent = e.message; }
});

/* ---------- portafolio ---------- */
$('port-btn').addEventListener('click', async () => {
  const p = $('port');
  try {
    const r = await api('/report/portfolio'); p.textContent = '';
    const t = el('table', 't'); const h = t.insertRow();
    ['Ciudad', 'Agua ahorrada (L)', '% agua', 'Neto (MXN)'].forEach(x => h.appendChild(el('th', '', x)));
    r.ciudades.forEach(c => { const tr = t.insertRow();
      [c.ciudad, num(c.agua_ahorrada_l), c.agua_ahorrada_pct + ' %', mxn(c.beneficio_neto_mxn)].forEach(v => tr.insertCell().textContent = v); });
    p.appendChild(t);
    const tot = el('div', 'tot'); tot.append(el('small', '', 'beneficio neto total'), document.createTextNode(mxn(r.total_beneficio_neto_mxn))); p.appendChild(tot);
  } catch (e) {
    p.textContent = ''; p.appendChild(el('p', 'note', e.message + '. Cambia a plan Pro para ver el portafolio.'));
    p.appendChild(el('a', 'cta', 'Ver planes ↓')).href = '#planes';
  }
});

/* ---------- planes ---------- */
async function renderPlans(cur) {
  const P = await (await fetch('/plans')).json(); const box = $('plans'); box.textContent = '';
  Object.entries(P).forEach(([id, p]) => {
    const d = el('div', 'plan' + (id === cur ? ' cur' : ''));
    d.appendChild(el('h4', '', p.nombre));
    const pr = el('div', 'pr', p.precio_mxn_mes == null ? 'Cotización' : mxn(p.precio_mxn_mes)); if (p.precio_mxn_mes != null) pr.appendChild(el('small', '', 'MXN / mes')); d.appendChild(pr);
    d.appendChild(el('p', '', p.descripcion));
    if (id !== cur) { const b = el('button', 'cta', id === 'enterprise' ? 'Contactar' : 'Elegir ' + p.nombre); b.type = 'button'; b.addEventListener('click', () => pick(id)); d.appendChild(b); }
    box.appendChild(d);
  });
}
async function pick(id) {
  $('perr').textContent = '';
  try { await api('/plan/' + id, 'POST'); await boot(); } catch (e) { $('perr').textContent = e.message; }
}

/* ---------- scroll suave a anclas ---------- */
document.addEventListener('click', e => {
  const a = e.target.closest('a[href^="#"]'); if (!a) return;
  const t = document.querySelector(a.getAttribute('href')); if (t) { e.preventDefault(); t.scrollIntoView({ behavior: 'smooth' }); }
});

initMap().then(boot);

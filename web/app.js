'use strict';
/* AguaSegura — front. Consume la API (api.py). DATOS SIMULADOS: clima real, operación simulada. */
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const API = location.protocol === 'file:' ? 'http://localhost:8000' : '';
const TOKEN = (() => { try { return localStorage.getItem('sx_token') || ''; } catch (e) { return ''; } })();
const toLogin = () => { try { localStorage.removeItem('sx_token'); } catch (e) { /* ok */ } location.replace('/cuenta.html?next=/'); };
if (!TOKEN && location.protocol !== 'file:') toLogin();
const call = async (p, method = 'GET', body) => {
  const r = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { toLogin(); throw new Error('sesión'); }
  if (!r.ok) throw new Error(p + ' ' + r.status); return r.json();
};
const get = p => call(p);
const nf = (v, d = 0) => Number(v).toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d });
const ease = t => 1 - Math.pow(1 - t, 4), clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent && parent.appendChild(e); return e; };
const once = fn => { let d = false; return (...a) => { if (!d) { d = true; return fn(...a); } }; };

function tween(dur, fn, done) {
  const t0 = performance.now(); let raf, dead = false;
  const step = n => { if (dead) return; const p = clamp((n - t0) / dur, 0, 1); fn(ease(p), p); p < 1 ? raf = requestAnimationFrame(step) : done && done(); };
  raf = requestAnimationFrame(step); return () => { dead = true; cancelAnimationFrame(raf); };
}
function countTo(node, to, { dec = 0, dur = 1400, pre = '', suf = '' } = {}) {
  const from = parseFloat(node.dataset.v || '0') || 0; node.dataset.v = to;
  if (node._c) node._c();
  node._c = tween(dur, e => { node.textContent = pre + nf(from + (to - from) * e, dec) + suf; });
}

const S = { cities: [], sum: null, city: 'Querétaro', days: [], fc: null, lam: 1, margin: 0, dT: 0, att: null, metrics: null, map: null, markers: {}, mapReady: false };
const IA = r => r.politica.startsWith('IA');

/* ------------------------------------------------------------------ cursor */
(() => {
  const c = $('#cursor'); let x = innerWidth / 2, y = innerHeight / 2, tx = x, ty = y;
  addEventListener('mousemove', e => { tx = e.clientX; ty = e.clientY; });
  (function loop() { x += (tx - x) * .22; y += (ty - y) * .22; c.style.transform = `translate(${x}px,${y}px)`; requestAnimationFrame(loop); })();
  document.addEventListener('mouseover', e => c.classList.toggle('big', !!e.target.closest('a,button,input,canvas,.dotm,.cta')));
})();

/* ------------------------------------------------------------------ olas del hero */
(() => {
  const ps = $$('.w'); const W = 1440, H = 600;
  const defs = [[330, 22, .0012, 0], [360, 28, .0009, 2], [395, 18, .0015, 4]];
  (function loop(t) {
    ps.forEach((p, i) => {
      const [base, amp, sp, ph] = defs[i]; let d = `M0 ${H} L0 ${base}`;
      for (let x = 0; x <= W; x += 30) d += ` L${x} ${base + Math.sin(x * .006 + t * sp * 3 + ph) * amp + Math.sin(x * .013 - t * sp * 2) * amp * .4}`;
      p.setAttribute('d', d + ` L${W} ${H} Z`);
    });
    requestAnimationFrame(loop);
  })(0);
})();

/* ------------------------------------------------------------------ navegación + reveal */
const curtain = $('#curtain');
function navTo(id) {
  const t = document.getElementById(id); if (!t) return;
  curtain.className = 'in';
  const navH = $('#nav') ? $('#nav').offsetHeight : 64;
  const targetY = id === 'hero' ? 0 : Math.max(0, t.offsetTop - navH + 10);
  setTimeout(() => { window.scrollTo({ top: targetY, behavior: 'instant' }); curtain.className = 'out'; setTimeout(() => curtain.className = '', 600); }, 560);
}
document.addEventListener('click', e => {
  const a = e.target.closest('[data-go]');
  if (a) {
    e.preventDefault();
    navTo(a.dataset.go);
    const navToggle = $('#nav-toggle'), navMenu = $('#nav-menu');
    if (navToggle && navMenu) {
      navToggle.classList.remove('open');
      navMenu.classList.remove('open');
      navToggle.setAttribute('aria-expanded', 'false');
    }
  }
});
const navToggle = $('#nav-toggle'), navMenu = $('#nav-menu');
if (navToggle && navMenu) {
  navToggle.addEventListener('click', () => {
    const open = navToggle.classList.toggle('open');
    navMenu.classList.toggle('open', open);
    navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
}
const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); e.target._on && e.target._on(); } }), { threshold: .18 });
['.rv', '.rb', '.lims li', '.sec-head'].forEach(s => $$(s).forEach(n => io.observe(n)));
$$('.pills,.day-kpis,.chart-wrap,.scrub,.two>div,.ctrl,.cap').forEach(n => { n.classList.add('rb'); io.observe(n); });
addEventListener('scroll', () => {
  const y = scrollY, max = document.documentElement.scrollHeight - innerHeight;
  $('#progress').style.width = (y / max * 100) + '%';
  $('.waves').style.transform = `translateY(${y * .22}px)`; $('.hero-grid h1').style.transform = `translateY(${-y * .06}px)`;
  let cur = ''; $$('main section').forEach(s => { if (s.offsetTop < y + innerHeight * .4) cur = s.id; });
  $$('#nav nav a').forEach(a => a.classList.toggle('on', a.dataset.go === cur));
}, { passive: true });

/* ------------------------------------------------------------------ mapa */
function initMap() {
  const m = S.map = new maplibregl.Map({ container: 'map', style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    center: [-102, 23.8], zoom: 3.1, pitch: 0, attributionControl: { compact: true }, dragRotate: true });
  m.scrollZoom.disable();
  const rows = S.cities.map(c => ({ ...c, ...S.sum.por_ciudad.find(r => r.ciudad === c.ciudad && IA(r)) }));
  const maxL = Math.max(...rows.map(r => r.agua_ahorrada_l)), pcts = rows.map(r => r.agua_ahorrada_pct), lo = Math.min(...pcts), hi = Math.max(...pcts);
  rows.forEach((r, i) => {
    const d = 22 + Math.sqrt(r.agua_ahorrada_l / maxL) * 62, k = (r.agua_ahorrada_pct - lo) / (hi - lo || 1);
    const w = document.createElement('div'); w.className = 'dotm'; w.style.cssText = 'width:0;height:0;position:relative';
    const col = `rgb(${Math.round(37 + k * 9)},${Math.round(68 + k * 154)},${Math.round(58 + k * 69)})`;
    w.innerHTML = `<i style="position:absolute;left:${-d / 2}px;top:${-d / 2}px;width:${d}px;height:${d}px;border-radius:50%;background:${col};opacity:.88;transform:scale(0);transition:transform 1.1s cubic-bezier(.22,.9,.2,1) ${i * .12}s,box-shadow .5s;box-shadow:0 0 0 0 ${col}"></i>
      <i style="position:absolute;left:${-d / 2}px;top:${-d / 2}px;width:${d}px;height:${d}px;border-radius:50%;border:1px solid ${col};animation:ping 3.2s ${i * .4}s infinite;pointer-events:none"></i>
      <span class="mono" style="position:absolute;left:${d / 2 + 8}px;top:-7px;white-space:nowrap;font-size:10px;color:#e9f0ea;opacity:0;transition:opacity .8s ${.8 + i * .12}s">${r.ciudad} <b style="color:var(--sig);font-weight:400">${r.agua_ahorrada_pct.toFixed(0)}%</b></span>`;
    w.addEventListener('click', () => selectCity(r.ciudad, { open: true }));
    w.addEventListener('mouseenter', () => w.firstChild.style.boxShadow = `0 0 0 10px ${col}33`);
    w.addEventListener('mouseleave', () => w.firstChild.style.boxShadow = `0 0 0 0 ${col}`);
    S.markers[r.ciudad] = new maplibregl.Marker({ element: w }).setLngLat([r.lon, r.lat]).addTo(m);
  });
  const st = document.createElement('style'); st.textContent = '@keyframes ping{0%{transform:scale(1);opacity:.7}100%{transform:scale(2.1);opacity:0}}'; document.head.appendChild(st);
  S.mapReady = true;
  $('#mapa')._on = once(() => {
    m.flyTo({ center: [-100, 31], zoom: 3.6, pitch: 30, bearing: -10, duration: 3400, essential: true });
    setTimeout(() => Object.values(S.markers).forEach(mk => { mk.getElement().firstChild.style.transform = 'scale(1)'; mk.getElement().querySelector('span').style.opacity = 1; }), 900);
  });
  io.observe($('#mapa'));
}
function fillPanel(name) {
  const c = S.cities.find(x => x.ciudad === name), r = S.sum.por_ciudad.find(x => x.ciudad === name && IA(x));
  $('#p-i').textContent = `${String(S.cities.indexOf(c) + 1).padStart(2, '0')} / ${S.cities.length}`;
  const t = $('#p-city'); t.style.opacity = 0; t.style.transform = 'translateY(14px)';
  setTimeout(() => { t.textContent = name; t.style.transition = 'all .7s cubic-bezier(.22,.9,.2,1)'; t.style.opacity = 1; t.style.transform = 'none'; }, 180);
  countTo($('#p-pct'), r.agua_ahorrada_pct, { suf: ' %' }); countTo($('#p-l'), r.agua_ahorrada_l / 1000, { dec: 0, suf: ' kL' });
  countTo($('#p-e'), r.energia_extra_pct, { dec: 1, pre: '+', suf: ' %' }); countTo($('#p-seco'), c.pct_horas_seco_factible, { suf: ' %' });
  if (c.pais === 'EE. UU.') $('#p-note').dataset.us = '1'; else delete $('#p-note').dataset.us;
  $('#b-seco').style.width = c.pct_horas_seco_factible + '%'; $('#b-evap').style.width = c.pct_horas_evap_factible + '%';
  $('#p-note').textContent = c.pct_horas_evap_factible < 50 ? 'Aquí ni el modo evaporativo mantiene 27 °C la mayor parte del año: haría falta enfriamiento líquido, que este modelo no cubre.'
    : c.pct_horas_seco_factible >= 80 ? 'Clima fresco: el modo seco aguanta casi todo el año; la IA solo necesita agua en las horas más calientes.'
    : 'Clima mixto: la IA alterna seco y agua según lo que pronostica para las próximas 24 h.';
}
function selectCity(name, { open = false } = {}) {
  if (open && window.closeDrawer) closeDrawer();
  S.city = name; $$('.pills button').forEach(b => b.classList.toggle('on', b.dataset.c === name));
  const c = S.cities.find(x => x.ciudad === name);
  if (S.mapReady) { if (open) { fillPanel(name); $('#panel').classList.add('open'); }
    S.map.flyTo({ center: [c.lon - (open ? .9 : 0), c.lat], zoom: open ? 6.2 : 4.7, pitch: open ? 55 : 40, bearing: open ? 14 : -10, duration: 2400, essential: true }); }
  loadCityData();
}
$('#p-x').addEventListener('click', () => { $('#panel').classList.remove('open'); S.map.flyTo({ center: [-100, 31], zoom: 3.6, pitch: 30, bearing: -10, duration: 2200 }); });

/* ------------------------------------------------------------------ un día */
const CH = { x0: 60, w: 1120, a: [30, 250], b: [310, 480], s: [508, 538] };
let chart = null;
function buildChart() {
  const svg = $('#chart'); svg.innerHTML = '';
  const defs = el('defs', {}, svg), cp = el('clipPath', { id: 'rev' }, defs); chart = { svg, rev: el('rect', { x: 0, y: 0, width: 0, height: 600 }, cp) };
  const g = el('g', { 'clip-path': 'url(#rev)' }, svg); chart.g = g;
  [['AGUA · MODO EVAPORATIVO · L/h', CH.a[0] - 12], ['TEMPERATURA DE ENTRADA · MODO SECO · °C', CH.b[0] - 12], ['DECISIÓN DE LA IA', CH.s[0] - 8]].forEach(([t, y]) =>
    el('text', { x: CH.x0, y, fill: '#7b8880', 'font-family': 'JetBrains Mono', 'font-size': 10, 'letter-spacing': '.1em' }, svg).textContent = t);
  chart.gridA = el('g', {}, svg); chart.gridB = el('g', {}, svg);
  chart.band = el('path', { fill: 'rgba(73,197,182,.18)' }, g); chart.f50 = el('path', { fill: 'none', stroke: '#49c5b6', 'stroke-width': 1.6, 'stroke-dasharray': '4 5' }, g);
  chart.wr = el('path', { fill: 'none', stroke: '#e9f0ea', 'stroke-width': 2 }, g);
  chart.lim = el('line', { stroke: '#ff7a59', 'stroke-dasharray': '6 5', 'stroke-width': 1 }, svg);
  chart.limT = el('text', { fill: '#ff7a59', 'font-family': 'JetBrains Mono', 'font-size': 10 }, svg); chart.limT.textContent = '27 °C límite';
  chart.i90 = el('path', { fill: 'none', stroke: '#987654', 'stroke-width': 1, opacity: .8 }, g); chart.i50 = el('path', { fill: 'none', stroke: '#ffd166', 'stroke-width': 1.5, 'stroke-dasharray': '4 5' }, g);
  chart.ir = el('path', { fill: 'none', stroke: '#ff7a59', 'stroke-width': 2 }, g);
  chart.cells = Array.from({ length: 24 }, (_, i) => { const r = el('rect', { x: CH.x0 + i * (CH.w / 24) + 1.5, y: CH.s[0], width: CH.w / 24 - 3, height: CH.s[1] - CH.s[0], rx: 2 }, svg); r.setAttribute('class', 'cell'); return r; });
  chart.hours = Array.from({ length: 8 }, (_, k) => { const i = k * 3; const t = el('text', { x: CH.x0 + (i + .5) * (CH.w / 24), y: 562, 'text-anchor': 'middle', fill: '#7b8880', 'font-family': 'JetBrains Mono', 'font-size': 10 }, svg); t.textContent = String(i).padStart(2, '0') + ':00'; return t; });
  chart.hv = el('line', { y1: 20, y2: 540, stroke: '#e9f0ea', 'stroke-width': 1, opacity: 0 }, svg);
  const ov = el('rect', { x: CH.x0, y: 0, width: CH.w, height: 560, fill: 'transparent' }, svg);
  const st = document.createElement('style'); st.textContent = '.cell{transition:fill .7s cubic-bezier(.22,.9,.2,1)}'; document.head.appendChild(st);
  ov.addEventListener('mousemove', e => {
    if (!S.fc) return; const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 1200, i = clamp(Math.floor((x - CH.x0) / (CH.w / 24)), 0, 23), f = S.fc;
    const px = CH.x0 + (i + .5) * (CH.w / 24); chart.hv.setAttribute('x1', px); chart.hv.setAttribute('x2', px); chart.hv.setAttribute('opacity', .35);
    const tip = $('#tip'), cw = $('#chart-wrap').getBoundingClientRect();
    tip.innerHTML = `${f.horas[i].slice(11)} · <span style="color:${f.decision[i] === 'seco' ? '#2ede7f' : '#49c5b6'}">${f.decision[i]}</span><br>agua real ${nf(f.real.water_e[i], 0)} L/h<br>pronóstico ${nf(f.pronostico.water_e.p50[i], 0)} (${nf(f.pronostico.water_e.p10[i], 0)}–${nf(f.pronostico.water_e.p90[i], 0)})<br>entrada seco ${nf(f.real.inlet_d[i], 1)} °C`;
    tip.style.opacity = 1; tip.style.left = clamp(px / 1200 * cw.width + 16, 0, cw.width - 230) + 'px'; tip.style.top = '30px';
  });
  ov.addEventListener('mouseleave', () => { $('#tip').style.opacity = 0; chart.hv.setAttribute('opacity', 0); });
}
const X = i => CH.x0 + (i + .5) * (CH.w / 24);
const pathOf = (arr, sy) => arr.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + sy(v).toFixed(1)).join('');
function drawChart(c) {
  const mx = Math.max(...c.w90, ...c.wr, 1) * 1.12, sa = v => CH.a[1] - v / mx * (CH.a[1] - CH.a[0]);
  const all = [...c.i90, ...c.ir, ...c.i50, 27]; const lo = Math.min(...all) - 1.5, hi = Math.max(...all) + 1.5, sb = v => CH.b[1] - (v - lo) / (hi - lo) * (CH.b[1] - CH.b[0]);
  chart.band.setAttribute('d', pathOf(c.w90, sa) + c.w10.map((v, k) => 'L' + X(23 - k).toFixed(1) + ' ' + sa(c.w10[23 - k]).toFixed(1)).join('') + 'Z');
  chart.f50.setAttribute('d', pathOf(c.w50, sa)); chart.wr.setAttribute('d', pathOf(c.wr, sa));
  chart.i90.setAttribute('d', pathOf(c.i90, sb)); chart.i50.setAttribute('d', pathOf(c.i50, sb)); chart.ir.setAttribute('d', pathOf(c.ir, sb));
  chart.lim.setAttribute('x1', CH.x0); chart.lim.setAttribute('x2', CH.x0 + CH.w); chart.lim.setAttribute('y1', sb(27)); chart.lim.setAttribute('y2', sb(27));
  chart.limT.setAttribute('x', CH.x0 + CH.w - 74); chart.limT.setAttribute('y', sb(27) - 6);
  chart.gridA.innerHTML = chart.gridB.innerHTML = '';
  for (let k = 0; k <= 4; k++) {
    const va = mx * k / 4, ya = sa(va), vb = lo + (hi - lo) * k / 4, yb = sb(vb);
    el('line', { x1: CH.x0, x2: CH.x0 + CH.w, y1: ya, y2: ya, stroke: 'rgba(233,240,234,.08)' }, chart.gridA);
    el('text', { x: CH.x0 - 10, y: ya + 3, 'text-anchor': 'end', fill: '#7b8880', 'font-family': 'JetBrains Mono', 'font-size': 9 }, chart.gridA).textContent = nf(va, 0);
    el('line', { x1: CH.x0, x2: CH.x0 + CH.w, y1: yb, y2: yb, stroke: 'rgba(233,240,234,.08)' }, chart.gridB);
    el('text', { x: CH.x0 - 10, y: yb + 3, 'text-anchor': 'end', fill: '#7b8880', 'font-family': 'JetBrains Mono', 'font-size': 9 }, chart.gridB).textContent = nf(vb, 0);
  }
}
let curArr = null, stopChart = null;
function showDay(fc) {
  if (!chart) buildChart();
  const P = fc.pronostico, R = fc.real, next = { w10: P.water_e.p10, w50: P.water_e.p50, w90: P.water_e.p90, wr: R.water_e, i50: P.inlet_d.p50, i90: P.inlet_d.p90, ir: R.inlet_d };
  const prev = curArr || Object.fromEntries(Object.keys(next).map(k => [k, next[k].map(() => 0)])); const first = !curArr;
  stopChart && stopChart();
  stopChart = tween(first ? 1300 : 800, e => { const c = {}; for (const k in next) c[k] = next[k].map((v, i) => prev[k][i] + (v - prev[k][i]) * e); drawChart(c); if (first) chart.rev.setAttribute('width', 1200 * e); }, () => { curArr = next; });
  if (!first) chart.rev.setAttribute('width', 1200);
  chart.cells.forEach((c, i) => { c.style.transitionDelay = (i * 22) + 'ms'; c.setAttribute('fill', fc.decision[i] === 'seco' ? '#2ede7f' : '#49c5b6'); });
  const k = fc.kpi; countTo($('#k-w'), k.agua_ia_l, { dur: 900 }); countTo($('#k-s'), k.agua_ahorrada_l, { dur: 900 }); countTo($('#k-h'), k.horas_seco, { dur: 900, suf: ' / 24' });
  const d = new Date(fc.day + 'T12:00'); $('#k-d').textContent = d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }); $('#k-dl').textContent = d.toLocaleDateString('es-MX', { weekday: 'long' }) + ' · 2026';
}
let dayTimer;
async function loadDay() {
  const i = +$('#scrub').value, day = S.days[i]; if (!day) return;
  const fc = await get(`/forecast?city=${encodeURIComponent(S.city)}&day=${day}&lam=${S.lam}&margin=${S.margin}`); S.fc = fc; showDay(fc); if (window.liveReset) liveReset();
}
$('#scrub').addEventListener('input', e => { const i = +e.target.value; $('#s-a').textContent = S.days[i]; clearTimeout(dayTimer); dayTimer = setTimeout(loadDay, 90); });

/* ------------------------------------------------------------------ cerebro */
function drawHeat(hover = -1, prog = 1) {
  const cv = $('#heat'), cx = cv.getContext('2d'), A = S.att.atencion, mx = Math.max(...A.flat()), mn = Math.min(...A.flat());
  cx.fillStyle = '#0b0f12'; cx.fillRect(0, 0, 480, 240);
  for (let r = 0; r < 24; r++) for (let c = 0; c < 48; c++) {
    if ((47 - c) / 48 > prog) continue; const v = Math.pow((A[r][c] - mn) / (mx - mn || 1), 1.15);
    cx.fillStyle = `rgb(${Math.round(11 + v * 35)},${Math.round(15 + v * 207)},${Math.round(18 + v * 109)})`; cx.fillRect(c * 10, r * 10, 10, 10);
  }
  if (hover >= 0) { cx.strokeStyle = '#e9f0ea'; cx.lineWidth = 1; cx.strokeRect(hover * 10 + .5, .5, 9, 239); }
}
function brainCaption() {
  const A = S.att.atencion, lag = Array.from({ length: 48 }, (_, c) => A.reduce((s, r) => s + r[c], 0) / 24), top = lag.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, 3).map(x => `−${48 - x[1]} h`);
  S.lag = lag; $('#heat-cap').textContent = `mira sobre todo a ${top.join(', ')} · pasa el cursor para ver cada hora`;
}
$('#heat').addEventListener('mousemove', e => { const r = e.target.getBoundingClientRect(), c = clamp(Math.floor((e.clientX - r.left) / r.width * 48), 0, 47); drawHeat(c);
  const rank = [...S.lag].sort((a, b) => b - a).indexOf(S.lag[c]) + 1; $('#heat-cap').textContent = `hace ${48 - c} h · peso ${(S.lag[c] * 100).toFixed(2)} % · puesto ${rank} de 48`; });
$('#heat').addEventListener('mouseleave', () => { drawHeat(); brainCaption(); });
function renderBrain() {
  brainCaption(); tween(1200, (e) => drawHeat(-1, e));
}
function buildMae() {
  const M = S.metrics.mae, names = { water_e: 'Agua evaporativo', water_d: 'Agua seco', energy_e: 'Energía evap.', energy_d: 'Energía seco', inlet_d: 'Entrada seco' };
  const T = M['Transformer (atención)'], L = M['LSTM'], N = M['Persistencia (ayer)'];
  $('#mae').innerHTML = `<div class="mleg mono"><span><i style="background:var(--sig)"></i>Transformer</span><span><i style="background:var(--aq)"></i>LSTM</span><span><i style="background:#4a5650"></i>Persistencia</span></div>` +
    Object.keys(names).map(k => `<div class="mrow"><span>${names[k]}</span><div class="mtr"><i class="t" data-w="${T[k] / N[k] * 100}"></i><i class="l" data-w="${L[k] / N[k] * 100}"></i><i class="n" data-w="100"></i><b>−${Math.round((1 - T[k] / N[k]) * 100)} %</b></div></div>`).join('');
  $('#cov').textContent = `Cobertura real del intervalo P10–P90: Transformer ${(T.cobertura_P10_P90 * 100).toFixed(0)} %, LSTM ${(L.cobertura_P10_P90 * 100).toFixed(0)} % (ideal 80 %). La persistencia usa valores contrafactuales de ayer: ventaja para el baseline. Prueba: 2026, clima real nunca visto.`;
  const m = $('#mae'); m._on = once(() => $$('i[data-w]', m).forEach((b, i) => setTimeout(() => b.style.width = b.dataset.w + '%', i * 70))); io.observe(m);
}
io.observe($('#heat'));

/* ------------------------------------------------------------------ escenarios */
function glide() { const on = $('#seg button.on'), g = $('#seg .gl'); g.style.left = on.offsetLeft + 'px'; g.style.width = on.offsetWidth + 'px'; }
async function loadScen() {
  const sc = await get(`/scenario?dT=${S.dT}&lam=${S.lam}&margin=${S.margin}`), box = $('#sc-bars'), mx = Math.max(...sc.ciudades.map(c => c.agua_status_quo_l));
  if (!box.children.length) box.innerHTML = sc.ciudades.map(c => `<div class="sc-row"><span>${c.ciudad}</span><div class="sc-t"><i class="a"></i><i class="b"></i></div><em></em></div>`).join('');
  sc.ciudades.forEach((c, i) => { const r = box.children[i]; setTimeout(() => { $('.a', r).style.width = c.agua_status_quo_l / mx * 100 + '%'; $('.b', r).style.width = c.agua_ia_l / mx * 100 + '%'; $('em', r).textContent = '−' + c.agua_ahorrada_pct.toFixed(0) + '%'; }, i * 60); });
  const sq = sc.ciudades.reduce((s, c) => s + c.agua_status_quo_l, 0), ia = sc.ciudades.reduce((s, c) => s + c.agua_ia_l, 0), en = sc.ciudades.reduce((s, c) => s + c.energia_extra_pct, 0) / sc.ciudades.length;
  countTo($('#t-w'), (sq - ia) / sq * 100, { suf: ' %' }); countTo($('#t-e'), en, { dec: 1, pre: '+', suf: ' %' });
  const sm = await get(`/summary?lam=${S.lam}&margin=${S.margin}`); countTo($('#t-r'), sm.total.find(x => x.politica.startsWith('IA')).horas_inseguras_evitables);
  drawPareto();
}
async function drawPareto() {
  const pf = await get(`/pareto?lam=${S.lam}`), svg = $('#pareto'); svg.innerHTML = '';
  const pts = pf.puntos.filter(p => !p.politica.startsWith('Siempre') && !p.politica.startsWith('Or')), xs = pts.map(p => p.horas_inseguras_evitables), ys = pts.map(p => p.agua_ahorrada_pct);
  const x0 = 46, x1 = 540, y0 = 270, y1 = 14, xmax = Math.max(...xs) * 1.05, ymin = Math.min(...ys) - 2, ymax = Math.max(...ys) + 2;
  const X = v => x0 + v / xmax * (x1 - x0), Y = v => y0 - (v - ymin) / (ymax - ymin) * (y0 - y1);
  for (let k = 0; k <= 4; k++) { const v = ymin + (ymax - ymin) * k / 4; el('line', { x1: x0, x2: x1, y1: Y(v), y2: Y(v), stroke: 'rgba(233,240,234,.08)' }, svg); el('text', { x: x0 - 8, y: Y(v) + 3, 'text-anchor': 'end' }, svg).textContent = v.toFixed(0) + '%'; }
  for (let k = 0; k <= 4; k++) { const v = xmax * k / 4; el('text', { x: X(v), y: 290, 'text-anchor': 'middle' }, svg).textContent = nf(v, 0); }
  el('text', { x: x1, y: 304, 'text-anchor': 'end' }, svg).textContent = 'horas inseguras evitables (menos = mejor) →';
  const cfg = { 'IA': ['#2ede7f', 2.6], 'Reactiva': ['#ff7a59', 1.4], 'Pronóstico': ['#8a948d', 1.4] };
  Object.keys(cfg).forEach((k, n) => {
    const line = pts.filter(p => p.politica.startsWith(k)).sort((a, b) => a.margen_c - b.margen_c); if (!line.length) return;
    const p = el('path', { d: line.map((q, i) => (i ? 'L' : 'M') + X(q.horas_inseguras_evitables) + ' ' + Y(q.agua_ahorrada_pct)).join(''), fill: 'none', stroke: cfg[k][0], 'stroke-width': cfg[k][1], pathLength: 1, 'stroke-dasharray': 1, 'stroke-dashoffset': 1 }, svg);
    p.style.transition = 'stroke-dashoffset 1.6s cubic-bezier(.22,.9,.2,1) ' + n * .2 + 's'; requestAnimationFrame(() => requestAnimationFrame(() => p.style.strokeDashoffset = 0));
    const first = line[0]; el('text', { x: X(first.horas_inseguras_evitables), y: Y(first.agua_ahorrada_pct) - 9, fill: cfg[k][0], 'text-anchor': 'middle', style: `fill:${cfg[k][0]}` }, svg).textContent = k === 'IA' ? 'IA' : k === 'Reactiva' ? 'regla' : 'ayer';
  });
}
$$('#seg button').forEach(b => b.addEventListener('click', () => { $$('#seg button').forEach(x => x.classList.remove('on')); b.classList.add('on'); S.dT = +b.dataset.v; glide(); loadScen(); }));
let lamT; $('#lam').addEventListener('input', e => { S.lam = +e.target.value; $('#lam-o').textContent = S.lam.toFixed(1); if (window.syncDrawer) syncDrawer(); clearTimeout(lamT); lamT = setTimeout(() => { loadScen(); loadDay(); }, 220); });

/* ------------------------------------------------------------------ datos de ciudad */
async function loadCityData() {
  S.att = await get(`/model/attention?city=${encodeURIComponent(S.city)}`); if ($('#heat').classList.contains('in') || S.brainShown) { drawHeat(); brainCaption(); }
  loadDay();
}
$('#heat')._on = once(() => { S.brainShown = true; renderBrain(); });

/* ------------------------------------------------------------------ arranque */
(async function init() {
  if (!TOKEN) return;
  const ld = $('#ld-n');
  const [user, cfg] = await Promise.all([get('/me'), get('/settings')]);
  S.city = cfg.ciudad; S.lam = cfg.lam; S.margin = cfg.margen_c; $('#lam').value = S.lam; $('#lam-o').textContent = S.lam.toFixed(1); let n = 0; const bump = () => { n += 20; ld.textContent = Math.min(n, 99); };
  const seg = $('#seg'); const gl = document.createElement('span'); gl.className = 'gl'; seg.prepend(gl);
  const [ci, sm, me, dy] = await Promise.all([get('/cities').then(x => (bump(), x)), get(`/summary?lam=${S.lam}&margin=${S.margin}`).then(x => (bump(), x)), get('/model/metrics').then(x => (bump(), x)), get('/days?city=Quer%C3%A9taro').then(x => (bump(), x))]);
  S.cities = ci.cities; S.sum = sm; S.metrics = me; S.days = dy.days;
  const sc = $('#scrub'); sc.max = S.days.length - 1; sc.value = Math.floor(S.days.length / 2) + 6; $('#s-a').textContent = S.days[sc.value]; $('#s-b').textContent = S.days[S.days.length - 1];
  $('#pills').innerHTML = S.cities.map(c => `<button data-c="${c.ciudad}" class="${c.ciudad === S.city ? 'on' : ''}">${c.ciudad}</button>`).join('');
  $$('#pills button').forEach(b => b.addEventListener('click', () => selectCity(b.dataset.c, { open: false })));
  buildMae(); initMap();
  S.att = await get(`/model/attention?city=${encodeURIComponent(S.city)}`); bump(); await loadDay(); bump();
  ld.textContent = '100'; await new Promise(r => setTimeout(r, 450));
  document.body.classList.remove('loading');
  setTimeout(() => { $('#hero').classList.add('in'); const t = sm.total.find(x => x.politica.startsWith('IA')), b = sm.total[0];
    countTo($('#h-pct'), t.agua_ahorrada_pct, { dur: 2200 }); countTo($('#h-l'), b.agua_l - t.agua_l, { dur: 2600 }); }, 500);
  glide(); loadScen(); addEventListener('resize', glide); dispatchEvent(new Event('scroll'));
  S.cfg = cfg; S.user = user; initDrawer(user, cfg);
  const goHome = setInterval(() => { if (S.mapReady) { clearInterval(goHome); selectCity(S.city, { open: false }); } }, 400); setTimeout(() => clearInterval(goHome), 15000);
})().catch(e => { console.error(e); $('#ld-n').textContent = '!'; $('.ld-inner .mono').textContent = 'no se pudo conectar con la API · uvicorn api:app --port 8000'; });


/* ------------------------------------------------------------------ panel de parámetros de la cuenta */
function initDrawer(me, cfg) {
  const d = $('#drawer'), F = { ciudad: $('#d-ciudad'), lam: $('#d-lam'), margen_c: $('#d-margen'), precio_agua_mxn_m3: $('#d-agua'), precio_kwh_mxn: $('#d-kwh'), precio_escasez_mxn_m3: $('#d-esc'), capacidad_mw: $('#d-mw') };
  $('#d-who').textContent = me.empresa || me.email;
  F.ciudad.innerHTML = S.cities.map(c => `<option>${c.ciudad}</option>`).join('');
  for (const k in F) F[k].value = cfg[k];
  $('#d-lam-o').textContent = (+cfg.lam).toFixed(1); $('#d-mar-o').textContent = (+cfg.margen_c).toFixed(1);
  window.syncDrawer = () => { F.lam.value = S.lam; $('#d-lam-o').textContent = S.lam.toFixed(1); };
  const read = () => ({ ciudad: F.ciudad.value, lam: +F.lam.value, margen_c: +F.margen_c.value, precio_agua_mxn_m3: +F.precio_agua_mxn_m3.value || 0,
    precio_kwh_mxn: +F.precio_kwh_mxn.value || 0, precio_escasez_mxn_m3: +F.precio_escasez_mxn_m3.value || 0, capacidad_mw: +F.capacidad_mw.value || 15 });
  const mxn = n => (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('es-MX');
  async function kpis() {
    try { const r = (await get('/report')).resultado, n = $('#d-net'); n.textContent = mxn(r.beneficio_neto_mxn); n.className = r.beneficio_neto_mxn < 0 ? 'neg' : ''; $('#d-pct').textContent = r.agua_ahorrada_pct + ' %';
      const P = await (await fetch('/plans')).json(), sub = P.pro.precio_mxn_mes * 9, m3 = r.agua_ahorrada_l / 1000, neto = r.beneficio_neto_mxn;
      const L = [['Agua ahorrada (ene–sep 2026)', nf(r.agua_ahorrada_l) + ' L'], ['Ahorro de agua a $30/m³', mxn(m3 * 30)], ['Ahorro de agua a $60/m³', mxn(m3 * 60)],
        ['Ahorro de agua a tu precio (con escasez)', mxn(r.ahorro_agua_mxn)], ['Costo de la energía extra', mxn(-r.costo_energia_extra_mxn)], ['Neto con tu precio', mxn(neto)],
        ['Suscripción SENTRIX Pro (9 meses)', mxn(-sub)], ['Neto tras suscripción', mxn(neto - sub)]];
      const veces = r.ahorro_agua_mxn / sub;
      $('#cs-kpis').innerHTML = [[nf(r.agua_ahorrada_l) + ' L', 'agua ahorrada · sitio de ' + r.capacidad_mw + ' MW'], [mxn(m3 * 30) + ' – ' + mxn(m3 * 60), 'ahorro de agua a $30–$60 por m³'],
        [mxn(sub), 'suscripción Pro · 9 meses'], [veces.toFixed(1) + '×', 'el ahorro de agua cubre la suscripción']]
        .map(x => `<div><b>${x[0]}</b><span class="mono">${x[1]}</span></div>`).join('');
      $('#cs-table').innerHTML = '<p class="mono lab">costeo · ' + r.ciudad + ' · ' + r.capacidad_mw + ' MW</p>' + L.map((x, i) => `<div class="dc-r${i === 5 || i === 7 ? ' tot' + ((i === 5 ? neto : neto - sub) < 0 ? ' neg' : '') : ''}"><span>${x[0]}</span><b>${x[1]}</b></div>`).join('');
      $('#cs-note').textContent = 'El ahorro de agua cubre la suscripción ' + veces.toFixed(1) + ' veces. ' + (neto < 0 ? 'Pero la energía extra del modo seco cuesta ' + mxn(r.costo_energia_extra_mxn) + ', más que el agua ahorrada: con estos precios el neto es negativo. El argumento es riesgo hídrico y cumplimiento, no solo pesos.' : 'Además, el valor del agua supera el costo de la energía extra.'); } catch (e) { /* sin datos */ }
  }
  async function apply(prevCity) {
    const c = read(); S.cfg = c; S.lam = c.lam; S.margin = c.margen_c; $('#lam').value = S.lam; $('#lam-o').textContent = S.lam.toFixed(1);
    $('#d-lam-o').textContent = c.lam.toFixed(1); $('#d-mar-o').textContent = c.margen_c.toFixed(1);
    try { await call('/settings', 'PUT', c); } catch (e) { $('#d-msg').textContent = 'No se pudo guardar'; return; }
    S.sum = await get(`/summary?lam=${S.lam}&margin=${S.margin}`);
    const t = S.sum.total.find(IA), b = S.sum.total[0]; countTo($('#h-pct'), t.agua_ahorrada_pct, { dur: 900 }); countTo($('#h-l'), b.agua_l - t.agua_l, { dur: 900 });
    if (c.ciudad !== prevCity) selectCity(c.ciudad, { open: false }); else { if ($('#panel').classList.contains('open')) fillPanel(S.city); loadDay(); }
    loadScen(); kpis(); $('#d-msg').textContent = ''; $('#d-msg').className = 'dnote';
  }
  let t, prev = cfg.ciudad; const later = () => { clearTimeout(t); const p = prev; prev = F.ciudad.value; t = setTimeout(() => apply(p), 400); };
  Object.values(F).forEach(el => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', later));
  $('#d-opt').addEventListener('click', async () => {
    const m = $('#d-msg'); m.className = 'dnote'; m.textContent = 'Probando configuraciones…';
    try { const r = await get('/report/optimize'); m.textContent = r.recomendacion.mensaje; m.className = 'dnote' + (r.recomendacion.accion === 'usar_ia' ? '' : ' no');
      if (r.recomendacion.accion === 'usar_ia') { F.lam.value = r.recomendacion.lam; later(); } } catch (e) { m.textContent = e.message; }
  });
  const setOpen = on => { d.classList.toggle('open', on); document.body.classList.toggle('dr-open', on); if (on) $('#panel').classList.remove('open'); };
  window.closeDrawer = () => setOpen(false);
  $('#pbtn').addEventListener('click', e => { e.preventDefault(); setOpen(!d.classList.contains('open')); });
  $('#d-x').addEventListener('click', () => setOpen(false));
  $('#d-out').addEventListener('click', () => toLogin());
  kpis(); setTimeout(() => setOpen(true), 1200);
}


/* ------------------------------------------------------------------ operación en vivo, plan y reporte del día */
(() => {
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const hh = t => t.slice(11, 16);
  const rows = fc => fc.horas.map((t, i) => {
    const dry = fc.decision[i] === 'seco', r = fc.real;
    return { hora: hh(t), modo: dry ? 'AIRE (seco)' : 'AGUA (evaporativo)', dry,
      agua: dry ? r.water_d[i] : r.water_e[i], energia: dry ? r.energy_d[i] : r.energy_e[i],
      entrada: r.inlet_d[i], ahorro: dry ? r.water_e[i] - r.water_d[i] : 0 };
  });
  const money = n => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('es-MX');
  let timer = null, idx = -1;

  function bar() {
    const b = $('#lv-bar'); if (!S.fc) return; b.innerHTML = '';
    rows(S.fc).forEach(r => { const c = document.createElement('i'); c.className = r.dry ? 'dry' : 'wet'; b.appendChild(c); });
  }
  window.liveReset = () => {
    stop(); idx = -1; if (!S.fc) return; bar();
    $('#lv-day').textContent = S.fc.city + ' · ' + S.fc.day; $('#lv-hour').textContent = '--:--';
    $('#lv-mode').textContent = '—'; $('#lv-mode').className = 'lv-mode'; $('#lv-temp').textContent = '—';
    $('#lv-saved').textContent = '0'; $('#lv-play').textContent = '▶ Reproducir el día';
  };
  function stop() { if (timer) { clearInterval(timer); timer = null; } }
  function step() {
    const R = rows(S.fc); idx++;
    if (idx >= R.length) { stop(); $('#lv-play').textContent = '↻ Repetir'; idx = -1; return; }
    const r = R[idx], cells = $('#lv-bar').children;
    [...cells].forEach((c, k) => c.classList.toggle('now', k === idx));
    $('#lv-hour').textContent = r.hora; const m = $('#lv-mode'); m.textContent = r.dry ? 'AIRE' : 'AGUA'; m.className = 'lv-mode ' + (r.dry ? 'dry' : 'wet');
    $('#lv-temp').textContent = r.entrada.toFixed(1);
    $('#lv-saved').textContent = nf(R.slice(0, idx + 1).reduce((s, x) => s + x.ahorro, 0));
  }
  $('#lv-play').addEventListener('click', () => {
    if (!S.fc) return; if (timer) { stop(); $('#lv-play').textContent = '▶ Continuar'; return; }
    $('#lv-play').textContent = '❚❚ Pausar'; step(); timer = setInterval(step, 650);
  });

  function file(name, mime, text) {
    const u = URL.createObjectURL(new Blob([text], { type: mime })), a = document.createElement('a');
    a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 2000);
  }
  $('#lv-csv').addEventListener('click', () => {
    if (!S.fc) return; const R = rows(S.fc);
    const csv = ['hora,modo,agua_litros,energia_kwh,entrada_en_seco_c,agua_ahorrada_l']
      .concat(R.map(r => [r.hora, r.modo, r.agua.toFixed(1), r.energia.toFixed(1), r.entrada.toFixed(1), r.ahorro.toFixed(1)].join(','))).join('\n');
    file(`plan_${S.fc.city.replace(/\s+/g, '_')}_${S.fc.day}.csv`, 'text/csv;charset=utf-8', '\ufeff' + csv);
  });
  $('#lv-pdf').addEventListener('click', () => {
    if (!S.fc) return; const R = rows(S.fc), k = S.fc.kpi, c = S.cfg || {};
    const agua = k.agua_ahorrada_l, kwh = k.energia_extra_kwh;
    const val = agua / 1000 * ((c.precio_agua_mxn_m3 || 0) + (c.precio_escasez_mxn_m3 || 0)), cost = kwh * (c.precio_kwh_mxn || 0);
    const w = window.open('', '_blank'); if (!w) { alert('Permite las ventanas emergentes para generar el reporte'); return; }
    w.document.write(`<!doctype html><html lang="es"><meta charset="utf-8"><title>Reporte SENTRIX ${esc(S.fc.day)}</title>
<style>body{font:14px system-ui,sans-serif;color:#111;margin:32px}h1{margin:0 0 4px}small{color:#555}table{border-collapse:collapse;width:100%;margin:18px 0}
td,th{border-bottom:1px solid #ddd;padding:5px 8px;text-align:right}td:first-child,th:first-child,td:nth-child(2),th:nth-child(2){text-align:left}
.k{display:flex;gap:28px;margin:18px 0}.k b{display:block;font-size:22px}.dry{color:#0a8a4a}.wet{color:#157c8a}.note{color:#555;font-size:12px}</style>
<h1>Reporte de operación · ${esc(S.fc.city)}</h1><small>${esc(S.user && (S.user.empresa || S.user.email) || '')} · día ${esc(S.fc.day)}</small>
<div class="k"><div><b>${nf(agua)} L</b>agua ahorrada</div><div><b>${nf(kwh)} kWh</b>energía extra</div><div><b>${money(val)}</b>valor del agua</div><div><b>${money(val - cost)}</b>beneficio neto</div><div><b>${k.horas_seco} h</b>en modo aire</div></div>
<p class="note">Parámetros: peso agua/energía ${esc(c.lam)} · margen ${esc(c.margen_c)} °C · agua $${esc(c.precio_agua_mxn_m3)}/m³ · energía $${esc(c.precio_kwh_mxn)}/kWh · escasez $${esc(c.precio_escasez_mxn_m3)}/m³</p>
<table><tr><th>Hora</th><th>Modo</th><th>Agua (L)</th><th>Energía (kWh)</th><th>Entrada en seco (°C)</th></tr>
${R.map(r => `<tr><td>${r.hora}</td><td class="${r.dry ? 'dry' : 'wet'}">${r.modo}</td><td>${nf(r.agua)}</td><td>${nf(r.energia)}</td><td>${r.entrada.toFixed(1)}</td></tr>`).join('')}</table>
<p class="note">DATOS SIMULADOS: clima real (Open-Meteo), operación del centro de datos simulada (kit CIFOX). Límite de entrada: 27 °C.</p>
<script>onload=()=>setTimeout(()=>print(),300)<\/script></html>`);
    w.document.close();
  });
})();

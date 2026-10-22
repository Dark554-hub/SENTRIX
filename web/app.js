'use strict';
/* AguaSegura — front. Consume la API (api.py). DATOS SIMULADOS: clima real, operación simulada. */
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const API = location.protocol === 'file:' ? 'http://localhost:8000' : '';
const get = async p => { const r = await fetch(API + p); if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); };
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

const S = { cities: [], sum: null, city: 'Querétaro', days: [], fc: null, lam: 1, dT: 0, att: null, metrics: null, map: null, markers: {}, mapReady: false };
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
    m.flyTo({ center: [-101.2, 23.4], zoom: 4.7, pitch: 40, bearing: -10, duration: 3400, essential: true });
    setTimeout(() => Object.values(S.markers).forEach(mk => { mk.getElement().firstChild.style.transform = 'scale(1)'; mk.getElement().querySelector('span').style.opacity = 1; }), 900);
  });
  io.observe($('#mapa'));
}
function fillPanel(name) {
  const c = S.cities.find(x => x.ciudad === name), r = S.sum.por_ciudad.find(x => x.ciudad === name && IA(x));
  $('#p-i').textContent = `0${S.cities.indexOf(c) + 1} / 0${S.cities.length}`;
  const t = $('#p-city'); t.style.opacity = 0; t.style.transform = 'translateY(14px)';
  setTimeout(() => { t.textContent = name; t.style.transition = 'all .7s cubic-bezier(.22,.9,.2,1)'; t.style.opacity = 1; t.style.transform = 'none'; }, 180);
  countTo($('#p-pct'), r.agua_ahorrada_pct, { suf: ' %' }); countTo($('#p-l'), r.agua_ahorrada_l / 1000, { dec: 0, suf: ' kL' });
  countTo($('#p-e'), r.energia_extra_pct, { dec: 1, pre: '+', suf: ' %' }); countTo($('#p-seco'), c.pct_horas_seco_factible, { suf: ' %' });
  $('#b-seco').style.width = c.pct_horas_seco_factible + '%'; $('#b-evap').style.width = c.pct_horas_evap_factible + '%';
  $('#p-note').textContent = c.pct_horas_evap_factible < 50 ? 'Aquí ni el modo evaporativo mantiene 27 °C la mayor parte del año: haría falta enfriamiento líquido, que este modelo no cubre.'
    : c.pct_horas_seco_factible >= 80 ? 'Clima fresco: el modo seco aguanta casi todo el año; la IA solo necesita agua en las horas más calientes.'
    : 'Clima mixto: la IA alterna seco y agua según lo que pronostica para las próximas 24 h.';
}
function selectCity(name, { open = false } = {}) {
  S.city = name; $$('.pills button').forEach(b => b.classList.toggle('on', b.dataset.c === name));
  const c = S.cities.find(x => x.ciudad === name);
  if (S.mapReady) { if (open) { fillPanel(name); $('#panel').classList.add('open'); }
    S.map.flyTo({ center: [c.lon - (open ? .9 : 0), c.lat], zoom: open ? 6.2 : 4.7, pitch: open ? 55 : 40, bearing: open ? 14 : -10, duration: 2400, essential: true }); }
  loadCityData();
}
$('#p-x').addEventListener('click', () => { $('#panel').classList.remove('open'); S.map.flyTo({ center: [-101.2, 23.4], zoom: 4.7, pitch: 40, bearing: -10, duration: 2200 }); });

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
  const fc = await get(`/forecast?city=${encodeURIComponent(S.city)}&day=${day}&lam=${S.lam}`); S.fc = fc; showDay(fc);
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
  const sc = await get(`/scenario?dT=${S.dT}&lam=${S.lam}`), box = $('#sc-bars'), mx = Math.max(...sc.ciudades.map(c => c.agua_status_quo_l));
  if (!box.children.length) box.innerHTML = sc.ciudades.map(c => `<div class="sc-row"><span>${c.ciudad}</span><div class="sc-t"><i class="a"></i><i class="b"></i></div><em></em></div>`).join('');
  sc.ciudades.forEach((c, i) => { const r = box.children[i]; setTimeout(() => { $('.a', r).style.width = c.agua_status_quo_l / mx * 100 + '%'; $('.b', r).style.width = c.agua_ia_l / mx * 100 + '%'; $('em', r).textContent = '−' + c.agua_ahorrada_pct.toFixed(0) + '%'; }, i * 60); });
  const sq = sc.ciudades.reduce((s, c) => s + c.agua_status_quo_l, 0), ia = sc.ciudades.reduce((s, c) => s + c.agua_ia_l, 0), en = sc.ciudades.reduce((s, c) => s + c.energia_extra_pct, 0) / sc.ciudades.length;
  countTo($('#t-w'), (sq - ia) / sq * 100, { suf: ' %' }); countTo($('#t-e'), en, { dec: 1, pre: '+', suf: ' %' });
  const sm = await get(`/summary?lam=${S.lam}`); countTo($('#t-r'), sm.total.find(x => x.politica.startsWith('IA')).horas_inseguras_evitables);
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
let lamT; $('#lam').addEventListener('input', e => { S.lam = +e.target.value; $('#lam-o').textContent = S.lam.toFixed(1); clearTimeout(lamT); lamT = setTimeout(() => { loadScen(); loadDay(); }, 220); });

/* ------------------------------------------------------------------ datos de ciudad */
async function loadCityData() {
  S.att = await get(`/model/attention?city=${encodeURIComponent(S.city)}`); if ($('#heat').classList.contains('in') || S.brainShown) { drawHeat(); brainCaption(); }
  loadDay();
}
$('#heat')._on = once(() => { S.brainShown = true; renderBrain(); });

/* ------------------------------------------------------------------ arranque */
(async function init() {
  const ld = $('#ld-n'); let n = 0; const bump = () => { n += 20; ld.textContent = Math.min(n, 99); };
  const seg = $('#seg'); const gl = document.createElement('span'); gl.className = 'gl'; seg.prepend(gl);
  const [ci, sm, me, dy] = await Promise.all([get('/cities').then(x => (bump(), x)), get('/summary').then(x => (bump(), x)), get('/model/metrics').then(x => (bump(), x)), get('/days?city=Quer%C3%A9taro').then(x => (bump(), x))]);
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
})().catch(e => { console.error(e); $('#ld-n').textContent = '!'; $('.ld-inner .mono').textContent = 'no se pudo conectar con la API · uvicorn api:app --port 8000'; });

const $=id=>document.getElementById(id);let T=localStorage.getItem('sx_token')||'';
const mxn=n=>n==null?'—':'$'+Number(n).toLocaleString('es-MX');
async function api(path,method='GET',body){
  const r=await fetch(path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+T},body:body?JSON.stringify(body):undefined});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(typeof j.detail==='string'?j.detail:'Error '+r.status);return j}
async function auth(kind){$('aerr').textContent='';
  try{const j=await api('/auth/'+kind,'POST',{email:$('email').value,password:$('pw').value,empresa:$('empresa').value});
    T=j.token;localStorage.setItem('sx_token',T);boot()}catch(e){$('aerr').textContent=e.message}}
function logout(){localStorage.removeItem('sx_token');T='';location.reload()}
async function boot(){
  if(!T)return;
  try{const me=await api('/me');$('auth').classList.add('hide');$('app').classList.remove('hide');
    $('who').textContent=me.empresa||me.email;$('plan').textContent=me.plan_info.nombre;
    const c=await (await fetch('/cities')).json();$('ciudad').innerHTML=c.cities.map(x=>`<option>${x.ciudad}</option>`).join('');
    const s=await api('/settings');for(const k in s)$(k).value=s[k];
    renderPlans(me.plan);report()}catch(e){logout()}}
async function save(){$('serr').textContent='';
  try{await api('/settings','PUT',{ciudad:$('ciudad').value,lam:+$('lam').value,margen_c:+$('margen_c').value,
    precio_agua_mxn_m3:+$('precio_agua_mxn_m3').value,precio_kwh_mxn:+$('precio_kwh_mxn').value});report()}catch(e){$('serr').textContent=e.message}}
async function report(){$('kpis').innerHTML='<span>Calculando…</span>';
  const r=(await api('/report')).resultado;
  const k=(v,l)=>`<div class="kpi"><b>${v}</b><span>${l}</span></div>`;
  $('kpis').innerHTML=k(r.agua_ahorrada_l.toLocaleString('es-MX')+' L','agua ahorrada ('+r.agua_ahorrada_pct+'%)')+k(mxn(r.ahorro_agua_mxn),'ahorro en agua')+
   k(mxn(r.costo_energia_extra_mxn),'costo de energía extra')+k(mxn(r.beneficio_neto_mxn),'beneficio neto')+k(r.horas_inseguras_evitables,'horas inseguras evitables')}
async function portfolio(){
  try{const p=await api('/report/portfolio');
    $('port').innerHTML='<table><tr><th>Ciudad</th><th>Agua ahorrada (L)</th><th>Neto (MXN)</th></tr>'+p.ciudades.map(c=>`<tr><td>${c.ciudad}</td><td>${c.agua_ahorrada_l.toLocaleString('es-MX')}</td><td>${mxn(c.beneficio_neto_mxn)}</td></tr>`).join('')+`</table><p><b>Total neto: ${mxn(p.total_beneficio_neto_mxn)}</b></p>`
  }catch(e){$('port').textContent=e.message+'. Cambia a plan Pro abajo.'}}
async function renderPlans(cur){const P=await (await fetch('/plans')).json();
  $('plans').innerHTML=Object.entries(P).map(([id,p])=>`<div class="card plan ${id===cur?'cur':''}" style="margin:0"><h4>${p.nombre}</h4>
   <b>${p.precio_mxn_mes==null?'Cotización':mxn(p.precio_mxn_mes)+' / mes'}</b><p style="color:var(--mut)">${p.descripcion}</p>
   ${id===cur?'<i>Plan actual</i>':`<button data-act="pick('${id}')">${id==='enterprise'?'Contactar':'Cambiar'}</button>`}</div>`).join('')}
async function pick(id){$('perr').textContent='';
  try{await api('/plan/'+id,'POST');boot()}catch(e){$('perr').textContent=e.message}}
const ACT={auth,logout,save,portfolio,pick};
boot();

document.addEventListener('click',e=>{const a=e.target.closest('[data-act]');if(!a)return;const m=a.dataset.act.match(/^(\w+)\((?:'([^']*)')?\)$/);if(m&&ACT[m[1]])ACT[m[1]](m[2])});

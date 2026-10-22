"""Cuentas, parámetros guardados, reporte de ahorro en pesos y planes. SQLite + tokens firmados (solo stdlib)."""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from pathlib import Path
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

DB = Path(os.environ.get('SENTRIX_DB', Path(__file__).parent / 'sentrix.db'))
ITER = 600_000  # OWASP 2023 para PBKDF2-HMAC-SHA256
TTL = 8 * 3600
EMAIL = re.compile(r'^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,}$')
DEMO_UPGRADES = os.environ.get('SENTRIX_DEMO_UPGRADES') == '1'  # sin pasarela de pago, solo para demos


def _key():
    """Llave de firma: variable de entorno o archivo local generado al azar (nunca una llave fija en el código)."""
    if os.environ.get('SENTRIX_SECRET'):
        return os.environ['SENTRIX_SECRET'].encode()
    f = Path(__file__).parent / '.sentrix_secret'
    if not f.exists():
        f.write_text(secrets.token_hex(32))
        try:
            f.chmod(0o600)
        except OSError:
            pass
    return f.read_text().strip().encode()


KEY = _key()

PLANS = {
    'piloto': {'nombre': 'Piloto', 'precio_mxn_mes': 0, 'sitios': 1, 'portafolio': False,
               'descripcion': '1 sitio, reporte de ahorro, parámetros guardados'},
    'pro': {'nombre': 'Pro', 'precio_mxn_mes': 4990, 'sitios': 5, 'portafolio': True,
            'descripcion': 'Hasta 5 sitios, comparativo de portafolio, alertas por correo'},
    'enterprise': {'nombre': 'Enterprise', 'precio_mxn_mes': None, 'sitios': 999, 'portafolio': True,
                   'descripcion': 'Telemetría propia, reentrenamiento por sitio, SLA y soporte (cotización)'},
}
deps = {}  # lo llena api.py: city_data, evaluate, POLICIES, CITIES
router = APIRouter()


def db():
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    c.executescript("""CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE, empresa TEXT, pw TEXT, plan TEXT DEFAULT 'piloto');
    CREATE TABLE IF NOT EXISTS settings(user_id INTEGER PRIMARY KEY, data TEXT);""")
    return c


def _hash(pw, salt=None):
    salt = salt or secrets.token_hex(8)
    return salt + '$' + hashlib.pbkdf2_hmac('sha256', pw.encode(), salt.encode(), ITER).hex()


def _check(pw, stored):
    return hmac.compare_digest(_hash(pw, stored.split('$')[0]), stored)


def _token(uid):
    body = base64.urlsafe_b64encode(json.dumps({'u': uid, 'e': int(time.time()) + TTL}).encode()).decode()
    return body + '.' + hmac.new(KEY, body.encode(), 'sha256').hexdigest()


def user(authorization: str = Header(default='')):
    try:
        body, sig = authorization.removeprefix('Bearer ').split('.')
        if not hmac.compare_digest(sig, hmac.new(KEY, body.encode(), 'sha256').hexdigest()):
            raise ValueError
        p = json.loads(base64.urlsafe_b64decode(body))
        if p['e'] < time.time():
            raise ValueError
    except Exception:
        raise HTTPException(401, 'Sesión inválida o expirada', headers={'WWW-Authenticate': 'Bearer'})
    with db() as c:
        u = c.execute('SELECT * FROM users WHERE id=?', (p['u'],)).fetchone()
    if not u:
        raise HTTPException(401, 'Usuario no existe')
    return u


class Cred(BaseModel):
    email: str = Field(min_length=5, max_length=120)
    password: str = Field(min_length=8, max_length=100)
    empresa: str = Field(default='', max_length=120)


class Settings(BaseModel):
    ciudad: str = 'Querétaro'
    lam: float = Field(1.0, ge=0, le=20)
    margen_c: float = Field(0.0, ge=-2, le=6)
    precio_agua_mxn_m3: float = Field(35.0, ge=0, le=1000)
    precio_kwh_mxn: float = Field(2.2, ge=0, le=50)
    precio_escasez_mxn_m3: float = Field(0.0, ge=0, le=5000, description='valor sombra del agua (riesgo hídrico, ESG, multas)')


_FAILS = {}  # (ip, email) -> [intentos fallidos, desde]
MAX_FAILS, WINDOW = 5, 900


def _locked(k):
    n, t = _FAILS.get(k, (0, 0))
    if time.time() - t > WINDOW:
        _FAILS.pop(k, None)
        return False
    return n >= MAX_FAILS


def _fail(k):
    n, t = _FAILS.get(k, (0, time.time()))
    _FAILS[k] = (n + 1, t)


def _valid(c):
    if not EMAIL.match(c.email.strip()):
        raise HTTPException(422, 'Correo inválido')
    if c.password.lower() in {'password', '12345678', 'contraseña', 'qwertyui'} or c.password.isdigit() or len(set(c.password)) < 4:
        raise HTTPException(422, 'Contraseña demasiado débil')


@router.post('/auth/register')
def register(c: Cred):
    _valid(c)
    with db() as con:
        try:
            cur = con.execute('INSERT INTO users(email,empresa,pw) VALUES(?,?,?)',
                              (c.email.lower().strip(), c.empresa, _hash(c.password)))
        except sqlite3.IntegrityError:
            raise HTTPException(409, 'Ese correo ya está registrado')
    return {'token': _token(cur.lastrowid)}


_DUMMY = _hash('dummy-password')


@router.post('/auth/login')
def login(c: Cred, request: Request):
    k = (request.client.host if request.client else '?', c.email.lower().strip())
    if _locked(k):
        raise HTTPException(429, 'Demasiados intentos. Intenta de nuevo en 15 minutos')
    with db() as con:
        u = con.execute('SELECT * FROM users WHERE email=?', (k[1],)).fetchone()
    ok = _check(c.password, u['pw'] if u else _DUMMY)  # mismo costo exista o no el usuario
    if not u or not ok:
        _fail(k)
        raise HTTPException(401, 'Correo o contraseña incorrectos')
    _FAILS.pop(k, None)
    return {'token': _token(u['id'])}


@router.get('/me')
def me(u=Depends(user)):
    return {'email': u['email'], 'empresa': u['empresa'], 'plan': u['plan'], 'plan_info': PLANS[u['plan']]}


def _settings(uid):
    with db() as c:
        row = c.execute('SELECT data FROM settings WHERE user_id=?', (uid,)).fetchone()
    return Settings(**json.loads(row['data'])) if row else Settings()


@router.get('/settings')
def get_settings(u=Depends(user)):
    return _settings(u['id'])


@router.put('/settings')
def put_settings(s: Settings, u=Depends(user)):
    if s.ciudad not in deps['CITIES']:
        raise HTTPException(422, f"Ciudad desconocida: {list(deps['CITIES'])}")
    with db() as c:
        c.execute('INSERT INTO settings(user_id,data) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data',
                  (u['id'], s.model_dump_json()))
    return s


def _ahorro(city, s, lam=None):
    df = deps['evaluate'](deps['city_data'](city), lam=s.lam if lam is None else lam, margin=s.margen_c)
    b, ia = df.iloc[0], df[df.politica == deps['POLICIES'][3]].iloc[0]
    agua_l, kwh = float(b.agua_l - ia.agua_l), float(ia.energia_kwh - b.energia_kwh)
    ahorro_agua = agua_l / 1000 * (s.precio_agua_mxn_m3 + s.precio_escasez_mxn_m3)
    costo_energia = kwh * s.precio_kwh_mxn
    return {'ciudad': city, 'agua_ahorrada_l': round(agua_l), 'agua_ahorrada_pct': round(float(ia['agua_ahorrada_%']), 1),
            'energia_extra_kwh': round(kwh), 'ahorro_agua_mxn': round(ahorro_agua),
            'costo_energia_extra_mxn': round(costo_energia), 'beneficio_neto_mxn': round(ahorro_agua - costo_energia),
            'horas_inseguras_evitables': int(ia.horas_riesgo_evitable)}


@router.get('/report')
def report(u=Depends(user)):
    """Ahorro 2026 vs. status quo en tu sitio, con tus parámetros y precios."""
    s = _settings(u['id'])
    return {'notice': 'DATOS SIMULADOS (clima real, operación simulada).', 'parametros': s, 'resultado': _ahorro(s.ciudad, s)}


@router.get('/report/optimize')
def optimize(u=Depends(user)):
    """Barre el peso agua/energía (lam) en tu sitio y recomienda el que maximiza el beneficio neto con TUS precios.
    Incluye 'mantener evaporativo' (beneficio 0): si ahorrar agua no conviene, lo dice."""
    s = _settings(u['id'])
    cand = [dict(_ahorro(s.ciudad, s, lam), lam=lam) for lam in (0, 0.5, 1, 2, 4, 8)]
    best = max(cand, key=lambda x: x['beneficio_neto_mxn'])
    if best['beneficio_neto_mxn'] <= 0:
        rec = {'accion': 'mantener_evaporativo', 'mensaje': 'Con estos precios ahorrar agua no se paga solo. Sube el valor de escasez del agua (riesgo hídrico/ESG) para justificarlo.'}
    else:
        rec = {'accion': 'usar_ia', 'lam': best['lam'], 'mensaje': f"Usa peso agua/energía = {best['lam']}: beneficio neto estimado {best['beneficio_neto_mxn']:,} MXN en 2026."}
    return {'ciudad': s.ciudad, 'recomendacion': rec, 'candidatos': cand}


@router.get('/report/portfolio')
def portfolio(u=Depends(user)):
    if not PLANS[u['plan']]['portafolio']:
        raise HTTPException(402, 'El comparativo de portafolio requiere plan Pro')
    s = _settings(u['id'])
    rows = [_ahorro(c, s) for c in deps['CITIES']]
    return {'parametros': s, 'ciudades': rows, 'total_beneficio_neto_mxn': sum(x['beneficio_neto_mxn'] for x in rows)}


@router.get('/plans')
def plans():
    return PLANS


@router.post('/plan/{plan}')
def set_plan(plan: str, u=Depends(user)):
    """Bajar de plan es libre; subir exige pago. Integrar Stripe aquí; SENTRIX_DEMO_UPGRADES=1 lo salta solo en demos."""
    if plan not in PLANS:
        raise HTTPException(404, 'Plan desconocido')
    if plan == 'enterprise':
        raise HTTPException(409, 'Enterprise es por cotización: escríbenos')
    if PLANS[plan]['precio_mxn_mes'] > PLANS[u['plan']]['precio_mxn_mes'] and not DEMO_UPGRADES:
        raise HTTPException(402, 'Subir de plan requiere pago (pasarela pendiente de integrar)')
    with db() as c:
        c.execute('UPDATE users SET plan=? WHERE id=?', (plan, u['id']))
    return {'plan': plan}

"""AguaSegura AI — API (backend). Sirve pronósticos, decisiones y escenarios al front.

Ejecutar:  uvicorn api:app --port 8000      Docs interactivas: http://localhost:8000/docs
DATOS SIMULADOS: clima real (Open-Meteo); carga, torre y consumos simulados (calibrados con el kit CIFOX).
"""
import json
from contextlib import asynccontextmanager
from functools import lru_cache
import numpy as np
import torch
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from aguasegura.sim import CITIES, INLET_MAX, load_city
from aguasegura.nn import TransformerForecaster, Scaler, LH, FH
from aguasegura.policy import prepare, evaluate, decisions, pareto, POLICIES

dev = 'cuda' if torch.cuda.is_available() else 'cpu'
S = {}
NOTICE = 'DATOS SIMULADOS: clima real, operación simulada (kit CIFOX). No son mediciones de un centro de datos real.'


@asynccontextmanager
async def lifespan(app):
    S['sc'] = Scaler.from_json(json.load(open('models/scaler.json')))
    m = TransformerForecaster().to(dev)
    m.load_state_dict(torch.load('models/transformer.pt', map_location=dev)); m.eval()
    S['model'] = m
    S['metrics'] = json.load(open('models/metrics.json'))
    yield


app = FastAPI(title='AguaSegura AI', version='1.0', lifespan=lifespan, description=NOTICE)
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['GET'], allow_headers=['*'])


@lru_cache(maxsize=64)
def city_data(city: str, dT: float = 0.0):
    return prepare(city, S['model'], S['sc'], dev, dT=dT)


def _city(city):
    if city not in CITIES:
        raise HTTPException(404, f'Ciudad desconocida. Opciones: {list(CITIES)}')
    return city


def r(a, n=2):
    return np.round(np.asarray(a, dtype=float), n).tolist()


def _rows(df):
    out = []
    for _, x in df.iterrows():
        out.append({'ciudad': x.ciudad, 'politica': x.politica, 'agua_l': r(x.agua_l, 0), 'energia_kwh': r(x.energia_kwh, 0),
                    'agua_ahorrada_l': r(x.agua_ahorrada_l, 0), 'agua_ahorrada_pct': r(x['agua_ahorrada_%'], 1),
                    'energia_extra_pct': r(x['energia_extra_%'], 2), 'horas_seco': int(x.horas_seco), 'horas': int(x.horas),
                    'horas_inseguras_evitables': int(x.horas_riesgo_evitable), 'horas_inseguras_total': int(x.horas_riesgo_termico)})
    return out


@app.get('/health')
def health():
    return {'ok': True, 'device': dev, 'notice': NOTICE}


@app.get('/cities')
def cities():
    """Ciudades con coordenadas y resumen del clima real 2026."""
    out = []
    for c, (lat, lon) in CITIES.items():
        d = load_city(c); t = d[d.time >= '2026-01-01']
        out.append({'ciudad': c, 'lat': lat, 'lon': lon, 'temp_media_c': r(t['T'].mean(), 1), 'temp_max_c': r(t['T'].max(), 1),
                    'hr_media_pct': r(t.RH.mean(), 0), 'pct_horas_seco_factible': r(100 * (t.inlet_d <= INLET_MAX).mean(), 1),
                    'pct_horas_evap_factible': r(100 * (t.inlet_e <= INLET_MAX).mean(), 1)})
    return {'notice': NOTICE, 'inlet_max_c': INLET_MAX, 'cities': out}


@app.get('/summary')
def summary(lam: float = Query(1.0, ge=0, le=20, description='L de agua que "vale" 1 kWh extra (supuesto)'),
            margin: float = Query(0.0, ge=-2, le=6, description='margen de seguridad térmica, °C')):
    """Resultados 2026 de las 5 políticas, por ciudad y total."""
    df = [evaluate(city_data(c), lam=lam, margin=margin) for c in CITIES]
    import pandas as pd
    allr = pd.concat(df)
    tot = allr.groupby('politica')[['agua_l', 'energia_kwh', 'horas_riesgo_evitable', 'horas_riesgo_termico', 'horas_seco', 'horas']].sum().loc[POLICIES]
    b = tot.iloc[0]
    total = [{'politica': p, 'agua_l': r(x.agua_l, 0), 'agua_ahorrada_pct': r(100 * (b.agua_l - x.agua_l) / b.agua_l, 1),
              'energia_extra_pct': r(100 * (x.energia_kwh - b.energia_kwh) / b.energia_kwh, 2),
              'horas_inseguras_evitables': int(x.horas_riesgo_evitable)} for p, x in tot.iterrows()]
    return {'notice': NOTICE, 'lam': lam, 'margin': margin, 'politicas': POLICIES, 'total': total, 'por_ciudad': _rows(allr)}


@app.get('/days')
def days(city: str):
    P = city_data(_city(city))
    return {'city': city, 'days': [str(t)[:10] for t in P['times'][:, 0]]}


@app.get('/forecast')
def forecast(city: str, day: str = Query(..., description='AAAA-MM-DD (2026)'), lam: float = 1.0, margin: float = 0.0):
    """Pronóstico a 24 h (P10/P50/P90), valores reales y decisión de la IA para un día."""
    P = city_data(_city(city))
    ds = [str(t)[:10] for t in P['times'][:, 0]]
    if day not in ds:
        raise HTTPException(404, f'Día fuera de rango ({ds[0]} a {ds[-1]})')
    j = ds.index(day)
    p, y = P['p'][j], P['y'][j]
    dry = decisions(P, lam=lam, margin=margin)[POLICIES[3]][j]
    w_base, w_ia = y[:, 0].sum(), np.where(dry, y[:, 1], y[:, 0]).sum()
    e_base, e_ia = y[:, 2].sum(), np.where(dry, y[:, 3], y[:, 2]).sum()
    names = ['water_e', 'water_d', 'energy_e', 'energy_d', 'inlet_d']
    return {'notice': NOTICE, 'city': city, 'day': day, 'inlet_max_c': INLET_MAX,
            'horas': [str(t)[:16] for t in P['times'][j]],
            'pronostico': {n: {'p10': r(p[:, i, 0]), 'p50': r(p[:, i, 1]), 'p90': r(p[:, i, 2])} for i, n in enumerate(names)},
            'real': {n: r(y[:, i]) for i, n in enumerate(names)},
            'decision': ['seco' if d else 'evaporativo' for d in dry],
            'kpi': {'agua_status_quo_l': r(w_base, 0), 'agua_ia_l': r(w_ia, 0), 'agua_ahorrada_l': r(w_base - w_ia, 0),
                    'energia_extra_kwh': r(e_ia - e_base, 1), 'horas_seco': int(dry.sum())}}


@app.get('/model/metrics')
def model_metrics():
    return {'notice': NOTICE, **S['metrics'], 'nota': 'MAE en 2026 (clima real no visto). Persistencia usa contrafactuales de ayer: ventaja para el baseline.'}


@app.get('/model/attention')
def attention(city: str, windows: int = Query(300, ge=10, le=1000)):
    """Cross-attention promedio [24 horas futuras × 48 horas pasadas] de la última capa."""
    P = city_data(_city(city)); sc = S['sc']
    hh = torch.tensor((P['h'][:windows] - sc.h[0]) / sc.h[1], device=dev)
    ff = torch.tensor((P['f'][:windows] - sc.f[0]) / sc.f[1], device=dev)
    with torch.no_grad():
        _, _, cross = S['model'](hh, ff, return_attn=True)
    A = cross[-1].mean((0, 1)).float().cpu().numpy()
    return {'city': city, 'horas_pasadas': list(range(-LH, 0)), 'horas_futuras': list(range(FH)), 'atencion': r(A, 4)}


@app.get('/scenario')
def scenario(dT: float = Query(1.5, ge=0, le=4), lam: float = 1.0, margin: float = 0.0):
    """Estrés climático: mismo clima 2026 + dT °C. El modelo extrapola: no es predicción climática."""
    out = []
    for c in CITIES:
        df = evaluate(city_data(c, round(dT, 2)), lam=lam, margin=margin)
        ia, b = df[df.politica == POLICIES[3]].iloc[0], df.iloc[0]
        out.append({'ciudad': c, 'agua_status_quo_l': r(b.agua_l, 0), 'agua_ia_l': r(ia.agua_l, 0),
                    'agua_ahorrada_pct': r(ia['agua_ahorrada_%'], 1), 'energia_extra_pct': r(ia['energia_extra_%'], 2)})
    return {'notice': NOTICE, 'dT': dT, 'ciudades': out}


@app.get('/pareto')
def pareto_curve(lam: float = 1.0):
    """Ahorro de agua vs. horas inseguras evitables al variar el margen (7 ciudades, 2026)."""
    pf = pareto([city_data(c) for c in CITIES], margins=np.arange(-1.0, 4.01, 0.5), lam=lam, q=1)
    return {'notice': NOTICE, 'puntos': [{'politica': x.politica, 'margen_c': float(x.margen_c), 'agua_ahorrada_pct': r(x['agua_ahorrada_%'], 1),
                                          'horas_inseguras_evitables': int(x.horas_riesgo_evitable)} for _, x in pf.iterrows()]}


# Front estático (debe ir al final: las rutas de la API tienen prioridad)
app.mount('/', StaticFiles(directory=Path(__file__).parent / 'web', html=True), name='web')

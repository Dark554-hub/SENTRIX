"""Clima real (Open-Meteo) + simulador físico de enfriamiento híbrido calibrado con el kit CIFOX.

REAL: temperatura y humedad horarias (Open-Meteo archive, hora local de México).
SIMULADO: carga de trabajo de IA, estado de la torre (cuenca, incrustación) y consumos.
Calibración (kit CIFOX, SIM-A aire / SIM-B evaporativa): IT = 65 + 1.8·carga%, PUE_evap≈1.24,
PUE_aire≈1.37, WUE_evap≈0.9 L/kWh IT, WUE_aire≈0.03, entrada ≈ T_ext + 0.5 °C (aire).
Supuesto marcado: el kit no trae humedad; se calibró a RH=50 %.
"""
from pathlib import Path
import json
import urllib.request
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'
CITIES = {
    'Querétaro': (20.5888, -100.3899), 'Monterrey': (25.6866, -100.3161), 'Ciudad de México': (19.4326, -99.1332),
    'Guadalajara': (20.6597, -103.3496), 'Mérida': (20.9674, -89.5926), 'Chihuahua': (28.6353, -106.0889),
    'Mexicali': (32.6245, -115.4523),
    # Polos de centros de datos de IA en EE. UU. (el modelo NO se entrenó con estas ciudades)
    'Silicon Valley': (37.3541, -121.9552), 'Ashburn': (39.0438, -77.4874), 'Phoenix': (33.4484, -112.0740),
    'Dallas': (32.7767, -96.7970), 'Prineville': (44.2999, -120.8345), 'Council Bluffs': (41.2619, -95.8608),
}
PAIS_US = {'Silicon Valley', 'Ashburn', 'Phoenix', 'Dallas', 'Prineville', 'Council Bluffs'}
TZ = {'Silicon Valley': 'America/Los_Angeles', 'Ashburn': 'America/New_York', 'Phoenix': 'America/Phoenix',
      'Dallas': 'America/Chicago', 'Prineville': 'America/Los_Angeles', 'Council Bluffs': 'America/Chicago'}
START, END = '2022-01-01', '2026-09-30'
TRAIN_END, VAL_END = '2024-12-31 23:00', '2025-12-31 23:00'   # test = 2026 (clima real, nunca visto)
INLET_MAX = 27.0   # °C, límite superior recomendado de entrada (ASHRAE A1 recomendado)


def fetch_weather(city, force=False):
    f = DATA / f'weather_{city.replace(" ", "_")}.csv'
    if f.exists() and not force:
        return pd.read_csv(f, parse_dates=['time'])
    lat, lon = CITIES[city]
    url = ('https://archive-api.open-meteo.com/v1/archive?latitude=%s&longitude=%s&start_date=%s&end_date=%s'
           '&hourly=temperature_2m,relative_humidity_2m&timezone=%s' % (lat, lon, START, END, TZ.get(city, 'America/Mexico_City').replace('/', '%2F')))
    with urllib.request.urlopen(url, timeout=120) as r:
        j = json.load(r)['hourly']
    w = pd.DataFrame({'time': pd.to_datetime(j['time']), 'T': j['temperature_2m'], 'RH': j['relative_humidity_2m']})
    w = w.interpolate().ffill().bfill()
    w.to_csv(f, index=False)
    return w


def wet_bulb(T, RH):
    """Temperatura de bulbo húmedo (Stull 2011), °C."""
    RH = np.clip(RH, 5, 99)
    return (T * np.arctan(0.151977 * (RH + 8.313659) ** 0.5) + np.arctan(T + RH) - np.arctan(RH - 1.676331)
            + 0.00391838 * RH ** 1.5 * np.arctan(0.023101 * RH) - 4.686035)


def make_load(time, rng):
    n = len(time)
    hr, dow = time.dt.hour.to_numpy(), time.dt.dayofweek.to_numpy()
    base = 52 + 14 * np.sin(2 * np.pi * (hr - 8) / 24) - 7 * (dow >= 5)
    ar, e = np.zeros(n), rng.normal(0, 1.6, n)
    for i in range(1, n):
        ar[i] = 0.96 * ar[i - 1] + e[i]
    burst, i = np.zeros(n), 0
    while i < n:                                   # trabajos de entrenamiento: bloques de 6–30 h
        if rng.random() < 0.004:
            L = int(rng.integers(6, 31)); burst[i:i + L] += rng.uniform(10, 25); i += L
        i += 1
    return np.clip(base + ar + burst, 20, 98)


def simulate(w, seed=0, dT=0.0):
    """Devuelve el DataFrame horario con ambos modos (contrafactual) y el modo operado."""
    rng = np.random.default_rng(seed)
    n = len(w)
    T = w['T'].to_numpy() + dT
    RH = w['RH'].to_numpy()
    Twb = wet_bulb(T, RH)
    load = make_load(w['time'], rng)
    IT = (65 + 1.8 * load) * (1 + 0.01 * rng.normal(size=n))
    # estado oculto 1: temperatura de cuenca de la torre (inercia ~3 h)
    Tb = np.zeros(n); Tb[0] = Twb[0] + 4
    for i in range(1, n):
        Tb[i] = Tb[i - 1] + (Twb[i] + 4 + 0.04 * load[i] - Tb[i - 1]) / 3
    # estado oculto 2: incrustación -> ciclos de concentración (limpieza cada ~14 días)
    f, C = 0.0, np.zeros(n)
    next_clean = int(rng.integers(250, 420))
    for i in range(n):
        f = min(1.0, f + abs(rng.normal(0.0008, 0.0008)))
        if i >= next_clean:
            f, next_clean = 0.0, i + int(rng.integers(250, 420))
        C[i] = 5.0 - 2.5 * f
    # modo evaporativo
    oh_e = 0.225 + 0.0025 * np.maximum(T - 20, 0)
    energy_e = IT * (1 + oh_e) * (1 + 0.01 * rng.normal(size=n))
    frac = np.clip(0.30 + 0.022 * (Tb - 8), 0.30, 0.95)
    water_e = frac * (IT * (1 + oh_e)) / 0.68 * (C / (C - 1)) / 1.25 * (1 + 0.02 * rng.normal(size=n))
    inlet_e = Twb + 7.6 + 0.02 * (load - 50) + rng.normal(0, 0.3, n)
    # modo seco
    oh_d = 0.27 + 0.0144 * np.maximum(T - 15, 0)
    energy_d = IT * (1 + oh_d) * (1 + 0.01 * rng.normal(size=n))
    water_d = 0.032 * IT * (1 + 0.05 * rng.normal(size=n))
    inlet_d = T + 0.6 + 0.05 * (load - 40) + rng.normal(0, 0.3, n)
    # modo operado (bloques aleatorios de 3–12 h, ~50 % seco): define qué se "observa"
    mode, i = np.zeros(n, dtype=int), 0
    while i < n:
        L = int(rng.integers(3, 13)); mode[i:i + L] = int(rng.random() < 0.5); i += L
    pick = lambda e, d: np.where(mode == 1, d, e)
    out = pd.DataFrame({
        'time': w['time'], 'T': T, 'RH': RH, 'Twb': Twb, 'load': load, 'IT': IT, 'Tb': Tb, 'C': C,
        'water_e': water_e, 'water_d': water_d, 'energy_e': energy_e, 'energy_d': energy_d,
        'inlet_e': inlet_e, 'inlet_d': inlet_d, 'mode': mode,
        'water_obs': pick(water_e, water_d), 'energy_obs': pick(energy_e, energy_d), 'inlet_obs': pick(inlet_e, inlet_d)})
    return out


def build_all(force=False):
    for k, city in enumerate(CITIES):
        f = DATA / f'sim_{city.replace(" ", "_")}.csv.gz'
        if f.exists() and not force:
            continue
        simulate(fetch_weather(city, force), seed=22102026 + k).to_csv(f, index=False)


def load_city(city, dT=0.0, seed=None):
    k = list(CITIES).index(city)
    if dT == 0 and seed is None:
        return pd.read_csv(DATA / f'sim_{city.replace(" ", "_")}.csv.gz', parse_dates=['time'])
    return simulate(fetch_weather(city), seed=22102026 + k if seed is None else seed, dT=dT)


if __name__ == '__main__':
    build_all()
    for c in CITIES:
        d = load_city(c)
        print(f'{c:18s} filas={len(d):6d} T={d["T"].mean():5.1f} Tmax={d["T"].max():5.1f} '
              f'WUE_e={d.water_e.sum()/d.IT.sum():.2f} PUE_e={d.energy_e.sum()/d.IT.sum():.3f} '
              f'PUE_d={d.energy_d.sum()/d.IT.sum():.3f} WUE_d={d.water_d.sum()/d.IT.sum():.3f} '
              f'seco_factible={(d.inlet_d<=INLET_MAX).mean():.2%} evap_ok={(d.inlet_e<=INLET_MAX).mean():.2%}')

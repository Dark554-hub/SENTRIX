"""Políticas de control híbrido (seco / evaporativo) evaluadas contra el simulador con clima real 2026."""
import numpy as np
import pandas as pd
import torch
from .sim import CITIES, load_city, INLET_MAX
from .nn import features, windows, predict, LH, FH

POLICIES = ['Siempre evaporativo (status quo)', 'Reactiva (regla con la hora anterior)',
            'Pronóstico ingenuo (ayer)', 'IA: Transformer (pronóstico)', 'Oráculo (techo teórico)']


def prepare(city, model, sc, dev, dT=0.0, start='2026-01-01'):
    """Ventanas diarias (00:00 local) del periodo de prueba + predicciones del modelo."""
    k = list(CITIES).index(city)
    d = load_city(city, dT=dT, seed=None) if dT else load_city(city)
    H, Fu, Y = features(d, seed=1 + k)
    idx = np.where((d.time >= start) & (d.time.dt.hour == 0))[0]
    idx = idx[(idx >= LH + 24) & (idx + FH <= len(d))]
    h, f, y = windows(H, Fu, Y, idx)
    yprev = windows(H, Fu, Y, idx - 24)[2]
    yshift = windows(H, Fu, Y, idx - 1)[2]
    ie = d['inlet_e'].to_numpy()[idx[:, None] + np.arange(FH)]
    return dict(city=city, p=predict(model, h, f, sc, dev), y=y, yprev=yprev, yshift=yshift, ie=ie,
                times=d['time'].to_numpy()[idx[:, None] + np.arange(FH)], h=h, f=f)


def _rule(we, wd, ee, ed, inlet, lam, thr):
    return (inlet <= thr) & ((we - wd) > lam * (ed - ee))


def decisions(P, lam=1.0, thr=INLET_MAX, q=1, margin=0.0):
    y, yp, ys, p = P['y'], P['yprev'], P['yshift'], P['p']
    return {
        POLICIES[0]: np.zeros(y.shape[:2], bool),
        POLICIES[1]: _rule(ys[..., 0], ys[..., 1], ys[..., 2], ys[..., 3], ys[..., 4] + margin, lam, thr),
        POLICIES[2]: _rule(yp[..., 0], yp[..., 1], yp[..., 2], yp[..., 3], yp[..., 4] + margin, lam, thr),
        POLICIES[3]: _rule(p[..., 0, 1], p[..., 1, 1], p[..., 2, 1], p[..., 3, 1], p[..., 4, q] + margin, lam, thr),
        POLICIES[4]: _rule(y[..., 0], y[..., 1], y[..., 2], y[..., 3], y[..., 4] + margin, lam, thr),
    }


def score(P, dry, thr=INLET_MAX):
    y = P['y']
    w = np.where(dry, y[..., 1], y[..., 0]).sum()
    e = np.where(dry, y[..., 3], y[..., 2]).sum()
    viol = np.where(dry, y[..., 4] > thr, P['ie'] > thr).sum()
    # riesgo evitable: se eligió un modo inseguro habiendo otro seguro en esa hora
    ok_d, ok_e = y[..., 4] <= thr, P['ie'] <= thr
    evitable = np.where(dry, ~ok_d & ok_e, ~ok_e & ok_d).sum()
    return dict(agua_l=float(w), energia_kwh=float(e), horas_riesgo_termico=int(viol), horas_riesgo_evitable=int(evitable),
                horas=int(dry.size), horas_seco=int(dry.sum()))


def evaluate(P, lam=1.0, thr=INLET_MAX, q=1, margin=0.0):
    rows = []
    for name, dry in decisions(P, lam, thr, q, margin).items():
        rows.append({'ciudad': P['city'], 'politica': name, **score(P, dry, thr)})
    df = pd.DataFrame(rows)
    b = df.iloc[0]
    df['agua_ahorrada_l'] = b.agua_l - df.agua_l
    df['agua_ahorrada_%'] = 100 * df.agua_ahorrada_l / b.agua_l
    df['energia_extra_kwh'] = df.energia_kwh - b.energia_kwh
    df['energia_extra_%'] = 100 * df.energia_extra_kwh / b.energia_kwh
    return df


def pareto(Ps, margins=np.arange(-1.0, 5.01, 0.5), lam=1.0, q=1):
    """Barrido del margen de seguridad: ahorro de agua vs. horas de riesgo térmico, sumando las ciudades."""
    rows = []
    for m in margins:
        tot = pd.concat([evaluate(P, lam=lam, q=q, margin=m) for P in Ps])
        g = tot.groupby('politica')[['agua_l', 'horas_riesgo_evitable', 'energia_kwh']].sum()
        base = g.loc[POLICIES[0]]
        for pol, r in g.iterrows():
            rows.append({'politica': pol, 'margen_c': m, 'agua_ahorrada_%': 100 * (base.agua_l - r.agua_l) / base.agua_l,
                         'horas_riesgo_evitable': int(r.horas_riesgo_evitable),
                         'energia_extra_%': 100 * (r.energia_kwh - base.energia_kwh) / base.energia_kwh})
    return pd.DataFrame(rows)

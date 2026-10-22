"""Núcleo AguaSegura AI: métricas, modelo de agua/energía, detector y simulador.

Todo se ajusta SOLO con la partición `referencia`. `evaluacion` se usa para medir.
`scenario` y `simulated_anomaly` jamás son entradas; solo etiquetas de evaluación.
DATOS SIMULADOS (kit CIFOX).
"""
from pathlib import Path
import numpy as np
import pandas as pd

DATA = Path(__file__).resolve().parents[1] / 'data' / 'operaciones_simuladas.csv'
FEATURES = ['energy_it_kwh', 'outdoor_temp_c']
IF_FEATURES = ['energy_it_kwh', 'energy_total_kwh', 'water_l', 'load_pct', 'outdoor_temp_c', 'inlet_temp_c']
COOLING = {'SIM-A': 'aire', 'SIM-B': 'evaporativa', 'SIM-C': 'liquida'}


def load_data(path=DATA):
    df = pd.read_csv(path)
    if not df['is_simulated'].astype(str).str.lower().isin(['true', '1']).all():
        raise ValueError('Solo datos simulados')
    if df.duplicated(['timestamp', 'site_id']).any() or df.isna().any().any():
        raise ValueError('Datos duplicados o con nulos')
    return df


def ratios(df):
    """PUE y WUE como cociente de sumas (nunca media de ratios horarios)."""
    it = df['energy_it_kwh'].sum()
    if len(df) == 0 or it <= 0:
        return {'pue': None, 'wue_l_kwh': None}
    return {'pue': df['energy_total_kwh'].sum() / it, 'wue_l_kwh': df['water_l'].sum() / it}


def _design(df):
    return np.c_[np.ones(len(df)), df[FEATURES].to_numpy()]


def _ols(df, target):
    X, y = _design(df), df[target].to_numpy()
    beta = np.linalg.lstsq(X, y, rcond=None)[0]
    resid = y - X @ beta
    sigma = float(resid.std(ddof=X.shape[1]))
    return beta, sigma


class SiteModel:
    """Agua y energía total por hora = a + b·IT + c·T_exterior, por sitio."""

    def __init__(self, ref_site):
        self.n = len(ref_site)
        self.water, self.sigma_w = _ols(ref_site, 'water_l')
        self.total, self.sigma_e = _ols(ref_site, 'energy_total_kwh')
        self.t_range = (float(ref_site.outdoor_temp_c.min()), float(ref_site.outdoor_temp_c.max()))
        self.it_range = (float(ref_site.energy_it_kwh.min()), float(ref_site.energy_it_kwh.max()))
        self._ref = ref_site[FEATURES + ['water_l', 'energy_total_kwh']].reset_index(drop=True)

    def predict(self, df, beta=None, target='water'):
        b = (self.water if target == 'water' else self.total) if beta is None else beta
        return np.maximum(_design(df) @ b, 0) if target == 'water' else _design(df) @ b

    def bootstrap(self, n=300, seed=22102026):
        rng = np.random.default_rng(seed)
        out = []
        for _ in range(n):
            s = self._ref.iloc[rng.integers(0, self.n, self.n)]
            out.append((_ols(s, 'water_l')[0], _ols(s, 'energy_total_kwh')[0]))
        return out


def fit(df):
    ref = df[df.split == 'referencia']
    return {s: SiteModel(g) for s, g in ref.groupby('site_id')}


def forecast_report(df, models):
    """Error del pronóstico de agua en evaluación (con y sin horas anómalas)."""
    rows = []
    ev = df[df.split == 'evaluacion']
    for s, m in models.items():
        g = ev[ev.site_id == s]
        for label, sub in (('todas', g), ('sin anomalías', g[g.simulated_anomaly == 0])):
            err = sub.water_l.to_numpy() - m.predict(sub)
            lo, hi = m.predict(sub) - 1.96 * m.sigma_w, m.predict(sub) + 1.96 * m.sigma_w
            rows.append({'sitio': s, 'enfriamiento': COOLING[s], 'horas': label, 'n': len(sub),
                         'MAE_L': float(np.abs(err).mean()), 'MAE_%': float(np.abs(err).mean() / sub.water_l.mean() * 100),
                         'cobertura_95%': float(((sub.water_l >= lo) & (sub.water_l <= hi)).mean())})
    return pd.DataFrame(rows)


def residual_scores(df, models):
    out = df.copy()
    zw, ze = np.zeros(len(out)), np.zeros(len(out))
    for s, m in models.items():
        idx = np.where(out.site_id.to_numpy() == s)[0]
        sub = out.iloc[idx]
        zw[idx] = (sub.water_l.to_numpy() - m.predict(sub)) / m.sigma_w
        ze[idx] = (sub.energy_total_kwh.to_numpy() - m.predict(sub, target='total')) / m.sigma_e
    out['z_agua'], out['z_energia'] = zw, ze
    return out


def detect(df, models, z=4.0, use_ot=True):
    """Alerta si el agua o la energía total se desvían >z σ del modelo (σ de referencia)."""
    out = residual_scores(df, models)
    reason = []
    for _, r in out.iterrows():
        why = []
        if r.z_agua > z: why.append('agua sobre lo esperado (posible fuga)')
        if r.z_energia > z: why.append('energía total sobre lo esperado (ineficiencia)')
        if use_ot and r.ot_event != 'normal': why.append('evento OT simulado (revisión humana)')
        reason.append('; '.join(why))
    out['alerta_modelo'] = [bool(x) for x in reason]
    out['motivo'] = reason
    return out


def score(y, pred):
    y, pred = np.asarray(y).astype(bool), np.asarray(pred).astype(bool)
    tp, fp, fn = int((y & pred).sum()), int((~y & pred).sum()), int((y & ~pred).sum())
    return {'tp': tp, 'fp': fp, 'fn': fn,
            'precision': tp / (tp + fp) if tp + fp else None, 'recall': tp / (tp + fn) if tp + fn else None}


def compare_detectors(df, models):
    from sklearn.ensemble import IsolationForest
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
    train, test = df[df.split == 'referencia'], df[df.split == 'evaluacion']
    res = {}
    pue = test.energy_total_kwh / test.energy_it_kwh
    wue = test.water_l / test.energy_it_kwh
    rules = (pue > 1.6) | (wue > 1.5) | (test.inlet_temp_c > 29) | (test.ot_event != 'normal')
    res['Reglas del kit (ven OT)'] = score(test.simulated_anomaly, rules)
    if_model = make_pipeline(StandardScaler(), IsolationForest(n_estimators=100, contamination=.05, random_state=22102026, n_jobs=1))
    if_model.fit(train[IF_FEATURES])
    res['Isolation Forest del kit (sin OT)'] = score(test.simulated_anomaly, if_model.predict(test[IF_FEATURES]) == -1)
    res['Modelo residual AguaSegura (sin OT)'] = score(test.simulated_anomaly, detect(test, models, use_ot=False).alerta_modelo)
    res['Modelo residual AguaSegura (con OT)'] = score(test.simulated_anomaly, detect(test, models, use_ot=True).alerta_modelo)
    return res


def scenario(df, models, cooling_from, cooling_to, delta_t=0.0, ewif=0.0, boot=True):
    """Compara dos tipos de enfriamiento sobre la MISMA carga IT y temperatura (+delta_t).

    Usa el perfil horario del sitio `cooling_from` (referencia + evaluación). Agua directa
    in situ; agua indirecta = kWh totales × ewif (supuesto del usuario, no medido).
    """
    inv = {v: k for k, v in COOLING.items()}
    base = df[df.site_id == inv[cooling_from]].copy()
    base['outdoor_temp_c'] = base['outdoor_temp_c'] + delta_t
    res = {}
    for name, c in (('actual', cooling_from), ('propuesto', cooling_to)):
        m = models[inv[c]]
        w, e = m.predict(base).sum(), m.predict(base, target='total').sum()
        res[name] = {'agua_directa_l': w, 'energia_total_kwh': e, 'agua_indirecta_l': e * ewif}
    out = {k: {**v, 'agua_total_l': v['agua_directa_l'] + v['agua_indirecta_l']} for k, v in res.items()}
    d_w = out['propuesto']['agua_total_l'] - out['actual']['agua_total_l']
    d_e = out['propuesto']['energia_total_kwh'] - out['actual']['energia_total_kwh']
    out['delta'] = {'agua_total_l': d_w, 'energia_total_kwh': d_e}
    if boot:
        ws = []
        mf, mt = models[inv[cooling_from]], models[inv[cooling_to]]
        for (wf, ef), (wt, et) in zip(mf.bootstrap(150), mt.bootstrap(150)):
            aw = mt.predict(base, wt).sum() - mf.predict(base, wf).sum()
            ae = mt.predict(base, et, 'total').sum() - mf.predict(base, ef, 'total').sum()
            ws.append((aw + ae * ewif))
        out['delta']['agua_total_l_ic95'] = (float(np.percentile(ws, 2.5)), float(np.percentile(ws, 97.5)))
    t_max = float(base.outdoor_temp_c.max())
    out['extrapola'] = t_max > float(df.outdoor_temp_c.max()) + 1e-9
    out['t_max'] = t_max
    out['horas'] = len(base)
    return out

"""Pronosticador de 24 h: Transformer encoder–decoder (con atención inspeccionable) y LSTM.

Entrada: 48 h de historia (clima, carga, consumo del modo operado) + 24 h de covariables futuras
(pronóstico de clima con error, carga planificada). Salida: cuantiles P10/P50/P90 de
[agua_evap, agua_seco, energía_evap, energía_seco, entrada_seco] para cada una de las próximas 24 h.
"""
import math
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.nn.functional as F
from .sim import CITIES, load_city, wet_bulb, TRAIN_END, VAL_END

LH, FH = 48, 24
QS = (0.1, 0.5, 0.9)
TARGETS = ['water_e', 'water_d', 'energy_e', 'energy_d', 'inlet_d']
NH, NF = 14, 10


def _cyc(time):
    hr = time.dt.hour.to_numpy() + time.dt.minute.to_numpy() / 60
    dow = time.dt.dayofweek.to_numpy()
    doy = time.dt.dayofyear.to_numpy()
    f = lambda x, p: (np.sin(2 * np.pi * x / p), np.cos(2 * np.pi * x / p))
    return np.stack([*f(hr, 24), *f(dow, 7), *f(doy, 365.25)], 1)


def forecast_noise(n, rng, sT=1.2, sRH=6.0, sL=0.05):
    """Error de pronóstico meteorológico: AR(1) horario (los errores reales están correlacionados)."""
    def ar(s):
        e, x = rng.normal(0, s * 0.45, n), np.zeros(n)
        for i in range(1, n):
            x[i] = 0.9 * x[i - 1] + e[i]
        return x
    return ar(sT), ar(sRH), rng.normal(0, sL, n)


def features(d, seed=1):
    """d: salida de sim.simulate. Devuelve (hist[N,14], fut[N,10], y[N,5])."""
    rng = np.random.default_rng(seed)
    cy = _cyc(d['time'])
    hist = np.c_[d['T'], d['RH'], d['Twb'], d['load'], cy, d['water_obs'], d['energy_obs'], d['inlet_obs'], d['mode']]
    eT, eRH, eL = forecast_noise(len(d), rng)
    Tn, RHn = d['T'].to_numpy() + eT, np.clip(d['RH'].to_numpy() + eRH, 5, 100)
    fut = np.c_[Tn, RHn, wet_bulb(Tn, RHn), d['load'].to_numpy() * (1 + eL), cy]
    y = d[TARGETS].to_numpy()
    return hist.astype(np.float32), fut.astype(np.float32), y.astype(np.float32)


class Scaler:
    def __init__(self, h=None, f=None, y=None):
        self.h, self.f, self.y = h, f, y

    @staticmethod
    def fit(H, Fu, Y):
        s = lambda a: (a.mean(0), a.std(0) + 1e-6)
        return Scaler(s(H), s(Fu), s(Y))

    def to_json(self):
        return {k: [v[0].tolist(), v[1].tolist()] for k, v in (('h', self.h), ('f', self.f), ('y', self.y))}

    @staticmethod
    def from_json(j):
        g = lambda k: (np.array(j[k][0], dtype=np.float32), np.array(j[k][1], dtype=np.float32))
        return Scaler(g('h'), g('f'), g('y'))


def split_mask(time):
    t = pd.Series(time)
    return (t <= pd.Timestamp(TRAIN_END)).to_numpy(), ((t > pd.Timestamp(TRAIN_END)) & (t <= pd.Timestamp(VAL_END))).to_numpy(), (t > pd.Timestamp(VAL_END)).to_numpy()


# ---------------------------------------------------------------- modelos
class Attn(nn.Module):
    def __init__(self, d, heads):
        super().__init__()
        self.h, self.dk = heads, d // heads
        self.q, self.k, self.v, self.o = (nn.Linear(d, d) for _ in range(4))

    def forward(self, x, mem):
        B, Lq, d = x.shape
        Lk = mem.shape[1]
        q = self.q(x).view(B, Lq, self.h, self.dk).transpose(1, 2)
        k = self.k(mem).view(B, Lk, self.h, self.dk).transpose(1, 2)
        v = self.v(mem).view(B, Lk, self.h, self.dk).transpose(1, 2)
        a = torch.softmax(q @ k.transpose(-1, -2) / math.sqrt(self.dk), -1)
        return self.o((a @ v).transpose(1, 2).reshape(B, Lq, d)), a


class Block(nn.Module):
    def __init__(self, d, heads, drop):
        super().__init__()
        self.att, self.n1, self.n2 = Attn(d, heads), nn.LayerNorm(d), nn.LayerNorm(d)
        self.ff = nn.Sequential(nn.Linear(d, 4 * d), nn.GELU(), nn.Dropout(drop), nn.Linear(4 * d, d))
        self.drop = nn.Dropout(drop)

    def forward(self, x, mem=None):
        a, w = self.att(self.n1(x), self.n1(x) if mem is None else mem)
        x = x + self.drop(a)
        return x + self.drop(self.ff(self.n2(x))), w


class TransformerForecaster(nn.Module):
    def __init__(self, d=64, heads=4, layers=3, drop=0.1):
        super().__init__()
        self.inp, self.fin = nn.Linear(NH, d), nn.Linear(NF, d)
        self.pe, self.pf = nn.Parameter(torch.randn(1, LH, d) * .02), nn.Parameter(torch.randn(1, FH, d) * .02)
        self.enc = nn.ModuleList(Block(d, heads, drop) for _ in range(layers))
        self.dec_self = Block(d, heads, drop)
        self.dec_cross = nn.ModuleList(Block(d, heads, drop) for _ in range(2))
        self.norm = nn.LayerNorm(d)
        self.head = nn.Linear(d, len(TARGETS) * len(QS))

    def forward(self, h, f, return_attn=False):
        x = self.inp(h) + self.pe
        enc_w = []
        for b in self.enc:
            x, w = b(x); enc_w.append(w)
        q, _ = self.dec_self(self.fin(f) + self.pf)
        cross_w = []
        for b in self.dec_cross:
            q, w = b(q, x); cross_w.append(w)
        out = self.head(self.norm(q)).view(h.shape[0], FH, len(TARGETS), len(QS))
        return (out, enc_w, cross_w) if return_attn else out


class LSTMForecaster(nn.Module):
    def __init__(self, d=96, drop=0.1):
        super().__init__()
        self.enc = nn.LSTM(NH, d, 2, batch_first=True, dropout=drop)
        self.dec = nn.LSTM(NF, d, 2, batch_first=True, dropout=drop)
        self.head = nn.Linear(d, len(TARGETS) * len(QS))

    def forward(self, h, f, return_attn=False):
        _, st = self.enc(h)
        o, _ = self.dec(f, st)
        return self.head(o).view(h.shape[0], FH, len(TARGETS), len(QS))


def pinball(pred, y):
    q = torch.tensor(QS, device=pred.device).view(1, 1, 1, -1)
    e = y.unsqueeze(-1) - pred
    return torch.maximum(q * e, (q - 1) * e).mean()


@torch.no_grad()
def predict(model, h, f, sc, device, batch=1024):
    """h:[N,LH,NH] f:[N,FH,NF] sin escalar -> [N,FH,5,3] en unidades reales (cuantiles ordenados)."""
    model.eval()
    hs = torch.tensor((h - sc.h[0]) / sc.h[1], device=device)
    fs = torch.tensor((f - sc.f[0]) / sc.f[1], device=device)
    out = []
    for i in range(0, len(hs), batch):
        out.append(model(hs[i:i + batch], fs[i:i + batch]).float().cpu().numpy())
    o = np.sort(np.concatenate(out), -1)
    return o * sc.y[1].reshape(1, 1, -1, 1) + sc.y[0].reshape(1, 1, -1, 1)


def windows(H, Fu, Y, ends):
    """ends: índices i (primer instante a pronosticar). hist=[i-LH,i), fut=[i,i+FH)."""
    a = np.arange(-LH, 0)[None] + ends[:, None]
    b = np.arange(0, FH)[None] + ends[:, None]
    return H[a], Fu[b], Y[b]


def load_all(seed_base=1):
    data = {}
    for k, c in enumerate(CITIES):
        d = load_city(c)
        H, Fu, Y = features(d, seed=seed_base + k)
        data[c] = dict(df=d, H=H, F=Fu, Y=Y)
    return data

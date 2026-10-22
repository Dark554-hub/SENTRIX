"""Entrena Transformer y LSTM; evalúa en 2026 (clima real nunca visto) contra baseline de persistencia."""
import json
import sys
import time
from pathlib import Path
import numpy as np
import torch
from aguasegura.nn import (TransformerForecaster, LSTMForecaster, Scaler, split_mask, windows, load_all, predict,
                           pinball, TARGETS, LH, FH, QS)

ROOT = Path(__file__).resolve().parent
(ROOT / 'models').mkdir(exist_ok=True)
dev = 'cuda' if torch.cuda.is_available() else 'cpu'
EPOCHS = int(sys.argv[1]) if len(sys.argv) > 1 else 14
torch.manual_seed(22102026); np.random.seed(22102026)

data = load_all()
tr_H = np.concatenate([v['H'][split_mask(v['df'].time)[0]] for v in data.values()])
tr_F = np.concatenate([v['F'][split_mask(v['df'].time)[0]] for v in data.values()])
tr_Y = np.concatenate([v['Y'][split_mask(v['df'].time)[0]] for v in data.values()])
sc = Scaler.fit(tr_H, tr_F, tr_Y)
(ROOT / 'models' / 'scaler.json').write_text(json.dumps(sc.to_json()))


def build(which, stride):
    Hs, Fs, Ys = [], [], []
    for v in data.values():
        m = split_mask(v['df'].time)[which]
        idx = np.where(m)[0]
        ends = idx[(idx >= LH) & (idx + FH <= len(v['df']))][::stride]
        ends = ends[m[ends + FH - 1]]
        h, f, y = windows(v['H'], v['F'], v['Y'], ends)
        Hs.append(h); Fs.append(f); Ys.append(y)
    return np.concatenate(Hs), np.concatenate(Fs), np.concatenate(Ys)


def tens(h, f, y):
    return (torch.tensor((h - sc.h[0]) / sc.h[1], device=dev), torch.tensor((f - sc.f[0]) / sc.f[1], device=dev),
            torch.tensor((y - sc.y[0]) / sc.y[1], device=dev))


trh, trf, try_ = tens(*build(0, 2))
vah, vaf, vay = tens(*build(1, 6))
print(f'ventanas train={len(trh)} val={len(vah)} dispositivo={dev}', flush=True)


def fit(model, name):
    opt = torch.optim.AdamW(model.parameters(), 1e-3, weight_decay=1e-4)
    steps = EPOCHS * (len(trh) // 512 + 1)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, 2e-3, total_steps=steps)
    best, t0 = 1e9, time.time()
    for ep in range(EPOCHS):
        model.train()
        perm = torch.randperm(len(trh), device=dev)
        tl = 0
        for i in range(0, len(trh), 512):
            b = perm[i:i + 512]
            with torch.autocast(dev, dtype=torch.bfloat16, enabled=dev == 'cuda'):
                loss = pinball(model(trh[b], trf[b]).float(), try_[b])
            opt.zero_grad(); loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step(); sched.step(); tl += loss.item() * len(b)
        model.eval()
        with torch.no_grad():
            vl = np.mean([pinball(model(vah[i:i + 1024], vaf[i:i + 1024]).float(), vay[i:i + 1024]).item()
                          for i in range(0, len(vah), 1024)])
        if vl < best:
            best = vl; torch.save(model.state_dict(), ROOT / 'models' / f'{name}.pt')
        print(f'{name} ep{ep + 1:02d} train={tl / len(trh):.4f} val={vl:.4f} ({time.time() - t0:.0f}s)', flush=True)
    model.load_state_dict(torch.load(ROOT / 'models' / f'{name}.pt'))
    return model


tf = fit(TransformerForecaster().to(dev), 'transformer')
ls = fit(LSTMForecaster().to(dev), 'lstm')

# ---- evaluación en test (2026, clima real) en unidades reales
teH, teF, teY = build(2, 6)
res = {}
for name, m in (('Transformer (atención)', tf), ('LSTM', ls)):
    p = predict(m, teH, teF, sc, dev)
    res[name] = {t: float(np.abs(p[:, :, i, 1] - teY[:, :, i]).mean()) for i, t in enumerate(TARGETS)}
    res[name]['cobertura_P10_P90'] = float(((teY >= p[..., 0]) & (teY <= p[..., 2])).mean())
# persistencia: ayer a la misma hora (usa el contrafactual de ayer: ventaja a favor del baseline)
naive = []
for v in data.values():
    m = split_mask(v['df'].time)[2]
    idx = np.where(m)[0]
    ends = idx[(idx >= LH + 24) & (idx + FH <= len(v['df']))][::6]
    ends = ends[m[ends + FH - 1]]
    _, _, y = windows(v['H'], v['F'], v['Y'], ends)
    _, _, yprev = windows(v['H'], v['F'], v['Y'], ends - 24)
    naive.append(np.abs(y - yprev).mean((0, 1)))
res['Persistencia (ayer)'] = {t: float(x) for t, x in zip(TARGETS, np.mean(naive, 0))}
scale = {t: float(teY[:, :, i].mean()) for i, t in enumerate(TARGETS)}
(ROOT / 'models' / 'metrics.json').write_text(json.dumps({'mae': res, 'media_test': scale, 'n_test': int(len(teH))}, indent=1))
print(json.dumps(res, indent=1))

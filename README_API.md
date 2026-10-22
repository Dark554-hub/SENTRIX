# AguaSegura AI — API (backend)

```
pip install -r requirements.txt
uvicorn api:app --port 8000        # docs interactivas: http://localhost:8000/docs
```
DATOS SIMULADOS: clima real (Open-Meteo); carga, torre y consumos simulados (kit CIFOX). Cada respuesta trae `notice`.
CORS abierto (solo GET) para que cualquier front lo consuma.

| Endpoint | Para qué |
|---|---|
| `GET /health` | estado y dispositivo (cuda/cpu) |
| `GET /cities` | lat/lon y clima real 2026 por ciudad (para el mapa) |
| `GET /summary?lam=1&margin=0` | 5 políticas, por ciudad y total: agua ahorrada %, energía extra %, horas inseguras evitables |
| `GET /days?city=Querétaro` | días disponibles (2026) |
| `GET /forecast?city=Querétaro&day=2026-04-20&lam=1&margin=0` | 24 h: pronóstico P10/P50/P90, real, decisión (seco/evaporativo) y KPI del día |
| `GET /model/metrics` | MAE en 2026: Transformer, LSTM, persistencia |
| `GET /model/attention?city=Querétaro` | matriz de atención 24 futuro × 48 pasado |
| `GET /scenario?dT=1.5` | mismo clima 2026 + ΔT °C (prueba de estrés, no predicción climática) |
| `GET /pareto?lam=1` | ahorro de agua vs. horas inseguras al variar el margen |

Parámetros: `lam` = litros de agua que "vale" 1 kWh extra (supuesto editable); `margin` = margen de seguridad térmica en °C.
Variables de `/forecast`: `water_e`/`water_d` (L/h evaporativo/seco), `energy_e`/`energy_d` (kWh/h), `inlet_d` (°C de entrada en modo seco; límite 27).

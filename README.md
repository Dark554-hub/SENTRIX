# SENTRIX

Sistema de apoyo a la decisión para **reducir el agua de enfriamiento de centros de datos de IA en México**. Combina clima real con un simulador físico de enfriamiento híbrido (seco / evaporativo) y un modelo Transformer que pronostica consumo de agua y energía 24 h por delante para decidir, hora a hora, qué modo de enfriamiento conviene.

> **Aviso:** la operación del centro de datos (carga, torre, consumos) es **simulada**, calibrada con el kit CIFOX. El clima es real (Open-Meteo). No son mediciones de un centro de datos real.

## Qué incluye

| Componente | Descripción |
|---|---|
| `aguasegura/` | Núcleo en Python: simulador (`sim.py`), modelos Transformer/LSTM (`nn.py`), políticas de control (`policy.py`) y baseline PUE/WUE (`core.py`) |
| `api.py` | API REST (FastAPI) que sirve pronósticos, decisiones y escenarios; también sirve el front web |
| `web/` | Observatorio web (HTML/JS/CSS) con mapa por ciudad, pronóstico y simulador de escenarios |
| `saas.py` | Cuentas, login, parámetros guardados, reporte de ahorro en MXN y planes |
| `web/cuenta.html` | Portal del cliente: login, parámetros de su sitio, ahorro y planes |
| `app.py` | Panel local en Streamlit |
| `train.py` | Entrenamiento y evaluación de Transformer y LSTM contra persistencia |
| `AguaSegura_AI.ipynb` | Notebook con el análisis completo |
| `models/` | Modelos entrenados y métricas |
| `data/` | Clima real y simulaciones por ciudad (13 ciudades) |
| `tests/` | Pruebas unitarias |

## Cómo funciona

1. **Datos:** clima horario real de 13 ciudades: 7 de México (Chihuahua, Ciudad de México, Guadalajara, Mexicali, Monterrey, Mérida, Querétaro) y 6 polos de centros de datos de IA en EE. UU. (Silicon Valley, Ashburn, Phoenix, Dallas, Prineville y Council Bluffs). El modelo se entrenó solo con las ciudades de México; en las de EE. UU. se usa tal cual, como prueba de transferencia.
2. **Simulador:** carga de IA, estado de la torre y consumos de agua/energía, calibrados con el kit CIFOX (PUE evaporativo ≈ 1.24, PUE aire ≈ 1.37, WUE evaporativo ≈ 0.9 L/kWh IT).
3. **Pronóstico:** Transformer con intervalos P10/P50/P90, entrenado con histórico y evaluado en 2026 (clima nunca visto) contra LSTM y persistencia.
4. **Políticas comparadas:** siempre evaporativo (status quo), reactiva, pronóstico ingenuo (ayer), **IA (Transformer)** y oráculo (techo teórico).
5. **Decisión:** el modo seco ahorra agua pero cuesta energía; un parámetro `lam` y un margen de seguridad térmica controlan el equilibrio (frente de Pareto).

### Resultados del modelo (MAE en 2026)

| Modelo | Agua evaporativa (L) | Energía evaporativa (kWh) |
|---|---|---|
| **Transformer (atención)** | **6.35** | **3.57** |
| LSTM | 6.36 | 3.90 |
| Persistencia (ayer) | 18.64 | 16.19 |

Detalle completo en [`models/metrics.json`](models/metrics.json).

## Instalación y ejecución

Requiere Python 3.10+.

```bash
pip install -r requirements.txt
```

**API + web** (docs interactivas en `/docs`):

```bash
uvicorn api:app --port 8000
# web:  http://localhost:8000
# docs: http://localhost:8000/docs
```

**Panel Streamlit:**

```bash
streamlit run app.py
```

**Pruebas:**

```bash
python -m unittest discover -s tests
```

**Re-entrenar modelos** (opcional, el repo ya incluye los entrenados):

```bash
python train.py 14   # épocas
```

## Cuenta, parámetros y planes

Flujo: abres `http://localhost:8000`, si no has iniciado sesión te lleva al login; al entrar ves el mapa del observatorio ya en la ciudad de tu sitio, y el botón **Parámetros** abre un panel donde mueves ciudad, peso agua/energía, margen térmico y precios: el mapa, el día de operación, los escenarios y el beneficio neto se recalculan al momento y se guardan en tu cuenta. Planes y portafolio están en `http://localhost:8000/cuenta.html`. Cada empresa crea su cuenta, configura su ciudad, el peso agua vs. energía, el margen térmico y sus precios de agua y energía, y ve su **ahorro en litros y en pesos** (beneficio neto = agua ahorrada − energía extra). Los parámetros se guardan por cuenta. El botón **Encontrar la configuración óptima** barre el peso agua/energía y recomienda el que maximiza el beneficio neto con tus precios; si ahorrar agua no se paga solo, recomienda mantener el enfriamiento evaporativo. Para justificar el ahorro en zonas de estrés hídrico, el campo *valor por escasez del agua* (riesgo, ESG, multas) suma ese valor al agua ahorrada.

| Plan | Precio | Incluye |
|---|---|---|
| Piloto | Gratis | 1 sitio, reporte de ahorro, parámetros guardados |
| Pro | $4,990 MXN/mes | Hasta 5 sitios, comparativo de portafolio, alertas |
| Enterprise | Cotización | Telemetría propia, reentrenamiento por sitio, SLA |

Los precios son una propuesta inicial por validar. El cobro (Stripe) está pendiente: subir de plan está bloqueado (HTTP 402) salvo `SENTRIX_DEMO_UPGRADES=1`, pensado solo para demos.

### Seguridad

- Contraseñas con PBKDF2-HMAC-SHA256 (600 000 iteraciones) y sal por usuario; validación de correo y rechazo de contraseñas débiles.
- Tokens firmados con HMAC-SHA256 que expiran a las 8 h. La llave sale de `SENTRIX_SECRET` o se genera al azar en `.sentrix_secret` (fuera de git). No hay llaves en el código.
- Bloqueo tras 5 intentos fallidos en 15 min por IP y correo; el login cuesta lo mismo exista o no el usuario (no revela cuentas).
- Consultas SQL parametrizadas, entradas validadas con rangos (Pydantic) y ciudades contra lista permitida.
- Permisos por plan hechos en el servidor, no solo en la interfaz (portafolio solo Pro; nadie se sube de plan sin pagar).
- Cabeceras de seguridad (CSP en el portal, `X-Frame-Options`, `nosniff`, `no-store` en rutas privadas), CORS restringido por `SENTRIX_ORIGINS` y sin scripts inline.
- Pendiente antes de producción real: HTTPS, base Postgres, rate limit compartido (Redis), recuperación de contraseña y verificación de correo.

Variables de entorno: `SENTRIX_SECRET`, `SENTRIX_DB`, `SENTRIX_ORIGINS`, `SENTRIX_DEMO_UPGRADES`.

## API

Referencia completa en [`README_API.md`](README_API.md). Endpoints principales: `/health`, `/cities`, `/summary`, `/days`, `/forecast`, `/model/metrics`, `/model/attention`, `/scenario`, `/pareto`. Cada respuesta incluye un campo `notice` que indica que los datos son simulados.

## Limitaciones

- La operación del centro de datos es sintética; los resultados son una prueba de concepto, no una garantía de ahorro.
- El escenario de ΔT es una prueba de estrés, no una predicción climática.
- No se modelan humedad de bulbo húmedo detallada, ciclos de concentración ni caudal real.
- No expongas el servidor local a internet.

## Equipo

<!-- Completar con los integrantes del equipo -->

| Nombre | Rol |
|---|---|
| _Por completar_ | _Por completar_ |

## Licencia y créditos

Los datos simulados se basan en el kit CIFOX (MIT); ver [`LICENSE-CIFOX-kit`](LICENSE-CIFOX-kit). Clima: [Open-Meteo](https://open-meteo.com/).

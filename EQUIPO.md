# AguaSegura AI — guía para el equipo

> **Aviso que siempre tenemos que decir:** el clima es **real** (Open-Meteo), pero la operación del centro de datos (carga, torre de enfriamiento, consumos) es **simulada**, calibrada con el kit CIFOX, que a su vez es sintético. Ningún número es una medición de un centro de datos real.

---

## 1. Qué es, en una frase

Una IA que **pronostica las próximas 24 horas** (clima, carga, temperatura de los servidores) y **decide hora por hora** si enfriar el centro de datos **en seco** (casi sin agua) o **con agua**, para gastar la menor agua posible sin sobrecalentar los servidores.

## 2. El problema ambiental

- Los centros de datos de IA se enfrían, en buena parte, con **torres de enfriamiento evaporativas**: evaporan agua para sacar el calor. Es barato en energía, pero gasta **mucha agua**.
- El **enfriamiento en seco** (con aire) casi no usa agua, pero consume **más electricidad** y solo funciona si el aire está lo bastante fresco.
- Hoy la decisión suele ser fija o por reglas simples. Con **buen pronóstico** se puede usar el modo seco **justo cuando es seguro** y reservar el agua para las horas realmente calientes.

**Cómo aporta a lo ambiental:** menos litros extraídos para enfriar IA, con un costo de energía conocido y medido (no escondido).

## 3. Qué hicimos (de principio a fin)

| Paso | Qué es | Dónde |
|---|---|---|
| 1. Clima real | Temperatura y humedad horarias de 7 ciudades de México, 2022–2026 | [sim.py](aguasegura/sim.py) |
| 2. Simulador físico | Centro de datos híbrido con dos modos (seco / evaporativo), calibrado con el kit CIFOX. Incluye estados ocultos (inercia de la torre, incrustación) | [sim.py](aguasegura/sim.py) |
| 3. Modelos | **Transformer de atención** y **LSTM** que pronostican 24 h de agua, energía y temperatura de entrada, con rango de incertidumbre (P10/P50/P90) | [nn.py](aguasegura/nn.py), [train.py](train.py) |
| 4. Política de control | Regla de decisión hora por hora que usa el pronóstico | [policy.py](aguasegura/policy.py) |
| 5. API | Sirve todo al front | [api.py](api.py) |
| 6. Front | Observatorio interactivo con mapa, gráficos y transiciones | carpeta [web/](web/) |
| 7. Notebook | Todo el flujo reproducible con gráficas | [AguaSegura_AI.ipynb](AguaSegura_AI.ipynb) |

**Cómo se evaluó sin hacer trampa:** se entrenó con 2022–2024, se validó con 2025 y se **probó en 2026**, clima real que el modelo nunca vio. El pronóstico del clima futuro se le da **con error** (como en la vida real).

## 4. La innovación (qué tiene de distinto)

1. **Decisión, no solo predicción.** No nos quedamos en "pronosticar el agua": el pronóstico se usa para **controlar** el modo de enfriamiento hora por hora.
2. **Incertidumbre explícita.** El modelo da un rango (P10–P90), no un solo número; la decisión usa el pronóstico de la temperatura de entrada para no pasarse del límite de 27 °C.
3. **Memoria de estados ocultos.** La torre tiene inercia y se ensucia; el modelo de atención los infiere de la historia de 48 h.
4. **Clima real de 7 ciudades** con climas muy distintos (Querétaro fresco, Mérida húmedo, Mexicali seco), no un solo caso.
5. **Transparencia:** el sistema muestra el costo (energía extra), los límites y qué no demuestra.

## 5. Resultados y cómo mejoramos frente a los baselines (2026, clima real)

**Resultado principal:** **56 % menos agua** y **5.5 % más energía** frente a enfriar siempre con agua (≈ 4.6 millones de litros en 7 ciudades, ene–sep 2026).

**Pronóstico** (error medio a 24 h, menor es mejor):

| Variable | Persistencia ("repetir ayer") | Transformer | Mejora |
|---|---|---|---|
| Agua evaporativo (L/h) | 18.6 | 6.4 | **66 %** |
| Energía evaporativo (kWh/h) | 16.2 | 3.6 | **78 %** |
| Temperatura de entrada, seco (°C) | 1.67 | 0.80 | **52 %** |

El LSTM queda casi igual: **no es una diferencia que haya que vender**. El Transformer gana en energía; el LSTM, en cobertura del intervalo (80 % vs 78 %, ideal 80 %). La persistencia usa datos de ayer que un operador real no tendría: es una ventaja para el baseline.

**Decisión** (horas inseguras que se podían evitar, 2026, a igual ahorro de agua ≈ 56 %):

| Política | Horas inseguras evitables |
|---|---|
| Siempre evaporativo (status quo) | 4,134 |
| Pronóstico "ayer" | 1,833 |
| Regla reactiva (hora anterior) | 1,411 |
| **IA (Transformer)** | **839** |
| Oráculo (conoce el futuro; techo teórico) | 0 |

**Lectura honesta:** la IA ahorra casi el mismo agua que las reglas simples, pero con **~40 % menos horas inseguras que la regla reactiva** y ~54 % menos que "ayer". La ganancia es **modesta pero real**, y queda lejos del oráculo.

**Baseline del kit (primer prototipo, `app_baseline_kit.py`):** el detector de anomalías por reglas más Isolation Forest del kit tenía precisión 0.38 y recall 0.48; nuestro modelo residual llegó a precisión 1.0 y recall 0.76 sin usar la señal de eventos OT.

## 6. Qué es interactivo

En el front (http://localhost:PUERTO):
- **Mapa:** clic en una ciudad → el mapa vuela, se abre su panel con ahorro, energía extra y horas en que el modo seco es viable.
- **Un día:** elige ciudad y recorre los días de 2026 con un control deslizable. Ves pronóstico contra realidad, la banda de incertidumbre y la decisión hora por hora. Pasa el cursor sobre el gráfico para ver cada hora.
- **Cerebro:** mapa de calor de en qué horas pasadas se fija el modelo (pasa el cursor) y comparación de errores.
- **Escenarios:** botones de calentamiento (+1.5 °C, +3 °C) y un deslizador de **λ**; todo se recalcula.

## 7. Qué se puede personalizar

**Desde el front (hoy):**

| Control | Qué cambia |
|---|---|
| Ciudad (mapa o botones) | Dónde se simula |
| Día (deslizador) | Qué día de 2026 se muestra |
| Calentamiento (+0 / +1.5 / +3 °C) | Prueba de estrés climático |
| **λ** (litros que "vale" 1 kWh extra) | Qué tanto pesa la energía frente al agua. Más λ = menos modo seco |

**Desde la API:** además de lo anterior, el parámetro `margin` (margen de seguridad térmica en °C: más margen = más prudente). Está en `/summary`, `/forecast`, `/scenario`, `/pareto` (ver [README_API.md](README_API.md)).

**Desde el código (hay que regenerar y reentrenar):**
- Ciudades y fechas: `CITIES`, `START`, `END` en [sim.py](aguasegura/sim.py). Para otros países cambiar `timezone` a `auto`.
- Límite térmico: `INLET_MAX` (27 °C).
- Física del simulador: consumos, ciclos de concentración, inercia.
- Modelo: capas, cabezas y tamaño en `TransformerForecaster` ([nn.py](aguasegura/nn.py)); épocas con `python train.py 20`.

**Ideas para que sea aún más personalizable (NO están hechas):**
- Subir un CSV propio de telemetría (carga, consumo) para correr el modelo con datos de un cliente.
- Elegir el tipo de enfriamiento y el límite térmico desde la pantalla.
- Agregar una ciudad desde un formulario (hoy es editar código).
- Meter el agua indirecta de la red eléctrica por región como dato, no como supuesto.

## 8. Límites (decirlos nosotros primero)

1. **Lo operativo es simulado.** El modelo aprende nuestro simulador, no un centro de datos real. Lo real es el clima.
2. **Contrafactuales:** en la simulación sabemos qué habría pasado en el otro modo; en la realidad no.
3. **Humedad supuesta** (50 %) para calibrar, porque el kit no la trae.
4. **Una torre híbrida y un límite fijo de 27 °C.** En Mérida y Monterrey ni el modo evaporativo aguanta muchas horas: ahí haría falta enfriamiento líquido, que no modelamos.
5. **El pronóstico del clima lleva error sintético**, no es un pronóstico meteorológico real.
6. **Agua = captación en sitio.** El agua indirecta (de generar la electricidad) entra solo vía λ, que es un supuesto.
7. **No sabemos qué modelos usa la infraestructura real.** Nos comparamos contra reglas razonables y persistencia, no contra su sistema.
8. **No hay "litros por consulta de IA":** el kit lo prohíbe y no lo calculamos.

**Qué mediríamos antes de recomendar cambios reales:** humedad o bulbo húmedo en sitio, caudal y ciclos de concentración de la torre, y la intensidad hídrica de la electricidad local.

## 9. Cómo correrlo

```
cd Hackathon3\aguasegura
pip install -r requirements.txt
uvicorn api:app --port 8010      # abre http://localhost:8010
```
- Notebook: [AguaSegura_AI.ipynb](AguaSegura_AI.ipynb) (con `RETRAIN = True` reentrena en ~2 min con GPU).
- Panel Streamlit alterno: `streamlit run app.py`.
- Necesita internet para el mapa y las fuentes.
- Los modelos entrenados están en `models/` (`transformer.pt`, `lstm.pt`, `scaler.json`, `metrics.json`).

## 10. Preguntas probables del jurado

- **"¿Es real?"** El clima sí; la operación es simulada con el kit del reto. Lo decimos desde la primera pantalla.
- **"¿Por qué no una regla simple?"** Una regla ahorra casi lo mismo, pero con ~40 % más horas inseguras. El pronóstico aporta seguridad, no solo ahorro.
- **"¿Por qué Transformer y no LSTM?"** Rinden casi igual; el Transformer gana en energía y deja ver en qué horas se fija. No lo vendemos como superior.
- **"¿Cuánto cuesta el ahorro?"** 5.5 % más de energía; la curva ahorro–energía está en Escenarios.
- **"¿Funciona en climas húmedos?"** Menos: en Mérida el ahorro baja (≈ 39 %) y en Monterrey (≈ 50 %); ahí hace falta enfriamiento líquido.
- **"¿Qué haría falta para producción?"** Telemetría real, humedad en sitio, datos de la torre y validar con el operador.

## 11. Guion de 3 minutos

1. **Problema (20 s):** enfriar IA gasta agua; la decisión suele ser fija.
2. **Idea (20 s):** pronosticar 24 h y decidir seco o agua cada hora.
3. **Mapa (40 s):** 56 % menos agua; Querétaro y CDMX ahorran mucho, Mérida poco.
4. **Un día (50 s):** pronóstico contra realidad y la decisión hora por hora.
5. **Escenarios (30 s):** +3 °C y el costo en energía.
6. **Cierre (20 s):** límites, empezando por que lo operativo es simulado.

"""AguaSegura AI — panel interactivo (front). Usa el backend: clima real + simulador + Transformer + política."""
import json
import warnings
import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st
import torch
from plotly.subplots import make_subplots

from aguasegura.sim import CITIES, INLET_MAX, load_city
from aguasegura.nn import TransformerForecaster, Scaler, LH, FH
from aguasegura.policy import prepare, evaluate, decisions, pareto, POLICIES

warnings.filterwarnings('ignore')
st.set_page_config(page_title='AguaSegura AI', page_icon='💧', layout='wide')
dev = 'cuda' if torch.cuda.is_available() else 'cpu'
IA, BASE = POLICIES[3], POLICIES[0]

st.markdown('<style>.block-container{padding-top:1.2rem}</style>', unsafe_allow_html=True)
st.error('⚠️ DATOS SIMULADOS: el clima es real (Open-Meteo), pero la carga, la torre de enfriamiento y los consumos son '
         'simulados (calibrados con el kit CIFOX). Ninguna cifra es una medición de un centro de datos real.')
st.title('💧 AguaSegura AI')
st.caption('Una IA que pronostica 24 h por delante y decide, hora por hora, cuándo enfriar en seco (casi sin agua) y cuándo con agua.')


@st.cache_resource
def backend():
    sc = Scaler.from_json(json.load(open('models/scaler.json')))
    m = TransformerForecaster().to(dev)
    m.load_state_dict(torch.load('models/transformer.pt', map_location=dev)); m.eval()
    return m, sc


@st.cache_resource
def city_data(city, dT=0.0):
    m, sc = backend()
    return prepare(city, m, sc, dev, dT=dT)


model, scaler = backend()
metrics = json.load(open('models/metrics.json'))

with st.sidebar:
    st.header('Controles')
    lam = st.slider('λ · litros que "vale" 1 kWh extra', 0.0, 8.0, 1.0, 0.5,
                    help='Incluye el agua indirecta de la red eléctrica. Es un SUPUESTO editable, no una medición.')
    margin = st.slider('Margen de seguridad térmica (°C)', -1.0, 4.0, 0.0, 0.5,
                       help='Más margen = más prudente (menos horas en seco, más agua).')
    city = st.selectbox('Ciudad', list(CITIES), index=0)
    with st.expander('📖 Cómo leer este panel'):
        st.markdown(f"""
1. **Mapa:** dónde se ahorra más agua con la IA (2026, clima real).
2. **Operación 24 h:** elige un día; mira el pronóstico contra lo que pasó y qué decidió la IA.
3. **Modelo:** qué tan bien pronostica y en qué hora pasada se fija.
4. **Escenarios:** qué pasa con más calor o con otro valor de λ.
- Modo **seco** = casi sin agua, más energía, solo seguro si la entrada ≤ {INLET_MAX:.0f} °C.
- Modo **evaporativo** = poca energía, mucha agua.
""")

Ps = {c: city_data(c) for c in CITIES}
res = pd.concat([evaluate(P, lam=lam, margin=margin) for P in Ps.values()])
ia = res[res.politica == IA].set_index('ciudad')
tot = res.groupby('politica')[['agua_l', 'energia_kwh', 'horas_riesgo_evitable']].sum()

k1, k2, k3, k4 = st.columns(4)
b = tot.loc[BASE]
k1.metric('Agua ahorrada (7 ciudades, 2026)', f"{(b.agua_l - tot.loc[IA].agua_l) / 1e6:.2f} M L",
          f"{100 * (b.agua_l - tot.loc[IA].agua_l) / b.agua_l:.0f} % vs. siempre-evaporativo")
k2.metric('Energía extra', f"{100 * (tot.loc[IA].energia_kwh / b.energia_kwh - 1):.1f} %", 'el costo del modo seco', delta_color='off')
k3.metric('Horas inseguras evitables', f"{int(tot.loc[IA].horas_riesgo_evitable):,}",
          f"{int(tot.loc[POLICIES[1]].horas_riesgo_evitable - tot.loc[IA].horas_riesgo_evitable):,} menos que la regla reactiva", delta_color='normal')
k4.metric('Error del pronóstico de agua', f"{metrics['mae']['Transformer (atención)']['water_e']:.1f} L/h",
          f"{100 * (1 - metrics['mae']['Transformer (atención)']['water_e'] / metrics['mae']['Persistencia (ayer)']['water_e']):.0f} % mejor que 'ayer'")

t1, t2, t3, t4, t5 = st.tabs(['🗺️ Mapa', '⏱️ Operación 24 h', '🧠 Modelo', '🔥 Escenarios', '⚠️ Límites'])

# ---------------------------------------------------------------- mapa
with t1:
    d = pd.DataFrame({'ciudad': list(CITIES), 'lat': [v[0] for v in CITIES.values()], 'lon': [v[1] for v in CITIES.values()]})
    d = d.merge(ia[['agua_ahorrada_l', 'agua_ahorrada_%', 'energia_extra_%', 'horas_riesgo_evitable']].reset_index(), on='ciudad')
    fig = px.scatter_map(d, lat='lat', lon='lon', size='agua_ahorrada_l', color='agua_ahorrada_%', text='ciudad',
                         color_continuous_scale='Tealgrn', size_max=60, zoom=4.2, center=dict(lat=24.5, lon=-102),
                         map_style='carto-darkmatter',
                         hover_data={'agua_ahorrada_%': ':.0f', 'agua_ahorrada_l': ':,.0f', 'energia_extra_%': ':.1f',
                                     'horas_riesgo_evitable': True, 'lat': False, 'lon': False})
    fig.update_layout(height=560, margin=dict(l=0, r=0, t=0, b=0), coloraxis_colorbar_title='% agua')
    st.plotly_chart(fig, width='stretch')
    st.caption('Tamaño = litros ahorrados · color = % ahorrado vs. enfriar siempre con agua (módulo ~340 kW IT, ene–sep 2026). '
               'En Mérida y Monterrey ni el modo evaporativo mantiene 27 °C muchas horas: ahí hace falta enfriamiento líquido.')
    show = res.pivot(index='ciudad', columns='politica', values='agua_ahorrada_%')[POLICIES[1:]].round(0)
    st.dataframe(show.style.format('{:.0f} %').background_gradient(cmap='Blues', axis=None), width='stretch')

# ---------------------------------------------------------------- operación 24 h
with t2:
    P = Ps[city]
    dry = decisions(P, lam=lam, margin=margin)[IA]
    days = pd.to_datetime(P['times'][:, 0])
    day = st.select_slider('Día (2026)', options=list(range(len(days))), value=len(days) // 2,
                           format_func=lambda i: days[i].strftime('%d %b'))
    p, y, t = P['p'][day], P['y'][day], pd.to_datetime(P['times'][day])
    w_base, w_ia = y[:, 0].sum(), np.where(dry[day], y[:, 1], y[:, 0]).sum()
    c1, c2, c3 = st.columns(3)
    c1.metric('Agua ese día (IA)', f'{w_ia:,.0f} L', f'{-(w_base - w_ia):,.0f} L vs. status quo', delta_color='inverse')
    c2.metric('Horas en modo seco', f'{int(dry[day].sum())} / 24')
    c3.metric('Temp. exterior máx.', f"{P['f'][day][:, 0].max():.1f} °C (pronóstico)")
    fig = make_subplots(rows=3, cols=1, shared_xaxes=True, vertical_spacing=.07, row_heights=[.42, .38, .2],
                        subplot_titles=('Agua en modo evaporativo (L/h): pronóstico vs. realidad',
                                        'Temperatura de entrada del modo seco (°C) vs. límite', 'Decisión de la IA'))
    fig.add_scatter(x=t, y=p[:, 0, 0], line=dict(width=0), showlegend=False, hoverinfo='skip', row=1, col=1)
    fig.add_scatter(x=t, y=p[:, 0, 2], fill='tonexty', fillcolor='rgba(44,163,220,.25)', line=dict(width=0), name='banda P10–P90', row=1, col=1)
    fig.add_scatter(x=t, y=p[:, 0, 1], line=dict(color='#2ca3dc', dash='dot'), name='pronóstico', row=1, col=1)
    fig.add_scatter(x=t, y=y[:, 0], line=dict(color='white'), name='real', row=1, col=1)
    fig.add_scatter(x=t, y=y[:, 4], line=dict(color='#ff8a5c'), name='entrada seco real', row=2, col=1)
    fig.add_scatter(x=t, y=p[:, 4, 1], line=dict(color='#ffd166', dash='dot'), name='entrada seco pronóstico', row=2, col=1)
    fig.add_hline(y=INLET_MAX, line_dash='dash', line_color='red', annotation_text=f'{INLET_MAX:.0f} °C', row=2, col=1)
    fig.add_bar(x=t, y=[1] * 24, marker_color=np.where(dry[day], '#7fd18b', '#2ca3dc'), name='decisión',
                customdata=np.where(dry[day], 'SECO', 'EVAPORATIVO'), hovertemplate='%{x|%H:%M} → %{customdata}<extra></extra>', row=3, col=1)
    fig.update_yaxes(visible=False, row=3, col=1)
    fig.update_layout(height=700, template='plotly_dark', legend=dict(orientation='h', y=-0.08), margin=dict(t=40))
    st.plotly_chart(fig, width='stretch')
    st.caption('Verde = seco · azul = evaporativo. La banda es la incertidumbre del modelo; si el pronóstico de entrada seca se acerca a la línea roja, la IA prefiere agua.')

# ---------------------------------------------------------------- modelo
with t3:
    etiq = {'water_e': 'Agua evaporativo', 'water_d': 'Agua seco', 'energy_e': 'Energía evap', 'energy_d': 'Energía seco', 'inlet_d': 'Entrada seco'}
    mae = pd.DataFrame(metrics['mae']).T[list(etiq)].rename(columns=etiq).reset_index().melt('index', var_name='variable', value_name='MAE')
    fig = px.bar(mae, x='variable', y='MAE', color='index', barmode='group', template='plotly_dark',
                 color_discrete_sequence=['#8f9aa8', '#ffb347', '#2ca3dc'], labels={'index': 'modelo'},
                 title='Error absoluto medio a 24 h en 2026 (menor es mejor)')
    st.plotly_chart(fig, width='stretch')
    cA, cB = st.columns([3, 2])
    with cA:
        hh = torch.tensor((P['h'][:300] - scaler.h[0]) / scaler.h[1], device=dev)
        ff = torch.tensor((P['f'][:300] - scaler.f[0]) / scaler.f[1], device=dev)
        with torch.no_grad():
            _, _, cross = model(hh, ff, return_attn=True)
        A = cross[-1].mean((0, 1)).float().cpu().numpy()
        fig = px.imshow(A, x=list(range(-LH, 0)), y=list(range(FH)), aspect='auto', color_continuous_scale='Viridis', template='plotly_dark',
                        labels=dict(x='hora pasada', y='hora futura', color='atención'), title=f'Atención del Transformer · {city}')
        st.plotly_chart(fig, width='stretch')
    with cB:
        lag = A.mean(0); top = np.argsort(lag)[::-1][:5]
        st.markdown('**Horas pasadas en las que más se fija:**\n\n' + '\n'.join(f'- {t - LH} h' for t in top))
        st.markdown(f"**Cobertura del intervalo P10–P90:** {100 * metrics['mae']['Transformer (atención)']['cobertura_P10_P90']:.0f} % (ideal 80 %)")
        st.info('Se entrenó con 2022–2024, se validó con 2025 y se probó en 2026, clima real que nunca vio. '
                'La persistencia usa datos contrafactuales de ayer (ventaja para el baseline).')

# ---------------------------------------------------------------- escenarios
with t4:
    cA, cB = st.columns(2)
    with cA:
        dT = st.select_slider('Calentamiento adicional (+°C)', options=[0.0, 1.5, 3.0], value=1.5)
        rows = []
        for c in CITIES:
            r = evaluate(city_data(c, dT), lam=lam, margin=margin)
            rows.append(dict(ciudad=c, agua_status_quo_ML=r.iloc[0].agua_l / 1e6, ahorro=r[r.politica == IA].iloc[0]['agua_ahorrada_%']))
        sc_df = pd.DataFrame(rows)
        base0 = res[res.politica == BASE].set_index('ciudad').agua_l / 1e6
        sc_df['agua_extra_%'] = 100 * (sc_df.set_index('ciudad').agua_status_quo_ML / base0 - 1).values
        fig = px.bar(sc_df, x='ciudad', y='agua_extra_%', template='plotly_dark', color='ahorro', color_continuous_scale='Tealgrn',
                     title=f'+{dT} °C: agua extra del status quo (barra) y % que la IA recupera (color)', labels={'agua_extra_%': 'agua extra %', 'ahorro': 'ahorro IA %'})
        st.plotly_chart(fig, width='stretch')
        st.caption('El modelo trabaja fuera de lo visto: es una prueba de estrés, no una predicción climática.')
    with cB:
        lr = []
        for l in (0, .5, 1, 2, 3, 4, 6, 8):
            t_ = pd.concat([evaluate(P_, lam=l, margin=margin) for P_ in Ps.values()]).groupby('politica')[['agua_l', 'energia_kwh']].sum()
            lr.append(dict(lam=l, agua=100 * (1 - t_.loc[IA, 'agua_l'] / t_.loc[BASE, 'agua_l']), energia=100 * (t_.loc[IA, 'energia_kwh'] / t_.loc[BASE, 'energia_kwh'] - 1)))
        lr = pd.DataFrame(lr)
        fig = go.Figure(go.Scatter(x=lr.energia, y=lr.agua, mode='lines+markers+text', text=[f'λ={l}' for l in lr.lam], textposition='top center', line_color='#7fd18b'))
        fig.update_layout(template='plotly_dark', title='Curva agua–energía: cuánto cuesta cada ahorro',
                          xaxis_title='energía extra (%)', yaxis_title='agua ahorrada (%)')
        st.plotly_chart(fig, width='stretch')
    pf = pareto(list(Ps.values()), margins=np.arange(-1.0, 4.01, 0.5), lam=lam, q=1)
    lines = pf[~pf.politica.isin([BASE, POLICIES[4]])]
    fig = px.line(lines, x='horas_riesgo_evitable', y='agua_ahorrada_%', color='politica', markers=True, hover_data=['margen_c'], template='plotly_dark',
                  color_discrete_sequence=['#ffb347', '#2ca3dc', '#8f9aa8'], title='Ahorro vs. seguridad a igual margen (más arriba y a la izquierda = mejor)')
    st.plotly_chart(fig, width='stretch')

# ---------------------------------------------------------------- límites
with t5:
    st.markdown(f"""
1. **Todo lo operativo es simulado**: el modelo aprende mi simulador, no un centro de datos real. Lo real es el clima.
2. **Contrafactuales**: aquí se conoce qué habría pasado en el otro modo; en la realidad no.
3. **Calibración con humedad supuesta** (RH = 50 %): el kit no trae humedad.
4. **Una sola torre híbrida y límite fijo de {INLET_MAX:.0f} °C**; Mérida y Monterrey necesitan enfriamiento líquido, que no se modela.
5. **El pronóstico del clima usa ruido sintético** sobre clima real, no un pronóstico meteorológico real.
6. **Agua directa in situ**; el agua indirecta entra solo por λ (supuesto editable).
7. **Ventaja modesta frente a una regla simple**: a igual ahorro de agua, menos horas inseguras evitables con mayor estabilidad térmica.

**Mediríamos antes de recomendar cambios reales:** humedad/bulbo húmedo en sitio, caudal y ciclos de concentración de la torre, intensidad hídrica de la electricidad local.
""")

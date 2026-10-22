"""AguaSegura AI — panel local (Streamlit). DATOS SIMULADOS del kit CIFOX."""
import pandas as pd
import streamlit as st
import altair as alt
from aguasegura.core import (load_data, fit, ratios, forecast_report, detect, compare_detectors,
                             scenario, COOLING)

st.set_page_config(page_title='AguaSegura AI', layout='wide')
st.error('⚠️ DATOS TOTALMENTE SIMULADOS (kit CIFOX, 7 días, 3 sitios ficticios). '
         'Nada de esto es una medición ni una recomendación para una instalación real.')
st.title('AguaSegura AI — menos agua para enfriar servidores')


@st.cache_data
def get():
    df = load_data()
    return df, fit(df)


df, models = get()
tab1, tab2, tab3, tab4, tab5 = st.tabs(['1 · Baseline', '2 · Pronóstico de agua', '3 · Fugas y anomalías',
                                       '4 · Simulador de enfriamiento', '5 · Límites'])

with tab1:
    st.caption('PUE = Σ energía total / Σ energía IT. WUE = Σ agua / Σ energía IT (agua captada in situ, '
               'no consumo neto ni agua indirecta). Cociente de sumas, no media de ratios.')
    rows = []
    for s, g in df.groupby('site_id'):
        r = ratios(g)
        rows.append({'sitio': s, 'enfriamiento': COOLING[s], 'PUE': r['pue'], 'WUE (L/kWh IT)': r['wue_l_kwh'],
                     'Agua total (L)': g.water_l.sum(), 'Energía total (kWh)': g.energy_total_kwh.sum()})
    st.dataframe(pd.DataFrame(rows).round(3), hide_index=True, width='stretch')
    st.info('Un WUE o PUE menor no garantiza menor impacto absoluto: mira siempre litros y kWh totales.')

with tab2:
    site = st.selectbox('Sitio', list(COOLING), format_func=lambda s: f'{s} · {COOLING[s]}')
    m = models[site]
    g = df[(df.site_id == site) & (df.split == 'evaluacion')].copy()
    g['esperado'] = m.predict(g)
    g['bajo'], g['alto'] = g.esperado - 1.96 * m.sigma_w, g.esperado + 1.96 * m.sigma_w
    g['t'] = pd.to_datetime(g.timestamp)
    base = alt.Chart(g).encode(x=alt.X('t:T', title='hora (UTC)'))
    band = base.mark_area(opacity=.25).encode(y='bajo:Q', y2='alto:Q')
    st.altair_chart(band + base.mark_line(color='#1f77b4').encode(y=alt.Y('esperado:Q', title='agua (L/h)'))
                    + base.mark_point(color='#d62728', size=25).encode(y='water_l:Q'), width='stretch')
    st.caption('Línea azul: agua esperada (modelo ajustado solo con `referencia`). Banda: intervalo 95 %. '
               'Puntos rojos: agua observada en `evaluacion`. Puntos fuera de la banda = revisar.')
    fr = forecast_report(df, models)
    st.dataframe(fr.round(3), hide_index=True, width='stretch')
    st.latex(r'agua_{L/h} = a + b\cdot E_{IT} + c\cdot T_{ext}')
    st.write(f'Coeficientes {site}: a={m.water[0]:.2f}, b={m.water[1]:.3f} L/kWh IT, c={m.water[2]:.3f} L/°C · σ={m.sigma_w:.2f} L')

with tab3:
    z = st.slider('Umbral de alerta (σ sobre lo esperado)', 3.0, 6.0, 4.0, .5)
    ev = df[df.split == 'evaluacion']
    use_ot = st.checkbox('Incluir evento OT simulado como señal', True)
    det = detect(ev, models, z=z, use_ot=use_ot)
    st.metric('Alertas en evaluación', int(det.alerta_modelo.sum()))
    st.dataframe(det[det.alerta_modelo][['timestamp', 'site_id', 'water_l', 'z_agua', 'z_energia', 'motivo']].round(2),
                 hide_index=True, width='stretch')
    st.warning('Toda alerta requiere revisión humana: un evento sintético no prueba un ataque ni una fuga real.')
    st.subheader('Comparación (partición evaluación, 288 horas)')
    comp = pd.DataFrame(compare_detectors(df, models)).T
    st.dataframe(comp.round(3), width='stretch')
    st.caption('Las reglas del kit ven el evento OT y fueron construidas para detectar estas anomalías, por eso son perfectas. '
               'La comparación justa es Isolation Forest vs. modelo residual SIN OT (mismas variables físicas).')

with tab4:
    c1, c2, c3, c4 = st.columns(4)
    a = c1.selectbox('Enfriamiento actual', list(COOLING.values()), index=1)
    b = c2.selectbox('Enfriamiento propuesto', list(COOLING.values()), index=0)
    dt = c3.slider('Calentamiento (+°C)', 0.0, 4.0, 0.0, .5)
    ewif = c4.slider('Agua indirecta de la red (L/kWh)', 0.0, 5.0, 0.0, .1,
                     help='SUPUESTO tuyo, no medido. 0 = solo agua directa in situ.')
    if a == b:
        st.info('Elige dos tipos distintos.')
    else:
        r = scenario(df, models, a, b, dt, ewif)
        k1, k2, k3 = st.columns(3)
        k1.metric('Agua (L, 7 días)', f"{r['propuesto']['agua_total_l']:,.0f}", f"{r['delta']['agua_total_l']:,.0f}", delta_color='inverse')
        k2.metric('Energía total (kWh)', f"{r['propuesto']['energia_total_kwh']:,.0f}", f"{r['delta']['energia_total_kwh']:,.0f}", delta_color='inverse')
        lo, hi = r['delta']['agua_total_l_ic95']
        k3.metric('Cambio de agua IC 95 %', f'{lo:,.0f} a {hi:,.0f} L')
        st.dataframe(pd.DataFrame({'actual': r['actual'], 'propuesto': r['propuesto']}).round(0), width='stretch')
        st.caption('Misma carga IT y misma temperatura para ambos. El intervalo solo refleja la incertidumbre de los '
                   'coeficientes (bootstrap sobre `referencia`), no el error de los supuestos.')
        if r['extrapola']:
            st.warning(f"Temperatura máxima {r['t_max']:.1f} °C fuera del rango observado: extrapolación lineal, tómala con cautela.")
    st.error('Cada tipo de enfriamiento existe en UN solo sitio ficticio: el efecto del enfriamiento está confundido con el sitio. '
             'No es causalidad.')

with tab5:
    st.markdown("""
**Tres límites**
1. Datos 100 % sintéticos y solo 7 días de octubre: sin estacionalidad ni olas de calor reales.
2. El modelo aprende las fórmulas del generador, no física real; no hay humedad ni bulbo húmedo, ciclos de concentración ni caudal de torre.
3. Un sitio por tipo de enfriamiento: no se separa enfriamiento de sitio. El agua es captación in situ, no consumo neto ni agua indirecta.

**Qué mediríamos antes de recomendar cambios reales**
- Humedad relativa / temperatura de bulbo húmedo horaria.
- Caudal, ciclos de concentración y purga de la torre de enfriamiento.
- Intensidad hídrica de la electricidad local (agua indirecta).

**No hacemos:** litros por consulta de IA, control de equipos reales ni afirmaciones de ahorro real.
""")

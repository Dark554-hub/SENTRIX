import unittest
import pandas as pd
from aguasegura.core import load_data, fit, ratios, detect, scenario, compare_detectors, forecast_report


class CoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.df = load_data()
        cls.models = fit(cls.df)

    def test_ratio_is_ratio_of_sums_not_mean_of_ratios(self):
        d = pd.DataFrame({'energy_it_kwh': [1.0, 100.0], 'energy_total_kwh': [2.0, 110.0], 'water_l': [1.0, 100.0]})
        self.assertAlmostEqual(ratios(d)['pue'], 112 / 101)
        self.assertNotAlmostEqual(ratios(d)['pue'], (2 / 1 + 110 / 100) / 2)

    def test_empty_ratio_is_none(self):
        self.assertIsNone(ratios(self.df.iloc[0:0])['pue'])

    def test_fit_uses_only_referencia(self):
        ref_rows = (self.df.split == 'referencia').groupby(self.df.site_id).sum()
        for s, m in self.models.items():
            self.assertEqual(m.n, ref_rows[s])

    def test_forecast_error_small_without_anomalies(self):
        fr = forecast_report(self.df, self.models)
        self.assertTrue((fr[fr.horas == 'sin anomalías']['MAE_%'] < 3).all())

    def test_detector_has_no_false_positives_and_beats_isolation_forest(self):
        c = compare_detectors(self.df, self.models)
        ours, iso = c['Modelo residual AguaSegura (sin OT)'], c['Isolation Forest del kit (sin OT)']
        self.assertEqual(ours['fp'], 0)
        self.assertGreater(ours['recall'], iso['recall'])
        self.assertGreater(ours['precision'], iso['precision'])

    def test_no_alerts_in_reference(self):
        ref = self.df[self.df.split == 'referencia']
        self.assertEqual(int(detect(ref, self.models, use_ot=False).alerta_modelo.sum()), 0)

    def test_evaporative_to_air_saves_water_costs_energy(self):
        r = scenario(self.df, self.models, 'evaporativa', 'aire', boot=False)
        self.assertLess(r['delta']['agua_total_l'], 0)
        self.assertGreater(r['delta']['energia_total_kwh'], 0)

    def test_indirect_water_can_reverse_ranking(self):
        low = scenario(self.df, self.models, 'evaporativa', 'aire', ewif=0, boot=False)['delta']['agua_total_l']
        high = scenario(self.df, self.models, 'evaporativa', 'aire', ewif=10, boot=False)['delta']['agua_total_l']
        self.assertGreater(high, low)


if __name__ == '__main__':
    unittest.main()

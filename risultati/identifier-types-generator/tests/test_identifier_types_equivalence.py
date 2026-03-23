import importlib.util
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
CURRENT_SCRIPT = ROOT / "scripts" / "genera-vocabolario-identifier-types.py"
BASELINE_SCRIPT = ROOT / "baseline" / "genera-vocabolario-identifier-types.baseline.py"


def _load_module(path: pathlib.Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


CURRENT = _load_module(CURRENT_SCRIPT, "current_gen")
BASELINE = _load_module(BASELINE_SCRIPT, "baseline_gen")


class IdentifierTypesEquivalenceTest(unittest.TestCase):
    @staticmethod
    def _make_large_dataset(n=3000):
        core = []
        names = []
        temporal = []
        situated = []
        broader_trans = []
        higher_rank = []
        belfiore = []
        provinces = {"015": {"notation": "015", "name": "Milano", "sigla": "MI", "metro": "215"}}

        for i in range(n):
            code = f"{150000 + i:06d}"
            city_uri = f"https://w3id.org/italia/controlled-vocabulary/territorial-classifications/cities/{code}"
            interval_uri = f"https://w3id.org/italia/data/time-intervals/{1861+i%100:04d}-01-01-9999-12-31"
            prov_uri = "https://w3id.org/italia/controlled-vocabulary/territorial-classifications/provinces/015"
            reg_uri = "https://w3id.org/italia/controlled-vocabulary/territorial-classifications/regions/03"
            geod_uri = "https://w3id.org/italia/controlled-vocabulary/territorial-classifications/geographical-distribution/1"

            core.append(
                {
                    "city": city_uri,
                    "notation": code,
                    "geoDist": geod_uri,
                    "directHigher": prov_uri,
                    "broader": prov_uri,
                    "inScheme": "https://w3id.org/italia/controlled-vocabulary/territorial-classifications/cities",
                    "sameAs": f"http://dati.isprambiente.it/id/place/{code}",
                }
            )
            names.append({"city": city_uri, "name": f"Comune {code}", "nameLang": "it"})
            names.append({"city": city_uri, "name": f"City {code}", "nameLang": "en"})
            temporal.append(
                {"city": city_uri, "interval": interval_uri, "startTime": "1861-01-01", "endTime": "9999-12-31"}
            )
            situated.extend([{"city": city_uri, "within": prov_uri}, {"city": city_uri, "within": reg_uri}])
            broader_trans.extend([{"city": city_uri, "broader": prov_uri}, {"city": city_uri, "broader": reg_uri}])
            higher_rank.extend([{"city": city_uri, "higher": prov_uri}, {"city": city_uri, "higher": reg_uri}])
            belfiore.append({"notation": code, "belfiore": f"X{i%10000:04d}"})

        return core, names, temporal, situated, broader_trans, higher_rank, belfiore, provinces

    def test_generate_vocabulary_ttl_is_identical(self):
        live_counts = {
            "Codice ISTAT numerico": "14206",
            "Codice ISTAT alfanumerico": "14206",
            "Codice Catastale": "10356",
            "Sigla Automobilistica": "107",
        }
        out_baseline = BASELINE.generate_vocabulary_ttl(live_counts)
        out_current = CURRENT.generate_vocabulary_ttl(live_counts)
        self.assertEqual(out_baseline, out_current)

    def test_generate_municipalities_ttl_is_identical(self):
        core = [
            {
                "city": "https://w3id.org/italia/controlled-vocabulary/territorial-classifications/cities/015146",
                "notation": "015146",
                "geoDist": "https://w3id.org/italia/controlled-vocabulary/territorial-classifications/geographical-distribution/1",
                "directHigher": "https://w3id.org/italia/controlled-vocabulary/territorial-classifications/provinces/015",
                "broader": "https://w3id.org/italia/controlled-vocabulary/territorial-classifications/provinces/015",
                "inScheme": "https://w3id.org/italia/controlled-vocabulary/territorial-classifications/cities",
                "sameAs": "http://dati.isprambiente.it/id/place/015146",
            }
        ]
        names = [
            {
                "city": "https://w3id.org/italia/controlled-vocabulary/territorial-classifications/cities/015146",
                "name": "Milano",
                "nameLang": "it",
            },
            {
                "city": "https://w3id.org/italia/controlled-vocabulary/territorial-classifications/cities/015146",
                "name": "Milan",
                "nameLang": "en",
            },
        ]
        temporal = [
            {
                "city": "https://w3id.org/italia/controlled-vocabulary/territorial-classifications/cities/015146",
                "interval": "https://w3id.org/italia/data/time-intervals/1861-03-17-9999-12-31",
                "startTime": "1861-03-17",
                "endTime": "9999-12-31",
            }
        ]
        situated = [
            {
                "city": "https://w3id.org/italia/controlled-vocabulary/territorial-classifications/cities/015146",
                "within": "https://w3id.org/italia/controlled-vocabulary/territorial-classifications/provinces/015",
            },
            {
                "city": "https://w3id.org/italia/controlled-vocabulary/territorial-classifications/cities/015146",
                "within": "https://w3id.org/italia/controlled-vocabulary/territorial-classifications/regions/03",
            },
        ]
        broader_trans = [
            {
                "city": "https://w3id.org/italia/controlled-vocabulary/territorial-classifications/cities/015146",
                "broader": "https://w3id.org/italia/controlled-vocabulary/territorial-classifications/provinces/015",
            },
            {
                "city": "https://w3id.org/italia/controlled-vocabulary/territorial-classifications/cities/015146",
                "broader": "https://w3id.org/italia/controlled-vocabulary/territorial-classifications/regions/03",
            },
        ]
        higher_rank = [
            {
                "city": "https://w3id.org/italia/controlled-vocabulary/territorial-classifications/cities/015146",
                "higher": "https://w3id.org/italia/controlled-vocabulary/territorial-classifications/provinces/015",
            },
            {
                "city": "https://w3id.org/italia/controlled-vocabulary/territorial-classifications/cities/015146",
                "higher": "https://w3id.org/italia/controlled-vocabulary/territorial-classifications/regions/03",
            },
        ]
        belfiore = [{"notation": "015146", "belfiore": "F205"}]
        provinces = {
            "015": {"notation": "015", "name": "Milano", "sigla": "MI", "metro": "215"}
        }

        cities_baseline = BASELINE.build_city_data(
            core, names, temporal, situated, broader_trans, higher_rank, belfiore
        )
        cities_current = CURRENT.build_city_data(
            core, names, temporal, situated, broader_trans, higher_rank, belfiore
        )
        out_baseline = BASELINE.generate_municipalities_ttl(cities_baseline, provinces, scheme_metadata=None)
        out_current = CURRENT.generate_municipalities_ttl(cities_current, provinces, scheme_metadata=None)

        self.assertEqual(out_baseline, out_current)

    def test_large_dataset_municipalities_ttl_is_identical(self):
        core, names, temporal, situated, broader_trans, higher_rank, belfiore, provinces = self._make_large_dataset()
        cities_baseline = BASELINE.build_city_data(
            core, names, temporal, situated, broader_trans, higher_rank, belfiore
        )
        cities_current = CURRENT.build_city_data(
            core, names, temporal, situated, broader_trans, higher_rank, belfiore
        )
        out_baseline = BASELINE.generate_municipalities_ttl(cities_baseline, provinces, scheme_metadata=None)
        out_current = CURRENT.generate_municipalities_ttl(cities_current, provinces, scheme_metadata=None)
        self.assertEqual(out_baseline, out_current)

    def test_compact_province_inscheme_mode(self):
        core, names, temporal, situated, broader_trans, higher_rank, belfiore, provinces = self._make_large_dataset(10)
        cities_current = CURRENT.build_city_data(
            core, names, temporal, situated, broader_trans, higher_rank, belfiore
        )
        out_compact = CURRENT.generate_municipalities_ttl(
            cities_current, provinces, scheme_metadata=None, compact_province_inscheme=True
        )
        self.assertIn("owl:hasValue <https://w3id.org/italia/controlled-vocabulary/territorial-classifications/provinces>", out_compact)
        self.assertNotIn("provinces:015\n    a clv:Province , skos:Concept ;\n    skos:inScheme <", out_compact)


if __name__ == "__main__":
    unittest.main()

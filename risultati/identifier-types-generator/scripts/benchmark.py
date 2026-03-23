#!/usr/bin/env python3
"""
Benchmark sintetico baseline vs versione ottimizzata.

Misura il tempo di:
1) build_city_data
2) generate_municipalities_ttl
"""

import argparse
import importlib.util
import pathlib
import time


HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
BASELINE_SCRIPT = ROOT / "baseline" / "genera-vocabolario-identifier-types.baseline.py"
CURRENT_SCRIPT = HERE / "genera-vocabolario-identifier-types.py"


def load_module(path: pathlib.Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def make_dataset(n: int):
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


def run_once(module, n: int):
    data = make_dataset(n)
    t0 = time.perf_counter()
    cities = module.build_city_data(*data[:-1])
    t1 = time.perf_counter()
    ttl = module.generate_municipalities_ttl(cities, data[-1], scheme_metadata=None)
    t2 = time.perf_counter()
    return {
        "build_city_data_s": t1 - t0,
        "generate_ttl_s": t2 - t1,
        "total_s": t2 - t0,
        "ttl_size_mb": len(ttl.encode("utf-8")) / (1024 * 1024),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cities", type=int, default=12000, help="Numero di city sintetiche")
    args = parser.parse_args()

    baseline = load_module(BASELINE_SCRIPT, "baseline_gen")
    current = load_module(CURRENT_SCRIPT, "current_gen")

    b = run_once(baseline, args.cities)
    c = run_once(current, args.cities)

    print(f"Dataset sintetico: {args.cities} city")
    print("")
    print("Baseline:")
    print(f"  build_city_data: {b['build_city_data_s']:.3f}s")
    print(f"  generate_ttl:    {b['generate_ttl_s']:.3f}s")
    print(f"  total:           {b['total_s']:.3f}s")
    print("")
    print("Ottimizzato:")
    print(f"  build_city_data: {c['build_city_data_s']:.3f}s")
    print(f"  generate_ttl:    {c['generate_ttl_s']:.3f}s")
    print(f"  total:           {c['total_s']:.3f}s")
    print("")
    if c["total_s"] > 0:
        speedup = b["total_s"] / c["total_s"]
        print(f"Speedup totale: {speedup:.2f}x")
    print(f"Dimensione TTL generato: {c['ttl_size_mb']:.2f} MB")


if __name__ == "__main__":
    main()

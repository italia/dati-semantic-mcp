#!/usr/bin/env python3
"""
Genera i file TTL per le ontologie modificate e il vocabolario controllato
dei comuni con proprieta' dirette, interrogando il SPARQL endpoint di schema.gov.it.

Produce:
  - ontopia-patch-clv-direct-identifiers.ttl  (estensioni ontologia CLV)
  - vocabolario-identifier-types.ttl           (vocabolario SKOS tipi identificativi)
  - vocabolario-comuni-diretto.ttl             (comuni con proprieta' dirette)
  - migrazione-identifier-diretti.sparql       (query SPARQL di migrazione)

Uso:
  python genera-vocabolario-identifier-types.py [--endpoint URL] [--dry-run]
"""

import argparse
import json
import os
import re
import sys
import textwrap
import time
from collections import defaultdict
from functools import lru_cache
from urllib.request import Request, urlopen
from urllib.error import URLError
from urllib.parse import urlencode

DEFAULT_ENDPOINT = "https://schema.gov.it/sparql"

# URI base
CLV = "https://w3id.org/italia/onto/CLV/"
L0 = "https://w3id.org/italia/onto/l0/"
TI = "https://w3id.org/italia/onto/TI/"
SKOS = "http://www.w3.org/2004/02/skos/core#"
CITIES_BASE = "https://w3id.org/italia/controlled-vocabulary/territorial-classifications/cities"
PROVINCES_BASE = "https://w3id.org/italia/controlled-vocabulary/territorial-classifications/provinces"
REGIONS_BASE = "https://w3id.org/italia/controlled-vocabulary/territorial-classifications/regions"
GEODIST_BASE = "https://w3id.org/italia/controlled-vocabulary/territorial-classifications/geographical-distribution"
INTERVALS_BASE = "https://w3id.org/italia/data/time-intervals"
TERR_CLASS_BASE = "https://w3id.org/italia/controlled-vocabulary/territorial-classifications"
ISPRA_PLACES = "http://dati.isprambiente.it/id/place"
VOCAB_BASE = "https://w3id.org/italia/controlled-vocabulary/territorial-classifications/identifier-types"

# Mappatura stringhe attuali -> concetti del vocabolario controllato.
IDENTIFIER_TYPES = {
    "Codice ISTAT alfanumerico": {
        "id": "istat-alphanumeric",
        "notation": "ISTAT-ALPHA",
        "prefLabel_it": "Codice ISTAT alfanumerico",
        "prefLabel_en": "ISTAT alphanumeric code",
        "definition_it": "Codice ISTAT con zeri iniziali. Per i comuni ha 6 cifre (es. 015146 = Milano), per le province 3 (es. 015), per le regioni 2 (es. 03).",
        "definition_en": "ISTAT code with leading zeros. 6 digits for municipalities (e.g. 015146 = Milano), 3 for provinces, 2 for regions.",
        "note": "Gia' disponibile come skos:notation su tutte le entita' territoriali. Non richiede proprieta' aggiuntiva.",
        "direct_property": "skos:notation",
        "domain": "AdminUnitComponent",
    },
    "Codice ISTAT numerico": {
        "id": "istat-numeric",
        "notation": "ISTAT-NUM",
        "prefLabel_it": "Codice ISTAT numerico",
        "prefLabel_en": "ISTAT numeric code",
        "definition_it": "Codice ISTAT senza zeri iniziali (es. 15146 = Milano). Derivabile dal codice alfanumerico.",
        "definition_en": "ISTAT code without leading zeros (e.g. 15146 = Milano). Derivable from alphanumeric code.",
        "note": "RIDONDANTE. Derivabile con xsd:integer(skos:notation). Si raccomanda di eliminare queste risorse Identifier.",
        "direct_property": None,
        "domain": "AdminUnitComponent",
    },
    "Codice Catastale": {
        "id": "belfiore",
        "notation": "BELFIORE",
        "prefLabel_it": "Codice Belfiore",
        "prefLabel_en": "Belfiore code",
        "altLabel_it": ["Codice Catastale"],
        "altLabel_en": ["Cadastral code"],
        "definition_it": "Codice a 4 caratteri alfanumerici assegnato dall'Agenzia delle Entrate a ogni comune italiano. Usato nel calcolo del codice fiscale. Es. F205 = Milano, H501 = Roma.",
        "definition_en": "4-character alphanumeric code assigned by the Italian Revenue Agency to each municipality. Used in fiscal code calculation. E.g. F205 = Milano, H501 = Roma.",
        "direct_property": "clv:codiceBelfiore",
        "domain": "City",
    },
    "Codice Provincia Alfanumerico": {
        "id": "province-code",
        "notation": "PROV",
        "prefLabel_it": "Codice Provincia",
        "prefLabel_en": "Province code",
        "definition_it": "Codice numerico a 3 cifre della provincia (es. 015 = Milano).",
        "definition_en": "3-digit numeric province code (e.g. 015 = Milano).",
        "note": "Gia' disponibile come skos:notation sulla Province.",
        "direct_property": "skos:notation",
        "domain": "Province",
    },
    "Sigla Automobilistica": {
        "id": "car-plate",
        "notation": "PLATE",
        "prefLabel_it": "Sigla Automobilistica",
        "prefLabel_en": "Car plate code",
        "definition_it": "Sigla a 2 lettere della provincia usata nelle targhe (es. MI = Milano).",
        "definition_en": "2-letter province code used on license plates (e.g. MI = Milano).",
        "direct_property": "clv:siglaAutomobilistica",
        "domain": "Province",
    },
    "Codice Regione": {
        "id": "region-code",
        "notation": "REG",
        "prefLabel_it": "Codice Regione",
        "prefLabel_en": "Region code",
        "definition_it": "Codice numerico a 2 cifre della regione (es. 03 = Lombardia).",
        "definition_en": "2-digit numeric region code (e.g. 03 = Lombardia).",
        "note": "Gia' disponibile come skos:notation sulla Region.",
        "direct_property": "skos:notation",
        "domain": "Region",
    },
    "Codice Città Metropolitana": {
        "id": "metropolitan-city",
        "notation": "METRO",
        "prefLabel_it": "Codice Citta' Metropolitana",
        "prefLabel_en": "Metropolitan city code",
        "definition_it": "Codice numerico a 3 cifre per le 14 citta' metropolitane (es. 215 = Milano).",
        "definition_en": "3-digit code for the 14 metropolitan cities (e.g. 215 = Milano).",
        "direct_property": "clv:codiceCittaMetropolitana",
        "domain": "Province",
    },
    "Identificativo della ripartizione geografica": {
        "id": "geo-distribution",
        "notation": "GEODIST",
        "prefLabel_it": "Codice Ripartizione Geografica",
        "prefLabel_en": "Geographical distribution code",
        "definition_it": "Codice numerico della ripartizione geografica (1=Nord-ovest, 2=Nord-est, 3=Centro, 4=Sud, 5=Isole).",
        "definition_en": "Numeric code for geographical distribution (1=North-west, 2=North-east, 3=Centre, 4=South, 5=Islands).",
        "note": "Gia' disponibile come skos:notation sulla GeographicalDistribution.",
        "direct_property": "skos:notation",
        "domain": "GeographicalDistribution",
    },
    "ISO 3166-1 alpha-2": {
        "id": "iso-3166-1-alpha-2",
        "notation": "ISO2",
        "prefLabel_it": "Codice ISO 3166-1 alpha-2",
        "prefLabel_en": "ISO 3166-1 alpha-2 code",
        "definition_it": "Codice a 2 lettere dello standard ISO 3166-1 (es. IT = Italia).",
        "definition_en": "2-letter ISO 3166-1 code (e.g. IT = Italy).",
        "direct_property": "clv:isoAlpha2",
        "domain": "Country",
    },
    "ISO 3166-1 alpha-3": {
        "id": "iso-3166-1-alpha-3",
        "notation": "ISO3",
        "prefLabel_it": "Codice ISO 3166-1 alpha-3",
        "prefLabel_en": "ISO 3166-1 alpha-3 code",
        "definition_it": "Codice a 3 lettere dello standard ISO 3166-1 (es. ITA = Italia).",
        "definition_en": "3-letter ISO 3166-1 code (e.g. ITA = Italy).",
        "direct_property": "clv:isoAlpha3",
        "domain": "Country",
    },
}


# ─── SPARQL helpers ──────────────────────────────────────────────────────────

def sparql_query(endpoint, query, timeout=60):
    """Esegue una query SPARQL e restituisce i risultati come lista di dict."""
    params = urlencode({"query": query, "format": "application/sparql-results+json"})
    url = f"{endpoint}?{params}"
    req = Request(url, headers={"Accept": "application/sparql-results+json"})
    try:
        with urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read())
            bindings = data["results"]["bindings"]
            return [
                {k: v["value"] for k, v in row.items()}
                for row in bindings
            ]
    except URLError as e:
        print(f"  ERRORE SPARQL: {e}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"  ERRORE: {e}", file=sys.stderr)
        return None


def sparql_query_full(endpoint, query, timeout=60):
    """Come sparql_query ma restituisce i binding SPARQL completi con type/lang/datatype."""
    params = urlencode({"query": query, "format": "application/sparql-results+json"})
    url = f"{endpoint}?{params}"
    req = Request(url, headers={"Accept": "application/sparql-results+json"})
    try:
        with urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read())
            return data["results"]["bindings"]
    except (URLError, Exception) as e:
        print(f"  ERRORE SPARQL: {e}", file=sys.stderr)
        return None


def sparql_query_paged(endpoint, query_template, page_size=2000, timeout=60,
                       cursor_column=None, cursor_is_uri=False):
    """Esegue una query SPARQL con paginazione.

    Se cursor_column e' specificato, usa paginazione keyset per aggirare il
    limite di ~10.000 righe (ResultSetMaxRows) di Virtuoso.
    La query_template deve contenere il placeholder {CURSOR} dove inserire
    il FILTER di paginazione.
    Se cursor_is_uri=True, usa FILTER(STR(?col) > "val") per colonne URI.
    Altrimenti usa LIMIT/OFFSET classico.
    """
    all_results = []
    offset = 0
    cursor_value = None
    while True:
        if cursor_column:
            if cursor_value is not None:
                col = f"STR(?{cursor_column})" if cursor_is_uri else f"?{cursor_column}"
                cursor_filter = f'FILTER({col} > "{cursor_value}")'
            else:
                cursor_filter = ""
            query = query_template.replace("{CURSOR}", cursor_filter)
            query += f"\nLIMIT {page_size}"
        else:
            query = query_template + f"\nLIMIT {page_size} OFFSET {offset}"

        results = sparql_query(endpoint, query, timeout=timeout)
        if results is None:
            if not all_results:
                return None  # errore alla prima pagina
            break  # errore dopo almeno una pagina: ritorna quel che si ha
        all_results.extend(results)
        if len(results) < page_size:
            break  # ultima pagina

        if cursor_column:
            cursor_value = results[-1].get(cursor_column)
            if cursor_value is None:
                break
        else:
            offset += page_size

        print(f"    ... {len(all_results)} righe recuperate", file=sys.stderr)
    return all_results


# ─── Data fetching ───────────────────────────────────────────────────────────

def fetch_current_types(endpoint):
    """Recupera i tipi di identificativo attualmente nel triplestore con conteggi."""
    query = f"""
    SELECT ?type (COUNT(*) AS ?count)
    WHERE {{
      ?id a <{CLV}Identifier> ;
          <{CLV}identifierType> ?type .
    }}
    GROUP BY ?type
    ORDER BY DESC(?count)
    """
    return sparql_query(endpoint, query)


def fetch_belfiore_codes(endpoint):
    """Recupera la mappatura (codice ISTAT -> codice Belfiore) per tutti i comuni.

    Usa BIND+REPLACE per estrarre il Belfiore dall'URI dell'identificativo,
    aggirando i limiti di Virtuoso sui join con identifierType.
    Usa paginazione keyset su ?notation per aggirare il limite di 10k righe.
    """
    query = f"""
    SELECT DISTINCT ?notation ?belfiore WHERE {{
      ?city <{SKOS}notation> ?notation ;
            <{CLV}hasIdentifier> ?id .
      BIND(REPLACE(STR(?id), ".*cadastral-code/", "") AS ?belfiore)
      FILTER(CONTAINS(STR(?id), "cadastral-code/"))
      {{CURSOR}}
    }}
    ORDER BY ?notation
    """
    return sparql_query_paged(endpoint, query, page_size=2000, cursor_column="notation")


def fetch_city_core(endpoint):
    """Recupera proprieta' scalari 1:1 per tutte le city (incluse versioni storiche)."""
    query = f"""
    SELECT ?city ?notation ?geoDist ?directHigher ?broader ?inScheme ?sameAs WHERE {{
      ?city a <{CLV}City> ;
            <{SKOS}notation> ?notation .
      OPTIONAL {{ ?city <{CLV}hasGeographicalDistribution> ?geoDist }}
      OPTIONAL {{ ?city <{CLV}hasDirectHigherRank> ?directHigher }}
      OPTIONAL {{ ?city <{SKOS}broader> ?broader }}
      OPTIONAL {{ ?city <{SKOS}inScheme> ?inScheme }}
      OPTIONAL {{ ?city <http://www.w3.org/2002/07/owl#sameAs> ?sameAs }}
      {{CURSOR}}
    }}
    ORDER BY ?city
    """
    return sparql_query_paged(endpoint, query, page_size=5000,
                              cursor_column="city", cursor_is_uri=True)


def fetch_city_names_full(endpoint):
    """Recupera nomi con language tag per tutte le city."""
    query = f"""
    SELECT ?city ?name (LANG(?name) AS ?nameLang) WHERE {{
      ?city a <{CLV}City> ;
            <{L0}name> ?name .
      {{CURSOR}}
    }}
    ORDER BY ?city
    """
    return sparql_query_paged(endpoint, query, page_size=5000,
                              cursor_column="city", cursor_is_uri=True)


def fetch_city_temporal(endpoint):
    """Recupera validita' temporale (hasSOValidity -> TimeInterval)."""
    query = f"""
    SELECT ?city ?interval ?startTime ?endTime WHERE {{
      ?city a <{CLV}City> ;
            <{CLV}hasSOValidity> ?interval .
      OPTIONAL {{ ?interval <{TI}startTime> ?startTime }}
      OPTIONAL {{ ?interval <{TI}endTime> ?endTime }}
      {{CURSOR}}
    }}
    ORDER BY ?city
    """
    return sparql_query_paged(endpoint, query, page_size=5000,
                              cursor_column="city", cursor_is_uri=True)


def fetch_city_situated_within(endpoint):
    """Recupera clv:situatedWithin (multi-valore: provincia + regione)."""
    query = f"""
    SELECT ?city ?within WHERE {{
      ?city a <{CLV}City> ;
            <{CLV}situatedWithin> ?within .
      {{CURSOR}}
    }}
    ORDER BY ?city
    """
    return sparql_query_paged(endpoint, query, page_size=5000,
                              cursor_column="city", cursor_is_uri=True)


def fetch_city_broader_transitive(endpoint):
    """Recupera skos:broaderTransitive (multi-valore)."""
    query = f"""
    SELECT ?city ?broader WHERE {{
      ?city a <{CLV}City> ;
            <{SKOS}broaderTransitive> ?broader .
      {{CURSOR}}
    }}
    ORDER BY ?city
    """
    return sparql_query_paged(endpoint, query, page_size=5000,
                              cursor_column="city", cursor_is_uri=True)


def fetch_city_higher_rank(endpoint):
    """Recupera clv:hasHigherRank (multi-valore)."""
    query = f"""
    SELECT ?city ?higher WHERE {{
      ?city a <{CLV}City> ;
            <{CLV}hasHigherRank> ?higher .
      {{CURSOR}}
    }}
    ORDER BY ?city
    """
    return sparql_query_paged(endpoint, query, page_size=5000,
                              cursor_column="city", cursor_is_uri=True)


def fetch_concept_scheme_metadata(endpoint, scheme_uri):
    """Recupera i metadati del ConceptScheme dal triplestore (binding completi)."""
    query = f"""
    SELECT ?p ?o WHERE {{
      <{scheme_uri}> ?p ?o .
      FILTER(?p != <{SKOS}hasTopConcept>)
    }}
    """
    return sparql_query_full(endpoint, query)


def fetch_province_data(endpoint):
    """Recupera province con nomi, sigle automobilistiche e codici citta' metropolitana."""
    query_names = f"""
    SELECT DISTINCT ?notation ?name WHERE {{
      ?prov a <{CLV}Province> ;
            <{SKOS}notation> ?notation ;
            <{L0}name> ?name .
    }}
    ORDER BY ?notation
    """
    query_sigla = f"""
    SELECT DISTINCT ?notation ?sigla WHERE {{
      ?prov <{SKOS}notation> ?notation ;
            <{CLV}hasIdentifier> ?id .
      BIND(REPLACE(STR(?id), ".*vehicle-code/", "") AS ?sigla)
      FILTER(CONTAINS(STR(?id), "vehicle-code/"))
    }}
    ORDER BY ?notation
    """
    query_metro = f"""
    SELECT DISTINCT ?notation ?metro WHERE {{
      ?prov <{SKOS}notation> ?notation ;
            <{CLV}hasIdentifier> ?id .
      BIND(REPLACE(STR(?id), ".*metropolitan-city-code/", "") AS ?metro)
      FILTER(CONTAINS(STR(?id), "metropolitan-city-code/"))
    }}
    ORDER BY ?notation
    """
    names = sparql_query(endpoint, query_names)
    sigla = sparql_query(endpoint, query_sigla)
    metro = sparql_query(endpoint, query_metro)

    # Assembla i dati per provincia
    provinces = {}
    if names:
        for r in names:
            n = r["notation"]
            name = r["name"]
            if n not in provinces or len(name) > len(provinces[n].get("name", "")):
                provinces.setdefault(n, {})["name"] = name
                provinces[n]["notation"] = n

    if sigla:
        for r in sigla:
            provinces.setdefault(r["notation"], {})["sigla"] = r["sigla"]

    if metro:
        for r in metro:
            provinces.setdefault(r["notation"], {})["metro"] = r["metro"]

    return provinces


def build_city_data(core, names, temporal, situated, broader_trans, higher_rank, belfiore):
    """Assembla tutti i dati city in un dizionario per URI city."""
    cities = {}

    if core:
        for r in core:
            cities[r["city"]] = {
                "notation": r["notation"],
                "geoDist": r.get("geoDist"),
                "directHigher": r.get("directHigher"),
                "broader": r.get("broader"),
                "inScheme": r.get("inScheme"),
                "sameAs": r.get("sameAs"),
                "names": [],
                # Set interni per deduplicare in O(1). Convertiti a liste ordinate
                # prima della serializzazione TTL per mantenere output stabile.
                "_situatedWithinSet": set(),
                "_broaderTransitiveSet": set(),
                "_higherRankSet": set(),
            }

    if names:
        for r in names:
            c = cities.get(r["city"])
            if c:
                c["names"].append((r["name"], r.get("nameLang", "")))

    if temporal:
        for r in temporal:
            c = cities.get(r["city"])
            if c:
                c["interval"] = r.get("interval")
                c["startTime"] = r.get("startTime")
                c["endTime"] = r.get("endTime")

    if situated:
        for r in situated:
            c = cities.get(r["city"])
            if c:
                c["_situatedWithinSet"].add(r["within"])

    if broader_trans:
        for r in broader_trans:
            c = cities.get(r["city"])
            if c:
                c["_broaderTransitiveSet"].add(r["broader"])

    if higher_rank:
        for r in higher_rank:
            c = cities.get(r["city"])
            if c:
                c["_higherRankSet"].add(r["higher"])

    # Belfiore: mappato per notation (condiviso tra versioni storiche)
    belfiore_map = {}
    if belfiore:
        for r in belfiore:
            belfiore_map[r["notation"]] = r["belfiore"]
    for c in cities.values():
        c["belfiore"] = belfiore_map.get(c["notation"])
        c["situatedWithin"] = sorted(c.pop("_situatedWithinSet"))
        c["broaderTransitive"] = sorted(c.pop("_broaderTransitiveSet"))
        c["higherRank"] = sorted(c.pop("_higherRankSet"))

    return cities


# ─── TTL generators ──────────────────────────────────────────────────────────

def generate_clv_patch_ttl():
    """Genera il file TTL con le estensioni all'ontologia CLV."""
    return textwrap.dedent(f"""\
        @prefix owl:  <http://www.w3.org/2002/07/owl#> .
        @prefix rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
        @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
        @prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .
        @prefix clv:  <{CLV}> .
        @prefix l0:   <{L0}> .
        @prefix skos: <{SKOS}> .

        # =============================================================================
        # PATCH: Proprieta' dirette per identificativi territoriali in CLV
        #
        # Questo file contiene estensioni additive all'ontologia CLV che eliminano
        # la necessita' di risorse clv:Identifier intermedie per i codici noti.
        #
        # Generato da: genera-vocabolario-identifier-types.py
        #
        # Motivazione: 39.024 risorse Identifier per rappresentare ~5 tipi di codice
        # gia' noti e stabili. Il codice ISTAT e' gia' in skos:notation.
        #
        # Issue di riferimento: ontopia-issue-clv-identifier-type.md
        # =============================================================================

        # -----------------------------------------------------------------------------
        # 1. Codice Belfiore (ex "Codice Catastale") - per Comune
        #
        #    Codice a 4 caratteri alfanumerici assegnato dall'Agenzia delle Entrate.
        #    Usato nel calcolo del codice fiscale.
        #    Esempio: F205 = Milano, H501 = Roma, L736 = Venezia.
        #
        #    Precedente in OntoPiA: l'ontologia infortuni sul lavoro definisce
        #    codiceBelfioreCittadinanza come DatatypeProperty.
        #
        #    Si preferisce "Belfiore" a "Catastale" perche':
        #    - e' il nome ufficiale nell'anagrafe comuni dell'Agenzia delle Entrate
        #    - e' il termine usato nel contesto del codice fiscale
        #    - "catastale" e' ambiguo (potrebbe riferirsi a particelle/fogli)
        # -----------------------------------------------------------------------------

        clv:codiceBelfiore
            a owl:DatatypeProperty, owl:FunctionalProperty ;
            rdfs:domain clv:City ;
            rdfs:range xsd:string ;
            rdfs:label "codice Belfiore"@it ,
                       "Belfiore code"@en ;
            rdfs:comment
                "Codice a 4 caratteri alfanumerici (detto anche catastale) assegnato dall'Agenzia delle Entrate a ogni comune italiano. Usato nel calcolo del codice fiscale. Esempio: F205 = Milano."@it ,
                "4-character alphanumeric code (also known as cadastral code) assigned by the Italian Revenue Agency to each municipality. Used in fiscal code calculation. Example: F205 = Milano."@en ;
            rdfs:isDefinedBy clv: ;
            owl:versionInfo "proposta"@it , "proposed"@en .


        # -----------------------------------------------------------------------------
        # 2. Sigla automobilistica - per Provincia
        #
        #    Sigla a 2 lettere usata nelle targhe automobilistiche.
        #    Esempio: MI = Milano, RM = Roma, NA = Napoli.
        # -----------------------------------------------------------------------------

        clv:siglaAutomobilistica
            a owl:DatatypeProperty, owl:FunctionalProperty ;
            rdfs:domain clv:Province ;
            rdfs:range xsd:string ;
            rdfs:label "sigla automobilistica"@it ,
                       "car plate code"@en ;
            rdfs:comment
                "Sigla a 2 lettere della provincia usata nelle targhe automobilistiche. Esempio: MI = Milano."@it ,
                "2-letter province abbreviation used on car license plates. Example: MI = Milano."@en ;
            rdfs:isDefinedBy clv: ;
            owl:versionInfo "proposta"@it , "proposed"@en .


        # -----------------------------------------------------------------------------
        # 3. Codice citta' metropolitana - per Provincia (citta' metropolitane)
        #
        #    Codice numerico a 3 cifre assegnato alle 14 citta' metropolitane.
        #    Esempio: 215 = Milano (vs codice provincia 015).
        # -----------------------------------------------------------------------------

        clv:codiceCittaMetropolitana
            a owl:DatatypeProperty, owl:FunctionalProperty ;
            rdfs:domain clv:Province ;
            rdfs:range xsd:string ;
            rdfs:label "codice citta' metropolitana"@it ,
                       "metropolitan city code"@en ;
            rdfs:comment
                "Codice numerico a 3 cifre assegnato alle citta' metropolitane. Esempio: 215 = Citta' metropolitana di Milano."@it ,
                "3-digit numeric code assigned to metropolitan cities. Example: 215 = Metropolitan City of Milan."@en ;
            rdfs:isDefinedBy clv: ;
            owl:versionInfo "proposta"@it , "proposed"@en .


        # -----------------------------------------------------------------------------
        # 4. Codici ISO 3166-1 - per Stato
        # -----------------------------------------------------------------------------

        clv:isoAlpha2
            a owl:DatatypeProperty, owl:FunctionalProperty ;
            rdfs:domain clv:Country ;
            rdfs:range xsd:string ;
            rdfs:label "codice ISO 3166-1 alpha-2"@it ,
                       "ISO 3166-1 alpha-2 code"@en ;
            rdfs:comment
                "Codice a 2 lettere dello standard ISO 3166-1. Esempio: IT = Italia."@it ,
                "2-letter code from the ISO 3166-1 standard. Example: IT = Italy."@en ;
            rdfs:isDefinedBy clv: ;
            owl:versionInfo "proposta"@it , "proposed"@en .

        clv:isoAlpha3
            a owl:DatatypeProperty, owl:FunctionalProperty ;
            rdfs:domain clv:Country ;
            rdfs:range xsd:string ;
            rdfs:label "codice ISO 3166-1 alpha-3"@it ,
                       "ISO 3166-1 alpha-3 code"@en ;
            rdfs:comment
                "Codice a 3 lettere dello standard ISO 3166-1. Esempio: ITA = Italia."@it ,
                "3-letter code from the ISO 3166-1 standard. Example: ITA = Italy."@en ;
            rdfs:isDefinedBy clv: ;
            owl:versionInfo "proposta"@it , "proposed"@en .


        # -----------------------------------------------------------------------------
        # 5. Nota sulle proprieta' gia' esistenti che coprono altri codici
        #
        #    NON servono nuove proprieta' per:
        #
        #    - Codice ISTAT (alfanumerico): gia' in skos:notation su tutte le entita'
        #    - Codice ISTAT numerico: derivabile con xsd:integer(skos:notation)
        #    - Codice Provincia: gia' in skos:notation sulla Province
        #    - Codice Regione: gia' in skos:notation sulla Region
        #    - Codice ripartizione geografica: gia' in skos:notation su GeographicalDistribution
        # -----------------------------------------------------------------------------


        # -----------------------------------------------------------------------------
        # 6. Deprecazione di identifierType
        # -----------------------------------------------------------------------------

        clv:identifierType
            owl:deprecated true ;
            rdfs:comment
                "DEPRECATA. I codici territoriali noti usano proprieta' dirette: skos:notation (ISTAT), clv:codiceBelfiore (catastale), clv:siglaAutomobilistica (targa), clv:codiceCittaMetropolitana, clv:isoAlpha2, clv:isoAlpha3. Per identificativi non standard, continuare a usare clv:Identifier."@it ,
                "DEPRECATED. Known territorial codes use direct properties: skos:notation (ISTAT), clv:codiceBelfiore (cadastral), clv:siglaAutomobilistica (car plate), clv:codiceCittaMetropolitana, clv:isoAlpha2, clv:isoAlpha3. For non-standard identifiers, continue using clv:Identifier."@en .
    """)


def generate_vocabulary_ttl(live_counts):
    """Genera il file Turtle del vocabolario controllato dei tipi di identificativo."""
    lines = []
    lines.append(textwrap.dedent(f"""\
        @prefix skos:    <{SKOS}> .
        @prefix rdfs:    <http://www.w3.org/2000/01/rdf-schema#> .
        @prefix owl:     <http://www.w3.org/2002/07/owl#> .
        @prefix xsd:     <http://www.w3.org/2001/XMLSchema#> .
        @prefix dct:     <http://purl.org/dc/terms/> .
        @prefix adms:    <http://www.w3.org/ns/adms#> .
        @prefix dcatapit: <http://dati.gov.it/onto/dcatapit#> .
        @prefix clv:     <{CLV}> .
        @prefix idtype:  <{VOCAB_BASE}/> .

        # =============================================================================
        # Vocabolario controllato: Tipi di identificativi territoriali
        #
        # Generato da: genera-vocabolario-identifier-types.py
        # Fonte dati: SPARQL endpoint schema.gov.it
        # =============================================================================

        <{VOCAB_BASE}>
            a skos:ConceptScheme, adms:Asset, dcatapit:Dataset ;
            rdfs:label "Tipi di identificativi territoriali"@it ,
                       "Territorial Identifier Types"@en ;
            dct:description
                "Vocabolario controllato dei tipi di codice identificativo usati per le entita' territoriali italiane (comuni, province, regioni, stati)."@it ,
                "Controlled vocabulary of identifier code types used for Italian territorial entities (municipalities, provinces, regions, countries)."@en ;
            dct:publisher <https://w3id.org/italia/data/public-organization/ISTAT> ;
            dct:language <http://publications.europa.eu/resource/authority/language/ITA> ,
                         <http://publications.europa.eu/resource/authority/language/ENG> ;
            owl:versionInfo "0.1 - proposta" ."""))

    # Top concepts
    concept_ids = [t["id"] for t in IDENTIFIER_TYPES.values()]
    for cid in concept_ids:
        lines.append(f"        skos:hasTopConcept idtype:{cid} ;")
    lines[-1] = lines[-1].rstrip(" ;") + " ."
    lines.append("")

    # Individual concepts
    for literal_value, meta in IDENTIFIER_TYPES.items():
        cid = meta["id"]
        count = live_counts.get(literal_value, "?")

        lines.append(f"# --- {meta['prefLabel_it']} ({count} istanze nel triplestore) ---")
        lines.append(f"idtype:{cid}")
        lines.append(f"    a skos:Concept ;")
        lines.append(f"    skos:inScheme <{VOCAB_BASE}> ;")
        lines.append(f'    skos:prefLabel "{meta["prefLabel_it"]}"@it ,')
        lines.append(f'                   "{meta["prefLabel_en"]}"@en ;')

        for lang in ("it", "en"):
            key = f"altLabel_{lang}"
            if key in meta:
                for alt in meta[key]:
                    lines.append(f'    skos:altLabel "{alt}"@{lang} ;')

        lines.append(f'    skos:notation "{meta["notation"]}" ;')
        lines.append(f'    skos:definition "{meta["definition_it"]}"@it ,')
        lines.append(f'                    "{meta["definition_en"]}"@en ;')

        lines.append(f'    skos:historyNote "Valore letterale attuale nel triplestore: \\"{literal_value}\\""@it ;')

        if meta.get("direct_property"):
            lines.append(f'    rdfs:seeAlso {meta["direct_property"]} ;')

        if meta.get("note"):
            lines.append(f'    skos:scopeNote "{meta["note"]}"@it ;')

        lines[-1] = lines[-1].rstrip(" ;") + " ."
        lines.append("")

    return "\n".join(lines)


def escape_ttl(s):
    """Escapa una stringa per l'inserimento in un valore Turtle."""
    return s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def format_rdf_value(binding):
    """Formatta un binding SPARQL come valore Turtle."""
    if binding["type"] == "uri":
        return _compact_uri(binding["value"])
    value = escape_ttl(binding["value"])
    if "xml:lang" in binding:
        return f'"{value}"@{binding["xml:lang"]}'
    if "datatype" in binding and binding["datatype"] != "http://www.w3.org/2001/XMLSchema#string":
        return f'"{value}"^^<{binding["datatype"]}>'
    return f'"{value}"'


# Prefissi noti per abbreviare URI nell'output Turtle
_PREFIXES = {
    CLV: "clv:", L0: "l0:", SKOS: "skos:", TI: "ti:",
    CITIES_BASE + "/": "cities:", PROVINCES_BASE + "/": "provinces:",
    REGIONS_BASE + "/": "regions:", GEODIST_BASE + "/": "geodist:",
    INTERVALS_BASE + "/": "intervals:",
    TERR_CLASS_BASE + "/": "terrclass:",
    ISPRA_PLACES + "/": "ispra-place:",
    "http://www.w3.org/2002/07/owl#": "owl:",
    "http://www.w3.org/2000/01/rdf-schema#": "rdfs:",
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#": "rdf:",
    "http://www.w3.org/2001/XMLSchema#": "xsd:",
    "http://purl.org/dc/terms/": "dct:",
    "http://www.w3.org/ns/adms#": "adms:",
    "http://dati.gov.it/onto/dcatapit#": "dcatapit:",
}

_PREFIX_ITEMS = tuple(_PREFIXES.items())

@lru_cache(maxsize=65536)
def _compact_uri(uri):
    """Abbrevia un URI usando i prefissi noti, altrimenti restituisce <uri>.

    Verifica che la parte locale sia valida per Turtle PN_LOCAL
    (solo alfanumerici, trattino, underscore, punto).
    """
    for ns, prefix in _PREFIX_ITEMS:
        if uri.startswith(ns):
            local = uri[len(ns):]
            if local and re.fullmatch(r'[A-Za-z0-9._-]+', local):
                return prefix + local
            break  # prefisso trovato ma local non valido
    return f"<{uri}>"


def generate_municipalities_ttl(cities, provinces, scheme_metadata=None, compact_province_inscheme=False):
    """Genera il vocabolario dei comuni con proprieta' dirette e dati completi."""
    n_cities = len(cities)
    n_belfiore = sum(1 for c in cities.values() if c.get("belfiore"))
    n_temporal = sum(1 for c in cities.values() if c.get("interval"))

    lines = []
    append = lines.append
    compact = _compact_uri
    append(textwrap.dedent(f"""\
        @prefix owl:     <http://www.w3.org/2002/07/owl#> .
        @prefix rdf:     <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
        @prefix rdfs:    <http://www.w3.org/2000/01/rdf-schema#> .
        @prefix xsd:     <http://www.w3.org/2001/XMLSchema#> .
        @prefix skos:    <{SKOS}> .
        @prefix dct:     <http://purl.org/dc/terms/> .
        @prefix adms:    <http://www.w3.org/ns/adms#> .
        @prefix dcatapit: <http://dati.gov.it/onto/dcatapit#> .
        @prefix xkos:    <http://rdf-vocabulary.ddialliance.org/xkos#> .
        @prefix clv:     <{CLV}> .
        @prefix l0:      <{L0}> .
        @prefix ti:      <{TI}> .
        @prefix cities:  <{CITIES_BASE}/> .
        @prefix provinces: <{PROVINCES_BASE}/> .
        @prefix regions: <{REGIONS_BASE}/> .
        @prefix geodist: <{GEODIST_BASE}/> .
        @prefix intervals: <{INTERVALS_BASE}/> .
        @prefix terrclass: <{TERR_CLASS_BASE}/> .
        @prefix ispra-place: <{ISPRA_PLACES}/> .

        # =============================================================================
        # Vocabolario controllato dei Comuni d'Italia - con proprieta' dirette
        #
        # Generato da: genera-vocabolario-identifier-types.py
        # Fonte dati: SPARQL endpoint schema.gov.it
        #
        # Rispetto all'originale, le risorse clv:Identifier intermedie sono
        # sostituite da proprieta' dirette (clv:codiceBelfiore).
        # Tutti gli altri dati (gerarchia, validita' temporale, sameAs, ecc.)
        # sono preservati integralmente.
        #
        # Statistiche:
        #   - Istanze city (incl. storiche): {n_cities}
        #   - Con codice Belfiore: {n_belfiore}
        #   - Con validita' temporale: {n_temporal}
        # =============================================================================
    """))

    # ── ConceptScheme metadata ──
    if scheme_metadata:
        append(f"<{CITIES_BASE}>")
        # Raggruppa per predicato per output pulito
        by_pred = defaultdict(list)
        for b in scheme_metadata:
            p = b["p"]["value"]
            by_pred[p].append(b["o"])
        for p_uri in sorted(by_pred.keys()):
            p_compact = compact(p_uri)
            vals = [format_rdf_value(o) for o in by_pred[p_uri]]
            append(f"    {p_compact} {' , '.join(vals)} ;")
        lines[-1] = lines[-1].rstrip(" ;") + " ."
        append("")
    else:
        # Fallback se non disponibili dal triplestore
        append(f"<{CITIES_BASE}>")
        append(f"    a skos:ConceptScheme , adms:Asset , dcatapit:Dataset ;")
        append(f'    rdfs:label "Comuni d\'Italia (con proprieta\' dirette)"@it ;')
        append(f'    owl:versionInfo "proposta - generato da script" .')
        append("")

    # ── Province ──
    if provinces:
        if compact_province_inscheme:
            append("# Assioma compatto: tutte le clv:Province appartengono allo scheme province")
            append("clv:Province")
            append("    rdfs:subClassOf [")
            append("        a owl:Restriction ;")
            append("        owl:onProperty skos:inScheme ;")
            append(f"        owl:hasValue <{PROVINCES_BASE}>")
            append("    ] .")
            append("")

        append("")
        append("# =============================================================================")
        append(f"# Province ({len(provinces)} entries)")
        append("# =============================================================================")
        append("")

        for notation in sorted(provinces.keys()):
            prov = provinces[notation]
            name = escape_ttl(prov.get("name", f"Provincia {notation}"))
            append(f"provinces:{notation}")
            append(f"    a clv:Province , skos:Concept ;")
            if not compact_province_inscheme:
                append(f"    skos:inScheme <{PROVINCES_BASE}> ;")
            append(f'    skos:notation "{notation}" ;')
            append(f'    l0:name "{name}" ;')

            if "sigla" in prov:
                append(f'    clv:siglaAutomobilistica "{prov["sigla"]}" ;')
            if "metro" in prov:
                append(f'    clv:codiceCittaMetropolitana "{prov["metro"]}" ;')

            lines[-1] = lines[-1].rstrip(" ;") + " ."
            append("")

    # ── Cities ──
    time_intervals = {}  # URI -> {start, end} per output separato

    append("")
    append("# =============================================================================")
    append(f"# Comuni ({n_cities} istanze, incluse versioni storiche)")
    append("# =============================================================================")
    append("")

    for city_uri in sorted(cities.keys()):
        city = cities[city_uri]
        append(f"{compact(city_uri)}")
        append(f"    a clv:City , clv:AdminUnitComponent , clv:Feature , skos:Concept ;")

        if city.get("inScheme"):
            append(f"    skos:inScheme {compact(city['inScheme'])} ;")

        append(f'    skos:notation "{city["notation"]}" ;')

        for name, lang in city.get("names", []):
            name_esc = escape_ttl(name)
            lang_tag = f"@{lang}" if lang else ""
            append(f'    l0:name "{name_esc}"{lang_tag} ;')
            append(f'    rdfs:label "{name_esc}"{lang_tag} ;')
            append(f'    skos:prefLabel "{name_esc}"{lang_tag} ;')

        append(f'    clv:hasRankOrder "4" ;')

        if city.get("geoDist"):
            append(f"    clv:hasGeographicalDistribution {compact(city['geoDist'])} ;")

        if city.get("directHigher"):
            append(f"    clv:hasDirectHigherRank {compact(city['directHigher'])} ;")
        if city.get("broader"):
            append(f"    skos:broader {compact(city['broader'])} ;")

        for bt in city.get("broaderTransitive", []):
            append(f"    skos:broaderTransitive {compact(bt)} ;")
        for hr in city.get("higherRank", []):
            append(f"    clv:hasHigherRank {compact(hr)} ;")
        for sw in city.get("situatedWithin", []):
            append(f"    clv:situatedWithin {compact(sw)} ;")

        if city.get("sameAs"):
            append(f"    owl:sameAs {compact(city['sameAs'])} ;")

        if city.get("interval"):
            append(f"    clv:hasSOValidity {compact(city['interval'])} ;")
            time_intervals[city["interval"]] = {
                "start": city.get("startTime"),
                "end": city.get("endTime"),
            }

        # Proprieta' diretta: codice Belfiore (NUOVA)
        if city.get("belfiore"):
            append(f'    clv:codiceBelfiore "{city["belfiore"]}" ;')

        lines[-1] = lines[-1].rstrip(" ;") + " ."
        append("")

    # ── TimeInterval resources ──
    if time_intervals:
        append("")
        append("# =============================================================================")
        append(f"# Intervalli temporali ({len(time_intervals)} risorse)")
        append("# =============================================================================")
        append("")

        for iv_uri in sorted(time_intervals.keys()):
            iv = time_intervals[iv_uri]
            append(f"{compact(iv_uri)}")
            append(f"    a ti:TimeInterval ;")
            if iv.get("start"):
                append(f'    ti:startTime "{iv["start"]}"^^xsd:date ;')
            if iv.get("end"):
                append(f'    ti:endTime "{iv["end"]}"^^xsd:date ;')
            lines[-1] = lines[-1].rstrip(" ;") + " ."
            append("")

    return "\n".join(lines)


def generate_migration_sparql():
    """Genera le query SPARQL UPDATE per la migrazione."""
    lines = []
    lines.append(textwrap.dedent(f"""\
        # =============================================================================
        # Query SPARQL UPDATE per la migrazione a proprieta' dirette (Proposta B)
        #
        # Generato da: genera-vocabolario-identifier-types.py
        #
        # ATTENZIONE: eseguire in ordine. Validare dopo ogni passo.
        # =============================================================================
    """))

    # Passo 1: Belfiore
    lines.append(textwrap.dedent(f"""\
        # --- Passo 1: Aggiungere clv:codiceBelfiore ai comuni ---
        # Codici coinvolti: ~10.350
        INSERT {{
          ?city <{CLV}codiceBelfiore> ?code .
        }}
        WHERE {{
          ?city a <{CLV}City> ;
                <{CLV}hasIdentifier> ?id .
          ?id <{CLV}identifierType> "Codice Catastale" ;
              <{L0}identifier> ?code .
        }}
        ;
    """))

    # Passo 2: Sigla automobilistica
    lines.append(textwrap.dedent(f"""\
        # --- Passo 2: Aggiungere clv:siglaAutomobilistica alle province ---
        # Codici coinvolti: ~107
        INSERT {{
          ?prov <{CLV}siglaAutomobilistica> ?code .
        }}
        WHERE {{
          ?prov a <{CLV}Province> ;
                <{CLV}hasIdentifier> ?id .
          ?id <{CLV}identifierType> "Sigla Automobilistica" ;
              <{L0}identifier> ?code .
        }}
        ;
    """))

    # Passo 3: Codice citta' metropolitana
    lines.append(textwrap.dedent(f"""\
        # --- Passo 3: Aggiungere clv:codiceCittaMetropolitana ---
        # Codici coinvolti: ~14
        INSERT {{
          ?prov <{CLV}codiceCittaMetropolitana> ?code .
        }}
        WHERE {{
          ?prov a <{CLV}Province> ;
                <{CLV}hasIdentifier> ?id .
          ?id <{CLV}identifierType> "Codice Città Metropolitana" ;
              <{L0}identifier> ?code .
        }}
        ;
    """))

    # Passo 4: ISO
    lines.append(textwrap.dedent(f"""\
        # --- Passo 4: Aggiungere clv:isoAlpha2 e clv:isoAlpha3 ---
        INSERT {{
          ?country <{CLV}isoAlpha2> ?code .
        }}
        WHERE {{
          ?country a <{CLV}Country> ;
                   <{CLV}hasIdentifier> ?id .
          ?id <{CLV}identifierType> "ISO 3166-1 alpha-2" ;
              <{L0}identifier> ?code .
        }}
        ;

        INSERT {{
          ?country <{CLV}isoAlpha3> ?code .
        }}
        WHERE {{
          ?country a <{CLV}Country> ;
                   <{CLV}hasIdentifier> ?id .
          ?id <{CLV}identifierType> "ISO 3166-1 alpha-3" ;
              <{L0}identifier> ?code .
        }}
        ;
    """))

    # Passo 5: Verifica
    lines.append(textwrap.dedent(f"""\
        # --- Passo 5: Query di VERIFICA (eseguire prima di eliminare) ---

        # 5a. Verifica Belfiore: contare comuni con proprieta' diretta
        SELECT (COUNT(?city) AS ?cities_with_belfiore) WHERE {{
          ?city a <{CLV}City> ; <{CLV}codiceBelfiore> ?code .
        }}

        # 5b. Confronto: comuni con Identifier "Codice Catastale" vs clv:codiceBelfiore
        SELECT ?city ?old_code ?new_code WHERE {{
          ?city a <{CLV}City> ;
                <{CLV}hasIdentifier> ?id ;
                <{CLV}codiceBelfiore> ?new_code .
          ?id <{CLV}identifierType> "Codice Catastale" ;
              <{L0}identifier> ?old_code .
          FILTER(?old_code != ?new_code)
        }}
        # Se restituisce 0 righe: migrazione corretta!
    """))

    # Passo 6: Cleanup
    id_types_to_remove = [
        ("Codice ISTAT numerico", "ISTAT numerici (completamente ridondanti)"),
        ("Codice ISTAT alfanumerico", "ISTAT alfanumerici (coperti da skos:notation)"),
        ("Codice Catastale", "catastali (coperti da clv:codiceBelfiore)"),
        ("Codice Provincia Alfanumerico", "province (codice coperto da skos:notation)"),
        ("Sigla Automobilistica", "sigla auto (coperti da clv:siglaAutomobilistica)"),
        ("Codice Città Metropolitana", "citta' metropolitane (coperti da clv:codiceCittaMetropolitana)"),
        ("Codice Regione", "regione (coperti da skos:notation)"),
        ("Identificativo della ripartizione geografica", "ripartizione geografica (coperti da skos:notation)"),
    ]

    lines.append("# --- Passo 6: Rimozione risorse Identifier ridondanti ---")
    lines.append("# ATTENZIONE: eseguire SOLO dopo aver validato i passi precedenti!\n")

    for idx, (id_type, desc) in enumerate(id_types_to_remove, start=1):
        letter = chr(ord('a') + idx - 1)
        lines.append(f"# 6{letter}. Rimuovi Identifier {desc}")
        lines.append(f"DELETE {{ ?entity <{CLV}hasIdentifier> ?id . ?id ?p ?o . }}")
        lines.append(f"WHERE {{")
        lines.append(f"  ?entity <{CLV}hasIdentifier> ?id .")
        lines.append(f"  ?id a <{CLV}Identifier> ;")
        lines.append(f'      <{CLV}identifierType> "{id_type}" ;')
        lines.append(f"      ?p ?o .")
        lines.append(f"}}")
        lines.append(f";\n")

    # ISO (combinati)
    lines.append(f"# 6i. Rimuovi Identifier ISO (coperti da clv:isoAlpha2 e clv:isoAlpha3)")
    lines.append(f"DELETE {{ ?entity <{CLV}hasIdentifier> ?id . ?id ?p ?o . }}")
    lines.append(f"WHERE {{")
    lines.append(f"  ?entity <{CLV}hasIdentifier> ?id .")
    lines.append(f"  ?id a <{CLV}Identifier> ;")
    lines.append(f'      <{CLV}identifierType> ?type ;')
    lines.append(f"      ?p ?o .")
    lines.append(f'  FILTER(?type IN ("ISO 3166-1 alpha-2", "ISO 3166-1 alpha-3"))')
    lines.append(f"}}")
    lines.append(f";")

    return "\n".join(lines)


# ─── Main ────────────────────────────────────────────────────────────────────

def write_file(path, content, label):
    """Scrive un file e stampa un messaggio."""
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    size_kb = len(content.encode("utf-8")) / 1024
    print(f"  {label}: {path} ({size_kb:.0f} KB)", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(
        description="Genera file TTL per ontologie modificate e vocabolario comuni con proprieta' dirette"
    )
    parser.add_argument(
        "--endpoint", default=DEFAULT_ENDPOINT,
        help=f"URL SPARQL endpoint (default: {DEFAULT_ENDPOINT})"
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Non interroga il triplestore, genera solo i file template"
    )
    parser.add_argument(
        "--output-dir", default=".",
        help="Directory di output (default: directory corrente)"
    )
    parser.add_argument(
        "--skip-municipalities", action="store_true",
        help="Non genera il vocabolario dei comuni (velocizza l'esecuzione)"
    )
    parser.add_argument(
        "--compact-province-inscheme", action="store_true",
        help="Riduce ridondanza nel TTL province: omette skos:inScheme per ogni provincia e aggiunge un solo assioma OWL"
    )
    args = parser.parse_args()

    print("=" * 70, file=sys.stderr)
    print("Generatore file TTL - Ontologie e Vocabolari OntoPiA", file=sys.stderr)
    print("=" * 70, file=sys.stderr)

    # ── 1. Ontologia CLV: proprieta' dirette ──
    print("\n[1/4] Generazione patch ontologia CLV...", file=sys.stderr)
    clv_ttl = generate_clv_patch_ttl()
    write_file(
        f"{args.output_dir}/ontopia-patch-clv-direct-identifiers.ttl",
        clv_ttl, "Patch CLV"
    )

    # ── 2. Vocabolario tipi di identificativo ──
    print("\n[2/4] Vocabolario tipi di identificativo...", file=sys.stderr)
    live_counts = {}
    if not args.dry_run:
        print(f"  Interrogo {args.endpoint} ...", file=sys.stderr)
        results = fetch_current_types(args.endpoint)
        if results is None:
            print("  Impossibile connettersi. Uso modalita' dry-run.", file=sys.stderr)
        else:
            live_counts = {r["type"]: r["count"] for r in results}
            total = sum(int(c) for c in live_counts.values())
            print(f"  Trovati {len(live_counts)} tipi, {total} risorse Identifier totali.", file=sys.stderr)

            unknown = set(live_counts.keys()) - set(IDENTIFIER_TYPES.keys())
            if unknown:
                print(f"\n  ATTENZIONE: tipi non mappati:", file=sys.stderr)
                for u in unknown:
                    print(f'    - "{u}" ({live_counts[u]} occorrenze)', file=sys.stderr)

    vocab_ttl = generate_vocabulary_ttl(live_counts)
    write_file(
        f"{args.output_dir}/vocabolario-identifier-types.ttl",
        vocab_ttl, "Vocabolario tipi"
    )

    # ── 3. Vocabolario comuni con proprieta' dirette ──
    cities = {}
    provinces = {}
    scheme_metadata = None
    if not args.skip_municipalities:
        print("\n[3/4] Vocabolario comuni con proprieta' dirette...", file=sys.stderr)
        if args.dry_run:
            print("  (dry-run: vocabolario comuni vuoto)", file=sys.stderr)
        else:
            ep = args.endpoint

            def _fetch(label, fn, *a):
                print(f"  {label}...", file=sys.stderr)
                t0 = time.time()
                r = fn(*a)
                n = len(r) if r else 0
                print(f"    {n} righe in {time.time()-t0:.1f}s", file=sys.stderr)
                return r

            core = _fetch("Recupero dati core city", fetch_city_core, ep)
            names = _fetch("Recupero nomi city", fetch_city_names_full, ep)
            temporal = _fetch("Recupero validita' temporale", fetch_city_temporal, ep)
            situated = _fetch("Recupero situatedWithin", fetch_city_situated_within, ep)
            bt = _fetch("Recupero broaderTransitive", fetch_city_broader_transitive, ep)
            hr = _fetch("Recupero hasHigherRank", fetch_city_higher_rank, ep)
            belfiore_results = _fetch("Recupero codici Belfiore", fetch_belfiore_codes, ep)

            cities = build_city_data(core, names, temporal, situated, bt, hr, belfiore_results)
            n_belf = sum(1 for c in cities.values() if c.get("belfiore"))
            n_temp = sum(1 for c in cities.values() if c.get("interval"))
            print(f"  Assemblate {len(cities)} istanze city (belfiore: {n_belf}, temporale: {n_temp})", file=sys.stderr)

            print("  Recupero dati province...", file=sys.stderr)
            provinces = fetch_province_data(ep)
            if provinces:
                with_sigla = sum(1 for p in provinces.values() if "sigla" in p)
                with_metro = sum(1 for p in provinces.values() if "metro" in p)
                print(f"  Province: {len(provinces)} (con sigla: {with_sigla}, citta' metro: {with_metro})", file=sys.stderr)

            print("  Recupero metadati ConceptScheme...", file=sys.stderr)
            scheme_metadata = fetch_concept_scheme_metadata(ep, CITIES_BASE)

        municipalities_ttl = generate_municipalities_ttl(
            cities,
            provinces,
            scheme_metadata,
            compact_province_inscheme=args.compact_province_inscheme,
        )
        write_file(
            f"{args.output_dir}/vocabolario-comuni-diretto.ttl",
            municipalities_ttl, "Vocabolario comuni"
        )
    else:
        print("\n[3/4] Vocabolario comuni: saltato (--skip-municipalities)", file=sys.stderr)

    # ── 4. Query di migrazione SPARQL ──
    print("\n[4/4] Query di migrazione SPARQL...", file=sys.stderr)
    migration_sparql = generate_migration_sparql()
    write_file(
        f"{args.output_dir}/migrazione-identifier-diretti.sparql",
        migration_sparql, "Query migrazione"
    )

    # ── Riepilogo ──
    print("\n" + "=" * 70, file=sys.stderr)
    print("Riepilogo", file=sys.stderr)
    print("=" * 70, file=sys.stderr)
    print(f"Tipi di identificativo mappati: {len(IDENTIFIER_TYPES)}", file=sys.stderr)
    for literal_value, meta in IDENTIFIER_TYPES.items():
        count = live_counts.get(literal_value, "?")
        prop = meta.get("direct_property") or "(eliminare)"
        print(f"  {meta['notation']:12s}  {str(count):>6s}  -> {prop:30s}  {meta['prefLabel_it']}", file=sys.stderr)

    if cities:
        print(f"\nIstanze city nel vocabolario: {len(cities)}", file=sys.stderr)
        n_belf = sum(1 for c in cities.values() if c.get("belfiore"))
        n_temp = sum(1 for c in cities.values() if c.get("interval"))
        notations = set(c["notation"] for c in cities.values())
        print(f"  codici ISTAT distinti: {len(notations)}", file=sys.stderr)
        print(f"  con codice Belfiore:   {n_belf}", file=sys.stderr)
        print(f"  con validita' temp.:   {n_temp}", file=sys.stderr)

    if provinces:
        print(f"\nProvince nel vocabolario: {len(provinces)}", file=sys.stderr)

    print("\nFile generati:", file=sys.stderr)
    idx = 1
    print(f"  {idx}. {args.output_dir}/ontopia-patch-clv-direct-identifiers.ttl", file=sys.stderr)
    idx += 1
    print(f"  {idx}. {args.output_dir}/vocabolario-identifier-types.ttl", file=sys.stderr)
    idx += 1
    if not args.skip_municipalities:
        print(f"  {idx}. {args.output_dir}/vocabolario-comuni-diretto.ttl", file=sys.stderr)
        idx += 1
    print(f"  {idx}. {args.output_dir}/migrazione-identifier-diretti.sparql", file=sys.stderr)
    print("", file=sys.stderr)


if __name__ == "__main__":
    main()

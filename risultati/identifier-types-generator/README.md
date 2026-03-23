# Generatore vocabolario identifier types

## Perche' facciamo queste modifiche
L'obiettivo non e' solo tecnico, ma di qualita' del modello dati:
- ridurre la ridondanza delle risorse `clv:Identifier` (molte sono codici gia' noti e stabili);
- semplificare query e manutenzione (meno hop e meno dipendenza da stringhe libere in `identifierType`);
- introdurre una rappresentazione piu' chiara dei codici territoriali (es. Belfiore, sigla automobilistica, ISO);
- mantenere retrocompatibilita' progressiva tramite patch additive e migrazione guidata.

In parallelo, lo script e' stato ottimizzato per gestire piu' velocemente la generazione del vocabolario comuni senza cambiare il contenuto prodotto.

## Cosa modifica nel vocabolario
Lo script genera questi artefatti:
- `ontopia-patch-clv-direct-identifiers.ttl`
- `vocabolario-identifier-types.ttl`
- `vocabolario-comuni-diretto.ttl`
- `migrazione-identifier-diretti.sparql`

Modifiche principali lato vocabolario:
- creazione del ConceptScheme dei tipi identificativo territoriale (`idtype:*`);
- mappatura esplicita dei literal attuali di `clv:identifierType` in concetti controllati;
- pubblicazione del vocabolario comuni con proprieta' dirette (es. `clv:codiceBelfiore`) preservando gli altri metadati (gerarchie, temporalita', sameAs, ecc.).

## Servono modifiche alle ontologie?
Si', se vuoi adottare il modello proposto end-to-end.

Modifiche CLV (patch additiva):
- nuove proprieta' dirette: `clv:codiceBelfiore`, `clv:siglaAutomobilistica`, `clv:codiceCittaMetropolitana`, `clv:isoAlpha2`, `clv:isoAlpha3`;
- deprecazione documentata di `clv:identifierType` per i casi coperti da proprieta' dirette.

In pratica:
- se vuoi solo analisi/offline generation, puoi usare i TTL generati senza toccare subito il triplestore;
- se vuoi produzione coerente, applica patch ontologiche + query di migrazione SPARQL.

## Come lanciare lo script
Script principale:
- `risultati/identifier-types-generator/scripts/genera-vocabolario-identifier-types.py`

Esempi:

```bash
# esecuzione completa con endpoint di default
python3 risultati/identifier-types-generator/scripts/genera-vocabolario-identifier-types.py

# endpoint custom
python3 risultati/identifier-types-generator/scripts/genera-vocabolario-identifier-types.py \
  --endpoint https://schema.gov.it/sparql

# solo template (senza query al triplestore)
python3 risultati/identifier-types-generator/scripts/genera-vocabolario-identifier-types.py --dry-run

# output in directory dedicata
python3 risultati/identifier-types-generator/scripts/genera-vocabolario-identifier-types.py \
  --output-dir /tmp/identifier-types-out

# salta la generazione del vocabolario comuni (piu' veloce)
python3 risultati/identifier-types-generator/scripts/genera-vocabolario-identifier-types.py \
  --skip-municipalities

# modalita' compatta province:
# rimuove skos:inScheme ripetuto su ogni provincia e aggiunge un solo assioma OWL
python3 risultati/identifier-types-generator/scripts/genera-vocabolario-identifier-types.py \
  --compact-province-inscheme
```

Nota su `--compact-province-inscheme`:
- riduce dimensione e ridondanza del TTL;
- semanticamente mantiene l'informazione tramite assioma OWL;
- i consumer senza reasoning OWL non vedranno la tripla `skos:inScheme` materializzata su ogni provincia.

## Verifica: contenuto invariato prima/dopo ottimizzazione
Baseline originale:
- `risultati/identifier-types-generator/baseline/genera-vocabolario-identifier-types.baseline.py`

Test equivalenza:
- `risultati/identifier-types-generator/tests/test_identifier_types_equivalence.py`

Esegui:

```bash
python3 -m unittest risultati/identifier-types-generator/tests/test_identifier_types_equivalence.py
```

Esito atteso:

```text
...
----------------------------------------------------------------------
Ran 3 tests in ~0.1s
OK
```

## Benchmark performance
Script benchmark:
- `risultati/identifier-types-generator/scripts/benchmark.py`

Comando:

```bash
python3 risultati/identifier-types-generator/scripts/benchmark.py --cities 12000
```

Rilevazione recente (dataset sintetico):
- speedup totale ~1.9x.

## Struttura cartella
- `risultati/identifier-types-generator/scripts/`
- `risultati/identifier-types-generator/tests/`
- `risultati/identifier-types-generator/baseline/`
- `risultati/identifier-types-generator/README.md`

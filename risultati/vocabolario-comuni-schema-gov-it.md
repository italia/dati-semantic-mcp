# Vocabolario controllato dei Comuni su schema.gov.it

Il vocabolario principale che tratta dei comuni è:

**[Vocabolario Controllato dei Comuni d'Italia](https://w3id.org/italia/controlled-vocabulary/territorial-classifications/cities)**

- **Versione**: 1.3 (aggiornata al 22 gennaio 2024, fonte ISTAT - Situas)
- **Pubblicazione**: 19 giugno 2018, ultima modifica 10 giugno 2024
- **Descrizione**: Contiene l'elenco dei codici e delle denominazioni dei comuni **esistiti ed esistenti a partire dal 1861**, basato sul Sistema Informativo Territoriale delle Unità Amministrative e Statistiche (Situas) dell'ISTAT
- **Modello**: SKOS + ontologia CLV (Core Location Vocabulary) di OntoPiA

## Numeri

| Dato | Conteggio |
|---|---|
| **Totale voci** (comuni storici + attuali, ogni variazione è un'entry) | **35.708** |
| **Codici ISTAT distinti** (comuni unici nella storia dal 1861) | **14.206** |
| **Comuni attualmente attivi** (data fine = 9999-12-31) | **7.896** |

Ogni comune può avere più voci nel vocabolario perché ogni cambiamento (di nome, provincia, regione, ecc.) genera una nuova entry con un intervallo di validità temporale. Ad esempio, **Roma** ha più entry: una dal 1884 al 1902 e l'attuale dal 2015 in poi.

## Vocabolari territoriali correlati

Il vocabolario dei comuni fa parte di una famiglia di vocabolari territoriali:

- `territorial-classifications/countries/italy` — Paese Italia
- `territorial-classifications/regions` — Regioni d'Italia
- `territorial-classifications/provinces` — Province d'Italia
- `territorial-classifications/geographical-distribution` — Ripartizioni geografiche
- **`territorial-classifications/cities`** — **Comuni d'Italia**

I comuni sono gerarchicamente collegati alle province (tramite `hasDirectHigherRank`) e alle regioni (tramite `hasHigherRank`).

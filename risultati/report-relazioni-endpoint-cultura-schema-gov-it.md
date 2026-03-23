# Report: Relazioni tra endpoint SPARQL Cultura e catalogo `schema.gov.it`

## Obiettivo

Verificare:

- quali ontologie sono usate nell'endpoint SPARQL della Cultura
- come sono connesse tra loro
- quali di queste risultano presenti nel catalogo di `schema.gov.it`
- come si articolano i riusi di ArCo verso ontologie catalogate
- se esistono allineamenti espliciti formali tra ArCo e ontologie catalogate

Endpoint analizzato:

- `https://dati.cultura.gov.it/sparql`

Data del controllo:

- 2 marzo 2026

## Metodo

L'analisi e' stata svolta interrogando:

- il triplestore di `schema.gov.it`
- l'endpoint esterno `https://dati.cultura.gov.it/sparql`

Le verifiche sono state condotte in piu' passaggi:

1. ricerca di endpoint esplicitamente collegati nel catalogo `schema.gov.it`
2. estrazione delle classi piu' frequenti nell'endpoint Cultura
3. ricostruzione dei namespace ontologici usati
4. verifica della presenza dei namespace come `owl:Ontology` nel catalogo `schema.gov.it`
5. analisi di `owl:imports`
6. analisi delle relazioni `rdfs:subClassOf`
7. analisi delle relazioni sulle proprieta' (`rdfs:subPropertyOf`, `rdfs:domain`, `rdfs:range`)
8. ricerca di allineamenti espliciti (`owl:equivalentClass`, `owl:equivalentProperty`, `owl:sameAs`, `skos:exactMatch`)

## 1. Presenza di endpoint collegati in `schema.gov.it`

Ho verificato se `schema.gov.it` dichiara esplicitamente endpoint SPARQL collegati tramite `dcat:DataService`.

Esito:

- nessun endpoint restituito dalla vista degli endpoint collegati
- nessun `dcat:DataService` trovato con riferimenti testuali a "cultura"

Conclusione:

- non emerge un collegamento catalografico esplicito tra `schema.gov.it` e l'endpoint SPARQL Cultura

## 2. Ontologie effettivamente usate nell'endpoint Cultura

Dalle classi RDF piu' frequenti nell'endpoint Cultura emergono tre famiglie principali:

- moduli ArCo
- ontologie OntoPiA (`https://w3id.org/italia/onto/...`)
- `Cultural-ON` / `CIS` (`http://dati.beniculturali.it/cis`)

Esempi di classi molto frequenti:

- `https://w3id.org/italia/onto/RO/TimeIndexedRole`
- `https://w3id.org/arco/ontology/catalogue/CatalogueRecordVersion`
- `https://w3id.org/arco/ontology/core/AgentRole`
- `https://w3id.org/arco/ontology/denotative-description/Measurement`
- `https://w3id.org/italia/onto/MU/Value`
- `https://w3id.org/italia/onto/l0/Event`
- `https://w3id.org/italia/onto/CLV/Geometry`
- `https://w3id.org/italia/onto/TI/TimeInterval`
- `https://w3id.org/italia/onto/CPV/Person`
- `http://dati.beniculturali.it/cis/Site`

Namespace ontologici principali osservati:

### Moduli ArCo

- `https://w3id.org/arco/ontology/archive`
- `https://w3id.org/arco/ontology/arco`
- `https://w3id.org/arco/ontology/arco-lite`
- `https://w3id.org/arco/ontology/catalogue`
- `https://w3id.org/arco/ontology/cataloguing-campaign`
- `https://w3id.org/arco/ontology/construction-description`
- `https://w3id.org/arco/ontology/context-description`
- `https://w3id.org/arco/ontology/core`
- `https://w3id.org/arco/ontology/cultural-event`
- `https://w3id.org/arco/ontology/denotative-description`
- `https://w3id.org/arco/ontology/immovable-property`
- `https://w3id.org/arco/ontology/location`
- `https://w3id.org/arco/ontology/movable-property`
- `https://w3id.org/arco/ontology/natural-specimen-description`

### Ontologie OntoPiA

- `https://w3id.org/italia/onto/RO`
- `https://w3id.org/italia/onto/MU`
- `https://w3id.org/italia/onto/l0`
- `https://w3id.org/italia/onto/CLV`
- `https://w3id.org/italia/onto/TI`
- `https://w3id.org/italia/onto/CPV`

### Ontologia cultura

- `http://dati.beniculturali.it/cis`

## 3. Presenza sul catalogo `schema.gov.it`

Ho verificato se i namespace emersi risultano registrati come `owl:Ontology` nel catalogo di `schema.gov.it`.

### Presenti nel catalogo

- `http://dati.beniculturali.it/cis`
- `https://w3id.org/italia/onto/RO`
- `https://w3id.org/italia/onto/MU`
- `https://w3id.org/italia/onto/l0`
- `https://w3id.org/italia/onto/CLV`
- `https://w3id.org/italia/onto/TI`
- `https://w3id.org/italia/onto/CPV`

Risultano inoltre presenti anche ontologie importate da `CIS`:

- `https://w3id.org/italia/onto/AccessCondition`
- `https://w3id.org/italia/onto/CPEV`
- `https://w3id.org/italia/onto/POI`
- `https://w3id.org/italia/onto/POT`
- `https://w3id.org/italia/onto/SM`

### Non presenti come ontologie catalogate

Tutti i moduli ArCo verificati risultano non catalogati come `owl:Ontology` in `schema.gov.it`:

- `https://w3id.org/arco/ontology/archive`
- `https://w3id.org/arco/ontology/arco`
- `https://w3id.org/arco/ontology/arco-lite`
- `https://w3id.org/arco/ontology/catalogue`
- `https://w3id.org/arco/ontology/cataloguing-campaign`
- `https://w3id.org/arco/ontology/construction-description`
- `https://w3id.org/arco/ontology/context-description`
- `https://w3id.org/arco/ontology/core`
- `https://w3id.org/arco/ontology/cultural-event`
- `https://w3id.org/arco/ontology/denotative-description`
- `https://w3id.org/arco/ontology/immovable-property`
- `https://w3id.org/arco/ontology/location`
- `https://w3id.org/arco/ontology/movable-property`
- `https://w3id.org/arco/ontology/natural-specimen-description`

Conclusione:

- OntoPiA e `CIS` sono presenti nel catalogo `schema.gov.it`
- ArCo e' usato ampiamente nell'endpoint Cultura, ma non risulta registrato nel catalogo come insieme di ontologie proprie

## 4. Connessioni tramite `owl:imports`

### Import di `CIS`

`http://dati.beniculturali.it/cis` importa:

- `https://w3id.org/italia/onto/AccessCondition`
- `https://w3id.org/italia/onto/CLV`
- `https://w3id.org/italia/onto/CPEV`
- `https://w3id.org/italia/onto/POI`
- `https://w3id.org/italia/onto/POT`
- `https://w3id.org/italia/onto/RO`
- `https://w3id.org/italia/onto/SM`
- `https://w3id.org/italia/onto/TI`
- `https://w3id.org/italia/onto/l0`

### Import di ArCo

`https://w3id.org/arco/ontology/arco` importa moduli ArCo versionati:

- `catalogue/1.2`
- `cataloguing-campaign/0.1`
- `context-description/1.2`
- `core/1.2`
- `cultural-event/1.1`
- `denotative-description/1.2`
- `immovable-property/0.2`
- `location/1.2`
- `movable-property/0.2`

Altri moduli ArCo importano:

- `catalogue` -> `core/1.2`
- `context-description` -> `core/1.2`
- `denotative-description` -> `core/1.2`
- `location` -> `core/1.2`

Conclusione:

- `CIS` funge da ponte diretto verso ontologie catalogate in `schema.gov.it`
- ArCo e' fortemente modulare e riusa internamente i propri moduli

## 5. Connessioni semantiche tra classi (`rdfs:subClassOf`)

Ho verificato le relazioni di sottoclasse tra classi ArCo e classi delle ontologie catalogate.

### ArCo -> `CIS`

Esempi rilevati:

- `archive:ArchivalCollection` -> `cis:CollectionCulEnt`
- `archive:ArchivalResource` -> `cis:CulturalEntity`
- `arco:CulturalProperty` -> `cis:CulturalEntity`
- `arco:CulturalPropertyPart` -> `cis:CulturalEntity`
- `context-description:ArchivalRecordSet` -> `cis:CollectionCulEnt`
- `context-description:DerivatedWork` -> `cis:CulturalEntity`
- `context-description:Herbarium` -> `cis:CollectionCulEnt`
- `context-description:NumismaticSeries` -> `cis:CollectionCulEnt`
- `context-description:PreparatoryOrFinalWork` -> `cis:CulturalEntity`
- `cultural-event:Competition` -> `cis:CulturalEvent`
- `cultural-event:Exhibition` -> `cis:CulturalEvent`

### ArCo -> OntoPiA

Esempi rilevati:

- `arco:CulturalPropertyCollection` -> `l0:Collection`
- `catalogue:AccessProfile` -> `l0:Characteristic`
- `catalogue:CatalogueRecord` -> `l0:Object`
- `cataloguing-campaign:CataloguingActivity` -> `TI:TimeIndexedEvent`
- `context-description:Profession` -> `RO:Role`
- `context-description:UseFunction` -> `RO:Role`
- `context-description:Intervention` -> `l0:Activity`
- `context-description:Subject` -> `l0:Topic`
- `core:Event` -> `l0:EventOrSituation`
- `cultural-event:TimePeriod` -> `TI:TimeInterval`
- `cultural-event:TimePeriodMeasurementUnit` -> `MU:MeasurementUnit`
- `denotative-description:MeasurementCollection` -> `l0:Collection`
- `location:CadastralEntity` -> `CLV:SpatialObject`
- `location:Continent` -> `CLV:AdministrativeUnitComponent`
- `location:Coordinates` -> `CLV:Geometry`
- `location:OldTown` -> `CLV:City`
- `location:UrbanArea` -> `CLV:AdministrativeUnitComponent`

### Copertura per modulo ArCo

Dalle query sulle sottoclassi risultano connessioni esplicite almeno per i seguenti moduli:

- `archive`
- `arco`
- `catalogue`
- `cataloguing-campaign`
- `construction-description`
- `context-description`
- `core`
- `cultural-event`
- `denotative-description`
- `immovable-property`
- `location`
- `movable-property`
- `natural-specimen-description`

Conclusione:

- ArCo non e' solo co-presente: eredita formalmente da classi OntoPiA e `CIS`
- il riuso e' diffuso in piu' moduli, non limitato al solo modulo base `arco`

## 6. Mappa `ArCo module -> ontologie catalogate riusate`

Questa mappa sintetizza i riusi osservati attraverso `owl:imports`, `rdfs:subClassOf`, `rdfs:domain`, `rdfs:range`, `rdfs:subPropertyOf`.

| Modulo ArCo | Ontologie catalogate riusate | Evidenza principale |
| --- | --- | --- |
| `archive` | `CIS` | classi sottoclassi di `cis:CulturalEntity` e `cis:CollectionCulEnt` |
| `arco` | `CIS`, `l0`, `TI` | sottoclassi; proprieta' sotto `l0:identifier`; domini/range su `l0:Agent`, `TI:TimeInterval`, `cis:SubjectDiscipline` |
| `arco-lite` | `CIS`, `l0`, `CLV`, `TI` | molte proprieta' con domini/range verso `cis:CulturalEntity`, `cis:CollectionCulEnt`, `l0:Agent`, `CLV:Address`, `CLV:City`, `TI:TimeInterval` |
| `catalogue` | `l0` | sottoclassi e proprieta' con domini/range su classi `l0` |
| `cataloguing-campaign` | `TI` | sottoclassi di `TI:TimeIndexedEvent`; proprieta' collegate a `TI` |
| `construction-description` | `l0` | sottoclassi e alcune proprieta' collegate a classi `l0` |
| `context-description` | `CIS`, `l0`, `RO` | numerose sottoclassi; molte proprieta' con domini/range su `l0` e `CIS`; ruoli su `RO` |
| `core` | `l0` | sottoclassi e proprieta' collegate a concetti e strutture di base `l0` |
| `cultural-event` | `CIS`, `TI`, `MU`, `l0` | sottoclassi di `cis:CulturalEvent`; tempo e unita' di misura su `TI` e `MU` |
| `denotative-description` | `l0` | sottoclassi e proprieta' su descrizioni, collezioni e caratteristiche `l0` |
| `immovable-property` | `l0` | sottoclassi e alcune proprieta' collegate a `l0` |
| `location` | `CLV`, `l0` | sottoclassi e molte proprieta' con domini/range spaziali e descrittivi |
| `movable-property` | `l0` | sottoclassi e proprieta' con domini/range su classi `l0` |
| `natural-specimen-description` | `l0` | sottoclassi e proprieta' analoghe a `movable-property` |

Conclusione:

- i moduli ArCo riusano soprattutto `l0`
- `CIS` e' il ponte principale verso il dominio culturale condiviso
- `CLV`, `TI`, `RO` e `MU` compaiono nei moduli specialistici dove servono spazio, tempo, ruoli e misure

## 7. Analisi delle proprieta' (`rdfs:subPropertyOf`, `rdfs:domain`, `rdfs:range`)

La verifica sulle proprieta' mostra che il riuso e' ancora piu' intenso di quanto emerga dalle sole classi.

### Conteggi per modulo

| Modulo ArCo | `rdfs:subPropertyOf` | `rdfs:domain` | `rdfs:range` |
| --- | ---: | ---: | ---: |
| `arco` | 12 | 7 | 5 |
| `arco-lite` | 8 | 53 | 54 |
| `catalogue` | 14 | 17 | 15 |
| `cataloguing-campaign` | 2 | 1 | 1 |
| `construction-description` | 2 | 0 | 0 |
| `context-description` | 40 | 130 | 100 |
| `core` | 2 | 8 | 7 |
| `cultural-event` | 4 | 11 | 10 |
| `denotative-description` | 2 | 18 | 14 |
| `immovable-property` | 2 | 0 | 0 |
| `location` | 15 | 36 | 30 |
| `movable-property` | 11 | 15 | 15 |
| `natural-specimen-description` | 11 | 15 | 15 |

Osservazioni:

- `context-description` e' il modulo con la maggiore densita' di collegamenti sulle proprieta'
- `arco-lite` e' molto rilevante sul piano applicativo, con molti domini e range agganciati a ontologie catalogate
- `location` mostra un riuso consistente di `CLV`

### Esempi di `rdfs:subPropertyOf`

- `arco:HSNumber` -> `l0:identifier`
- `arco:RVERidentifier` -> `l0:identifier`
- `arco:catalogueNumber` -> `l0:identifier`
- `arco:startTime` -> `TI:time`
- `arco:endTime` -> `TI:time`
- `arco-lite:HSNumber` -> `l0:identifier`
- `arco-lite:ICCDIdentifier` -> `l0:identifier`

### Esempi di `rdfs:domain`

- `arco:startTime` ha dominio `TI:TimeInterval`
- `arco:endTime` ha dominio `TI:TimeInterval`
- `arco:isCataloguingAgencyOf` ha dominio `l0:Agent`
- `arco:isMainDisciplineOf` ha dominio `cis:SubjectDiscipline`
- `arco-lite:culturalPropertyValue` ha dominio `cis:CulturalEntity`
- `arco-lite:hasCollectionMember` ha dominio `cis:CollectionCulEnt`
- `arco-lite:hasCulturalPropertyAddress` ha dominio `cis:CulturalEntity`

### Esempi di `rdfs:range`

- `arco:hasCataloguingAgency` ha range `l0:Agent`
- `arco:hasHeritageProtectionAgency` ha range `l0:Agent`
- `arco:hasMainDiscipline` ha range `cis:SubjectDiscipline`
- `arco-lite:hasAuthor` ha range `l0:Agent`
- `arco-lite:hasCity` ha range `CLV:City`
- `arco-lite:hasCulturalPropertyAddress` ha range `CLV:Address`
- `arco-lite:hasRealizationDate` ha range `TI:TimeInterval`

Conclusione:

- il riuso di ontologie catalogate e' strutturale e capillare sulle proprieta'
- se si guarda solo alle classi, si sottostima il grado reale di interoperabilita'

## 8. Allineamenti espliciti

Ho cercato:

- `owl:equivalentClass`
- `owl:equivalentProperty`
- `owl:sameAs`
- `skos:exactMatch`

Esito:

- e' emerso un solo allineamento esplicito diretto tra ArCo e OntoPiA

Dettaglio:

- `https://w3id.org/arco/ontology/core/Concept` `owl:equivalentClass` `https://w3id.org/italia/onto/l0/Concept`

Non sono emersi, nelle query eseguite:

- `owl:equivalentProperty` tra ArCo e OntoPiA/CIS
- `owl:sameAs` tra risorse ontologiche ArCo e OntoPiA/CIS
- `skos:exactMatch` tra risorse ontologiche ArCo e OntoPiA/CIS

Conclusione:

- l'integrazione e' forte ma avviene soprattutto per riuso strutturale
- gli allineamenti espliciti formali sono molto rari, almeno nei namespace verificati

## Sintesi finale

Il quadro complessivo e' questo:

- non c'e' un collegamento esplicito nel catalogo `schema.gov.it` verso l'endpoint SPARQL Cultura
- l'endpoint Cultura usa un modello ibrido basato su:
  - ArCo
  - OntoPiA
  - `CIS`
- `CIS` e le ontologie OntoPiA usate sono catalogate in `schema.gov.it`
- i moduli ArCo non risultano catalogati come ontologie nel catalogo interrogato
- nonostante questo, ArCo e' connesso in modo forte e formale a ontologie catalogate tramite:
  - `owl:imports` indiretti via `CIS`
  - `rdfs:subClassOf`
  - `rdfs:subPropertyOf`
  - `rdfs:domain`
  - `rdfs:range`
- l'integrazione piu' intensa e' con:
  - `l0`
  - `CIS`
  - `CLV`
  - `TI`
  - `RO`
  - `MU`
- l'unico allineamento esplicito diretto emerso e':
  - `arco-core:Concept` equivalente a `l0:Concept`

In pratica:

- il collegamento tra endpoint Cultura e `schema.gov.it` e' reale e profondo sul piano semantico
- non e' invece espresso come collegamento catalografico diretto

## Limiti dell'analisi

- una query aggregata completa per derivare tutti i namespace usati dall'endpoint Cultura e' andata in timeout
- per evitare timeout, l'analisi e' stata spezzata in query mirate su classi, proprieta' e allineamenti
- i risultati coprono i moduli e le relazioni principali, ma non costituiscono un inventario assoluto di ogni tripla ontologica disponibile

## Passi suggeriti successivi

Se vuoi estendere ancora il lavoro, i passi piu' utili sono:

1. produrre un allegato tabellare esaustivo con tutte le triple `module/property/relation/target` per ogni modulo ArCo
2. verificare anche eventuali `owl:imports` dei moduli ArCo versionati (`.../1.2`, `.../0.2`) verso OntoPiA, non solo dei namespace base
3. confrontare questa mappa con un secondo endpoint culturale o con il solo corpus ontologico ArCo, per distinguere meglio tra "ontologia definita" e "ontologia effettivamente usata nei dati"

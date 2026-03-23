# Piano di upgrade MCP schema.gov.it

Basato su: `feedback_upgrade_mcp_schema_gov_it.md`
Ultimo aggiornamento: 2026-03-10 (Fase 1 completata)

## Legenda stato
- `[ ]` da fare
- `[~]` in corso
- `[x]` completato
- `[-]` sospeso / rimandato

---

## Fase 1 — Alto impatto, basso costo

### 1.1 Error handling SPARQL migliorato (feedback #7)
**Effort: Basso | File: `src/index.ts` → `executeSparql()`**

- [x] Distinguere AbortError (timeout) da errori HTTP
- [x] Parsare body della risposta di errore del SPARQL endpoint
- [x] Restituire messaggi diagnostici: timeout / HTTP 500 / prefissi non risolti / query troppo complessa
- [x] Nuova funzione `buildSparqlDiagnosticMessage()` con pattern matching su body di errore

### 1.2 `resolve_territorial_uri` — Resolver codici territoriali (feedback #3)
**Effort: Medio | Nuovo tool, Gruppo I**

- [x] Parametri: `code_type` (istat-comune / istat-provincia / istat-regione / belfiore), `code`, `date?`
- [x] Query SPARQL su CLV per URI canonico + etichetta
- [x] Aggiunta URI correlati (provincia per comuni, regione per province)
- [x] Note su `date` (temporal filtering non ancora implementato, ma segnalato nell'output)

### 1.3 Filtri e ranking in `search_concepts` (feedback #4)
**Effort: Medio | Estensione tool esistente**

- [x] Parametro `resource_type?`: class / property / concept
- [x] Parametro `ontology_filter?`: URI prefix (STRSTARTS filter)
- [x] Parametro `prefer_core?`: boolean — ORDER BY ranking COV/CPV/CLV/l0 first

### 1.4 `list_instances_of_class` — Istanze di una classe (feedback #2)
**Effort: Medio | Nuovo tool, dopo `browse_vocabulary`**

- [x] Parametri: `class_uri`, `limit?` (max 200), `offset?`
- [x] Query SPARQL: istanze con label e URI, con deduplicazione
- [x] Risultato paginato con total count

### 1.5 `find_recommended_scheme_for_property` — Vocabolari per proprietà (feedback #2)
**Effort: Medio | Nuovo tool, dopo `list_instances_of_class`**

- [x] Parametro: `property_uri`
- [x] Step 1: recupera `rdfs:range` della proprietà
- [x] Step 2 (parallelo): cerca ConceptScheme istanziati dal range + conta istanze
- [x] Output: range URI + label + ConceptScheme noti + count istanze + suggerimento actionable

---

## Fase 2 — Da esplorazione a progettazione guidata

### 2.1 `map_json_to_ontology` — Mapping assistito da JSON (feedback #1)
**Effort: Alto | Nuovo tool, Gruppo F**

- [ ] Parametri: `json_sample`, `domain_hint?`, `preferred_ontologies?`
- [ ] Parsing JSON → lista campi
- [ ] Per ogni campo: search_concepts interno + euristica nome
- [ ] Ranking candidati per confidenza (high/medium/low)
- [ ] Output: campo → proprietà candidate, URI, confidenza, gap

### 2.2 `suggest_modeling_pattern` — Pattern di modellazione (feedback #5)
**Effort: Medio | Nuovo tool, Gruppo F**

- [ ] Parametri: `pattern_name` (da lista o libero)
- [ ] Knowledge base interna di pattern (organizzazione-territorio, progetto-CUP, ecc.)
- [ ] Verifica esistenza URI via SPARQL al momento dell'esecuzione
- [ ] Output: classi, proprietà, JSON-LD esempio, warning

### 2.3 Profili di dominio opzionali (feedback #10)
**Effort: Basso | Estensione parametri tool esistenti**

- [ ] Definire tabella profili → ontologie preferite
- [ ] Aggiungere `domain_profile?` a `search_concepts`, `list_ontologies`, `explore_ontology`
- [ ] Profili: public-administration / territorial / open-data / projects-funding / administrative-acts

---

## Fase 3 — Qualità del risultato

### 3.1 `validate_jsonld_profile` — Validazione leggera JSON-LD (feedback #6)
**Effort: Alto | Nuovo tool, Gruppo L**

- [ ] Parametro: `jsonld_fragment`
- [ ] Parsing JSON-LD (oxigraph già disponibile)
- [ ] Per ogni tripla: verifica dominio/range via SPARQL
- [ ] Output: errori, warning, suggerimenti alternativi

### 3.2 Indicatori di maturità di riuso (feedback #8)
**Effort: Medio | Estensione `inspect_concept`**

- [ ] Aggiungere a `inspect_concept`: versionInfo, owl:deprecated, conteggio istanze, n. ontologie che usano la risorsa
- [ ] Opzionale: nuovo tool `get_reuse_maturity`

---

## Fase 4 — Integrazioni esterne

### 4.1 Resolver IPA (feedback #9)
**Effort: Alto | Dipendenze esterne**

- [-] `resolve_ipa_code`: API IPA o mirror locale
- [ ] Valutare disponibilità e stabilità API

### 4.2 Resolver OpenCUP (feedback #9)
**Effort: Alto | Dipendenze esterne**

- [-] `resolve_cup_code`: API OpenCUP
- [ ] Valutare disponibilità e stabilità API

---

## Tracciamento tool count

| Stato | Count |
|---|---|
| Tool attuali | 33 |
| Nuovi tool Fase 1 | +3 completati: `resolve_territorial_uri`, `list_instances_of_class`, `find_recommended_scheme_for_property` |
| Nuovi tool Fase 2 | +2 (`map_json_to_ontology`, `suggest_modeling_pattern`) |
| Nuovi tool Fase 3 | +1 (`validate_jsonld_profile`) |
| **Totale previsto** | **~38-39** |

---

## Fase 5 — Consolidamento tool, documentazione e semantica locale/remota (2026-03-23)

_Review completa dei 43 tool attuali (Gruppi A–M). Problemi principali rilevati: coppie di tool quasi identici senza decision tree esplicito, documentazione non sempre allineata tra README e descrizioni MCP, Group G eterogeneo, mancanza di `lang` param e soprattutto duplicazione di logica tra ramo remoto (`schema.gov.it`) e ramo locale/uploaded._

_Nota architetturale: l'obiettivo per il flusso "ontologia locale" non deve essere solo "avere tool separati", ma permettere analisi il più possibile coerenti con quelle del catalogo remoto, fino a lavorare in modalità `hybrid` dove sensato._

### 5.1 Documentation audit e decision matrix
**Effort: Basso | Rischio: Zero | Priorità: Alta**

Problema osservato: oggi alcuni agenti vanno in confusione non perché i tool manchino, ma perché non è chiaro quale sia il tool "giusto" in presenza di alternative molto simili.

- [x] Allineare README, descrizioni MCP e casi d'uso esempio: ogni tool "sensibile" deve avere la stessa regola decisionale in tutti e tre i posti
- [x] Aggiungere blocco `**Quando usare questo vs X:**` alle 7 coppie/superfici sovrapposte:
  - `inspect_concept` ↔ `inspect_local_concept`
  - `get_property_details` ↔ `inspect_local_property`
  - `query_sparql` ↔ `query_local_ontology`
  - `query_sparql` ↔ `query_external_endpoint`
  - `query_local_ontology` ↔ `query_uploaded_store`
  - `search_concepts` ↔ `search_in_vocabulary`
  - `describe_resource` ↔ `inspect_concept`
- [x] Aggiungere blocco `**Non usare questo se:**` ai tool più abusati (`query_sparql`, `query_local_ontology`, `query_external_endpoint`)
- [x] Aggiungere a `inspect_concept`, `get_property_details`, `inspect_local_concept`, `inspect_local_property`: _"Usa `search_concepts` prima se non conosci l'URI"_
- [x] Rafforzare `query_sparql`: _"Usa solo se nessun tool specializzato copre la query"_ e aggiungere 3 esempi negativi ("non usarlo per ... usa ...")
- [x] Correggere descrizione `explore_catalog`: chiarire che restituisce DUE liste (named graphs + ontologie) e che `list_ontologies`/`list_vocabularies` sono viste più ricche
- [x] Chiarire `check_coverage` modalità duale: senza `targetUri` = "heatmap catalogo", con `targetUri` = "analisi copertura URI"
- [x] Aggiungere blocco decisionale input-mode a tutti i tool Group K:
  ```
  **Quale modalità di input usare:**
  - stdio / stessa macchina → file_path
  - server remoto, file grande → get_upload_instructions + upload_id
  - server remoto, file piccolo (<1 MB) → content + format
  ```
- [x] Aggiungere in README una tabella "Se vuoi fare X, usa Y" per le superfici più ambigue

### 5.2 Consolidamento della superficie dei tool
**Effort: Basso | Rischio: Basso | Priorità: Alta**

- [ ] Spostare `resolve_territorial_uri` da Group G a Group I (dove stanno `list_municipalities`, `list_provinces`, `list_identifiers`)
- [ ] Spostare `browse_vocabulary` da Group G a Group D (con `list_vocabularies`, `search_in_vocabulary`)
- [ ] Unire Group L in Group K — tutti sono tool "local/uploaded ontology"
- [ ] Deprecare `query_uploaded_store`: è un doppione quasi puro di `query_local_ontology` con `upload_id`
- [ ] Lasciare `query_uploaded_store` come alias di compatibilità per una release, ma rimuoverlo dalla documentazione principale e dagli esempi consigliati
- [ ] Rinominare Group G in "Properties & Instances" dopo i trasferimenti

### 5.3 Unificazione del motore semantico locale/remoto
**Effort: Medio | Impatto: Alto | Priorità: Alta**

Problema osservato: `inspect_concept`/`inspect_local_concept` e `get_property_details`/`inspect_local_property` duplicano query e logica, con rischio di drift funzionale e differenze di performance/comportamento.

- [ ] Estrarre moduli condivisi per costruzione query e post-processing:
  - profile concetto (`definition`, `hierarchy`, `usage`, `own_properties`, `inherited_properties`, `incoming`, `outgoing`)
  - profile proprietà (`definition`, `assertedDomain`, `assertedRange`, `superproperties`, `effectiveDomain`, `effectiveRange`, `redundancy_analysis`)
- [ ] Introdurre un adapter/runner astratto (`execute query`, `compress result`) riusabile da backend remoto e locale
- [ ] Fare in modo che il ramo locale erediti gli stessi miglioramenti del ramo remoto senza copiare query in due file
- [ ] Uniformare anche il comportamento prestazionale: dove oggi il remoto parallelizza e il locale no, portare i due rami a una strategia coerente

### 5.4 Modalità `source` / `hybrid` sui tool core
**Effort: Alto | Impatto: Alto | Priorità: Alta**

Obiettivo: l'ontologia locale deve poter essere analizzata "come se" fosse già dentro `schema.gov.it`, almeno nei tool specializzati dove ciò è tecnicamente sostenibile.

- [ ] Disegnare un contesto comune per i tool core:
  - `source: "schema" | "local" | "hybrid"`
  - `file_path?`, `upload_id?`, `content?` dove rilevante
- [ ] Portare progressivamente `inspect_concept`, `get_property_details`, `query_sparql` verso un'interfaccia context-aware, mantenendo i tool legacy come alias compatibili nel breve periodo
- [ ] Implementare `hybrid` almeno per i tool specializzati su concetti e proprietà:
  - base = store locale/uploaded
  - arricchimento/fallback = `schema.gov.it` per import, super-classi, super-proprietà, label e range mancanti
- [ ] Esplicitare nel piano che `query_sparql` ibrido raw non va promesso finché non esiste davvero un grafo unificato o una risoluzione affidabile degli `owl:imports`
- [ ] Valutare una modalità `with_imports` in `resolveLocalStore` per caricare/cache delle ontologie importate quando reperibili

### 5.5 Deprecazione `search_in_vocabulary`
**Effort: Basso | Net: -1 tool primario**

`browse_vocabulary` già supporta `keyword` (filtro testuale) + paginazione. `search_in_vocabulary` è un sottoinsieme.
- [ ] Aggiungere alla descrizione di `search_in_vocabulary`: _"Deprecated. Usa `browse_vocabulary` con il parametro `keyword`."_
- [ ] Tenerlo come alias di compatibilità per una release
- [ ] Rimuoverlo dalla documentazione principale e dagli esempi consigliati

### 5.6 Parametro `lang` sui tool che restituiscono label
**Effort: Medio | Impatto: Alto**

Il catalogo ha etichette `@it` e `@en`; senza filtro linguistico i risultati hanno duplicati.
- [ ] Aggiungere `lang?: "it" | "en" | "any"` (default `"any"`) a: `search_concepts`, `browse_vocabulary`, `search_in_vocabulary`, `inspect_concept`, `list_municipalities`, `list_provinces`
- [ ] Implementare con `FILTER(LANG(?label) = "${lang}" || LANG(?label) = "")` quando `lang != "any"`

### 5.7 `find_relations` — profondità configurabile
**Effort: Medio**

Attualmente limitato a percorsi diretti + 1-hop. Relazioni a 2-3 hop sono frequenti nel catalogo.
- [ ] Aggiungere `max_hops: 1 | 2 | 3` (default 1, backward-compatible)
- [ ] Cap risultati a 20, aggiungere flag `paths_truncated`

### 5.8 `navigate_skos_hierarchy` — navigazione gerarchica SKOS
**Effort: Medio | Nuovo tool in Group D**

Nessun tool dedicato per risalire/scendere `skos:broader`/`skos:narrower`. Attualmente richiede `query_sparql` custom.
- [ ] Parametri: `uri`, `direction: "up"|"down"|"both"`, `depth: 1..5`
- [ ] Output: albero o lista flat con indicatori di profondità
- [ ] Usare `skos:broader+`/`skos:narrower+` con property path SPARQL

### 5.9 Estendere `suggest_improvements`
**Effort: Medio**

Attualmente rileva solo classi inutilizzate e cicli di subClassOf.
- [ ] Aggiungere: proprietà senza dominio o range
- [ ] Aggiungere: classi con >1000 istanze ma senza skos:ConceptScheme (possibili vocabolari non modellati correttamente)

---

### Riepilogo impatto Fase 5

| Item | Tool Δ | Effort | Priorità |
|------|--------|--------|----------|
| 5.1 Documentation audit + decision matrix | 0 | ~4h | **Alta** |
| 5.2 Consolidamento superficie tool | -1 | ~3h | **Alta** |
| 5.3 Unificazione motore semantico | 0 | ~1-2 gg | **Alta** |
| 5.4 Modalità `source` / `hybrid` | 0 | ~1-2 gg | **Alta** |
| 5.5 Deprecazione `search_in_vocabulary` | -1 | 30m | **Media** |
| 5.6 Parametro `lang` | 0 | ~3h | **Media** |
| 5.7 `find_relations` max_hops | 0 | ~2h | **Media** |
| 5.8 `navigate_skos_hierarchy` | +1 | ~3h | Bassa |
| 5.9 Estendere `suggest_improvements` | 0 | ~2h | Bassa |

**Target dopo Fase 5:** superficie primaria più coerente e ridotta: **41 tool primari** + eventuali alias deprecated temporanei per compatibilità. Obiettivo non solo "meno tool", ma meno ambiguità per l'agente e semantica locale/remota più uniforme.

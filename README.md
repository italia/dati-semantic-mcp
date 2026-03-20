[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/mfortini/schema-gov-it-mcp)
[![Docker](https://github.com/italia/dati-semantic-mcp/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/italia/dati-semantic-mcp/actions/workflows/docker-publish.yml)
[![ghcr.io](https://img.shields.io/badge/ghcr.io-italia%2Fdati--semantic--mcp-blue?logo=docker)](https://ghcr.io/italia/dati-semantic-mcp)

# Schema.gov.it MCP Server

Un server MCP (Model Context Protocol) avanzato per interagire semanticamente con il catalogo dati di [schema.gov.it](https://schema.gov.it).

Questo server permette agli agenti AI (come Claude Code) di esplorare ontologie, analizzare la copertura dei dati, verificare la qualità e scoprire connessioni tra concetti in modo intelligente.

## Strumenti disponibili

Il server espone **44 strumenti** organizzati in 13 categorie:

### 1. Operazioni Base
*   `query_sparql`: Esegue una query SPARQL raw contro l'endpoint. Utile per esplorazione ad-hoc.
*   `explore_catalog`: Elenca i grafi e le ontologie disponibili nell'endpoint.
*   `explore_classes`: Elenca le classi disponibili con conteggio istanze, con filtro opzionale.

### 2. Analytics Semantiche
*   `check_coverage`: Analizza la copertura di una specifica classe/proprietà, o statistiche globali.
*   `check_quality`: Trova problemi di qualità (label o descrizioni mancanti).
*   `check_overlaps`: Identifica sovrapposizioni (stesse label) o mapping espliciti.

### 3. Modello Dati (Ontologie)
*   `list_ontologies`: Elenca le ontologie disponibili (es. Città, Servizi Pubblici).
*   `explore_ontology`: Mostra Classi e Proprietà definite in una specifica ontologia.

### 4. Vocabolari Controllati (Reference Data)
*   `list_vocabularies`: Elenca i vocabolari controllati disponibili (ConceptScheme) con conteggio istanze.
*   `search_in_vocabulary`: Cerca concetti all'interno di un vocabolario specifico.
*   `browse_vocabulary`: Naviga un vocabolario con paginazione (utile per vocabolari grandi come codici ICD, comuni).

### 5. Cataloghi e Dataset (Dati)
*   `list_datasets`: Elenca i dataset DCAT-AP_IT disponibili.
*   `explore_dataset`: Mostra dettagli e distribuzioni di un dataset.
*   `preview_distribution`: Scarica e mostra le prime righe di una distribuzione CSV/JSON.

Nota: questi tool restano utili, ma su `schema.gov.it` sono spesso secondari. Il catalogo contiene soprattutto asset semantici pubblicati come dataset DCAT-AP_IT, ad esempio ontologie, vocabolari controllati e relative distribuzioni. Per esplorare `schema.gov.it` conviene di norma partire da ontologie, vocabolari, classi, proprietà e query SPARQL; i tool dataset sono più indicati per cataloghi esterni o per casi DCAT-AP_IT specifici.

### 6. Intelligence (Avanzato)
*   `search_concepts`: **Ricerca fuzzy**. Trova concetti (es. "Scuola") senza conoscere l'URI esatto.
*   `inspect_concept`: **Deep Dive**. Ottiene in un colpo solo definizione, gerarchia, usage stats e vicini di un concetto.
*   `find_relations`: **Pathfinding**. Scopre come due concetti sono collegati (link diretto o via 1 intermediario).
*   `suggest_improvements`: Euristiche per trovare anomalie strutturali nell'ontologia (classi orfane, cicli).
*   `describe_resource`: **CBD**. Ottiene tutte le triple di una risorsa (Concise Bounded Description).

### 7. Proprieta e Relazioni
*   `list_properties`: Elenca ObjectProperty e DatatypeProperty con dominio e range.
*   `get_property_details`: Ottiene dettagli completi di una proprietà (dominio, range, inverse, functional).
*   `list_instances_of_class`: Elenca le istanze di una classe presente nel catalogo.
*   `find_recommended_scheme_for_property`: Suggerisce il ConceptScheme più adatto per i valori controllati di una proprietà.

### 8. Dati Geografici (Italia)
*   `list_municipalities`: Elenca i comuni italiani con codici ISTAT e Belfiore, con filtro per nome.
*   `list_provinces`: Elenca le province italiane con sigla automobilistica e codice metro.
*   `list_identifiers`: Esplora gli identificatori CLV (Codice Catastale, Sigla Automobilistica, ecc.).
*   `resolve_territorial_uri`: Risolve codici territoriali italiani verso URI canonici del catalogo.

### 9. Endpoint SPARQL Esterni (linked data)
*   `recommend_external_endpoints`: Restituisce una short list curata di endpoint SPARQL pubblici utili da usare insieme a `schema.gov.it`.
*   `list_linked_endpoints`: Scopre gli endpoint SPARQL collegati al catalogo via `dcat:DataService`.
*   `query_external_endpoint`: Esegue una query SPARQL su qualsiasi endpoint HTTPS pubblico, con compressione del risultato per ridurre i token.
*   `find_external_alignments`: Trova i mapping verso risorse esterne (Eurostat, DBpedia, ecc.).
*   `explore_external_endpoint`: Esplora la struttura di un endpoint esterno (classi e conteggi).

### 10. Ontologia Locale
*   `inspect_local_ontology`: Carica e riassume un'ontologia RDF/OWL disponibile al server via `file_path`, contenuto inline o `upload_id`. Attenzione: `file_path` indica sempre un path leggibile dal server MCP, non dal laptop dell'utente.
*   `inspect_local_concept`: **Deep dive su una classe** (locale o caricata). Parametro `mode`: `raw` (solo triple esplicite: definition, hierarchy, usage, own_properties) oppure `effective` (default, aggiunge inherited_properties via `rdfs:subClassOf+`/`skos:broader+` e incoming/outgoing). Distingue chiaramente proprietà con dominio asserted su questa classe da quelle ereditate dalle superclassi. Limite: traversa solo le superclassi presenti nel file locale; per le proprietà con super-proprietà esterne usa `inspect_local_property`.
*   `inspect_local_property`: **Deep dive su una proprietà** (locale o caricata). Espone separatamente: `assertedDomain`/`assertedRange` (dichiarati nel file), `inheritedDomain`/`inheritedRange` (da super-proprietà via `rdfs:subPropertyOf+`, con indicazione dell'antenato), `effectiveDomain`/`effectiveRange` (unione). Per super-proprietà non presenti nel file locale (es. l0:name, l0:description da ontologie importate), interroga automaticamente schema.gov.it come fallback. Ogni super-proprietà è marcata con source `local` | `remote` | `not-found`. Include nota sul limite Unicode nei nomi locali SPARQL con oxigraph.
*   `query_local_ontology`: Esegue una query SPARQL SELECT su un'ontologia accessibile dal server o caricata prima via `POST /upload`. Prefissi standard iniettati automaticamente. Risultati compressi come gli altri tool.
*   `compare_local_with_remote`: Confronta le classi/proprietà definite in un'ontologia accessibile dal server o via `upload_id` con quelle presenti in schema.gov.it — utile per scoprire cosa riusare o allineare.

### 11. Workflow Upload HTTP
*   `query_uploaded_store`: Esegue query SPARQL SELECT su uno store temporaneo creato via `POST /upload`. In modalità HTTP/remota è spesso il flusso corretto quando il file sta sulla macchina client e non sul filesystem del server.

### 12. Meta-Ottimizzazione
*   `suggest_new_tools`: Analizza i log delle query RAW e suggerisce nuovi tool specializzati in base all'utilizzo reale.
*   `analyze_usage`: Analizza i log interni per identificare pattern, errori e query frequenti.

### 13. Open Knowledge Graphs (OKG)

Integrazione con [api.openknowledgegraphs.com](https://api.openknowledgegraphs.com) — catalogo di oltre 1.800 ontologie, vocabolari, tassonomie e strumenti semantici con metadati da Wikidata. Tutti i dati sono CC0, nessuna autenticazione richiesta.

*   `list_okg_categories`: Recupera a runtime le categorie tematiche disponibili nel catalogo OKG (le categorie sono scaricate dinamicamente da `api.openknowledgegraphs.com` e messe in cache).
*   `search_okg_resources`: Cerca ontologie, vocabolari e tassonomie nel catalogo OKG per parola chiave e/o categoria tematica.
*   `find_okg_alignments`: Dato un URI di schema.gov.it, trova le risorse OKG correlate: prima cerca allineamenti Wikidata già presenti nel catalogo (owl:sameAs, skos:exactMatch), poi usa il Wikidata ID come ponte verso OKG per identificare corrispondenze internazionali confermate.
*   `find_semantic_software`: Cerca strumenti software semantici nel catalogo OKG (editor di ontologie, motori SPARQL, convertitori RDF, reasoner, ecc.).
*   `compare_coverage_with_okg`: Gap analysis per dominio: confronta le risorse di schema.gov.it con il catalogo OKG internazionale, classificando le risorse come "coperte" (già collegate via Wikidata) o "gap" (non ancora presenti in schema.gov.it).

---

## Installazione & Uso

### 1. Tramite Docker (Consigliato per uso remoto/condiviso)

Il server può essere eseguito come container Docker con trasporto HTTP/SSE, rendendolo accessibile via URL da qualsiasi client MCP.

#### Avvio rapido con Docker Compose (immagine remota da GHCR)

```bash
docker compose up -d mcp
```

Per default, questo usa l'immagine pubblicata su `ghcr.io/italia/dati-semantic-mcp:latest` e la aggiorna automaticamente prima dell'avvio.

Il server sarà disponibile su `http://localhost:3000/mcp`. I log vengono salvati nella cartella `./logs/`.

#### Build locale esplicita con Docker Compose

Se vuoi costruire l'immagine dal checkout locale invece di usare quella remota:

```bash
docker compose -f docker-compose.build.yaml up -d mcp
```

#### Avvio con Docker

```bash
docker run -d \
  --name schema-gov-it-mcp \
  -p 3000:3000 \
  -e MCP_TRANSPORT=sse \
  -v ./logs:/app/logs \
  ghcr.io/italia/dati-semantic-mcp:latest
```

#### Verifica

```bash
curl http://localhost:3000/health
# {"status":"ok","service":"schema-gov-it-mcp","sessions":0}
```

### 2. Tramite NPX (Senza installazione permanente)
```bash
npx schema-gov-it-mcp
```

### 3. Installazione da GitHub (Senza NPM Registry)
Puoi installare globalmente direttamente dal repository:

```bash
npm install -g git+https://github.com/italia/dati-semantic-mcp.git
```
Poi usa `schema-gov-it-mcp` come comando.

### 4. Installazione Locale (Sviluppo)
```bash
git clone https://github.com/italia/dati-semantic-mcp.git
cd dati-semantic-mcp
npm install
npm run build   # Automatico via prepare, ma puoi lanciarlo manualmente
node dist/index.js
```

---

## Configurazione Client MCP

### Modalità stdio (processo locale)

Adatta per uso personale: il client lancia il server come processo figlio.

#### Claude Code

```bash
claude mcp add schema-gov-it -- npx -y github:italia/dati-semantic-mcp
```

Oppure aggiungi manualmente a `~/.claude.json`:

```json
{
  "mcpServers": {
    "schema-gov-it": {
      "command": "npx",
      "args": ["-y", "github:italia/dati-semantic-mcp"]
    }
  }
}
```

#### VS Code / Cursor

In `.vscode/mcp.json`:

```json
{
  "servers": {
    "schema-gov-it": {
      "command": "npx",
      "args": ["-y", "github:italia/dati-semantic-mcp"]
    }
  }
}
```

### Modalità HTTP/SSE (server remoto o Docker)

Adatta per ambienti condivisi, CI/CD o deployment remoto. Il server deve essere già in esecuzione (es. via Docker Compose).

Importante: in questa modalità `file_path` si riferisce al filesystem del server/container. Se il file RDF sta sul computer del client, il flusso corretto è `POST /upload` e poi uso di `upload_id`.

#### Claude Code

```bash
claude mcp add --transport http schema-gov-it http://localhost:3000/mcp
```

Oppure aggiungi manualmente a `~/.claude.json`:

```json
{
  "mcpServers": {
    "schema-gov-it": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

#### VS Code / Cursor

In `.vscode/mcp.json`:

```json
{
  "servers": {
    "schema-gov-it": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

#### Upload di un file locale verso un server remoto

Quando il server gira altrove e non può leggere il file locale del client, evita di provare percorsi diversi. Carica il file una volta e riusa l'`id` restituito.

Questo punto è importante anche per i costi e l'affidabilità: non usare la conversazione con il modello come canale di trasporto del file, e non incollare ontologie grandi nel prompt. Il file va inviato dal client con un tool locale che spedisca i byte direttamente al server, per esempio `curl`, `nc` o un helper equivalente del client MCP.

Con `curl`:

```bash
curl -X POST \
  -H "Content-Type: text/turtle" \
  --data-binary @./mia-ontologia.ttl \
  http://localhost:3000/upload
```

Risposta tipica:

```json
{"id":"9d7...","tripleCount":1234,"format":"text/turtle","endpoint":"/sparql/9d7..."}
```

Poi usa quell'`id` come `upload_id` con `inspect_local_ontology`, `query_local_ontology` o `compare_local_with_remote`, oppure interroga direttamente lo store:

```bash
curl --get \
  --data-urlencode 'query=SELECT ?c WHERE { ?c a <http://www.w3.org/2002/07/owl#Class> } LIMIT 10' \
  http://localhost:3000/sparql/9d7...
```

Con `nc`:

```bash
{ printf 'POST /upload HTTP/1.1\r\nHost: localhost:3000\r\nContent-Type: text/turtle\r\nContent-Length: %s\r\n\r\n' "$(wc -c < ./mia-ontologia.ttl)"; cat ./mia-ontologia.ttl; } | nc localhost 3000
```

---

## Esempi di Utilizzo

Una volta configurato, puoi chiedere all'agente cose come:

*   *"Cerca concetti relativi alla 'Sanità' e dimmi quali sono le classi principali."* (Userà `search_concepts`)
*   *"Analizza la classe Persona e dimmi con chi è collegata."* (Userà `inspect_concept`)
*   *"Controlla se ci sono sovrapposizioni tra i concetti di Luogo."* (Userà `check_overlaps`)
*   *"Come posso ottimizzare le mie query?"* (Userà `analyze_usage` sui log)
*   *"Elenca le ontologie disponibili e mostrami le classi di quella sui Servizi Pubblici."* (Userà `list_ontologies` + `explore_ontology`)
*   *"Trova i comuni della Lombardia e il loro codice Belfiore."* (Userà `list_municipalities`)
*   *"Consigliami alcuni endpoint SPARQL esterni da interrogare dopo schema.gov.it."* (Userà `recommend_external_endpoints`)
*   *"Esegui una query SPARQL su DBpedia per trovare le città italiane."* (Userà `query_external_endpoint`)
*   *"Dammi una panoramica dell'ontologia in `/srv/ontologie/mia-ontologia.ttl`."* (Userà `inspect_local_ontology` con `file_path`, se il file è davvero leggibile dal server)
*   *"Ho un server MCP remoto e un file TTL sul mio laptop: caricalo via `POST /upload` e poi confronta le classi con schema.gov.it."* (Userà `upload_id` + `compare_local_with_remote`)
*   *"Trova tutte le classi senza rdfs:label nel file che ho appena caricato via upload."* (Userà `query_local_ontology` con `upload_id`)
*   *"Esistono vocabolari internazionali nel settore pubblico che potremmo allineare a schema.gov.it?"* (Userà `search_okg_resources`)
*   *"La classe Person di CPV ha equivalenti riconosciuti a livello internazionale?"* (Userà `find_okg_alignments`)
*   *"Quali tool open source posso usare per lavorare con SKOS e OWL?"* (Userà `find_semantic_software`)
*   *"Cosa manca a schema.gov.it rispetto agli standard semantici internazionali del settore pubblico?"* (Userà `compare_coverage_with_okg`)

## Variabili d'Ambiente

| Variabile | Default | Descrizione |
|---|---|---|
| `MCP_TRANSPORT` | `stdio` | Modalità di trasporto. Usa `http` o `sse` per avviare il server HTTP (obbligatorio per l'upload e per l'uso remoto). |
| `PORT` | `3000` | Porta su cui il server HTTP si mette in ascolto (solo in modalità `http`/`sse`). |
| `HOST` | `0.0.0.0` | Indirizzo di bind del server HTTP. Usa `127.0.0.1` per limitare l'accesso al solo localhost. |
| `MCP_PUBLIC_URL` | _(non impostato)_ | URL esterno del server, usato dal tool `get_upload_instructions` per restituire l'endpoint di upload raggiungibile dal client. Necessario quando la porta interna differisce da quella esposta (Docker, reverse proxy). Esempio: `http://localhost:8080`. |

**Esempi:**

```bash
# Avvio locale su porta 3000 con upload abilitato
MCP_TRANSPORT=http node dist/index.js

# Porta personalizzata
MCP_TRANSPORT=http PORT=8080 node dist/index.js

# Docker con port mapping 8080→3000 (porta interna 3000, esposta 8080)
docker run -d \
  -e MCP_TRANSPORT=http \
  -e MCP_PUBLIC_URL=http://localhost:8080 \
  -p 8080:3000 \
  ghcr.io/italia/dati-semantic-mcp:latest
```

> **Nota upload:** La porta HTTP (e di conseguenza `/upload`) è disponibile **solo** in modalità `http` o `sse`. In modalità `stdio` il server non espone nessuna porta; per passare file RDF usa il parametro `content` di `inspect_local_ontology` per file piccoli, oppure attiva la modalità HTTP.

---

## Note Tecniche

*   **Endpoint Esterni**: Usa `recommend_external_endpoints` per una lista curata (es. `lod.dati.gov.it` come possibile server SPARQL per `dati.gov.it`, `dati.cultura.gov.it`, endpoint istituzionali italiani, endpoint europei e knowledge graph pubblici) e `list_linked_endpoints` per scoprire quelli pubblicati nel catalogo via metadata DCAT.
*   **Riduzione Token per Query Esterne**: `query_external_endpoint` restituisce risultati compressi: conserva solo i valori utili, usa un formato tabellare compatto per result set più grandi e tronca risposte eccessive. Non aggiunge automaticamente `LIMIT`, quindi per query esterne conviene specificarlo sempre.
*   **Compatibilità Endpoint Esterni**: Per migliorare l'interoperabilità con endpoint protetti da proxy o filtri anti-bot, le query SPARQL verso server esterni vengono inviate con header HTTP più simili a quelli di un browser standard. Se un endpoint esterno rifiuta il `POST` con `403`, il server riprova automaticamente in `GET`.
*   **Prefixes Automatici**: Non serve definire `rdf:`, `owl:`, `skos:`, ecc. nelle query interne. Il server li aggiunge automaticamente. Per gli endpoint esterni i prefissi non vengono iniettati di default.
*   **Compressione Token**: Le liste lunghe (> 5 item) vengono restituite in formato tabellare compatto per risparmiare token.
*   **Input Sanitizzati**: Tutti i parametri utente sono sanitizzati per prevenire SPARQL injection.
*   **Ontologia Locale**: I tool del gruppo 10 (`inspect_local_ontology`, `query_local_ontology`, `compare_local_with_remote`) usano [oxigraph](https://github.com/oxigraph/oxigraph) (WASM) per caricare file RDF/OWL in memoria ed eseguire SPARQL. `file_path` funziona solo per file davvero leggibili dal processo server; non trasferisce file dal client. I file vengono cachati dopo il primo caricamento; le query successive sullo stesso file non rileggono il disco. Formati supportati: `.ttl`, `.owl`, `.rdf`, `.nt`, `.jsonld`.
*   **Workflow Upload HTTP**: Il tool del gruppo 11 (`query_uploaded_store`) permette di interrogare via SPARQL uno store temporaneo creato via `POST /upload`, con scadenza automatica dopo un'ora. In modalità HTTP/SSE remota questo è il fallback consigliato quando il file non è accessibile via `file_path`.
*   **Open Knowledge Graphs (OKG)**: I tool del gruppo 13 chiamano `api.openknowledgegraphs.com` (REST JSON, CC0, nessuna autenticazione, timeout 10s). Le categorie tematiche vengono scaricate dinamicamente dalla root dell'API (`GET /`) al primo utilizzo e messe in cache in memoria per la durata della sessione; non è più necessario aggiornarle manualmente nel codice. Il tool `compare_coverage_with_okg` combina una chiamata OKG con una query SPARQL su schema.gov.it usando i Wikidata ID come chiave di collegamento.
*   **Logging**: Tutte le chiamate vengono loggate in `logs/usage_log.jsonl` per analisi e miglioramento continuo. Ogni entry include argomenti, riepilogo, `source_data_metrics` e `ai_data_metrics`: metriche quantitative dei dati ricevuti e del payload finale passato al modello, ad esempio numero di caratteri e, quando rilevabile, righe, colonne o numero di elementi.
*   **Trasporto**: Il server supporta sia `stdio` (default, per uso locale) che HTTP/SSE (via `MCP_TRANSPORT=sse`, per uso remoto/Docker).

## Licenza

MIT - vedi [LICENSE](LICENSE)

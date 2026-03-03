[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/mfortini/schema-gov-it-mcp)
[![Docker](https://github.com/italia/dati-semantic-mcp/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/italia/dati-semantic-mcp/actions/workflows/docker-publish.yml)
[![ghcr.io](https://img.shields.io/badge/ghcr.io-italia%2Fdati--semantic--mcp-blue?logo=docker)](https://ghcr.io/italia/dati-semantic-mcp)

# Schema.gov.it MCP Server

Un server MCP (Model Context Protocol) avanzato per interagire semanticamente con il catalogo dati di [schema.gov.it](https://schema.gov.it).

Questo server permette agli agenti AI (come Claude Code) di esplorare ontologie, analizzare la copertura dei dati, verificare la qualità e scoprire connessioni tra concetti in modo intelligente.

## Strumenti disponibili

Il server espone **31 strumenti** organizzati in 10 categorie:

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
*   `list_properties`: Elenca ObjectProperty e DatatypeProperty con dominio e range.
*   `get_property_details`: Ottiene dettagli completi di una proprietà (dominio, range, inverse, functional).

### 4. Vocabolari Controllati (Reference Data)
*   `list_vocabularies`: Elenca i vocabolari controllati disponibili (ConceptScheme) con conteggio istanze.
*   `search_in_vocabulary`: Cerca concetti all'interno di un vocabolario specifico.
*   `browse_vocabulary`: Naviga un vocabolario con paginazione (utile per vocabolari grandi come codici ICD, comuni).

### 5. Cataloghi e Dataset (Dati)
*   `list_datasets`: Elenca i dataset DCAT-AP_IT disponibili.
*   `explore_dataset`: Mostra dettagli e distribuzioni di un dataset.
*   `preview_distribution`: Scarica e mostra le prime righe di una distribuzione CSV/JSON.

### 6. Intelligence (Avanzato)
*   `search_concepts`: **Ricerca fuzzy**. Trova concetti (es. "Scuola") senza conoscere l'URI esatto.
*   `inspect_concept`: **Deep Dive**. Ottiene in un colpo solo definizione, gerarchia, usage stats e vicini di un concetto.
*   `find_relations`: **Pathfinding**. Scopre come due concetti sono collegati (link diretto o via 1 intermediario).
*   `suggest_improvements`: Euristiche per trovare anomalie strutturali nell'ontologia (classi orfane, cicli).
*   `describe_resource`: **CBD**. Ottiene tutte le triple di una risorsa (Concise Bounded Description).

### 7. Dati Geografici (Italia)
*   `list_municipalities`: Elenca i comuni italiani con codici ISTAT e Belfiore, con filtro per nome.
*   `list_provinces`: Elenca le province italiane con sigla automobilistica e codice metro.
*   `list_identifiers`: Esplora gli identificatori CLV (Codice Catastale, Sigla Automobilistica, ecc.).

### 8. Endpoint SPARQL Esterni
*   `recommend_external_endpoints`: Restituisce una short list curata di endpoint SPARQL pubblici utili da usare insieme a `schema.gov.it`.
*   `list_linked_endpoints`: Scopre gli endpoint SPARQL collegati al catalogo via `dcat:DataService`.
*   `query_external_endpoint`: Esegue una query SPARQL su qualsiasi endpoint HTTPS pubblico, con compressione del risultato per ridurre i token.
*   `find_external_alignments`: Trova i mapping verso risorse esterne (Eurostat, DBpedia, ecc.).
*   `explore_external_endpoint`: Esplora la struttura di un endpoint esterno (classi e conteggi).

### 9. Meta-Ottimizzazione
*   `suggest_new_tools`: Analizza i log delle query RAW e suggerisce nuovi tool specializzati in base all'utilizzo reale.
*   `analyze_usage`: Analizza i log interni per identificare pattern, errori e query frequenti.

---

## Installazione & Uso

### 1. Tramite Docker (Consigliato per uso remoto/condiviso)

Il server può essere eseguito come container Docker con trasporto HTTP/SSE, rendendolo accessibile via URL da qualsiasi client MCP.

#### Avvio rapido con Docker Compose

```bash
docker compose up -d mcp
```

Il server sarà disponibile su `http://localhost:3000/mcp`. I log vengono salvati nella cartella `./logs/`.

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

## Note Tecniche

*   **Endpoint Esterni**: Usa `recommend_external_endpoints` per una lista curata (es. `lod.dati.gov.it` come possibile server SPARQL per `dati.gov.it`, `dati.cultura.gov.it`, endpoint istituzionali italiani, endpoint europei e knowledge graph pubblici) e `list_linked_endpoints` per scoprire quelli pubblicati nel catalogo via metadata DCAT.
*   **Riduzione Token per Query Esterne**: `query_external_endpoint` restituisce risultati compressi: conserva solo i valori utili, usa un formato tabellare compatto per result set più grandi e tronca risposte eccessive. Non aggiunge automaticamente `LIMIT`, quindi per query esterne conviene specificarlo sempre.
*   **Compatibilità Endpoint Esterni**: Per migliorare l'interoperabilità con endpoint protetti da proxy o filtri anti-bot, le query SPARQL verso server esterni vengono inviate con header HTTP più simili a quelli di un browser standard. Se un endpoint esterno rifiuta il `POST` con `403`, il server riprova automaticamente in `GET`.
*   **Prefixes Automatici**: Non serve definire `rdf:`, `owl:`, `skos:`, ecc. nelle query interne. Il server li aggiunge automaticamente. Per gli endpoint esterni i prefissi non vengono iniettati di default.
*   **Compressione Token**: Le liste lunghe (> 5 item) vengono restituite in formato tabellare compatto per risparmiare token.
*   **Input Sanitizzati**: Tutti i parametri utente sono sanitizzati per prevenire SPARQL injection.
*   **Logging**: Tutte le chiamate vengono loggate in `logs/usage_log.jsonl` per analisi e miglioramento continuo.
*   **Trasporto**: Il server supporta sia `stdio` (default, per uso locale) che HTTP/SSE (via `MCP_TRANSPORT=sse`, per uso remoto/Docker).

## Licenza

MIT - vedi [LICENSE](LICENSE)

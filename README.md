# Schema.gov.it MCP Server

Un server MCP (Model Context Protocol) avanzato per interagire semanticamente con il catalogo dati di [schema.gov.it](https://schema.gov.it).

Questo server permette agli agenti AI (come Claude Code) di esplorare ontologie, analizzare la copertura dei dati, verificare la qualità e scoprire connessioni tra concetti in modo intelligente.

## Strumenti disponibili

Il server espone **19 strumenti** organizzati in 5 livelli:

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

### 5. Cataloghi e Dataset (Dati)
*   `list_datasets`: Elenca i dataset DCAT-AP_IT disponibili.
*   `explore_dataset`: Mostra dettagli e distribuzioni di un dataset.
*   `preview_distribution`: Scarica e mostra le prime righe di una distribuzione CSV/JSON.

### 6. Intelligence (Avanzato)
*   `search_concepts`: **Ricerca fuzzy**. Trova concetti (es. "Scuola") senza conoscere l'URI esatto.
*   `inspect_concept`: **Deep Dive**. Ottiene in un colpo solo definizione, gerarchia, usage stats e vicini di un concetto.
*   `find_relations`: **Pathfinding**. Scopre come due concetti sono collegati (link diretto o via 1 intermediario).
*   `suggest_improvements`: Euristiche per trovare anomalie strutturali nell'ontologia (classi orfane, cicli).

### 7. Meta-Ottimizzazione
*   `suggest_new_tools`: Analizza i log delle query RAW e suggerisce nuovi tool specializzati in base all'utilizzo reale.
*   `analyze_usage`: Analizza i log interni per identificare pattern, errori e query frequenti.

---

## Installazione & Uso

### 1. Tramite NPX (Senza installazione permanente)
```bash
npx schema-gov-it-mcp
```

### 2. Installazione da GitHub (Senza NPM Registry)
Puoi installare globalmente direttamente dal repository:

```bash
npm install -g git+https://github.com/mfortini/schema-gov-it-mcp.git
```
Poi usa `schema-gov-it-mcp` come comando.

### 3. Configurazione per Claude Code
```bash
claude mcp add schema-gov-it -- npx schema-gov-it-mcp
```

Oppure aggiungi manualmente a `~/.claude.json`:

```json
{
  "mcpServers": {
    "schema-gov-it": {
      "command": "npx",
      "args": ["schema-gov-it-mcp"]
    }
  }
}
```

### 4. Installazione Locale (Sviluppo)
```bash
git clone https://github.com/mfortini/schema-gov-it-mcp.git
cd schema-gov-it-mcp
npm install
npm run build   # Opzionale: il codice compilato /dist è già incluso
node dist/index.js
```

---

## Esempi di Utilizzo

Una volta configurato, puoi chiedere all'agente cose come:

*   *"Cerca concetti relativi alla 'Sanità' e dimmi quali sono le classi principali."* (Userà `search_concepts`)
*   *"Analizza la classe Persona e dimmi con chi è collegata."* (Userà `inspect_concept`)
*   *"Controlla se ci sono sovrapposizioni tra i concetti di Luogo."* (Userà `check_overlaps`)
*   *"Come posso ottimizzare le mie query?"* (Userà `analyze_usage` sui log)
*   *"Elenca le ontologie disponibili e mostrami le classi di quella sui Servizi Pubblici."* (Userà `list_ontologies` + `explore_ontology`)

## Note Tecniche

*   **Prefixes Automatici**: Non serve definire `rdf:`, `owl:`, `skos:`, ecc. nelle query. Il server li aggiunge automaticamente.
*   **Compressione Token**: Le liste lunghe (> 5 item) vengono restituite in formato tabellare compatto per risparmiare token.
*   **Input Sanitizzati**: Tutti i parametri utente sono sanitizzati per prevenire SPARQL injection.
*   **Logging**: Tutte le chiamate vengono loggate in `usage_log.jsonl` per analisi e miglioramento continuo.

## Licenza

MIT - vedi [LICENSE](LICENSE)

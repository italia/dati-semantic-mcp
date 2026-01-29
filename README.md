# Schema.gov.it MCP Server

Un server MCP (Model Context Protocol) avanzato per interagire semanticamente con il catalogo dati di [schema.gov.it](https://schema.gov.it).

Questo server permette agli agenti AI (come Claude Code) di esplorare ontologie, analizzare la copertura dei dati, verificare la qualità e scoprire connessioni tra concetti in modo intelligente.

## Funzionalità

Il server espone tre livelli di stumenti:

### 1. Core SPARQL (Base)
*   `query_sparql`: Esegue query SPARQL arbitrarie (RAW) verso l'endpoint.
*   `explore_catalog`: Elenca i grafi/ontologie disponibili.

### 2. Analisi Semantica (Intermedio)
*   `check_coverage`: Analizza quanto è usata una classe o proprietà nel dataset.
*   `check_quality`: Identifica problemi comuni (es. mancanza di etichette/label).
*   `check_overlaps`: Trova duplicati potenziali o mapping espliciti (`owl:sameAs`).

### 3. Intelligence (Avanzato)
*   `search_concepts`: **Ricerca fuzzy**. Trova concetti (es. "Scuola") senza conoscere l'URI esatto.
*   `inspect_concept`: **Deep Dive**. Ottiene in un colpo solo definizione, gerarchia, usage stats e vicini di un concetto.
*   `find_relations`: **Pathfinding**. Scopre come due concetti sono collegati.
*   `suggest_improvements`: Euristiche per trovare anomalie strutturali nell'ontologia.

### 4. Meta-Ottimizzazione
*   `analyze_usage`: Analizza i log interni per dirti quali query fai più spesso e quali falliscono.

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

### 3. Configurazione per AI Agent
#### Claude Code / Desktop
```bash
claude mcp add schema-gov-it -- npx schema-gov-it-mcp
```

#### ChatGPT / OpenAI
Al momento ChatGPT non supporta MCP nativamente tramite una CLI ufficiale semplice come Claude. Tuttavia:
- **ChatGPT Web (Developer Mode)**: Puoi importare il server come "Connettore" se hai accesso alle funzionalità developer.
- **OpenAI API / Custom Client**: Puoi usare client compatibili MCP della community (es. `mcp-cli` o `semantic-kernel` con bridge MCP).
- **Consiglio**: Se usi ChatGPT via web, chiedi di creare azioni GPT (GPT Actions) basate sulle specifiche del server, ma MCP richiede un bridge locale-remoto.

### 4. Installazione Locale (Sviluppo)
```bash
git clone <repo-url>
cd schema-gov-it-mcp
npm install
npm run build
node dist/index.js
```

---

## Configurazione con Claude Code (o "Codex")

Per utilizzare questo server con **Claude Code** (la CLI), puoi aggiungerlo alla configurazione in due modi:

### Metodo Rapido (CLI)
Esegui questo comando nella cartella del progetto:

```bash
claude mcp add schema-gov-it -- node $(pwd)/dist/index.js
```

### Metodo Manuale (Config File)
Modifica il file di configurazione di Claude (solitamente `~/.config/Claude/claude_desktop_config.json` o equivalente per la CLI):

```json
{
  "mcpServers": {
    "schema-gov-it": {
      "command": "node",
      "args": [
        "/percorso/assoluto/a/schema.gov.it/MCP/dist/index.js"
      ]
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

## Note Tecniche

*   **Prefixes Automatici**: Non serve definire `rdf:`, `owl:`, `skos:`, ecc. nelle query. Il server li aggiunge automaticamente.
*   **Compressione Token**: Le liste lunghe (es. vocabolari > 5 item) vengono restituite in formato tabellare compatto per risparmiare token.

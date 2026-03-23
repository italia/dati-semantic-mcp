# Report: Interazioni tra dati.camera.it e schema.gov.it

> Data analisi: 2026-03-01
> Endpoint Camera: `https://dati.camera.it/sparql`
> Endpoint schema.gov.it: `https://schema.gov.it/sparql`

---

## 1. Panoramica degli endpoint

### 1.1 dati.camera.it

L'endpoint della Camera dei Deputati espone dati parlamentari italiani dalla Repubblica (legislature I–XIX) fino all'archivio storico del Regno. Usa un'ontologia proprietaria (`ocd:` = `http://dati.camera.it/ocd/`) affiancata da vocabolari standard aperti.

**Dimensioni:**

| Named Graph | Triple |
|---|---|
| `ocd/` (principale) | 303.134.242 |
| `ocd/votazioni/` | 57.732.697 |
| `ocd/dibattiti/` | 1.513.508 |
| `archivio-storico/` | 1.171.640 |
| `ocd/aic/` | 1.098.976 |
| `ocd/iter/` | 571.749 |

**Classi principali per numerosità:**

| Classe | Istanze |
|---|---|
| `ocd:voto` | 57.488.250 |
| `ocd:intervento` | 1.134.755 |
| `ocd:aic` (interrogazioni) | 1.098.974 |
| `ocd:discussione` | 528.203 |
| `ocd:atto` | 269.395 |
| `ocd:votazione` | 253.557 |
| `ocd:seduta` | 242.972 |
| `ocd:deputato` | 55.511 |
| `foaf:Person` | 31.923 |
| `ocd:gruppoParlamentare` | 454 |
| `ocd:governo` | 294 |
| `ocd:legislatura` | 101 |
| `dcat:Dataset` | 104 |

### 1.2 schema.gov.it

Il catalogo semantico della PA italiana ospita la rete di ontologie **OntoPiA** (40+ ontologie) e vocabolari controllati. Non contiene dati istanziali parlamentari ma fornisce i modelli semantici di riferimento per la PA italiana.

---

## 2. Vocabolari condivisi

`dati.camera.it` usa già diversi vocabolari standard presenti anche in schema.gov.it. Questi sono i punti di contatto **già esistenti**:

| Namespace | Usato in Camera | Usato in schema.gov.it | Note |
|---|---|---|---|
| `foaf:` | Persone, foto, account | Base di CPV | `foaf:firstName`, `foaf:surname`, `foaf:gender`, `foaf:depiction` |
| `dcat:` | Dataset, Distribution, Catalog | DCAT-AP_IT | 104 dataset dichiarati, senza metadati completi |
| `dct:` | Metadati atti e risorse | Tutte le ontologie | Camera usa anche il vecchio `dc:` (Dublin Core 1.1) |
| `skos:` | Concept, ConceptScheme | Vocabolari controllati | Camera usa il namespace 2008 (`w3.org/2008/05/skos`) anziché quello standard |
| `org:` | `org:OrganizationalUnit`, `org:Organization` | COV (basato su org:) | 30 istanze `org:OrganizationalUnit` a camera.it |
| `rdfs:label` | Etichette su tutte le classi | Standard OntoPiA | Uso coerente |

---

## 3. Mapping proposti con le ontologie OntoPiA

### 3.1 `ocd:deputato` / `ocd:senatore` → **CPV** (Core Person Vocabulary)

La classe deputato usa `foaf:` per le proprietà anagrafiche, che corrisponde direttamente al modello CPV.

**Proprietà effettivamente usate su `ocd:deputato`:**

| Proprietà Camera | Proprietà CPV equivalente | Note |
|---|---|---|
| `foaf:firstName` | `CPV:givenName` | Corrispondenza diretta |
| `foaf:surname` | `CPV:familyName` | Corrispondenza diretta |
| `foaf:gender "male"` | `CPV:hasSex` → `CPV:Male` | Camera usa literal, CPV usa URI |
| `foaf:gender "female"` | `CPV:hasSex` → `CPV:Female` | Idem |
| `foaf:depiction` | — | Foto del deputato, non in CPV |
| `dc:description` | — | Professione/istruzione, non in CPV |
| `dct:isReferencedBy` | — | Link alla scheda sul sito camera.it |

**Mapping OWL proposto:**
```turtle
ocd:deputato rdfs:subClassOf cpv:Person .
ocd:senatore rdfs:subClassOf cpv:Person .
```

---

### 3.2 `ocd:mandatoCamera` → **RO** (Ontologia dei Ruoli nel Tempo)

Il mandato parlamentare è un ruolo temporalizzato: una persona ricopre il ruolo di deputato per un'organizzazione (la Camera) durante una legislatura.

**Proprietà rilevate su `ocd:mandatoCamera`:**

| Proprietà Camera | Concetto RO equivalente | Note |
|---|---|---|
| `ocd:rif_deputato` | `RO:isRoleInTimeOf` | La persona che ricopre il ruolo |
| `ocd:rif_leg` | `RO:forEntity` | La legislatura (contesto del ruolo) |
| `ocd:startDate` | data inizio `TI:TimeInterval` | Formato YYYYMMDD come literal |
| `ocd:endDate` | data fine `TI:TimeInterval` | Formato YYYYMMDD come literal |
| `ocd:motivoTermine` | — | Es. "Fine Legislatura", non in RO |
| `ocd:convalida` | — | Data di convalida dell'elezione |

**Mapping OWL proposto:**
```turtle
ocd:mandatoCamera rdfs:subClassOf ro:TimeIndexedRole .
ocd:incarico       rdfs:subClassOf ro:TimeIndexedRole .
```

---

### 3.3 `ocd:gruppoParlamentare` / `ocd:organo` → **COV** (Ontologia delle Organizzazioni)

I gruppi parlamentari e gli organi della Camera sono organizzazioni pubbliche con un ciclo di vita (date di inizio/fine).

**Proprietà rilevate su `ocd:gruppoParlamentare`:**

| Proprietà Camera | Proprietà COV equivalente | Note |
|---|---|---|
| `rdfs:label` | `rdfs:label` | Diretto |
| `dc:title` | `dct:title` | Aggiornamento namespace |
| `dct:alternative` | `COV:acronym` | Sigla del gruppo (es. "AN") |
| `ocd:startDate` | data inizio via `TI:TimeInterval` | Literal YYYYMMDD |
| `ocd:endDate` | data fine via `TI:TimeInterval` | Literal YYYYMMDD |
| `ocd:rif_leg` | — | Legislatura di riferimento |
| `ocd:siComponeDi` | `org:hasMember` | Composizione del gruppo |

**Nota:** Camera usa già `org:Organization` e `org:OrganizationalUnit` (30 istanze), ma non per i gruppi parlamentari — un'opportunità di allineamento.

**Mapping OWL proposto:**
```turtle
ocd:gruppoParlamentare rdfs:subClassOf cov:PublicOrganization .
ocd:organo             rdfs:subClassOf cov:PublicOrganization .
ocd:governo            rdfs:subClassOf cov:PublicOrganization .
```

---

### 3.4 `ocd:luogo` → **CLV** (Ontologia dei Luoghi) + Vocabolari ISTAT

I luoghi usati a camera.it (es. circoscrizioni elettorali, luoghi di nascita) hanno una struttura gerarchica comune/provincia/regione, direttamente confrontabile con il vocabolario ISTAT dei Comuni in schema.gov.it.

**Proprietà rilevate su `ocd:luogo`:**

| Proprietà Camera | Corrispondenza in schema.gov.it |
|---|---|
| `rdfs:label` (es. "BAVENO") | Nome comune nel vocabolario ISTAT |
| `ocd:parentADM1` (comune) | URI ISTAT del comune (schema.gov.it) |
| `ocd:parentADM2` (provincia) | URI ISTAT della provincia (schema.gov.it) |
| `ocd:parentADM3` (regione) | URI ISTAT della regione (schema.gov.it) |

**Esempio di linking potenziale:**
```sparql
# Trovare il comune BAVENO in schema.gov.it
SELECT ?comune ?istat WHERE {
  ?comune skos:prefLabel "Baveno"@it ;
          skos:notation ?istat .
}
# → ISTAT 103010
```

Camera usa anche `linkedgeodata:Village`, `linkedgeodata:Town`, `linkedgeodata:City` per alcuni luoghi — già parte del Linked Data globale.

---

### 3.5 `ocd:atto` / `ocd:legge` / `ocd:DOC` → **ADMS/NDC**

Gli atti legislativi usano Dublin Core per i metadati documentali. Schema.gov.it ha `ADMS` (Semantic Asset Description Metadata Schema) e il profilo `NDC` per il catalogo nazionale.

**Proprietà rilevate su `ocd:atto`:**

| Proprietà Camera | ADMS/NDC equivalente | Note |
|---|---|---|
| `dc:title` | `dct:title` | Aggiornamento da DC 1.1 a DCT |
| `dc:date` | `dct:issued` | Data presentazione |
| `dc:type` | `dct:type` | Tipo atto (es. "Progetto di Legge") |
| `dc:description` | `dct:description` | Descrizione |
| `dc:identifier` | `dct:identifier` | Numero atto |
| `dc:creator` | `dct:creator` | Primo firmatario |
| `dct:isPartOf` | — | Sessione legislativa |
| `dct:provenance` | `dct:provenance` | Diretto |
| `ocd:iniziativa` | — | Es. "Parlamentare" |

---

### 3.6 `dcat:Dataset` → **DCAT-AP_IT**

Camera.it dichiara 104 dataset DCAT ma **senza metadati**:  nessun `dct:title`, `dct:description`, `dct:publisher`, `dcat:theme`. Questo è il gap più critico rispetto al profilo DCAT-AP_IT di schema.gov.it che richiede questi campi obbligatori.

**Dataset dichiarati (selezione):**
- `ocd/dataset/deputati`
- `ocd/dataset/gruppi-parlamentari`
- `ocd/dataset/governi`
- `ocd/dataset/elezioni`
- `ocd/dataset/dibattiti-e-discussioni`
- `ocd/dataset/BPR` (Banche dati parlamentari)

---

## 4. Lacune e opportunità

### 4.1 Lacune in dati.camera.it rispetto agli standard OntoPiA

| Aspetto | Situazione attuale | Standard OntoPiA |
|---|---|---|
| **Namespace SKOS** | `w3.org/2008/05/skos` (deprecato) | `w3.org/2004/02/skos/core` |
| **Date** | Literal stringa (`"20140709"`, `"2015-07-01"`) | `xsd:date` tipizzato |
| **Dataset DCAT** | 104 dichiarati, 0 con metadati | `dct:title`, `dct:publisher`, `dcat:theme` obbligatori |
| **Luoghi** | Solo nome + gerarchia testuale ADM | Link a URI ISTAT in schema.gov.it |
| **Genere** | `foaf:gender "male"/"female"` (literal) | `CPV:hasSex` con URI `CPV:Male`/`CPV:Female` |
| **Organizzazioni** | `org:` usato solo parzialmente | `COV:PublicOrganization` per gruppi/organi |

### 4.2 Opportunità di arricchimento

1. **Linking luoghi → ISTAT**: i ~4.998 luoghi di `ocd:luogo` sono comuni/province italiane identificabili tramite il vocabolario ISTAT in schema.gov.it. Un processo di riconciliazione per nome permetterebbe di aggiungere `owl:sameAs` o `skos:exactMatch`.

2. **Completamento metadati DCAT-AP_IT**: aggiungere titoli, descrizioni, publisher e temi EUROVOC/EuroVoc ai 104 dataset già dichiarati li renderebbe conformi e indicizzabili nel catalogo nazionale dati.gov.it.

3. **Allineamento tipologie atti**: le tipologie di atti (`dc:type "Progetto di Legge"`, ecc.) potrebbero essere riconciliate con vocabolari ELI (European Legislation Identifier) già referenziati in schema.gov.it.

---

## 5. Query federata di esempio

Query SPARQL che combina i due endpoint per arricchire i deputati con dati ISTAT:

```sparql
PREFIX foaf: <http://xmlns.com/foaf/0.1/>
PREFIX ocd:  <http://dati.camera.it/ocd/>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT ?nome ?cognome ?luogoLabel ?istat WHERE {
  # Deputati XIX Legislatura da dati.camera.it
  SERVICE <https://dati.camera.it/sparql> {
    ?dep a ocd:deputato ;
         ocd:rif_leg <http://dati.camera.it/ocd/legislatura.rdf/repubblica_19> ;
         foaf:firstName ?nome ;
         foaf:surname   ?cognome ;
         ocd:rif_mandatoCamera ?mc .
    ?mc ocd:rif_elezione ?el .
    OPTIONAL { ?el ocd:rif_luogoNascita ?luogo .
               ?luogo rdfs:label ?luogoLabel }
  }
  # Arricchimento con codice ISTAT da schema.gov.it
  OPTIONAL {
    ?comune skos:prefLabel ?luogoLabel ;
            skos:notation  ?istat .
  }
}
LIMIT 20
```

---

## 6. Riepilogo

| Area | Stato | Priorità |
|---|---|---|
| Persone (CPV) | Mapping definito, foaf già usato | Alta |
| Luoghi (CLV + ISTAT) | Mapping definito, linking da fare | Alta |
| Mandati/Ruoli (RO) | Mapping definito | Media |
| Organizzazioni (COV) | Mapping definito | Media |
| Atti/Documenti (ADMS) | Mapping parziale (DC→DCT) | Media |
| Dataset (DCAT-AP_IT) | Gap critico su metadati | Alta |
| Namespace SKOS | Aggiornamento necessario | Bassa |
| Date tipizzate (xsd:date) | Aggiornamento necessario | Bassa |

---

*Report generato tramite MCP server schema.gov.it — interrogazione diretta degli endpoint SPARQL.*

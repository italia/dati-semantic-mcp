# Issue: Semplificare la gestione degli identificativi territoriali in CLV

## Problema

`clv:identifierType` è una DatatypeProperty con range `rdfs:Literal`. I tipi di identificativi sono stringhe libere senza controllo:

```sparql
# Valori attuali di identifierType (39.024 risorse Identifier totali)
"Codice ISTAT numerico"              (14.206 occorrenze)
"Codice ISTAT alfanumerico"          (14.206 occorrenze)
"Codice Catastale"                   (10.356 occorrenze)
"Codice Provincia Alfanumerico"      (107)
"Sigla Automobilistica"              (107)
"Codice Regione"                     (21)
"Codice Città Metropolitana"         (14)
"Identificativo della ripartizione"  (5)
"ISO 3166-1 alpha-2"                 (1)
"ISO 3166-1 alpha-3"                 (1)
```

Questo comporta:
- **Ridondanza massiva**: il codice ISTAT numerico (15146) è derivabile dall'alfanumerico (015146) - 14.206 risorse duplicate
- **Nessun controllo** sui valori ammessi (stringhe libere)
- **Nessuna multilingua** (solo italiano)
- **Nessuna semantica formale** (non si può fare reasoning)
- **Indirezione inutile**: per ottenere il catastale di un comune servono 2 hop (City → Identifier → literal)

### Il caso del Codice Belfiore

Il "Codice Catastale" e il "Codice Belfiore" sono **lo stesso codice** (es. F205 = Milano). È il codice a 4 caratteri alfanumerici assegnato dall'Agenzia delle Entrate a ogni comune, usato nel calcolo del codice fiscale.

Nel triplestore attuale:
- 10.356 risorse `clv:Identifier` con `identifierType "Codice Catastale"`
- Il nome "Belfiore" non compare mai, nonostante sia il termine più usato in ambito fiscale

Esiste già un precedente in OntoPiA: l'ontologia infortuni sul lavoro definisce `codiceBelfioreCittadinanza` come DatatypeProperty diretta — esattamente il pattern che proponiamo di generalizzare.

---

## Proposta A: Vocabolario controllato per identifierType

Approccio incrementale: creare un vocabolario controllato SKOS e cambiare `clv:identifierType` da literal a riferimento.

### Nuovo vocabolario controllato

```turtle
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix clv:  <https://w3id.org/italia/onto/CLV/> .
@prefix idtype: <https://w3id.org/italia/controlled-vocabulary/territorial-classifications/identifier-types/> .

<https://w3id.org/italia/controlled-vocabulary/territorial-classifications/identifier-types>
    a skos:ConceptScheme ;
    rdfs:label "Tipi di identificativi territoriali"@it ,
               "Territorial Identifier Types"@en .

idtype:istat-alphanumeric
    a skos:Concept ;
    skos:prefLabel "Codice ISTAT alfanumerico"@it , "ISTAT alphanumeric code"@en ;
    skos:notation "ISTAT-ALPHA" ;
    skos:definition "Codice ISTAT a 6 cifre con zeri iniziali (es. 015146)"@it .

idtype:belfiore
    a skos:Concept ;
    skos:prefLabel "Codice Belfiore"@it , "Belfiore Code"@en ;
    skos:altLabel "Codice Catastale"@it , "Cadastral Code"@en ;
    skos:notation "BELFIORE" ;
    skos:definition "Codice a 4 caratteri alfanumerici assegnato dall'Agenzia delle Entrate a ogni comune italiano. Usato nel codice fiscale. (es. F205 = Milano)"@it .

idtype:province-code
    a skos:Concept ;
    skos:prefLabel "Codice Provincia"@it , "Province Code"@en ;
    skos:notation "PROV" .

idtype:car-plate
    a skos:Concept ;
    skos:prefLabel "Sigla Automobilistica"@it , "Car Plate Code"@en ;
    skos:notation "PLATE" .

idtype:region-code
    a skos:Concept ;
    skos:prefLabel "Codice Regione"@it , "Region Code"@en ;
    skos:notation "REG" .

# ... altri (metro-city, geo-distribution, ISO 3166) ...
```

### Modifica a identifierType

```turtle
# DA (attuale):
clv:identifierType a owl:DatatypeProperty ; rdfs:range rdfs:Literal .

# A (proposta):
clv:identifierType a owl:ObjectProperty ; rdfs:range skos:Concept .
```

### Impatto Proposta A

| Aspetto | Valutazione |
|---------|-------------|
| Retrocompatibilità | **Rottura** - cambia tipo di proprietà |
| Risorse Identifier eliminate | ~14.200 (solo i numerici ridondanti) |
| Risorse Identifier restanti | ~24.800 |
| Beneficio | Controllo, multilingua, semantica |
| Complessità query | Invariata (sempre 2 hop) |

---

## Proposta B: Proprietà dirette (raccomandato)

Approccio radicale: definire proprietà tipizzate direttamente sulle entità territoriali, eliminando l'indirezione tramite `clv:Identifier` per tutti i codici noti e stabili.

### Osservazione chiave

I codici identificativi territoriali sono **pochi, ben noti e stabili**. Non servono 39.024 risorse Identifier intermedie per rappresentarli. Inoltre:

- Il **codice ISTAT** è già presente come `skos:notation` sulla City e nell'URI stessa
- Il **codice ISTAT numerico** è derivabile con `xsd:integer()`
- Il **codice Belfiore** è l'unica informazione davvero aggiuntiva per i comuni

### Nuove proprietà

```turtle
@prefix clv: <https://w3id.org/italia/onto/CLV/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

# Codice Belfiore (catastale) - per City
clv:codiceBelfiore
    a owl:DatatypeProperty ;
    rdfs:label "codice Belfiore"@it , "Belfiore code"@en ;
    rdfs:comment "Codice a 4 caratteri alfanumerici (ex catastale) assegnato dall'Agenzia delle Entrate. Usato nel codice fiscale."@it ;
    rdfs:domain clv:City ;
    rdfs:range xsd:string .

# Sigla automobilistica - per Province
clv:siglaAutomobilistica
    a owl:DatatypeProperty ;
    rdfs:label "sigla automobilistica"@it , "car plate code"@en ;
    rdfs:domain clv:Province ;
    rdfs:range xsd:string .

# Codice ISO 3166-1 - per Country
clv:isoAlpha2
    a owl:DatatypeProperty ;
    rdfs:label "codice ISO 3166-1 alpha-2"@it , "ISO 3166-1 alpha-2 code"@en ;
    rdfs:domain clv:Country ;
    rdfs:range xsd:string .

clv:isoAlpha3
    a owl:DatatypeProperty ;
    rdfs:label "codice ISO 3166-1 alpha-3"@it , "ISO 3166-1 alpha-3 code"@en ;
    rdfs:domain clv:Country ;
    rdfs:range xsd:string .
```

**Nota**: il codice ISTAT alfanumerico è già disponibile tramite `skos:notation` (presente su tutte le entità territoriali). Non serve una nuova proprietà.

### Proprietà da deprecare

```turtle
clv:identifierType
    owl:deprecated true ;
    rdfs:comment "Deprecata. I codici noti usano proprietà dirette (codiceBelfiore, siglaAutomobilistica, ecc.). Per codici non standard, usare clv:Identifier."@it .
```

### Esempio: Milano

```turtle
# ══════════════════════════════════════════════════
# STATO ATTUALE: 4 risorse, ~15 triple
# ══════════════════════════════════════════════════
<.../cities/015146-(1904-07-09)>
    a clv:City, skos:Concept ;
    l0:name "MILANO" ;
    skos:notation "015146" ;
    clv:hasIdentifier <.../alphanumeric-istat-code/015146> ;
    clv:hasIdentifier <.../numeric-istat-code/15146> ;      # ridondante
    clv:hasIdentifier <.../cadastral-code/F205> .

<.../alphanumeric-istat-code/015146>
    a clv:Identifier ;
    l0:identifier "015146" ;
    clv:identifierType "Codice ISTAT alfanumerico" .

<.../numeric-istat-code/15146>
    a clv:Identifier ;
    l0:identifier "15146" ;
    clv:identifierType "Codice ISTAT numerico" .

<.../cadastral-code/F205>
    a clv:Identifier ;
    l0:identifier "F205" ;
    clv:identifierType "Codice Catastale" .


# ══════════════════════════════════════════════════
# PROPOSTA B: 1 risorsa, ~5 triple
# ══════════════════════════════════════════════════
<.../cities/015146>
    a clv:City, skos:Concept ;
    l0:name "MILANO" ;
    skos:notation "015146" ;               # codice ISTAT (già presente!)
    clv:codiceBelfiore "F205" .            # unica informazione aggiuntiva
```

### Esempio: Provincia di Milano

```turtle
# STATO ATTUALE
<.../provinces/015>
    a clv:Province ;
    l0:name "MILANO" ;
    skos:notation "015" ;
    clv:hasIdentifier <.../province-alpha-code/015> ;
    clv:hasIdentifier <.../car-plate/MI> .

<.../province-alpha-code/015>
    a clv:Identifier ;
    l0:identifier "015" ;
    clv:identifierType "Codice Provincia Alfanumerico" .

<.../car-plate/MI>
    a clv:Identifier ;
    l0:identifier "MI" ;
    clv:identifierType "Sigla Automobilistica" .


# PROPOSTA B
<.../provinces/015>
    a clv:Province ;
    l0:name "MILANO" ;
    skos:notation "015" ;                  # codice provincia (già presente!)
    clv:siglaAutomobilistica "MI" .        # unica informazione aggiuntiva
```

### Query a confronto

```sparql
# ── Trova il codice Belfiore di Milano ──

# Attuale (2 hop, stringa magica):
SELECT ?code WHERE {
  ?city l0:name "MILANO" ;
        clv:hasIdentifier ?id .
  ?id clv:identifierType "Codice Catastale" ;
      l0:identifier ?code .
}

# Proposta B (1 hop, proprietà tipizzata):
SELECT ?code WHERE {
  ?city l0:name "MILANO" ;
        clv:codiceBelfiore ?code .
}


# ── Tutti i comuni con Belfiore che inizia per "F" ──

# Attuale:
SELECT ?name ?code WHERE {
  ?city a clv:City ; l0:name ?name ;
        clv:hasIdentifier ?id .
  ?id clv:identifierType "Codice Catastale" ;
      l0:identifier ?code .
  FILTER(STRSTARTS(?code, "F"))
}

# Proposta B:
SELECT ?name ?code WHERE {
  ?city a clv:City ; l0:name ?name ;
        clv:codiceBelfiore ?code .
  FILTER(STRSTARTS(?code, "F"))
}
```

---

## Confronto tra le proposte

| Aspetto | Attuale | Proposta A (vocab) | Proposta B (diretto) |
|---------|---------|-------------------|---------------------|
| Risorse Identifier | 39.024 | ~24.800 | 0 (per codici noti) |
| Triple per comune | ~15 | ~9 | ~5 |
| Su ~8.000 comuni attuali | ~120K triple | ~72K triple | ~40K triple |
| `identifierType` | stringa libera | vocabolario controllato | proprietà tipizzata |
| Query per Belfiore | 2 hop + stringa | 2 hop + URI | 1 hop diretto |
| Multilingua | no | sì (sulle label del vocab) | sì (sulle label della proprietà) |
| Estensibilità | alta (qualsiasi stringa) | alta (nuovi concept) | media (serve nuova proprietà) |
| Precedente in OntoPiA | — | — | `codiceBelfioreCittadinanza` (ontologia infortuni) |

### Raccomandazione: Proposta B con fallback

Usare **proprietà dirette per i codici noti e stabili**:

| Proprietà | Dominio | Codici coperti |
|-----------|---------|----------------|
| `skos:notation` (esiste già) | tutte le entità | codici ISTAT (~14.200) |
| `clv:codiceBelfiore` | `clv:City` | codici catastali/Belfiore (~10.350) |
| `clv:siglaAutomobilistica` | `clv:Province` | targhe (~107) |
| `clv:isoAlpha2` | `clv:Country` | ISO alpha-2 (1) |
| `clv:isoAlpha3` | `clv:Country` | ISO alpha-3 (1) |

Per eventuali codici futuri non previsti, mantenere `clv:Identifier` come meccanismo di estensione generico.

### Migrazione

```sparql
# Passo 1: Aggiungere proprietà dirette
INSERT { ?city clv:codiceBelfiore ?code }
WHERE {
  ?city a clv:City ;
        clv:hasIdentifier ?id .
  ?id clv:identifierType "Codice Catastale" ;
      l0:identifier ?code .
}

# Passo 2: Aggiungere sigla automobilistica
INSERT { ?prov clv:siglaAutomobilistica ?code }
WHERE {
  ?prov a clv:Province ;
        clv:hasIdentifier ?id .
  ?id clv:identifierType "Sigla Automobilistica" ;
      l0:identifier ?code .
}

# Passo 3: Rimuovere le risorse Identifier ridondanti
# (da eseguire dopo validazione)
DELETE { ?city clv:hasIdentifier ?id . ?id ?p ?o }
WHERE {
  ?city a clv:City ;
        clv:hasIdentifier ?id .
  ?id a clv:Identifier ;
      clv:identifierType ?type ;
      ?p ?o .
  FILTER(?type IN ("Codice ISTAT alfanumerico", "Codice ISTAT numerico", "Codice Catastale"))
}
```

### Retrocompatibilità

| Strategia | Impatto |
|-----------|---------|
| Deprecare `clv:identifierType` | Rottura per chi usa le stringhe attuali |
| Mantenere `clv:hasIdentifier` per usi generici | Nessuna rottura |
| Periodo di transizione con entrambi i pattern | Nessuna rottura immediata |

---

## Note sulla denominazione: Catastale vs Belfiore

Si raccomanda di usare **"Belfiore"** come nome primario della proprietà (`clv:codiceBelfiore`) perché:

1. **È il nome ufficiale** del codice nell'anagrafe dei comuni dell'Agenzia delle Entrate
2. **È il termine usato** nel contesto del codice fiscale (il caso d'uso principale)
3. **"Catastale" è ambiguo**: potrebbe riferirsi a dati catastali immobiliari (particelle, fogli, ecc.)
4. **Precedente in OntoPiA**: l'ontologia infortuni usa già `codiceBelfioreCittadinanza`
5. Il termine "catastale" può restare come `rdfs:label` alternativa o `skos:altLabel`

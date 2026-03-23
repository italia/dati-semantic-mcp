# Analisi Copertura Temi DCAT-AP in schema.gov.it

**Data analisi**: 31 gennaio 2026
**Fonte temi**: [data.europa.eu](https://data.europa.eu) - EU Publications Office Authority Tables
**Endpoint analizzato**: https://schema.gov.it/sparql

---

## Sommario Esecutivo

| Metrica | Valore |
|---------|--------|
| **Temi DCAT-AP definiti in EU** | 13 |
| **Temi presenti in schema.gov.it** | 13 (100%) |
| **Temi effettivamente utilizzati** | 11 (84.6%) |
| **Temi non utilizzati** | 2 (JUST, INTR) |

---

## 1. Temi DCAT-AP Europei

I temi DCAT-AP sono definiti nel vocabolario controllato dell'EU Publications Office:
`http://publications.europa.eu/resource/authority/data-theme/`

| Codice | Tema (IT) | Tema (EN) |
|--------|-----------|-----------|
| AGRI | Agricoltura, pesca, silvicoltura e prodotti alimentari | Agriculture, fisheries, forestry and food |
| ECON | Economia e finanze | Economy and finance |
| EDUC | Istruzione, cultura e sport | Education, culture and sport |
| ENER | Energia | Energy |
| ENVI | Ambiente | Environment |
| GOVE | Governo e settore pubblico | Government and public sector |
| HEAL | Salute | Health |
| INTR | Tematiche internazionali | International issues |
| JUST | Giustizia, sistema giuridico e sicurezza pubblica | Justice, legal system and public safety |
| REGI | Regioni e città | Regions and cities |
| SOCI | Popolazione e società | Population and society |
| TECH | Scienze e tecnologia | Science and technology |
| TRAN | Trasporti | Transport |

---

## 2. Utilizzo dei Temi in schema.gov.it

### 2.1 Classifica per Utilizzo

| # | Tema | Codice | Utilizzi | % sul totale |
|---|------|--------|----------|--------------|
| 1 | Popolazione e società | SOCI | **193** | 48.0% |
| 2 | Governo e settore pubblico | GOVE | 34 | 8.5% |
| 3 | Agricoltura, pesca, silvicoltura e prodotti alimentari | AGRI | 28 | 7.0% |
| 4 | Istruzione, cultura e sport | EDUC | 26 | 6.5% |
| 5 | Scienze e tecnologia | TECH | 23 | 5.7% |
| 6 | Salute | HEAL | 19 | 4.7% |
| 7 | Economia e finanze | ECON | 18 | 4.5% |
| 8 | Ambiente | ENVI | 16 | 4.0% |
| 9 | Trasporti | TRAN | 12 | 3.0% |
| 10 | Regioni e città | REGI | 11 | 2.7% |
| 11 | Energia | ENER | 2 | 0.5% |
| 12 | **Giustizia, sistema giuridico e sicurezza pubblica** | **JUST** | **0** | 0% |
| 13 | **Tematiche internazionali** | **INTR** | **0** | 0% |

**Totale utilizzi**: 402

### 2.2 Visualizzazione Distribuzione

```
SOCI ████████████████████████████████████████████████ 193 (48.0%)
GOVE ████████                                          34 (8.5%)
AGRI ███████                                           28 (7.0%)
EDUC ██████                                            26 (6.5%)
TECH ██████                                            23 (5.7%)
HEAL █████                                             19 (4.7%)
ECON █████                                             18 (4.5%)
ENVI ████                                              16 (4.0%)
TRAN ███                                               12 (3.0%)
REGI ███                                               11 (2.7%)
ENER █                                                  2 (0.5%)
JUST                                                    0 (0.0%)
INTR                                                    0 (0.0%)
```

---

## 3. Analisi dei Temi Non Utilizzati

### 3.1 JUST - Giustizia, sistema giuridico e sicurezza pubblica

**Stato**: Presente come concetto SKOS, ma nessun dataset/ontologia associato.

**Potenziali aree da coprire**:
- Ontologie per il sistema giudiziario
- Vocabolari per tipi di procedimenti
- Dati su sicurezza pubblica
- Registri di avvocati, notai, magistrati
- Casellario giudiziale (struttura dati)

**Enti potenzialmente interessati**:
- Ministero della Giustizia
- Consiglio Superiore della Magistratura
- Ordini forensi

### 3.2 INTR - Tematiche internazionali

**Stato**: Presente come concetto SKOS, ma nessun dataset/ontologia associato.

**Potenziali aree da coprire**:
- Trattati e accordi internazionali
- Cooperazione allo sviluppo
- Relazioni diplomatiche
- Organizzazioni internazionali
- Commercio estero

**Enti potenzialmente interessati**:
- Ministero degli Affari Esteri
- ICE - Agenzia per la promozione all'estero
- Cooperazione Italiana

---

## 4. Analisi dei Temi Sottoutilizzati

### 4.1 ENER - Energia (2 utilizzi)

**Risorse attuali**:
- `grande_gruppo_tariffario` (INAIL)
- `settore_correlato_malattia` (INAIL)

**Gap identificati**:
- Mancano ontologie per fonti energetiche
- Mancano vocabolari per efficienza energetica
- Mancano dati su produzione/consumo energia

**Enti potenzialmente interessati**:
- Ministero dell'Ambiente e della Sicurezza Energetica
- GSE - Gestore Servizi Energetici
- ARERA
- ENEA

---

## 5. Analisi del Tema Dominante

### 5.1 SOCI - Popolazione e società (193 utilizzi, 48%)

Il tema SOCI domina il catalogo grazie principalmente ai contributi di **INPS** (previdenza sociale).

**Principali contributori**:
- Ontologie previdenziali (pensioni, contributi, NASpI)
- Vocabolari per servizi sociali
- Classificazioni per il lavoro domestico
- Dati demografici e anagrafici

**Osservazione**: La forte concentrazione su SOCI riflette il focus attuale di schema.gov.it sulla previdenza sociale e i servizi al cittadino.

---

## 6. Confronto con data.europa.eu

### 6.1 Copertura Qualitativa

| Tema | schema.gov.it | data.europa.eu | Gap |
|------|---------------|----------------|-----|
| SOCI | Molto forte (INPS) | Forte | Allineato |
| GOVE | Buono (PA, trasparenza) | Molto forte | Migliorabile |
| AGRI | Buono (LEO, ISTAT) | Forte | Allineato |
| EDUC | Discreto (Learning) | Forte | Migliorabile |
| TECH | Discreto (IoT) | Molto forte | Migliorabile |
| HEAL | Discreto (INAIL) | Forte | **Carente** (manca SSN) |
| ECON | Discreto (ATECO) | Molto forte | Migliorabile |
| ENVI | Discreto (ISPRA) | Molto forte | Migliorabile |
| TRAN | Debole | Forte | **Carente** |
| REGI | Debole (CLV) | Forte | Migliorabile |
| ENER | Molto debole | Forte | **Molto carente** |
| JUST | Assente | Presente | **Assente** |
| INTR | Assente | Presente | **Assente** |

### 6.2 Priorità di Intervento

1. **Alta priorità** (temi assenti o molto carenti):
   - JUST - Giustizia
   - INTR - Internazionale
   - ENER - Energia

2. **Media priorità** (temi sottorappresentati):
   - TRAN - Trasporti
   - HEAL - Salute (oltre INAIL)
   - REGI - Regioni e città

3. **Bassa priorità** (copertura sufficiente):
   - GOVE, EDUC, TECH, ECON, ENVI

---

## 7. Dettaglio Ontologie per Tema HEAL (Salute)

Come richiesto, ecco il dettaglio delle 19 risorse associate al tema Salute:

### 7.1 INAIL - Infortuni e Malattie Professionali (17 vocabolari)

| Vocabolario | Descrizione |
|-------------|-------------|
| `classificazione_ICDX` | Classificazione Internazionale delle Malattie (ICD-10) |
| `tipo_malattia` | Anagrafica delle malattie professionali |
| `tipo_tecnopatia` | Classificazione del tipo di malattia professionale |
| `agente_causale` | Agenti che possono causare malattie |
| `agente_materiale` | Classificazione agenti materiali |
| `causa_esterna` | Cause esterne di traumatismo e avvelenamento |
| `natura_lesione` | Tipologia della lesione (10 categorie) |
| `sede_lesione` | Parti del corpo sede della lesione |
| `classe_menomazione` | Intervalli grado menomazione [1-5%], [6-15%], [16-100%] |
| `inabilita` | Grado di perdita della capacità lavorativa |
| `definizione_amministrativa` | Stato pratica: Positivo, Negativo, Franchigia, In Istruttoria |
| `deviazione` | Evento anomalo che ha causato l'infortunio |
| `tipo_contatto` | Sostanze e tipologie di contatto lesivo |
| `gestione` | Gestione assicurativa |
| `tipo_acquisto` | Acquisti ammissibili per Bando ISI INAIL |
| `tipo_intervento` | Interventi ammissibili per Bando ISI INAIL |

### 7.2 Progetto LEO - Sanità Animale (2 ontologie)

| Ontologia | Descrizione |
|-----------|-------------|
| `analysis` | Analisi di laboratorio e dati sanitari |
| `health-assessment` | Accertamenti sanitari e screening aziendali (Istituto Zooprofilattico Umbria-Marche) |

### 7.3 Altro

| Risorsa | Descrizione |
|---------|-------------|
| `indicator-types` | Tipi di indicatori (processo, risultato, esito) |

### 7.4 Gap nel Tema Salute

Mancano ontologie per:
- Sanità pubblica generale
- Servizio Sanitario Nazionale (SSN)
- Prestazioni sanitarie e LEA
- Fascicolo Sanitario Elettronico
- Farmaci e dispositivi medici
- Strutture sanitarie (ospedali, ASL)
- Professioni sanitarie (oltre a quelle in INAIL)

---

## 8. Raccomandazioni

### 8.1 Azioni Immediate

1. **Coinvolgere nuovi enti** per i temi carenti:
   - Ministero della Giustizia → JUST
   - Ministero degli Esteri → INTR
   - MASE/GSE/ENEA → ENER

2. **Estendere ontologie esistenti**:
   - HEAL: coinvolgere Ministero della Salute, Agenas
   - TRAN: coinvolgere MIT, Trenitalia, ANAS

### 8.2 Azioni a Medio Termine

1. **Bilanciare il catalogo**: ridurre la concentrazione su SOCI
2. **Allinearsi a DCAT-AP 3.0**: verificare compatibilità con nuove specifiche EU
3. **Mappare sottotemi Eurovoc**: utilizzare il vocabolario `theme-subtheme-mapping` già presente

### 8.3 Metriche di Successo

| Obiettivo | Target 2025 | Target 2026 |
|-----------|-------------|-------------|
| Temi con almeno 1 utilizzo | 13/13 (100%) | 13/13 (100%) |
| Temi con almeno 10 utilizzi | 11/13 (85%) | 13/13 (100%) |
| Distribuzione max tema singolo | < 40% | < 35% |

---

## 9. Query SPARQL Utilizzate

### 9.1 Elenco temi presenti

```sparql
SELECT DISTINCT ?theme ?labelIT ?labelEN
WHERE {
  ?theme a skos:Concept .
  FILTER(CONTAINS(STR(?theme), "publications.europa.eu/resource/authority/data-theme"))
  OPTIONAL { ?theme skos:prefLabel ?labelIT . FILTER(LANG(?labelIT) = "it") }
  OPTIONAL { ?theme skos:prefLabel ?labelEN . FILTER(LANG(?labelEN) = "en") }
}
ORDER BY ?theme
```

### 9.2 Conteggio utilizzi per tema

```sparql
SELECT ?theme ?themeLabel (COUNT(DISTINCT ?resource) AS ?totalUsage)
WHERE {
  VALUES ?theme {
    <http://publications.europa.eu/resource/authority/data-theme/AGRI>
    <http://publications.europa.eu/resource/authority/data-theme/ECON>
    # ... tutti i 13 temi
  }
  ?theme skos:prefLabel ?themeLabel .
  FILTER(LANG(?themeLabel) = "it")
  OPTIONAL { ?resource dcat:theme ?theme }
}
GROUP BY ?theme ?themeLabel
ORDER BY DESC(?totalUsage)
```

### 9.3 Risorse per un tema specifico

```sparql
SELECT DISTINCT ?resource ?label ?description
WHERE {
  ?resource dcat:theme <http://publications.europa.eu/resource/authority/data-theme/HEAL> .
  OPTIONAL { ?resource rdfs:label ?label . FILTER(LANG(?label) = "it") }
  OPTIONAL { ?resource dct:description ?description . FILTER(LANG(?description) = "it") }
}
ORDER BY ?resource
```

---

## Appendice: Vocabolario Mapping Temi-Eurovoc

schema.gov.it include il vocabolario `theme-subtheme-mapping` che mappa i temi DCAT-AP ai sottotemi Eurovoc:

- **URI**: `https://w3id.org/italia/controlled-vocabulary/theme-subtheme-mapping`
- **Titolo**: Mappatura tra Temi dei dati - Eurovoc
- **Scopo**: Allineamento per il profilo DCAT-AP_IT
- **Versione**: 0.1 (2018-02-12)

Questo vocabolario può essere utilizzato per una classificazione più granulare dei dataset.

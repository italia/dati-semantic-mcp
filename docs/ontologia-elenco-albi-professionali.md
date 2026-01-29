# Ontologia Elenco e Albi Professionali

Analisi e proposta per un'ontologia core degli **Elenchi** su schema.gov.it, con specializzazione per gli **Albi Professionali**.

## Indice

- [Contesto](#contesto)
- [Stato attuale su schema.gov.it](#stato-attuale-su-schemagovit)
- [Proposta: Pattern Elenco](#proposta-pattern-elenco)
- [Specializzazione: Albo Professionale](#specializzazione-albo-professionale)
- [Casi d'uso](#casi-duso)
- [Vocabolari controllati](#vocabolari-controllati)
- [Prossimi passi](#prossimi-passi)

---

## Contesto

### Obiettivo

Creare un'ontologia core per il concetto di **Elenco** come lista di oggetti emessi/gestiti da un'organizzazione. Gli oggetti possono essere:

- **Persone** (iscritti a un albo, soci, ammessi a un concorso)
- **Oggetti fisici** (beni inventariati, immobili)
- **Oggetti immateriali** (brevetti, marchi, titoli)

L'**Albo Professionale** è una specializzazione di questo pattern generale.

### Principi di design

1. **Riuso** delle ontologie OntoPiA esistenti (l0, CPV, COV, CLV, TI)
2. **Generalizzazione** del pattern per massimizzare il riutilizzo
3. **Reificazione** delle iscrizioni come eventi temporali
4. **Allineamento** con i concetti già presenti in schema.gov.it

---

## Stato attuale su schema.gov.it

### Ontologie fondazionali disponibili

| Ontologia | Namespace | Descrizione |
|-----------|-----------|-------------|
| **l0** | `https://w3id.org/italia/onto/l0/` | Entità fondazionali (Entity, Collection, Object, Agent) |
| **CPV** | `https://w3id.org/italia/onto/CPV/` | Persone |
| **COV** | `https://w3id.org/italia/onto/COV/` | Organizzazioni |
| **CLV** | `https://w3id.org/italia/onto/CLV/` | Indirizzi e luoghi |
| **TI** | `https://w3id.org/italia/onto/TI/` | Tempo e intervalli temporali |

### Concetti chiave esistenti

#### l0:Collection
```
URI: https://w3id.org/italia/onto/l0/Collection
Label: Collezione / Collection
Definizione: "La classe che include collezioni di qualsiasi cosa"
Superclasse: l0:Entity
Stato: stabile
```

#### l0:hasMember
```
URI: https://w3id.org/italia/onto/l0/hasMember
Label: ha membro / has member
Definizione: "La proprietà che modella la relazione di membership"
Stato: stabile
```

#### l0:Entity
```
URI: https://w3id.org/italia/onto/l0/Entity
Label: Entità / Entity
Definizione: "Qualsiasi cosa reale, possibile o immaginaria"
Stato: stabile
```

### Concetti esistenti per Albi Professionali (INPS socialSafetyNet)

| Classe | URI | Descrizione |
|--------|-----|-------------|
| `AlboProfessionale` | `https://w3id.org/italia/social-security/onto/socialSafetyNet/AlboProfessionale` | Registro delle persone abilitate a esercitare una professione |
| `OrdineProfessionale` | `https://w3id.org/italia/social-security/onto/socialSafetyNet/OrdineProfessionale` | Ente di autogoverno della professione |
| `IscrizioneAlboProfessionale` | `https://w3id.org/italia/social-security/onto/socialSafetyNet/IscrizioneAlboProfessionale` | Evento di iscrizione (subclass di TI:TimeIndexedEvent) |
| `ElencodiAlboProfessionale` | `https://w3id.org/italia/social-security/onto/socialSafetyNet/ElencodiAlboProfessionale` | Sezioni/elenchi dell'albo |
| `TipoDiProfessione` | `https://w3id.org/italia/social-security/onto/socialSafetyNet/TipoDiProfessione` | Tipo di professione |

#### Proprietà esistenti

| Proprietà | Tipo | Descrizione |
|-----------|------|-------------|
| `dataIscrizioneAlboProfessionale` | DatatypeProperty | Data di iscrizione |
| `numeroIscrizioneAlboProfessionale` | DatatypeProperty | Numero di iscrizione |
| `haAlboProfessionale` | ObjectProperty | Relazione con l'albo |
| `haAlboProfessionaleLocalizzatoIn` | ObjectProperty | Localizzazione territoriale |
| `èIscrittoAlboProfessionale` | ObjectProperty | Relazione di iscrizione |

### Altri concetti rilevanti

| Concetto | URI | Note |
|----------|-----|------|
| `Profession` | `https://w3id.org/italia/onto/Learning/Profession` | Professione (in ontologia Learning) |
| `enablesProfession` | `https://w3id.org/italia/onto/Learning/enablesProfession` | Titolo che abilita alla professione |
| Vocabolario "Ordine e collegio professionale" | `legal-status/2730` | Forma giuridica |

---

## Proposta: Pattern Elenco

### Idea centrale

Un **Elenco** è una `l0:Collection` con caratteristiche aggiuntive:

1. È **istituito e gestito** da un'Organizzazione
2. Ha **regole di ammissione** (criteri)
3. Ha un **ciclo di vita** (istituzione, aggiornamento, chiusura)
4. I membri sono **iscritti** tramite un evento formale (VoceElenco)
5. Può essere **pubblico** o **riservato**

### Gerarchia delle classi

```
l0:Entity
  └── l0:Collection
        └── Elenco (Register / Official List)
              ├── ElencoPersone
              │     ├── AlboProfessionale
              │     ├── ElencoSoci
              │     ├── Graduatoria
              │     └── ListaElettorale
              ├── ElencoOggetti
              │     ├── Inventario
              │     └── Catalogo
              └── ElencoImmobili
                    ├── RegistroImmobiliare
                    └── Catasto
```

### Schema delle relazioni

```
┌──────────────────────┐                         ┌──────────────────────┐
│                      │                         │                      │
│    COV:Organization  │────istituisce──────────►│       Elenco         │
│                      │────gestisce────────────►│                      │
│                      │                         │                      │
└──────────────────────┘                         └──────────┬───────────┘
                                                            │
                                                   hasMember│
                                                            ▼
┌──────────────────────┐                         ┌──────────────────────┐
│                      │                         │                      │
│     l0:Entity        │◄───entitàIscritta──────│     VoceElenco       │
│  (cosa iscritta)     │                         │  (membership         │
│                      │                         │   reificata)         │
└──────────────────────┘                         └──────────────────────┘
```

### Classi proposte

#### Elenco

```turtle
@prefix elenco: <https://w3id.org/italia/onto/Elenco/> .
@prefix l0: <https://w3id.org/italia/onto/l0/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

elenco:Elenco a owl:Class ;
    rdfs:subClassOf l0:Collection ;
    rdfs:label "Elenco"@it , "Register"@en ;
    rdfs:comment """Lista ufficiale di entità (persone, oggetti, immobili) istituita
                    e gestita da un'organizzazione secondo regole definite."""@it ;
    rdfs:comment """Official list of entities (persons, objects, properties) established
                    and managed by an organization according to defined rules."""@en .
```

#### VoceElenco (membership reificata)

```turtle
elenco:VoceElenco a owl:Class ;
    rdfs:subClassOf TI:TimeIndexedEvent ;
    rdfs:label "Voce di elenco"@it , "Register Entry"@en ;
    rdfs:comment """Iscrizione di un'entità in un elenco, con validità temporale
                    e attributi specifici del contesto."""@it .
```

#### Specializzazioni per tipo di entità

```turtle
elenco:ElencoPersone a owl:Class ;
    rdfs:subClassOf elenco:Elenco ;
    rdfs:label "Elenco di persone"@it , "Register of Persons"@en ;
    rdfs:comment "Elenco i cui membri sono persone fisiche o giuridiche."@it .

elenco:ElencoOggetti a owl:Class ;
    rdfs:subClassOf elenco:Elenco ;
    rdfs:label "Elenco di oggetti"@it , "Register of Objects"@en ;
    rdfs:comment "Elenco i cui membri sono oggetti fisici o immateriali."@it .

elenco:ElencoImmobili a owl:Class ;
    rdfs:subClassOf elenco:Elenco ;
    rdfs:label "Elenco di immobili"@it , "Property Register"@en ;
    rdfs:comment "Elenco i cui membri sono beni immobili."@it .
```

### Proprietà proposte

#### Object Properties

| Proprietà | Dominio | Range | Descrizione |
|-----------|---------|-------|-------------|
| `istituisce` | `COV:Organization` | `Elenco` | L'organizzazione che ha istituito l'elenco |
| `gestisce` | `COV:Organization` | `Elenco` | L'organizzazione che gestisce l'elenco |
| `haVoce` | `Elenco` | `VoceElenco` | Le voci contenute nell'elenco |
| `èVoceDi` | `VoceElenco` | `Elenco` | Inversa di haVoce |
| `entitàIscritta` | `VoceElenco` | `l0:Entity` | L'entità oggetto dell'iscrizione |
| `statoVoce` | `VoceElenco` | `StatoVoce` | Stato della voce (attiva, sospesa, cancellata) |
| `motivoCancellazione` | `VoceElenco` | `MotivoCancellazione` | Motivo della cancellazione |
| `haSezione` | `Elenco` | `SezioneElenco` | Sezioni/partizioni dell'elenco |

#### Datatype Properties

| Proprietà | Dominio | Range | Descrizione |
|-----------|---------|-------|-------------|
| `denominazione` | `Elenco` | `xsd:string` | Nome ufficiale dell'elenco |
| `dataIstituzione` | `Elenco` | `xsd:date` | Data di istituzione |
| `dataChiusura` | `Elenco` | `xsd:date` | Data di chiusura (se chiuso) |
| `èPubblico` | `Elenco` | `xsd:boolean` | Se l'elenco è pubblicamente consultabile |
| `numeroIscrizione` | `VoceElenco` | `xsd:string` | Numero/codice di iscrizione |
| `dataIscrizione` | `VoceElenco` | `xsd:date` | Data di iscrizione |
| `dataCancellazione` | `VoceElenco` | `xsd:date` | Data di cancellazione |

---

## Specializzazione: Albo Professionale

### Definizione

L'**Albo Professionale** è un `ElencoPersone` con caratteristiche specifiche:

- È gestito da un **Ordine o Collegio professionale**
- L'iscrizione richiede **requisiti specifici** (titolo di studio, esame di stato)
- Ha **sezioni** (ordinaria, speciale, praticanti)
- È soggetto a **vigilanza ministeriale**

### Classi specifiche

```turtle
@prefix albo: <https://w3id.org/italia/onto/AlboProfessionale/> .

albo:AlboProfessionale a owl:Class ;
    rdfs:subClassOf elenco:ElencoPersone ;
    rdfs:label "Albo professionale"@it , "Professional Register"@en ;
    rdfs:comment """Elenco ufficiale delle persone abilitate all'esercizio
                    di una professione regolamentata dalla legge."""@it .

albo:OrdineProfessionale a owl:Class ;
    rdfs:subClassOf COV:Organization ;
    rdfs:label "Ordine professionale"@it , "Professional Association"@en ;
    rdfs:comment """Ente di autogoverno di una professione con funzioni di
                    abilitazione, controllo e sorveglianza."""@it .

albo:IscrizioneAlbo a owl:Class ;
    rdfs:subClassOf elenco:VoceElenco ;
    rdfs:label "Iscrizione all'albo"@it , "Professional Register Entry"@en .

albo:SezioneAlbo a owl:Class ;
    rdfs:subClassOf elenco:SezioneElenco ;
    rdfs:label "Sezione dell'albo"@it , "Register Section"@en .

albo:EsameDiStato a owl:Class ;
    rdfs:subClassOf TI:TimeIndexedEvent ;
    rdfs:label "Esame di Stato"@it , "State Examination"@en ;
    rdfs:comment "Esame di abilitazione all'esercizio della professione."@it .

albo:Praticantato a owl:Class ;
    rdfs:subClassOf TI:TimeIndexedEvent ;
    rdfs:label "Praticantato"@it , "Traineeship"@en ;
    rdfs:comment "Periodo di tirocinio obbligatorio per l'accesso alla professione."@it .

albo:ProfessioneRegolamentata a owl:Class ;
    rdfs:subClassOf l0:Object ;
    rdfs:label "Professione regolamentata"@it , "Regulated Profession"@en ;
    rdfs:comment """Professione il cui esercizio è subordinato al possesso
                    di specifiche qualifiche professionali."""@it .
```

### Proprietà specifiche

| Proprietà | Dominio | Range | Descrizione |
|-----------|---------|-------|-------------|
| `regolaProfessione` | `AlboProfessionale` | `ProfessioneRegolamentata` | Professione regolamentata dall'albo |
| `ministeroVigilante` | `AlboProfessionale` | `COV:Organization` | Ministero che esercita la vigilanza |
| `richiedeEsameDiStato` | `AlboProfessionale` | `xsd:boolean` | Se richiede esame di abilitazione |
| `haSuperatoEsame` | `IscrizioneAlbo` | `EsameDiStato` | Esame superato per l'iscrizione |
| `haCompletato Praticantato` | `IscrizioneAlbo` | `Praticantato` | Praticantato completato |
| `sezione` | `IscrizioneAlbo` | `SezioneAlbo` | Sezione dell'albo |

### Ciclo di vita dell'iscritto

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Titolo    │────►│ Praticantato│────►│  Esame di   │────►│  Iscrizione │
│   Studio    │     │             │     │    Stato    │     │    Albo     │
└─────────────┘     └─────────────┘     └─────────────┘     └──────┬──────┘
                                                                   │
                                              ┌────────────────────┼────────────────────┐
                                              ▼                    ▼                    ▼
                                        ┌───────────┐        ┌───────────┐        ┌───────────┐
                                        │  Attivo   │───────►│  Sospeso  │───────►│ Cancellato│
                                        └───────────┘        └───────────┘        └───────────┘
```

---

## Casi d'uso

Il pattern **Elenco** copre diversi scenari applicativi:

| Dominio | Elenco | VoceElenco | Entità iscritta | Organizzazione |
|---------|--------|------------|-----------------|----------------|
| **Professioni** | `AlboProfessionale` | `IscrizioneAlbo` | `CPV:Person` | `OrdineProfessionale` |
| **Associazionismo** | `ElencoSoci` | `Associazione` | `CPV:Person` | `Associazione` |
| **Concorsi** | `Graduatoria` | `PosizioneGraduatoria` | `CPV:Person` | `PA` |
| **Fornitori PA** | `AlboFornitori` | `IscrizioneFornitore` | `COV:Organization` | `PA` |
| **Beni culturali** | `CatalogoBeniCulturali` | `SchedaCatalogo` | `BeneCulturale` | `MiC` |
| **Immobili** | `RegistroImmobiliare` | `VoceRegistro` | `Immobile` | `AgenziaEntrate` |
| **Inventario** | `Inventario` | `VoceInventario` | `l0:Object` | `Ente` |

---

## Vocabolari controllati

### Vocabolari da creare

| Vocabolario | Descrizione | Esempi valori |
|-------------|-------------|---------------|
| `tipo-elenco` | Tipologie di elenco | albo, registro, graduatoria, inventario, catalogo |
| `stato-voce` | Stato della voce | attiva, sospesa, cancellata |
| `motivo-cancellazione` | Motivi di cancellazione | rinuncia, decesso, radiazione, trasferimento |
| `professioni-regolamentate` | Professioni regolamentate | avvocato, medico, ingegnere, architetto, ... |
| `sezioni-albo` | Sezioni tipiche degli albi | ordinaria, speciale, elenco praticanti |
| `ministeri-vigilanti` | Ministeri con funzione di vigilanza | Giustizia, Salute, Economia, ... |

### Vocabolari esistenti riutilizzabili

| Vocabolario | URI | Uso |
|-------------|-----|-----|
| Forme giuridiche | `legal-status` | Include "Ordine e collegio professionale" (2730) |
| Comuni | `territorial-classifications/cities` | Localizzazione territoriale degli ordini |

---

## Prossimi passi

### Fase 1: Validazione del modello

1. [ ] Confronto con esperti di dominio (ordini professionali)
2. [ ] Verifica compatibilità con ontologia INPS esistente
3. [ ] Allineamento con standard europei (es. Direttiva 2005/36/CE sulle qualifiche professionali)

### Fase 2: Sviluppo ontologia core Elenco

1. [ ] Scrittura file OWL/Turtle per `Elenco`
2. [ ] Definizione SHACL shapes per validazione
3. [ ] Creazione vocabolari controllati base

### Fase 3: Specializzazione Albi Professionali

1. [ ] Estensione per dominio albi professionali
2. [ ] Integrazione con ontologia INPS `socialSafetyNet`
3. [ ] Vocabolario professioni regolamentate

### Fase 4: Pilota e iterazione

1. [ ] Selezione ordine professionale pilota
2. [ ] Mapping dati esistenti
3. [ ] Validazione e raffinamento

---

## Riferimenti

### Ontologie OntoPiA

- [l0 - Level 0](https://w3id.org/italia/onto/l0)
- [CPV - Core Person Vocabulary](https://w3id.org/italia/onto/CPV)
- [COV - Core Organization Vocabulary](https://w3id.org/italia/onto/COV)
- [CLV - Core Location Vocabulary](https://w3id.org/italia/onto/CLV)
- [TI - Time Ontology](https://w3id.org/italia/onto/TI)

### Endpoint SPARQL

- schema.gov.it: `https://virtuoso-dev.containers.cloud.italia.it/sparql`

### Normativa

- D.P.R. 137/2012 - Riforma degli ordini professionali
- Direttiva 2005/36/CE - Qualifiche professionali

---

*Documento generato il 2026-01-29*

# Ontologia degli Elenchi Pubblicati (PublishedRegistry)

## Sommario

Proposta di ontologia per modellare elenchi e registri pubblicati da organizzazioni, generalizzando il concetto di Albo Professionale già presente in schema.gov.it per coprire:

- **Elenchi di persone**: albi professionali, libri soci, graduatorie, elenchi ammessi
- **Elenchi di oggetti materiali**: registri immobiliari, inventari beni
- **Elenchi di oggetti immateriali**: calendari eventi, cataloghi servizi

---

## 1. Contesto e Motivazione

### 1.1 Stato attuale in schema.gov.it

L'ontologia `socialSafetyNet` contiene già una modellazione specifica per gli albi professionali:

| Classe | Descrizione |
|--------|-------------|
| `OrdineProfessionale` | Ente di autogoverno della professione |
| `AlboProfessionale` | Registro degli iscritti |
| `ElencodiAlboProfessionale` | Suddivisione dell'albo (es. professionisti/pubblicisti) |
| `IscrizioneAlboProfessionale` | Evento di iscrizione (subclass di `TimeIndexedEvent`) |

### 1.2 Limitazioni

- Modellazione specifica solo per albi professionali
- Non riutilizzabile per altri tipi di elenchi (soci, ammessi, beni, eventi)
- Manca un pattern generale per "elenco pubblicato da un'organizzazione"

### 1.3 Obiettivo

Creare un'ontologia generalizzata che:
1. Riutilizzi i pattern esistenti (`l0:Collection`, `TI:TimeIndexedEvent`, `COV:Organization`)
2. Permetta di modellare qualsiasi tipo di elenco pubblicato
3. Mantenga compatibilità con l'esistente `socialSafetyNet`

---

## 2. Design dell'Ontologia

### 2.1 Diagramma Concettuale

```
                         ┌─────────────────────────┐
                         │    COV:Organization     │
                         │   (Ente pubblicatore)   │
                         └───────────┬─────────────┘
                                     │ :pubblica
                                     ▼
┌────────────────────────────────────────────────────────────────┐
│                    :PublishedRegistry                          │
│              (Elenco/Registro Pubblicato)                      │
│                  subClassOf l0:Collection                      │
│  ────────────────────────────────────────────────────────────  │
│  Proprietà:                                                    │
│  • :nome (xsd:string)                                          │
│  • :descrizione (xsd:string)                                   │
│  • :baseNormativa (xsd:string)                                 │
│  • :dataIstituzione (xsd:date)                                 │
│  • :pubblicatoDa → COV:Organization                            │
│  • :haSezione → :RegistrySection                               │
│  • :tipoContenuto → :RegistryContentType                       │
│  • :tipoRegistro → :RegistryType                               │
└───────────────────────────────┬────────────────────────────────┘
                                │ :haVoce
                                ▼
┌────────────────────────────────────────────────────────────────┐
│                      :RegistryEntry                            │
│                 (Voce/Iscrizione nel registro)                 │
│               subClassOf TI:TimeIndexedEvent                   │
│  ────────────────────────────────────────────────────────────  │
│  Proprietà:                                                    │
│  • :identificativoVoce (xsd:string)                            │
│  • :dataIscrizione (xsd:date)                                  │
│  • :dataCessazione (xsd:date) [opzionale]                      │
│  • :stato → :EntryStatus                                       │
│  • :motivoIscrizione (xsd:string)                              │
│  • :motivoCessazione (xsd:string)                              │
│  • :inRegistro → :PublishedRegistry                            │
│  • :riferimentoA → l0:Entity                                   │
│  • :annotazioni (xsd:string)                                   │
└───────────────────────────────┬────────────────────────────────┘
                                │ :riferimentoA
                                ▼
┌────────────────────────────────────────────────────────────────┐
│                        l0:Entity                               │
│  ────────────────────────────────────────────────────────────  │
│  Sottoclassi utilizzabili:                                     │
│  • CPV:Person (professionista, socio, ammesso a concorso)      │
│  • COV:Organization (ente, azienda fornitrice)                 │
│  • CLV:Feature (immobile, luogo, indirizzo)                    │
│  • CPEV:Event (evento culturale, manifestazione)               │
│  • l0:Object (bene mobile, opera, documento)                   │
└────────────────────────────────────────────────────────────────┘
```

### 2.2 Classi Principali

#### PublishedRegistry (Registro Pubblicato)

Classe principale che rappresenta un elenco/registro pubblicato ufficialmente da un'organizzazione.

| Proprietà | Tipo | Descrizione |
|-----------|------|-------------|
| `nome` | `xsd:string` | Nome ufficiale del registro |
| `descrizione` | `xsd:string` | Descrizione delle finalità |
| `baseNormativa` | `xsd:string` | Riferimento normativo istitutivo |
| `dataIstituzione` | `xsd:date` | Data di istituzione |
| `pubblicatoDa` | `COV:Organization` | Ente che pubblica e gestisce |
| `haSezione` | `RegistrySection` | Eventuali sezioni/sottoelenchi |
| `tipoContenuto` | `RegistryContentType` | Tipo di entità contenute |
| `tipoRegistro` | `RegistryType` | Classificazione del registro |
| `haVoce` | `RegistryEntry` | Voci/iscrizioni contenute |

#### RegistryEntry (Voce del Registro)

Rappresenta una singola iscrizione/voce nel registro. Estende `TimeIndexedEvent` per gestire la validità temporale.

| Proprietà | Tipo | Descrizione |
|-----------|------|-------------|
| `identificativoVoce` | `xsd:string` | Numero/codice univoco |
| `dataIscrizione` | `xsd:date` | Data di inserimento |
| `dataCessazione` | `xsd:date` | Data di cancellazione (opzionale) |
| `stato` | `EntryStatus` | Stato corrente della voce |
| `motivoIscrizione` | `xsd:string` | Motivo/titolo di iscrizione |
| `motivoCessazione` | `xsd:string` | Motivo della cancellazione |
| `inRegistro` | `PublishedRegistry` | Registro di appartenenza |
| `riferimentoA` | `l0:Entity` | Entità iscritta |
| `annotazioni` | `xsd:string` | Note aggiuntive |

#### RegistrySection (Sezione del Registro)

Suddivisione interna di un registro (es. sezione A/B di un albo, categorie di un elenco).

| Proprietà | Tipo | Descrizione |
|-----------|------|-------------|
| `nome` | `xsd:string` | Nome della sezione |
| `descrizione` | `xsd:string` | Criteri di appartenenza |
| `codice` | `xsd:string` | Codice identificativo |
| `sezioneDelRegistro` | `PublishedRegistry` | Registro padre |

### 2.3 Vocabolari Controllati

#### RegistryContentType (Tipo di Contenuto)

```
- Person          : Persone fisiche
- Organization    : Enti e organizzazioni
- RealEstate      : Beni immobili
- MovableAsset    : Beni mobili
- Event           : Eventi
- Service         : Servizi
- Document        : Documenti
- Mixed           : Contenuto misto
```

#### EntryStatus (Stato della Voce)

```
- Active          : Attivo/Vigente
- Suspended       : Sospeso
- Cancelled       : Cancellato
- Expired         : Scaduto
- Pending         : In attesa di conferma
- UnderReview     : In revisione
```

#### RegistryType (Tipo di Registro)

```
- ProfessionalRegister    : Albo professionale
- MembershipRoll          : Libro soci
- SelectionList           : Graduatoria/Elenco ammessi
- QualifiedSupplierList   : Elenco fornitori qualificati
- PublicInventory         : Inventario pubblico
- EventCalendar           : Calendario eventi
- ServiceCatalog          : Catalogo servizi
- ProtectedList           : Elenco tutelati (es. testimoni)
```

---

## 3. Specializzazioni

### 3.1 Gerarchia delle Classi

```
PublishedRegistry
├── ProfessionalRegister      # Albo professionale
├── MembershipRoll            # Libro soci
├── SelectionList             # Graduatoria/ammessi
├── QualifiedSupplierList     # Fornitori qualificati
├── AssetRegistry             # Registro beni
└── EventCalendar             # Calendario eventi

RegistryEntry
├── ProfessionalRegistration  # Iscrizione albo
├── MembershipEntry           # Adesione socio
├── AdmissionEntry            # Ammissione concorso
├── SupplierQualification     # Qualifica fornitore
└── AssetRegistration         # Registrazione bene
```

### 3.2 Mapping con Ontologia Esistente

| Classe socialSafetyNet | Mapping |
|------------------------|---------|
| `AlboProfessionale` | `owl:equivalentClass` → `ProfessionalRegister` |
| `ElencodiAlboProfessionale` | `owl:equivalentClass` → `RegistrySection` |
| `IscrizioneAlboProfessionale` | `owl:equivalentClass` → `ProfessionalRegistration` |
| `OrdineProfessionale` | `rdfs:subClassOf` → `COV:Organization` con ruolo publisher |

---

## 4. Esempi d'Uso

### 4.1 Albo degli Ingegneri

- **Registro**: Albo degli Ingegneri della Provincia di Roma
- **Pubblicato da**: Ordine degli Ingegneri della Provincia di Roma
- **Sezioni**: A (laurea magistrale), B (laurea triennale)
- **Voci**: Iscrizioni dei singoli ingegneri

### 4.2 Libro Soci di un'Associazione

- **Registro**: Libro Soci dell'Associazione XYZ
- **Pubblicato da**: Associazione XYZ
- **Voci**: Adesioni dei soci (ordinari, sostenitori, onorari)

### 4.3 Graduatoria Concorso Pubblico

- **Registro**: Graduatoria finale - Concorso 100 posti Funzionario
- **Pubblicato da**: Ministero dell'Interno
- **Voci**: Ammessi con punteggio e posizione

### 4.4 Registro Immobili Comunali

- **Registro**: Inventario Beni Immobili del Comune
- **Pubblicato da**: Comune di Bologna
- **Voci**: Singoli immobili con dati catastali

### 4.5 Calendario Eventi Culturali

- **Registro**: Calendario Manifestazioni 2024
- **Pubblicato da**: Regione Emilia-Romagna
- **Voci**: Eventi con date, luoghi, tipologia

---

## 5. Considerazioni Implementative

### 5.1 Namespace Proposto

```
@prefix preg: <https://w3id.org/italia/onto/PublishedRegistry/> .
```

### 5.2 Dipendenze

L'ontologia richiede l'import di:
- `l0` - Ontologia di livello 0 (Entity, Collection)
- `TI` - Time Indexed (TimeIndexedEvent)
- `COV` - Core Organization Vocabulary (Organization)
- `CPV` - Core Person Vocabulary (Person)
- `CLV` - Core Location Vocabulary (Feature)
- `CPEV` - Core Public Event Vocabulary (Event)

### 5.3 Vincoli OWL Suggeriti

1. `RegistryEntry` deve avere esattamente un `inRegistro`
2. `RegistryEntry` deve avere esattamente un `riferimentoA`
3. `PublishedRegistry` deve avere almeno un `pubblicatoDa`
4. Se `dataCessazione` è presente, `stato` deve essere `Cancelled` o `Expired`

---

## 6. Prossimi Passi

1. **Validazione**: Revisione con stakeholder (INPS, ordini professionali, ANAC)
2. **Allineamento**: Verifica compatibilità con ontologie EU (CPSV-AP, DCAT-AP)
3. **Vocabolari**: Definizione completa dei controlled vocabulary
4. **Pilota**: Test su un caso d'uso reale (es. Albo Ingegneri + Libro Soci)
5. **Pubblicazione**: Integrazione in schema.gov.it

---

## Appendice A: Esempio Completo in Turtle

Vedere il file allegato `esempio-pubblichedregistry.ttl` per un esempio completo di utilizzo dell'ontologia.

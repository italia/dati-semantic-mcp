# Mappatura di una lista di persone con le ontologie di schema.gov.it

Scenario: mappare una lista di persone con **nome**, **cognome**, **data e luogo di nascita**, **ID ANPR**, **indirizzo** ed **email**.

## Ontologie coinvolte

| Prefisso | Ontologia | URI | A cosa serve |
|---|---|---|---|
| `cpv` | Core Person Vocabulary | `https://w3id.org/italia/onto/CPV/` | Dati anagrafici della persona |
| `clv` | Core Location Vocabulary | `https://w3id.org/italia/onto/CLV/` | Indirizzo e luogo di nascita |
| `sm` | Social Media / Contact Point | `https://w3id.org/italia/onto/SM/` | Email e punti di contatto |
| `l0` | Level-0 (top-level) | `https://w3id.org/italia/onto/l0/` | Proprietà generiche (name, identifier) |
| `ti` | Time Interval | `https://w3id.org/italia/onto/TI/` | Intervalli temporali |

## Mappatura campo per campo

| Campo sorgente | Proprietà OntoPiA | Dominio | Range | Note |
|---|---|---|---|---|
| **Nome** | `cpv:givenName` | `cpv:Person` | `xsd:string` | |
| **Cognome** | `cpv:familyName` | `cpv:Person` | `xsd:string` | |
| **Nome completo** | `cpv:fullName` | `cpv:Person` | `rdf:PlainLiteral` | Opzionale, concatenazione di nome e cognome |
| **Data di nascita** | `cpv:dateOfBirth` | `cpv:Person` | `xsd:dateTime` | |
| **Luogo di nascita** | `cpv:hasBirthPlace` | `cpv:Person` | `l0:Location` | Punta a un `clv:City` del vocabolario controllato dei comuni |
| **ID ANPR** | `cpv:personID` | `cpv:Person` | `xsd:string` | Identificativo persona; per specificare il tipo si usa un `clv:Identifier` collegato |
| **Codice fiscale** | `cpv:taxCode` | `cpv:Person` | `rdfs:Literal` | Se disponibile |
| **Indirizzo** | `clv:hasAddress` | `owl:Thing` | `clv:Address` | Indirizzo attuale; oppure `clv:hasAdressinTime` per storicizzarlo |
| **Email** | `sm:hasOnlineContactPoint` → `sm:hasEmail` | `owl:Thing` → `sm:OnlineContactPoint` | `sm:Email` | Catena: Persona → Punto di contatto online → Email |

## Struttura dell'indirizzo (CLV)

L'indirizzo in OntoPiA non è una stringa piatta ma un oggetto strutturato:

```
clv:Address
  ├── clv:fullAddress          → "Via Roma 42, 00184 Roma RM"  (stringa completa)
  ├── clv:hasStreetToponym     → clv:StreetToponym
  │     ├── clv:toponymQualifier  → "Via"  (DUG)
  │     └── clv:officialStreetName → "Roma" (DUF)
  ├── clv:hasNumber            → clv:CivicNumbering
  │     └── clv:streetNumber      → 42
  ├── clv:postCode             → "00184"  (CAP)
  ├── clv:hasCity              → clv:City  (dal vocabolario controllato)
  ├── clv:hasProvince          → clv:Province
  └── clv:hasRegion            → clv:Region
```

## Struttura dell'email (SM)

```
sm:OnlineContactPoint
  └── sm:hasEmail → sm:Email
        ├── sm:emailAddress    → "mario.rossi@example.com"^^xsd:anyURI
        └── sm:hasEmailType    → sm:EmailType  (PEC o tradizionale)
```

## Schema del grafo

```
                           cpv:givenName ──▶ "Mario"
                           cpv:familyName ──▶ "Rossi"
                           cpv:dateOfBirth ──▶ "1985-03-15"
                           cpv:personID ──▶ "ANPR-123456"
                           cpv:taxCode ──▶ "RSSMRA85C15H501X"
                                │
                          cpv:Person
                         /     |     \
                        /      |      \
     cpv:hasBirthPlace    clv:hasAddress   sm:hasOnlineContactPoint
           |                   |                    |
       clv:City          clv:Address        sm:OnlineContactPoint
    (Roma, dal CV)            |                    |
                         ┌────┼────┐          sm:hasEmail
                         │    │    │               |
                   Toponimo  N.Civ  CAP        sm:Email
                  "Via Roma"  42   "00184"         |
                                           sm:emailAddress
                                       "mario.rossi@example.com"
```

## Esempio completo in Turtle (RDF)

Due persone: Mario Rossi (Roma) e Giulia Bianchi (Milano).

```turtle
@prefix rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .
@prefix l0:   <https://w3id.org/italia/onto/l0/> .
@prefix cpv:  <https://w3id.org/italia/onto/CPV/> .
@prefix clv:  <https://w3id.org/italia/onto/CLV/> .
@prefix sm:   <https://w3id.org/italia/onto/SM/> .
@prefix ti:   <https://w3id.org/italia/onto/TI/> .
@prefix ex:   <http://example.org/data/> .

# --------------------------------------------------------------
# PERSONA 1: Mario Rossi
# --------------------------------------------------------------

<http://example.org/data/persona/RSSMRA85C15H501X>
    a                               cpv:Person , cpv:Alive , cpv:Male ;
    cpv:givenName                   "Mario" ;
    cpv:familyName                  "Rossi" ;
    cpv:fullName                    "Mario Rossi" ;
    cpv:dateOfBirth                 "1985-03-15"^^xsd:dateTime ;
    cpv:taxCode                     "RSSMRA85C15H501X" ;
    cpv:personID                    "ANPR-00123456" ;
    clv:hasIdentifier               <http://example.org/data/id-anpr/rossi> ;
    cpv:hasBirthPlace               <https://w3id.org/italia/controlled-vocabulary/territorial-classifications/cities/058091-(2015-01-01)> ;
    clv:hasAddress                  <http://example.org/data/indirizzo/rossi-residenza> ;
    sm:hasOnlineContactPoint        <http://example.org/data/contatto/rossi-online> .

# ID ANPR strutturato
<http://example.org/data/id-anpr/rossi>
    a                               clv:Identifier ;
    l0:identifier                   "ANPR-00123456" ;
    clv:identifierType              "ID ANPR" ;
    clv:issuedBy                    <https://w3id.org/italia/data/public-organization/m_it> .

# Indirizzo strutturato
<http://example.org/data/indirizzo/rossi-residenza>
    a                               clv:Address ;
    clv:fullAddress                 "Via Roma 42, 00184 Roma RM"@it ;
    clv:postCode                    "00184" ;
    clv:hasCity                     <https://w3id.org/italia/controlled-vocabulary/territorial-classifications/cities/058091-(2015-01-01)> ;
    clv:hasProvince                 <https://w3id.org/italia/controlled-vocabulary/territorial-classifications/provinces/058> ;
    clv:hasRegion                   <https://w3id.org/italia/controlled-vocabulary/territorial-classifications/regions/12> ;
    clv:hasStreetToponym            <http://example.org/data/toponimo/via-roma-42> ;
    clv:hasNumber                   <http://example.org/data/civico/roma-42> .

<http://example.org/data/toponimo/via-roma-42>
    a                               clv:StreetToponym ;
    clv:toponymQualifier            "Via" ;
    clv:officialStreetName          "Roma" .

<http://example.org/data/civico/roma-42>
    a                               clv:CivicNumbering ;
    clv:streetNumber                42 .

# Punto di contatto online con email
<http://example.org/data/contatto/rossi-online>
    a                               sm:OnlineContactPoint ;
    sm:hasEmail                     <http://example.org/data/email/rossi> .

<http://example.org/data/email/rossi>
    a                               sm:Email ;
    sm:emailAddress                 "mario.rossi@example.com"^^xsd:anyURI ;
    sm:hasEmailType                 <http://example.org/data/email-type/tradizionale> .

# --------------------------------------------------------------
# PERSONA 2: Giulia Bianchi
# --------------------------------------------------------------

<http://example.org/data/persona/BNCGLI90A41F205Y>
    a                               cpv:Person , cpv:Alive , cpv:Female ;
    cpv:givenName                   "Giulia" ;
    cpv:familyName                  "Bianchi" ;
    cpv:fullName                    "Giulia Bianchi" ;
    cpv:dateOfBirth                 "1990-01-01"^^xsd:dateTime ;
    cpv:taxCode                     "BNCGLI90A41F205Y" ;
    cpv:personID                    "ANPR-00789012" ;
    clv:hasIdentifier               <http://example.org/data/id-anpr/bianchi> ;
    cpv:hasBirthPlace               <https://w3id.org/italia/controlled-vocabulary/territorial-classifications/cities/015146-(2019-02-04)> ;
    clv:hasAddress                  <http://example.org/data/indirizzo/bianchi-residenza> ;
    sm:hasOnlineContactPoint        <http://example.org/data/contatto/bianchi-online> .

# ID ANPR strutturato
<http://example.org/data/id-anpr/bianchi>
    a                               clv:Identifier ;
    l0:identifier                   "ANPR-00789012" ;
    clv:identifierType              "ID ANPR" ;
    clv:issuedBy                    <https://w3id.org/italia/data/public-organization/m_it> .

# Indirizzo strutturato
<http://example.org/data/indirizzo/bianchi-residenza>
    a                               clv:Address ;
    clv:fullAddress                 "Corso Buenos Aires 7, 20124 Milano MI"@it ;
    clv:postCode                    "20124" ;
    clv:hasCity                     <https://w3id.org/italia/controlled-vocabulary/territorial-classifications/cities/015146-(2019-02-04)> ;
    clv:hasProvince                 <https://w3id.org/italia/controlled-vocabulary/territorial-classifications/provinces/015> ;
    clv:hasRegion                   <https://w3id.org/italia/controlled-vocabulary/territorial-classifications/regions/03> ;
    clv:hasStreetToponym            <http://example.org/data/toponimo/corso-buenos-aires-7> ;
    clv:hasNumber                   <http://example.org/data/civico/buenos-aires-7> .

<http://example.org/data/toponimo/corso-buenos-aires-7>
    a                               clv:StreetToponym ;
    clv:toponymQualifier            "Corso" ;
    clv:officialStreetName          "Buenos Aires" .

<http://example.org/data/civico/buenos-aires-7>
    a                               clv:CivicNumbering ;
    clv:streetNumber                7 .

# Punto di contatto online con email (PEC)
<http://example.org/data/contatto/bianchi-online>
    a                               sm:OnlineContactPoint ;
    sm:hasEmail                     <http://example.org/data/email/bianchi> .

<http://example.org/data/email/bianchi>
    a                               sm:Email ;
    sm:emailAddress                 "giulia.bianchi@pec.example.com"^^xsd:anyURI ;
    sm:hasEmailType                 <http://example.org/data/email-type/pec> .

# --------------------------------------------------------------
# RISORSE CONDIVISE
# --------------------------------------------------------------

<http://example.org/data/email-type/tradizionale>
    a               sm:EmailType ;
    rdfs:label      "Email tradizionale"@it .

<http://example.org/data/email-type/pec>
    a               sm:EmailType ;
    rdfs:label      "Posta Elettronica Certificata (PEC)"@it .
```

## Note sull'ID ANPR

L'ontologia CPV fornisce la proprietà generica `cpv:personID` per gli identificativi delle persone. Per qualificare meglio l'identificativo ANPR, si può usare il pattern `clv:Identifier` con tipo esplicito:

```turtle
<http://example.org/data/persona/RSSMRA85C15H501X>
    clv:hasIdentifier               <http://example.org/data/id-anpr/rossi> .

<http://example.org/data/id-anpr/rossi>
    a                               clv:Identifier ;
    l0:identifier                   "ANPR-00123456" ;
    clv:identifierType              "ID ANPR" ;
    clv:issuedBy                    <https://w3id.org/italia/data/public-organization/m_it> .
```

Questo pattern permette di:
- Distinguere l'ID ANPR da altri identificativi (codice fiscale, codice regionale, ecc.)
- Indicare l'ente che lo ha rilasciato (Ministero dell'Interno)
- Associare più identificativi alla stessa persona

## Riepilogo delle proprietà utilizzate

| Ontologia | Classi | Proprietà principali |
|---|---|---|
| **CPV** | `Person`, `Alive`, `Male`, `Female` | `givenName`, `familyName`, `fullName`, `dateOfBirth`, `taxCode`, `personID`, `hasBirthPlace` |
| **CLV** | `Address`, `StreetToponym`, `CivicNumbering`, `City`, `Province`, `Region`, `Identifier` | `hasAddress`, `fullAddress`, `postCode`, `hasCity`, `hasStreetToponym`, `hasNumber`, `officialStreetName`, `toponymQualifier`, `streetNumber`, `hasIdentifier`, `identifierType` |
| **SM** | `OnlineContactPoint`, `Email`, `EmailType` | `hasOnlineContactPoint`, `hasEmail`, `emailAddress`, `hasEmailType` |

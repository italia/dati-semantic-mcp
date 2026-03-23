# Come mappare uno Studente con le ontologie di schema.gov.it

Le ontologie principali coinvolte sono tre:

## 1. CPV - Core Person Vocabulary (la persona)
- **`CPV:Person`** (Persona fisica) — la classe base che rappresenta l'individuo
- Sottoclasse di `l0:Agent`
- Fornisce proprietà anagrafiche: nome, cognome, data di nascita, codice fiscale, residenza, ecc.

## 2. RO - Role Ontology (il ruolo)
- **`RO:Role`** — classe astratta dei ruoli
- Lo **Studente** non è una "persona" a sé, ma un **ruolo** che una persona assume

## 3. Learning Ontology (il dominio formativo)
- **`Learning:Student`** — sottoclasse di `RO:Role`, rappresenta il ruolo di studente
  > *"Quando una persona si iscrive a un istituto di (alta) formazione, assume il ruolo di studente"*
- **`Learning:Enrolment`** (Iscrizione) — la classe centrale, un'**n-ary relation** che collega tra loro:

| Proprietà | Range | Descrizione |
|---|---|---|
| `isEnrolmentOf` | `CPV:Person` | la persona iscritta |
| `hasProgrammeType` | `ProgrammeType` | tipologia (triennale, magistrale, dottorato...) |
| `hasDegreeClass` | `DegreeClass` | classe di laurea (es. L-31 Informatica) |
| `hasDegreeCourse` | `DegreeCourse` | corso specifico (es. Ingegneria Informatica) |
| `hasAcademicYear` | `AcademicYear` | anno accademico |
| `hasRegistrationYear` | `AcademicYear` | anno di immatricolazione |
| `hasLastEnrolmentYear` | `AcademicYear` | ultimo anno di iscrizione |
| `hasEnrolmentStatus` | `EnrolmentStatus` | stato (immatricolato, iscritto, laureato...) |
| `hasEnrolmentValidity` | `TI:TemporalEntity` | periodo di validità |
| `atInstitute` | `Institute` | istituto di formazione |
| `hasGrade` | `Grade` | voto |

## Ontologia HER (Higher Education & Research)
Per il contesto universitario italiano esiste anche l'ontologia **HER** che specializza ulteriormente:
- **`HER:ItalianStudentType`** — sottoclasse di `RO:Role`, tipo di studente nel sistema accademico (immatricolato, iscritto, laureato, dottorando...)
- **`HER:DegreeClass`**, **`HER:DegreeArea`**, **`HER:ItalianDegree`**, **`HER:AcademicDegree`**

## Schema del grafo

```
CPV:Person ──hasEnrolment──▶ Learning:Enrolment
                                  │
                 ┌────────────────┼────────────────────┐
                 ▼                ▼                     ▼
          ProgrammeType     DegreeClass          DegreeCourse
        (triennale, mag.)  (L-31, LM-18...)   (Ing. Informatica)
                                  │
                                  ▼
                             Institute
                        (Università di Roma)

CPV:Person assume ──▶ Learning:Student (ruolo)
                      HER:ItalianStudentType (tipo specifico)
```

## Altre classi utili dell'ontologia Learning

| Classe | Descrizione |
|---|---|
| `Qualification` | Titolo di studio ottenuto |
| `Examination` / `FinalExamination` | Esame / Esame finale |
| `Grade` / `GradingScale` | Voto e scala di valutazione |
| `EducationalOffering` | Offerta formativa dell'istituto |
| `Profession` | Professione abilitata dal titolo |

## Principio di modellazione

**Non si modella "uno studente" come entità a sé**, ma come una **Persona** (`CPV:Person`) che ha una **Iscrizione** (`Learning:Enrolment`) presso un istituto, e attraverso questa assume il **ruolo** di **Studente** (`Learning:Student`). Il pattern è quello classico OntoPiA del *role-in-time*.

## Esempio completo in Turtle (RDF)

L'esempio seguente mappa una studentessa, Maria Rossi, iscritta al corso di laurea triennale in Informatica presso l'Università di Roma "La Sapienza".

```turtle
@prefix rdf:      <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs:     <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd:      <http://www.w3.org/2001/XMLSchema#> .
@prefix l0:       <https://w3id.org/italia/onto/l0/> .
@prefix cpv:      <https://w3id.org/italia/onto/CPV/> .
@prefix clv:      <https://w3id.org/italia/onto/CLV/> .
@prefix ti:       <https://w3id.org/italia/onto/TI/> .
@prefix ro:       <https://w3id.org/italia/onto/RO/> .
@prefix learning: <https://w3id.org/italia/onto/Learning/> .
@prefix her:      <https://w3id.org/italia/onto/HER/> .
@prefix ex:       <http://example.org/data/> .

# --------------------------------------------------------------
# 1. LA PERSONA
# --------------------------------------------------------------

<http://example.org/data/persona/RSSMRA00A41H501Z>
    a                       cpv:Person , cpv:Alive , cpv:Female ;
    l0:name                 "Maria Rossi" ;
    cpv:givenName           "Maria" ;
    cpv:familyName          "Rossi" ;
    cpv:dateOfBirth         "2000-01-01"^^xsd:date ;
    cpv:taxCode             "RSSMRA00A41H501Z" ;
    cpv:hasBirthPlace       <https://w3id.org/italia/controlled-vocabulary/territorial-classifications/cities/058091-(2015-01-01)> ;
    learning:hasEnrolment   <http://example.org/data/iscrizione/RSSMRA00A41H501Z-2022> .

# --------------------------------------------------------------
# 2. L'ISCRIZIONE (n-ary relation centrale)
# --------------------------------------------------------------

<http://example.org/data/iscrizione/RSSMRA00A41H501Z-2022>
    a                               learning:Enrolment ;
    learning:isEnrolmentOf          <http://example.org/data/persona/RSSMRA00A41H501Z> ;
    learning:atInstitute            <http://example.org/data/istituto/sapienza> ;
    learning:hasProgrammeType       <http://example.org/data/programme-type/laurea-triennale> ;
    learning:hasDegreeClass         <http://example.org/data/degree-class/L-31> ;
    learning:hasDegreeCourse        <http://example.org/data/degree-course/informatica-sapienza> ;
    learning:hasRegistrationYear    <http://example.org/data/anno-accademico/2022-2023> ;
    learning:hasAcademicYear        <http://example.org/data/anno-accademico/2024-2025> ;
    learning:hasEnrolmentStatus     <http://example.org/data/enrolment-status/iscritto> ;
    learning:hasEnrolmentValidity   <http://example.org/data/validita/2022-2025> .

# --------------------------------------------------------------
# 3. RUOLO E STATO ISCRIZIONE
# --------------------------------------------------------------

<http://example.org/data/enrolment-status/iscritto>
    a               learning:EnrolmentStatus ;
    rdfs:label      "Iscritto"@it .

<http://example.org/data/student-type/iscritto>
    a               her:ItalianStudentType ;
    rdfs:label      "Iscritto"@it .

# --------------------------------------------------------------
# 4. L'ISTITUTO
# --------------------------------------------------------------

<http://example.org/data/istituto/sapienza>
    a                           learning:Institute ;
    l0:name                     "Universita' degli Studi di Roma La Sapienza"@it ;
    learning:hasInstituteType   <http://example.org/data/institute-type/universita> ;
    clv:hasSpatialCoverage      <https://w3id.org/italia/controlled-vocabulary/territorial-classifications/cities/058091-(2015-01-01)> .

<http://example.org/data/institute-type/universita>
    a               learning:InstituteType ;
    rdfs:label      "Universita'"@it .

# --------------------------------------------------------------
# 5. TIPOLOGIA, CLASSE E CORSO DI LAUREA
# --------------------------------------------------------------

<http://example.org/data/programme-type/laurea-triennale>
    a               learning:ProgrammeType ;
    rdfs:label      "Laurea Triennale"@it ;
    l0:identifier   "L" .

<http://example.org/data/degree-class/L-31>
    a               learning:DegreeClass ;
    rdfs:label      "L-31 - Scienze e tecnologie informatiche"@it ;
    l0:identifier   "L-31" .

<http://example.org/data/degree-course/informatica-sapienza>
    a                       learning:DegreeCourse ;
    l0:name                 "Informatica"@it ;
    learning:hasDegreeClass <http://example.org/data/degree-class/L-31> ;
    learning:hasProgrammeType <http://example.org/data/programme-type/laurea-triennale> .

# --------------------------------------------------------------
# 6. ANNI ACCADEMICI
# --------------------------------------------------------------

<http://example.org/data/anno-accademico/2022-2023>
    a               learning:AcademicYear ;
    rdfs:label      "A.A. 2022/2023"@it ;
    ti:startTime    "2022-10-01"^^xsd:date ;
    ti:endTime      "2023-09-30"^^xsd:date .

<http://example.org/data/anno-accademico/2024-2025>
    a               learning:AcademicYear ;
    rdfs:label      "A.A. 2024/2025"@it ;
    ti:startTime    "2024-10-01"^^xsd:date ;
    ti:endTime      "2025-09-30"^^xsd:date .

# --------------------------------------------------------------
# 7. VALIDITA' TEMPORALE DELL'ISCRIZIONE
# --------------------------------------------------------------

<http://example.org/data/validita/2022-2025>
    a               ti:TimeInterval ;
    ti:startTime    "2022-10-01"^^xsd:date ;
    ti:endTime      "2025-09-30"^^xsd:date .
```

### Lettura dell'esempio

1. **`ex:persona/RSSMRA00A41H501Z`** è una `cpv:Person` con dati anagrafici; il suo comune di nascita è Roma, referenziato dal vocabolario controllato dei comuni.
2. La persona ha una **iscrizione** (`learning:Enrolment`) che fa da perno: collega persona, istituto, corso, classe di laurea, anno accademico e stato.
3. L'iscrizione è presso **La Sapienza** (`learning:Institute`), al corso di **Informatica** (`learning:DegreeCourse`) nella classe **L-31** (`learning:DegreeClass`), di tipo **Laurea Triennale** (`learning:ProgrammeType`).
4. Lo **stato** dell'iscrizione è "Iscritto" (`learning:EnrolmentStatus`), con una validità temporale dal 2022 al 2025.
5. Tutti gli URI dei vocabolari controllati (comuni, regioni, ecc.) puntano a risorse reali di schema.gov.it.

### Ontologie utilizzate nell'esempio

| Prefisso | Ontologia | URI |
|---|---|---|
| `l0` | Level-0 | `https://w3id.org/italia/onto/l0/` |
| `cpv` | Core Person Vocabulary | `https://w3id.org/italia/onto/CPV/` |
| `clv` | Core Location Vocabulary | `https://w3id.org/italia/onto/CLV/` |
| `ti` | Time Interval | `https://w3id.org/italia/onto/TI/` |
| `ro` | Role Ontology | `https://w3id.org/italia/onto/RO/` |
| `learning` | Learning Ontology | `https://w3id.org/italia/onto/Learning/` |
| `her` | Higher Education & Research | `https://w3id.org/italia/onto/HER/` |

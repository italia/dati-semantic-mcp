# CPV Improvements - Issue Breakdown

Questo documento raccoglie issue separate, ciascuna focalizzata su un singolo argomento, in formato pronto per GitHub.

---

## Issue 1 - [SM] Modellare Email/Telefono/Sito/Social come sottoclassi di OnlineContactPoint

### Background
Nel modello attuale i canali di contatto sono collegati a un punto di contatto online, ma non sempre trattati come veri tipi di `sm:OnlineContactPoint`.

### Problem
La semantica risulta poco esplicita: email, telefono, sito e social sono concettualmente punti di contatto online, non solo elementi "posseduti" da un contact point.

### Proposal
Aggiungere le seguenti assiomatiche:

```turtle
sm:Email rdfs:subClassOf sm:OnlineContactPoint .
sm:Telephone rdfs:subClassOf sm:OnlineContactPoint .
sm:WebSite rdfs:subClassOf sm:OnlineContactPoint .
sm:SocialMedia rdfs:subClassOf sm:OnlineContactPoint .
sm:UserAccount rdfs:subClassOf sm:OnlineContactPoint .
```

### Impact
- Retrocompatibilita': totale (modifica additiva).
- Benefici:
  - semantica piu' chiara;
  - inferenza OWL piu' naturale;
  - allineamento concettuale tra classi.

### Definition of Done
- Class hierarchy aggiornata in SM.
- Esempi RDF aggiornati in documentazione.
- Nessuna regressione sui dati esistenti.

---

## Issue 2 - [SM] Standardizzare gli identificatori dei contatti con URI canonici

### Background
Molti contatti sono modellati tramite blank node + datatype property (`sm:emailAddress`, `sm:telephoneNumber`, `sm:URL`).

### Problem
Il pattern attuale riduce interoperabilita' e deduplicazione e rende meno chiara l'identita' delle risorse di contatto.

### Proposal
Usare URI canonici come identificatori:
- email: `mailto:...` (RFC 6068)
- telefono: `tel:...` (RFC 3966)
- website/social/account: URI HTTPS del profilo/sito

Esempio:

```turtle
<mailto:mario.rossi@example.it> a sm:Email .
<tel:+39-333-1234567> a sm:Telephone .
<https://www.mariorossi.it> a sm:WebSite .
<https://linkedin.com/in/mariorossi> a sm:SocialMedia .
```

Le datatype property restano supportate in transizione, ma da marcare come legacy/deprecabili.

### Impact
- Retrocompatibilita': parziale (necessaria fase di migrazione guidata).
- Benefici:
  - URI riusabili e stabili;
  - maggiore interoperabilita';
  - deduplicazione piu' semplice.

### Definition of Done
- Linee guida ufficiali sui pattern URI pubblicate.
- Esempi "prima/dopo" inclusi in documentazione.
- Piano di deprecazione documentato per le datatype property legacy.

---

## Issue 3 - [CPV] Introdurre shortcut property per i contatti della Person

### Background
Per modellare i contatti di `cpv:Person` servono piu' hop e pattern poco ergonomici nelle query applicative.

### Problem
Il costo di modellazione e query e' alto per casi molto comuni (email, telefono, sito, social).

### Proposal
Aggiungere in CPV:

```turtle
cpv:hasEmail a owl:ObjectProperty ;
  rdfs:subPropertyOf sm:hasOnlineContactPoint ;
  rdfs:domain cpv:Person ;
  rdfs:range sm:Email .

cpv:hasTelephone a owl:ObjectProperty ;
  rdfs:subPropertyOf sm:hasOnlineContactPoint ;
  rdfs:domain cpv:Person ;
  rdfs:range sm:Telephone .

cpv:hasWebSite a owl:ObjectProperty ;
  rdfs:subPropertyOf sm:hasOnlineContactPoint ;
  rdfs:domain cpv:Person ;
  rdfs:range sm:WebSite .

cpv:hasSocialMedia a owl:ObjectProperty ;
  rdfs:subPropertyOf sm:hasOnlineContactPoint ;
  rdfs:domain cpv:Person ;
  rdfs:range sm:SocialMedia .
```

### Impact
- Retrocompatibilita': totale (aggiunta additiva).
- Benefici:
  - query piu' semplici;
  - onboarding piu' rapido;
  - piena compatibilita' con inferenza via `rdfs:subPropertyOf`.

### Definition of Done
- Nuove property pubblicate con label/documentazione IT/EN.
- Esempi SPARQL e RDF aggiornati.
- Verifica di allineamento con pattern SM.

---

## Issue 4 - [CPV] Pattern strutturato per identificativi persona multipli (ANPR, CIE, passaporto)

### Background
`cpv:taxCode` copre il solo codice fiscale; altri identificativi personali non hanno un pattern tipizzato uniforme.

### Problem
Mancano supporto a identificativi multipli e distinzione formale del tipo identificativo.

### Proposal
Introdurre un pattern dedicato:

```turtle
cpv:PersonIdentifier a owl:Class ;
  rdfs:subClassOf l0:Characteristic .

cpv:hasPersonIdentifier a owl:ObjectProperty ;
  rdfs:domain cpv:Person ;
  rdfs:range cpv:PersonIdentifier .

cpv:identifierValue a owl:DatatypeProperty ;
  rdfs:domain cpv:PersonIdentifier ;
  rdfs:range xsd:string .

cpv:identifierType a owl:ObjectProperty ;
  rdfs:domain cpv:PersonIdentifier ;
  rdfs:range skos:Concept .
```

### Impact
- Retrocompatibilita': totale (aggiunta additiva).
- Benefici:
  - supporto a molteplici identificativi per persona;
  - tipizzazione formale;
  - migliore validazione e interoperabilita'.

### Definition of Done
- Classi e property aggiunte in CPV.
- Vocabolario controllato minimo per i tipi identificativo definito.
- Esempi completi per ANPR, CIE e passaporto.

---

## Issue 5 - [CPV] Documentare best practice per cpv:hasBirthPlace

### Background
`cpv:hasBirthPlace` ha range `l0:Location`, scelta flessibile ma molto generica.

### Problem
Senza guida operativa, implementazioni diverse producono dati eterogenei e poco confrontabili.

### Proposal
Mantenere il range attuale e pubblicare linee guida ufficiali per i casi tipici:
- comune italiano noto -> `clv:City` da vocabolario controllato;
- solo provincia/regione nota -> `clv:Province` o `clv:Region`;
- nascita all'estero -> `clv:Country` (o fallback documentato);
- informazione parziale/sconosciuta -> `l0:Location` con label.

### Impact
- Retrocompatibilita': totale (solo documentazione).
- Benefici:
  - maggiore uniformita' dei dati;
  - migliore riuso dei vocabolari controllati;
  - nessuna breaking change ontologica.

### Definition of Done
- Sezione best practice pubblicata nella documentazione CPV.
- Esempi RDF per Italia, estero e dato parziale.
- Checklist di adozione per i provider dati.

# Feedback per upgrade del server MCP `schema.gov.it`

## Contesto

Questo feedback nasce da un uso concreto del server MCP per analizzare e modellare in JSON-LD il dataset `candidature_comuni_finanziate.json`.

L'obiettivo non era solo esplorare ontologie, ma costruire una mappatura operativa per un dataset reale, distinguendo:

- classi e proprietà già riusabili;
- URI ufficiali già presenti;
- gap semantici reali;
- estensioni locali necessarie.

Nel complesso il server è stato utile e affidabile per l'esplorazione del patrimonio semantico disponibile. Il valore principale è stato nella verifica rapida di:

- classi disponibili;
- proprietà con dominio/range;
- URI territoriali esistenti;
- confini reali del modello corrente.

Il limite principale è che oggi il server aiuta molto a `scoprire`, ma meno a `modellare`.

## Valutazione sintetica

### Cosa ha funzionato bene

- ricerca rapida di classi e proprietà con `search_concepts`
- ispezione di dominio/range con `get_property_details`
- esplorazione di ontologie con `list_properties`
- recupero di URI territoriali reali tramite query e risorse già presenti
- verifica puntuale dell'esistenza o meno di vocabolari e classi

### Dove si è perso tempo

- capire se una classe “astratta” avesse anche istanze o concept già riusabili
- capire se per una proprietà esistesse un vocabolario raccomandato
- tradurre una struttura JSON reale in un pattern RDF/JSON-LD coerente
- distinguere risultati semanticamente rilevanti da rumore proveniente da ontologie molto verticali
- trovare il “modo giusto” di usare gli URI territoriali senza dover scrivere query manuali

## Priorità di miglioramento

## 1. Mapping assistito da esempio JSON

### Problema

Il server aiuta a trovare singole classi o proprietà, ma non aiuta a trasformare un record JSON reale in una proposta di modellazione.

### Miglioramento proposto

Aggiungere un tool che riceva:

- un JSON di esempio;
- opzionalmente il dominio applicativo;
- opzionalmente una lista di ontologie da privilegiare

e restituisca:

- entità candidate
- proprietà candidate per ciascun campo
- URI consigliati
- livello di confidenza
- campi senza copertura semantica
- suggerimenti di estensione locale

### Output atteso

Per esempio:

- `codice_ipa` -> `cov:IPAcode`
- `ente` -> `cov:legalName`
- `codice_cup` -> `project:UniqueProjectCode`
- `stato_candidatura` -> nessun mapping standard forte, suggerito SKOS locale

### Realizzabilità

Molto realizzabile internamente.

Richiede soprattutto:

- orchestrazione delle query già esistenti
- regole euristiche
- ranking di candidati

Non richiede dati esterni obbligatori.

### Priorità

Alta.

Questo è probabilmente il miglior miglioramento rapporto costo/beneficio.

## 2. Supporto esplicito ai vocabolari controllati

### Problema

Il server consente di trovare classi come `cov:PublicOrganizationCategory`, ma non rende facile capire:

- se esistono concept già popolati;
- se esiste uno scheme associato;
- se una proprietà punta tipicamente a uno SKOS ConceptScheme;
- se una classe è “teorica” o già usata con valori concreti.

### Miglioramento proposto

Aggiungere tool dedicati, ad esempio:

- `list_instances_of_class`
- `list_concepts_for_property`
- `find_recommended_scheme_for_property`
- `show_population_status`

### Output atteso

Dato `cov:hasCategory`, il server dovrebbe poter dire:

- range: `cov:PublicOrganizationCategory`
- scheme noti: nessuno / elenco di scheme disponibili
- istanze presenti: 0 / N
- suggerimento: usare concept scheme locale se non esiste un vocabolario ufficiale

### Realizzabilità

Realizzabile internamente.

Richiede:

- query SPARQL più mirate
- un po' di logica di aggregazione

Non richiede integrazioni esterne.

### Priorità

Alta.

## 3. Resolver dedicato per codici territoriali

### Problema

Per casi d'uso reali è molto frequente partire da codici come:

- codice ISTAT comune
- codice provincia
- codice regione
- codice catastale/Belfiore

Oggi è possibile arrivare agli URI giusti, ma spesso con passaggi manuali o query ad hoc.

### Miglioramento proposto

Aggiungere un tool tipo:

- `resolve_territorial_uri`

Input:

- tipo codice: `istat-comune`, `istat-provincia`, `istat-regione`, `belfiore`
- valore codice
- opzionalmente una data

Output:

- URI risolto
- etichetta
- tipo CLV
- validità temporale
- URI superiori correlati

### Output atteso

Esempio:

- input: `istat-comune=046030`, data `2022-08-12`
- output: URI del comune valido in quella data, provincia, regione, identificativi correlati

### Realizzabilità

Molto realizzabile internamente.

Richiede:

- query su dati già presenti
- una logica di selezione per la validità temporale

Non richiede dati esterni se il patrimonio territoriale attuale è già quello interrogato dal server.

### Priorità

Alta.

## 4. Ricerca semantica con ranking e filtri migliori

### Problema

Le ricerche per keyword semplici, ad esempio `application`, `status`, `notice`, `decree`, spesso restituiscono:

- risultati rumorosi;
- concetti da ontologie molto lontane dal dominio dell’utente;
- segnali poco ordinati per rilevanza.

### Miglioramento proposto

Migliorare `search_concepts` con:

- filtro per ontologia
- filtro per tipo risorsa: classe, proprietà, concept, istanza
- ranking per rilevanza testuale
- ranking per “centralità” o uso
- eventuale modalità `prefer_core_ontologies`

### Output atteso

Per una query come `application`, i primi risultati dovrebbero privilegiare:

- ontologie core o trasversali
- concetti usati spesso
- risultati vicini al dominio indicato

### Realizzabilità

Realizzabile internamente.

Richiede:

- migliorare la query o la post-elaborazione
- magari aggiungere metadati di scoring

Non richiede integrazioni esterne.

### Priorità

Media-alta.

## 5. Pattern di modellazione raccomandati

### Problema

Il server spiega cosa esiste, ma non propone pattern combinati per casi ricorrenti, ad esempio:

- organizzazione + territorio
- progetto + CUP + call
- concetto + concept scheme + notation
- risorsa + stato + data

### Miglioramento proposto

Aggiungere un tool o una libreria di “profili di modellazione” che, dato un bisogno, restituisca:

- pattern suggerito
- classi e proprietà raccomandate
- warning sui riusi impropri
- campi tipicamente mancanti da modellare localmente

### Output atteso

Esempi di pattern:

- “modella un progetto pubblico con CUP”
- “modella un’organizzazione pubblica con giurisdizione territoriale”
- “modella uno stato applicativo con SKOS”

### Realizzabilità

Realizzabile internamente.

Richiede:

- un livello applicativo sopra le ontologie
- regole curate manualmente

Non richiede dati esterni obbligatori.

### Priorità

Media-alta.

## 6. Validazione del profilo prodotto

### Problema

Dopo aver costruito una proposta di mapping, manca un controllo rapido del tipo:

- stai usando una proprietà fuori dominio?
- stai usando una classe troppo generica?
- il range è coerente?
- ci sono URI territoriali non canonici?
- ci sono proprietà locali non documentate?

### Miglioramento proposto

Aggiungere un tool di validazione leggera per profili JSON-LD/RDF proposti.

Input:

- frammento JSON-LD oppure triple RDF

Output:

- warning
- errori
- suggerimenti di proprietà alternative

### Realizzabilità

Realizzabile internamente, ma più costosa dei punti precedenti.

Richiede:

- regole di validazione
- inferenza minima su domini e range
- parser RDF/JSON-LD robusto

Non richiede integrazioni esterne obbligatorie.

### Priorità

Media.

## 7. Miglioramento diagnostico degli errori SPARQL

### Problema

In alcuni casi il backend ha restituito errori generici tipo `500 SPARQL Request Failed`.

Questo obbliga l’utente a:

- indovinare se il problema è nella query;
- ridurre tentativamente la complessità;
- ritentare senza sapere la causa reale.

### Miglioramento proposto

Restituire messaggi più diagnostici, per esempio:

- timeout
- troppi risultati intermedi
- endpoint non raggiungibile
- query semanticamente invalida
- prefissi o URI non risolti

Eventualmente aggiungere:

- suggerimenti di riscrittura
- limite automatico o fallback su query più piccole

### Realizzabilità

Molto realizzabile internamente.

Richiede:

- miglior gestione eccezioni
- esposizione di errori strutturati

Non richiede integrazioni esterne.

### Priorità

Alta, perché riduce subito il costo d’uso.

## 8. Indicatori di “maturità di riuso”

### Problema

Quando trovi una classe o una proprietà, oggi non è sempre chiaro se:

- è stabile o provvisoria;
- è usata davvero;
- è consigliata per nuovi modelli;
- ha alternative migliori in altre ontologie del catalogo.

### Miglioramento proposto

Esporre un piccolo profilo di maturità per ogni concetto:

- stabilità
- numero di istanze note
- numero di ontologie o dataset che la usano
- presenza di classi/proprietà concorrenti
- eventuale raccomandazione di riuso

### Realizzabilità

Parzialmente realizzabile internamente.

La parte base è interna:

- versionInfo
- conteggi
- presenza di istanze

La parte “raccomandazione di riuso” richiede più cura curatoriale.

### Priorità

Media.

## 9. Integrazione con fonti esterne autorevoli

### Problema

Per alcuni casi il server semantico interno non basta. Alcuni esempi:

- legenda ufficiale degli stati applicativi
- allineamento con IPA ufficiale
- allineamento con OpenCUP
- cataloghi ufficiali di avvisi o decreti

### Miglioramento proposto

Prevedere un layer opzionale di integrazione con fonti esterne, quando disponibili e stabili.

Esempi:

- resolver IPA da codice IPA a metadati ufficiali
- resolver CUP/OpenCUP
- import di vocabolari controllati esterni

### Realizzabilità

Questa parte richiede qualcosa di esterno.

Dipendenze possibili:

- API esterne
- dataset esterni
- allineamenti URI
- sincronizzazione o caching

### Priorità

Media.

È utile, ma non è il primo upgrade da fare se si vuole migliorare molto il server in tempi brevi.

## 10. Profili di dominio preconfigurati

### Problema

L’esperienza d’uso migliorerebbe molto se il server sapesse lavorare in modalità tematiche, ad esempio:

- pubblica amministrazione
- territori
- open data cataloghi
- progetti e finanziamenti
- atti amministrativi

### Miglioramento proposto

Permettere ai tool di ricevere un parametro opzionale tipo:

- `domain_profile=public-administration`
- `domain_profile=territorial-data`
- `domain_profile=public-projects`

Questo servirebbe a:

- migliorare ranking e filtri;
- ridurre il rumore;
- proporre pattern di modellazione più pertinenti.

### Realizzabilità

Realizzabile internamente.

Richiede:

- configurazione di profili
- pesatura delle ontologie

Non richiede integrazioni esterne.

### Priorità

Media-alta.

## Distinzione netta: cosa fare subito e cosa richiede dipendenze esterne

## Miglioramenti molto realizzabili internamente

- mapping assistito da JSON di esempio
- supporto esplicito ai vocabolari controllati
- resolver dei codici territoriali
- ranking e filtri migliori nella ricerca semantica
- pattern di modellazione raccomandati
- validazione leggera del profilo prodotto
- errori SPARQL più diagnostici
- profili di dominio preconfigurati

Questi interventi possono essere implementati soprattutto con:

- nuove query SPARQL
- post-processing applicativo
- euristiche
- knowledge curation interna

## Miglioramenti che richiedono qualcosa di esterno o curatoriale forte

- legenda ufficiale degli stati di dominio non presenti nel catalogo
- allineamento con registri esterni come IPA o OpenCUP
- cataloghi ufficiali di decreti, avvisi, atti amministrativi
- raccomandazioni “normative” di modellazione, se devono avere valore ufficiale e non solo tecnico

Questi interventi richiedono almeno uno tra:

- accesso a fonti esterne
- dataset di riferimento
- accordi di allineamento
- manutenzione curatoriale continuativa

## Roadmap consigliata

## Fase 1: miglioramenti ad alto impatto e basso costo

- error handling SPARQL migliore
- resolver territoriale
- filtri e ranking in `search_concepts`
- supporto esplicito ai vocabolari

## Fase 2: passaggio da esplorazione a progettazione guidata

- mapping assistito da JSON
- pattern di modellazione raccomandati
- profili di dominio

## Fase 3: qualità del risultato prodotto

- validazione del profilo JSON-LD/RDF
- indicatori di maturità di riuso

## Fase 4: integrazioni esterne

- IPA
- OpenCUP
- cataloghi di atti e avvisi
- vocabolari ufficiali mancanti

## Conclusione

Il server MCP `schema.gov.it` è già utile per chi deve esplorare ontologie e trovare elementi riusabili. Il salto di qualità più importante, però, sarebbe farlo evolvere da:

- strumento di interrogazione semantica

a:

- assistente di modellazione semantica per dataset reali

La parte più realizzabile nel breve periodo è tutta interna: ranking, resolver, vocabolari, mapping assistito, pattern e validazione leggera.

Le integrazioni esterne sono preziose, ma vanno considerate una seconda fase, perché dipendono da disponibilità, qualità e stabilità di fonti che non sono nel controllo diretto del server.

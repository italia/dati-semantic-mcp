
import { appendFile } from "fs/promises";

// SPARQL Endpoint
const ENDPOINT = "https://schema.gov.it/sparql";

const PREFIXES = `
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX dcat: <http://www.w3.org/ns/dcat#>
`;

async function executeSparql(query: string): Promise<any> {
    const fullQuery = PREFIXES + "\n" + query;
    const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/sparql-results+json",
        },
        body: new URLSearchParams({ query: fullQuery }),
    });

    if (!response.ok) {
        throw new Error(`SPARQL request failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
}

async function verifyCatalogTools() {
    console.log("--- Verifying Catalog Tools ---");

    // 1. List Ontologies
    console.log("\n1. List Ontologies:");
    // Implementation uses this query
    const queryOnt = `
      SELECT DISTINCT ?ont ?label
      WHERE {
        ?ont a owl:Ontology .
        OPTIONAL { ?ont rdfs:label|dct:title ?label }
      }
      ORDER BY ?label
      LIMIT 5
    `;
    const resOnt = await executeSparql(queryOnt);
    resOnt.results.bindings.forEach((b: any) => console.log(`[ONT] ${b.ont.value}`));

    // 2. Explore Ontology (CLV)
    console.log("\n2. Explore Ontology (CLV - City):");
    const uriOnt = "https://w3id.org/italia/onto/CLV";
    const queryExpOnt = `
      SELECT DISTINCT ?type ?item ?label
      WHERE {
        VALUES ?type { owl:Class owl:ObjectProperty owl:DatatypeProperty }
        ?item a ?type .
        OPTIONAL { ?item rdfs:label ?label }
        FILTER(STRSTARTS(STR(?item), "${uriOnt}"))
      }
      LIMIT 5
    `;
    const resExpOnt = await executeSparql(queryExpOnt);
    resExpOnt.results.bindings.forEach((b: any) => console.log(`[ITEM] ${b.item.value} (${b.type.value})`));

    // 3. List Datasets
    console.log("\n3. List Datasets:");
    const queryData = `
      SELECT DISTINCT ?dataset ?label
      WHERE {
        ?dataset a <http://dati.gov.it/onto/dcatapit#Dataset> .
        OPTIONAL { ?dataset dct:title ?label }
      }
      LIMIT 5
    `;
    const resData = await executeSparql(queryData);
    resData.results.bindings.forEach((b: any) => console.log(`[DATA] ${b.dataset.value}`));

    // 4. Explore Dataset (First one found)
    if (resData.results.bindings.length > 0) {
        const dsUri = resData.results.bindings[0].dataset.value;
        console.log(`\n4. Explore Dataset (${dsUri}):`);
        const queryExpData = `
            SELECT ?p ?o WHERE { <${dsUri}> ?p ?o FILTER(ISLITERAL(?o)) } LIMIT 5
        `;
        const resExpData = await executeSparql(queryExpData);
        resExpData.results.bindings.forEach((b: any) => console.log(`[PROP] ${b.p.value}: ${b.o.value}`));
    }
}

verifyCatalogTools();

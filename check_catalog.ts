
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

async function main() {
    console.log("Analyzing Catalog Structure...");

    // 1. Ontologies
    const queryOnt = `
      SELECT DISTINCT ?ont ?label
      WHERE {
        ?ont a owl:Ontology .
        OPTIONAL { ?ont rdfs:label|dct:title ?label }
      }
      LIMIT 20
    `;

    try {
        const result = await executeSparql(queryOnt);
        console.log(`\n--- Found ${result.results.bindings.length} Ontologies (Limit 20) ---`);
        result.results.bindings.forEach((b: any) => {
            console.log(`[ONT] ${b.ont.value} (${b.label?.value || "no label"})`);
        });
    } catch (e: any) {
        console.error("Error fetching ontologies:", e.message);
    }

    // 2. Datasets (Generic search for things typed as *Dataset*)
    const queryData = `
      SELECT DISTINCT ?type (COUNT(?s) AS ?count)
      WHERE {
        ?s a ?type .
        FILTER(REGEX(STR(?type), "Dataset", "i"))
      }
      GROUP BY ?type
    `;

    try {
        const result = await executeSparql(queryData);
        console.log("\n--- Dataset Types Found ---");
        result.results.bindings.forEach((b: any) => {
            console.log(`[TYPE] ${b.type.value}: ${b.count.value} instances`);
        });
    } catch (e: any) {
        console.error("Error fetching dataset types:", e.message);
    }

    // 3. Distributions
    const queryDist = `
      SELECT DISTINCT ?dist ?format
      WHERE {
        ?dist a <http://dati.gov.it/onto/dcatapit#Distribution> .
        OPTIONAL { ?dist dct:format ?format }
      }
      LIMIT 10
    `;
    try {
        const result = await executeSparql(queryDist);
        console.log(`\n--- Found ${result.results.bindings.length} Distributions (Limit 10) ---`);
        result.results.bindings.forEach((b: any) => {
            console.log(`[DIST] ${b.dist.value} [${b.format?.value}]`);
        });
    } catch (e: any) {
        // console.error("Error fetching distributions:", e.message);
    }
}

main();

/**
 * Shared test fixtures.
 * Inline content avoids dependency on working-directory-relative files in CI.
 */

export const TEST_TTL = `\
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix ex: <http://example.org/onto#> .

ex:Persona a owl:Class ; rdfs:label "Persona"@it .
ex:Organizzazione a owl:Class ; rdfs:label "Organizzazione"@it .
ex:nome a owl:DatatypeProperty ; rdfs:domain ex:Persona ; rdfs:label "nome"@it .
ex:appartienea a owl:ObjectProperty ; rdfs:domain ex:Persona ; rdfs:range ex:Organizzazione .

ex:mario a ex:Persona ; ex:nome "Mario Rossi" .
`;

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

export const TEST_GRAPHOL = `\
<?xml version="1.0" encoding="UTF-8"?>
<graphol version="3">
  <project name="ExampleGraphol" version="0.1">
    <ontology lang="it" iri="http://example.org/onto" prefix="ex">
      <imports/>
      <prefixes>
        <prefix>
          <value>ex</value>
          <namespace>http://example.org/onto#</namespace>
        </prefix>
      </prefixes>
    </ontology>
    <diagrams>
      <diagram name="main">
        <node id="n1" type="concept">
          <geometry width="80" height="40" x="0" y="0"/>
          <label x="0" y="0" width="80" height="20" size="12">ex:Person</label>
          <iri>http://example.org/onto#Person</iri>
        </node>
        <node id="n2" type="concept">
          <geometry width="80" height="40" x="120" y="0"/>
          <label x="0" y="0" width="80" height="20" size="12">ex:Agent</label>
          <iri>http://example.org/onto#Agent</iri>
        </node>
        <node id="n3" type="attribute">
          <geometry width="80" height="40" x="0" y="120"/>
          <label x="0" y="0" width="80" height="20" size="12">ex:name</label>
          <iri>http://example.org/onto#name</iri>
        </node>
        <node id="n4" type="role">
          <geometry width="80" height="40" x="120" y="120"/>
          <label x="0" y="0" width="80" height="20" size="12">ex:memberOf</label>
          <iri>http://example.org/onto#memberOf</iri>
        </node>
        <edge id="e1" type="inclusion" source="n1" target="n2">
          <point x="0" y="0"/>
          <point x="120" y="0"/>
        </edge>
      </diagram>
    </diagrams>
  </project>
</graphol>
`;

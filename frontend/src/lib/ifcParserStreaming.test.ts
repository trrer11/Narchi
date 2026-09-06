// Parité du mode streaming parseIfcBytes avec le parseur historique parseIfc :
// mêmes entités, mêmes métrés, même schéma — y compris avec des fenêtres de
// décodage minuscules qui coupent les enregistrements et les quotes échappées.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseIfc, parseIfcBytes, type IfcModel } from "@/lib/ifcParser";

const SAMPLE_PATH = resolve(__dirname, "../../../examples/simple_house_efh.ifc");

function comparable(model: IfcModel) {
  return {
    ok: model.ok,
    schema: model.schema,
    projectName: model.projectName,
    author: model.author,
    organization: model.organization,
    storeys: model.storeys,
    elements: model.elements,
    spaces: model.spaces,
    buildingArea: model.buildingArea,
    entityCount: model.entities.size,
    warnings: model.warnings,
  };
}

describe("parseIfcBytes (streaming) — parité avec parseIfc", () => {
  it("produit un modèle identique sur l'échantillon IFC réel", () => {
    const bytes = new Uint8Array(readFileSync(SAMPLE_PATH));
    const text = new TextDecoder("utf-8").decode(bytes);

    const reference = parseIfc(text, "simple_house_efh.ifc", bytes.byteLength);
    const streamed = parseIfcBytes(bytes, "simple_house_efh.ifc");

    expect(streamed.ok).toBe(true);
    expect(comparable(streamed)).toEqual(comparable(reference));
  });

  it("reste identique avec des fenêtres de 512 octets (frontières coupées)", () => {
    const bytes = new Uint8Array(readFileSync(SAMPLE_PATH));
    const text = new TextDecoder("utf-8").decode(bytes);

    const reference = parseIfc(text, "maison.ifc", bytes.byteLength);
    const streamed = parseIfcBytes(bytes, "maison.ifc", 512);

    expect(comparable(streamed)).toEqual(comparable(reference));
  });

  it("gère les quotes échappées ISO ('') chevauchant deux fenêtres", () => {
    const ifc = [
      "ISO-10303-21;",
      "HEADER;",
      "FILE_SCHEMA(('IFC2X3'));",
      "ENDSEC;",
      "DATA;",
      "#1=IFCPERSON($,$,'DU''PONT','Jean',$,$,$,$);",
      "#4=IFCBUILDINGSTOREY('g1',#3,'Erdgeschoss',$,$,$,$,$,$,0.);",
      "ENDSEC;",
      "END-ISO-10303-21;",
    ].join("\n");
    const bytes = new TextEncoder().encode(ifc);

    const reference = parseIfc(ifc, "bords.ifc", bytes.length);
    // Fenêtre volontairement minuscule pour couper la chaîne 'DU''PONT'
    const streamed = parseIfcBytes(bytes, "bords.ifc", 17);

    expect(streamed.ok).toBe(true);
    expect(streamed.entities.size).toBe(reference.entities.size);
    expect(streamed.schema).toBe("IFC2X3");
    expect(streamed.author).toBe(reference.author);
    expect(streamed.storeys).toEqual(reference.storeys);
  });

  it("TERMINE sur une entrée aux quotes désynchronisées (anti-OOM historique)", () => {
    // Régression : une parenthèse orpheline issue d'une désynchronisation de
    // chaîne bloquait le tokenizer en boucle infinie (tokens infinis → OOM →
    // Worker tué silencieusement par le navigateur = « erreur inconnue »).
    const ifc = [
      "ISO-10303-21;",
      "HEADER;",
      "FILE_SCHEMA(('IFC2X3'));",
      "ENDSEC;",
      "DATA;",
      "#1=IFCPERSON($,$,'DUPONT',''Hercule''',$,$,$,$);",
      "#4=IFCBUILDINGSTOREY('g1',#3,'Erdgeschoss',$,$,$,$,$,$,0.);",
      "ENDSEC;",
      "END-ISO-10303-21;",
    ].join("\n");
    const bytes = new TextEncoder().encode(ifc);

    const startedAt = Date.now();
    const streamed = parseIfcBytes(bytes, "malformé.ifc", 17);
    const classic = parseIfc(ifc, "malformé.ifc", ifc.length);

    expect(Date.now() - startedAt).toBeLessThan(2000); // doit TERMINER
    expect(streamed.ok).toBe(true);
    expect(classic.ok).toBe(true);
  });

  it("signale proprement un fichier sans section DATA", () => {
    const bytes = new TextEncoder().encode("n'importe quoi");
    const model = parseIfcBytes(bytes, "cassé.ifc");
    expect(model.ok).toBe(false);
    expect(model.warnings.length).toBeGreaterThan(0);
  });
});

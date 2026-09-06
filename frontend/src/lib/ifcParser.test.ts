import { describe, expect, it } from "vitest";
import { parseIfc } from "./ifcParser";

describe("parseIfc", () => {
  it("conserve les points-virgules contenus dans les chaînes STEP", () => {
    const source = `ISO-10303-21;
HEADER;
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCORGANIZATION('ORG','Bureau; Narchi',$,$);
#2=IFCPROJECT('PROJECT','Projet; test',$,$,$,$,$,$);
ENDSEC;
END-ISO-10303-21;`;

    const model = parseIfc(source, "semicolon.ifc", source.length);

    expect(model.entities.size).toBe(2);
    expect(model.entities.get(1)?.args[1]?.value).toBe("Bureau; Narchi");
    expect(model.entities.get(2)?.args[1]?.value).toBe("Projet; test");
  });
});

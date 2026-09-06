/** §239 — IFC-Messung → DIN 276 / GEG / Projekt. Nichts erfinden: 0 bleibt 0. */

export type FlaecheQuelle = "messung" | "eingabe" | "keine";

export function applyModellZumBuero(takeoff: {
  ngf: number;
  storeys: string[];
  volume: number;
}): {
  ngf: number;
  geschosse: number;
  volumen: number;
  quelle: FlaecheQuelle;
  hinweis: string;
} {
  const ngf = Number.isFinite(takeoff.ngf) ? Math.max(0, takeoff.ngf) : 0;
  const geschosse = takeoff.storeys.filter((s) => String(s).trim()).length;
  const volumen = Number.isFinite(takeoff.volume) ? Math.max(0, takeoff.volume) : 0;
  if (ngf <= 0) {
    return {
      ngf: 0,
      geschosse,
      volumen,
      quelle: "keine",
      hinweis: "Modell ohne IfcSpace-NetArea — NGF bleibt 0, nicht geschätzt.",
    };
  }
  return {
    ngf,
    geschosse,
    volumen,
    quelle: "messung",
    hinweis: `NGF ${ngf.toLocaleString("de-DE")} m² aus IfcSpace (Messung)${geschosse ? ` · ${geschosse} Geschosse` : ""}.`,
  };
}

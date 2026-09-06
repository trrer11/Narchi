/**
 * §74 — V2.5 : VRAI export GAEB (DA XML 3.2, Austauschphase 31) produit par
 * le SERVEUR — le pseudo-XML client (supprimé en §74) était honnêtement
 * étiqueté « pas schema-konform » ; désormais la grammaire officielle
 * (namespace DA31/3.2, GAEBInfo, BoQBkdn, OutlTxt) est construite par
 * backend/app/core/estimation/gaeb_export.py et relue par notre importeur
 * X31 (round-trip testé).
 *
 * La conversion CostResult → requête est PURE et testée : aucun montant
 * n'est inventé, chaque ligne du moteur devient une position pauschale.
 */
import { secureFetch } from "@/auth/SecuritySanitizer";
import { getApiBase } from "@/lib/apiClient";
import { DIN276_GROUP_LABELS, type CostResult, type Din276Fassung } from "@/lib/costEngine";

export interface GaebKgLine {
  code: string;   // code position DIN 276 (3 chiffres, ex. « 220 »)
  label: string;  // libellé allemand du moteur
  amount: number; // montant netto (2 décimales)
}

export interface GaebKgGroup {
  code: string;   // Kostengruppe (200/300/400/500/700)
  label: string;  // libellé officiel selon la Fassung DIN 276-1
  lines: GaebKgLine[];
}

export interface GaebDin276Request {
  project_name: string;
  din276: Din276Fassung;
  kostengruppen: GaebKgGroup[];
}

const FALLBACK_NAME = "NARCHI Kostenschätzung";

/**
 * Conversion PURE : CostResult du moteur → requête serveur GAEB DIN 276.
 * Ordre fixe 200/300/400/500/700 ; groupes vides omis ; montants arrondis
 * au centime (le serveur quantize de toute façon — miroir honnête).
 */
export function costResultToGaebRequest(projectName: string, r: CostResult): GaebDin276Request {
  const fassung: Din276Fassung = r.din276 ?? "2018";
  const labels = DIN276_GROUP_LABELS[fassung];
  const groups: GaebKgGroup[] = [
    { code: "200", label: labels.kg200, lines: r.lines200 },
    { code: "300", label: "Bauwerk – Baukonstruktionen", lines: r.lines300 },
    { code: "400", label: "Bauwerk – Technische Anlagen", lines: r.lines400 },
    { code: "500", label: labels.kg500, lines: r.lines500 },
    { code: "700", label: "Baunebenkosten", lines: r.lines700 },
  ]
    .filter((g) => g.lines.length > 0)
    .map((g) => ({
      ...g,
      lines: g.lines.map((l) => ({ code: l.code, label: l.label, amount: Number(l.amount.toFixed(2)) })),
    }));
  const name = projectName.trim();
  return {
    project_name: name.length > 0 ? name : FALLBACK_NAME,
    din276: fassung,
    kostengruppen: groups,
  };
}

/** POST au serveur → télécharge le fichier .x31 (attachment). */
export async function downloadGaebDin276(projectName: string, r: CostResult): Promise<void> {
  const res = await secureFetch(`${getApiBase()}/api/v5/estimation/gaeb-din276`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(costResultToGaebRequest(projectName, r)),
  });
  if (!res.ok) {
    throw new Error(`GAEB-Export fehlgeschlagen (HTTP ${res.status}) — Backend erreichbar?`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const slug = (projectName.trim() || "NARCHI-Projekt").replace(/\s/g, "-");
  a.download = `Narchi-${slug}-DIN276.x31`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

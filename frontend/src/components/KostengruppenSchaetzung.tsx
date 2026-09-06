// NARCHI — « Kostenschätzung nach DIN 276 » : tableau BOQ résultat du
// chaînon pivot → Kostengruppen. Composant 100 % présentationnel : il ne
// calcule rien (tout vient du backend) — il agrège l'affichage : positions
// agrégées, totaux netto/USt/brutto, fourchette, score de plausibilité.

import { Badge, Button, Card, CardHeader } from "@/components/ui";
import { formatMoney, formatNumber } from "@/lib/format";
import type { QuickEstimateResponse } from "@/lib/quickEstimate";

const GRADE_TONE: Record<string, "emerald" | "sky" | "amber" | "rose"> = {
  A: "emerald",
  B: "sky",
  C: "amber",
  D: "rose",
};

function ScoreRing({ value }: { value: number }) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const dash = (value / 100) * circumference;
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" role="img" aria-label={`Plausibilität ${value} von 100`}>
      <circle cx="32" cy="32" r={radius} fill="none" stroke="#e2e8f0" strokeWidth="7" />
      <circle
        cx="32"
        cy="32"
        r={radius}
        fill="none"
        stroke="#0ea5e9"
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circumference - dash}`}
        transform="rotate(-90 32 32)"
      />
      <text x="32" y="36" textAnchor="middle" fill="#0f172a" fontSize="15" fontWeight="700">
        {value}
      </text>
    </svg>
  );
}

export default function KostengruppenSchaetzung({
  estimate,
  onExportGaeb,
}: {
  estimate: QuickEstimateResponse;
  /// Bouton « GAEB X31 » — absent si le callback n'est pas fourni.
  onExportGaeb?: (() => void) | null;
}) {
  const { lines, totals, range, score, warnings, element_count, office_quote } = estimate;
  const eigenprozent = office_quote ? Math.round(office_quote.eigenpreis_quote * 100) : 0;
  return (
    <Card>
      <CardHeader
        title="Kostenschätzung nach DIN 276"
        subtitle={
          eigenprozent > 0
            ? `${element_count} Bauteile · ${lines.length} Positionen · Region ${estimate.region} · ${eigenprozent} % eigene Büropreise`
            : `${element_count} Bauteile · ${lines.length} Positionen · Region ${estimate.region} · Richtwerte NARCHI`
        }
        action={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {onExportGaeb && (
              <Button size="sm" variant="secondary" icon="download" onClick={onExportGaeb}>
                GAEB X31
              </Button>
            )}
            <Badge tone={GRADE_TONE[score.grade] ?? "slate"}>
              Plausibilität {score.grade}
            </Badge>
          </div>
        }
      />

      <div style={{ display: "flex", gap: 16, alignItems: "center", margin: "8px 0 12px" }}>
        <ScoreRing value={score.value} />
        <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>
          <div>Mapping-Abdeckung: {Math.round(score.mapping_coverage * 100)} %</div>
          <div>Verwertbare Mengen: {Math.round(score.quantity_coverage * 100)} %</div>
          <div>Ø Vertrauen: {Math.round(score.avg_confidence * 100)} %</div>
        </div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left", color: "#64748b", borderBottom: "1px solid #e2e8f0" }}>
            <th style={{ padding: "6px 8px" }}>KG</th>
            <th style={{ padding: "6px 8px" }}>Position</th>
            <th style={{ padding: "6px 8px", textAlign: "right" }}>Menge</th>
            <th style={{ padding: "6px 4px" }}>Einh.</th>
            <th style={{ padding: "6px 8px", textAlign: "right" }}>EP netto</th>
            <th style={{ padding: "6px 8px", textAlign: "right" }}>Gesamt netto</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={`${line.kostengruppe}-${line.einheit}`} style={{ borderBottom: "1px solid #f1f5f9" }}>
              <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                <Badge tone="slate">{line.kostengruppe.replace(/^kg(\d{3}).*/, "KG $1")}</Badge>
              </td>
              <td style={{ padding: "6px 8px" }}>
                <div>
                  {line.titel}{" "}
                  {line.preis_quelle === "büro" ? (
                    <Badge tone="emerald">
                      {line.preis_quelle_detail?.auswahl === "median"
                        ? `eigene Preise · Median n=${line.preis_quelle_detail.n_quellen}`
                        : "eigene Preise"}
                    </Badge>
                  ) : (
                    <Badge tone="amber">Richtwert</Badge>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "#94a3b8" }}>
                  {line.anzahl_elemente} Element(e)
                  {line.beispiele.length > 0 ? ` · z. B. ${line.beispiele.join(", ")}` : ""}
                  {line.preis_quelle === "büro" && line.preis_quelle_detail
                    ? line.preis_quelle_detail.auswahl === "median"
                      ? // §99 — médiane : aucune fausse OZ ; la règle est DITE
                        // (n, Einheit, indexation par millésime, Jahrgänge).
                        ` · Median aus ${line.preis_quelle_detail.n_quellen} eigenen Preisen`
                        + (line.preis_quelle_detail.einheit ? ` (${line.preis_quelle_detail.einheit})` : "")
                        + `, je auf ${line.preis_quelle_detail.median_steht_auf} indexiert`
                        + (line.preis_quelle_detail.jahr_von !== line.preis_quelle_detail.jahr_bis
                          ? ` · Jahrgänge ${line.preis_quelle_detail.jahr_von}–${line.preis_quelle_detail.jahr_bis}`
                          : "")
                        + (line.preis_quelle_detail.nicht_vermischt > 0
                          ? ` · ${line.preis_quelle_detail.nicht_vermischt} Preis(e) anderer Einheit nicht vermischt`
                          : "")
                      : ` · OZ ${line.preis_quelle_detail.oz} · Stand ${line.preis_quelle_detail.preisstand_jahr} ×${line.preis_quelle_detail.index_faktor.toFixed(4)} (Destatis)`
                    : ""}
                </div>
              </td>
              <td style={{ padding: "6px 8px", textAlign: "right" }}>{formatNumber(line.menge)}</td>
              <td style={{ padding: "6px 4px" }}>{line.einheit}</td>
              <td style={{ padding: "6px 8px", textAlign: "right" }}>{formatMoney(line.einheitspreis_netto)}</td>
              <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600 }}>
                {formatMoney(line.gesamt_netto)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", rowGap: 4, columnGap: 24, marginTop: 12, fontSize: 13 }}>
        <span style={{ color: "#9ca3af" }}>Summe netto</span>
        <strong>{formatMoney(totals.netto)}</strong>
        <span style={{ color: "#9ca3af" }}>Umsatzsteuer {formatNumber(totals.ust_satz)} %</span>
        <strong>{formatMoney(totals.ust)}</strong>
        <span style={{ color: "#9ca3af" }}>Summe brutto</span>
        <strong style={{ fontSize: 15 }}>{formatMoney(totals.brutto)}</strong>
        {totals.kosten_pro_m2 !== null && (
          <>
            <span style={{ color: "#9ca3af" }}>Kosten je m² (Referenzfläche)</span>
            <strong>{formatMoney(totals.kosten_pro_m2)}</strong>
          </>
        )}
        <span style={{ color: "#9ca3af" }}>Vorlaufige Spanne ({range.assumption})</span>
        <span>
          {formatMoney(range.low)} – {formatMoney(range.high)}
        </span>
      </div>

      {warnings.length > 0 && (
        <ul style={{ marginTop: 12, paddingLeft: 18, fontSize: 11, color: "#b45309" }}>
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}

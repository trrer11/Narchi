// NARCHI — « Kostenvergleich (Soll/Ist) » : fige l'estimation éclair courante
// comme scénario de référence (localStorage, max 5) et la compare à
// l'estimation affichée — écarts par Kostengruppe, positions ajoutées ou
// supprimées, delta total. 100 % présentationnel : le calcul d'écart vit
// dans lib/estimateScenarios (testé).

import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, CardHeader } from "@/components/ui";
import { formatMoney, formatNumber } from "@/lib/format";
import { ESTIMATE_REGIONS, type QuickEstimateResponse } from "@/lib/quickEstimate";
import {
  diffEstimates,
  ersetzeSzenarien,
  loadScenarios,
  removeScenario,
  saveScenario,
  snapshotFromEstimate,
  type DiffStatus,
} from "@/lib/estimateScenarios";
import { pullOfficeBlob, pushOfficeBlob } from "@/lib/officeBlobSync";

const STATUS_META: Record<DiffStatus, { label: string; tone: "emerald" | "rose" | "sky" | "slate" }> = {
  same: { label: "gleich", tone: "sky" },
  changed: { label: "geändert", tone: "rose" },
  added: { label: "neu", tone: "emerald" },
  removed: { label: "entfallen", tone: "slate" },
};

function regionLabel(code: string): string {
  return ESTIMATE_REGIONS.find((region) => region.code === code)?.label ?? code;
}

function DeltaCell({ delta, deltaProzent }: { delta: number | null; deltaProzent: number | null }) {
  if (delta === null || delta === 0) return <span style={{ color: "#94a3b8" }}>—</span>;
  const color = delta > 0 ? "#dc2626" : "#059669";
  const sign = delta > 0 ? "+" : "";
  return (
    <span style={{ color, fontWeight: 600 }}>
      {sign}
      {formatMoney(delta)}
      {deltaProzent !== null ? ` (${sign}${formatNumber(deltaProzent, 1)} %)` : ""}
    </span>
  );
}

export default function KostenVergleich({ current }: { current: QuickEstimateResponse }) {
  const [scenarios, setScenarios] = useState(() => loadScenarios());
  const [label, setLabel] = useState("");
  const [referenceId, setReferenceId] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const r = await pullOfficeBlob("szenarien");
      if (!live || !r || r.empty || !Array.isArray(r.payload.items)) return;
      setScenarios(ersetzeSzenarien(r.payload.items as ReturnType<typeof loadScenarios>));
    })();
    return () => {
      live = false;
    };
  }, []);

  const currentSnapshot = useMemo(
    () => snapshotFromEstimate(current, "Aktuell"),
    [current],
  );
  const reference = scenarios.find((scenario) => scenario.id === referenceId) ?? null;
  const diff = useMemo(
    () => (reference ? diffEstimates(reference, currentSnapshot) : null),
    [reference, currentSnapshot],
  );

  const handleSave = () => {
    const snapshot = snapshotFromEstimate(current, label);
    const next = saveScenario(snapshot);
    setScenarios(next);
    void pushOfficeBlob("szenarien", { items: next });
    setLabel("");
    setReferenceId(snapshot.id);
  };

  const handleRemove = () => {
    if (!referenceId) return;
    const next = removeScenario(referenceId);
    setScenarios(next);
    void pushOfficeBlob("szenarien", { items: next });
    setReferenceId(null);
  };

  return (
    <Card>
      <CardHeader
        title="Kostenvergleich (Soll/Ist)"
        subtitle="Szenario speichern und mit der aktuellen Schätzung vergleichen — z. B. zwei Regionen oder zwei Modellstände"
      />

      {/* Sauvegarde d'un scénario */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 14 }}>
        <input
          aria-label="Name des Szenarios"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder={`z. B. „Stand ${regionLabel(current.region)}“`}
          maxLength={80}
          style={{
            flex: "1 1 220px",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            padding: "6px 10px",
            fontSize: 13,
          }}
        />
        <Button size="sm" variant="secondary" icon="check" onClick={handleSave}>
          Als Szenario speichern
        </Button>
        {scenarios.length > 0 && (
          <>
            <select
              aria-label="Referenz-Szenario"
              value={referenceId ?? ""}
              onChange={(event) => setReferenceId(event.target.value || null)}
              style={{
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                padding: "6px 10px",
                fontSize: 13,
                background: "#fff",
              }}
            >
              <option value="">Referenz wählen…</option>
              {scenarios.map((scenario) => (
                <option key={scenario.id} value={scenario.id}>
                  {scenario.label} · {regionLabel(scenario.region)} · {formatMoney(scenario.netto)}
                </option>
              ))}
            </select>
            {reference && (
              <Button size="sm" variant="ghost" icon="x" onClick={handleRemove}>
                Löschen
              </Button>
            )}
          </>
        )}
      </div>

      {reference && diff && (
        <>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>
            Referenz: <strong>{reference.label}</strong> ({regionLabel(reference.region)}{(", ")}
            {new Date(reference.savedAt).toLocaleString("de-DE")}) — verglichen mit der aktuellen
            Schätzung ({regionLabel(currentSnapshot.region)}).
            {reference.region !== current.region && (
              <>
                {" "}
                <Badge tone="amber">Regionen abweichend — Vergleich misst vor allem den Regionalfaktor</Badge>
              </>
            )}
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#64748b", borderBottom: "1px solid #e2e8f0" }}>
                <th style={{ padding: "6px 8px" }}>KG</th>
                <th style={{ padding: "6px 8px" }}>Position</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Referenz</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Aktuell</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Δ netto</th>
                <th style={{ padding: "6px 8px" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {diff.rows.map((row) => (
                <tr key={row.kostengruppe} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                    <Badge tone="slate">{row.kostengruppe.replace(/^kg(\d{3}).*/, "KG $1")}</Badge>
                  </td>
                  <td style={{ padding: "6px 8px" }}>{row.titel}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>
                    {row.basis !== null ? formatMoney(row.basis) : "—"}
                  </td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>
                    {row.vergleich !== null ? formatMoney(row.vergleich) : "—"}
                  </td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>
                    <DeltaCell delta={row.delta} deltaProzent={row.deltaProzent} />
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <Badge tone={STATUS_META[row.status].tone}>{STATUS_META[row.status].label}</Badge>
                  </td>
                </tr>
              ))}
              <tr style={{ borderTop: "2px solid #e2e8f0", fontWeight: 700 }}>
                <td style={{ padding: "8px" }} colSpan={2}>
                  Summe netto
                </td>
                <td style={{ padding: "8px", textAlign: "right" }}>{formatMoney(diff.totalBasis)}</td>
                <td style={{ padding: "8px", textAlign: "right" }}>{formatMoney(diff.totalVergleich)}</td>
                <td style={{ padding: "8px", textAlign: "right" }}>
                  <DeltaCell delta={diff.totalDelta} deltaProzent={diff.totalDeltaProzent} />
                </td>
                <td style={{ padding: "8px" }} />
              </tr>
            </tbody>
          </table>
        </>
      )}

      {scenarios.length === 0 && (
        <p style={{ fontSize: 12, color: "#94a3b8" }}>
          Noch kein Szenario gespeichert — die aktuelle Schätzung kann oben als Referenz eingefroren
          werden (max. 5, nur in diesem Browser).
        </p>
      )}
    </Card>
  );
}

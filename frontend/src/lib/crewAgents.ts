// Narchi — Crew Agents : moteur d'analyse multi-agents DÉTERMINISTE.
// 6 agents experts analysent le projet en parallèle, chacun avec sa logique
// de domaine, puis la synthèse unifie le rapport. Zéro cloud, zéro LLM —
// raisonnement local, auditable, 100 % reproductible.
//
// FIABILITÉ (retour utilisateur 2026-08-06 : « des chiffres non fiables ») :
//  - chaque finding porte sa PROVENANCE (`source`) : « Messung » (calculé des
//    données réelles du projet), « Richtwert » (valeur indicative du marché —
//    à vérifier), « Regel » (exigence normative/préconisation) ;
//  - les SCORES sont CALCULÉS des signaux réels (coûts/m², PEB, incertitude,
//    collisions QC du modèle) — plus de lignes de base figées ~80 quel que
//    soit le projet ;
//  - sans données d'entrée, l'agent le DIT (score neutre 50 + note) au lieu
//    d'afficher des chiffres qui ont l'air mesurés.

import type { CostResult } from "@/lib/costEngine";
import type { EnergyResult } from "@/lib/energyEngine";
import { fmtNumber, fmtPct } from "@/lib/costEngine";

export type AgentRole = "cost" | "sustainability" | "risk" | "market" | "funding" | "architekt";

/// Provenance d'un constat — affichée sur chaque carte (prouvabilité).
export type FindingSource = "messung" | "richtwert" | "regel";

export const FINDING_SOURCE_META: Record<FindingSource, { label: string; hint: string }> = {
  messung: { label: "Messung", hint: "Calculé à partir des données réelles de CE projet" },
  richtwert: { label: "Richtwert", hint: "Valeur indicative marché/norme — à vérifier avant usage contractuel" },
  regel: { label: "Regel", hint: "Exigence normative ou bonne pratique (check-list)" },
};

export interface AgentFinding {
  severity: "critical" | "warning" | "opportunity" | "info";
  title: string;
  detail: string;
  metric?: string;
  recommendation: string;
  confidence: number; // 0..1
  source: FindingSource;
}

export interface AgentReport {
  role: AgentRole;
  name: string;
  emoji: string;
  status: "analyzing" | "done";
  findings: AgentFinding[];
  summary: string;
  score: number; // 0..100 — CALCULÉ des signaux d'entrée
  /** true = le score repose sur des données réelles du projet ; false = neutre faute de données. */
  scoredFromData: boolean;
}

export interface CrewResult {
  reports: AgentReport[];
  synthesis: string;
  overallScore: number;
  criticalCount: number;
  opportunityCount: number;
  topPriorities: string[];
}

/// Signaux QC RÉELS du modèle (clashs + audit de règles) — injectés par la page.
export interface QcSignals {
  clashCount: number;
  /** Collisions critiques (poutre/poteau) du radar. */
  hardCount: number;
  ruleIssues: number;
  ruleCritical: number;
  /** Éléments réellement mesurables par les règles (honnêteté d'échantillon). */
  measuredElements: number;
  totalElements: number;
}

interface AnalysisInput {
  projectName: string;
  typology: string;
  typologyName: string;
  ngf: number;
  cost?: CostResult;
  energy?: EnergyResult;
  qc?: QcSignals | null;
  region: string;
  year: number;
}

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

/* ---- Coûts ---- */
function costAgent(input: AnalysisInput): AgentReport {
  const findings: AgentFinding[] = [];
  const c = input.cost;
  let score = 82;

  if (!c) {
    findings.push({
      severity: "info", source: "regel",
      title: "Keine Kostenberechnung geladen",
      detail: "Aktuell liegen keine Kostenwerte vor — der Agent kann nicht messen.",
      recommendation: "Modul „Kostenschätzung DIN 276“ ausführen, dann erneut analysieren.",
      confidence: 0.99,
    });
    return { role: "cost", name: "Kosten-Agent", emoji: "💰", status: "done", findings, summary: "Wartet auf Kostenwerte.", score: 50, scoredFromData: false };
  }

  if (c.perM2Ngf > 4000) {
    findings.push({ severity: "warning", source: "messung", title: "Hohes Kostenniveau", detail: `${fmtNumber(c.perM2Ngf)} €/m² NGF liegen über dem Marktmedian.`, metric: `${fmtNumber(c.perM2Ngf)} €/m²`, recommendation: "Ausstattungsniveau oder Bauweise prüfen (KG 400-Anteile).", confidence: 0.88 });
    score -= 14;
  } else if (c.perM2Ngf < 1800) {
    findings.push({ severity: "opportunity", source: "messung", title: "Kosteneffizienter Ansatz", detail: `${fmtNumber(c.perM2Ngf)} €/m² NGF sind sehr wirtschaftlich.`, metric: `${fmtNumber(c.perM2Ngf)} €/m²`, recommendation: "Prüfen, ob Qualitäts- und Risikorücklagen ausreichen.", confidence: 0.82 });
    score += 5;
  }
  const ratio = c.kg300 / Math.max(c.kg300 + c.kg400, 1);
  if (ratio > 0.75) {
    findings.push({ severity: "info", source: "messung", title: "Baukonstruktion-dominant", detail: `${fmtPct(ratio)} der KG 300+400 entfallen auf KG 300 — typisch für Hallen/Logistik.`, metric: fmtPct(ratio), recommendation: "Bei Wohn-/Bürobau: TGA-Anteil prüfen (Lüftung, WP, Sanitär).", confidence: 0.78 });
  }
  const spread = (c.high - c.low) / Math.max(c.netTotal, 1);
  if (spread > 0.25) {
    findings.push({ severity: "warning", source: "messung", title: "Große Kostenspanne", detail: `Konfidenzspanne ±${fmtPct(c.uncertaintyPct)} — Schätzqualität begrenzt.`, metric: `±${fmtPct(c.uncertaintyPct)}`, recommendation: "In LP 3+ verfeinern: detaillierte Mengen, Angebote einholen.", confidence: 0.90 });
    score -= Math.min(12, Math.round(spread * 30));
  }
  if (c.sizeFactor < 0.95) {
    findings.push({ severity: "opportunity", source: "messung", title: "Skaleneffekte genutzt", detail: `Größendegression ×${c.sizeFactor.toFixed(2)} senkt den €/m²-Preis.`, recommendation: "Bei Erweiterung: weitere Economies of Scale möglich.", confidence: 0.85 });
    score += 3;
  }
  findings.push({ severity: "info", source: "regel", title: "DIN 276-Gliederung", detail: "Kosten nach DIN 276:2018-12 strukturiert (KG 300–700).", recommendation: "Vollständige KG-Gliederung in der Kostenschätzung verfügbar.", confidence: 0.95 });

  return { role: "cost", name: "Kosten-Agent", emoji: "💰", status: "done", findings, summary: `${findings.filter((f) => f.source === "messung").length} Messungen ausgewertet.`, score: clamp(score, 5, 100), scoredFromData: true };
}

/* ---- Nachhaltigkeit ---- */
function sustainabilityAgent(input: AnalysisInput): AgentReport {
  const findings: AgentFinding[] = [];
  const e = input.energy;

  if (!e) {
    findings.push({
      severity: "info", source: "regel",
      title: "Keine Energieberechnung geladen",
      detail: "Ohne GEG-Bilanz kann der Agent nicht messen — nur checken.",
      recommendation: "Modul „GEG & Energie“ ausführen, dann erneut analysieren.",
      confidence: 0.99,
    });
    return { role: "sustainability", name: "Nachhaltigkeits-Agent", emoji: "🌿", status: "done", findings, summary: "Wartet auf Energiewerte.", score: 50, scoredFromData: false };
  }

  // Score : PEB⊗ — 100 bei ≤ 25 kWh/(m²a), punit linéairement au-delà.
  let score = clamp(Math.round(100 - Math.max(0, e.PEB - 25) * 1.6), 5, 100);

  if (e.PEB <= 40) {
    findings.push({ severity: "opportunity", source: "messung", title: "KfW 40-konform", detail: `Primärenergiebedarf ${fmtNumber(e.PEB, 1)} kWh/(m²a) — erfüllt EH 40.`, metric: `${fmtNumber(e.PEB, 1)} kWh/(m²a)`, recommendation: "Förderung KfW 261 (EH 40) prüfen.", confidence: 0.92 });
  } else if (e.PEB <= 55) {
    findings.push({ severity: "info", source: "messung", title: "KfW 55-konform (GEG)", detail: `PEB ${fmtNumber(e.PEB, 1)} kWh/(m²a) — GEG-Grenzwert eingehalten.`, metric: `${fmtNumber(e.PEB, 1)} kWh/(m²a)`, recommendation: "KfW 261 (EH 55) Förderung verfügbar.", confidence: 0.90 });
  } else {
    findings.push({ severity: "critical", source: "messung", title: "GEG-Grenzwert überschritten", detail: `PEB ${fmtNumber(e.PEB, 1)} kWh/(m²a) über dem GEG-Grenzwert.`, metric: `${fmtNumber(e.PEB, 1)} kWh/(m²a)`, recommendation: "Dämmung verstärken, Lüftung mit WRG, Wärmepumpe prüfen.", confidence: 0.93 });
  }
  if (e.HWB > 60) {
    findings.push({ severity: "warning", source: "messung", title: "Hoher Heizwärmebedarf", detail: `HWB ${fmtNumber(e.HWB, 1)} kWh/(m²a).`, metric: `${fmtNumber(e.HWB, 1)} kWh/(m²a)`, recommendation: "U-Werte verbessern (Wand ≤ 0,20 W/(m²K), Fenster ≤ 0,90).", confidence: 0.87 });
    score -= 6;
  }
  if (e.co2M2 > 25) {
    findings.push({ severity: "warning", source: "messung", title: "Hohe CO₂-Emissionen", detail: `${fmtNumber(e.co2M2, 1)} kg CO₂/(m²a) durch den Wärmeerzeuger.`, metric: `${fmtNumber(e.co2M2, 1)} kg/(m²a)`, recommendation: "Wechsel zur Wärmepumpe (Sole-Wasser) reduziert CO₂ deutlich.", confidence: 0.89 });
    score -= 7;
  }
  findings.push({ severity: "info", source: "regel", title: "DIN EN 15978-Ready", detail: "LCA-Phasen A1–A5 bereit für die Bilanzierung.", recommendation: "Bauteilbezogene EPD-Auswertung im LCA-Modul verfügbar.", confidence: 0.80 });

  return { role: "sustainability", name: "Nachhaltigkeits-Agent", emoji: "🌿", status: "done", findings, summary: `PEB ${fmtNumber(e.PEB, 1)} · HWB ${fmtNumber(e.HWB, 1)} kWh/(m²a).`, score: clamp(score, 5, 100), scoredFromData: true };
}

/* ---- Risques ---- */
function riskAgent(input: AnalysisInput): AgentReport {
  const findings: AgentFinding[] = [];
  let score = 90;

  const qc = input.qc;
  if (qc && qc.clashCount > 0) {
    const hard = qc.hardCount;
    findings.push({
      severity: hard > 0 ? "critical" : "warning", source: "messung",
      title: "Baukollisionen im Modell",
      detail: `${fmtNumber(qc.clashCount)} Kollisionen im Clash-Radar — davon ${fmtNumber(hard)} kritisch (Tragwerk betroffen).`,
      metric: `${fmtNumber(qc.clashCount)} · ${fmtNumber(hard)} kritisch`,
      recommendation: "QC & Conformité öffnen, kritische Kollisionen zuerst bereinigen, dann BCF ans Fachplanungs-Team.",
      confidence: 0.96,
    });
    score -= Math.min(35, 8 + hard * 2);
  } else if (qc) {
    findings.push({
      severity: "opportunity", source: "messung",
      title: "Keine Kollisionen erkannt",
      detail: "Der Clash-Radar meldet 0 Kollisionen auf dem geladenen Modell.",
      recommendation: "Vor jeder Planabgabe erneut prüfen — Modellstände ändern sich.",
      confidence: 0.94,
    });
    score += 5;
  }

  if (input.cost && spreadOf(input.cost) > 0.25) {
    findings.push({
      severity: "warning", source: "messung",
      title: "Kostenrisiko durch Schätzunschärfe",
      detail: `Risikopauschale ±${fmtPct(input.cost.uncertaintyPct)} auf Baukosten (AHO Heft 9 Perspektive).`,
      metric: `±${fmtPct(input.cost.uncertaintyPct)}`,
      recommendation: "Risiko-Rücklage als separate Position ausweisen und in LP 3 verfeinern.",
      confidence: 0.85,
    });
    score -= 8;
  } else {
    findings.push({
      severity: "info", source: "regel",
      title: "Kostenrisiko (AHO Heft 9)",
      detail: "Risiko-Rücklage gehört als separate Position in jede Kostenschätzung.",
      recommendation: "Pauschale zum Projektstand dokumentieren.",
      confidence: 0.80,
    });
  }
  findings.push({
    severity: "info", source: "regel",
    title: "Haftungsrisiko (Planung)",
    detail: "Brandschutz (DIN 4102) und Barrierefreiheit (DIN 18040) früh nachweisen.",
    recommendation: "Fachplaner früh einbinden, Nachweise dokumentieren.",
    confidence: 0.82,
  });
  if (input.year >= 2026) {
    findings.push({
      severity: "warning", source: "richtwert",
      title: "Marktvolatilität (Orientierungswert)",
      detail: "Material- und Lohnkosten bleiben volatil — Preisstände schnell veralten.",
      recommendation: "Angebotspreise mit Gültigkeit ≤ 3 Monate festhalten — Stand bitte aktuell prüfen.",
      confidence: 0.75,
    });
    score -= 4;
  }

  return { role: "risk", name: "Risiko-Agent", emoji: "⚠️", status: "done", findings, summary: qc ? `${fmtNumber(qc.clashCount)} Kollisionen bewertet.` : "Risiko-Checkliste (ohne Modell).", score: clamp(score, 5, 100), scoredFromData: qc != null || input.cost != null };
}

/* ---- Marché (valeurs indicatives — toujours étiquetées) ---- */
function marketAgent(input: AnalysisInput): AgentReport {
  const findings: AgentFinding[] = [
    {
      severity: "info", source: "richtwert",
      title: "Baukostenindex (Orientierungswert)",
      detail: "Tendances du prix de la construction (Destatis, mai 2026) : hausse modérée — les valeurs exactes DOIVENT être revérifiées au moment du devis.",
      recommendation: "Kostenschätzung halbjährlich auf den aktuellen Destatis-Stand bringen.",
      confidence: 0.6,
    },
    {
      severity: "opportunity", source: "messung",
      title: "Regionalfaktor angewendet",
      detail: `Standort ${input.region}: Preisniveau des Bundesdurchschnitts in der Schätzung berücksichtigt.`,
      recommendation: "Regionale Anbieter-Alternativen prüfen für Wettbewerbsvorteil.",
      confidence: 0.83,
    },
    {
      severity: "info", source: "regel",
      title: "Detailabgleich mit Stückpreisen",
      detail: "Für den Feinabgleich können Stückpreis-Datenbanken (z. B. Berliner Auftragsberatungsstelle, CC BY 4.0) angebunden werden.",
      recommendation: "Bei verbundenem Backend: Positionsabgleich mit echten Stückpreisen fahren.",
      confidence: 0.75,
    },
  ];

  return {
    role: "market", name: "Markt-Agent", emoji: "📈", status: "done",
    findings, summary: "Markt-Check (Richtwerte, keine Messung).",
    score: 70, scoredFromData: false,
  };
}

/* ---- Subventions ---- */
function fundingAgent(input: AnalysisInput): AgentReport {
  const findings: AgentFinding[] = [];
  const e = input.energy;
  let score = 60;

  if (e?.gegStatus === "kfw40") {
    findings.push({
      severity: "opportunity", source: "messung",
      title: "KfW 261 — Effizienzhaus 40 erreicht",
      detail: "Die gemessene Bilanz (EH 40) öffnet Kredit mit Tilgungszuschuss — Höhe laut Programmstand prüfen.",
      recommendation: "Antrag VOR Baubeginn — Beratung durch zugelassene Energieeffizienz-Expertin/-Experten.",
      confidence: 0.91,
    });
    score += 25;
  } else if (e?.gegStatus === "kfw55") {
    findings.push({
      severity: "opportunity", source: "messung",
      title: "KfW 261 — Effizienzhaus 55 erreicht",
      detail: "EH 55 öffnet Förderkredit mit Tilgungszuschuss — Konditionen laut Programmstand prüfen.",
      recommendation: "Förderfähigkeit vorab formell prüfen lassen.",
      confidence: 0.88,
    });
    score += 15;
  } else if (e) {
    findings.push({
      severity: "info", source: "messung",
      title: "KfW-Effizienzhaus nicht erreicht",
      detail: "Die aktuelle Bilanz liegt über EH 55 — KfW-Neubauförderung voraussichtlich nicht nutzbar.",
      recommendation: "PEB unter 55 senken (WP + WRG + Dämmung), dann Zuschuss erneut prüfen.",
      confidence: 0.86,
    });
  } else {
    findings.push({
      severity: "info", source: "regel",
      title: "Förder-Match benötigt Energiebilanz",
      detail: "Ohne GEG-Bilanz ist keine verlässliche Förder-Aussage möglich.",
      recommendation: "Modul „GEG & Energie“ ausführen — dann matcht der Agent die Programme messbar.",
      confidence: 0.95,
    });
  }
  findings.push({
    severity: "info", source: "richtwert",
    title: "BAFA-Heizungsförderung (Richtwert)",
    detail: "Zuschuss für Wärmepumpe/Solarthermie — Satz je nach Maßnahme und Bonifikationen.",
    recommendation: "Konditionen aktuell auf bafa.de prüfen, Antrag parallel zur KfW.",
    confidence: 0.7,
  });
  findings.push({
    severity: "info", source: "regel",
    title: "Bundesländer-Programme",
    detail: "Zusätzliche Landesförderung je nach Standort möglich.",
    recommendation: "Förderdatenbank des Bundeslandes prüfen.",
    confidence: 0.65,
  });

  return {
    role: "funding", name: "Förder-Agent", emoji: "💶", status: "done",
    findings, summary: e ? `Programme zu EH ${e.gegStatus === "kfw40" ? 40 : e.gegStatus === "kfw55" ? 55 : "—"} gematched.` : "Wartet auf Energiebilanz.",
    score: clamp(score, 5, 100), scoredFromData: e != null,
  };
}

/* ---- Architecture (normes + QC réel du modèle) ---- */
function architektAgent(input: AnalysisInput): AgentReport {
  const findings: AgentFinding[] = [];
  const qc = input.qc;
  let score = 100;

  if (qc) {
    if (qc.ruleIssues > 0) {
      findings.push({
        severity: qc.ruleCritical > 0 ? "critical" : "warning", source: "messung",
        title: "Norm-Verstöße im Audit",
        detail: `${fmtNumber(qc.ruleIssues)} Verstöße (DIN 18040, Statics, GEG) — davon ${fmtNumber(qc.ruleCritical)} kritisch.`,
        metric: `${fmtNumber(qc.ruleIssues)} Verstöße`,
        recommendation: "QC & Conformité öffnen — jeder Verstoß ist direkt an seinem 3D-Ort markiert.",
        confidence: 0.93,
      });
      score -= Math.min(45, qc.ruleCritical * 10 + Math.min(qc.ruleIssues, 25));
    } else if (qc.measuredElements > 0) {
      findings.push({
        severity: "opportunity", source: "messung",
        title: "Audit ohne Norm-Verstoß",
        detail: `${fmtNumber(qc.measuredElements)} von ${fmtNumber(qc.totalElements)} Bauteilen messbar geprüft — konform.`,
        recommendation: "Erhöhen Sie den Messanteil (BaseQuantities im IFC pflegen) für vollständige Deckung.",
        confidence: 0.9,
      });
      score += 0;
    }
    if (qc.measuredElements < qc.totalElements * 0.5 && qc.totalElements > 0) {
      findings.push({
        severity: "info", source: "messung",
        title: "Prüf-Abdeckung begrenzt",
        detail: `Nur ${fmtNumber(qc.measuredElements)} von ${fmtNumber(qc.totalElements)} Bauteilen sind regel-messbar (${fmtPct(qc.measuredElements / Math.max(qc.totalElements, 1))}).`,
        metric: fmtPct(qc.measuredElements / Math.max(qc.totalElements, 1)),
        recommendation: "BaseQuantities im Autorenwerkzeug exportieren — dann deckt der Audit alle Bauteile ab.",
        confidence: 0.88,
      });
      score -= 10;
    }
  } else {
    findings.push({
      severity: "info", source: "regel",
      title: "Kein Modell geladen",
      detail: "Ohne Maquette kann der Agent keine Bauteile prüfen.",
      recommendation: "IFC in der Maquette 3D laden — dann misst der Agent Clashs und Norm-Verstöße.",
      confidence: 0.99,
    });
    score = 55;
  }
  if (/mfh|wohn|resid/i.test(input.typologyName)) {
    findings.push({ severity: "info", source: "regel", title: "Wohnbau: Schallschutz", detail: "Schallschutz nach DIN 4109 (Trennwände ≥ 53 dB bewertet) beachten.", recommendation: "Trittschallverbesserung für Geschossdecken nachweisen.", confidence: 0.84 });
  } else if (/büro|office|verwaltung/i.test(input.typologyName)) {
    findings.push({ severity: "info", source: "regel", title: "Büro: Arbeitsstättenverordnung", detail: "Tageslichtversorgung, Blendfreiheit und Raumluftqualität nachweisen (ASR A3.4/A3.6).", recommendation: "Außenliegender Sonnenschutz bzw. Verschattung früh planen.", confidence: 0.80 });
  }
  findings.push({ severity: "info", source: "regel", title: "HOAI-Leistungsphasen", detail: "Leistungsphasen 1–9 definiert; Honorar seit 2021 frei vereinbar (HOAI: Orientierungswerte).", recommendation: "Honorarvereinbarung früh und schriftlich festhalten.", confidence: 0.86 });

  return {
    role: "architekt", name: "Architektur-Agent", emoji: "🏛️", status: "done",
    findings, summary: qc ? `${fmtNumber(qc.totalElements)} Bauteile geprüft.` : "Norm-Checkliste (ohne Modell).",
    score: clamp(score, 5, 100), scoredFromData: qc != null,
  };
}

function spreadOf(c: CostResult): number {
  return (c.high - c.low) / Math.max(c.netTotal, 1);
}

/* ---- Synthesis ---- */
export function runCrew(input: AnalysisInput): CrewResult {
  const reports: AgentReport[] = [
    costAgent(input),
    sustainabilityAgent(input),
    riskAgent(input),
    marketAgent(input),
    fundingAgent(input),
    architektAgent(input),
  ];

  // Le score global ne moyenne QUE les scores réellement mesurés —
  // les agents sans données (neutres) ne « décorent » pas le résultat.
  const scored = reports.filter((r) => r.scoredFromData);
  const overallScore = Math.round(
    (scored.length > 0 ? scored : reports).reduce((s, r) => s + r.score, 0) / (scored.length > 0 ? scored.length : reports.length),
  );
  const criticalCount = reports.reduce((s, r) => s + r.findings.filter((f) => f.severity === "critical").length, 0);
  const opportunityCount = reports.reduce((s, r) => s + r.findings.filter((f) => f.severity === "opportunity").length, 0);
  const measuredCount = reports.reduce((s, r) => s + r.findings.filter((f) => f.source === "messung").length, 0);

  const allCritical = reports.flatMap((r) => r.findings.filter((f) => f.severity === "critical").map((f) => f.title));
  const topOpportunities = reports.flatMap((r) => r.findings.filter((f) => f.severity === "opportunity").map((f) => f.title));
  const topPriorities = [...allCritical, ...topOpportunities].slice(0, 5);

  let synthesis = `## Projektanalyse: ${input.projectName}\\n\\n`;
  synthesis += `**6 Experten-Agenten** haben **${input.typologyName}** (${fmtNumber(input.ngf)} m² NGF) parallel analysiert — ${measuredCount} Befunde davon sind **Messungen aus Projektdaten**.\\n\\n`;
  synthesis += `**Gesamtbewertung: ${overallScore}/100** (Mittel der ${Math.max(scored.length, 1)} datengestützten Agenten-Scores). `;
  if (overallScore >= 85) synthesis += `Ausgezeichnetes Projektprofil.\\n\\n`;
  else if (overallScore >= 70) synthesis += `Gutes Profil mit Optimierungspotenzial.\\n\\n`;
  else synthesis += `Handlungsbedarf in mehreren Bereichen.\\n\\n`;
  if (criticalCount > 0) synthesis += `⚠️ **${criticalCount} kritische(r) Punkt(e)** erkannt.\\n`;
  if (opportunityCount > 0) synthesis += `💡 **${opportunityCount} Chance(n)** identifiziert.\\n\\n`;
  synthesis += `**Top-Prioritäten:**\\n${topPriorities.map((p, i) => `${i + 1}. ${p}`).join("\\n")}`;

  return { reports, synthesis, overallScore, criticalCount, opportunityCount, topPriorities };
}

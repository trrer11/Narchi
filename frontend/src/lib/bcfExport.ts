// Narchi — BCF 3.0 export (BIM Collaboration Format).
// Industry-standard XML for exchanging issues between BIM tools.

import type { Clash, Pin } from "@/lib/planpruefung";
import type { ClashGroup } from "@/lib/clashGroups";

/// Topics BCF construits sur les VRAIES collisions détectées (avant, le bouton
/// « Export BCF » exportait les pins factices « Plans de Révision » — donc un
/// fichier vide. Retour utilisateur 2026-08-06 : plus de données factices).
export function clashesTopics(clashes: Clash[], limit = 500): Pin[] {
  const mm = (m: number) => Math.max(1, Math.round(m * 1000));
  return clashes.slice(0, limit).map((c) => ({
    id: c.id,
    sheetId: "bim-iq",
    x: 0,
    y: 0,
    title: `${c.type.toUpperCase()} · ${c.nameA} ⇄ ${c.nameB} (Eindringtiefe ${mm(c.overlap[0])} × ${mm(c.overlap[1])} × ${mm(c.overlap[2])} mm)`,
    note:
      `${c.description} — Klasse ${c.severity}. Zone exacte (Hotspot) centre ` +
      `[${c.hotspot.center.map((v) => v.toFixed(2)).join(", ")}] m, ` +
      `Eindringtiefe ${mm(c.overlap[0])} × ${mm(c.overlap[1])} × ${mm(c.overlap[2])} mm. ` +
      (c.expressIdA !== null ? `Express IDs: #${c.expressIdA} / #${c.expressIdB}.` : ""),
    status: "open" as const,
    author: "BIM-IQ Clash Detection",
    createdAt: new Date().toISOString(),
  }));
}

const SEV_DE: Record<Clash["severity"], string> = {
  critical: "Kritisch",
  major: "Major",
  minor: "Minor",
};

/// §37‑2 — Topics BCF par BEFUNDGRUPPE (constats regroupés, méthode bureau)
/// plutôt que par paire brute : Solibri/Bimcollab ouvrent un ticket par
/// PROBLÈME (« Decke × Wand, 47 Stellen »), pas par emboîtement de boîtes.
/// Le porte-parole (pire collision du foyer) porte hotspot + Express IDs ;
/// la Trefferliste complète est listée dans le commentaire.
export function befundTopics(groups: ClashGroup[], maxMembers = 24): Pin[] {
  const mm = (m: number) => Math.max(1, Math.round(m * 1000));
  return groups.map((g) => {
    const rep = g.representative;
    const members = g.clashes.slice(0, maxMembers);
    return {
      id: `${g.id}-befund-${rep.elementA}-${rep.elementB}`.replace(/[^a-zA-Z0-9-]/g, "-"),
      sheetId: "bim-iq",
      x: 0,
      y: 0,
      title: `${g.id} · ${g.title} · ${g.count} ${g.count === 1 ? "Stelle" : "Stellen"} (${SEV_DE[g.severity]})`,
      note:
        `Befundgruppe ${g.id} — ${g.title}. ${g.count} Kollision${g.count === 1 ? "" : "en"} desselben Foyers ` +
        `(Radius 4 m), schwerste Klasse: ${SEV_DE[g.severity]}. ` +
        (g.levels.length > 0 ? `Ebenen: ${g.levels.join(", ")}. ` : "") +
        `Ø Eindringtiefe ${mm(g.typicalOverlap[0])} × ${mm(g.typicalOverlap[1])} × ${mm(g.typicalOverlap[2])} mm. ` +
        `Stellvertreter: ${rep.nameA} ⇄ ${rep.nameB} — Hotspot centre ` +
        `[${rep.hotspot.center.map((v) => v.toFixed(2)).join(", ")}] m. ` +
        (rep.expressIdA !== null ? `Express IDs: #${rep.expressIdA} / #${rep.expressIdB}. ` : "") +
        `Trefferliste: ${members.map((c) => `${c.nameA} ⇄ ${c.nameB}`).join(" · ")}` +
        (g.count > maxMembers ? ` · +${g.count - maxMembers} weitere (Radar « Alle Treffer »).` : ""),
      status: "open" as const,
      author: "BIM-IQ Befundgruppen",
      createdAt: new Date().toISOString(),
    };
  });
}

function isoBcfDate(iso: string): string {
  return iso.replace("Z", "+00:00").slice(0, 19) + "Z";
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]!));
}

/** Generate a complete BCF 3.0 markup XML from plan pins. */
export function generateBcf(pins: Pin[]): string {
  const topicsXml = pins.map((p, i) => {
    const guid = p.id.replace(/[^a-zA-Z0-9-]/g, "") || `topic-${i}`;
    const topicType = "Error"; // Default type if not mapped
    const status = p.status === "resolved" ? "Closed" : "Open";

    const commentsXml = [
      { date: p.createdAt, author: p.author || "Unknown", comment: p.note || p.title },
    ].map((c, j) => `
      <Comment>
        <Guid>${guid}-c${j + 1}</Guid>
        <Date>${isoBcfDate(c.date)}</Date>
        <Author>${escapeXml(c.author)}</Author>
        <Comment>${escapeXml(c.comment)}</Comment>
        <TopicGuid>${guid}</TopicGuid>
      </Comment>`).join("");

    return `
    <Markup>
      <Header />
      <Topic>
        <Guid>${guid}</Guid>
        <Title>${escapeXml(p.title.slice(0, 80))}</Title>
        <Priority>MEDIUM</Priority>
        <TopicStatus>${status}</TopicStatus>
        <TopicType>${topicType}</TopicType>
        <CreationDate>${isoBcfDate(p.createdAt)}</CreationDate>
        <CreationAuthor>${escapeXml(p.author || "Unknown")}</CreationAuthor>
      </Topic>
      ${commentsXml}
    </Markup>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<BCF version="3.0">
${topicsXml}
</BCF>`;
}

export function downloadBcf(pins: Pin[]) {
  const xml = generateBcf(pins);
  const stamp = new Date().toISOString().slice(0, 10);
  const blob = new Blob([xml], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `narchi-bcf-${stamp}.bcf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

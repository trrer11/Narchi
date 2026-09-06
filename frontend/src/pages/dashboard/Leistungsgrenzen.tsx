import { Card, PageHeader } from "@/components/ui";

const ROWS: { thema: string; stand: string; buero: string }[] = [
  {
    thema: "Clash Mesh / Manifold",
    stand: "Nicht geliefert. Planprüfung und Qualität rechnen AABB-Quader aus der IFC.",
    buero: "Feine Kollision im Autorenwerkzeug prüfen.",
  },
  {
    thema: "WebGPU",
    stand: "Nicht genutzt. Maquette = That Open + Three.js WebGL.",
    buero: "Edge mit WebGL. Kein Renderer-Wechsel in dieser Beta.",
  },
  {
    thema: "Speckle",
    stand: "Nicht angebunden. Kein Stream, kein Connector.",
    buero: "IFC importieren. Kein Cloud-BIM.",
  },
  {
    thema: "EnergyPlus / TEASER",
    stand: "Nicht eingebaut. GEG-Seite = Kennwerte, keine dynamische Simulation.",
    buero: "Nachweis beim Energieberater.",
  },
  {
    thema: "Peppol Access Point",
    stand: "UBL-Datei ja (KoSIT). Versand ins Netz: nein. Kein Teilnehmer-ID-Dienst.",
    buero: "UBL/.eml herunterladen und über den eigenen Kanal senden.",
  },
  {
    thema: "Agent-Reach / Web-Scraping",
    stand: "Nicht eingebaut. Kein Twitter/Reddit/YouTube im Büro-Stack. Keine Cookies von Fremdseiten.",
    buero: "Preise: Destatis/BKI/eigene Liste. Normen: amtliche Texte. Kein Scraping gegen Nutzungsbedingungen.",
  },
];

export default function Leistungsgrenzen() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Grenzen & Recht"
        subtitle="Was NARCHI in der Beta nicht ist — damit kein Büro etwas Falsches nach außen gibt"
      />
      <Card className="space-y-3 p-5">
        <p className="text-sm leading-relaxed text-slate-700">
          Diese Seite ist Teil des Produkts, kein Kleingedrucktes. Kalkulationen, Clash,
          GEG und Rechnungs-XML sind Hilfsmittel. Das Büro prüft, bevor es unterschreibt
          oder einreicht. Herkunft: Messung / Richtwert / Regel.
        </p>
        <p className="text-xs text-slate-500">
          Wortlaut für den Anwalt und den Inhaber: docs/LEISTUNGSGRENZEN_BETA_DE.md
        </p>
      </Card>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Thema</th>
              <th className="px-4 py-2">Stand in NARCHI</th>
              <th className="px-4 py-2">Aufgabe des Büros</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.thema} className="border-t border-slate-100 align-top">
                <td className="px-4 py-3 font-semibold text-slate-900">{r.thema}</td>
                <td className="px-4 py-3 text-slate-700">{r.stand}</td>
                <td className="px-4 py-3 text-slate-600">{r.buero}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

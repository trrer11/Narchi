import { useEffect, useState } from "react";
import { LogoMark } from "@/components/Logo";
import { useApp } from "@/store/AppStore";
import { pullOfficeBlob } from "@/lib/officeBlobSync";
import {
  EMPTY_LEGAL,
  displayOrPlaceholder,
  legalIsFilled,
  parseOfficeLegal,
  type OfficeLegal,
} from "@/lib/officeLegal";

type Tab = "impressum" | "datenschutz" | "agb";

function tabFromPath(path: string): Tab {
  if (path.includes("datenschutz")) return "datenschutz";
  if (path.includes("agb")) return "agb";
  return "impressum";
}

export default function Legal() {
  const { navigate, route } = useApp();
  const tab = tabFromPath(route.path);
  const [legal, setLegal] = useState<OfficeLegal>(EMPTY_LEGAL);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const r = await pullOfficeBlob("impressum");
      if (!live) return;
      if (r && !r.empty) setLegal(parseOfficeLegal(r.payload));
      setLoaded(true);
    })();
    return () => {
      live = false;
    };
  }, []);

  const filled = legalIsFilled(legal);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-5">
          <button type="button" className="flex items-center gap-2" onClick={() => navigate("/")}>
            <LogoMark size={28} />
            <span className="font-display font-bold">NARCHI</span>
          </button>
          <button type="button" className="text-sm text-slate-500 hover:text-slate-900" onClick={() => navigate("/")}>
            Zurück zur Startseite
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-10">
        <div className={`rounded-xl border px-4 py-3 text-sm ${filled ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-amber-300 bg-amber-50 text-amber-950"}`}>
          {filled ? (
            <>Angaben aus <strong>Einstellungen → Impressum</strong>. Entwurf, keine Rechtsberatung. Anwalt vor öffentlichem Launch.</>
          ) : (
            <>
              <strong>Noch nicht ausgefüllt.</strong> Pflichtangaben § 5 DDG fehlen. Inhaber: Einstellungen → Impressum.
              Ohne Name, Anschrift und E-Mail bleibt das Impressum unvollständig — wir erfinden nichts.
            </>
          )}
        </div>

        <nav className="mt-6 flex flex-wrap gap-2" aria-label="Rechtstexte">
          {(
            [
              ["impressum", "/impressum", "Impressum"],
              ["datenschutz", "/datenschutz", "Datenschutz"],
              ["agb", "/agb", "AGB / AVV"],
            ] as const
          ).map(([id, href, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => navigate(href)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                tab === id ? "bg-ink-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        {tab === "impressum" && <ImpressumBody legal={legal} loaded={loaded} />}
        {tab === "datenschutz" && <DatenschutzBody legal={legal} />}
        {tab === "agb" && <AgbBody />}
      </main>
    </div>
  );
}

function H({ children }: { children: string }) {
  return <h2 className="mt-8 font-display text-lg font-bold text-slate-900">{children}</h2>;
}

function ImpressumBody({ legal, loaded }: { legal: OfficeLegal; loaded: boolean }) {
  return (
    <article className="prose-sm mt-6 max-w-none space-y-3 text-[15px] leading-relaxed">
      <h1 className="font-display text-3xl font-bold">Impressum</h1>
      <p className="text-slate-500">Angaben gemäß § 5 DDG. {loaded ? "" : "Lädt…"}</p>
      <H>Diensteanbieter</H>
      <p>
        <strong>{displayOrPlaceholder(legal.firma, "[Name / Firma — Einstellungen]")}</strong>
        <br />
        {displayOrPlaceholder(legal.strasse, "[Straße und Hausnummer]")}
        <br />
        {displayOrPlaceholder(legal.plzOrt, "[PLZ Ort]")}, Deutschland
      </p>
      <p>Vertreten durch: {displayOrPlaceholder(legal.vertreten, "[Inhaber / Geschäftsführer]")}</p>
      <H>Kontakt</H>
      <p>
        E-Mail: {displayOrPlaceholder(legal.email, "[E-Mail]")}
        <br />
        Telefon: {displayOrPlaceholder(legal.telefon, "[Telefon — optional, empfohlen]")}
      </p>
      <H>USt-IdNr. / Register</H>
      <p>
        USt-IdNr. gemäß § 27a UStG:{" "}
        <strong>{displayOrPlaceholder(legal.ustId, "[nur wenn umsatzsteuerpflichtig]")}</strong>
      </p>
      <p>
        Register: {displayOrPlaceholder(legal.register, "[— / Handelsregister]")} · Gericht:{" "}
        {displayOrPlaceholder(legal.gericht, "[Amtsgericht]")} · Nr.: {displayOrPlaceholder(legal.hrb, "[HRB …]")}
      </p>
      <H>Inhalt nach § 18 Abs. 2 MStV</H>
      <p>
        {displayOrPlaceholder(legal.vertreten || legal.firma, "[wie oben]")}
        {legal.plzOrt ? `, ${legal.plzOrt}` : ""}
      </p>
      <H>Streitschlichtung</H>
      <p>
        OS-Plattform der EU-Kommission:{" "}
        <a className="text-brand-700 underline" href="https://ec.europa.eu/consumers/odr/" rel="noreferrer">
          ec.europa.eu/consumers/odr
        </a>
        . Wir sind nicht bereit und nicht verpflichtet, an einem Verfahren vor einer
        Verbraucherschlichtungsstelle teilzunehmen.
      </p>
      <H>Haftung</H>
      <p>
        Eigene Inhalte: Verantwortung nach den allgemeinen Gesetzen (§ 7 Abs. 1 DDG). Keine
        Überwachungspflicht für fremde Informationen (§§ 8–10 DDG). Links: verantwortlich ist der
        jeweilige Betreiber.
      </p>
    </article>
  );
}

function DatenschutzBody({ legal }: { legal: OfficeLegal }) {
  return (
    <article className="prose-sm mt-6 max-w-none space-y-3 text-[15px] leading-relaxed">
      <h1 className="font-display text-3xl font-bold">Datenschutzerklärung</h1>
      <p className="text-slate-500">Art. 13 / 14 DSGVO — Self-Host.</p>
      <H>1. Verantwortlicher</H>
      <p>
        {displayOrPlaceholder(legal.firma, "[Name / Firma]")}
        {legal.strasse ? `, ${legal.strasse}` : ""}
        {legal.plzOrt ? `, ${legal.plzOrt}` : ""}
        {legal.email ? `. E-Mail: ${legal.email}` : ". E-Mail: [Einstellungen]"}
        . Für <strong>Projekt- und Kundendaten des Büros</strong> ist das Büro selbst Verantwortlicher.
        NARCHI ist die Software.
      </p>
      <H>2. Betrieb</H>
      <p>
        Self-Host: PostgreSQL, Redis und Dateien auf der Infrastruktur des Büros (Windows + Docker,
        <code> http://localhost:8080</code>). Kein Pflicht-Cloud. Kein Tracking-Pixel. Session-Cookie
        HttpOnly (Secure nur bei HTTPS).
      </p>
      <H>3. Datenarten</H>
      <ul className="list-disc pl-5">
        <li>Konten: Name, E-Mail, Rolle, Passwort-Hash (Argon2id)</li>
        <li>Projekte, IFC-Mengen, Kosten, Honorare, Rechnungen</li>
        <li>Baustellenfotos/-videos und Mängeltexte</li>
        <li>Technische Logs (Betrieb, Fehler)</li>
      </ul>
      <H>4. Rechtsgrundlagen</H>
      <p>
        Art. 6 Abs. 1 lit. b (Vertrag), lit. c (Aufbewahrung § 147 AO / HGB), lit. f (Betriebssicherheit).
      </p>
      <H>5. Empfänger / Drittland</H>
      <p>
        Keine Übermittlung durch uns in ein Drittland, außer das Büro wählt selbst eine Infrastruktur
        außerhalb der EU/EWR. Optionaler OpenAI-Schlüssel bleibt auf dem Server des Büros.
      </p>
      <H>6–8. Speicherdauer, Rechte, Sicherheit</H>
      <p>
        Fristen gesetzlich (i. d. R. 6–10 Jahre). Rechte Art. 15–21 DSGVO über die Kontaktadresse oben.
        Mandantentrennung, Rollen, Hash, Rate-Limits. Alltagsweg: HTTP localhost.
      </p>
    </article>
  );
}

function AgbBody() {
  return (
    <article className="prose-sm mt-6 max-w-none space-y-3 text-[15px] leading-relaxed">
      <h1 className="font-display text-3xl font-bold">AGB und AVV</h1>
      <p>
        Vollständiger Entwurf: <code>docs/AGB_AVV_ENTWURF.md</code> (zur anwaltlichen Prüfung).
      </p>
      <ul className="list-disc pl-5">
        <li>Beta: 0 € gegen schriftliches Feedback; kein SLA; keine kritischen Daten.</li>
        <li>Lizenzvorschlag: 1.790 €/Jahr oder 3.900 € + 690 € Pflege — nicht 19 €/Monat.</li>
        <li>Software „wie besehen“ in der Beta. Keine Garantie für HOAI-/GEG-Bescheide Dritter.</li>
        <li>AVV (Art. 28 DSGVO): nötig, bevor der Inhaber auf Bürodaten zugreift.</li>
      </ul>
      <p className="text-slate-500">Keine Unterschrift über diese Seite. Papier / Anwalt.</p>
    </article>
  );
}

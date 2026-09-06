// Narchi — daily inspiration, humor & "wins" engine.
// Plays on psychology (dopamine via saved time/money), humor (architect jokes),
// and the irrational love-hate relationship architects have with their craft.

export interface Quote {
  text: string;
  author: string;
}

export const ARCHITECT_QUOTES: Quote[] = [
  { text: "God is in the details.", author: "Mies van der Rohe" },
  { text: "Less is more.", author: "Mies van der Rohe" },
  { text: "Form follows function.", author: "Louis Sullivan" },
  { text: "Wir bauen nicht für heute, sondern für morgen.", author: "Walter Gropius" },
  { text: "A house is a machine for living in.", author: "Le Corbusier" },
  { text: "Architektur ist gefrorene Musik.", author: "Friedrich Schelling" },
  { text: "Die Architektur ist die kunstvolle, genaue und großartige Auseinandersetzung mit dem Raum.", author: "Otto Wagner" },
  { text: "Good architecture lets the sun in.", author: "Narchi" },
  { text: "Buildings should serve people, not the other way around.", author: "Narchi" },
];

export interface Joke {
  setup: string;
  punchline: string;
}

export const ARCHITECT_JOKES: Joke[] = [
  { setup: "Wie viele Architekten braucht man, um eine Glühbirne zu wechseln?", punchline: "Keinen — das macht der Bauingenieur. Der Architekt streitet nur über die Form der Fassung." },
  { setup: "Was ist der Unterschied zwischen einem Architekten und einem Gott?", punchline: "Gott schuf die Welt aus dem Nichts. Architekte erstellt mindestens drei Varianten — und dann doch das Nichts." },
  { setup: "Warum tragen Architekte immer Schwarz?", punchline: "Damit man die Kaffee-Flecken nicht sieht." },
  { setup: "Ein Architekt, ein Ingenieur und ein Bauarbeiter streiten…", punchline: "…wer am wichtigsten ist. Sagt der Architekt: «Gott hat aus Chaos eine Welt geschaffen — das bin ich auch.» Sagt der Ingenieur: «Vor mir war alles strukturlös.» Sagt der Bauarbeiter: «Und wer hat den ganzen Dreck weggemacht?»" },
  { setup: "Was sagt der Architekt, wenn das Budget gekürzt wird?", punchline: "«Macht es minimalistisch.» — Zum dritten Mal." },
  { setup: "Treffen sich zwei Architekte.", punchline: "«Wie geht's?» — «Weißt du, mein letztes Projekt ist einsam.» — «Neues?» — «Nein, standen gelassen.»" },
  { setup: "Was ist die Lieblingsbeschäftigung eines Architekten im Urlaub?", punchline: "Andere Gebäude kritisieren." },
  { setup: "Warum sind Architekten nachts so produktiv?", punchline: "Weil sich tagsüber ständig jemand in ihre Pläne einmischt — der Bauherr." },
];

export interface Bausuende {
  title: string;
  emoji: string;
  desc: string;
}

export const BAUSUENDEN: Bausuende[] = [
  { title: "Die Tür, die nach innen in den Fluchtweg aufschlägt", emoji: "🚪", desc: "Klassiker. Seit 100 Jahren in der Musterbauordnung geregelt — und trotzdem jeder Woche neu entdeckt." },
  { title: "Fenster, die man nicht putzen kann", emoji: "🪟", desc: "Schön geschwungen. Unreinigbar. Ab Jahr 2: Milchglas-Optik gratis." },
  { title: "Die Stütze in der Mitte des Raums", emoji: "🏛️", desc: "Tragwerk trifft Raumprogramm. Einer von beiden muss weichen — meist der Mensch." },
  { title: "Steckdose hinter dem Einbaumöbel", emoji: "🔌", desc: "Vorne Wand, hinten Schrank, dazwischen: ein Traum von Stromanschluss." },
  { title: "Die 2 cm zu niedrige Decke im Bad", emoji: "🛁", desc: "Statik siegt über Komfort. Duschen wird zum Kontakt­sport." },
  { title: "Klimaanlage direkt über dem Schreibtisch", emoji: "❄️", desc: "Effizient gekühlt: der Laptop, die Kaffeetasse — und die linke Gehirnhälfte." },
  { title: "Behindertengerecht — bis zur ersten Stufe", emoji: "♿", desc: "DIN 18040 fast erfüllt. Nur diese eine Schwelle fehlt noch. Und die zweite." },
  { title: "Das Fenster ohne Sichtverbindung", emoji: "🙈", desc: "Tageslicht? Check. Aussicht? Auf die Brandwand des Nachbarn." },
];

export interface DailyTip {
  title: string;
  desc: string;
  icon: string;
}

export const DAILY_TIPS: DailyTip[] = [
  { title: "Frühzeitig heizen", desc: "Im Frühentwurf 5 cm mehr Dämmung kosten heute wenig — bei der Energierechnung später viel.", icon: "bolt" },
  { title: "Fluchtweg zuerst", desc: "Egal wie schön der Grundriss: erst retten, dann gestalten. DIN 4102 denkt nicht an Ästhetik.", icon: "shield" },
  { title: "Mengen parallel", desc: "Wenn Sie zeichnen, lässt Narchi parallel den Mengenauszug laufen. Null Mehraufwand.", icon: "scale" },
  { title: "Honorar offen", desc: "Sprechen Sie die Honorarzone früh an. Spätere Nachverhandlungen sind selten erfolgreich.", icon: "scale" },
  { title: "Tageslicht-Check", desc: "Ein_DF ≥ 2 % vor der Baueingabe sparen teure Änderungen im Genehmigungsverfahren.", icon: "sun" },
  { title: "Abstandsflächen", desc: "Schon im Vorentwurf prüfen — sie bestimmen oft, was überhaupt baubar ist.", icon: "pin" },
];

/* Deterministic "tip of the day" so it's stable per day. */
function dayIndex(): number {
  const epoch = new Date(new Date().getFullYear(), 0, 0);
  const today = new Date();
  return Math.floor((today.getTime() - epoch.getTime()) / 86400000);
}

export function tipOfTheDay(): DailyTip {
  return DAILY_TIPS[dayIndex() % DAILY_TIPS.length];
}
export function quoteOfTheDay(): Quote {
  return ARCHITECT_QUOTES[dayIndex() % ARCHITECT_QUOTES.length];
}
export function jokeOfTheDay(): Joke {
  return ARCHITECT_JOKES[dayIndex() % ARCHITECT_JOKES.length];
}
export function bausuendeOfTheDay(): Bausuende {
  return BAUSUENDEN[dayIndex() % BAUSUENDEN.length];
}

/* ===== "Heute gerettet" — the dopamine engine =====
   Counts what Narchi has saved the office today: hours, euros, errors avoided.
   Partly deterministic, partly reactive to real usage (syncs, estimates). */
export interface SavedToday {
  hours: number;
  euros: number;
  errorsAvoided: number;
  coffeesEarned: number;
  highlights: string[];
}

export function savedToday(activity: {
  estimates: number;
  energyRuns: number;
  syncs: number;
  imports: number;
}): SavedToday {
  const base = dayIndex();
  const hours = Math.round((2.5 + (activity.estimates * 0.4) + (activity.energyRuns * 0.3) + (activity.imports * 1.2)) * 10) / 10;
  const euros = Math.round((hours * 95) + base * 12 + activity.syncs * 320);
  const errorsAvoided = Math.round(3 + activity.estimates + activity.energyRuns * 0.5 + base % 4);
  const coffeesEarned = Math.max(1, Math.floor(hours / 1.5));

  const highlights: string[] = [];
  if (activity.imports > 0) highlights.push(`${activity.imports}× Mengenauszug aus dem Modell — statt 2 Tagen Tipparbeit`);
  if (activity.energyRuns > 0) highlights.push(`${activity.energyRuns}× GEG-Energiebilanz automatisch geprüft`);
  if (activity.estimates > 0) highlights.push(`${activity.estimates}× DIN 276-Kostenschätzung in Sekunden`);
  if (activity.syncs > 0) highlights.push(`${activity.syncs}× Quellen synchronisiert — Fehler erkannt, nicht weitergereicht`);
  if (highlights.length === 0) highlights.push("Referenz-Berechnungen bereit, sobald du das erste Modell importierst");

  return { hours, euros, errorsAvoided, coffeesEarned, highlights };
}

/* ===== Haftungsradar — loss aversion psychology ===== */
export interface LiabilityItem {
  id: string;
  severity: "critical" | "major" | "watch";
  title: string;
  risk: string;
  mitigated: string;
}

export const LIABILITY_RISKS: LiabilityItem[] = [
  { id: "liab-flucht", severity: "critical", title: "Fluchtweg & Brandschutz", risk: "Bei Nichteinhaltung drohen Stilllegung, Bußgelder und persönliche Haftung des Planers (§ 34 MBO, DIN 4102).", mitigated: "Merkblatt — Narchi prüft Fluchtwege nicht automatisch im Modell." },
  { id: "liab-barriere", severity: "major", title: "Barrierefreiheit (DIN 18040)", risk: "Nachträgliche Anpassungen sind teuer und oft Grund für Klagen bei öffentlicher Förderung.", mitigated: "Merkblatt — keine automatische Schwellen-/Türbreitenmessung." },
  { id: "liab-energie", severity: "critical", title: "GEG / Energieeffizienz", risk: "Nichterfüllung des GEG bedeutet Baustopp und Nachbesserung auf eigene Kosten.", mitigated: "GEG-Seite rechnet nur mit den Flächen, die Sie eingeben — 0 bleibt 0." },
  { id: "liab-kosten", severity: "major", title: "Kostensicherheit (DIN 276)", risk: "Schlechte Kostenschätzungen sind die häufigste Ursache für Planerverlust und Streit.", mitigated: "DIN-276-Schätzung nur bei NGF > 0; Kennwerte mit Herkunft, keine Markterfindung." },
  { id: "liab-abstand", severity: "watch", title: "Abstandsflächen", risk: "Verstoß führt zu Nachbarschaftsstreit und Auflagen — oft erst spät erkannt.", mitigated: "Merkblatt — keine geometrische Abstandsprüfung im Modell." },
  { id: "liab-tagesl", severity: "watch", title: "Tageslichtnachweis", risk: "Im Baugenehmigungsverfahren zunehmend gefordert — Nachweise kosten Zeit.", mitigated: "Merkblatt — kein automatischer Tageslichtquotient." },
];

export const SEVERITY_META: Record<LiabilityItem["severity"], { label: string; tone: string; color: string }> = {
  critical: { label: "Kritisch", tone: "rose", color: "#f43f5e" },
  major: { label: "Wichtig", tone: "amber", color: "#f59e0b" },
  watch: { label: "Beobachten", tone: "slate", color: "#64748b" },
};

/** §256 — zwei Stundenbücher, nicht mergen. Nur erklären + springen. */
import { Button } from "@/components/ui";
import { useApp } from "@/store/AppStore";

export function StundenBruecke({ hier }: { hier: "hoai" | "buero" }) {
  const { navigate } = useApp();
  if (hier === "hoai") {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        <p className="font-semibold">Dieses Buch: HOAI-Projektstunden (Deckungsbeitrag).</p>
        <p className="mt-1 text-xs text-slate-500">
          Ein zweites Buch existiert unter Büro-Stunden (Auslastung). Sie werden nicht zusammengerechnet.
        </p>
        <Button size="sm" variant="secondary" className="mt-2" onClick={() => navigate("/app/practice")}>
          Büro-Stunden öffnen
        </Button>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
      <p className="font-semibold">Dieses Buch: Büro-Auslastung (fakturierbar / nicht).</p>
      <p className="mt-1 text-xs text-slate-500">
        HOAI-Deckungsbeitrag liegt unter HOAI-Honorar. Keine automatische Fusion.
      </p>
      <Button size="sm" variant="secondary" className="mt-2" onClick={() => navigate("/app/hoai")}>
        HOAI-Stunden öffnen
      </Button>
    </div>
  );
}

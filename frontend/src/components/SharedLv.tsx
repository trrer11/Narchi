/**
 * §89 — V2.7 étape 3 (2/2) : « Gemeinsame LV-Positionen » co-éditées.
 *
 * MÊME connexion CRDT que la Notiz (le handle arrive en prop — aucune
 * seconde WebSocket n'est ouverte) : chaque cellule modifiée se propage
 * en direct à tous les collègues, sans écraser leurs frappes en cours
 * sur les AUTRES positions (CRDT last-writer-wins PAR CELLULE — dit
 * honnêtement, pas de « merge sémantique » prétendu).
 *
 * Honnêtetés affichées (charte §36) : EP = saisie manuelle (« kein
 * automatischer Preisspiegel ») ; position sans EP = « ohne EP »,
 * EXCLUE du total et comptée à part ; borne 500 = constante servie,
 * jamais cachée.
 */
import { useEffect, useMemo, useState } from "react";
import type * as Y from "yjs";
import { secureFetch } from "@/auth/SecuritySanitizer";
import { NOTIZ_ROOM, type SharedNotizHandle } from "@/lib/collabDoc";
import SharedOffers from "@/components/SharedOffers";
import {
  filenameFromDisposition,
  gaebErrorMessage,
  lvGaebDownloadPath,
  lvGaebFallbackFilename,
} from "@/lib/lvGaebExport";
import {
  addPosition,
  deletePosition,
  formatEuro,
  formatQty,
  LV_KEY,
  LV_MAX_POSITIONS,
  LV_UNITS,
  lvTotals,
  parseLvNumber,
  positionGp,
  positionsFromYArray,
  setPositionCell,
  sortByOz,
  validateDraft,
  type LvPosition,
} from "@/lib/lvOps";

type CellField = "oz" | "title" | "qty" | "unit_price";

function CellText({
  display,
  title,
  onCommit,
  className,
}: {
  display: string;
  title?: string;
  onCommit: (raw: string) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(display);
  const [editing, setEditing] = useState(false);
  // Mise à jour distante HORS édition : on suit l'état partagé. Pendant
  // la frappe, le brouillon local gagne (sinon le curseur saute) — dit.
  useEffect(() => {
    if (!editing) setDraft(display);
  }, [display, editing]);
  return (
    <input
      value={editing ? draft : display}
      title={title}
      onFocus={() => {
        setDraft(display);
        setEditing(true);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (draft !== display) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setDraft(display);
          setEditing(false);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={`w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-xs text-slate-800 transition hover:border-slate-200 focus:border-sky-400 focus:bg-white focus:outline-none ${className ?? ""}`}
    />
  );
}

export default function SharedLv({ handle }: { handle: SharedNotizHandle }) {
  const doc = handle.doc;
  const yarr = useMemo(() => doc.getArray(LV_KEY) as Y.Array<unknown>, [doc]);
  const [positions, setPositions] = useState<LvPosition[]>(() => positionsFromYArray(yarr));
  const [open, setOpen] = useState(false);
  const [oz, setOz] = useState("");
  const [title, setTitle] = useState("");
  const [qtyStr, setQtyStr] = useState("");
  const [unit, setUnit] = useState<string>(LV_UNITS[0]);
  const [epStr, setEpStr] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  // §90 — export GAEB : erreurs serveur affichées EN CLAIR (OZ ohne EP),
  // jamais de toast mensongeux « Export erfolgreich » sur un échec.
  const [gaebBusy, setGaebBusy] = useState(false);
  const [gaebError, setGaebError] = useState<string | null>(null);
  const [gaebDone, setGaebDone] = useState<string | null>(null);

  // deepObserve : TOUTE modification (locale ou distante, y compris dans
  // une sous-Map) réaffiche l'état partagé — jamais de copie optimiste.
  useEffect(() => {
    const sync = () => setPositions(positionsFromYArray(yarr));
    yarr.observeDeep(sync);
    return () => yarr.unobserveDeep(sync);
  }, [yarr]);

  const sorted = useMemo(() => sortByOz(positions), [positions]);
  const totals = useMemo(() => lvTotals(positions), [positions]);

  const onAdd = () => {
    const qty = parseLvNumber(qtyStr);
    const unitPrice = epStr.trim() === "" ? null : parseLvNumber(epStr);
    const draft = { oz: oz.trim(), title: title.trim(), qty: qty ?? NaN, unit, unitPrice };
    const error = validateDraft(draft, positions.length);
    setFormError(error);
    if (error) return;
    const id = addPosition(doc, yarr, { ...draft, qty: qty as number });
    if (!id) {
      setFormError(`Maximal ${LV_MAX_POSITIONS} Positionen — nichts wurde angelegt.`);
      return;
    }
    setOz("");
    setTitle("");
    setQtyStr("");
    setEpStr("");
  };

  const commitCell = (p: LvPosition, field: CellField, raw: string) => {
    if (field === "qty") {
      const num = parseLvNumber(raw);
      if (num === null) return; // saisie illisible : l'affichage revient à la valeur partagée
      setPositionCell(doc, yarr, p.id, "qty", num);
      return;
    }
    if (field === "unit_price") {
      if (raw.trim() === "") {
        setPositionCell(doc, yarr, p.id, "unit_price", null);
        return;
      }
      const num = parseLvNumber(raw);
      if (num === null) return;
      setPositionCell(doc, yarr, p.id, "unit_price", num);
      return;
    }
    setPositionCell(doc, yarr, p.id, field, field === "oz" ? raw.trim().slice(0, 32) : raw.trim().slice(0, 300));
  };

  // §90 — téléchargement X31 réel (blob) : sans prix = Ausschreibung
  // pour l'entreprise ; avec prix = refus serveur MOTIVÉ si « ohne EP ».
  const onGaeb = async (mitPreise: boolean) => {
    setGaebBusy(true);
    setGaebError(null);
    setGaebDone(null);
    try {
      const res = await secureFetch(lvGaebDownloadPath(NOTIZ_ROOM, mitPreise, ""));
      if (!res.ok) {
        let detail: string | null = null;
        try {
          const body = await res.json() as { detail?: unknown };
          detail = typeof body.detail === "string" ? body.detail : null;
        } catch { /* garde le statut */ }
        setGaebError(gaebErrorMessage(res.status, detail));
        return;
      }
      const filename =
        filenameFromDisposition(res.headers.get("Content-Disposition")) ??
        lvGaebFallbackFilename(NOTIZ_ROOM);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setGaebDone(
        mitPreise
          ? `${filename} heruntergeladen (mit EP — manuelle Eingabe, im Detailtext vermerkt).`
          : `${filename} heruntergeladen (ohne Preise — Ausschreibung für das Unternehmen).`,
      );
    } catch (err) {
      setGaebError(err instanceof Error ? err.message : "GAEB-Export fehlgeschlagen.");
    } finally {
      setGaebBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-700">
          Gemeinsame LV-Positionen
          <span className="ml-2 rounded-full bg-emerald-50 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-emerald-700">
            live · gleiche Verbindung wie Notiz
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] text-slate-400">
            {totals.count}/{LV_MAX_POSITIONS} Positionen
          </span>
          <button
            type="button"
            onClick={() => void onGaeb(false)}
            disabled={gaebBusy || positions.length === 0}
            title="GAEB X31 ohne Preise — Ausschreibung für das Unternehmen"
            className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
          >
            GAEB · ohne Preise
          </button>
          <button
            type="button"
            onClick={() => void onGaeb(true)}
            disabled={gaebBusy || positions.length === 0}
            title="GAEB X31 mit EP (manuelle Eingabe) — intern/Archiv; verweigert, solange EP fehlen"
            className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
          >
            GAEB · mit Preisen
          </button>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50"
          >
            {open ? "Formular schließen" : "+ Position"}
          </button>
        </div>
      </div>

      {open && (
        <div className="mb-2 rounded-lg border border-slate-200 bg-white p-2.5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-[110px_1fr_90px_80px_100px]">
            <input
              value={oz}
              onChange={(e) => setOz(e.target.value)}
              placeholder="OZ (01.003.010)"
              className="rounded-md border border-slate-200 px-2 py-1.5 text-xs focus:border-sky-400 focus:outline-none"
            />
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Kurztext (z. B. Stahlbeton C25/30)"
              className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 text-xs sm:col-span-1 focus:border-sky-400 focus:outline-none"
            />
            <input
              value={qtyStr}
              onChange={(e) => setQtyStr(e.target.value)}
              placeholder="Menge (12,5)"
              className="rounded-md border border-slate-200 px-2 py-1.5 text-xs focus:border-sky-400 focus:outline-none"
            />
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className="rounded-md border border-slate-200 bg-white px-1.5 py-1.5 text-xs focus:border-sky-400 focus:outline-none"
            >
              {LV_UNITS.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
            <input
              value={epStr}
              onChange={(e) => setEpStr(e.target.value)}
              placeholder="EP € — leer = ohne EP"
              className="rounded-md border border-slate-200 px-2 py-1.5 text-xs focus:border-sky-400 focus:outline-none"
            />
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-[10px] leading-snug text-slate-400">
              EP = manuelle Eingabe — kein automatischer Preisspiegel (Herkunft wird mitgespeichert).
            </p>
            <button
              type="button"
              onClick={onAdd}
              className="shrink-0 rounded-md bg-sky-600 px-3 py-1 text-[11px] font-semibold text-white transition hover:bg-sky-700"
            >
              Anlegen
            </button>
          </div>
          {formError && (
            <p className="mt-1.5 rounded-md bg-red-50 px-2 py-1 text-[11px] text-red-700">{formError}</p>
          )}
        </div>
      )}

      {gaebError && (
        <p className="mb-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">{gaebError}</p>
      )}
      {gaebDone && (
        <p className="mb-2 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-700">{gaebDone}</p>
      )}

      {positions.length === 0 ? (
        <p className="py-2 text-center text-[11px] text-slate-400">
          Noch keine LV-Positionen — erste Position über „+ Position“ anlegen;
          alle Kollegen sehen sie sofort (CRDT, kein Überschreiben).
        </p>
      ) : (
        <>
          <div className="scroll-thin max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 bg-slate-100 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-2 py-1.5">OZ</th>
                  <th className="px-2 py-1.5">Kurztext</th>
                  <th className="w-24 px-2 py-1.5 text-right">Menge</th>
                  <th className="w-16 px-2 py-1.5">Einh.</th>
                  <th className="w-28 px-2 py-1.5 text-right">EP €/Einh.</th>
                  <th className="w-28 px-2 py-1.5 text-right">GP €</th>
                  <th className="w-8 px-1 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => {
                  const gp = positionGp(p);
                  return (
                    <tr key={p.id} className="border-t border-slate-100 align-middle">
                      <td className="w-28 px-1 py-0.5">
                        <CellText
                          display={p.oz}
                          title="Positionsnummer (OZ)"
                          onCommit={(raw) => commitCell(p, "oz", raw)}
                          className="font-mono text-[11px]"
                        />
                      </td>
                      <td className="px-1 py-0.5">
                        <CellText
                          display={p.title}
                          title="Kurztext"
                          onCommit={(raw) => commitCell(p, "title", raw)}
                        />
                      </td>
                      <td className="px-1 py-0.5 text-right">
                        <CellText
                          display={formatQty(p.qty)}
                          title="Menge — z. B. 12,5"
                          onCommit={(raw) => commitCell(p, "qty", raw)}
                          className="text-right font-mono text-[11px]"
                        />
                      </td>
                      <td className="px-2 py-0.5 text-[11px] text-slate-600">{p.unit}</td>
                      <td className="px-1 py-0.5 text-right">
                        <CellText
                          display={p.unitPrice === null ? "" : formatEuro(p.unitPrice)}
                          title="Einzelpreis — manuelle Eingabe; leer = ohne EP"
                          onCommit={(raw) => commitCell(p, "unit_price", raw)}
                          className="text-right font-mono text-[11px] placeholder:text-slate-300"
                        />
                      </td>
                      <td className="px-2 py-0.5 text-right font-mono text-[11px] font-medium text-slate-800">
                        {gp === null ? (
                          <span className="rounded-full bg-amber-50 px-1.5 py-px text-[9px] font-semibold text-amber-700">
                            ohne EP
                          </span>
                        ) : (
                          formatEuro(gp)
                        )}
                      </td>
                      <td className="px-1 py-0.5 text-center">
                        <button
                          type="button"
                          onClick={() => deletePosition(doc, yarr, p.id)}
                          title="Position entfernen (gilt sofort für alle)"
                          className="rounded px-1 text-[11px] text-slate-300 transition hover:bg-red-50 hover:text-red-600"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
            <span>
              {totals.count} Positionen
              {totals.ohneEp > 0 && (
                <span className="ml-1 text-amber-700">
                  · {totals.ohneEp} ohne EP (nicht in der Summe)
                </span>
              )}
            </span>
            <span className="font-semibold text-slate-800">
              Summe (bepreiste Positionen): {formatEuro(totals.gpTotal)}
            </span>
          </div>
        </>
      )}

      {/* §91 — offres d'entreprises sur CE LV (REST, données base réelle) */}
      <SharedOffers room={NOTIZ_ROOM} />
    </div>
  );
}

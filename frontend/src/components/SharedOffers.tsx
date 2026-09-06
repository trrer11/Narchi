/**
 * §91 — « Angebote » : import et gestion des offres d'entreprises (GAEB
 * X83/X31 entrant) pour la Notiz/LV du bureau. Tout est RÉEL : upload
 * multipart vers le parseur §91 (refus motivés affichés en clair),
 * liste depuis la base, suppression effective. La comparaison (§92) se
 * greffe sur ces données — ici on voit déjà : entreprise, phase lue,
 * positions, « ohne EP » comptées, total EXACT en centimes.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { secureFetch } from "@/auth/SecuritySanitizer";
import {
  eurFromCents,
  offerErrorMessage,
  offerMetaOf,
  type OfferMeta,
} from "@/lib/offerClient";
import {
  cellClass,
  compareMatrixOf,
  deltaText,
  verdictText,
  type CompareMatrix,
} from "@/lib/offerCompareView";
import { offerX83FallbackFilename, offerX83Path } from "@/lib/offerX83";
import {
  libraryTakeoverOf,
  libraryTakeoverText,
  offerToLibraryPath,
} from "@/lib/offerLibrary";
import { filenameFromDisposition } from "@/lib/lvGaebExport";

export default function SharedOffers({ room }: { room: string }) {
  const [offers, setOffers] = useState<OfferMeta[] | null>(null);
  const [maxOffers, setMaxOffers] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [firma, setFirma] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // §92 — panneau Vergleich (matrice serveur, verdict honnête).
  const [compareOpen, setCompareOpen] = useState(false);
  const [matrix, setMatrix] = useState<CompareMatrix | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  // §93 — téléchargement X83 (un seul à la fois, offre occupée marquée).
  const [x83BusyId, setX83BusyId] = useState<string | null>(null);
  // §95 — offre → Preisbibliothek (pareil : une course à la fois).
  const [libBusyId, setLibBusyId] = useState<string | null>(null);

  const loadCompare = useCallback(async () => {
    setCompareError(null);
    try {
      const res = await secureFetch(
        `/api/v5/collab/${encodeURIComponent(room)}/offers/compare/matrix`,
      );
      if (!res.ok) {
        let detail: string | null = null;
        try {
          const body = await res.json() as { detail?: unknown };
          detail = typeof body.detail === "string" ? body.detail : null;
        } catch { /* garde le statut */ }
        setCompareError(offerErrorMessage(res.status, detail));
        setMatrix(null);
        return;
      }
      setMatrix(compareMatrixOf(await res.json()));
    } catch (err) {
      setCompareError(err instanceof Error ? err.message : "Vergleich fehlgeschlagen.");
      setMatrix(null);
    }
  }, [room]);

  const load = useCallback(async () => {
    try {
      const res = await secureFetch(`/api/v5/collab/${encodeURIComponent(room)}/offers`);
      if (!res.ok) {
        setError(offerErrorMessage(res.status, null));
        return;
      }
      const body = await res.json() as { offers?: unknown[]; max_offers?: unknown };
      setOffers(
        (Array.isArray(body.offers) ? body.offers : [])
          .map(offerMetaOf)
          .filter((o): o is OfferMeta => o !== null),
      );
      if (typeof body.max_offers === "number") setMaxOffers(body.max_offers);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Angebote konnten nicht geladen werden.");
    }
  }, [room]);

  useEffect(() => {
    void load();
  }, [load]);

  const onUpload = async () => {
    const file = fileRef.current?.files?.[0];
    setError(null);
    setDone(null);
    if (!firma.trim()) {
      setError("Firmenname fehlt — wem gehört dieses Angebot?");
      return;
    }
    if (!file) {
      setError("Keine Datei gewählt — .x31/.xml des Unternehmens wählen.");
      return;
    }
    const form = new FormData();
    form.append("file", file);
    form.append("firma", firma.trim());
    setBusy(true);
    try {
      const res = await secureFetch(`/api/v5/collab/${encodeURIComponent(room)}/offers`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        let detail: string | null = null;
        try {
          const body = await res.json() as { detail?: unknown };
          detail = typeof body.detail === "string" ? body.detail : null;
        } catch { /* garde le statut */ }
        setError(offerErrorMessage(res.status, detail));
        return;
      }
      const body = await res.json() as { offer?: unknown };
      const meta = offerMetaOf(body.offer);
      setDone(
        meta
          ? `Angebot «${meta.companyName}» geprüft und gespeichert: ${meta.itemCount} Positionen` +
            (meta.ohnePreisCount > 0 ? `, davon ${meta.ohnePreisCount} ohne EP` : "") +
            ` · Gesamt ${eurFromCents(meta.gpTotalCents)}.`
          : "Angebot gespeichert.",
      );
      setFirma("");
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  // §93 — X83 = l'Angebot FORMEL re-généré depuis les prix VÉRIFIÉS
  // à l'import (jamais depuis le XML d'origine du logiciel AVA). Le
  // message de fin dit honnêtement ce qu'est le fichier.
  const onX83 = async (offer: OfferMeta) => {
    setX83BusyId(offer.id);
    setError(null);
    setDone(null);
    try {
      const res = await secureFetch(offerX83Path(room, offer.id));
      if (!res.ok) {
        let detail: string | null = null;
        try {
          const body = await res.json() as { detail?: unknown };
          detail = typeof body.detail === "string" ? body.detail : null;
        } catch { /* garde le statut */ }
        setError(offerErrorMessage(res.status, detail));
        return;
      }
      const filename =
        filenameFromDisposition(res.headers.get("Content-Disposition")) ??
        offerX83FallbackFilename(offer.companyName);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      const ohne = res.headers.get("X-Narchi-Offer-Ohne-EP");
      setDone(
        `${filename} heruntergeladen — X83 (Angebot) aus den geprüften ` +
        `${offer.itemCount} Positionen${ohne && ohne !== "0" ? `, davon ${ohne} ohne EP` : ""}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "X83-Export fehlgeschlagen.");
    } finally {
      setX83BusyId(null);
    }
  };

  // §95 — les EP RÉELS de l'offre entrent dans la bibliothèque du
  // bureau (upsert idempotent §50, fortgeschrieben Destatis §49 déjà
  // en place côté moteur). Le message de fin énumère les 3 compteurs.
  const onLibrary = async (offer: OfferMeta) => {
    setLibBusyId(offer.id);
    setError(null);
    setDone(null);
    try {
      const res = await secureFetch(offerToLibraryPath(room, offer.id), {
        method: "POST",
      });
      if (!res.ok) {
        let detail: string | null = null;
        try {
          const body = await res.json() as { detail?: unknown };
          detail = typeof body.detail === "string" ? body.detail : null;
        } catch { /* garde le statut */ }
        setError(offerErrorMessage(res.status, detail));
        return;
      }
      const taken = libraryTakeoverOf(await res.json());
      setDone(
        taken
          ? libraryTakeoverText(taken)
          : "Übernommen — Details unter Preisbibliothek.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Übernahme fehlgeschlagen.");
    } finally {
      setLibBusyId(null);
    }
  };

  const onDelete = async (offer: OfferMeta) => {
    setError(null);
    setDone(null);
    try {
      const res = await secureFetch(
        `/api/v5/collab/${encodeURIComponent(room)}/offers/${encodeURIComponent(offer.id)}`,
        { method: "DELETE" },
      );
      if (!res.ok && res.status !== 204) {
        setError(offerErrorMessage(res.status, null));
        return;
      }
      setDone(`Angebot «${offer.companyName}» entfernt.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Löschen fehlgeschlagen.");
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-700">
          Angebote der Unternehmen (GAEB-Import)
          <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-slate-500">
            X83 / X31 bepreist
          </span>
        </p>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-400">
            {(offers ?? []).length}{maxOffers > 0 ? `/${maxOffers}` : ""} Angebote
          </span>
          {(offers ?? []).length >= 1 && (
            <button
              type="button"
              onClick={() => {
                const next = !compareOpen;
                setCompareOpen(next);
                if (next) void loadCompare();
              }}
              className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50"
            >
              {compareOpen ? "Vergleich schließen" : "Vergleichen"}
            </button>
          )}
        </div>
      </div>
      <p className="mb-2 text-[10px] leading-snug text-slate-400">
        Bepreiste GAEB-Datei des Unternehmens hochladen — geprüft, in Cent gespeichert,
        Original-XML aufbewahrt. Dateien ohne Preise werden abgelehnt (Ausschreibung ≠ Angebot).
      </p>

      <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input
          value={firma}
          onChange={(e) => setFirma(e.target.value)}
          placeholder="Firmenname (z. B. Bauer GmbH)"
          className="rounded-md border border-slate-200 px-2 py-1.5 text-xs focus:border-sky-400 focus:outline-none"
        />
        <input
          ref={fileRef}
          type="file"
          accept=".x31,.x83,.xml"
          className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-[11px] file:font-medium"
        />
        <button
          type="button"
          onClick={() => void onUpload()}
          disabled={busy}
          className="rounded-md bg-sky-600 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-sky-700 disabled:opacity-50"
        >
          {busy ? "Prüfe…" : "Hochladen"}
        </button>
      </div>

      {error && (
        <p className="mb-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">{error}</p>
      )}
      {done && (
        <p className="mb-2 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-700">{done}</p>
      )}

      {offers === null && !error ? (
        <p className="py-2 text-center text-[11px] text-slate-400">Angebote werden geladen…</p>
      ) : (offers ?? []).length === 0 ? (
        <p className="py-2 text-center text-[11px] text-slate-400">
          Noch kein Angebot — nach der Ausschreibung (GAEB · ohne Preise) die bepreisten
          Dateien der Unternehmen hier sammeln.
        </p>
      ) : (
        <ul className="space-y-1">
          {(offers ?? []).map((o) => (
            <li
              key={o.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-2.5 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="font-semibold text-slate-800">{o.companyName}</span>
                  <span className="rounded-full bg-slate-200/70 px-1.5 py-px text-[9px] font-bold uppercase text-slate-600">
                    X{o.dp}
                  </span>
                  {o.ohnePreisCount > 0 && (
                    <span className="rounded-full bg-amber-50 px-1.5 py-px text-[9px] font-semibold text-amber-700">
                      {o.ohnePreisCount} ohne EP
                    </span>
                  )}
                </p>
                <p className="truncate text-[10px] text-slate-400" title={o.filename}>
                  {o.itemCount} Positionen · {o.filename || "—"}
                  {o.createdAt
                    ? ` · ${new Date(o.createdAt).toLocaleString("de-DE", {
                        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                      })}`
                    : ""}
                  {o.createdByName ? ` · ${o.createdByName}` : ""}
                </p>
              </div>
              <span className="font-mono text-[11px] font-semibold text-slate-800">
                {eurFromCents(o.gpTotalCents)}
              </span>
              {/* §93 — X83 : le document formel de l'Angebot (phase 83),
                  miroir des prix vérifiés à l'import. */}
              <button
                type="button"
                onClick={() => void onX83(o)}
                disabled={x83BusyId === o.id}
                title="Angebot als GAEB X83 herunterladen (aus geprüften Daten)"
                className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600 transition hover:border-sky-300 hover:text-sky-700 disabled:opacity-50"
              >
                {x83BusyId === o.id ? "…" : "X83"}
              </button>
              {/* §95 — le prix RÉEL rejoint la bibliothèque du bureau :
                  c'est comme ça que se construit une base fiable, pas
                  avec des données volées. */}
              <button
                type="button"
                onClick={() => void onLibrary(o)}
                disabled={libBusyId === o.id}
                title="Echte EP dieses Angebots in die Preisbibliothek übernehmen"
                className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 transition hover:border-emerald-300 hover:text-emerald-700 disabled:opacity-50"
              >
                {libBusyId === o.id ? "…" : "→ Bibliothek"}
              </button>
              <button
                type="button"
                onClick={() => void onDelete(o)}
                title="Angebot entfernen"
                className="rounded px-1 text-[11px] text-slate-300 transition hover:bg-red-50 hover:text-red-600"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* §92 — Angebotsvergleich : matrice serveur, verdict parmi les
          offres COMPLÈTES uniquement, Teilsummen marquées. */}
      {compareOpen && (
        <div className="mt-3 border-t border-slate-100 pt-2">
          {compareError && (
            <p className="mb-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">{compareError}</p>
          )}
          {matrix === null && !compareError ? (
            <p className="py-2 text-center text-[11px] text-slate-400">Vergleich wird geladen…</p>
          ) : matrix !== null && (
            <>
              {verdictText(matrix.offers) && (
                <p className="mb-2 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-800">
                  {verdictText(matrix.offers)}
                </p>
              )}
              {matrix.offers.some((o) => !o.complete) && (
                <p className="mb-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[10px] text-amber-800">
                  Unvollständige Angebote sind markiert — ihre Summe ist eine Teilsumme,
                  nicht vergleichbar.
                </p>
              )}
              <div className="scroll-thin overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full border-collapse text-left">
                  <thead className="bg-slate-100 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-2 py-1.5">OZ</th>
                      <th className="px-2 py-1.5">Kurztext</th>
                      <th className="px-2 py-1.5 text-right">Intern</th>
                      {matrix.offers.map((o) => (
                        <th key={o.id} className="px-2 py-1.5 text-right">
                          {o.companyName}
                          {!o.complete && (
                            <span className="ml-1 rounded-full bg-amber-100 px-1 py-px text-[8px] font-bold text-amber-700">
                              Teilsumme
                            </span>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.rows.map((row) => (
                      <tr
                        key={row.oz}
                        className={`border-t border-slate-100 ${row.onlyInOffer ? "bg-amber-50/50" : ""}`}
                      >
                        <td className="px-2 py-1 font-mono text-[11px] text-slate-700">
                          {row.oz}
                          {row.onlyInOffer && (
                            <span className="ml-1 rounded-full bg-amber-100 px-1 py-px text-[8px] font-semibold text-amber-700">
                              nur im Angebot
                            </span>
                          )}
                        </td>
                        <td className="max-w-48 truncate px-2 py-1 text-[11px] text-slate-600" title={row.title}>
                          {row.title || "—"}
                        </td>
                        <td className="px-2 py-1 text-right font-mono text-[11px] text-slate-500">
                          {row.internalUpCents !== null ? eurFromCents(row.internalUpCents) : "—"}
                        </td>
                        {matrix.offers.map((o) => {
                          const kind = cellClass(row, o.id);
                          const cell = row.cells[o.id];
                          const delta = deltaText(cell?.deltaPct ?? null);
                          return (
                            <td
                              key={o.id}
                              className={`px-2 py-1 text-right font-mono text-[11px] ${
                                kind === "best"
                                  ? "bg-emerald-50 font-semibold text-emerald-800"
                                  : kind === "missing"
                                    ? "text-slate-300"
                                    : "text-slate-700"
                              }`}
                              title={kind === "best" ? "Bester EP dieser Zeile" : undefined}
                            >
                              {cell?.upCents != null ? (
                                <>
                                  {eurFromCents(cell.upCents)}
                                  {delta && (
                                    <span className={`ml-1 text-[9px] ${delta.startsWith("+") ? "text-red-600" : "text-emerald-700"}`}>
                                      {delta}
                                    </span>
                                  )}
                                </>
                              ) : (
                                "—"
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50">
                      <td colSpan={3} className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        Summe
                      </td>
                      {matrix.offers.map((o) => (
                        <td key={o.id} className="px-2 py-1.5 text-right font-mono text-[11px] font-bold text-slate-800">
                          {eurFromCents(o.totalCents)}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </div>
              {matrix.hinweis && (
                <p className="mt-1.5 text-[10px] text-slate-400">{matrix.hinweis}</p>
              )}
              {matrix.duplicateInternalOz > 0 && (
                <p className="mt-1 text-[10px] text-amber-700">
                  Hinweis: {matrix.duplicateInternalOz} doppelte OZ im internen LV — nur die
                  erste Position je OZ wird verglichen.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

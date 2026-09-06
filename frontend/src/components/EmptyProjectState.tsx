/**
 * EMPTY PROJECT STATE - NARCHI CORE (Axe 1 : fin des tableaux brises a "0")
 * --------------------------------------------------------------------------
 * Etat vide STANDARDISE pour toutes les vues dependantes d'une maquette.
 * Affiche au premier lancement (store Zustand vierge : aucun projet, aucun
 * element importe) a la place des KPI a zero qui faisaient passer le
 * produit pour casse. CTA unique : "Importer une maquette IFC" -> module
 * ModelImport via le routeur maison (hash), zero dependance externe.
 */
import { useApp } from "@/store/AppStore";
import { Icon } from "@/components/ui";

interface EmptyProjectStateProps {
  /** Titre contextuel de la vue (ex: "Aucune donnee de planification"). */
  title: string;
  /** Explication courte de ce que la vue affichera apres import. */
  subtitle: string;
}

export function EmptyProjectState({ title, subtitle }: EmptyProjectStateProps) {
  const { navigate } = useApp();

  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-16 text-center dark:border-slate-700 dark:bg-ink-900/40">
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-500/10 text-brand-500">
        <Icon name="cube" size={32} />
      </span>
      <h2 className="mt-5 font-display text-lg font-bold text-slate-800 dark:text-white">{title}</h2>
      <p className="mt-2 max-w-md text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
      <button
        onClick={() => navigate("/app/model-import")}
        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-bold text-ink-950 shadow-lg shadow-brand-500/20 transition hover:bg-brand-400"
      >
        <Icon name="arrowRight" size={16} />
        IFC-Modell importieren
      </button>
      <p className="mt-3 text-xs text-slate-400">
        Formate: IFC, IFCZIP, STEP, DXF · kein DWG/RVT · DIN 276 aus Mengen
      </p>
    </div>
  );
}

export default EmptyProjectState;

/**
 * WEBGPU ENGINE — NARCHI CORE V4 (Module de sécurité mémoire)
 * -----------------------------------------------------------
 * Registre centralisé des ressources GPU avec destruction explicite.
 *
 * Failles corrigées (audit destructif — Faille n°2) :
 *  - Fuite de VRAM : les `GPUBuffer` alloués lors des sessions de
 *    visualisation successives n'étaient jamais détruits explicitement.
 *    Le Garbage Collector JS ne libère PAS la mémoire GPU de manière
 *    déterministe → saturation VRAM après plusieurs chargements IFC,
 *    puis perte de contexte GPU ("Context Lost").
 *  - Les pipelines de rendu restaient référencés dans des caches
 *    statiques, empêchant toute libération.
 *
 * Contrat :
 *  - Toute allocation GPU DOIT passer par `trackBuffer()` / `trackPipeline()`.
 *  - `dispose()` appelle `.destroy()` sur chaque GPUBuffer et libère les
 *    références de chaque GPURenderPipeline (destroy() défensif si le
 *    navigateur l'expose), puis vide les registres.
 *  - Le moteur devient inutilisable après dispose() (fail-fast).
 */

// ============================================================================
// TYPES WEBGPU MINIMAUX
// (lib.dom.d.ts de TypeScript 5.9 n'embarque pas encore l'API WebGPU
//  complète ; on déclare ici le sous-ensemble structurel requis, sans
//  dépendance externe à @webgpu/types.)
// ============================================================================

declare global {
  interface GPUBuffer {
    destroy(): void;
    label?: string;
  }
  interface GPURenderPipeline {
    label?: string;
    /** Non normatif : certains runtimes exposent un destroy() explicite. */
    destroy?: () => void;
  }
  interface GPUTexture {
    destroy(): void;
    label?: string;
  }
  interface GPUDevice {
    destroy(): void;
    label?: string;
  }
}

export interface GPUResourceStats {
  buffers: number;
  pipelines: number;
  textures: number;
  estimatedVramBytes: number;
  disposed: boolean;
}

// ============================================================================
// MOTEUR
// ============================================================================

export class WebGPUEngine {
  private buffers = new Map<string, { buffer: GPUBuffer; byteLength: number }>();
  private pipelines = new Map<string, GPURenderPipeline>();
  private textures = new Map<string, GPUTexture>();
  private device: GPUDevice | null = null;
  private disposed = false;
  private resourceCounter = 0;

  /** Associe (optionnellement) le GPUDevice pour destruction en cascade. */
  public attachDevice(device: GPUDevice): void {
    this.assertAlive();
    this.device = device;
  }

  /**
   * Enregistre un GPUBuffer dans le registre de suivi VRAM.
   * @returns l'identifiant de suivi (utile pour une libération ciblée).
   */
  public trackBuffer(buffer: GPUBuffer, byteLength: number, label?: string): string {
    this.assertAlive();
    const id = label ?? `buffer-${++this.resourceCounter}`;
    // Un ré-enregistrement sous le même label détruit l'ancienne ressource
    // (évite les buffers orphelins lors des rechargements de modèle).
    const previous = this.buffers.get(id);
    if (previous) this.safeDestroyBuffer(previous.buffer);
    this.buffers.set(id, { buffer, byteLength });
    return id;
  }

  /** Enregistre un GPURenderPipeline dans le registre de suivi. */
  public trackPipeline(pipeline: GPURenderPipeline, label?: string): string {
    this.assertAlive();
    const id = label ?? `pipeline-${++this.resourceCounter}`;
    this.pipelines.set(id, pipeline);
    return id;
  }

  /**
   * Enregistre une GPUTexture. Contrairement aux pipelines, les textures
   * disposent bien d'un `.destroy()` normatif dans la spec WebGPU — leur
   * suivi explicite est donc essentiel (KTX2/PBR = plusieurs Mo chacune).
   */
  public trackTexture(texture: GPUTexture, label?: string): string {
    this.assertAlive();
    const id = label ?? `texture-${++this.resourceCounter}`;
    const previous = this.textures.get(id);
    if (previous) {
      try { previous.destroy(); } catch { /* déjà détruite */ }
    }
    this.textures.set(id, texture);
    return id;
  }

  /** Libération ciblée d'un buffer (ex. swap de LOD). */
  public releaseBuffer(id: string): void {
    const entry = this.buffers.get(id);
    if (!entry) return;
    this.safeDestroyBuffer(entry.buffer);
    this.buffers.delete(id);
  }

  /** Statistiques de suivi pour l'overlay de diagnostic. */
  public getStats(): GPUResourceStats {
    let estimatedVramBytes = 0;
    this.buffers.forEach((entry) => { estimatedVramBytes += entry.byteLength; });
    return {
      buffers: this.buffers.size,
      pipelines: this.pipelines.size,
      textures: this.textures.size,
      estimatedVramBytes,
      disposed: this.disposed,
    };
  }

  /**
   * NETTOYAGE EXPLICITE DE LA VRAM.
   * Appelle `.destroy()` sur TOUTES les instances de GPUBuffer et libère
   * toutes les instances de GPURenderPipeline stockées en mémoire.
   * Idempotent : un second appel est un no-op silencieux.
   */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    // 1. Destruction déterministe des buffers (libération VRAM immédiate).
    this.buffers.forEach((entry, id) => {
      this.safeDestroyBuffer(entry.buffer, id);
    });
    this.buffers.clear();

    // 2. Destruction des textures (destroy() normatif — KTX2/PBR lourdes).
    this.textures.forEach((texture, id) => {
      try {
        texture.destroy();
      } catch (err) {
        console.warn(`[WebGPUEngine] destroy() texture "${id}" a échoué :`, err);
      }
    });
    this.textures.clear();

    // 3. Libération des pipelines. La spec WebGPU ne définit pas de
    //    destroy() pour GPURenderPipeline : la suppression des références
    //    est le mécanisme normatif ; destroy() est appelé défensivement
    //    si le runtime l'expose.
    this.pipelines.forEach((pipeline, id) => {
      try {
        pipeline.destroy?.();
      } catch (err) {
        console.warn(`[WebGPUEngine] destroy() pipeline "${id}" a échoué :`, err);
      }
    });
    this.pipelines.clear();

    // 4. Destruction du device (invalide toute ressource résiduelle).
    if (this.device) {
      try {
        this.device.destroy();
      } catch (err) {
        console.warn("[WebGPUEngine] destroy() du GPUDevice a échoué :", err);
      }
      this.device = null;
    }
  }

  public isDisposed(): boolean {
    return this.disposed;
  }

  // --------------------------------------------------------------------
  private safeDestroyBuffer(buffer: GPUBuffer, id?: string): void {
    try {
      buffer.destroy();
    } catch (err) {
      console.warn(`[WebGPUEngine] destroy() buffer "${id ?? "?"}" a échoué :`, err);
    }
  }

  private assertAlive(): void {
    if (this.disposed) {
      throw new Error(
        "WebGPUEngine déjà libéré (dispose() appelé) — instanciez un nouveau moteur."
      );
    }
  }
}

// ============================================================================
// INSTANCE PARTAGÉE (une par session de visualisation 3D)
// ============================================================================

let sharedEngine: WebGPUEngine | null = null;

/** Récupère (ou crée) le moteur GPU de la session de visualisation courante. */
export function getSharedEngine(): WebGPUEngine {
  if (!sharedEngine || sharedEngine.isDisposed()) {
    sharedEngine = new WebGPUEngine();
  }
  return sharedEngine;
}

/**
 * Purge complète appelée au démontage du composant de vue 3D
 * (`RealIfcViewer.tsx`). Sans effet si aucun moteur n'est actif.
 */
export function disposeSharedEngine(): void {
  if (sharedEngine) {
    sharedEngine.dispose();
    sharedEngine = null;
  }
}

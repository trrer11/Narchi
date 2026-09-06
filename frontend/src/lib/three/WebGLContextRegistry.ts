/**
 * NARCHI V5 — WebGLContextRegistry
 * Registre global des contextes WebGL actifs.
 * Permet la détection et la destruction des contextes zombies lors des
 * rechargements HMR et des transitions de page.
 */

import * as THREE from "three";

class WebGLContextRegistry {
  private static instance: WebGLContextRegistry;
  private activeContexts = new Map<string, THREE.WebGLRenderer>();
  private contextCounter = 0;

  static getInstance(): WebGLContextRegistry {
    if (!WebGLContextRegistry.instance) {
      WebGLContextRegistry.instance = new WebGLContextRegistry();
    }
    return WebGLContextRegistry.instance;
  }

  register(renderer: THREE.WebGLRenderer): string {
    const id = `ctx_${++this.contextCounter}_${Date.now()}`;
    this.activeContexts.set(id, renderer);
    console.debug(
      `[ContextRegistry] Contexte enregistré : ${id} (total: ${this.activeContexts.size})`
    );

    if (this.activeContexts.size > 8) {
      console.warn(
        `[ContextRegistry] ATTENTION : ${this.activeContexts.size} contextes WebGL actifs — risque de perte de contexte`
      );
    }

    return id;
  }

  unregister(id: string): void {
    this.activeContexts.delete(id);
    console.debug(
      `[ContextRegistry] Contexte libéré : ${id} (restant: ${this.activeContexts.size})`
    );
  }

  /**
   * Invalide tous les contextes connus sauf celui spécifié.
   */
  purgeAllExcept(keepId?: string): void {
    for (const [id, renderer] of this.activeContexts.entries()) {
      if (id === keepId) continue;

      try {
        renderer.forceContextLoss();
        renderer.dispose();
        console.debug(`[ContextRegistry] Contexte zombie détruit : ${id}`);
      } catch (e) {
        console.warn(`[ContextRegistry] Erreur purge ${id}: ${e}`);
      }

      this.activeContexts.delete(id);
    }
  }

  getActiveCount(): number {
    return this.activeContexts.size;
  }
}

export const contextRegistry = WebGLContextRegistry.getInstance();

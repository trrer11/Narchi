/**
 * TEXTURE MANAGER - NARCHI CORE V2
 * High-performance PBR texture pipeline using Basis Universal (KTX2).
 * Optimized for GPU VRAM footprint and rendering stability.
 */

import * as THREE from "three";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";

/**
 * PBR Texture Set definition.
 * Each map is critical for the physical realism of the material.
 */
export interface PBRTextureSet {
  albedo?: string;    // Base color / Diffuse
  roughness?: string; // Surface roughness
  metalness?: string; // Metallic properties
  normal?: string;    // Surface detail / Normals
  ao?: string;        // Ambient Occlusion
}

/** Résultat du chargement : mêmes clés, mais instances THREE.Texture prêtes GPU. */
export type LoadedPBRTextures = Partial<Record<keyof PBRTextureSet, THREE.Texture>>;

export class TextureManager {
  private static instance: TextureManager;

  /**
   * CIRCUIT-BREAKER RESEAU (correctif A2-2 / chargement infini) :
   * - failedPaths : chaque chemin KTX2 en echec est marque ; plus AUCUNE
   *   requete reseau ne sera retentee pour lui (fallback immediat).
   * - transcoderState : sonde unique de /ifc/basis/basis_transcoder.js.
   *   S'il est absent, le pipeline KTX2 est desactive GLOBALEMENT :
   *   loadAsync ne sera jamais appele (il peut pendre indefiniment sans
   *   transcodeur => c'etait la cause du "Chargement..." eternel).
   */
  private static readonly failedPaths = new Set<string>();
  private static transcoderState: "unknown" | "available" | "missing" = "unknown";
  private static transcoderProbe: Promise<boolean> | null = null;

  /** Timeout dur par texture : au-dela, fallback (rien ne doit pendre). */
  private static readonly LOAD_TIMEOUT_MS = 4000;

  private ktx2Loader: KTX2Loader;
  private textureCache: Map<string, THREE.Texture> = new Map();
  private renderer: THREE.WebGLRenderer;

  private constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.ktx2Loader = new KTX2Loader();
    
    // Configure KTX2 Loader to use WASM transcoders.
    // The paths must point to the local copies of the basis transcoders.
    this.ktx2Loader.setTranscoderPath('/ifc/basis/'); 
    this.ktx2Loader.detectSupport(renderer);
  }

  public static getInstance(renderer: THREE.WebGLRenderer): TextureManager {
    if (!TextureManager.instance) {
      TextureManager.instance = new TextureManager(renderer);
    }
    return TextureManager.instance;
  }

  /**
   * Loads a complete PBR texture set and optimizes each map for GPU performance.
   * 
   * @param texturePaths - Set of paths to .ktx2 textures
   * @returns a promise resolving to the loaded textures
   */
  public async loadPBRSet(paths: PBRTextureSet): Promise<LoadedPBRTextures> {
    const loadedTextures: LoadedPBRTextures = {};

    // CIRCUIT-BREAKER GLOBAL : sans transcodeur Basis, aucun KTX2 ne peut
    // etre decode -- on court-circuite TOUT le pipeline en une verification.
    const transcoderReady = await this.probeTranscoder();

    const loadMap = async (key: keyof PBRTextureSet, path?: string) => {
      if (!path) return;

      // Check cache first to avoid redundant GPU uploads
      if (this.textureCache.has(path)) {
        loadedTextures[key] = this.textureCache.get(path)!;
        return;
      }

      // CIRCUIT-BREAKER PAR CLE : chemin deja en echec => fallback immediat,
      // zero requete reseau.
      if (!transcoderReady || TextureManager.failedPaths.has(path)) {
        // Cle laissee undefined => le materiau retombe sur la couleur IFC
        // native (RealIfcViewer fait `map: textures.albedo ?? null`).
        return;
      }

      // Pre-vol HEAD : evite de lancer le decodeur sur un 404 (loadAsync
      // peut rester suspendu sur une reponse HTML d'erreur SPA).
      try {
        const head = await fetch(path, { method: "HEAD" });
        if (!head.ok) {
          TextureManager.failedPaths.add(path);
          return;
        }
      } catch {
        TextureManager.failedPaths.add(path);
        return;
      }

      try {
        const texture = await this.withTimeout(
          this.ktx2Loader.loadAsync(path),
          TextureManager.LOAD_TIMEOUT_MS,
          path,
        );
        
        // --- GPU OPTIMIZATION STRATEGY ---
        
        // 1. Mipmapping: Prevents aliasing and shimmering on distant surfaces
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;

        // 2. Anisotropy: Sharpens textures viewed at grazing angles (crucial for floors/walls)
        const maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy();
        texture.anisotropy = maxAnisotropy;

        // 3. Wrap Settings: Ensure seamless tiling for architectural materials
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;

        this.textureCache.set(path, texture);
        loadedTextures[key] = texture;
      } catch (error) {
        console.warn(`[TextureManager] KTX2 indisponible (${path}) — fallback applique definitivement:`, error);
        // Enregistrement dans le circuit-breaker : plus jamais de requete
        // reseau pour ce chemin durant la session.
        TextureManager.failedPaths.add(path);
      }
    };

    // Execute all loads in parallel for maximum throughput
    await Promise.all([
      loadMap('albedo', paths.albedo),
      loadMap('roughness', paths.roughness),
      loadMap('metalness', paths.metalness),
      loadMap('normal', paths.normal),
      loadMap('ao', paths.ao),
    ]);

    return loadedTextures;
  }

  /** Sonde UNIQUE du transcodeur Basis (partagee entre tous les appels). */
  private probeTranscoder(): Promise<boolean> {
    if (TextureManager.transcoderState === "available") return Promise.resolve(true);
    if (TextureManager.transcoderState === "missing") return Promise.resolve(false);
    if (!TextureManager.transcoderProbe) {
      TextureManager.transcoderProbe = fetch("/ifc/basis/basis_transcoder.js", { method: "HEAD" })
        .then((res) => {
          TextureManager.transcoderState = res.ok ? "available" : "missing";
          if (!res.ok) {
            console.warn(
              "[TextureManager] Transcodeur Basis absent (/ifc/basis/) — pipeline KTX2 desactive, rendu en materiaux plats.",
            );
          }
          return res.ok;
        })
        .catch(() => {
          TextureManager.transcoderState = "missing";
          return false;
        });
    }
    return TextureManager.transcoderProbe;
  }

  /** Course promesse/timeout : AUCUN chargement ne peut pendre indefiniment. */
  private withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timeout texture (${ms} ms) : ${label}`)),
        ms,
      );
      promise.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (err) => { clearTimeout(timer); reject(err); },
      );
    });
  }

  /**
   * AGGRESSIVE PURGE: Fully releases GPU memory.
   * Must be called when a model is unloaded or a material is replaced.
   */
  public purgeTexture(path: string): void {
    const texture = this.textureCache.get(path);
    if (texture) {
      texture.dispose();
      this.textureCache.delete(path);
      console.log(`[TextureManager] GPU Memory released for: ${path}`);
    }
  }

  public purgeAll(): void {
    this.textureCache.forEach((texture) => texture.dispose());
    this.textureCache.clear();
    console.log("[TextureManager] All GPU textures purged.");
  }
}

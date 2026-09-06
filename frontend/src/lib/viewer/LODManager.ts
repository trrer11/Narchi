/**
 * LOD MANAGER - NARCHI CORE (FIX: Distance caméra→objet)
 * Dynamic Level of Detail and Visibility Orchestrator.
 * Optimized for large-scale BIM models to maintain 60FPS.
 * 
 * FIX: Calcule la distance caméra → bounding box de l'objet (pas caméra → origine)
 */

import * as THREE from "three";

export enum LODLevel {
  CRITICAL = 0, // Always visible (Slabs, Walls)
  PRIMARY = 1,   // Visible up to 50m (Doors, Windows, Columns)
  SECONDARY = 2, // Visible up to 20m (Furniture, Pipes, Small details)
  DECORATIVE = 3, // Visible up to 10m (Hardware, Accessories)
}

const LAYER_LOD_MAP: Record<string, LODLevel> = {
  walls: LODLevel.CRITICAL,
  slabs: LODLevel.CRITICAL,
  struct: LODLevel.PRIMARY,
  openings: LODLevel.PRIMARY,
  stairs: LODLevel.PRIMARY,
  spaces: LODLevel.SECONDARY,
  other: LODLevel.DECORATIVE,
};

// Distances de visibilité par niveau LOD (en mètres/unités monde)
const LOD_DISTANCES: Record<LODLevel, number> = {
  [LODLevel.CRITICAL]: Infinity,    // Toujours visible
  [LODLevel.PRIMARY]: 60,           // Visible si distance < 60m
  [LODLevel.SECONDARY]: 30,         // Visible si distance < 30m
  [LODLevel.DECORATIVE]: 15,        // Visible si distance < 15m
};

interface RegisteredObject {
  object: THREE.Object3D;
  layerId: string;
  level: LODLevel;
  bbox: THREE.Box3;
  center: THREE.Vector3;
}

export class LODManager {
  private camera: THREE.PerspectiveCamera;
  private registeredObjects: RegisteredObject[] = [];
  private sceneBBox: THREE.Box3 = new THREE.Box3();
  private sceneCenter: THREE.Vector3 = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  /**
   * Enregistre un objet pour la gestion LOD.
   * Calcule sa bounding box et son centre en coordonnées monde.
   */
  public registerObject(object: THREE.Object3D, layerId: string): void {
    const level = LAYER_LOD_MAP[layerId] ?? LODLevel.DECORATIVE;
    
    // Calculer la bounding box en coordonnées monde
    const bbox = new THREE.Box3().setFromObject(object);
    if (bbox.isEmpty()) {
      console.warn(`[LODManager] Objet sans géométrie valide pour layer ${layerId}`);
      return;
    }
    
    const center = bbox.getCenter(new THREE.Vector3());
    
    // Mettre à jour la bounding box globale de la scène
    this.sceneBBox.union(bbox);
    this.sceneCenter.add(center); // Sera moyenné plus tard
    
    this.registeredObjects.push({
      object,
      layerId,
      level,
      bbox,
      center,
    });
  }

  /**
   * Finalise l'enregistrement (à appeler après tous les registerObject).
   * Calcule le centre moyen de la scène pour les distances relatives.
   */
  public finalizeRegistration(): void {
    if (this.registeredObjects.length > 0) {
      this.sceneCenter.divideScalar(this.registeredObjects.length);
    }
  }

  /**
   * Met à jour la visibilité basée sur la distance caméra → objet.
   * Appelé chaque frame dans la boucle d'animation.
   * 
   * FIX: Utilise la distance caméra → centre de l'objet (pas caméra → origine)
   */
  public update(): void {
    const camPos = this.camera.position;

    for (const reg of this.registeredObjects) {
      // Distance caméra → centre de l'objet (coordonnées monde)
      const distance = camPos.distanceTo(reg.center);
      const maxDist = LOD_DISTANCES[reg.level];
      
      reg.object.visible = distance < maxDist;
    }
  }

  /**
   * Met à jour la visibilité basée sur la distance caméra → bounding box (plus précis).
   * Version alternative qui teste l'intersection du frustum avec la bbox.
   */
  public updateWithFrustumCulling(): void {
    const frustum = new THREE.Frustum();
    const projScreenMatrix = new THREE.Matrix4();
    projScreenMatrix.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreenMatrix);

    for (const reg of this.registeredObjects) {
      // Vérifier si la bbox intersecte le frustum
      const inFrustum = frustum.intersectsBox(reg.bbox);
      
      // Combiner avec la distance LOD
      const distance = this.camera.position.distanceTo(reg.center);
      const maxDist = LOD_DISTANCES[reg.level];
      const inRange = distance < maxDist;
      
      reg.object.visible = inFrustum && inRange;
    }
  }

  /**
   * Obtient les statistiques LOD actuelles pour debug/monitoring.
   */
  public getStats(): { level: LODLevel; visible: number; total: number; maxDistance: number }[] {
    const stats = new Map<LODLevel, { visible: number; total: number }>();
    
    for (const reg of this.registeredObjects) {
      const stat = stats.get(reg.level) || { visible: 0, total: 0 };
      stat.total++;
      if (reg.object.visible) stat.visible++;
      stats.set(reg.level, stat);
    }

    return Array.from(stats.entries()).map(([level, { visible, total }]) => ({
      level,
      visible,
      total,
      maxDistance: LOD_DISTANCES[level],
    }));
  }

  /**
   * Force la visibilité d'un niveau LOD spécifique (override manuel).
   */
  public setLevelVisibility(level: LODLevel, visible: boolean): void {
    for (const reg of this.registeredObjects) {
      if (reg.level === level) {
        reg.object.visible = visible;
      }
    }
  }

  /**
   * Réinitialise le gestionnaire (nouveau modèle chargé).
   */
  public reset(): void {
    this.registeredObjects = [];
    this.sceneBBox = new THREE.Box3();
    this.sceneCenter = new THREE.Vector3();
  }
}
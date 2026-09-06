/**
 * NARCHI V5 — CameraFrustumManager
 * Analyse la bounding box d'une scène et ajuste automatiquement les paramètres
 * de caméra (near, far, position) pour garantir la visibilité totale du modèle.
 */

import * as THREE from "three";

export interface BoundingBoxAnalysis {
  box: THREE.Box3;
  center: THREE.Vector3;
  size: THREE.Vector3;
  diagonalLength: number;
  dominantUnit: "mm" | "cm" | "m" | "ft" | "in";
  scaleFactor: number;
  suggestedCameraNear: number;
  suggestedCameraFar: number;
  suggestedCameraDistance: number;
}

export class CameraFrustumManager {
  private camera: THREE.PerspectiveCamera;
  private controls?: { target: THREE.Vector3; minDistance?: number; maxDistance?: number; update?: () => void };

  constructor(
    camera: THREE.PerspectiveCamera,
    controls?: { target: THREE.Vector3; minDistance?: number; maxDistance?: number; update?: () => void }
  ) {
    this.camera = camera;
    this.controls = controls;
  }

  /**
   * Analyse la scène et ajuste la caméra pour garantir la visibilité totale.
   */
  fitCameraToScene(scene: THREE.Object3D): BoundingBoxAnalysis {
    const box = new THREE.Box3().setFromObject(scene);

    if (box.isEmpty()) {
      console.warn("[CameraManager] Bounding box vide — scène sans géométrie");
      return this.getDefaultAnalysis();
    }

    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);

    const diagonalLength = Math.sqrt(
      size.x * size.x + size.y * size.y + size.z * size.z
    );

    const { dominantUnit, scaleFactor } = this.detectUnits(diagonalLength);
    const { near, far, distance } = this.computeOptimalFrustum(
      diagonalLength,
      scaleFactor
    );

    const analysis: BoundingBoxAnalysis = {
      box,
      center,
      size,
      diagonalLength,
      dominantUnit,
      scaleFactor,
      suggestedCameraNear: near,
      suggestedCameraFar: far,
      suggestedCameraDistance: distance,
    };

    this.applyAnalysis(analysis);

    console.info(
      `[CameraManager] Ajustement caméra:\n` +
        `  Unité: ${dominantUnit} (×${scaleFactor})\n` +
        `  Diagonale: ${diagonalLength.toFixed(2)} unités\n` +
        `  Near: ${near.toFixed(4)}, Far: ${far.toFixed(0)}\n` +
        `  Distance: ${distance.toFixed(2)}`
    );

    return analysis;
  }

  private detectUnits(
    diagonal: number
  ): { dominantUnit: "mm" | "cm" | "m" | "ft" | "in"; scaleFactor: number } {
    if (diagonal > 50000) {
      return { dominantUnit: "mm", scaleFactor: 0.001 };
    } else if (diagonal > 500) {
      return { dominantUnit: "cm", scaleFactor: 0.01 };
    } else if (diagonal < 0.5) {
      return { dominantUnit: "m", scaleFactor: 1 };
    } else {
      return { dominantUnit: "m", scaleFactor: 1 };
    }
  }

  private computeOptimalFrustum(
    diagonal: number,
    _scaleFactor: number
  ): { near: number; far: number; distance: number } {
    const distance = diagonal * 1.5;
    const near = Math.max(diagonal * 0.0001, 0.001);
    const far = distance * 4;

    const ratio = far / near;
    if (ratio > 1_000_000) {
      console.warn(
        `[CameraManager] Ratio near/far critique: ${ratio.toFixed(0)}:1 — risque de Z-fighting`
      );
    }

    return { near, far, distance };
  }

  private applyAnalysis(analysis: BoundingBoxAnalysis): void {
    const { center, suggestedCameraNear, suggestedCameraFar, suggestedCameraDistance } = analysis;

    this.camera.near = suggestedCameraNear;
    this.camera.far = suggestedCameraFar;
    this.camera.updateProjectionMatrix();

    const offsetDirection = new THREE.Vector3(1, 0.8, 1).normalize();
    this.camera.position.copy(
      center.clone().addScaledVector(offsetDirection, suggestedCameraDistance)
    );
    this.camera.lookAt(center);

    if (this.controls) {
      this.controls.target.copy(center);
      if (this.controls.minDistance !== undefined) {
        this.controls.minDistance = suggestedCameraNear * 10;
      }
      if (this.controls.maxDistance !== undefined) {
        this.controls.maxDistance = suggestedCameraFar * 0.8;
      }
      this.controls.update?.();
    }
  }

  private getDefaultAnalysis(): BoundingBoxAnalysis {
    return {
      box: new THREE.Box3(),
      center: new THREE.Vector3(),
      size: new THREE.Vector3(10, 10, 10),
      diagonalLength: 17.32,
      dominantUnit: "m",
      scaleFactor: 1,
      suggestedCameraNear: 0.01,
      suggestedCameraFar: 1000,
      suggestedCameraDistance: 26,
    };
  }
}

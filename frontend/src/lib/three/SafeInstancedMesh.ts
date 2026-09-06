/**
 * NARCHI V5 — SafeInstancedMesh
 * Crée un InstancedMesh correctement configuré pour le rendu IFC.
 * RÈGLES : jamais vertexColors sans attribut color initialisé ;
 *          MeshBasicMaterial pour l'aperçu rapide ;
 *          MeshStandardMaterial uniquement si vertexColors explicitement fournis.
 */

import * as THREE from "three";

export interface InstancedMeshConfig {
  count: number;
  color?: THREE.ColorRepresentation;
  opacity?: number;
  transparent?: boolean;
  wireframe?: boolean;
  depthTest?: boolean;
  renderOrder?: number;
}

export interface ElementPlacement {
  position: THREE.Vector3;
  rotation?: THREE.Euler;
  scale?: THREE.Vector3;
  color?: THREE.ColorRepresentation;
}

export function createSafeInstancedMesh(
  elements: ElementPlacement[],
  config: InstancedMeshConfig
): THREE.InstancedMesh {
  const count = Math.min(elements.length, config.count);

  const geometry = new THREE.BoxGeometry(1, 1, 1);

  const hasPerInstanceColors = elements.some((e) => e.color !== undefined);

  let material: THREE.Material;

  if (hasPerInstanceColors) {
    material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: config.transparent ?? false,
      opacity: config.opacity ?? 1.0,
      wireframe: config.wireframe ?? false,
      depthTest: config.depthTest ?? true,
    });
  } else {
    material = new THREE.MeshBasicMaterial({
      color: config.color ?? 0x4a90d9,
      transparent: config.transparent ?? false,
      opacity: config.opacity ?? 1.0,
      wireframe: config.wireframe ?? false,
      depthTest: config.depthTest ?? true,
    });
  }

  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.renderOrder = config.renderOrder ?? 0;
  mesh.frustumCulled = true;

  const matrix = new THREE.Matrix4();
  const defaultColor = new THREE.Color(config.color ?? 0x4a90d9);

  for (let i = 0; i < count; i++) {
    const el = elements[i];

    matrix.compose(
      el.position,
      el.rotation
        ? new THREE.Quaternion().setFromEuler(el.rotation)
        : new THREE.Quaternion(),
      el.scale ?? new THREE.Vector3(1, 1, 1)
    );

    mesh.setMatrixAt(i, matrix);

    if (hasPerInstanceColors) {
      mesh.setColorAt(i, el.color ? new THREE.Color(el.color) : defaultColor);
    }
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true;
  }

  return mesh;
}

/**
 * Upgrade vers MeshStandardMaterial avec PBR.
 * UNIQUEMENT après avoir vérifié les attributs de géométrie.
 */
export function upgradeToPBRMaterial(
  mesh: THREE.InstancedMesh,
  options: {
    metalness?: number;
    roughness?: number;
    envMapIntensity?: number;
  } = {}
): void {
  const oldMaterial = mesh.material as THREE.MeshBasicMaterial;

  const hasColorAttribute = mesh.geometry.hasAttribute("color");

  const pbrMaterial = new THREE.MeshStandardMaterial({
    color: (oldMaterial as THREE.MeshBasicMaterial).color ?? 0x4a90d9,
    vertexColors: hasColorAttribute,
    metalness: options.metalness ?? 0.1,
    roughness: options.roughness ?? 0.8,
    envMapIntensity: options.envMapIntensity ?? 1.0,
  });

  oldMaterial.dispose();
  mesh.material = pbrMaterial;
}

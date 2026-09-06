/**
 * PREDICTIVE AI SERVICE - NARCHI CORE V3
 * Advanced geometric reasoning engine with Transactional Simulation Canvas.
 * 
 * This service implements a "Simulate-then-Validate" pipeline to ensure that
 * proposed architectural corrections do not create new structural collisions.
 */

import * as THREE from "three";
import type { AuditIssue } from "./AuditEngine";
import type { BuildingElement } from "@/data/types";

// ============================================================================
// GEOMETRIC PRIMITIVES
// ============================================================================

export interface OBB {
  center: THREE.Vector3;
  axes: THREE.Vector3[]; // Local X, Y, Z unit vectors
  halfExtents: THREE.Vector3;
}

export interface IfcRelation {
  relationId: string;
  relationType: "CONNECTS" | "CONTAINED_IN" | "AGGREGATES";
  relatedElements: string[];
}

export interface SpatialData {
  obbs: Map<string, OBB>;
  relations: Map<string, IfcRelation[]>;
}

export type PatchType = "PROPERTY_UPDATE" | "TRANSLATION" | "ROTATION" | "REPLACEMENT";

export interface GeometricPatch {
  elementId: string;
  type: PatchType;
  payload: {
    property?: string;
    newValue?: unknown;
    vector?: THREE.Vector3;
    replacementId?: string;
  };
  confidence: number;
}

export interface AIFixSuggestion {
  issueId: string;
  explanation: string;
  patches: GeometricPatch[];
  impactAnalysis: {
    affectedElements: string[];
    riskLevel: "low" | "medium" | "high";
    description: string;
    safetyScore: number; // 0.0 to 1.0
  };
  confidenceScore: number;
}

// ============================================================================
// PREDICTIVE AI ENGINE
// ============================================================================

export class PredictiveAI {
  /**
   * Main entry point: Generates a fix and validates it via the Simulation Canvas.
   */
  public static generateFixSuggestion(
    issue: AuditIssue,
    projectElements: BuildingElement[],
    spatialData: SpatialData
  ): AIFixSuggestion | null {
    try {
      const targetElement = projectElements.find((el) => el.id === issue.elementId);
      if (!targetElement) return null;

      let suggestion: AIFixSuggestion | null = null;

      // 1. Generation Phase: Create a theoretical proposal
      switch (issue.ruleId) {
        case "DIN-18040-DOOR-WIDTH":
          suggestion = this.solvePmrDoorWidth(issue, targetElement, projectElements, spatialData);
          break;
        case "STRUCT-WALL-THICKNESS":
          suggestion = this.solveWallThickness(issue, targetElement, projectElements, spatialData);
          break;
        case "GEG-U-VALUE-WALL":
          suggestion = this.solveThermalPerformance(issue, targetElement, projectElements, spatialData);
          break;
        default:
          suggestion = this.generateGenericSuggestion(issue, targetElement);
      }

      if (!suggestion) return null;

      // 2. Simulation Phase: Validate the proposal against the environment
      return this.runSimulationCanvas(suggestion, projectElements, spatialData);
    } catch (error) {
      console.error(`[PredictiveAI] Simulation Pipeline Crash:`, error);
      return null;
    }
  }

  /**
   * SIMULATION CANVAS
   * Projects proposed patches into a virtual space to detect new collisions.
   */
  private static runSimulationCanvas(
    suggestion: AIFixSuggestion,
    projectElements: BuildingElement[],
    spatialData: SpatialData
  ): AIFixSuggestion {
    const collisions: string[] = [];
    let totalRisk = 0;

    for (const patch of suggestion.patches) {
      const originalObb = spatialData.obbs.get(patch.elementId);
      if (!originalObb) continue;

      // A. Project the new geometry (Virtual OBB)
      const simulatedObb = this.computeSimulatedOBB(originalObb, patch);

      // B. Collision Audit: Test the simulated OBB against all other OBBs
      spatialData.obbs.forEach((otherObb, otherId) => {
        if (otherId === patch.elementId) return;

        // We use a strict epsilon (0.01m) for the simulation to detect true intersections
        if (this.testOBBIntersection(simulatedObb, otherObb, 0.01)) {
          collisions.push(otherId);
          
          // Increase risk if the collision is with a critical structural element
          const otherEl = projectElements.find(el => el.id === otherId);
          if (otherEl?.type.toUpperCase().includes("COLUMN") || otherEl?.type.toUpperCase().includes("BEAM")) {
            totalRisk += 0.5;
          } else {
            totalRisk += 0.1;
          }
        }
      });
    }

    // C. Arbitration
    const safetyScore = Math.max(0, 1 - totalRisk);
    const riskLevel = collisions.length === 0 ? "low" : (totalRisk > 0.4 ? "high" : "medium");
    
    return {
      ...suggestion,
      impactAnalysis: {
        ...suggestion.impactAnalysis,
        affectedElements: [...new Set([...suggestion.impactAnalysis.affectedElements, ...collisions])],
        riskLevel,
        description: collisions.length > 0 
          ? `Alerte : La correction crée ${collisions.length} nouvelles interférences spatiales.` 
          : "Validation réussie : aucune collision détectée.",
        safetyScore,
      },
    };
  }

  /**
   * Computes a new OBB based on a patch without modifying the actual state.
   */
  private static computeSimulatedOBB(obb: OBB, patch: GeometricPatch): OBB {
    const newObb = {
      center: obb.center.clone(),
      axes: [...obb.axes],
      halfExtents: obb.halfExtents.clone(),
    };

    if (patch.type === "TRANSLATION" && patch.payload.vector) {
      newObb.center.add(patch.payload.vector);
    } else if (patch.type === "PROPERTY_UPDATE") {
      // Logic to adjust halfExtents based on width/thickness changes
      // Example: if property is 'width', we adjust the X axis of halfExtents
      const val = patch.payload.newValue;
      if (typeof val === 'number') {
        // Heuristic: we apply the delta to the most likely dimension
        // In a full version, this maps to the specific IFC axis
        newObb.halfExtents.x = val / 2; 
      }
    }
    
    return newObb;
  }

  // ============================================================================
  // SOLVERS (Proposals)
  // ============================================================================

  private static solvePmrDoorWidth(
    issue: AuditIssue,
    door: BuildingElement,
    allElements: BuildingElement[],
    spatialData: SpatialData
  ): AIFixSuggestion {
    const currentWidth = parseFloat(door.properties.find((p) => p.key.toLowerCase().includes("width"))?.value || "0");
    const targetWidth = 0.90;
    const delta = targetWidth - currentWidth;

    if (delta <= 0) return this.generateGenericSuggestion(issue, door);

    const adjacentWalls = allElements.filter((el) => {
      if (!el.type.toUpperCase().includes("WALL")) return false;
      return this.isSpatiallyAdjacent(door.id, el.id, spatialData, 0.05);
    });

    const patches: GeometricPatch[] = [
      { elementId: door.id, type: "PROPERTY_UPDATE", payload: { property: "width", newValue: targetWidth }, confidence: 1.0 },
    ];

    adjacentWalls.forEach((wall, idx) => {
      const direction = idx % 2 === 0 ? -1 : 1;
      patches.push({
        elementId: wall.id,
        type: "TRANSLATION",
        payload: { vector: new THREE.Vector3(delta * direction, 0, 0) },
        confidence: 0.8,
      });
    });

    return {
      issueId: issue.id,
      explanation: `Élargissement à ${targetWidth}m. Déplacement des cloisons adjacentes pour compensation.`,
      patches,
      impactAnalysis: {
        affectedElements: adjacentWalls.map((w) => w.id),
        riskLevel: "low",
        description: "Analyse préliminaire : aucune obstruction majeure détectée.",
        safetyScore: 1.0,
      },
      confidenceScore: 0.9,
    };
  }

  private static solveWallThickness(
    issue: AuditIssue,
    wall: BuildingElement,
    _allElements: BuildingElement[],
    _spatialData: SpatialData
  ): AIFixSuggestion {
    const targetThickness = 0.15;
    const patches: GeometricPatch[] = [
      { elementId: wall.id, type: "PROPERTY_UPDATE", payload: { property: "thickness", newValue: targetThickness }, confidence: 1.0 },
    ];

    return {
      issueId: issue.id,
      explanation: `Augmentation de l'épaisseur à ${targetThickness}m (Eurocode 2).`,
      patches,
      impactAnalysis: {
        affectedElements: [],
        riskLevel: "low",
        description: "Modification dimensionnelle interne.",
        safetyScore: 1.0,
      },
      confidenceScore: 0.98,
    };
  }

  private static solveThermalPerformance(
    issue: AuditIssue,
    wall: BuildingElement,
    _allElements: BuildingElement[],
    _spatialData: SpatialData
  ): AIFixSuggestion {
    const suggestedMaterialId = "mat-high-perf-insulation-V3"; 
    const patches: GeometricPatch[] = [
      { elementId: wall.id, type: "REPLACEMENT", payload: { replacementId: suggestedMaterialId }, confidence: 0.8 },
    ];

    return {
      issueId: issue.id,
      explanation: "Substitution par isolant haute performance pour conformité GEG.",
      patches,
      impactAnalysis: { affectedElements: [], riskLevel: "low", description: " Aucun impact géométrique.", safetyScore: 1.0 },
      confidenceScore: 0.85,
    };
  }

  private static generateGenericSuggestion(issue: AuditIssue, _el: BuildingElement): AIFixSuggestion {
    return {
      issueId: issue.id,
      explanation: "Complexité géométrique élevée. Analyse manuelle requise.",
      patches: [],
      impactAnalysis: { affectedElements: [], riskLevel: "medium", description: "Aucune correction sécurisée trouvée.", safetyScore: 0 },
      confidenceScore: 0.1,
    };
  }

  // ============================================================================
  // SPATIAL ANALYSIS ENGINE (SAT)
  // ============================================================================

  public static isSpatiallyAdjacent(idA: string, idB: string, spatialData: SpatialData, epsilon: number): boolean {
    const relationsA = spatialData.relations.get(idA) || [];
    const isConnected = relationsA.some(rel => rel.relationType === "CONNECTS" && rel.relatedElements.includes(idB));
    if (isConnected) return true;

    const obbA = spatialData.obbs.get(idA);
    const obbB = spatialData.obbs.get(idB);
    if (!obbA || !obbB) return false;

    return this.testOBBIntersection(obbA, obbB, epsilon);
  }

  private static testOBBIntersection(obbA: OBB, obbB: OBB, epsilon: number): boolean {
    const L = new THREE.Vector3();
    const axes: THREE.Vector3[] = [];
    
    axes.push(...obbA.axes);
    axes.push(...obbB.axes);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        L.crossVectors(obbA.axes[i], obbB.axes[j]);
        if (L.lengthSq() > 1e-6) {
          L.normalize();
          axes.push(L.clone());
        }
      }
    }

    for (const axis of axes) {
      if (this.isAxisSeparating(axis, obbA, obbB, epsilon)) return false;
    }
    return true;
  }

  private static isAxisSeparating(axis: THREE.Vector3, obbA: OBB, obbB: OBB, epsilon: number): boolean {
    const projectionA = this.getProjectionRadius(axis, obbA);
    const projectionB = this.getProjectionRadius(axis, obbB);
    const distance = Math.abs(obbB.center.clone().sub(obbA.center).dot(axis));
    return distance > (projectionA + projectionB + epsilon);
  }

  private static getProjectionRadius(axis: THREE.Vector3, obb: OBB): number {
    let radius = 0;
    for (let i = 0; i < 3; i++) {
      radius += obb.halfExtents.getComponent(i) * Math.abs(axis.dot(obb.axes[i]));
    }
    return radius;
  }
}

THREE.Vector3.prototype.getComponent = function(index: number): number {
  if (index === 0) return this.x;
  if (index === 1) return this.y;
  if (index === 2) return this.z;
  return 0;
};

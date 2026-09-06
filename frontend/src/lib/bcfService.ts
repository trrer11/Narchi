/**
 * BCF SERVICE - NARCHI CORE V2
 * High-performance BCF coordination service.
 * Delegates heavy parsing tasks to a Web Worker to keep the UI responsive.
 */

import * as THREE from "three";
import type { AuditIssue } from "./AuditEngine";

// ============================================================================
// TYPES (Mirrored from worker for consistency)
// ============================================================================

export interface BcfViewpoint {
  id: string;
  cameraPosition: { x: number; y: number; z: number };
  targetPosition: { x: number; y: number; z: number };
  selectedElements: string[];
}

export interface BcfComment {
  id: string;
  author: string;
  date: string;
  comment: string;
}

export interface BcfTopic {
  id: string;
  title: string;
  status: string;
  priority: string;
  comments: BcfComment[];
  viewpoints: BcfViewpoint[];
  snapshot?: string; // URL to blob
}

export class BcfService {
  
  /**
   * Imports a .bcfzip file using a background Web Worker.
   * 
   * @param file - The uploaded .bcfzip file
   * @returns A promise resolving to the parsed BcfTopics
   */
  public static async importBcfZip(file: File): Promise<BcfTopic[]> {
    return new Promise((resolve, reject) => {
      // 1. Instantiate the Worker
      // Using a module worker to allow imports inside the worker
      const worker = new Worker(
        new URL('../workers/bcfParser.worker.ts', import.meta.url), 
        { type: 'module' }
      );

      // 2. Read file as ArrayBuffer for efficient transfer
      const reader = new FileReader();
      reader.onload = async () => {
        const buffer = reader.result as ArrayBuffer;
        
        // Use Transferable objects to avoid copying large buffers
        worker.postMessage({ 
          fileBuffer: buffer, 
          fileName: file.name 
        }, [buffer]);
      };

      reader.onerror = () => {
        reject(new Error("Failed to read BCF file buffer."));
        worker.terminate();
      };

      reader.readAsArrayBuffer(file);

      // 3. Handle Worker Response
      worker.onmessage = (event) => {
        const { type, payload } = event.data;

        if (type === 'SUCCESS') {
          // Convert Blobs from worker to Object URLs for the UI
          const processedTopics = payload.map((topic: any) => ({
            ...topic,
            snapshot: topic.snapshotBlob ? URL.createObjectURL(topic.snapshotBlob) : undefined,
          }));
          
          resolve(processedTopics);
          worker.terminate(); // Clean up worker after success
        } else {
          reject(new Error(payload));
          worker.terminate();
        }
      };

      worker.onerror = (error) => {
        reject(new Error(`Worker Error: ${error.message}`));
        worker.terminate();
      };
    });
  }

  /**
   * Forces the 3D viewer to synchronize with a BCF viewpoint.
   */
  public static async applyBcfViewpoint(
    viewpoint: BcfViewpoint,
    camera: THREE.Camera,
    controls: any,
    onElementSelect: (guid: string) => void
  ): Promise<void> {
    // Convert plain object to THREE.Vector3
    const camPos = new THREE.Vector3(viewpoint.cameraPosition.x, viewpoint.cameraPosition.y, viewpoint.cameraPosition.z);
    const targetPos = new THREE.Vector3(viewpoint.targetPosition.x, viewpoint.targetPosition.y, viewpoint.targetPosition.z);

    camera.position.copy(camPos);
    
    if (controls) {
      controls.target.copy(targetPos);
      controls.update();
    } else {
      camera.lookAt(targetPos);
    }

    // Iterate through the selected GUIDs and notify the viewer to highlight them
    for (const guid of viewpoint.selectedElements) {
      onElementSelect(guid);
    }
  }

  /**
   * Exports a set of Audit Issues to a BCF-compliant JSON structure.
   */
  public static async exportIssuesToBcf(
    issues: AuditIssue[],
    camera: THREE.PerspectiveCamera,
    target: THREE.Vector3,
    user: { name: string }
  ): Promise<string> {
    const topics: any[] = issues.map((issue) => ({
      id: `topic_${issue.id}`,
      title: issue.description,
      status: "Open",
      priority: this.mapSeverityToBcfPriority(issue.severity),
      comments: [{
        id: `comm_${issue.id}`,
        author: user.name,
        date: new Date().toISOString(),
        comment: `Violation of ${issue.type}. Measured: ${issue.measuredValue}. Required: ${issue.requiredValue}.`,
      }],
      viewpoints: [{
        id: `view_${issue.elementId}`,
        cameraPosition: camera.position.clone(),
        targetPosition: target.clone(),
        selectedElements: [issue.elementId],
      }],
    }));

    return JSON.stringify({ bcfVersion: "2.1", topics }, null, 2);
  }

  private static mapSeverityToBcfPriority(severity: string): string {
    switch (severity) {
      case "critical": return "Critical";
      case "major": return "High";
      case "minor": return "Medium";
      default: return "Low";
    }
  }

  public static async downloadBcfFile(content: string, fileName: string = "narchi_audit.bcf") {
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}

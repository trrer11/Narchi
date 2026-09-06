/**
 * BCF PARSER WORKER - NARCHI CORE V2
 * High-Security off-main-thread processing for BCF ZIP archives.
 * 
 * Implements strict defense-in-depth against Zip Bombs and DoS attacks
 * by validating archive metadata before memory allocation.
 */

import JSZip from 'jszip';

// ============================================================================
// SECURITY CONSTANTS
// ============================================================================

const MAX_ALLOWED_UNCOMPRESSED_SIZE = 200 * 1024 * 1024; // 200 MB limit
const MAX_ALLOWED_FILE_COUNT = 5000;                     // Max number of files
const MAX_COMPRESSION_RATIO = 100;                       // Reject if uncompressed > 100x compressed

// ============================================================================
// TYPES
// ============================================================================

interface BcfViewpoint {
  id: string;
  cameraPosition: { x: number; y: number; z: number };
  targetPosition: { x: number; y: number; z: number };
  selectedElements: string[];
}

interface BcfComment {
  id: string;
  author: string;
  date: string;
  comment: string;
}

interface BcfTopic {
  id: string;
  title: string;
  status: string;
  priority: string;
  comments: BcfComment[];
  viewpoints: BcfViewpoint[];
  snapshotBlob?: Blob;
}

// ============================================================================
// SECURE XML PARSER (Worker compatible)
// ============================================================================

class BcfXmlParser {
  /**
   * Extracts the content of a specific XML tag using a non-recursive regex.
   */
  private static extractTag(xml: string, tag: string): string | null {
    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const match = xml.match(regex);
    return match ? match[1].trim() : null;
  }

  public static parseTopic(xml: string): Partial<BcfTopic> {
    return {
      title: this.extractTag(xml, 'title') || 'Untitled Topic',
      status: this.extractTag(xml, 'status') || 'Open',
      priority: this.extractTag(xml, 'priority') || 'Medium',
      comments: [],
    };
  }

  public static parseViewpoint(xml: string): BcfViewpoint | null {
    const posStr = this.extractTag(xml, 'position');
    const targetStr = this.extractTag(xml, 'target');
    const id = this.extractTag(xml, 'id') || `vp_${Date.now()}`;

    if (!posStr || !targetStr) return null;

    const parseVector = (str: string) => {
      const coords = str.split(/\s+/).map(p => parseFloat(p.split('=')[1]));
      return { x: coords[0], y: coords[1], z: coords[2] };
    };

    const guidRegex = /<guid>([^<]+)<\/guid>/gi;
    const selectedElements: string[] = [];
    let match;
    while ((match = guidRegex.exec(xml)) !== null) {
      selectedElements.push(match[1]);
    }

    return {
      id,
      cameraPosition: parseVector(posStr),
      targetPosition: parseVector(targetStr),
      selectedElements,
    };
  }
}

// ============================================================================
// WORKER MESSAGE HANDLER
// ============================================================================

self.onmessage = async (event: MessageEvent) => {
  const { fileBuffer } = event.data;

  try {
    const zip = new JSZip();
    const content = await zip.loadAsync(fileBuffer);

    // ---------------------------------------------------------------------------
    // SECURITY CHECK: Zip-Bomb Mitigation
    // ---------------------------------------------------------------------------
    let totalUncompressedSize = 0;
    let fileCount = 0;
    const compressedSize = fileBuffer.byteLength;

    // We iterate over the central directory metadata without decompressing
    const files = Object.values(content.files);
    for (const file of files) {
      // In JSZip, the uncompressed size is stored in the internal _data property
      const uncompressedSize = (file as any)._data?.uncompressedSize || 0;
      totalUncompressedSize += uncompressedSize;
      fileCount++;
    }

    // Threshold 1: Total Uncompressed Size
    if (totalUncompressedSize > MAX_ALLOWED_UNCOMPRESSED_SIZE) {
      throw new Error(`SECURITY_VIOLATION: Uncompressed size (${(totalUncompressedSize / 1024 / 1024).toFixed(2)} MB) exceeds limit of ${MAX_ALLOWED_UNCOMPRESSED_SIZE / 1024 / 1024} MB.`);
    }

    // Threshold 2: File Count
    if (fileCount > MAX_ALLOWED_FILE_COUNT) {
      throw new Error(`SECURITY_VIOLATION: File count (${fileCount}) exceeds limit of ${MAX_ALLOWED_FILE_COUNT}.`);
    }

    // Threshold 3: Compression Ratio (Suspiciously high ratio indicates a Zip Bomb)
    if (compressedSize > 0 && (totalUncompressedSize / compressedSize) > MAX_COMPRESSION_RATIO) {
      throw new Error(`SECURITY_VIOLATION: Compression ratio is suspiciously high. Archive rejected as potential Zip Bomb.`);
    }

    // ---------------------------------------------------------------------------
    // SECURE EXTRACTION
    // ---------------------------------------------------------------------------
    const topics: BcfTopic[] = [];
    const folders = Object.keys(content.files).filter(path => path.includes('/'));
    const uniqueFolders = Array.from(new Set(folders.map(path => path.split('/').slice(0, -1).join('/'))));

    for (const folderPath of uniqueFolders) {
      // 1. Topic Meta
      const bcfFile = content.file(`${folderPath}/topic.bcf`);
      if (!bcfFile) continue;
      const bcfText = await bcfFile.async("string");
      const topicMeta = BcfXmlParser.parseTopic(bcfText);

      // 2. Viewpoints
      const viewpoints: BcfViewpoint[] = [];
      const filesInFolder = Object.keys(content.files).filter(path => path.startsWith(folderPath));
      
      for (const filePath of filesInFolder) {
        if (filePath.endsWith('.bcfv')) {
          const fileObj = content.file(filePath);
          if (fileObj) {
            const bcfvText = await fileObj.async("string");
            const vp = BcfXmlParser.parseViewpoint(bcfvText);
            if (vp) viewpoints.push(vp);
          }
        }
      }

      // 3. Snapshot
      let snapshotBlob: Blob | undefined;
      const snapshotFile = content.file(`${folderPath}/snapshot.png`);
      if (snapshotFile) {
        snapshotBlob = await snapshotFile.async("blob");
      }

      topics.push({
        id: folderPath,
        ...topicMeta,
        viewpoints,
        snapshotBlob,
      } as BcfTopic);
    }

    self.postMessage({ type: 'SUCCESS', payload: topics });
  } catch (error: any) {
    self.postMessage({ 
      type: 'ERROR', 
      payload: error.message.startsWith('SECURITY_VIOLATION') 
        ? error.message 
        : `Parsing Error: ${error.message || 'Unknown error'}` 
    });
  }
};

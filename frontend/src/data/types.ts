// Narchi — native construction-data domain model.
// Self-contained, framework-agnostic type system for the platform.

export type ProjectStatus =
  | "planning"
  | "design"
  | "construction"
  | "handover"
  | "operating";

export type ElementStatus = "modeled" | "validated" | "approved" | "issued";

export interface Project {
  id: string;
  code: string;
  name: string;
  type: string;
  location: string;
  client: string;
  /** §220 — Anschrift Auftraggeber (optional, rien d'inventé). */
  clientStreet?: string;
  clientZip?: string;
  clientCity?: string;
  clientLeitweg?: string;
  status: ProjectStatus;
  progress: number;
  budget: number;
  spent: number;
  grossFloorArea: number;
  floors: number;
  startDate: string;
  endDate: string;
  team: string[];
  classificationCode: string;
  carbonBudgetKg: number;
  health: number;
  riskScore: number;
  accent: string;
  /** §118 — horodatage ISO de la dernière écriture locale : c'est lui qui
      voyage comme « updated_at » vers le miroir serveur (LWW, limite dite
      : horloge déréglée = tort de l'appareil, comme §115/§117). */
  updatedAt?: string;
}

export interface Material {
  id: string;
  name: string;
  category: string;
  unit: string;
  unitCost: number;
  massPerUnit: number;
  carbonKgPerKg: number;
  recycledContent: number;
  origin: string;
  fireRating: string;
  supplier: string;
  durabilityYears: number;
  description: string;
}

export interface ElementProperty {
  key: string;
  value: string;
}

export interface BuildingElement {
  id: string;
  guid: string;
  code: string;
  classificationLabel: string;
  name: string;
  type: string;
  materialId: string;
  level: string;
  projectId: string;
  status: ElementStatus;
  qty: number;
  unit: string;
  weightKg: number;
  cost: number;
  carbonKg: number;
  properties: ElementProperty[];
  lastUpdated: string;
  conflicts: number;
}

export interface ClassificationNode {
  code: string;
  label: string;
  group: string;
  level: number;
  description: string;
  children?: ClassificationNode[];
}

export type SourceStatus = "connected" | "syncing" | "idle" | "error";

export interface DataSource {
  id: string;
  name: string;
  kind: string;
  status: SourceStatus;
  lastSync: string;
  records: number;
  health: number;
  delta: number;
  latencyMs: number;
}

export interface ActivityItem {
  id: string;
  time: string;
  kind: "sync" | "create" | "validate" | "alert" | "export" | "carbon";
  message: string;
  user: string;
}

export interface ComplianceRule {
  id: string;
  name: string;
  domain: string;
  severity: "critical" | "major" | "minor";
  status: "pass" | "fail" | "warn";
  target: string;
  actual: string;
  affected: number;
  description: string;
  remediation: string;
}

export interface SyncLogEntry {
  id: number;
  ts: string;
  phase: string;
  level: "info" | "success" | "warn" | "error";
  message: string;
}

export interface SyncState {
  running: boolean;
  progress: number;
  phase: string;
  log: SyncLogEntry[];
  records: number;
  conflicts: number;
  resolved: number;
  lastRun: string | null;
}

export interface AppSettings {
  densityUnit: "metric" | "imperial";
  currency: "EUR" | "USD" | "GBP";
  carbonDisplay: boolean;
  autoSync: boolean;
  notifications: boolean;
  reduceMotion: boolean;
}

/* ===================== Digital twin ===================== */
export interface LevelInfo {
  index: number;
  name: string;
  elevation: number;
  height: number;
  grossArea: number;
  elementCount: number;
  carbonKg: number;
  cost: number;
  completion: number;
  type: "basement" | "typical" | "ground" | "mechanical" | "roof";
}

/* ===================== 4D Schedule ===================== */
export type TaskStatus = "completed" | "in-progress" | "upcoming" | "delayed";
export interface ScheduleTask {
  id: string;
  name: string;
  phase: string;
  classificationCode: string;
  level: string;
  startDay: number;
  duration: number;
  progress: number;
  status: TaskStatus;
  responsible: string;
  dependents: string[];
}

export interface Milestone {
  id: string;
  name: string;
  day: number;
  reached: boolean;
}

/* ===================== Issues / Snags ===================== */
export type IssueSeverity = "critical" | "major" | "minor";
export type IssueStatus = "open" | "in-review" | "resolved";
export interface Issue {
  id: string;
  title: string;
  level: string;
  classificationCode: string;
  severity: IssueSeverity;
  status: IssueStatus;
  assignee: string;
  raisedDay: number;
  description: string;
  projectId: string;
  /** §102 — photos du Mangel : BLOBS dans IndexedDB (`mangelPhotos.ts`),
      ici uniquement les CLÉS (le store persisté reste petit). */
  photoIds?: string[];
  /** §110 — sous-ensemble de `photoIds` pointant des VIDÉOS (blob.type
      « video/… ») : connu à la création, sans re-chargement des blobs —
      les compteurs peuvent dire « 1 Foto + 1 Video » sans improviser. */
  videoIds?: string[];
  /** §107 — vraie date de visite (jour ISO « 2026-08-01 ») = jour de la
      plus ancienne photo jointe ; absente sur les anciens Mängel. */
  visitDate?: string;
  /** §117 — horodatage ISO de la DERNIÈRE écriture locale (pose par les
      actions du store). C'est lui qui voyage comme « updated_at » vers le
      serveur : dernier-écrivain-gagne, simple et prévisible. Absent sur
      les données d'avant §117 → le moteur pose la date de première
      synchro (dit, jamais inventé dans le passé). */
  updatedAt?: string;
}

/* ===================== Risks ===================== */
export type RiskCategory = "cost" | "schedule" | "quality" | "safety" | "carbon";
export interface RiskItem {
  id: string;
  title: string;
  category: RiskCategory;
  likelihood: number;
  impact: number;
  mitigation: string;
  owner: string;
}

/* ===================== Notifications ===================== */
export interface NotificationItem {
  id: string;
  kind: "sync" | "alert" | "carbon" | "compliance" | "mention";
  title: string;
  detail: string;
  time: string;
  read: boolean;
}

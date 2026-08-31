export type RiskLevel = "safe" | "low" | "moderate" | "high" | "critical";

export type StatementKind =
  | "read"
  | "insert"
  | "update"
  | "delete"
  | "create"
  | "alter"
  | "drop"
  | "pragma"
  | "transaction"
  | "unknown";

export interface PlannedStatement {
  sql: string;
  kind: StatementKind;
  /** Human explanation of what this statement does. */
  rationale: string;
  /** Tables the statement reads from or writes to. */
  tables: string[];
  destructive: boolean;
}

export interface AgentPlan {
  summary: string;
  intent: string;
  statements: PlannedStatement[];
  /** Verification queries run after execution. */
  verifications: { description: string; sql: string }[];
  requiresConfirmation: boolean;
  risk: RiskLevel;
  notes: string[];
}

export interface ColumnInfo {
  name: string;
  type: string;
  notNull: boolean;
  primaryKey: boolean;
  defaultValue: string | null;
}

export interface TableInfo {
  name: string;
  type: "table" | "view";
  columns: ColumnInfo[];
  rowCount: number;
  indexes: { name: string; unique: boolean; columns: string[] }[];
  foreignKeys: { column: string; refTable: string; refColumn: string }[];
  createSql: string;
}

export interface SchemaSnapshot {
  capturedAt: string;
  tables: TableInfo[];
}

export interface SchemaDiff {
  addedTables: string[];
  removedTables: string[];
  changedTables: {
    name: string;
    addedColumns: string[];
    removedColumns: string[];
    rowCountBefore: number;
    rowCountAfter: number;
  }[];
}

export type PipelineStage =
  | "understand"
  | "inspect"
  | "plan"
  | "safety"
  | "preview"
  | "confirm"
  | "execute"
  | "verify"
  | "complete"
  | "error";

export interface StageEvent {
  type: "stage";
  stage: PipelineStage;
  status: "start" | "progress" | "done" | "blocked" | "error";
  title: string;
  detail?: string;
  data?: unknown;
  at: string;
}

export interface TokenEvent {
  type: "token";
  text: string;
}

/** A statement drafted by the planner, streamed as it becomes available. */
export interface SqlDraftEvent {
  type: "sql";
  index: number;
  text: string;
}

export interface DoneEvent {
  type: "done";
  operationId: string | null;
  awaitingConfirmation: boolean;
  plan: AgentPlan | null;
  preview?: PreviewResult | null;
  result?: ExecutionResult;
}

export interface ErrorEvent {
  type: "error";
  message: string;
  hint?: string;
}

export type AgentEvent = StageEvent | TokenEvent | SqlDraftEvent | DoneEvent | ErrorEvent;

export interface RowDelta {
  table: string;
  before: number;
  after: number;
}

export interface SampleChange {
  table: string;
  op: "insert" | "delete" | "update";
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

/** Result of executing a plan against a throwaway clone of the database. */
export interface PreviewResult {
  /** "sandbox" = really executed on a clone; "static" = analysis only (clone skipped). */
  mode: "sandbox" | "static";
  ok: boolean;
  durationMs: number;
  cloneBytes: number;
  statements: StatementResult[];
  schemaDiff: SchemaDiff;
  verifications: VerificationResult[];
  rowDeltas: RowDelta[];
  sampleChanges: SampleChange[];
  /** Plan contains RANDOM()/CURRENT_TIMESTAMP etc. — applied values may differ. */
  nonDeterministic: boolean;
  affectedTables: string[];
  error?: string;
  skippedReason?: string;
}

export interface StatementResult {
  sql: string;
  kind: StatementKind;
  rowsAffected: number;
  rows?: Record<string, unknown>[];
  columns?: string[];
  durationMs: number;
  error?: string;
}

export interface VerificationResult {
  description: string;
  sql: string;
  passed: boolean;
  rows: Record<string, unknown>[];
}

export interface ExecutionResult {
  operationId: string;
  ok: boolean;
  durationMs: number;
  statements: StatementResult[];
  verifications: VerificationResult[];
  schemaDiff: SchemaDiff;
  snapshotId: string | null;
  error?: string;
}

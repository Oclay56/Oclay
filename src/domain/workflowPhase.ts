export type WorkflowPhase =
  | "DISCOVERED"
  | "ANALYZING"
  | "ELIGIBLE"
  | "BLOCKED"
  | "REJECTED"
  | "ENTERING"
  | "SCALING"
  | "MONITORING"
  | "EXITING"
  | "CLOSED";

const WORKFLOW_PHASES = new Set<WorkflowPhase>([
  "DISCOVERED",
  "ANALYZING",
  "ELIGIBLE",
  "BLOCKED",
  "REJECTED",
  "ENTERING",
  "SCALING",
  "MONITORING",
  "EXITING",
  "CLOSED"
]);

export function isWorkflowPhase(value: unknown): value is WorkflowPhase {
  return typeof value === "string" && WORKFLOW_PHASES.has(value as WorkflowPhase);
}

export function normalizeWorkflowPhase(value: unknown): WorkflowPhase | undefined {
  return isWorkflowPhase(value) ? value : undefined;
}

export function deriveWorkflowPhaseFromPosition(params: {
  status?: string | null;
  stage?: string | null;
}): WorkflowPhase {
  const status = String(params.status ?? "").toUpperCase();
  const stage = String(params.stage ?? "").toUpperCase();

  if (status === "CLOSED") return "CLOSED";
  if (status === "EXITING") return "EXITING";
  if (status === "ENTERING") return "ENTERING";
  if (status === "OPEN" && stage === "TEST") return "SCALING";
  if (status === "OPEN") return "MONITORING";
  return "DISCOVERED";
}

export function inferWorkflowPhaseFromLifecycle(params: {
  stage: string;
  meta?: unknown;
}): WorkflowPhase | undefined {
  const meta = asRecord(params.meta);
  const explicit = normalizeWorkflowPhase(meta.workflowPhase);
  if (explicit) return explicit;

  switch (String(params.stage).toUpperCase()) {
    case "DETECTED":
      return "DISCOVERED";
    case "ANALYZE_A_DONE":
    case "ANALYZE_B_DONE":
      return "ANALYZING";
    case "ANALYZE_SKIPPED":
      return "BLOCKED";
    case "ENTRY_REJECTED":
      return "REJECTED";
    case "ENTRY_BLOCKED":
    case "ENTRY_DISABLED":
    case "CANDIDATE_SUPPRESSED":
      return "BLOCKED";
    case "SCALE_READY":
    case "SCALE_REJECTED":
    case "SCALE_BLOCKED":
      return "SCALING";
    case "INTENT_CREATED":
    case "SENT":
      return isEntryIntentMeta(meta) ? "ENTERING" : "EXITING";
    case "CONFIRMED":
      if (typeof meta.positionStatus === "string" || typeof meta.positionStage === "string") {
        return deriveWorkflowPhaseFromPosition({
          status: typeof meta.positionStatus === "string" ? meta.positionStatus : undefined,
          stage: typeof meta.positionStage === "string" ? meta.positionStage : undefined
        });
      }
      return isEntryIntentMeta(meta) ? "ENTERING" : "EXITING";
    case "CLOSED":
      return "CLOSED";
    default:
      return undefined;
  }
}

export function withWorkflowPhaseMeta(params: {
  stage: string;
  meta?: unknown;
  workflowPhase?: WorkflowPhase;
}): Record<string, unknown> | undefined {
  const base = asRecord(params.meta);
  const workflowPhase = params.workflowPhase ?? inferWorkflowPhaseFromLifecycle({ stage: params.stage, meta: base });
  if (!workflowPhase && Object.keys(base).length === 0) return undefined;
  return workflowPhase ? { ...base, workflowPhase } : base;
}

function isEntryIntentMeta(meta: Record<string, unknown>): boolean {
  const type = String(meta.type ?? "").toUpperCase();
  const intentKind = String(meta.intentKind ?? "").toUpperCase();
  if (type === "BUY") return true;
  return intentKind === "ENTRY_TEST" || intentKind === "ENTRY_SCALE";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

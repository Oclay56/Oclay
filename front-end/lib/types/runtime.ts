import { RuntimeDashboardStatePatch } from "./dashboard";

export interface RuntimeStatusSnapshot {
  workflowMode: "observe" | "paper" | "live";
  dashboardMode: "paper" | "live";
  botRunning: boolean;
  botStartedAtMs?: number;
  botStoppedAtMs?: number;
  lastRuntimePatchAtMs?: number;
  lastBotError?: string;
  subscriberCount: number;
}

export type RuntimeEvent =
  | {
      type: "patch";
      atMs: number;
      data: RuntimeDashboardStatePatch;
    }
  | {
      type: "ready" | "status" | "heartbeat";
      atMs: number;
      data?: RuntimeStatusSnapshot;
    };

export interface SSEConnectionState {
  connected: boolean;
  connecting: boolean;
  error: Error | null;
  lastEventAt: number | null;
}

export interface RuntimeMergeResult {
  snapshot: import("./dashboard").DashboardSnapshot;
  hasChanges: boolean;
  changedFields: string[];
}

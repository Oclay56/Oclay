import { AlertSeverity, DecisionKind, ExecutionSide, Mode, PositionStatus, RouterPath, WorkflowPhase } from "../types";

// Get badge styles for alert severity
export function getSeverityBadge(severity: AlertSeverity): {
  bg: string;
  text: string;
  label: string;
} {
  switch (severity) {
    case "CRITICAL":
      return {
        bg: "bg-[#F24E4E]/15",
        text: "text-[#F24E4E]",
        label: "CRITICAL",
      };
    case "WARN":
      return {
        bg: "bg-[#F6B046]/15",
        text: "text-[#F6B046]",
        label: "WARN",
      };
    default:
      return {
        bg: "bg-[#8B93A7]/15",
        text: "text-[#8B93A7]",
        label: severity,
      };
  }
}

// Get badge styles for execution side
export function getSideBadge(side: ExecutionSide): {
  bg: string;
  text: string;
  label: string;
} {
  switch (side) {
    case "BUY":
      return {
        bg: "bg-[#27C587]/15",
        text: "text-[#27C587]",
        label: "BUY",
      };
    case "SELL":
      return {
        bg: "bg-[#F24E4E]/15",
        text: "text-[#F24E4E]",
        label: "SELL",
      };
    default:
      return {
        bg: "bg-[#8B93A7]/15",
        text: "text-[#8B93A7]",
        label: side,
      };
  }
}

// Get badge styles for position status
export function getPositionStatusBadge(status: PositionStatus | string): {
  bg: string;
  text: string;
  label: string;
} {
  switch (status) {
    case "OPEN":
      return {
        bg: "bg-[#27C587]/15",
        text: "text-[#27C587]",
        label: "OPEN",
      };
    case "EXITING":
      return {
        bg: "bg-[#F6B046]/15",
        text: "text-[#F6B046]",
        label: "EXITING",
      };
    case "CLOSED":
      return {
        bg: "bg-[#8B93A7]/15",
        text: "text-[#8B93A7]",
        label: "CLOSED",
      };
    default:
      return {
        bg: "bg-[#8B93A7]/15",
        text: "text-[#8B93A7]",
        label: String(status),
      };
  }
}

// Get badge styles for mode
export function getModeBadge(mode: Mode): {
  bg: string;
  text: string;
  label: string;
} {
  switch (mode) {
    case "live":
      return {
        bg: "bg-[#F24E4E]/15",
        text: "text-[#F24E4E]",
        label: "LIVE",
      };
    case "paper":
      return {
        bg: "bg-[#2EC3E5]/15",
        text: "text-[#2EC3E5]",
        label: "PAPER",
      };
    default:
      return {
        bg: "bg-[#8B93A7]/15",
        text: "text-[#8B93A7]",
        label: mode,
      };
  }
}

// Get badge styles for router path
export function getRouterBadge(routerPath: RouterPath | string | undefined): {
  bg: string;
  text: string;
  label: string;
} {
  switch (routerPath) {
    case "raydium_direct":
      return {
        bg: "bg-[#27C587]/15",
        text: "text-[#27C587]",
        label: "Raydium",
      };
    case "jupiter_fallback":
      return {
        bg: "bg-[#F6B046]/15",
        text: "text-[#F6B046]",
        label: "Jup Fallback",
      };
    case "jupiter_only":
      return {
        bg: "bg-[#2EC3E5]/15",
        text: "text-[#2EC3E5]",
        label: "Jup Only",
      };
    case "jupiter_sell":
      return {
        bg: "bg-[#2EC3E5]/15",
        text: "text-[#2EC3E5]",
        label: "Jup Sell",
      };
    case "paper":
      return {
        bg: "bg-[#8B93A7]/15",
        text: "text-[#8B93A7]",
        label: "Paper",
      };
    default:
      return {
        bg: "bg-[#8B93A7]/15",
        text: "text-[#8B93A7]",
        label: routerPath || "Unknown",
      };
  }
}

// Get badge styles for execution result
export function getExecutionResultBadge(ok: boolean, err?: string): {
  bg: string;
  text: string;
  label: string;
} {
  if (ok) {
    return {
      bg: "bg-[#27C587]/15",
      text: "text-[#27C587]",
      label: "OK",
    };
  }

  if (err?.includes("429")) {
    return {
      bg: "bg-[#F6B046]/15",
      text: "text-[#F6B046]",
      label: "429",
    };
  }

  return {
    bg: "bg-[#F24E4E]/15",
    text: "text-[#F24E4E]",
    label: "FAIL",
  };
}

export function getWorkflowPhaseBadge(phase: WorkflowPhase | string | undefined): {
  bg: string;
  text: string;
  label: string;
} {
  switch (phase) {
    case "DISCOVERED":
      return { bg: "bg-[#2EC3E5]/15", text: "text-[#2EC3E5]", label: "Discovered" };
    case "ANALYZING":
      return { bg: "bg-[#5D8BFF]/15", text: "text-[#5D8BFF]", label: "Analyzing" };
    case "ELIGIBLE":
      return { bg: "bg-[#27C587]/15", text: "text-[#27C587]", label: "Eligible" };
    case "BLOCKED":
      return { bg: "bg-[#F24E4E]/15", text: "text-[#F24E4E]", label: "Blocked" };
    case "REJECTED":
      return { bg: "bg-[#F6B046]/15", text: "text-[#F6B046]", label: "Rejected" };
    case "ENTERING":
      return { bg: "bg-[#53B7FF]/15", text: "text-[#53B7FF]", label: "Entering" };
    case "SCALING":
      return { bg: "bg-[#B68CFF]/15", text: "text-[#B68CFF]", label: "Scaling" };
    case "MONITORING":
      return { bg: "bg-[#27C587]/15", text: "text-[#27C587]", label: "Monitoring" };
    case "EXITING":
      return { bg: "bg-[#F6B046]/15", text: "text-[#F6B046]", label: "Exiting" };
    case "CLOSED":
      return { bg: "bg-[#8B93A7]/15", text: "text-[#8B93A7]", label: "Closed" };
    default:
      return { bg: "bg-[#8B93A7]/15", text: "text-[#8B93A7]", label: phase || "Unknown" };
  }
}

export function getDecisionKindBadge(kind: DecisionKind): {
  bg: string;
  text: string;
  label: string;
} {
  switch (kind) {
    case "ADMITTED":
      return { bg: "bg-[#27C587]/15", text: "text-[#27C587]", label: "Admitted" };
    case "REJECTED":
      return { bg: "bg-[#F6B046]/15", text: "text-[#F6B046]", label: "Rejected" };
    case "BLOCKED":
      return { bg: "bg-[#F24E4E]/15", text: "text-[#F24E4E]", label: "Blocked" };
    case "SKIPPED":
      return { bg: "bg-[#8B93A7]/15", text: "text-[#8B93A7]", label: "Skipped" };
    case "EXIT":
      return { bg: "bg-[#53B7FF]/15", text: "text-[#53B7FF]", label: "Exit" };
    case "SCALE":
      return { bg: "bg-[#B68CFF]/15", text: "text-[#B68CFF]", label: "Scale" };
    default:
      return { bg: "bg-[#8B93A7]/15", text: "text-[#8B93A7]", label: "Info" };
  }
}

// Critical risk flags
export const CRITICAL_RISK_FLAGS = [
  "EXIT_ROUTE_GONE",
  "LIQUIDITY_DRAIN",
  "SUPPLY_INCREASED",
  "PROBE_FAILED",
];

// Route bad flags
export const ROUTE_BAD_FLAGS = ["NO_EXIT_ROUTE", "EXIT_ROUTE_GONE"];

// Check if a flag is critical
export function isCriticalFlag(flag: string): boolean {
  return CRITICAL_RISK_FLAGS.includes(flag);
}

// Check if a flag indicates route problems
export function isRouteBadFlag(flag: string): boolean {
  return ROUTE_BAD_FLAGS.includes(flag);
}

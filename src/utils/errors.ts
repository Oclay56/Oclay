export type RouteCheckErrorClass = "semantic_no_route" | "transient" | "unknown";

const SEMANTIC_NO_ROUTE_PATTERNS = [
  "no route",
  "route not found",
  "could not find route",
  "no swap route",
  "insufficient liquidity",
  "liquidity too low",
  "pair not found",
  "market not found"
];

const TRANSIENT_PATTERNS = [
  "429",
  "rate limit",
  "timeout",
  "timed out",
  "aborted",
  "econnreset",
  "socket hang up",
  "503",
  "502",
  "service unavailable",
  "gateway timeout"
];

export function classifyRouteCheckError(err: unknown): RouteCheckErrorClass {
  const msg = String(err).toLowerCase();
  if (SEMANTIC_NO_ROUTE_PATTERNS.some((pattern) => msg.includes(pattern))) {
    return "semantic_no_route";
  }
  if (TRANSIENT_PATTERNS.some((pattern) => msg.includes(pattern))) {
    return "transient";
  }
  return "unknown";
}

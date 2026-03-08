import { describe, expect, test } from "vitest";
import { classifyRouteCheckError } from "../../src/utils/errors";

describe("guardian route check classification", () => {
  test("classifies no-route semantics as emergency route-gone", () => {
    const cls = classifyRouteCheckError("Jupiter order failed: no route found for token pair");
    expect(cls).toBe("semantic_no_route");
  });

  test("classifies 429 and timeout failures as transient", () => {
    expect(classifyRouteCheckError("429 Rate limit exceeded")).toBe("transient");
    expect(classifyRouteCheckError("request timed out while calling ultra")).toBe("transient");
  });

  test("falls back to unknown when signal is not recognized", () => {
    const cls = classifyRouteCheckError("unexpected parser error");
    expect(cls).toBe("unknown");
  });
});

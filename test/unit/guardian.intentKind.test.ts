import { describe, expect, test } from "vitest";
import { selectGuardianExitIntentKind } from "../../src/guardian/guardianLoop";

describe("guardian intent kind precedence", () => {
  test("emergency triggers always map to EXIT_EMERGENCY", () => {
    const kind = selectGuardianExitIntentKind("STOP", true);
    expect(kind).toBe("EXIT_EMERGENCY");
  });

  test("non-emergency keeps strategy mapping", () => {
    expect(selectGuardianExitIntentKind("TP1", false)).toBe("EXIT_TP1");
    expect(selectGuardianExitIntentKind("TIME", false)).toBe("EXIT_TIME");
    expect(selectGuardianExitIntentKind(undefined, false)).toBe("EXIT_STOP");
  });
});

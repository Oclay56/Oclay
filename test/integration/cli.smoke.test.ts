import { spawn } from "node:child_process";
import { describe, expect, test } from "vitest";

const itIf = process.env.RUN_CLI_SMOKE === "true" ? test : test.skip;

describe("integration: cli dashboard smoke", () => {
  itIf("paper with dashboard exits cleanly", async () => {
    const res = await runNpm([
      "run",
      "paper",
      "--",
      "--durationSec",
      "5",
      "--refreshSec",
      "1",
      "--rows",
      "3"
    ], {
      DASHBOARD_LOG_LEVEL: "info",
      DASHBOARD_LOG_TARGET: "stderr"
    });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("mode=paper");
    expect(res.stderr).toContain("paper mode");
  }, 90_000);

  itIf("paper dashboard supports --only-failures", async () => {
    const res = await runNpm([
      "run",
      "paper",
      "--",
      "--durationSec",
      "5",
      "--only-failures",
      "--refreshSec",
      "1",
      "--rows",
      "3"
    ]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("mode=paper");
  }, 90_000);

  itIf("paper --no-dashboard preserves legacy log mode", async () => {
    const res = await runNpm(["run", "paper", "--", "--durationSec", "5", "--no-dashboard"]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("paper mode");
  }, 90_000);

  itIf("paper with live-40 profile exits cleanly", async () => {
    const res = await runNpm([
      "run",
      "paper",
      "--",
      "--config",
      "config/live-40.json",
      "--durationSec",
      "5",
      "--no-dashboard"
    ]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("paper mode");
  }, 90_000);

  itIf("paper with scam-scalp profile exits cleanly", async () => {
    const res = await runNpm([
      "run",
      "paper",
      "--",
      "--config",
      "config/scam-scalp.json",
      "--durationSec",
      "5",
      "--no-dashboard"
    ]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("paper mode");
  }, 90_000);
});

function runNpm(
  args: string[],
  envOverrides: Record<string, string> = {}
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const cmd = process.platform === "win32" ? "npm.cmd" : "npm";
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: process.cwd(),
      env: { ...process.env, LOG_LEVEL: process.env.LOG_LEVEL ?? "info", ...envOverrides },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });

    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

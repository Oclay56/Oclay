import { spawn, type ChildProcess } from "node:child_process";

type DevMode = "observe" | "paper" | "live";

async function main(): Promise<void> {
  const modeArg = process.argv[2];
  const mode: DevMode = modeArg === "paper" || modeArg === "live" ? modeArg : "observe";
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

  const backendScript =
    mode === "paper" ? "web:paper" : mode === "live" ? "web:live" : "web";

  const backend = spawn(npmCmd, ["run", backendScript], {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: false
  });

  const frontend = spawn(npmCmd, ["run", "dev"], {
    cwd: `${process.cwd()}/front-end`,
    stdio: "inherit",
    shell: false
  });

  const children = [backend, frontend];
  const shutdown = () => {
    for (const child of children) {
      terminate(child);
    }
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await Promise.race(children.map((child) => waitForExit(child)));
  shutdown();
}

function terminate(child: ChildProcess): void {
  if (child.killed || child.exitCode !== null) return;
  child.kill("SIGTERM");
}

function waitForExit(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.once("error", () => resolve());
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});

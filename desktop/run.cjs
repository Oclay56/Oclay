const path = require("node:path");
const { spawn } = require("node:child_process");

function main() {
  const electronBinary = require("electron");
  const mainEntry = path.join(__dirname, "main.cjs");
  const args = [mainEntry, ...process.argv.slice(2)];
  const env = { ...process.env };

  // Ensure Electron runs in app mode even if inherited env sets this.
  delete env.ELECTRON_RUN_AS_NODE;
  env.OCLAY_NODE_EXEC = process.execPath;

  const child = spawn(electronBinary, args, {
    stdio: "inherit",
    env
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.exitCode = 1;
      return;
    }
    process.exit(code ?? 0);
  });

  child.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error(`Failed to launch Electron: ${String(err)}`);
    process.exit(1);
  });
}

main();

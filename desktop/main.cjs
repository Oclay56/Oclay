const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const electron = require("electron");
const { app, BrowserWindow, dialog, shell } = electron;

if (!app || !BrowserWindow) {
  // eslint-disable-next-line no-console
  console.error(
    "Electron app context not available. Use `node desktop/run.cjs` or unset ELECTRON_RUN_AS_NODE before launch."
  );
  process.exit(1);
}

const ROOT_DIR = path.resolve(__dirname, "..");
const UI_INDEX = path.join(ROOT_DIR, "front-end", "dist", "index.html");
const DEFAULT_PORT = 3420;
const VALID_MODES = new Set(["observe", "paper", "live"]);

let backendProcess = null;
let mainWindow = null;
let quitting = false;

function readArg(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

function resolveMode() {
  const fromArg = (readArg("--mode") || "").trim().toLowerCase();
  if (VALID_MODES.has(fromArg)) return fromArg;
  return "observe";
}

function resolvePort() {
  const fromArg = Number(readArg("--port"));
  if (Number.isFinite(fromArg) && fromArg > 0) return Math.floor(fromArg);
  return DEFAULT_PORT;
}

function resolveTtsxCliPath() {
  const candidate = path.join(ROOT_DIR, "node_modules", "tsx", "dist", "cli.mjs");
  if (!fs.existsSync(candidate)) {
    throw new Error("Missing tsx runtime. Run `npm install` in the project root.");
  }
  return candidate;
}

function checkUiBuild() {
  if (fs.existsSync(UI_INDEX)) return true;
  dialog.showErrorBox(
    "Dashboard UI Not Built",
    "Missing `front-end/dist/index.html`.\n\nRun `npm --prefix front-end run build` and relaunch desktop mode."
  );
  return false;
}

function startBackend(mode, port) {
  const tsxCli = resolveTtsxCliPath();
  const nodeExec = process.env.OCLAY_NODE_EXEC || "node";
  const args = [
    tsxCli,
    "src/cli.ts",
    "web",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--mode",
    mode
  ];

  backendProcess = spawn(nodeExec, args, {
    cwd: ROOT_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env }
  });

  backendProcess.stdout.on("data", (chunk) => {
    process.stdout.write(`[desktop:web] ${chunk.toString()}`);
  });

  backendProcess.stderr.on("data", (chunk) => {
    process.stderr.write(`[desktop:web] ${chunk.toString()}`);
  });

  backendProcess.once("exit", (code, signal) => {
    if (quitting) return;
    const details = `Backend exited (code=${code ?? "null"}, signal=${signal ?? "null"}).`;
    dialog.showErrorBox("Backend Stopped", details);
    app.quit();
  });
}

async function waitForBackend(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2_500);
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: controller.signal
      });
      clearTimeout(timer);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Timed out waiting for backend on port ${port}`);
}

function createMainWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: "#0B0D10",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}`).catch((err) => {
    dialog.showErrorBox("Failed To Load Dashboard", String(err));
    app.quit();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function shutdownBackend() {
  if (!backendProcess || backendProcess.killed) return;
  try {
    backendProcess.kill("SIGTERM");
  } catch {
    // no-op
  }
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  quitting = true;
  shutdownBackend();
});

app.on("activate", () => {
  if (!mainWindow) {
    const port = resolvePort();
    createMainWindow(port);
  }
});

app.whenReady().then(async () => {
  if (!checkUiBuild()) {
    app.quit();
    return;
  }

  const mode = resolveMode();
  const port = resolvePort();

  try {
    startBackend(mode, port);
    await waitForBackend(port);
    createMainWindow(port);
  } catch (err) {
    dialog.showErrorBox("Desktop Startup Failed", String(err));
    app.quit();
  }
});

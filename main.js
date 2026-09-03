const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");

const CONFIG_PATH = () => path.join(app.getPath("userData"), "config.json");

function defaultChatSdkPath() {
  const candidate = path.join(os.homedir(), "chat-sdk");
  return fs.existsSync(candidate) ? candidate : "";
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH(), "utf8"));
  } catch {
    return {};
  }
}

function saveConfig(patch) {
  const current = loadConfig();
  const next = { ...current, ...patch };
  fs.mkdirSync(path.dirname(CONFIG_PATH()), { recursive: true });
  fs.writeFileSync(CONFIG_PATH(), JSON.stringify(next, null, 2));
  return next;
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 860,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ---- config ----

ipcMain.handle("config:get", () => {
  const cfg = loadConfig();
  if (!cfg.chatSdkPath) cfg.chatSdkPath = defaultChatSdkPath();
  return cfg;
});

ipcMain.handle("config:save", (_evt, patch) => saveConfig(patch));

// ---- running claude -p as a subprocess ----

const runs = new Map(); // runId -> ChildProcess

// The npm-installed `claude` on Windows is a .cmd shim; a plain spawn without
// a shell can't launch it (see chat-sdk's beacon skills / the gladly-inbox
// README for the same gotcha). This app isn't the read-only-boundary-critical
// case autopilot is, so shell:true is an acceptable, simpler fix here.
function spawnClaude(args, cwd, env) {
  const bin = process.env.BEACON_ONBOARD_CLAUDE_BIN || "claude";
  return spawn(bin, args, {
    cwd,
    shell: process.platform === "win32",
    windowsHide: true,
    env: { ...process.env, ...env },
  });
}

function startRun(prompt, { cwd, skipPermissions, extraEnv }) {
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const args = ["-p", prompt];
  if (skipPermissions) args.push("--dangerously-skip-permissions");

  let child;
  try {
    child = spawnClaude(args, cwd, extraEnv);
  } catch (err) {
    // Surface synchronously-thrown spawn errors the same way as async ones.
    queueMicrotask(() => {
      mainWindow.webContents.send("run:output", {
        runId,
        stream: "stderr",
        chunk: `[failed to start claude: ${err.message}]\n`,
      });
      mainWindow.webContents.send("run:done", { runId, code: -1 });
    });
    return runId;
  }

  runs.set(runId, child);

  child.stdout.on("data", (chunk) => {
    mainWindow.webContents.send("run:output", {
      runId,
      stream: "stdout",
      chunk: chunk.toString(),
    });
  });
  child.stderr.on("data", (chunk) => {
    mainWindow.webContents.send("run:output", {
      runId,
      stream: "stderr",
      chunk: chunk.toString(),
    });
  });
  child.on("error", (err) => {
    mainWindow.webContents.send("run:output", {
      runId,
      stream: "stderr",
      chunk: `[failed to start claude: ${err.message}]\n`,
    });
  });
  child.on("close", (code) => {
    runs.delete(runId);
    mainWindow.webContents.send("run:done", { runId, code });
  });

  return runId;
}

ipcMain.handle("run:investigate", (_evt, { url, cwd, skipPermissions }) => {
  const prompt = `/beacon-investigate-site ${url}`;
  return startRun(prompt, { cwd, skipPermissions });
});

ipcMain.handle(
  "run:manifest",
  (
    _evt,
    {
      appId,
      planPath,
      cwd,
      clusterHost,
      orgId,
      skipPermissions,
      ackLintWarnings,
    },
  ) => {
    const lines = [
      "/beacon-manifest",
      `appId: ${appId}`,
      `chatSdkRoot: ${cwd}`,
    ];
    if (planPath) {
      lines.push(
        `Use the Beacon Integration Plan already written at ${planPath} — don't re-investigate the site.`,
      );
    }
    if (clusterHost && orgId) {
      lines.push(
        `clusterHost: ${clusterHost}`,
        `orgId: ${orgId}`,
        "Upload the manifest to that cluster endpoint and bust the tool cache (Steps 3-4).",
      );
    } else {
      lines.push(
        "No cluster/org given — only produce and write the local manifest file (Steps 1-2). Do not upload it anywhere.",
      );
    }
    const prompt = lines.join("\n");
    return startRun(prompt, {
      cwd,
      skipPermissions,
      extraEnv: ackLintWarnings ? { ACK_LINT_WARNINGS: "1" } : {},
    });
  },
);

ipcMain.handle("run:stop", (_evt, runId) => {
  const child = runs.get(runId);
  if (child) child.kill();
  return true;
});

// ---- locating results the skills produce ----

ipcMain.handle("plan:findLatest", (_evt, { cwd, sinceMs }) => {
  const dir = path.join(cwd, "docs", "customer-research");
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => {
        const full = path.join(dir, f);
        return { full, mtimeMs: fs.statSync(full).mtimeMs };
      })
      .filter((f) => !sinceMs || f.mtimeMs >= sinceMs)
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    if (!files.length) return null;
    return {
      path: files[0].full,
      mtimeMs: files[0].mtimeMs,
      content: fs.readFileSync(files[0].full, "utf8"),
    };
  } catch {
    return null;
  }
});

ipcMain.handle("manifest:findLatest", (_evt, { cwd, appId }) => {
  const full = path.join(
    cwd,
    "web-v2",
    "public",
    "orgs",
    "configs",
    "chat",
    `${appId}-manifest.json`,
  );
  try {
    const stat = fs.statSync(full);
    return {
      path: full,
      mtimeMs: stat.mtimeMs,
      content: fs.readFileSync(full, "utf8"),
    };
  } catch {
    return null;
  }
});

ipcMain.handle("shell:openPath", (_evt, target) => shell.openPath(target));
ipcMain.handle("shell:showInFolder", (_evt, target) =>
  shell.showItemInFolder(target),
);

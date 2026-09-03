const $ = (id) => document.getElementById(id);

const state = {
  chatSdkPath: "",
  investigate: { runId: null, startedAt: 0 },
  manifest: { runId: null },
};

function setStatus(el, mode, text) {
  el.className = "status-pill" + (mode ? ` ${mode}` : "");
  el.textContent = text;
}

function appendLog(pre, chunk) {
  pre.textContent += chunk;
  pre.scrollTop = pre.scrollHeight;
}

function truncate(str, max) {
  if (str.length <= max) return str;
  return str.slice(0, max) + `\n\n… truncated (${str.length} chars total)`;
}

// ---------------- settings ----------------

async function loadSettings() {
  const cfg = await window.beacon.getConfig();
  state.chatSdkPath = cfg.chatSdkPath || "";
  $("chatSdkPath").value = state.chatSdkPath;
  if (cfg.lastAppId) $("manifestAppId").value = cfg.lastAppId;
  if (cfg.lastClusterHost) $("manifestClusterHost").value = cfg.lastClusterHost;
  if (cfg.lastOrgId) $("manifestOrgId").value = cfg.lastOrgId;
}

$("settings-toggle").addEventListener("click", () => {
  const body = $("settings-body");
  const collapsed = body.style.display === "none";
  body.style.display = collapsed ? "" : "none";
  $("settings-caret").textContent = collapsed ? "▾" : "▸";
});

$("saveSettings").addEventListener("click", async () => {
  state.chatSdkPath = $("chatSdkPath").value.trim();
  await window.beacon.saveConfig({ chatSdkPath: state.chatSdkPath });
  const hint = $("settingsSaved");
  hint.textContent = "Saved";
  setTimeout(() => (hint.textContent = ""), 1500);
});

// ---------------- step 1: investigate ----------------

const investigateLog = $("investigateLog");
const investigateStatus = $("investigate-status");

$("runInvestigate").addEventListener("click", async () => {
  const url = $("investigateUrl").value.trim();
  const cwd = state.chatSdkPath || $("chatSdkPath").value.trim();
  if (!url) return alert("Enter a site URL first.");
  if (!cwd) return alert("Set the chat-sdk checkout path in Settings first.");

  investigateLog.textContent = "";
  $("investigateResult").hidden = true;
  setStatus(investigateStatus, "running", "running");
  $("runInvestigate").disabled = true;
  $("stopInvestigate").hidden = false;

  state.investigate.startedAt = Date.now();
  state.investigate.runId = await window.beacon.runInvestigate({
    url,
    cwd,
    skipPermissions: $("skipPermissions").checked,
  });
});

$("stopInvestigate").addEventListener("click", async () => {
  if (state.investigate.runId) await window.beacon.stopRun(state.investigate.runId);
});

async function onInvestigateDone(code) {
  $("runInvestigate").disabled = false;
  $("stopInvestigate").hidden = true;

  const cwd = state.chatSdkPath || $("chatSdkPath").value.trim();
  const plan = await window.beacon.findLatestPlan({
    cwd,
    sinceMs: state.investigate.startedAt,
  });

  if (code === 0 && plan) {
    setStatus(investigateStatus, "done", "done");
    $("investigateResult").hidden = false;
    $("investigatePlanPath").textContent = plan.path;
    $("investigatePlanPreview").textContent = truncate(plan.content, 6000);
    $("manifestPlanPath").value = plan.path;
  } else if (code === 0 && !plan) {
    setStatus(investigateStatus, "error", "no plan file found");
  } else {
    setStatus(investigateStatus, "error", `exited ${code}`);
  }
}

// ---------------- step 2: manifest ----------------

const manifestLog = $("manifestLog");
const manifestStatus = $("manifest-status");

$("runManifest").addEventListener("click", async () => {
  const appId = $("manifestAppId").value.trim();
  const cwd = state.chatSdkPath || $("chatSdkPath").value.trim();
  const planPath = $("manifestPlanPath").value.trim();
  const clusterHost = $("manifestClusterHost").value.trim();
  const orgId = $("manifestOrgId").value.trim();
  if (!appId) return alert("Enter an appId first.");
  if (!cwd) return alert("Set the chat-sdk checkout path in Settings first.");

  await window.beacon.saveConfig({
    lastAppId: appId,
    lastClusterHost: clusterHost,
    lastOrgId: orgId,
  });

  manifestLog.textContent = "";
  $("manifestResult").hidden = true;
  setStatus(manifestStatus, "running", "running");
  $("runManifest").disabled = true;
  $("stopManifest").hidden = false;

  state.manifest.runId = await window.beacon.runManifest({
    appId,
    planPath: planPath || null,
    cwd,
    clusterHost: clusterHost || null,
    orgId: orgId || null,
    skipPermissions: $("skipPermissions").checked,
    ackLintWarnings: $("ackLintWarnings").checked,
  });
});

$("stopManifest").addEventListener("click", async () => {
  if (state.manifest.runId) await window.beacon.stopRun(state.manifest.runId);
});

async function onManifestDone(code) {
  $("runManifest").disabled = false;
  $("stopManifest").hidden = true;

  const cwd = state.chatSdkPath || $("chatSdkPath").value.trim();
  const appId = $("manifestAppId").value.trim();
  const manifest = await window.beacon.findLatestManifest({ cwd, appId });

  if (code === 0 && manifest) {
    setStatus(manifestStatus, "done", "done");
    $("manifestResult").hidden = false;
    $("manifestFilePath").textContent = manifest.path;
    $("manifestPreview").textContent = truncate(manifest.content, 6000);
  } else if (code === 0 && !manifest) {
    setStatus(manifestStatus, "error", "no manifest file found");
  } else {
    setStatus(manifestStatus, "error", `exited ${code}`);
  }
}

// ---------------- result file actions ----------------

$("openPlan").addEventListener("click", () =>
  window.beacon.openPath($("investigatePlanPath").textContent),
);
$("showPlanInFolder").addEventListener("click", () =>
  window.beacon.showInFolder($("investigatePlanPath").textContent),
);
$("openManifest").addEventListener("click", () =>
  window.beacon.openPath($("manifestFilePath").textContent),
);
$("showManifestInFolder").addEventListener("click", () =>
  window.beacon.showInFolder($("manifestFilePath").textContent),
);

// ---------------- wiring streamed output ----------------

window.beacon.onRunOutput(({ runId, chunk }) => {
  if (runId === state.investigate.runId) appendLog(investigateLog, chunk);
  if (runId === state.manifest.runId) appendLog(manifestLog, chunk);
});

window.beacon.onRunDone(({ runId, code }) => {
  if (runId === state.investigate.runId) onInvestigateDone(code);
  if (runId === state.manifest.runId) onManifestDone(code);
});

loadSettings();

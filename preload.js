const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("beacon", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (patch) => ipcRenderer.invoke("config:save", patch),

  runInvestigate: (payload) => ipcRenderer.invoke("run:investigate", payload),
  runManifest: (payload) => ipcRenderer.invoke("run:manifest", payload),
  stopRun: (runId) => ipcRenderer.invoke("run:stop", runId),

  findLatestPlan: (payload) => ipcRenderer.invoke("plan:findLatest", payload),
  findLatestManifest: (payload) =>
    ipcRenderer.invoke("manifest:findLatest", payload),

  openPath: (target) => ipcRenderer.invoke("shell:openPath", target),
  showInFolder: (target) => ipcRenderer.invoke("shell:showInFolder", target),

  onRunOutput: (cb) => {
    const handler = (_evt, payload) => cb(payload);
    ipcRenderer.on("run:output", handler);
    return () => ipcRenderer.removeListener("run:output", handler);
  },
  onRunDone: (cb) => {
    const handler = (_evt, payload) => cb(payload);
    ipcRenderer.on("run:done", handler);
    return () => ipcRenderer.removeListener("run:done", handler);
  },
});

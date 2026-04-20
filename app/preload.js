const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  appName: "Remote Desk MVP"
});

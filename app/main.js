const {
  app,
  BrowserWindow,
  session,
  desktopCapturer
} = require("electron");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, "src", "index.html"));
}

app.whenReady().then(() => {
  const ses = session.defaultSession;

  ses.setPermissionCheckHandler((_webContents, permission) => {
    return permission === "display-capture" || permission === "media";
  });

  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === "display-capture" || permission === "media") {
      callback(true);
      return;
    }
    callback(false);
  });

  ses.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ["screen"],
          thumbnailSize: { width: 0, height: 0 }
        });

        if (!sources.length) {
          console.error("No screen sources found.");
          callback({});
          return;
        }

        callback({
          video: sources[0],
          audio: false
        });
      } catch (error) {
        console.error("Screen share setup error:", error);
        callback({});
      }
    },
    {
      useSystemPicker: true
    }
  );

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
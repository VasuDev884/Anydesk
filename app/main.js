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
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, "src", "index.html"));
}

app.whenReady().then(() => {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      const sources = await desktopCapturer.getSources({
        types: ["screen"]
      });

      // 🔥 PICK REAL SCREEN (not random index)
      const screenSource = sources.find(s =>
        s.name.toLowerCase().includes("screen")
      ) || sources[0];

      callback({
        video: screenSource,
        audio: false
      });
    },
    {
      useSystemPicker: false // 🔥 IMPORTANT
    }
  );

  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
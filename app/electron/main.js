const { app, BrowserWindow, ipcMain, shell, net, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;

// Empacotado, o app roda de um bundle somente-leitura (squashfs do AppImage),
// então os desenhos ficam no diretório de documentos do usuário.
// Em dev, ./uploads na raiz do projeto (um nível acima de ./app).
const DEFAULT_UPLOADS_ROOT = app.isPackaged
  ? path.join(app.getPath("documents"), "Excalidraw Manager")
  : path.resolve(app.getAppPath(), "..", "uploads");

// Config do app (persiste a pasta escolhida pelo usuário).
const CONFIG_FILE = path.join(app.getPath("userData"), "config.json");

// Raiz dos desenhos: começa no padrão e pode ser trocada em runtime.
let uploadsRoot = DEFAULT_UPLOADS_ROOT;

function loadConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    if (cfg && typeof cfg.uploadsRoot === "string" && cfg.uploadsRoot) {
      uploadsRoot = cfg.uploadsRoot;
    }
  } catch {
    // sem config ou inválida: mantém o padrão
  }
}

function saveConfig() {
  try {
    // só grava override quando difere do padrão
    const cfg =
      uploadsRoot === DEFAULT_UPLOADS_ROOT ? {} : { uploadsRoot };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8");
  } catch {
    // falha ao persistir não deve derrubar o app
  }
}

function dirInfo() {
  return { path: uploadsRoot, isDefault: uploadsRoot === DEFAULT_UPLOADS_ROOT };
}

/** Troca a raiz dos desenhos, recria o watcher e notifica o renderer. */
async function setUploadsRoot(dir) {
  uploadsRoot = dir;
  await fsp.mkdir(uploadsRoot, { recursive: true });
  saveConfig();
  if (mainWindow && !mainWindow.isDestroyed()) {
    startWatcher(mainWindow);
    mainWindow.webContents.send("fs:changed");
  }
  return dirInfo();
}

const LIBRARY_SITE_ORIGIN = "https://libraries.excalidraw.com";
// biblioteca global (compartilhada entre todos os arquivos)
const LIBRARY_FILE = path.join(app.getPath("userData"), "library.excalidrawlib");

let mainWindow = null;
let libraryWindow = null;

const EMPTY_SCENE = JSON.stringify(
  {
    type: "excalidraw",
    version: 2,
    source: "excalidraw-manager",
    elements: [],
    appState: { viewBackgroundColor: "#ffffff" },
    files: {},
  },
  null,
  2,
);

/**
 * Resolve um caminho relativo dentro de uploadsRoot, rejeitando
 * qualquer tentativa de escapar do diretório (path traversal).
 */
function safePath(rel) {
  const abs = path.resolve(uploadsRoot, rel || ".");
  if (abs !== uploadsRoot && !abs.startsWith(uploadsRoot + path.sep)) {
    throw new Error(`Caminho fora de uploads: ${rel}`);
  }
  return abs;
}

function relPath(abs) {
  return path.relative(uploadsRoot, abs).split(path.sep).join("/");
}

async function scanDir(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const nodes = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      nodes.push({
        type: "folder",
        name: entry.name,
        path: relPath(abs),
        children: await scanDir(abs),
      });
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".excalidraw") || entry.name.endsWith(".md"))
    ) {
      nodes.push({ type: "file", name: entry.name, path: relPath(abs) });
    }
  }
  nodes.sort((a, b) =>
    a.type !== b.type
      ? a.type === "folder"
        ? -1
        : 1
      : a.name.localeCompare(b.name, "pt-BR"),
  );
  return nodes;
}

/** Escrita atômica: grava em arquivo temporário e renomeia por cima. */
async function atomicWrite(abs, content) {
  const tmp = path.join(
    path.dirname(abs),
    `.${path.basename(abs)}.tmp-${process.pid}`,
  );
  try {
    await fsp.writeFile(tmp, content, "utf8");
    await fsp.rename(tmp, abs);
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

async function exists(abs) {
  try {
    await fsp.access(abs);
    return true;
  } catch {
    return false;
  }
}

/** Gera um caminho livre: "Nome.excalidraw", "Nome 2.excalidraw", ... */
async function uniquePath(dirAbs, base, ext) {
  for (let i = 1; ; i++) {
    const name = i === 1 ? `${base}${ext}` : `${base} ${i}${ext}`;
    const abs = path.join(dirAbs, name);
    if (!(await exists(abs))) return abs;
  }
}

/**
 * Extrai a URL do arquivo .excalidrawlib de uma navegação de retorno do
 * site de bibliotecas (…#addLibrary=<url-encodada>&token=…).
 */
function parseAddLibraryUrl(navUrl) {
  const match = navUrl.match(/[#?&]addLibrary=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function importLibraryFromUrl(libUrl) {
  if (!libUrl.startsWith("https://")) {
    throw new Error(`URL de biblioteca não suportada: ${libUrl}`);
  }
  const res = await net.fetch(libUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar biblioteca`);
  const json = await res.text();
  JSON.parse(json); // valida antes de repassar
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("library:add", json);
    mainWindow.focus();
  }
}

/** Janela do app com o site de bibliotecas do Excalidraw. */
function openLibraryWindow(url) {
  if (libraryWindow && !libraryWindow.isDestroyed()) {
    libraryWindow.loadURL(url);
    libraryWindow.focus();
    return;
  }
  libraryWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    title: "Bibliotecas — Excalidraw Manager",
    webPreferences: { sandbox: true },
  });
  libraryWindow.on("closed", () => (libraryWindow = null));

  const handleAdd = (navUrl) => {
    const libUrl = parseAddLibraryUrl(navUrl);
    if (!libUrl) return false;
    importLibraryFromUrl(libUrl).catch((err) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("library:add-error", err.message);
      }
    });
    return true;
  };

  // "Add to Excalidraw" navega para o referrer com #addLibrary=<url>;
  // interceptamos e importamos, sem sair do site de bibliotecas
  libraryWindow.webContents.on("will-navigate", (event, navUrl) => {
    if (handleAdd(navUrl)) {
      event.preventDefault();
    } else if (!navUrl.startsWith(LIBRARY_SITE_ORIGIN)) {
      event.preventDefault();
      if (navUrl.startsWith("http")) shell.openExternal(navUrl);
    }
  });
  libraryWindow.webContents.setWindowOpenHandler(({ url: navUrl }) => {
    if (!handleAdd(navUrl) && navUrl.startsWith("http")) {
      shell.openExternal(navUrl);
    }
    return { action: "deny" };
  });

  libraryWindow.loadURL(url);
}

function registerIpc() {
  ipcMain.handle("fs:tree", () => scanDir(uploadsRoot));

  ipcMain.handle("dir:get", () => dirInfo());

  ipcMain.handle("dir:choose", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Escolher pasta dos desenhos",
      defaultPath: uploadsRoot,
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return setUploadsRoot(result.filePaths[0]);
  });

  ipcMain.handle("dir:reset", () => setUploadsRoot(DEFAULT_UPLOADS_ROOT));

  ipcMain.handle("library:get", async () => {
    try {
      return await fsp.readFile(LIBRARY_FILE, "utf8");
    } catch {
      return null;
    }
  });

  ipcMain.handle("library:save", (_e, json) => atomicWrite(LIBRARY_FILE, json));

  ipcMain.on("window:minimize", () => mainWindow?.minimize());
  ipcMain.on("window:toggle-maximize", () => {
    if (!mainWindow) return;
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  });
  ipcMain.on("window:close", () => mainWindow?.close());

  ipcMain.handle("fs:read", (_e, rel) => fsp.readFile(safePath(rel), "utf8"));

  ipcMain.handle("fs:write", (_e, rel, content) =>
    atomicWrite(safePath(rel), content),
  );

  ipcMain.handle("fs:create-file", async (_e, dirRel, kind = "excalidraw") => {
    const isMarkdown = kind === "markdown";
    const ext = isMarkdown ? ".md" : ".excalidraw";
    const abs = await uniquePath(safePath(dirRel), "Sem título", ext);
    await atomicWrite(abs, isMarkdown ? "" : EMPTY_SCENE);
    return relPath(abs);
  });

  ipcMain.handle("fs:create-folder", async (_e, dirRel) => {
    const abs = await uniquePath(safePath(dirRel), "Nova pasta", "");
    await fsp.mkdir(abs);
    return relPath(abs);
  });

  ipcMain.handle("fs:rename", async (_e, rel, newName) => {
    if (newName.includes("/") || newName.includes("\\")) {
      throw new Error("Nome inválido");
    }
    const src = safePath(rel);
    const dest = path.join(path.dirname(src), newName);
    if (await exists(dest)) throw new Error(`Já existe: ${newName}`);
    await fsp.rename(src, dest);
    return relPath(dest);
  });

  ipcMain.handle("fs:move", async (_e, srcRel, destDirRel) => {
    const src = safePath(srcRel);
    const destDir = safePath(destDirRel);
    if (destDir === src || destDir.startsWith(src + path.sep)) {
      throw new Error("Não é possível mover uma pasta para dentro dela mesma");
    }
    const dest = path.join(destDir, path.basename(src));
    if (dest === src) return relPath(src);
    if (await exists(dest)) {
      throw new Error(`Já existe "${path.basename(src)}" no destino`);
    }
    await fsp.rename(src, dest);
    return relPath(dest);
  });

  ipcMain.handle("fs:delete", (_e, rel) =>
    fsp.rm(safePath(rel), { recursive: true }),
  );

  ipcMain.handle("fs:duplicate", async (_e, rel) => {
    const src = safePath(rel);
    const ext = path.extname(src); // ".excalidraw" ou ".md"
    const base = path.basename(src, ext);
    const abs = await uniquePath(path.dirname(src), `${base} (cópia)`, ext);
    await fsp.copyFile(src, abs);
    return relPath(abs);
  });
}

/**
 * Observa mudanças em uploads e notifica o renderer (debounced).
 * fs.watch recursivo pode não estar disponível em algumas plataformas;
 * nesse caso cai para polling comparando a árvore.
 */
let watcher = null;
let watchPoll = null;

/** Encerra o watcher/polling atual (usado ao trocar a raiz). */
function stopWatcher() {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  if (watchPoll) {
    clearInterval(watchPoll);
    watchPoll = null;
  }
}

function startWatcher(win) {
  stopWatcher();
  let timer = null;
  const notify = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!win.isDestroyed()) win.webContents.send("fs:changed");
    }, 300);
  };
  try {
    watcher = fs.watch(uploadsRoot, { recursive: true }, notify);
  } catch {
    let last = null;
    watchPoll = setInterval(async () => {
      try {
        const snapshot = JSON.stringify(await scanDir(uploadsRoot));
        if (last !== null && snapshot !== last) notify();
        last = snapshot;
      } catch {}
    }, 3000);
  }
}

function createWindow() {
  const win = (mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "Excalidraw Manager",
    frame: false, // barra de título/menu nativos removidos; UI própria na topbar
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  }));

  // site de bibliotecas abre em janela do app; demais links externos
  // (http/https) abrem no navegador padrão, nunca no app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(LIBRARY_SITE_ORIGIN)) {
      openLibraryWindow(url);
    } else if (url.startsWith("http:") || url.startsWith("https:")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    const current = win.webContents.getURL();
    if (url !== current) {
      event.preventDefault();
      if (url.startsWith("http:") || url.startsWith("https:")) {
        shell.openExternal(url);
      }
    }
  });

  // sem menu nativo, F12 (devtools) e Ctrl+R (reload) são registrados à mão
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F12") {
      win.webContents.toggleDevTools();
      event.preventDefault();
    } else if (input.control && input.key.toLowerCase() === "r") {
      win.webContents.reload();
      event.preventDefault();
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  startWatcher(win);
}

app.whenReady().then(async () => {
  loadConfig();
  // se a pasta salva estiver inacessível (drive removido etc.), volta ao padrão
  try {
    await fsp.mkdir(uploadsRoot, { recursive: true });
  } catch {
    uploadsRoot = DEFAULT_UPLOADS_ROOT;
    await fsp.mkdir(uploadsRoot, { recursive: true });
  }
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

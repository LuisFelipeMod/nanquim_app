const { app, BrowserWindow, ipcMain, shell, net, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;
const googleAuth = require("./googleAuth");
const driveSync = require("./driveSync");
const gitSync = require("./gitSync");

// Empacotado, o app roda de um bundle somente-leitura (squashfs do AppImage),
// então os desenhos ficam no diretório de documentos do usuário.
// Em dev, ./uploads na raiz do projeto (um nível acima de ./app).
const DEFAULT_UPLOADS_ROOT = app.isPackaged
  ? path.join(app.getPath("documents"), "Nanquim")
  : path.resolve(app.getAppPath(), "..", "uploads");

// Config do app (persiste a pasta escolhida pelo usuário).
const CONFIG_FILE = path.join(app.getPath("userData"), "config.json");

// Raiz dos desenhos: começa no padrão e pode ser trocada em runtime.
let uploadsRoot = DEFAULT_UPLOADS_ROOT;
// Config do repositório Git ({ remoteUrl, branch }).
let gitConfig = gitSync.normalizeConfig(null);

function loadConfig() {
  let cfg = null;
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    // sem config ou inválida: mantém os padrões
  }
  if (cfg && typeof cfg.uploadsRoot === "string" && cfg.uploadsRoot) {
    uploadsRoot = cfg.uploadsRoot;
  }
  gitConfig = gitSync.normalizeConfig(cfg?.git);
}

function saveConfig() {
  try {
    const cfg = {};
    // só grava override quando difere do padrão
    if (uploadsRoot !== DEFAULT_UPLOADS_ROOT) cfg.uploadsRoot = uploadsRoot;
    if (gitConfig.remoteUrl) cfg.git = gitConfig;
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
    source: "nanquim",
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

/**
 * Caminho do arquivo de anotações (sidecar) de um PDF. As anotações do
 * Excalidraw desenhadas por cima do PDF ficam num arquivo oculto ao lado dele
 * (o próprio PDF nunca é modificado). Ocultos (iniciados por ".") são
 * ignorados por scanDir, então não aparecem na árvore.
 */
function sidecarPath(pdfAbs) {
  return path.join(
    path.dirname(pdfAbs),
    `.${path.basename(pdfAbs)}.annots`,
  );
}

/** Move o sidecar de anotações junto com o PDF, se existir. */
async function moveSidecar(srcPdfAbs, destPdfAbs) {
  const src = sidecarPath(srcPdfAbs);
  if (await exists(src)) {
    await fsp.rename(src, sidecarPath(destPdfAbs)).catch(() => {});
  }
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
      (entry.name.endsWith(".excalidraw") ||
        entry.name.endsWith(".md") ||
        entry.name.endsWith(".pdf"))
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
    title: "Bibliotecas — Nanquim",
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

  // conteúdo binário (PDF) em base64 — usado pelo visualizador de PDF
  ipcMain.handle("fs:read-binary", async (_e, rel) => {
    const buf = await fsp.readFile(safePath(rel));
    return buf.toString("base64");
  });

  // importa um PDF externo copiando-o para dentro da pasta de trabalho
  ipcMain.handle("pdf:import", async (_e, dirRel) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Importar PDF",
      properties: ["openFile"],
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const source = result.filePaths[0];
    const base = path.basename(source, ".pdf");
    const abs = await uniquePath(safePath(dirRel), base, ".pdf");
    await fsp.copyFile(source, abs);
    return relPath(abs);
  });

  // anotações (sidecar) de um PDF: lê / grava o JSON do Excalidraw
  ipcMain.handle("pdf:read-annots", async (_e, rel) => {
    try {
      return await fsp.readFile(sidecarPath(safePath(rel)), "utf8");
    } catch {
      return null;
    }
  });

  ipcMain.handle("pdf:write-annots", (_e, rel, json) =>
    atomicWrite(sidecarPath(safePath(rel)), json),
  );

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
    if (src.endsWith(".pdf")) await moveSidecar(src, dest);
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
    if (src.endsWith(".pdf")) await moveSidecar(src, dest);
    return relPath(dest);
  });

  ipcMain.handle("fs:delete", async (_e, rel) => {
    const abs = safePath(rel);
    await fsp.rm(abs, { recursive: true });
    if (abs.endsWith(".pdf")) {
      await fsp.rm(sidecarPath(abs), { force: true }).catch(() => {});
    }
  });

  ipcMain.handle("fs:duplicate", async (_e, rel) => {
    const src = safePath(rel);
    const ext = path.extname(src); // ".excalidraw" ou ".md"
    const base = path.basename(src, ext);
    const abs = await uniquePath(path.dirname(src), `${base} (cópia)`, ext);
    await fsp.copyFile(src, abs);
    // duplica também as anotações do PDF, se houver
    if (ext === ".pdf") {
      const srcSide = sidecarPath(src);
      if (await exists(srcSide)) {
        await fsp.copyFile(srcSide, sidecarPath(abs)).catch(() => {});
      }
    }
    return relPath(abs);
  });

  ipcMain.handle("md:export-pdf", (_e, rel, html) => exportPdf(rel, html));

  // ---- conta Google (login / Drive) --------------------------------------
  ipcMain.handle("auth:login", () => googleAuth.login());
  ipcMain.handle("auth:logout", () => googleAuth.logout());
  ipcMain.handle("auth:status", () => googleAuth.getStatus());

  // envia (push) o documento local para o Google Drive
  ipcMain.handle("drive:push", async (_e, rel) => {
    const content = await fsp.readFile(safePath(rel), "utf8");
    return driveSync.pushFile(rel, content);
  });

  // ---- sincronização com repositório Git ---------------------------------
  ipcMain.handle("git:get-config", () => gitConfig);

  ipcMain.handle("git:set-config", (_e, cfg) => {
    const next = gitSync.normalizeConfig(cfg);
    // valida antes de persistir (URL vazia = sync desligado, é permitido)
    if (next.remoteUrl) gitSync.validateRemoteUrl(next.remoteUrl);
    gitSync.validateBranch(next.branch);
    gitConfig = next;
    saveConfig();
    return gitConfig;
  });

  ipcMain.handle("git:status", () => gitSync.status(uploadsRoot, gitConfig));

  // roda add -> commit -> push na pasta dos documentos
  ipcMain.handle("git:sync", () => gitSync.sync(uploadsRoot, gitConfig));
}

/**
 * Gera um PDF a partir de um documento HTML já estilizado (renderizado do
 * markdown no renderer). Abre um diálogo de "Salvar como" e imprime numa
 * janela oculta via webContents.printToPDF. Retorna o caminho salvo ou null
 * se o usuário cancelar.
 */
async function exportPdf(rel, html) {
  const abs = safePath(rel);
  const base = path.basename(abs, path.extname(abs));

  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Exportar PDF",
    defaultPath: path.join(path.dirname(abs), `${base}.pdf`),
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (result.canceled || !result.filePath) return null;

  const pdfWin = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, javascript: false },
  });
  try {
    await pdfWin.loadURL(
      "data:text/html;charset=utf-8," + encodeURIComponent(html),
    );
    const pdf = await pdfWin.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      margins: {
        marginType: "custom",
        top: 0.6,
        bottom: 0.6,
        left: 0.6,
        right: 0.6,
      },
    });
    await fsp.writeFile(result.filePath, pdf);
    return result.filePath;
  } finally {
    if (!pdfWin.isDestroyed()) pdfWin.destroy();
  }
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
    title: "Nanquim",
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

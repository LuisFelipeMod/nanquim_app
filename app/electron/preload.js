const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getTree: () => ipcRenderer.invoke("fs:tree"),
  getDir: () => ipcRenderer.invoke("dir:get"),
  chooseDir: () => ipcRenderer.invoke("dir:choose"),
  resetDir: () => ipcRenderer.invoke("dir:reset"),
  readFile: (rel) => ipcRenderer.invoke("fs:read", rel),
  readBinary: (rel) => ipcRenderer.invoke("fs:read-binary", rel),
  writeFile: (rel, content) => ipcRenderer.invoke("fs:write", rel, content),
  createFile: (dirRel, kind) =>
    ipcRenderer.invoke("fs:create-file", dirRel, kind),
  importPdf: (dirRel) => ipcRenderer.invoke("pdf:import", dirRel),
  readPdfAnnots: (rel) => ipcRenderer.invoke("pdf:read-annots", rel),
  writePdfAnnots: (rel, json) =>
    ipcRenderer.invoke("pdf:write-annots", rel, json),
  createFolder: (dirRel) => ipcRenderer.invoke("fs:create-folder", dirRel),
  renameEntry: (rel, newName) => ipcRenderer.invoke("fs:rename", rel, newName),
  moveEntry: (srcRel, destDirRel) =>
    ipcRenderer.invoke("fs:move", srcRel, destDirRel),
  deleteEntry: (rel) => ipcRenderer.invoke("fs:delete", rel),
  duplicateFile: (rel) => ipcRenderer.invoke("fs:duplicate", rel),
  exportMarkdownPdf: (rel, html) =>
    ipcRenderer.invoke("md:export-pdf", rel, html),
  onFsChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("fs:changed", listener);
    return () => ipcRenderer.removeListener("fs:changed", listener);
  },
  libraryGet: () => ipcRenderer.invoke("library:get"),
  librarySave: (json) => ipcRenderer.invoke("library:save", json),
  onLibraryAdd: (callback) => {
    const listener = (_e, json) => callback(json);
    ipcRenderer.on("library:add", listener);
    return () => ipcRenderer.removeListener("library:add", listener);
  },
  onLibraryAddError: (callback) => {
    const listener = (_e, message) => callback(message);
    ipcRenderer.on("library:add-error", listener);
    return () => ipcRenderer.removeListener("library:add-error", listener);
  },
  windowMinimize: () => ipcRenderer.send("window:minimize"),
  windowToggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
  windowClose: () => ipcRenderer.send("window:close"),
  auth: {
    login: () => ipcRenderer.invoke("auth:login"),
    logout: () => ipcRenderer.invoke("auth:logout"),
    status: () => ipcRenderer.invoke("auth:status"),
  },
  drive: {
    push: (rel) => ipcRenderer.invoke("drive:push", rel),
  },
  git: {
    getConfig: () => ipcRenderer.invoke("git:get-config"),
    setConfig: (config) => ipcRenderer.invoke("git:set-config", config),
    status: () => ipcRenderer.invoke("git:status"),
    sync: () => ipcRenderer.invoke("git:sync"),
  },
});

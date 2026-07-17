import { useCallback, useEffect, useRef, useState } from "react";
import {
  Excalidraw,
  mergeLibraryItems,
  restoreLibraryItems,
  serializeAsJSON,
  serializeLibraryAsJSON,
} from "@excalidraw/excalidraw";

import { Sidebar } from "./components/Sidebar";
import { TabBar } from "./components/TabBar";
import { MarkdownEditor } from "./components/MarkdownEditor";
import {
  fileKind,
  type FileKind,
  type GoogleAuthStatus,
  type SaveStatus,
  type Tab,
  type TreeNode,
} from "./types";

const AUTOSAVE_DEBOUNCE_MS = 1000;

const FONT_SIZES = [
  { value: 12, label: "Pequena" },
  { value: 14, label: "Média" },
  { value: 16, label: "Grande" },
  { value: 18, label: "Muito grande" },
];
const DEFAULT_FONT_SIZE = 14;

type Theme = "light" | "dark";

const systemTheme = (): Theme =>
  window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

type Scene = {
  elements: readonly any[];
  appState: any;
  files: any;
  savedJson: string;
};

function parentDir(path: string) {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

function baseName(path: string) {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

export default function App() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const [theme, setTheme] = useState<Theme>(systemTheme);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dirInfo, setDirInfo] = useState<{
    path: string;
    isDefault: boolean;
  } | null>(null);
  const [googleAuth, setGoogleAuth] = useState<GoogleAuthStatus | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [fontSize, setFontSize] = useState<number>(() => {
    const saved = Number(localStorage.getItem("ui-font-size"));
    return FONT_SIZES.some((o) => o.value === saved) ? saved : DEFAULT_FONT_SIZE;
  });

  useEffect(() => {
    document.documentElement.style.setProperty("--ui-font", `${fontSize}px`);
    localStorage.setItem("ui-font-size", String(fontSize));
  }, [fontSize]);

  // tema inicial segue o SO e acompanha mudanças do sistema
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = (e: MediaQueryListEvent) =>
      setTheme(e.matches ? "dark" : "light");
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const scenes = useRef(new Map<string, Scene>());
  // documentos markdown abertos: texto atual e último texto salvo
  const mdDocs = useRef(new Map<string, { text: string; savedText: string }>());
  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const activePathRef = useRef(activePath);
  activePathRef.current = activePath;

  // biblioteca global de shapes, compartilhada entre todos os arquivos
  const excalidrawApi = useRef<any>(null);
  const library = useRef<any[]>([]);
  const [libraryLoaded, setLibraryLoaded] = useState(false);

  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  const refreshTree = useCallback(async () => {
    try {
      setTree(await window.api.getTree());
    } catch (err: any) {
      toast(`Erro ao ler uploads: ${err?.message ?? err}`);
    }
  }, [toast]);

  useEffect(() => {
    refreshTree();
    return window.api.onFsChanged(refreshTree);
  }, [refreshTree]);

  // pasta atual dos desenhos (exibida nas configurações)
  useEffect(() => {
    window.api
      .getDir()
      .then(setDirInfo)
      .catch((err) => toast(`Erro ao obter pasta: ${err?.message ?? err}`));
  }, [toast]);

  // estado da conta Google (login para sincronizar com o Drive)
  useEffect(() => {
    window.api.auth
      .status()
      .then(setGoogleAuth)
      .catch((err) => toast(`Erro ao obter conta Google: ${err?.message ?? err}`));
  }, [toast]);

  const handleGoogleLogin = useCallback(async () => {
    setAuthBusy(true);
    try {
      const status = await window.api.auth.login();
      setGoogleAuth(status);
      toast(`Conectado ao Google${status.email ? ` como ${status.email}` : ""} ✓`);
    } catch (err: any) {
      toast(`Erro ao entrar no Google: ${err?.message ?? err}`);
    } finally {
      setAuthBusy(false);
    }
  }, [toast]);

  const handleGoogleLogout = useCallback(async () => {
    setAuthBusy(true);
    try {
      setGoogleAuth(await window.api.auth.logout());
      toast("Conta Google desconectada");
    } catch (err: any) {
      toast(`Erro ao sair do Google: ${err?.message ?? err}`);
    } finally {
      setAuthBusy(false);
    }
  }, [toast]);

  // carga inicial da biblioteca global
  useEffect(() => {
    window.api
      .libraryGet()
      .then((json) => {
        if (json) {
          const parsed = JSON.parse(json);
          library.current = restoreLibraryItems(
            parsed.libraryItems ?? parsed.library ?? [],
            "unpublished",
          ) as any[];
        }
      })
      .catch((err) => toast(`Erro ao carregar biblioteca: ${err?.message ?? err}`))
      .finally(() => setLibraryLoaded(true));
  }, [toast]);

  const persistLibrary = useCallback(
    (items: any[]) => {
      library.current = items;
      window.api
        .librarySave(serializeLibraryAsJSON(items as any))
        .catch((err) =>
          toast(`Erro ao salvar biblioteca: ${err?.message ?? err}`),
        );
    },
    [toast],
  );

  // bibliotecas adicionadas via "Add to Excalidraw" no site de bibliotecas
  useEffect(() => {
    const offAdd = window.api.onLibraryAdd((json) => {
      try {
        const parsed = JSON.parse(json);
        const incoming = restoreLibraryItems(
          parsed.libraryItems ?? parsed.library ?? [],
          "published",
        );
        const merged = mergeLibraryItems(
          library.current as any,
          incoming as any,
        ) as any[];
        persistLibrary(merged);
        excalidrawApi.current?.updateLibrary({
          libraryItems: merged,
          openLibraryMenu: true,
        });
        toast("Biblioteca adicionada ✓");
      } catch (err: any) {
        toast(`Erro ao importar biblioteca: ${err?.message ?? err}`);
      }
    });
    const offErr = window.api.onLibraryAddError((message) =>
      toast(`Erro ao baixar biblioteca: ${message}`),
    );
    return () => {
      offAdd();
      offErr();
    };
  }, [persistLibrary, toast]);

  const setTabStatus = useCallback(
    (path: string, status: SaveStatus, errorMessage?: string) => {
      setTabs((tabs) =>
        tabs.map((t) => (t.path === path ? { ...t, status, errorMessage } : t)),
      );
    },
    [],
  );

  // ---- persistência -------------------------------------------------------

  const doSave = useCallback(
    async (path: string): Promise<boolean> => {
      const timer = saveTimers.current.get(path);
      if (timer) {
        clearTimeout(timer);
        saveTimers.current.delete(path);
      }

      // documentos markdown: persiste texto puro
      if (fileKind(path) === "markdown") {
        const doc = mdDocs.current.get(path);
        if (!doc) return true;
        if (doc.text === doc.savedText) {
          setTabStatus(path, "saved");
          return true;
        }
        setTabStatus(path, "saving");
        try {
          await window.api.writeFile(path, doc.text);
          doc.savedText = doc.text;
          setTabStatus(path, "saved");
          return true;
        } catch (err: any) {
          const message = err?.message ?? String(err);
          setTabStatus(path, "error", message);
          toast(`Falha ao salvar "${baseName(path)}": ${message}`);
          return false;
        }
      }

      const scene = scenes.current.get(path);
      if (!scene) return true;
      const json = serializeAsJSON(
        scene.elements as any,
        scene.appState,
        scene.files ?? {},
        "local",
      );
      if (json === scene.savedJson) {
        setTabStatus(path, "saved");
        return true;
      }
      setTabStatus(path, "saving");
      try {
        await window.api.writeFile(path, json);
        scene.savedJson = json;
        setTabStatus(path, "saved");
        return true;
      } catch (err: any) {
        const message = err?.message ?? String(err);
        setTabStatus(path, "error", message);
        toast(`Falha ao salvar "${baseName(path)}": ${message}`);
        return false;
      }
    },
    [setTabStatus, toast],
  );

  const scheduleSave = useCallback(
    (path: string) => {
      const existing = saveTimers.current.get(path);
      if (existing) clearTimeout(existing);
      saveTimers.current.set(
        path,
        setTimeout(() => doSave(path), AUTOSAVE_DEBOUNCE_MS),
      );
    },
    [doSave],
  );

  const handleEditorChange = useCallback(
    (elements: readonly any[], appState: any, files: any) => {
      const path = activePathRef.current;
      if (!path) return;
      const scene = scenes.current.get(path);
      if (!scene) return;
      scene.elements = elements;
      scene.appState = appState;
      scene.files = files;
      setTabs((tabs) =>
        tabs.some((t) => t.path === path && t.status === "saved")
          ? tabs.map((t) =>
              t.path === path ? { ...t, status: "dirty" } : t,
            )
          : tabs,
      );
      scheduleSave(path);
    },
    [scheduleSave],
  );

  const handleMarkdownChange = useCallback(
    (path: string, text: string) => {
      const doc = mdDocs.current.get(path);
      if (!doc) return;
      doc.text = text;
      setTabs((tabs) =>
        tabs.some((t) => t.path === path && t.status === "saved")
          ? tabs.map((t) => (t.path === path ? { ...t, status: "dirty" } : t))
          : tabs,
      );
      scheduleSave(path);
    },
    [scheduleSave],
  );

  const handleExportPdf = useCallback(
    async (path: string, html: string) => {
      try {
        const saved = await window.api.exportMarkdownPdf(path, html);
        if (saved) toast(`PDF exportado ✓`);
      } catch (err: any) {
        toast(`Erro ao exportar PDF: ${err?.message ?? err}`);
      }
    },
    [toast],
  );

  // ---- abas ---------------------------------------------------------------

  const openFile = useCallback(
    async (path: string) => {
      if (scenes.current.has(path) || mdDocs.current.has(path)) {
        setActivePath(path);
        return;
      }

      // markdown: carrega texto puro
      if (fileKind(path) === "markdown") {
        try {
          const text = await window.api.readFile(path);
          mdDocs.current.set(path, { text, savedText: text });
          setTabs((tabs) => [
            ...tabs,
            { path, name: baseName(path), status: "saved" },
          ]);
          setActivePath(path);
        } catch (err: any) {
          toast(`Erro ao abrir "${baseName(path)}": ${err?.message ?? err}`);
        }
        return;
      }

      try {
        const raw = await window.api.readFile(path);
        const data = JSON.parse(raw);
        const elements = data.elements ?? [];
        const appState = data.appState ?? {};
        delete appState.collaborators;
        const files = data.files ?? {};
        scenes.current.set(path, {
          elements,
          appState,
          files,
          savedJson: serializeAsJSON(elements, appState, files, "local"),
        });
        setTabs((tabs) => [
          ...tabs,
          { path, name: baseName(path), status: "saved" },
        ]);
        setActivePath(path);
      } catch (err: any) {
        toast(`Erro ao abrir "${baseName(path)}": ${err?.message ?? err}`);
      }
    },
    [toast],
  );

  const closeTab = useCallback(
    async (path: string) => {
      const ok = await doSave(path);
      if (!ok) {
        const force = window.confirm(
          `Não foi possível salvar "${baseName(path)}". Fechar mesmo assim e descartar as alterações?`,
        );
        if (!force) return;
      }
      scenes.current.delete(path);
      mdDocs.current.delete(path);
      saveTimers.current.delete(path);
      setTabs((tabs) => {
        const idx = tabs.findIndex((t) => t.path === path);
        const next = tabs.filter((t) => t.path !== path);
        setActivePath((current) => {
          if (current !== path) return current;
          if (next.length === 0) return null;
          return next[Math.min(idx, next.length - 1)].path;
        });
        return next;
      });
    },
    [doSave],
  );

  const closeOthers = useCallback(
    async (path: string) => {
      for (const t of tabs.filter((t) => t.path !== path)) {
        await closeTab(t.path);
      }
    },
    [tabs, closeTab],
  );

  const closeAll = useCallback(async () => {
    for (const t of [...tabs]) {
      await closeTab(t.path);
    }
  }, [tabs, closeTab]);

  /** Ajusta caminhos de abas/cenas abertas após rename/move. */
  const remapOpenPaths = useCallback((oldPath: string, newPath: string) => {
    const remap = (p: string) =>
      p === oldPath
        ? newPath
        : p.startsWith(oldPath + "/")
          ? newPath + p.slice(oldPath.length)
          : p;

    const newScenes = new Map<string, Scene>();
    for (const [p, scene] of scenes.current) newScenes.set(remap(p), scene);
    scenes.current = newScenes;

    const newDocs = new Map<string, { text: string; savedText: string }>();
    for (const [p, doc] of mdDocs.current) newDocs.set(remap(p), doc);
    mdDocs.current = newDocs;

    for (const [p, timer] of [...saveTimers.current]) {
      const np = remap(p);
      if (np !== p) {
        saveTimers.current.delete(p);
        saveTimers.current.set(np, timer);
      }
    }

    setTabs((tabs) =>
      tabs.map((t) =>
        remap(t.path) === t.path
          ? t
          : { ...t, path: remap(t.path), name: baseName(remap(t.path)) },
      ),
    );
    setActivePath((current) => (current ? remap(current) : current));
  }, []);

  // ---- operações da sidebar ----------------------------------------------

  const handleCreateFile = useCallback(
    async (dirRel: string, kind: FileKind = "excalidraw") => {
      try {
        const path = await window.api.createFile(dirRel, kind);
        await refreshTree();
        await openFile(path);
        setRenamingPath(path);
      } catch (err: any) {
        toast(`Erro ao criar arquivo: ${err?.message ?? err}`);
      }
    },
    [refreshTree, openFile, toast],
  );

  const handleCreateFolder = useCallback(
    async (dirRel: string) => {
      try {
        // window.prompt não é suportado no Electron: cria com nome padrão
        // e entra direto no modo de renomear inline
        const newPath = await window.api.createFolder(dirRel);
        await refreshTree();
        setRenamingPath(newPath);
      } catch (err: any) {
        toast(`Erro ao criar pasta: ${err?.message ?? err}`);
      }
    },
    [refreshTree, toast],
  );

  const handleRename = useCallback(
    async (path: string, newName: string) => {
      setRenamingPath(null);
      // preserva a extensão do arquivo ao renomear (.excalidraw ou .md)
      const extMatch = path.match(/\.(excalidraw|md)$/);
      if (extMatch && !newName.endsWith(extMatch[0])) {
        newName += extMatch[0];
      }
      if (newName === baseName(path)) return;
      try {
        const newPath = await window.api.renameEntry(path, newName);
        remapOpenPaths(path, newPath);
        await refreshTree();
      } catch (err: any) {
        toast(`Erro ao renomear: ${err?.message ?? err}`);
      }
    },
    [remapOpenPaths, refreshTree, toast],
  );

  const handleMove = useCallback(
    async (srcPath: string, destDir: string) => {
      if (parentDir(srcPath) === destDir) return;
      try {
        const newPath = await window.api.moveEntry(srcPath, destDir);
        remapOpenPaths(srcPath, newPath);
        await refreshTree();
      } catch (err: any) {
        toast(`Erro ao mover: ${err?.message ?? err}`);
      }
    },
    [remapOpenPaths, refreshTree, toast],
  );

  const handleDelete = useCallback(
    async (node: TreeNode) => {
      const label =
        node.type === "folder"
          ? `a pasta "${node.name}" e todo o seu conteúdo`
          : `o arquivo "${node.name}"`;
      if (!window.confirm(`Excluir ${label}?`)) return;
      try {
        // fecha abas do arquivo/da pasta antes de excluir
        const affected = tabs.filter(
          (t) => t.path === node.path || t.path.startsWith(node.path + "/"),
        );
        for (const t of affected) {
          scenes.current.delete(t.path);
          mdDocs.current.delete(t.path);
          const timer = saveTimers.current.get(t.path);
          if (timer) clearTimeout(timer);
          saveTimers.current.delete(t.path);
        }
        const affectedPaths = new Set(affected.map((t) => t.path));
        setTabs((tabs) => {
          const next = tabs.filter((t) => !affectedPaths.has(t.path));
          setActivePath((current) =>
            current && affectedPaths.has(current)
              ? (next[next.length - 1]?.path ?? null)
              : current,
          );
          return next;
        });
        await window.api.deleteEntry(node.path);
        await refreshTree();
      } catch (err: any) {
        toast(`Erro ao excluir: ${err?.message ?? err}`);
      }
    },
    [tabs, refreshTree, toast],
  );

  const handleDuplicate = useCallback(
    async (path: string) => {
      try {
        await window.api.duplicateFile(path);
        await refreshTree();
      } catch (err: any) {
        toast(`Erro ao duplicar: ${err?.message ?? err}`);
      }
    },
    [refreshTree, toast],
  );

  // ---- troca de pasta de trabalho ----------------------------------------

  /**
   * Aplica a nova raiz: os caminhos das abas são relativos à pasta antiga,
   * então descarta o workspace (já salvo antes da troca) e recarrega a árvore.
   */
  const applyDirChange = useCallback(
    async (info: { path: string; isDefault: boolean }) => {
      for (const timer of saveTimers.current.values()) clearTimeout(timer);
      saveTimers.current.clear();
      scenes.current.clear();
      mdDocs.current.clear();
      setTabs([]);
      setActivePath(null);
      setDirInfo(info);
      await refreshTree();
    },
    [refreshTree],
  );

  const handleChooseDir = useCallback(async () => {
    // salva o conteúdo aberto na raiz atual antes de trocar
    await Promise.all(tabs.map((t) => doSave(t.path)));
    try {
      const info = await window.api.chooseDir();
      if (info) {
        await applyDirChange(info);
        toast("Pasta alterada ✓");
      }
    } catch (err: any) {
      toast(`Erro ao trocar pasta: ${err?.message ?? err}`);
    }
  }, [tabs, doSave, applyDirChange, toast]);

  const handleResetDir = useCallback(async () => {
    await Promise.all(tabs.map((t) => doSave(t.path)));
    try {
      const info = await window.api.resetDir();
      await applyDirChange(info);
      toast("Pasta padrão restaurada ✓");
    } catch (err: any) {
      toast(`Erro ao restaurar pasta: ${err?.message ?? err}`);
    }
  }, [tabs, doSave, applyDirChange, toast]);

  // ---- render --------------------------------------------------------------

  const activeIsMarkdown = activePath ? fileKind(activePath) === "markdown" : false;
  const activeScene = activePath ? scenes.current.get(activePath) : null;
  const activeMd =
    activePath && activeIsMarkdown ? mdDocs.current.get(activePath) : null;

  // callbacks estáveis: o memo do <Excalidraw> compara props rasamente,
  // arrows inline aqui causariam re-render (e loop com onChange) a cada render
  const handleExcalidrawApi = useCallback((api: any) => {
    excalidrawApi.current = api;
  }, []);

  return (
    <div className="app">
      <div className="topbar">
        <button
          className="icon-btn"
          title={sidebarOpen ? "Recolher barra lateral" : "Expandir barra lateral"}
          onClick={() => setSidebarOpen((v) => !v)}
        >
          ☰
        </button>
        <button
          className="icon-btn"
          title={theme === "dark" ? "Tema claro" : "Tema escuro"}
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        >
          {theme === "dark" ? "☀" : "🌙"}
        </button>
        <button
          className="icon-btn"
          title="Configurações"
          onClick={() => setSettingsOpen(true)}
        >
          ⚙
        </button>
        {googleAuth?.configured && (
          <button
            className={`icon-btn${googleAuth.loggedIn ? " logged-in" : ""}`}
            title={
              googleAuth.loggedIn
                ? `Google: ${googleAuth.email ?? "conectado"}`
                : "Entrar com Google"
            }
            onClick={() => setSettingsOpen(true)}
          >
            {googleAuth.loggedIn ? "🟢" : "👤"}
          </button>
        )}
        <TabBar
          tabs={tabs}
          activePath={activePath}
          onSelect={setActivePath}
          onClose={closeTab}
          onCloseOthers={closeOthers}
          onCloseAll={closeAll}
        />
        <div className="drag-region" />
        <div className="window-controls">
          <button
            className="win-btn"
            title="Minimizar"
            onClick={() => window.api.windowMinimize()}
          >
            &#x2013;
          </button>
          <button
            className="win-btn"
            title="Maximizar/Restaurar"
            onClick={() => window.api.windowToggleMaximize()}
          >
            &#x25A1;
          </button>
          <button
            className="win-btn close"
            title="Fechar"
            onClick={() => window.api.windowClose()}
          >
            &#x2715;
          </button>
        </div>
      </div>
      <div className="body">
        {sidebarOpen && (
          <Sidebar
            tree={tree}
            activePath={activePath}
            renamingPath={renamingPath}
            onStartRename={setRenamingPath}
            onOpenFile={openFile}
            onCreateFile={handleCreateFile}
            onCreateFolder={handleCreateFolder}
            onRename={handleRename}
            onMove={handleMove}
            onDelete={handleDelete}
            onDuplicate={handleDuplicate}
          />
        )}
        <div className="editor">
          {activePath && activeMd ? (
            <MarkdownEditor
              key={activePath}
              path={activePath}
              initialText={activeMd.text}
              onChange={(text) => handleMarkdownChange(activePath, text)}
              onExportPdf={(html) => handleExportPdf(activePath, html)}
            />
          ) : activePath && activeScene && libraryLoaded ? (
            <Excalidraw
              key={activePath}
              onExcalidrawAPI={handleExcalidrawApi}
              theme={theme}
              langCode="pt-BR"
              libraryReturnUrl="https://nanquim.app/"
              initialData={{
                elements: activeScene.elements as any,
                appState: activeScene.appState,
                files: activeScene.files,
                libraryItems: library.current as any,
              }}
              onChange={handleEditorChange}
              onLibraryChange={persistLibrary as any}
            />
          ) : (
            <div className="empty-state">
              <h2>Nenhum arquivo aberto</h2>
              <p>Crie ou selecione um arquivo na barra lateral</p>
              <div className="empty-actions">
                <button onClick={() => handleCreateFile("", "excalidraw")}>
                  + Novo desenho
                </button>
                <button
                  className="secondary"
                  onClick={() => handleCreateFile("", "markdown")}
                >
                  + Novo markdown
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      {settingsOpen && (
        <div className="modal-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Configurações</h2>
              <button
                className="modal-close"
                title="Fechar"
                onClick={() => setSettingsOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-section-label">Conta Google</div>
            <div className="google-setting">
              {!googleAuth?.configured ? (
                <p className="google-hint">
                  Login com Google indisponível: defina{" "}
                  <code>GOOGLE_CLIENT_ID</code> e{" "}
                  <code>GOOGLE_CLIENT_SECRET</code> em{" "}
                  <code>app/.env.local</code>.
                </p>
              ) : googleAuth.loggedIn ? (
                <div className="google-account">
                  <span className="google-status">
                    <span className="google-dot" /> Conectado
                    {googleAuth.email ? ` como ${googleAuth.email}` : ""}
                  </span>
                  <button
                    className="secondary"
                    disabled={authBusy}
                    onClick={handleGoogleLogout}
                  >
                    Sair
                  </button>
                </div>
              ) : (
                <div className="google-account">
                  <span className="google-status muted">
                    Entre para sincronizar seus documentos com o Google Drive.
                  </span>
                  <button disabled={authBusy} onClick={handleGoogleLogin}>
                    {authBusy ? "Aguardando…" : "Entrar com Google"}
                  </button>
                </div>
              )}
            </div>
            <div className="modal-section-label">Pasta dos desenhos</div>
            <div className="dir-setting">
              <code className="dir-path" title={dirInfo?.path}>
                {dirInfo?.path ?? "…"}
                {dirInfo?.isDefault && (
                  <span className="dir-badge">padrão</span>
                )}
              </code>
              <div className="dir-actions">
                <button onClick={handleChooseDir}>Escolher pasta…</button>
                {dirInfo && !dirInfo.isDefault && (
                  <button className="secondary" onClick={handleResetDir}>
                    Restaurar padrão
                  </button>
                )}
              </div>
            </div>
            <div className="modal-section-label">
              Tamanho da fonte da interface
            </div>
            <div className="font-size-options">
              {FONT_SIZES.map((option) => (
                <button
                  key={option.value}
                  className={fontSize === option.value ? "selected" : ""}
                  onClick={() => setFontSize(option.value)}
                >
                  <span
                    className="sample"
                    style={{ fontSize: `${option.value}px` }}
                  >
                    Aa
                  </span>
                  <span className="caption">{option.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {toasts.length > 0 && (
        <div className="toasts">
          {toasts.map((t) => (
            <div key={t.id} className="toast">
              {t.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

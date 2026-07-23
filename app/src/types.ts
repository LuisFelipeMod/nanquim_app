export type TreeNode = {
  type: "file" | "folder";
  name: string;
  path: string;
  children?: TreeNode[];
};

/** Tipo de arquivo suportado no editor. */
export type FileKind = "excalidraw" | "markdown" | "pdf";

export function fileKind(path: string): FileKind {
  if (path.endsWith(".pdf")) return "pdf";
  if (path.endsWith(".md")) return "markdown";
  return "excalidraw";
}

/** Remove a extensão conhecida (.excalidraw/.md/.pdf) para exibição/renomeio. */
export function stripExt(name: string): string {
  return name.replace(/\.(excalidraw|md|pdf)$/, "");
}

/** Emoji usado como ícone do arquivo (árvore, busca rápida). */
export function fileIcon(path: string): string {
  const kind = fileKind(path);
  return kind === "markdown" ? "📝" : kind === "pdf" ? "📕" : "📄";
}

export type SaveStatus = "saved" | "dirty" | "saving" | "error";

export type Tab = {
  path: string;
  name: string;
  status: SaveStatus;
  errorMessage?: string;
};

export type DirInfo = {
  path: string;
  isDefault: boolean;
};

export type GoogleAuthStatus = {
  /** true quando GOOGLE_CLIENT_ID/SECRET estão definidos no .env. */
  configured: boolean;
  loggedIn: boolean;
  email: string | null;
};

/** Repositório Git usado para versionar/sincronizar os documentos. */
export type GitConfig = {
  /** URL do remote "origin"; vazia = sincronização desligada. */
  remoteUrl: string;
  branch: string;
};

export type GitStatus = GitConfig & {
  /** true quando há uma URL de repositório salva. */
  configured: boolean;
  /** true quando a pasta dos documentos já é um repositório Git. */
  isRepo: boolean;
  currentBranch: string | null;
  /** Nº de arquivos modificados/não rastreados aguardando sincronização. */
  pendingChanges: number;
  lastCommit: string | null;
  error: string | null;
};

export type GitSyncResult = {
  /** false quando não havia nada novo para commitar (só houve push). */
  committed: boolean;
  message: string | null;
  branch: string;
};

export type ElectronAPI = {
  getTree: () => Promise<TreeNode[]>;
  getDir: () => Promise<DirInfo>;
  /** Abre o diálogo nativo; resolve com a nova pasta ou null se cancelado. */
  chooseDir: () => Promise<DirInfo | null>;
  resetDir: () => Promise<DirInfo>;
  readFile: (rel: string) => Promise<string>;
  /** Lê um arquivo binário (ex.: PDF) e devolve o conteúdo em base64. */
  readBinary: (rel: string) => Promise<string>;
  writeFile: (rel: string, content: string) => Promise<void>;
  createFile: (dirRel: string, kind: FileKind) => Promise<string>;
  /** Abre o diálogo nativo para importar um PDF; copia para dirRel e
   * resolve com o caminho relativo do PDF importado, ou null se cancelado. */
  importPdf: (dirRel: string) => Promise<string | null>;
  /** Lê as anotações (sidecar) de um PDF; null se ainda não houver. */
  readPdfAnnots: (rel: string) => Promise<string | null>;
  /** Grava as anotações (sidecar) de um PDF. */
  writePdfAnnots: (rel: string, json: string) => Promise<void>;
  createFolder: (dirRel: string) => Promise<string>;
  renameEntry: (rel: string, newName: string) => Promise<string>;
  moveEntry: (srcRel: string, destDirRel: string) => Promise<string>;
  deleteEntry: (rel: string) => Promise<void>;
  duplicateFile: (rel: string) => Promise<string>;
  /** Exporta o HTML renderizado como PDF; resolve com o caminho salvo ou null. */
  exportMarkdownPdf: (rel: string, html: string) => Promise<string | null>;
  onFsChanged: (callback: () => void) => () => void;
  libraryGet: () => Promise<string | null>;
  librarySave: (json: string) => Promise<void>;
  onLibraryAdd: (callback: (json: string) => void) => () => void;
  onLibraryAddError: (callback: (message: string) => void) => () => void;
  windowMinimize: () => void;
  windowToggleMaximize: () => void;
  windowClose: () => void;
  auth: {
    /** Abre a tela de consentimento do Google no navegador do sistema. */
    login: () => Promise<GoogleAuthStatus>;
    logout: () => Promise<GoogleAuthStatus>;
    status: () => Promise<GoogleAuthStatus>;
  };
  drive: {
    /** Envia (cria ou atualiza) o documento local no Google Drive. */
    push: (rel: string) => Promise<{ fileId: string }>;
  };
  git: {
    getConfig: () => Promise<GitConfig>;
    /** Valida e persiste a config; rejeita com o motivo se for inválida. */
    setConfig: (config: GitConfig) => Promise<GitConfig>;
    status: () => Promise<GitStatus>;
    /** Roda add + commit (com data/hora) + push na pasta dos documentos. */
    sync: () => Promise<GitSyncResult>;
  };
};

declare global {
  interface Window {
    api: ElectronAPI;
  }
}

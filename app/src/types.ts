export type TreeNode = {
  type: "file" | "folder";
  name: string;
  path: string;
  children?: TreeNode[];
};

/** Tipo de arquivo suportado no editor. */
export type FileKind = "excalidraw" | "markdown";

export function fileKind(path: string): FileKind {
  return path.endsWith(".md") ? "markdown" : "excalidraw";
}

/** Remove a extensão conhecida (.excalidraw/.md) para exibição/renomeio. */
export function stripExt(name: string): string {
  return name.replace(/\.(excalidraw|md)$/, "");
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

export type ElectronAPI = {
  getTree: () => Promise<TreeNode[]>;
  getDir: () => Promise<DirInfo>;
  /** Abre o diálogo nativo; resolve com a nova pasta ou null se cancelado. */
  chooseDir: () => Promise<DirInfo | null>;
  resetDir: () => Promise<DirInfo>;
  readFile: (rel: string) => Promise<string>;
  writeFile: (rel: string, content: string) => Promise<void>;
  createFile: (dirRel: string, kind: FileKind) => Promise<string>;
  createFolder: (dirRel: string) => Promise<string>;
  renameEntry: (rel: string, newName: string) => Promise<string>;
  moveEntry: (srcRel: string, destDirRel: string) => Promise<string>;
  deleteEntry: (rel: string) => Promise<void>;
  duplicateFile: (rel: string) => Promise<string>;
  onFsChanged: (callback: () => void) => () => void;
  libraryGet: () => Promise<string | null>;
  librarySave: (json: string) => Promise<void>;
  onLibraryAdd: (callback: (json: string) => void) => () => void;
  onLibraryAddError: (callback: (message: string) => void) => () => void;
  windowMinimize: () => void;
  windowToggleMaximize: () => void;
  windowClose: () => void;
};

declare global {
  interface Window {
    api: ElectronAPI;
  }
}

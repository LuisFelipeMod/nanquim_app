import { useEffect, useRef, useState } from "react";
import { fileIcon, stripExt, type FileKind, type TreeNode } from "../types";

type MenuState = {
  x: number;
  y: number;
  node: TreeNode | null; // null = área vazia (raiz)
};

type SidebarProps = {
  tree: TreeNode[];
  activePath: string | null;
  renamingPath: string | null;
  onStartRename: (path: string | null) => void;
  onOpenFile: (path: string) => void;
  onCreateFile: (dirRel: string, kind: FileKind) => void;
  onImportPdf: (dirRel: string) => void;
  onCreateFolder: (dirRel: string) => void;
  onRename: (path: string, newName: string) => void;
  onMove: (srcPath: string, destDir: string) => void;
  onDelete: (node: TreeNode) => void;
  onDuplicate: (path: string) => void;
};

export function Sidebar(props: SidebarProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!newMenuOpen) return;
    const close = () => setNewMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [newMenuOpen]);

  const createInRoot = (kind: FileKind) => {
    setNewMenuOpen(false);
    props.onCreateFile("", kind);
  };

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close, true);
    };
  }, [menu]);

  const toggleFolder = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  };

  const openMenu = (e: React.MouseEvent, node: TreeNode | null) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, node });
  };

  const handleDrop = (e: React.DragEvent, destDir: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    const src = e.dataTransfer.getData("text/plain");
    if (src) props.onMove(src, destDir);
  };

  const allowDrop = (e: React.DragEvent, destDir: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(destDir);
  };

  const renderNode = (node: TreeNode, depth: number) => {
    const isRenaming = props.renamingPath === node.path;
    const indent = { paddingLeft: `${8 + depth * 14}px` };

    if (node.type === "folder") {
      const isOpen = expanded.has(node.path);
      return (
        <div key={node.path}>
          <div
            className={`tree-row folder ${dropTarget === node.path ? "drop-target" : ""}`}
            style={indent}
            draggable={!isRenaming}
            onClick={() => toggleFolder(node.path)}
            onContextMenu={(e) => openMenu(e, node)}
            onDragStart={(e) => e.dataTransfer.setData("text/plain", node.path)}
            onDragOver={(e) => allowDrop(e, node.path)}
            onDragLeave={() => setDropTarget(null)}
            onDrop={(e) => handleDrop(e, node.path)}
          >
            <span className="tree-caret">{isOpen ? "▾" : "▸"}</span>
            <span className="tree-icon">📁</span>
            {isRenaming ? (
              <RenameInput
                initial={node.name}
                onSubmit={(name) => props.onRename(node.path, name)}
                onCancel={() => props.onStartRename(null)}
              />
            ) : (
              <span className="tree-label">{node.name}</span>
            )}
          </div>
          {isOpen &&
            node.children?.map((child) => renderNode(child, depth + 1))}
        </div>
      );
    }

    return (
      <div
        key={node.path}
        className={`tree-row file ${props.activePath === node.path ? "active" : ""}`}
        style={indent}
        draggable={!isRenaming}
        onClick={() => props.onOpenFile(node.path)}
        onContextMenu={(e) => openMenu(e, node)}
        onDragStart={(e) => e.dataTransfer.setData("text/plain", node.path)}
      >
        <span className="tree-icon">{fileIcon(node.path)}</span>
        {isRenaming ? (
          <RenameInput
            initial={stripExt(node.name)}
            onSubmit={(name) => props.onRename(node.path, name)}
            onCancel={() => props.onStartRename(null)}
          />
        ) : (
          <span className="tree-label">{stripExt(node.name)}</span>
        )}
      </div>
    );
  };

  const menuDir =
    menu?.node == null
      ? ""
      : menu.node.type === "folder"
        ? menu.node.path
        : menu.node.path.includes("/")
          ? menu.node.path.slice(0, menu.node.path.lastIndexOf("/"))
          : "";

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span>ARQUIVOS</span>
        <div className="sidebar-actions">
          <div className="new-file-wrap">
            <button
              className="icon-btn"
              title="Novo arquivo"
              onClick={(e) => {
                e.stopPropagation();
                setNewMenuOpen((v) => !v);
              }}
            >
              ＋
            </button>
            {newMenuOpen && (
              <div className="new-file-menu" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => createInRoot("excalidraw")}>
                  <span className="tree-icon">📄</span> Desenho (Excalidraw)
                </button>
                <button onClick={() => createInRoot("markdown")}>
                  <span className="tree-icon">📝</span> Markdown
                </button>
                <button
                  onClick={() => {
                    setNewMenuOpen(false);
                    props.onImportPdf("");
                  }}
                >
                  <span className="tree-icon">📕</span> Importar PDF
                </button>
              </div>
            )}
          </div>
          <button
            className="icon-btn"
            title="Nova pasta"
            onClick={() => props.onCreateFolder("")}
          >
            🗀
          </button>
        </div>
      </div>
      <div
        className={`sidebar-tree ${dropTarget === "" ? "drop-target" : ""}`}
        onContextMenu={(e) => openMenu(e, null)}
        onDragOver={(e) => allowDrop(e, "")}
        onDragLeave={() => setDropTarget(null)}
        onDrop={(e) => handleDrop(e, "")}
      >
        {tree_or_empty(props.tree, renderNode)}
      </div>

      {menu && (
        <div className="context-menu" style={{ top: menu.y, left: menu.x }}>
          {menu.node?.type === "file" && (
            <>
              <button onClick={() => props.onOpenFile(menu.node!.path)}>
                Abrir
              </button>
              <button onClick={() => props.onStartRename(menu.node!.path)}>
                Renomear
              </button>
              <button onClick={() => props.onDuplicate(menu.node!.path)}>
                Duplicar
              </button>
              <button
                className="danger"
                onClick={() => props.onDelete(menu.node!)}
              >
                Excluir
              </button>
            </>
          )}
          {menu.node?.type === "folder" && (
            <>
              <button onClick={() => props.onCreateFile(menuDir, "excalidraw")}>
                Novo desenho
              </button>
              <button onClick={() => props.onCreateFile(menuDir, "markdown")}>
                Novo markdown
              </button>
              <button onClick={() => props.onImportPdf(menuDir)}>
                Importar PDF
              </button>
              <button onClick={() => props.onCreateFolder(menuDir)}>
                Nova subpasta
              </button>
              <button onClick={() => props.onStartRename(menu.node!.path)}>
                Renomear
              </button>
              <button
                className="danger"
                onClick={() => props.onDelete(menu.node!)}
              >
                Excluir
              </button>
            </>
          )}
          {menu.node == null && (
            <>
              <button onClick={() => props.onCreateFile("", "excalidraw")}>
                Novo desenho
              </button>
              <button onClick={() => props.onCreateFile("", "markdown")}>
                Novo markdown
              </button>
              <button onClick={() => props.onImportPdf("")}>
                Importar PDF
              </button>
              <button onClick={() => props.onCreateFolder("")}>
                Nova pasta
              </button>
            </>
          )}
        </div>
      )}
    </aside>
  );
}

function tree_or_empty(
  tree: TreeNode[],
  renderNode: (node: TreeNode, depth: number) => React.ReactNode,
) {
  if (tree.length === 0) {
    return <div className="tree-empty">Nenhum arquivo em ./uploads</div>;
  }
  return tree.map((node) => renderNode(node, 0));
}

function RenameInput({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      className="rename-input"
      defaultValue={initial}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          const value = ref.current?.value.trim();
          value ? onSubmit(value) : onCancel();
        }
        if (e.key === "Escape") onCancel();
      }}
      onBlur={() => {
        const value = ref.current?.value.trim();
        value && value !== initial ? onSubmit(value) : onCancel();
      }}
    />
  );
}

import { useEffect, useState } from "react";
import { stripExt, type SaveStatus, type Tab } from "../types";

const STATUS_TITLE: Record<SaveStatus, string> = {
  saved: "Salvo",
  dirty: "Alterações pendentes",
  saving: "Salvando...",
  error: "Erro ao salvar",
};

type TabBarProps = {
  tabs: Tab[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onCloseOthers: (path: string) => void;
  onCloseAll: () => void;
};

export function TabBar(props: TabBarProps) {
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(
    null,
  );

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  return (
    <div className="tabbar">
      {props.tabs.map((tab) => (
        <div
          key={tab.path}
          className={`tab ${tab.path === props.activePath ? "active" : ""}`}
          title={
            tab.status === "error" && tab.errorMessage
              ? `${tab.path} — ${tab.errorMessage}`
              : tab.path
          }
          onClick={() => props.onSelect(tab.path)}
          onAuxClick={(e) => e.button === 1 && props.onClose(tab.path)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, path: tab.path });
          }}
        >
          <span
            className={`tab-status ${tab.status}`}
            title={STATUS_TITLE[tab.status]}
          />
          <span className="tab-name">{stripExt(tab.name)}</span>
          <button
            className="tab-close"
            title="Fechar"
            onClick={(e) => {
              e.stopPropagation();
              props.onClose(tab.path);
            }}
          >
            ×
          </button>
        </div>
      ))}

      {menu && (
        <div className="context-menu" style={{ top: menu.y, left: menu.x }}>
          <button onClick={() => props.onClose(menu.path)}>Fechar</button>
          <button onClick={() => props.onCloseOthers(menu.path)}>
            Fechar outras
          </button>
          <button onClick={() => props.onCloseAll()}>Fechar todas</button>
        </div>
      )}
    </div>
  );
}

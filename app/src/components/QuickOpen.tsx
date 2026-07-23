import { useEffect, useMemo, useRef, useState } from "react";
import { fileIcon, stripExt, type TreeNode } from "../types";

/** Teto de resultados exibidos: além disso a lista deixa de ser útil. */
const MAX_RESULTS = 50;

type Result = {
  path: string;
  /** Caminho sem extensão — é sobre ele que o casamento fuzzy roda. */
  target: string;
  /** Índice em `target` onde começa o nome do arquivo (fim das pastas). */
  nameStart: number;
  /** Posições de `target` que casaram com a query (para destacar). */
  matched: Set<number>;
  score: number;
};

type QuickOpenProps = {
  tree: TreeNode[];
  onSelect: (path: string) => void;
  onClose: () => void;
};

/** Percorre a árvore em profundidade e devolve só os arquivos. */
function flattenFiles(tree: TreeNode[]): TreeNode[] {
  const files: TreeNode[] = [];
  const walk = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (node.type === "folder") walk(node.children ?? []);
      else files.push(node);
    }
  };
  walk(tree);
  return files;
}

/**
 * Casamento fuzzy por subsequência: cada caractere da query precisa aparecer
 * em `target`, na ordem. Pontua mais alto trechos contíguos, inícios de
 * palavra e acertos no nome do arquivo (em vez de nas pastas do caminho).
 */
function fuzzyMatch(
  query: string,
  target: string,
  nameStart: number,
): { matched: Set<number>; score: number } | null {
  const lower = target.toLowerCase();
  const matched = new Set<number>();
  let score = 0;
  let previous = -1;
  let from = 0;

  for (const char of query) {
    const at = lower.indexOf(char, from);
    if (at === -1) return null;
    if (at === previous + 1) score += 8; // continua a sequência anterior
    else if (at === 0 || /[\s\-_/.]/.test(lower[at - 1])) score += 5;
    else score += 1;
    if (at >= nameStart) score += 3; // acerto no nome vale mais que na pasta
    matched.add(at);
    previous = at;
    from = at + 1;
  }

  // desempate: prefere casar cedo e em caminhos curtos
  return { matched, score: score - previous * 0.1 - target.length * 0.05 };
}

function search(files: TreeNode[], query: string): Result[] {
  const results: Result[] = [];
  const normalized = query.trim().toLowerCase();

  for (const file of files) {
    const target = stripExt(file.path);
    const nameStart = target.lastIndexOf("/") + 1;
    if (!normalized) {
      results.push({
        path: file.path,
        target,
        nameStart,
        matched: new Set(),
        score: 0,
      });
      continue;
    }
    const match = fuzzyMatch(normalized, target, nameStart);
    if (match) results.push({ path: file.path, target, nameStart, ...match });
  }

  results.sort((a, b) =>
    b.score !== a.score ? b.score - a.score : a.target.localeCompare(b.target),
  );
  return results.slice(0, MAX_RESULTS);
}

/** Quebra o texto em trechos casados/não casados para destacar os acertos. */
function highlight(text: string, matched: Set<number>, offset: number) {
  const parts: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const hit = matched.has(i + offset);
    const last = parts[parts.length - 1];
    if (last && last.hit === hit) last.text += text[i];
    else parts.push({ text: text[i], hit });
  }
  return parts.map((part, i) =>
    part.hit ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>,
  );
}

export function QuickOpen({ tree, onSelect, onClose }: QuickOpenProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const files = useMemo(() => flattenFiles(tree), [tree]);
  const results = useMemo(() => search(files, query), [files, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // a lista muda a cada tecla digitada: volta a seleção para o topo
  useEffect(() => {
    setSelected(0);
  }, [query]);

  // mantém o item selecionado visível ao navegar pelas setas
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const move = (delta: number) => {
    if (results.length === 0) return;
    setSelected((i) => (i + delta + results.length) % results.length);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // impede que a digitação chegue aos atalhos do editor por baixo do modal
    e.stopPropagation();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const result = results[selected];
      if (result) onSelect(result.path);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="quick-open-overlay" onMouseDown={onClose}>
      <div
        className="quick-open"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <input
          ref={inputRef}
          className="quick-open-input"
          type="text"
          spellCheck={false}
          placeholder="Buscar arquivo pelo nome…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {results.length === 0 ? (
          <div className="quick-open-empty">Nenhum arquivo encontrado</div>
        ) : (
          <div className="quick-open-results" ref={listRef}>
            {results.map((result, i) => {
              const dir = result.target.slice(0, result.nameStart);
              const name = result.target.slice(result.nameStart);
              return (
                <div
                  key={result.path}
                  className={`quick-open-item ${i === selected ? "selected" : ""}`}
                  data-selected={i === selected}
                  title={result.path}
                  onMouseMove={() => setSelected(i)}
                  onClick={() => onSelect(result.path)}
                >
                  <span className="tree-icon">{fileIcon(result.path)}</span>
                  <span className="quick-open-name">
                    {highlight(name, result.matched, result.nameStart)}
                  </span>
                  {dir && (
                    <span className="quick-open-dir">
                      {highlight(dir, result.matched, 0)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

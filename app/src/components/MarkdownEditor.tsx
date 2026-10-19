import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

type Mode = "edit" | "split" | "preview";

type MarkdownEditorProps = {
  /** Chave única do arquivo — o componente é remontado (key) a cada troca. */
  path: string;
  initialText: string;
  onChange: (text: string) => void;
  /** Recebe o HTML já estilizado para exportação; resolve quando concluído. */
  onExportPdf: (html: string, title: string) => void | Promise<void>;
};

type Edit = { text: string; start: number; end: number };

marked.setOptions({ gfm: true, breaks: true });

// links abrem no navegador padrão (interceptado pelo main via will-navigate);
// abrir em nova aba evita navegar a própria janela do app
function renderMarkdown(src: string): string {
  const raw = marked.parse(src, { async: false }) as string;
  const clean = DOMPurify.sanitize(raw, { ADD_ATTR: ["target"] });
  return clean;
}

function lineBounds(text: string, start: number, end: number) {
  const from = text.lastIndexOf("\n", Math.max(0, start) - 1) + 1;
  let to = text.indexOf("\n", end);
  if (to === -1) to = text.length;
  if (end > start && text[end - 1] === "\n") to = end - 1;
  return { from, to, lines: text.slice(from, to).split("\n") };
}

function replaceRange(
  text: string,
  from: number,
  to: number,
  block: string,
  start: number,
  end: number,
): Edit {
  return {
    text: text.slice(0, from) + block + text.slice(to),
    start,
    end,
  };
}

function applyHeading(
  text: string,
  start: number,
  end: number,
  level: number,
  placeholder: string,
): Edit {
  const { from, to, lines } = lineBounds(text, start, end);
  const prefix = `${"#".repeat(level)} `;
  const mapped = lines.map((line) => {
    const body = line.replace(/^#{1,6}\s+/, "");
    return prefix + (body || placeholder);
  });
  const block = mapped.join("\n");
  if (lines.length === 1) {
    const body = lines[0].replace(/^#{1,6}\s+/, "") || placeholder;
    const sel = from + prefix.length;
    return replaceRange(text, from, to, block, sel, sel + body.length);
  }
  return replaceRange(text, from, to, block, from, from + block.length);
}

function applyPrefix(
  text: string,
  start: number,
  end: number,
  format: (line: string, index: number) => string,
): Edit {
  const { from, to, lines } = lineBounds(text, start, end);
  const mapped = lines.map((line, index) => {
    if (line.trim() === "" && lines.length > 1) return line;
    return format(line, index);
  });
  const block = mapped.join("\n");
  return replaceRange(text, from, to, block, from, from + block.length);
}

function wrap(
  text: string,
  start: number,
  end: number,
  before: string,
  after: string,
  placeholder: string,
): Edit {
  const selected = text.slice(start, end);
  const inner = selected || placeholder;
  const next = text.slice(0, start) + before + inner + after + text.slice(end);
  const sel = start + before.length;
  return { text: next, start: sel, end: sel + inner.length };
}

function applyLink(text: string, start: number, end: number): Edit {
  const label = text.slice(start, end) || "texto";
  const url = "https://";
  const snippet = `[${label}](${url})`;
  const next = text.slice(0, start) + snippet + text.slice(end);
  const urlStart = start + label.length + 3;
  return { text: next, start: urlStart, end: urlStart + url.length };
}

function insertBlock(
  text: string,
  start: number,
  end: number,
  block: string,
  innerStart: number,
  innerEnd: number,
): Edit {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const padBefore =
    before.length === 0 || before.endsWith("\n\n")
      ? ""
      : before.endsWith("\n")
        ? "\n"
        : "\n\n";
  const padAfter =
    after.length === 0 || after.startsWith("\n\n")
      ? ""
      : after.startsWith("\n")
        ? "\n"
        : "\n\n";
  const next = before + padBefore + block + padAfter + after;
  const base = before.length + padBefore.length;
  return { text: next, start: base + innerStart, end: base + innerEnd };
}

function applyCodeBlock(text: string, start: number, end: number): Edit {
  const inner = text.slice(start, end) || "código";
  const block = "```\n" + inner + "\n```";
  return insertBlock(text, start, end, block, 4, 4 + inner.length);
}

function markdownImage(alt: string, src: string): string {
  const safeAlt = alt.replace(/[\[\]]/g, "");
  const target = /[\s()]/.test(src) ? `<${src}>` : src;
  return `![${safeAlt}](${target})`;
}

// Estilo autônomo do PDF: cores fixas (claro), independente do tema do app,
// espelhando a tipografia do preview (.markdown-body).
const PDF_STYLES = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    color: #1f2328;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      Helvetica, Arial, sans-serif;
    font-size: 15px;
    line-height: 1.7;
    word-wrap: break-word;
  }
  .markdown-body > *:first-child { margin-top: 0; }
  h1, h2, h3, h4 { margin: 1.4em 0 0.5em; line-height: 1.3; font-weight: 600; }
  h1 { font-size: 1.8em; padding-bottom: 0.3em; border-bottom: 1px solid #d0d7de; }
  h2 { font-size: 1.45em; padding-bottom: 0.3em; border-bottom: 1px solid #d0d7de; }
  h3 { font-size: 1.2em; }
  p, ul, ol, blockquote, table { margin: 0 0 1em; }
  ul, ol { padding-left: 1.6em; }
  li + li { margin-top: 0.25em; }
  a { color: #2563eb; text-decoration: none; }
  code {
    font-family: ui-monospace, "Cascadia Code", Menlo, Consolas, monospace;
    font-size: 0.88em;
    background: #f6f8fa;
    border: 1px solid #d0d7de;
    border-radius: 4px;
    padding: 0.12em 0.4em;
  }
  pre {
    background: #f6f8fa;
    border: 1px solid #d0d7de;
    border-radius: 8px;
    padding: 12px 14px;
    overflow-x: auto;
    margin: 0 0 1em;
    white-space: pre-wrap;
  }
  pre code { background: transparent; border: none; padding: 0; font-size: 0.85em; }
  blockquote {
    border-left: 3px solid #d0d7de;
    padding: 0.2em 0 0.2em 1em;
    color: #656d76;
    margin: 0 0 1em;
  }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #d0d7de; padding: 6px 12px; }
  th { background: #f6f8fa; font-weight: 600; }
  hr { border: none; border-top: 1px solid #d0d7de; margin: 1.5em 0; }
  img { max-width: 100%; }
  /* evita cortar blocos entre páginas quando possível */
  pre, blockquote, table, img { page-break-inside: avoid; }
  h1, h2, h3, h4 { page-break-after: avoid; }
`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Monta um documento HTML completo e autônomo para a impressão em PDF. */
function buildPdfDocument(bodyHtml: string, title: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>${escapeHtml(title)}</title><style>${PDF_STYLES}</style></head>
<body><div class="markdown-body">${bodyHtml}</div></body></html>`;
}

export function MarkdownEditor({
  path,
  initialText,
  onChange,
  onExportPdf,
}: MarkdownEditorProps) {
  const [text, setText] = useState(initialText);
  const [mode, setMode] = useState<Mode>(initialText ? "split" : "edit");
  const [exporting, setExporting] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef(text);
  const modeRef = useRef(mode);
  const selRef = useRef({ start: initialText.length, end: initialText.length });
  const pendingSel = useRef<{ start: number; end: number } | null>(null);
  textRef.current = text;
  modeRef.current = mode;

  useEffect(() => {
    if (mode !== "preview") textareaRef.current?.focus();
  }, [mode]);

  useLayoutEffect(() => {
    const sel = pendingSel.current;
    if (!sel || mode === "preview") return;
    const ta = textareaRef.current;
    if (!ta) return;
    pendingSel.current = null;
    ta.focus();
    ta.setSelectionRange(sel.start, sel.end);
    selRef.current = sel;
  }, [text, mode]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (mode === "edit") return;
    const rendered = renderMarkdown(text);
    setPreviewHtml(rendered);
    let cancelled = false;
    window.api
      .inlineMarkdownImages(path, rendered)
      .then((inlined) => {
        if (!cancelled) setPreviewHtml(inlined);
      })
      .catch(() => {
        if (!cancelled) setPreviewHtml(rendered);
      });
    return () => {
      cancelled = true;
    };
  }, [text, mode, path]);

  const rememberSelection = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    selRef.current = { start: ta.selectionStart, end: ta.selectionEnd };
  };

  const handleInput = (value: string) => {
    setText(value);
    onChange(value);
  };

  const selection = () => {
    const current = textRef.current;
    const ta = textareaRef.current;
    if (ta && modeRef.current !== "preview") {
      return { text: current, start: ta.selectionStart, end: ta.selectionEnd };
    }
    return {
      text: current,
      start: Math.min(selRef.current.start, current.length),
      end: Math.min(selRef.current.end, current.length),
    };
  };

  const commit = (next: Edit) => {
    pendingSel.current = { start: next.start, end: next.end };
    selRef.current = { start: next.start, end: next.end };
    if (modeRef.current === "preview") setMode("split");
    if (next.text !== textRef.current) {
      textRef.current = next.text;
      setText(next.text);
      onChange(next.text);
      return;
    }
    const ta = textareaRef.current;
    if (ta && modeRef.current !== "preview") {
      pendingSel.current = null;
      ta.focus();
      ta.setSelectionRange(next.start, next.end);
    }
  };

  const run = (edit: (text: string, start: number, end: number) => Edit) => {
    const { text: current, start, end } = selection();
    commit(edit(current, start, end));
  };

  const handleImage = async () => {
    if (attaching) return;
    const { text: current, start, end } = selection();
    setAttaching(true);
    setNotice(null);
    try {
      const attached = await window.api.attachMarkdownImage(path);
      if (!attached) return;
      const latest = textRef.current;
      const s = current === latest ? start : Math.min(start, latest.length);
      const e = current === latest ? end : Math.min(end, latest.length);
      const snippet = markdownImage(attached.alt, attached.src);
      commit(insertBlock(latest, s, e, snippet, snippet.length, snippet.length));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setNotice(message || "Não foi possível anexar a imagem");
    } finally {
      setAttaching(false);
    }
  };

  const title = path.split("/").pop()?.replace(/\.md$/, "") ?? "documento";

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const doc = buildPdfDocument(renderMarkdown(text), title);
      await onExportPdf(doc, title);
    } finally {
      setExporting(false);
    }
  };

  const tools: { label: string; title: string; onClick: () => void }[] = [
    {
      label: "H1",
      title: "Título",
      onClick: () => run((t, s, e) => applyHeading(t, s, e, 1, "Título")),
    },
    {
      label: "H2",
      title: "Subtítulo",
      onClick: () => run((t, s, e) => applyHeading(t, s, e, 2, "Subtítulo")),
    },
    {
      label: "H3",
      title: "Seção",
      onClick: () => run((t, s, e) => applyHeading(t, s, e, 3, "Seção")),
    },
    {
      label: "N",
      title: "Negrito",
      onClick: () => run((t, s, e) => wrap(t, s, e, "**", "**", "negrito")),
    },
    {
      label: "I",
      title: "Itálico",
      onClick: () => run((t, s, e) => wrap(t, s, e, "*", "*", "itálico")),
    },
    {
      label: "S",
      title: "Riscado",
      onClick: () => run((t, s, e) => wrap(t, s, e, "~~", "~~", "riscado")),
    },
    {
      label: "</>",
      title: "Código",
      onClick: () => run((t, s, e) => wrap(t, s, e, "`", "`", "código")),
    },
    {
      label: "```",
      title: "Bloco de código",
      onClick: () => run(applyCodeBlock),
    },
    {
      label: "“”",
      title: "Citação",
      onClick: () =>
        run((t, s, e) =>
          applyPrefix(t, s, e, (line) => {
            const body = line.replace(/^>\s?/, "");
            return `> ${body || "citação"}`;
          }),
        ),
    },
    {
      label: "•",
      title: "Lista",
      onClick: () =>
        run((t, s, e) =>
          applyPrefix(t, s, e, (line) => {
            const body = line.replace(/^[-*+]\s+/, "");
            return `- ${body || "item"}`;
          }),
        ),
    },
    {
      label: "1.",
      title: "Lista numerada",
      onClick: () =>
        run((t, s, e) => {
          let n = 0;
          return applyPrefix(t, s, e, (line) => {
            const body = line.replace(/^\d+\.\s+/, "");
            n += 1;
            return `${n}. ${body || "item"}`;
          });
        }),
    },
    {
      label: "Link",
      title: "Link",
      onClick: () => run(applyLink),
    },
    {
      label: "—",
      title: "Linha horizontal",
      onClick: () => run((t, s, e) => insertBlock(t, s, e, "---", 3, 3)),
    },
    {
      label: "Tabela",
      title: "Tabela",
      onClick: () =>
        run((t, s, e) =>
          insertBlock(
            t,
            s,
            e,
            "| Coluna 1 | Coluna 2 |\n| --- | --- |\n|  |  |",
            2,
            10,
          ),
        ),
    },
  ];

  return (
    <div className="md-editor">
      <div className="md-toolbar">
        <div className="md-modes">
          {(["edit", "split", "preview"] as Mode[]).map((m) => (
            <button
              key={m}
              className={mode === m ? "selected" : ""}
              onClick={() => setMode(m)}
            >
              {m === "edit" ? "Editar" : m === "split" ? "Dividir" : "Visualizar"}
            </button>
          ))}
        </div>
        <button
          className="md-export-btn"
          onClick={handleExport}
          disabled={exporting}
          title="Exportar este documento como PDF"
        >
          {exporting ? "Exportando…" : "Exportar PDF"}
        </button>
      </div>
      <div className="md-insert">
        {tools.slice(0, 3).map((tool) => (
          <button
            key={tool.title}
            type="button"
            title={tool.title}
            onMouseDown={(e) => e.preventDefault()}
            onClick={tool.onClick}
          >
            {tool.label}
          </button>
        ))}
        <span className="md-insert-sep" />
        {tools.slice(3, 8).map((tool) => (
          <button
            key={tool.title}
            type="button"
            title={tool.title}
            onMouseDown={(e) => e.preventDefault()}
            onClick={tool.onClick}
          >
            {tool.label}
          </button>
        ))}
        <span className="md-insert-sep" />
        {tools.slice(8).map((tool) => (
          <button
            key={tool.title}
            type="button"
            title={tool.title}
            onMouseDown={(e) => e.preventDefault()}
            onClick={tool.onClick}
          >
            {tool.label}
          </button>
        ))}
        <button
          type="button"
          title="Anexar imagem"
          disabled={attaching}
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleImage}
        >
          {attaching ? "…" : "Imagem"}
        </button>
        {notice && <span className="md-insert-notice">{notice}</span>}
      </div>
      <div className={`md-panes ${mode}`}>
        {mode !== "preview" && (
          <textarea
            ref={textareaRef}
            className="md-input"
            value={text}
            spellCheck={false}
            placeholder="# Escreva em Markdown…"
            onChange={(e) => {
              handleInput(e.target.value);
              rememberSelection();
            }}
            onSelect={rememberSelection}
            onKeyUp={rememberSelection}
            onMouseUp={rememberSelection}
          />
        )}
        {mode !== "edit" && (
          <div
            className="md-preview markdown-body"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        )}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
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

marked.setOptions({ gfm: true, breaks: true });

// links abrem no navegador padrão (interceptado pelo main via will-navigate);
// abrir em nova aba evita navegar a própria janela do app
function renderMarkdown(src: string): string {
  const raw = marked.parse(src, { async: false }) as string;
  const clean = DOMPurify.sanitize(raw, { ADD_ATTR: ["target"] });
  return clean;
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (mode !== "preview") textareaRef.current?.focus();
  }, [mode]);

  const html = useMemo(
    () => (mode === "edit" ? "" : renderMarkdown(text)),
    [text, mode],
  );

  const handleInput = (value: string) => {
    setText(value);
    onChange(value);
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
      <div className={`md-panes ${mode}`}>
        {mode !== "preview" && (
          <textarea
            ref={textareaRef}
            className="md-input"
            value={text}
            spellCheck={false}
            placeholder="# Escreva em Markdown…"
            onChange={(e) => handleInput(e.target.value)}
          />
        )}
        {mode !== "edit" && (
          <div
            className="md-preview markdown-body"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </div>
  );
}

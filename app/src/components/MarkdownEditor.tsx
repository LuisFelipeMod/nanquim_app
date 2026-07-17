import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

type Mode = "edit" | "split" | "preview";

type MarkdownEditorProps = {
  /** Chave única do arquivo — o componente é remontado (key) a cada troca. */
  path: string;
  initialText: string;
  onChange: (text: string) => void;
};

marked.setOptions({ gfm: true, breaks: true });

// links abrem no navegador padrão (interceptado pelo main via will-navigate);
// abrir em nova aba evita navegar a própria janela do app
function renderMarkdown(src: string): string {
  const raw = marked.parse(src, { async: false }) as string;
  const clean = DOMPurify.sanitize(raw, { ADD_ATTR: ["target"] });
  return clean;
}

export function MarkdownEditor({
  initialText,
  onChange,
}: MarkdownEditorProps) {
  const [text, setText] = useState(initialText);
  const [mode, setMode] = useState<Mode>(initialText ? "split" : "edit");
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

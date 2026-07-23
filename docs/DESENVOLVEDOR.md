# Guia do Desenvolvedor — Nanquim

Documentação técnica do Nanquim: arquitetura, ambiente de desenvolvimento,
API IPC e processo de build.

---

## 1. Stack

| Camada | Tecnologia |
|--------|------------|
| Runtime desktop | [Electron](https://www.electronjs.org/) 33 |
| UI (renderer) | [React](https://react.dev/) 19 + TypeScript |
| Bundler / dev server | [Vite](https://vitejs.dev/) 5 |
| Editor de desenho | [`@excalidraw/excalidraw`](https://github.com/excalidraw/excalidraw) (git submodule) |
| Markdown | [`marked`](https://marked.js.org/) + [`DOMPurify`](https://github.com/cure53/DOMPurify) |
| PDF | [`pdfjs-dist`](https://github.com/mozilla/pdf.js) |
| Empacotamento | [`electron-builder`](https://www.electron.build/) |

Requer **Node.js 20+**.

---

## 2. Estrutura do repositório

```
.
├── app/                      # Aplicação Electron
│   ├── electron/             # Processo principal (Node.js)
│   │   ├── main.js           # Janela, IPC, sistema de arquivos, watcher
│   │   ├── preload.js        # Ponte contextBridge (window.api)
│   │   ├── googleAuth.js     # OAuth Google (login)
│   │   ├── driveSync.js      # Upload para o Google Drive
│   │   └── gitSync.js        # add/commit/push da pasta de documentos
│   ├── src/                  # Renderer (React)
│   │   ├── App.tsx           # Componente raiz: estado global, abas, IPC
│   │   ├── main.tsx          # Entry point React
│   │   ├── types.ts          # Tipos compartilhados + tipagem de window.api
│   │   ├── styles.css
│   │   └── components/
│   │       ├── Sidebar.tsx        # Árvore de arquivos, menu de contexto, DnD
│   │       ├── TabBar.tsx         # Barra de abas
│   │       ├── MarkdownEditor.tsx # Editor + preview Markdown
│   │       ├── PdfEditor.tsx      # Visualizador PDF + camada de anotações
│   │       └── QuickOpen.tsx      # Busca rápida (Ctrl/Cmd+P)
│   ├── index.html
│   ├── vite.config.mts       # Aliases para os pacotes do Excalidraw
│   ├── tsconfig.json
│   └── package.json
├── external/excalidraw/      # Submódulo: código-fonte do Excalidraw
├── uploads/                  # Pasta de documentos em desenvolvimento
└── docs/                     # Esta documentação
```

> **Nota sobre `external/excalidraw`**: é uma dependência via *git submodule* e
> **não deve ser modificada in-place**, para permitir atualizar do upstream. O
> Vite resolve os pacotes do monorepo (`common`, `element`, `excalidraw`,
> `math`, …) direto do código-fonte via aliases em `vite.config.mts` — apenas
> os pacotes necessários são consumidos; `excalidraw-app`, `firebase-project` e
> `examples` não fazem parte do build.

---

## 3. Ambiente de desenvolvimento

```bash
# 1. Clonar com o submódulo do Excalidraw
git clone --recurse-submodules <url> nanquim
cd nanquim

# (se já clonou sem o submódulo)
git submodule update --init

# 2. Instalar dependências
cd app
npm install

# 3. Rodar em modo desenvolvimento
npm run dev
```

O script `dev` sobe o Vite em `http://localhost:5173` e, quando a porta está
pronta, inicia o Electron apontando para esse servidor
(`VITE_DEV_SERVER_URL`) — com hot reload no renderer.

### Scripts npm (em `app/`)

| Script | O que faz |
|--------|-----------|
| `npm run dev` | Vite + Electron em modo desenvolvimento (hot reload) |
| `npm run build` | Build de produção do renderer (Vite → `dist/`) |
| `npm start` | Build + roda o Electron sobre o bundle de produção |
| `npm run dist` | Build + empacota com `electron-builder` (→ `release/`) |

---

## 4. Variáveis de ambiente

As credenciais do Google **não** ficam versionadas. Copie o exemplo e preencha
os valores locais:

```bash
cp app/.env.example app/.env.local
```

| Variável | Descrição |
|----------|-----------|
| `VITE_APP_LIBRARY_URL` | URL da biblioteca do Excalidraw |
| `VITE_APP_LIBRARY_BACKEND` | Backend da biblioteca |
| `GOOGLE_CLIENT_ID` | Client OAuth (tipo *Desktop app*) do Google Cloud |
| `GOOGLE_CLIENT_SECRET` | Secret correspondente |

`.env.example` é versionado com os campos sensíveis vazios; os valores reais
vão em `.env.local` (fora do versionamento). Sem as credenciais do Google, o
login aparece como `configured: false` para o renderer e a UI desabilita a
funcionalidade.

---

## 5. Arquitetura de processos

O Nanquim segue o modelo padrão de segurança do Electron.

```
┌──────────────────────────────┐     IPC      ┌───────────────────────────┐
│  Renderer (React)            │  invoke/on   │  Main process (Node.js)   │
│  - Sem acesso a Node/fs      │ ───────────▶ │  - fs, dialog, net        │
│  - window.api (contextBridge)│ ◀─────────── │  - watcher, sync, OAuth   │
└──────────────────────────────┘   fs:changed └───────────────────────────┘
```

### Garantias de segurança
- `contextIsolation: true`, `nodeIntegration: false` na `BrowserWindow`
  (`main.js`).
- O renderer nunca toca em `fs` diretamente — tudo passa por IPC.
- `preload.js` expõe uma superfície mínima em `window.api` via `contextBridge`.
- **Path traversal**: todo caminho recebido do renderer passa por `safePath()`,
  que resolve dentro de `uploadsRoot` e rejeita qualquer tentativa de escapar
  da pasta de documentos.
- **Escrita atômica**: gravações usam arquivo temporário + rename, evitando
  corrupção em caso de falha durante o save.

### Pasta de documentos (`uploadsRoot`)
- **Dev**: `../uploads` (raiz do projeto).
- **Empacotado**: `~/Documentos/Nanquim` (`app.getPath("documents")`), já que o
  bundle do AppImage é somente-leitura.
- Pode ser trocada em runtime; o override é persistido em `config.json`
  (`app.getPath("userData")`), e o *file watcher* é recriado apontando para a
  nova pasta.

---

## 6. API IPC (`window.api`)

Definida em `preload.js` e tipada em [`src/types.ts`](../app/src/types.ts)
(`ElectronAPI`). Handlers correspondentes ficam em `main.js`.

### Sistema de arquivos
| `window.api` | Canal IPC | Descrição |
|--------------|-----------|-----------|
| `getTree()` | `fs:tree` | Árvore de arquivos/pastas de `uploadsRoot` |
| `readFile(rel)` | `fs:read` | Lê arquivo de texto (UTF-8) |
| `readBinary(rel)` | `fs:read-binary` | Lê binário (PDF) em base64 |
| `writeFile(rel, content)` | `fs:write` | Escrita atômica |
| `createFile(dirRel, kind)` | `fs:create-file` | Cria `.excalidraw`/`.md` |
| `createFolder(dirRel)` | `fs:create-folder` | Cria subpasta |
| `renameEntry(rel, name)` | `fs:rename` | Renomeia arquivo/pasta |
| `moveEntry(src, destDir)` | `fs:move` | Move (drag-and-drop) |
| `deleteEntry(rel)` | `fs:delete` | Exclui arquivo/pasta |
| `duplicateFile(rel)` | `fs:duplicate` | Duplica arquivo |
| `onFsChanged(cb)` | `fs:changed` | Notificação do watcher (retorna unsubscribe) |

### Pasta de documentos
| `window.api` | Canal | Descrição |
|--------------|-------|-----------|
| `getDir()` | `dir:get` | Pasta atual + se é a padrão |
| `chooseDir()` | `dir:choose` | Diálogo nativo de seleção |
| `resetDir()` | `dir:reset` | Volta à pasta padrão |

### PDF
| `window.api` | Canal | Descrição |
|--------------|-------|-----------|
| `importPdf(dirRel)` | `pdf:import` | Diálogo + copia PDF para a pasta |
| `readPdfAnnots(rel)` | `pdf:read-annots` | Lê anotações (sidecar) |
| `writePdfAnnots(rel, json)` | `pdf:write-annots` | Grava anotações |

As anotações ficam em um sidecar oculto `.<arquivo>.pdf.annots` ao lado do PDF
(o PDF nunca é modificado); `moveSidecar()` mantém as anotações junto ao mover
ou renomear o PDF.

### Markdown / Biblioteca / Janela
| `window.api` | Canal | Descrição |
|--------------|-------|-----------|
| `exportMarkdownPdf(rel, html)` | `md:export-pdf` | Exporta HTML renderizado como PDF |
| `libraryGet()` / `librarySave(json)` | `library:get` / `library:save` | Biblioteca global do Excalidraw |
| `onLibraryAdd(cb)` / `onLibraryAddError(cb)` | `library:add` / `library:add-error` | Itens adicionados da biblioteca online |
| `windowMinimize/ToggleMaximize/Close()` | `window:*` | Controles da janela |

### Sincronização
| `window.api` | Canal | Descrição |
|--------------|-------|-----------|
| `auth.login/logout/status()` | `auth:*` | OAuth Google (`googleAuth.js`) |
| `drive.push(rel)` | `drive:push` | Upload do documento (`driveSync.js`) |
| `git.getConfig/setConfig(cfg)` | `git:get-config` / `git:set-config` | Config `{ remoteUrl, branch }` |
| `git.status()` | `git:status` | Estado do repo (pendências, último commit) |
| `git.sync()` | `git:sync` | `add` + `commit` (data/hora) + `push` |

---

## 7. Estado do renderer

`App.tsx` centraliza o estado da aplicação:

- `tree` — árvore de arquivos (recarregada em `onFsChanged`).
- `tabs` + `activePath` — abas abertas e a ativa; cada aba tem um `SaveStatus`
  (`saved` / `dirty` / `saving` / `error`).
- Conteúdo por documento é mantido em `useRef` (cenas Excalidraw, textos
  Markdown, etc.) para evitar re-renders desnecessários.
- `theme` (claro/escuro, segue o sistema), `settingsOpen`, `quickOpenOpen`,
  `googleAuth`, `dirInfo`.

O atalho **`Ctrl/Cmd + P`** é registrado no `window` na fase de *captura* para
interceptar antes dos handlers internos do canvas do Excalidraw.

---

## 8. Build e distribuição

Os artefatos são gerados em `app/release/`. A configuração está em
`package.json` → `build`, com um alvo por sistema operacional:

| Sistema | Alvos | Arquivo gerado |
|---------|-------|----------------|
| Linux | `AppImage`, `deb` | `.AppImage`, `.deb` |
| Windows | `nsis` | instalador `.exe` (permite escolher a pasta) |
| macOS | `dmg`, `zip` | `.dmg`, `.zip` |

Os ícones `.ico` (Windows) e `.icns` (macOS) são gerados automaticamente a
partir de `build/icon.png` (512×512).

### Scripts

| Script | Alvo |
|--------|------|
| `npm run dist` | SO atual (padrão do electron-builder) |
| `npm run dist:linux` | Linux |
| `npm run dist:win` | Windows |
| `npm run dist:mac` | macOS |
| `npm run dist:all` | Linux + Windows + macOS (`-mwl`) |

### Limitações de cross-compilation

O electron-builder empacota **para o SO em que roda**. Gerar para outro SO tem
restrições:

- **macOS**: o alvo `dmg`/`mac` **só pode ser construído no macOS** (ferramentas
  e assinatura da Apple). Não é possível a partir de Linux/Windows.
- **Windows a partir do Linux**: exige o **Wine** instalado
  (`sudo apt install wine`); sem ele, o build NSIS falha.
- **Linux**: gera nativamente em Linux.

> **Recomendado**: para produzir os três de forma confiável, use CI com uma
> *matrix* de sistemas operacionais (ex.: GitHub Actions rodando
> `ubuntu-latest`, `windows-latest` e `macos-latest`), cada um executando o
> `dist` do seu próprio SO e publicando os artefatos em uma Release.

### Release automatizada (GitHub Actions)

O workflow [`.github/workflows/release.yml`](../.github/workflows/release.yml)
gera os instaladores dos três sistemas e os anexa a uma GitHub Release. Ele:

1. Faz checkout **com o submódulo** do Excalidraw (`submodules: recursive`).
2. Roda `yarn install` em `external/excalidraw` (o editor é compilado do
   código-fonte, então suas dependências precisam estar no `node_modules` do
   submódulo).
3. Roda `npm ci` + `npm run dist` em `app/` no runner de cada SO.
4. Publica `.AppImage`/`.deb`/`.exe`/`.dmg`/`.zip` na Release.

Para disparar, basta criar e enviar uma tag de versão:

```bash
git tag v0.1.0
git push p v0.1.0   # "p" é o nome do remote deste repositório
```

> O macOS é buildado **sem assinatura** (`CSC_IDENTITY_AUTO_DISCOVERY=false`);
> usuários verão um aviso do Gatekeeper. Para assinar/notarizar, configure um
> certificado Apple Developer e as secrets correspondentes no repositório.

---

## 9. Atualizando o Excalidraw

Como `external/excalidraw` é um submódulo, atualizar significa apontar para um
novo commit do upstream:

```bash
cd external/excalidraw
git fetch origin
git checkout <tag-ou-commit>
cd ../..
git add external/excalidraw
git commit -m "chore: atualiza submódulo Excalidraw para <versão>"
```

Depois de atualizar, verifique se os aliases em `vite.config.mts` ainda batem
com a estrutura de pacotes do monorepo.

---

## 10. Convenções

- Comentários e mensagens de commit em **PT-BR**.
- Código do renderer em **TypeScript**; processo principal em **JavaScript
  (CommonJS)**.
- Não modificar `external/excalidraw` in-place.
- Toda operação de disco a partir do renderer deve passar por um handler IPC no
  `main.js` (nunca acesso direto a `fs`).

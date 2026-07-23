# Guia do Usuário — Nanquim

O Nanquim é um aplicativo de desktop para **criar, organizar e editar** três
tipos de documento em um só lugar:

| Tipo | Extensão | O que você pode fazer |
|------|----------|-----------------------|
| Desenho Excalidraw | `.excalidraw` | Desenhar diagramas, fluxogramas, rascunhos |
| Nota Markdown | `.md` | Escrever texto formatado, com pré-visualização e exportação para PDF |
| PDF | `.pdf` | Visualizar e anotar por cima (sem alterar o PDF original) |

Todos os documentos ficam em uma **pasta local** no seu computador. Nada é
enviado para a nuvem, a menos que você ative a sincronização.

---

## 1. Instalação

Baixe o instalador do seu sistema operacional na
[página de releases](https://github.com/LuisFelipeMod/nanquim_app/releases)
(sempre a versão mais recente).

| Sistema | Arquivo para baixar |
|---------|---------------------|
| Windows | `Nanquim-Setup-*.exe` |
| macOS | `Nanquim-*.dmg` |
| Linux | `Nanquim-*.AppImage` ou `nanquim_*.deb` |

### Windows
1. Baixe o `Nanquim-Setup-*.exe`.
2. Dê um duplo clique para executar o instalador.
3. Se o **SmartScreen do Windows** aparecer ("Windows protegeu o computador"),
   clique em **Mais informações → Executar assim mesmo** — o aviso ocorre
   porque o instalador ainda não tem assinatura digital paga.
4. Siga o assistente (é possível escolher a pasta de instalação). Ao final, o
   Nanquim fica disponível no menu Iniciar.

### macOS
1. Baixe o `Nanquim-*.dmg`.
2. Abra o `.dmg` e **arraste o Nanquim para a pasta Aplicativos**.
3. Na primeira execução, como o app não é assinado pela Apple, o macOS pode
   bloqueá-lo. Para abrir:
   - Clique com o **botão direito** (ou Control+clique) no app → **Abrir** →
     confirme em **Abrir**; ou
   - Vá em **Ajustes do Sistema → Privacidade e Segurança** e clique em
     **Abrir mesmo assim**.
   > Isso só é necessário na primeira vez.

### Linux
1. Baixe o `Nanquim-*.AppImage` (portátil, roda em qualquer distribuição) ou o
   `nanquim_*.deb` (Debian/Ubuntu e derivadas).
2. Para o **AppImage**: dê permissão de execução e abra.
   ```bash
   chmod +x Nanquim-*.AppImage
   ./Nanquim-*.AppImage
   ```
3. Para o **`.deb`**:
   ```bash
   sudo dpkg -i nanquim_*.deb
   # se faltar alguma dependência:
   sudo apt-get install -f
   ```

### Onde ficam meus arquivos?
Por padrão, seus documentos ficam em uma pasta **`Nanquim`** dentro da sua
pasta de Documentos:

| Sistema | Caminho padrão |
|---------|----------------|
| Windows | `C:\Users\<você>\Documents\Nanquim` |
| macOS | `~/Documents/Nanquim` |
| Linux | `~/Documentos/Nanquim` (ou `~/Documents/Nanquim`) |

Você pode trocar essa pasta a qualquer momento nas **Configurações**
(veja a seção 7).

---

## 2. A janela principal

A tela é dividida em três áreas:

- **Barra lateral (esquerda)** — a árvore de pastas e arquivos. Pode ser
  recolhida para ganhar espaço.
- **Barra de abas (topo)** — cada documento aberto vira uma aba.
- **Editor (centro)** — muda conforme o tipo do arquivo aberto (Excalidraw,
  Markdown ou PDF).

---

## 3. Trabalhando com arquivos

### Abrir
- Clique em um arquivo na barra lateral para abri-lo em uma aba.
- Se ele já estiver aberto, o Nanquim apenas foca a aba existente.

### Criar
- Use o botão de **novo arquivo** na barra lateral para criar um desenho, uma
  nota Markdown ou uma pasta.
- Para importar um **PDF**, use a opção de importar PDF — o arquivo é copiado
  para a sua pasta de documentos.

### Renomear, mover, duplicar e excluir
- Clique com o **botão direito** em um arquivo ou pasta para abrir o menu de
  ações (renomear, duplicar, excluir).
- **Arraste e solte** arquivos entre pastas para reorganizá-los.
- Excluir um arquivo que está aberto também fecha a aba correspondente.

### Busca rápida (Quick Open)
- Pressione **`Ctrl + P`** (ou **`Cmd + P`** no macOS) para abrir a busca
  rápida.
- Digite parte do nome do arquivo e use as **setas** + **Enter** para abrir.
- Pressione **Esc** para fechar.

> A busca rápida funciona mesmo com o editor de desenho em foco.

---

## 4. Editor de desenho (Excalidraw)

Ao abrir um `.excalidraw`, você tem o editor completo do Excalidraw:
formas, texto, setas, imagens, biblioteca de componentes, etc.

- **Autosave**: suas alterações são salvas automaticamente após uma breve
  pausa. A aba mostra o estado do salvamento (*salvando…*, *salvo*, *erro*).
- **Biblioteca**: você pode adicionar itens da biblioteca oficial do
  Excalidraw; eles ficam disponíveis em todos os seus desenhos.

---

## 5. Editor de notas (Markdown)

Ao abrir um `.md`, você escreve em Markdown com pré-visualização do resultado.

- **Autosave** igual ao dos desenhos.
- **Exportar para PDF**: gera um PDF a partir da nota renderizada e permite
  escolher onde salvar.

---

## 6. Anotação de PDF

Ao abrir um `.pdf`, o documento é exibido e você pode **desenhar anotações por
cima** dele usando as ferramentas do Excalidraw.

- O **PDF original nunca é alterado**. As anotações são guardadas em um arquivo
  separado (oculto) ao lado do PDF.
- Renomear ou mover o PDF leva as anotações junto automaticamente.

---

## 7. Configurações

Abra as **Configurações** para:

- **Trocar a pasta de documentos** — escolha qualquer pasta do seu computador.
  Use *restaurar padrão* para voltar à pasta `Nanquim` em Documentos.
- **Alternar tema** claro/escuro (segue o tema do sistema por padrão).
- **Login com Google** e sincronização (veja abaixo).
- **Configurar sincronização Git** (veja abaixo).

---

## 8. Sincronização (opcional)

A sincronização é **opcional**. Sem configurá-la, seus arquivos permanecem
apenas no seu computador.

### Google Drive
1. Faça **login com sua conta Google** nas Configurações.
2. Com um documento aberto, use a ação de **enviar para o Drive** para criar ou
   atualizar a cópia no seu Google Drive.

> O login com Google só aparece disponível se o aplicativo tiver sido
> configurado com as credenciais do Google (veja o Guia do Desenvolvedor). Em
> builds sem essas credenciais, a opção fica indisponível.

### Git
1. Nas Configurações, informe a **URL do repositório** (remote) e a **branch**.
2. Use a ação de **sincronizar**: o Nanquim faz `add` + `commit` (com data e
   hora) + `push` da sua pasta de documentos.
3. O painel mostra o **status**: se é um repositório, quantas alterações estão
   pendentes e o último commit.

> Deixar a URL em branco mantém a sincronização Git **desligada**.

---

## 9. Perguntas frequentes

**Meus arquivos vão para a internet?**
Não, a menos que você ative o Google Drive ou o Git. Por padrão tudo é local.

**Consigo editar os arquivos por fora do Nanquim?**
Sim. A barra lateral detecta mudanças feitas na pasta por outros programas e
atualiza a árvore automaticamente.

**Perco meu trabalho se fechar sem salvar?**
O autosave grava suas alterações continuamente. Se um salvamento falhar, a aba
mostra um indicador de erro em vez de perder os dados silenciosamente.

**Como troco onde os arquivos ficam guardados?**
Em Configurações → trocar pasta de documentos.

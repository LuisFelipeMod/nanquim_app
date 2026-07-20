// Sincronização com um repositório Git (espelho: local -> remoto).
//
// A pasta dos documentos vira um repositório Git comum. Ao sincronizar,
// rodamos na máquina do usuário: add -> commit (com data/hora) -> push.
//
// Credenciais são responsabilidade do ambiente do usuário (SSH agent,
// credential helper do git). O prompt interativo é desligado — sem
// credencial configurada o push falha com mensagem em vez de travar o app.

const { execFile } = require("child_process");
const path = require("path");
const fsp = require("fs").promises;

const GIT_TIMEOUT_MS = 120_000;
const DEFAULT_BRANCH = "main";
// identidade usada só se o usuário não tiver user.name/user.email no git
const FALLBACK_AUTHOR_NAME = "Nanquim";
const FALLBACK_AUTHOR_EMAIL = "nanquim@localhost";

/** Ambiente que impede o git de abrir prompts interativos e travar o app. */
const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_SSH_COMMAND: "ssh -o BatchMode=yes",
  // ignora askpass gráfico herdado do ambiente
  GIT_ASKPASS: "echo",
  SSH_ASKPASS: "echo",
  LC_ALL: "C",
};

/**
 * Roda um comando git. Resolve com { code, stdout, stderr } mesmo quando o
 * git retorna código != 0 — quem chama decide se aquilo é erro (vários
 * comandos usam o código de saída como resposta, ex.: `diff --quiet`).
 */
function git(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, env: GIT_ENV, timeout: GIT_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err && typeof err.code !== "number") {
          // git ausente no PATH, timeout, etc.
          reject(
            new Error(
              err.code === "ENOENT"
                ? "git não encontrado. Instale o git para usar a sincronização."
                : `Falha ao executar git: ${err.message}`,
            ),
          );
          return;
        }
        resolve({ code: err ? err.code : 0, stdout, stderr });
      },
    );
  });
}

/** Roda um comando git exigindo sucesso; erro traz a saída do git. */
async function gitOk(args, cwd) {
  const res = await git(args, cwd);
  if (res.code !== 0) {
    const detail = (res.stderr || res.stdout || "").trim();
    throw new Error(`git ${args[0]} falhou: ${detail || `código ${res.code}`}`);
  }
  return res.stdout.trim();
}

// ---- validação da configuração -----------------------------------------

/**
 * Aceita https://…, ssh://…, git@host:caminho e caminhos locais.
 * Recusa espaços/quebras de linha e qualquer coisa começando com "-"
 * (que o git interpretaria como opção, não como URL).
 */
function validateRemoteUrl(url) {
  if (!url) throw new Error("Informe a URL do repositório.");
  if (/\s/.test(url)) throw new Error("A URL do repositório não pode conter espaços.");
  if (url.startsWith("-")) throw new Error("URL de repositório inválida.");
  return url;
}

function validateBranch(branch) {
  if (!branch) throw new Error("Informe a branch.");
  if (!/^[A-Za-z0-9._\/-]+$/.test(branch) || branch.startsWith("-")) {
    throw new Error("Nome de branch inválido.");
  }
  return branch;
}

/** Normaliza o que veio do config.json / do renderer. */
function normalizeConfig(raw) {
  return {
    remoteUrl: typeof raw?.remoteUrl === "string" ? raw.remoteUrl.trim() : "",
    branch:
      typeof raw?.branch === "string" && raw.branch.trim()
        ? raw.branch.trim()
        : DEFAULT_BRANCH,
  };
}

// ---- preparo do repositório --------------------------------------------

async function isRepo(dir) {
  try {
    await fsp.access(path.join(dir, ".git"));
    return true;
  } catch {
    return false;
  }
}

// Os sidecars de anotação (".arquivo.pdf.annots") são documentos e devem ir
// para o repositório; só os temporários da escrita atômica ficam de fora.
const DEFAULT_GITIGNORE = "# Temporários da escrita atômica do Nanquim\n.*.tmp-*\n";

/** Garante `git init` na pasta dos documentos. */
async function ensureRepo(dir, branch) {
  if (await isRepo(dir)) return false;
  // -b só existe no git >= 2.28; se falhar, init puro + checkout depois
  const res = await git(["init", "-b", branch], dir);
  if (res.code !== 0) await gitOk(["init"], dir);
  // repositório novo: semeia o .gitignore (nunca sobrescreve um existente)
  const ignorePath = path.join(dir, ".gitignore");
  try {
    await fsp.writeFile(ignorePath, DEFAULT_GITIGNORE, { flag: "wx" });
  } catch {
    // já existe: é do usuário, não mexemos
  }
  return true;
}

/** Define user.name/user.email locais quando o usuário não tem identidade. */
async function ensureIdentity(dir) {
  const email = await git(["config", "user.email"], dir);
  if (email.code === 0 && email.stdout.trim()) return;
  await gitOk(["config", "user.email", FALLBACK_AUTHOR_EMAIL], dir);
  await gitOk(["config", "user.name", FALLBACK_AUTHOR_NAME], dir);
}

/** Cria ou atualiza o remote "origin" para a URL configurada. */
async function ensureRemote(dir, remoteUrl) {
  const current = await git(["remote", "get-url", "origin"], dir);
  if (current.code !== 0) {
    await gitOk(["remote", "add", "origin", remoteUrl], dir);
  } else if (current.stdout.trim() !== remoteUrl) {
    await gitOk(["remote", "set-url", "origin", remoteUrl], dir);
  }
}

/** Deixa a branch configurada como a branch atual (criando-a se preciso). */
async function ensureBranch(dir, branch) {
  // symbolic-ref funciona também com HEAD "não nascido" (repo sem commits)
  const head = await git(["symbolic-ref", "--short", "HEAD"], dir);
  if (head.code === 0 && head.stdout.trim() === branch) return;

  const exists = await git(
    ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
    dir,
  );
  await gitOk(
    exists.code === 0 ? ["checkout", branch] : ["checkout", "-b", branch],
    dir,
  );
}

/** "20/07/2026 09:04:11" — data e hora do sistema. */
function timestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

// ---- API ---------------------------------------------------------------

let syncing = false;

/**
 * Estado do repositório para exibir nas configurações. Nunca lança: falhas
 * viram `error` para a UI não quebrar por causa de um repositório estranho.
 */
async function status(dir, rawConfig) {
  const config = normalizeConfig(rawConfig);
  const info = {
    ...config,
    configured: Boolean(config.remoteUrl),
    isRepo: false,
    currentBranch: null,
    pendingChanges: 0,
    lastCommit: null,
    error: null,
  };
  try {
    info.isRepo = await isRepo(dir);
    if (!info.isRepo) return info;

    const head = await git(["symbolic-ref", "--short", "HEAD"], dir);
    if (head.code === 0) info.currentBranch = head.stdout.trim();

    const changes = await git(["status", "--porcelain"], dir);
    if (changes.code === 0) {
      info.pendingChanges = changes.stdout.split("\n").filter(Boolean).length;
    }

    const last = await git(["log", "-1", "--format=%h %s"], dir);
    if (last.code === 0 && last.stdout.trim()) info.lastCommit = last.stdout.trim();
  } catch (err) {
    info.error = err.message;
  }
  return info;
}

/**
 * add -> commit -> push. Retorna o que aconteceu para a UI dar o retorno
 * certo ("nada a commitar" não é erro: ainda pode haver commit pendente
 * de push de uma tentativa anterior que falhou).
 */
async function sync(dir, rawConfig) {
  if (syncing) throw new Error("Já existe uma sincronização em andamento.");
  const config = normalizeConfig(rawConfig);
  const remoteUrl = validateRemoteUrl(config.remoteUrl);
  const branch = validateBranch(config.branch);

  syncing = true;
  try {
    await fsp.mkdir(dir, { recursive: true });
    await ensureRepo(dir, branch);
    await ensureIdentity(dir);
    await ensureRemote(dir, remoteUrl);
    await ensureBranch(dir, branch);

    await gitOk(["add", "-A", "."], dir);

    // --quiet sai com 1 quando há algo staged; 0 significa "nada mudou"
    const staged = await git(["diff", "--cached", "--quiet"], dir);
    let committed = false;
    let message = null;
    if (staged.code !== 0) {
      message = `Sincronização ${timestamp()}`;
      await gitOk(["commit", "-m", message], dir);
      committed = true;
    }

    await gitOk(["push", "origin", branch], dir);
    return { committed, message, branch };
  } finally {
    syncing = false;
  }
}

module.exports = { sync, status, normalizeConfig, validateRemoteUrl, validateBranch };

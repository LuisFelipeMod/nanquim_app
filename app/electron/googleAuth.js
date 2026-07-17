// Autenticação Google (OAuth 2.0) para app desktop.
//
// Fluxo: Authorization Code + PKCE com redirect de loopback
// (http://127.0.0.1:<porta>). A tela de consentimento abre no NAVEGADOR do
// sistema (exigência do Google — não pode ser dentro de um BrowserWindow).
// Todo o tráfego fica no main process; o renderer nunca vê tokens.
//
// Escopo: drive.file (só arquivos criados/abertos pelo app) + openid/email
// para exibir a conta logada. drive.file não é escopo restrito, então em
// modo Testing (com a própria conta como tester) dispensa verificação.
//
// O refresh token é cifrado com safeStorage (keychain do SO) antes de ir ao
// disco (userData/google-token.enc).

const { app, shell, safeStorage, net } = require("electron");
const http = require("http");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;

// ---- configuração via .env (dev) / process.env -------------------------
// Client OAuth do tipo "Desktop app" criado no Google Cloud Console.
// Em app desktop o client_secret NÃO é confidencial (vai embarcado no
// binário distribuído), mas o endpoint de token do Google exige que ele
// seja enviado mesmo com PKCE.
//
// O main process não passa pelo Vite, então lemos o .env manualmente.
// .env.local (fora do versionamento) tem prioridade sobre .env.
function loadEnv() {
  const env = {};
  for (const name of [".env", ".env.local"]) {
    try {
      const text = fs.readFileSync(path.join(__dirname, "..", name), "utf8");
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && !line.trimStart().startsWith("#")) {
          env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
        }
      }
    } catch {
      // arquivo ausente: ignora
    }
  }
  return env;
}

const fileEnv = loadEnv();
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || fileEnv.GOOGLE_CLIENT_ID || "";
const CLIENT_SECRET =
  process.env.GOOGLE_CLIENT_SECRET || fileEnv.GOOGLE_CLIENT_SECRET || "";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const SCOPES = `openid email ${DRIVE_SCOPE}`;
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";

const TOKEN_FILE = path.join(app.getPath("userData"), "google-token.enc");
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

/** access token de curta duração, mantido só em memória. */
let cachedAccessToken = null; // { token, expiresAt }

function isConfigured() {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

function base64url(buf) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ---- persistência do refresh token -------------------------------------

const PLAIN_MARKER = "PLAIN:";

async function saveTokens(refreshToken, email) {
  const payload = JSON.stringify({ refreshToken, email });
  const data = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(payload)
    : // keychain indisponível (ex.: Linux sem libsecret): grava em texto,
      // marcado para não ser tratado como buffer cifrado na leitura.
      Buffer.from(PLAIN_MARKER + payload, "utf8");
  await fsp.writeFile(TOKEN_FILE, data);
}

async function loadTokens() {
  try {
    const data = await fsp.readFile(TOKEN_FILE);
    const json =
      data.subarray(0, PLAIN_MARKER.length).toString("utf8") === PLAIN_MARKER
        ? data.subarray(PLAIN_MARKER.length).toString("utf8")
        : safeStorage.decryptString(data);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// ---- fluxo de login ----------------------------------------------------

/**
 * Sobe um servidor de loopback efêmero, abre a tela de consentimento no
 * navegador e resolve com o authorization code do callback.
 */
function runLoopbackFlow(codeChallenge, state) {
  return new Promise((resolve, reject) => {
    let redirectUri = null;

    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const params = url.searchParams;
      const done = (title, err) => {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<!doctype html><meta charset="utf-8">` +
            `<title>Nanquim</title>` +
            `<body style="font-family:system-ui,sans-serif;text-align:center;padding-top:4rem">` +
            `<h2>${title}</h2>` +
            `<p>Você já pode fechar esta aba e voltar ao Nanquim.</p>` +
            `</body>`,
        );
        server.close();
        err ? reject(err) : resolve({ code: params.get("code"), redirectUri });
      };

      if (params.get("state") !== state) {
        done("Falha na autenticação", new Error("state OAuth não confere"));
      } else if (params.get("error")) {
        done("Autenticação cancelada", new Error(`OAuth: ${params.get("error")}`));
      } else if (!params.get("code")) {
        done("Falha na autenticação", new Error("code ausente no callback"));
      } else {
        done("Login concluído ✓", null);
      }
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      redirectUri = `http://127.0.0.1:${port}/callback`;
      const authUrl =
        `${AUTH_ENDPOINT}?` +
        new URLSearchParams({
          client_id: CLIENT_ID,
          redirect_uri: redirectUri,
          response_type: "code",
          scope: SCOPES,
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
          state,
          access_type: "offline", // necessário para receber refresh_token
          prompt: "consent",
        }).toString();
      shell.openExternal(authUrl);
    });

    setTimeout(() => {
      if (server.listening) {
        server.close();
        reject(new Error("Tempo esgotado aguardando o login do Google"));
      }
    }, LOGIN_TIMEOUT_MS);
  });
}

async function postToken(body) {
  const res = await net.fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    throw new Error(`Endpoint de token do Google respondeu ${res.status}`);
  }
  return res.json();
}

async function fetchEmail(accessToken) {
  try {
    const res = await net.fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    return (await res.json()).email ?? null;
  } catch {
    return null;
  }
}

async function login() {
  if (!isConfigured()) {
    throw new Error(
      "Google OAuth não configurado: defina GOOGLE_CLIENT_ID e " +
        "GOOGLE_CLIENT_SECRET em app/.env.local",
    );
  }

  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(
    crypto.createHash("sha256").update(codeVerifier).digest(),
  );
  const state = base64url(crypto.randomBytes(16));

  const { code, redirectUri } = await runLoopbackFlow(codeChallenge, state);

  const tokens = await postToken({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  if (!tokens.refresh_token) {
    throw new Error(
      "Google não retornou refresh_token. Revogue o acesso do app na conta " +
        "Google e tente novamente.",
    );
  }

  cachedAccessToken = {
    token: tokens.access_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
  const email = await fetchEmail(tokens.access_token);
  await saveTokens(tokens.refresh_token, email);
  return { configured: true, loggedIn: true, email };
}

async function logout() {
  cachedAccessToken = null;
  await fsp.rm(TOKEN_FILE, { force: true });
  return { configured: isConfigured(), loggedIn: false, email: null };
}

async function getStatus() {
  const stored = await loadTokens();
  return {
    configured: isConfigured(),
    loggedIn: Boolean(stored?.refreshToken),
    email: stored?.email ?? null,
  };
}

/**
 * Retorna um access token válido, renovando via refresh token quando
 * necessário. Usado pela camada de sync do Drive (fase 2).
 */
async function getAccessToken() {
  if (cachedAccessToken && cachedAccessToken.expiresAt - Date.now() > 60_000) {
    return cachedAccessToken.token;
  }
  const stored = await loadTokens();
  if (!stored?.refreshToken) throw new Error("Não autenticado no Google");

  const tokens = await postToken({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: stored.refreshToken,
    grant_type: "refresh_token",
  });
  cachedAccessToken = {
    token: tokens.access_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
  return cachedAccessToken.token;
}

module.exports = {
  isConfigured,
  login,
  logout,
  getStatus,
  getAccessToken,
};

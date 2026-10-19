const path = require("path");
const { fileURLToPath } = require("url");

const IMAGE_MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function markdownBase(mdAbs) {
  return path.basename(mdAbs, path.extname(mdAbs));
}

/** Pasta oculta de imagens ao lado do markdown: `.Nome.assets`. */
function assetsDir(mdAbs) {
  return path.join(path.dirname(mdAbs), `.${markdownBase(mdAbs)}.assets`);
}

/**
 * Troca referências `.Antigo.assets/` por `.Novo.assets/` no texto.
 * Se o novo caminho tem espaço ou parênteses (ex.: "Nota (cópia)"), o destino
 * markdown ganha `<...>` para continuar válido.
 */
function rewriteAssetRefs(content, oldBase, newBase) {
  if (!oldBase || oldBase === newBase) return content;
  const from = `.${oldBase}.assets/`;
  const to = `.${newBase}.assets/`;
  const needsQuote = /[\s()]/.test(to);
  let out = "";
  let i = 0;
  while (i < content.length) {
    const at = content.indexOf(from, i);
    if (at === -1) {
      out += content.slice(i);
      break;
    }
    const before = content.slice(Math.max(0, at - 200), at);
    const bare = /!?\[[^\]]*\]\($/.test(before);
    out += content.slice(i, at);
    if (bare && needsQuote) {
      const rest = content.slice(at + from.length);
      const endRel = rest.indexOf(")");
      out += `<${to}`;
      if (endRel === -1) {
        out += rest;
        i = content.length;
      } else {
        out += `${rest.slice(0, endRel)}>)`;
        i = at + from.length + endRel + 1;
      }
    } else {
      out += to;
      i = at + from.length;
    }
  }
  return out;
}

function isInsideRoot(abs, root) {
  const resolved = path.resolve(abs);
  const base = path.resolve(root);
  return resolved === base || resolved.startsWith(base + path.sep);
}

/**
 * Resolve um src de imagem local a partir da pasta do markdown.
 * Recusa o que sair de uploadsRoot. http(s) e data: não são locais.
 */
function resolveLocalImage(src, baseDir, uploadsRoot) {
  let decoded = String(src || "").trim();
  if (!decoded || decoded.startsWith("data:")) return null;
  if (/^https?:\/\//i.test(decoded)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(decoded)) {
    if (!decoded.toLowerCase().startsWith("file:")) return null;
    try {
      decoded = fileURLToPath(decoded);
    } catch {
      return null;
    }
  } else {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      // mantém o valor original se não for percent-encoding válido
    }
  }
  if (decoded.includes("\0")) return null;
  const abs = path.resolve(baseDir, decoded);
  if (!isInsideRoot(abs, uploadsRoot)) return null;
  return abs;
}

function toDataUri(mime, buf) {
  return `data:${mime};base64,${Buffer.from(buf).toString("base64")}`;
}

async function fileToDataUri(abs, readFile) {
  const mime = IMAGE_MIME[path.extname(abs).toLowerCase()];
  if (!mime) return null;
  return toDataUri(mime, await readFile(abs));
}

/**
 * Substitui src de <img> por data URI.
 * Locais são lidos do disco (relativos ao markdown, dentro de uploadsRoot).
 * http(s) só entra quando embedRemote é true; falha de rede mantém o src.
 */
async function inlineImages(html, options) {
  const re = /<img\b[^>]*>/gi;
  let out = "";
  let last = 0;
  let match;
  while ((match = re.exec(html))) {
    out += html.slice(last, match.index);
    out += await inlineImgTag(match[0], options);
    last = match.index + match[0].length;
  }
  return out + html.slice(last);
}

async function inlineImgTag(tag, options) {
  const match = tag.match(/\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  if (!match) return tag;
  const src = (match[1] ?? match[2] ?? "").trim();
  const quote = match[1] != null ? '"' : "'";
  if (!src || src.startsWith("data:")) return tag;

  let uri = null;
  if (/^https?:\/\//i.test(src)) {
    if (options.embedRemote && options.fetchUrl) {
      try {
        uri = await options.fetchUrl(src);
      } catch {
        uri = null;
      }
    }
  } else {
    const abs = resolveLocalImage(src, options.baseDir, options.uploadsRoot);
    if (abs) {
      try {
        uri = await fileToDataUri(abs, options.readFile);
      } catch {
        uri = null;
      }
    }
  }
  if (!uri) return tag;
  return tag.replace(match[0], ` src=${quote}${uri}${quote}`);
}

module.exports = {
  IMAGE_MIME,
  markdownBase,
  assetsDir,
  rewriteAssetRefs,
  resolveLocalImage,
  inlineImages,
};

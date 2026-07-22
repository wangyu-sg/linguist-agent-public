import { writeFile } from "node:fs/promises";

const FORMATS = new Set(["html", "pdf", "png"]);
const MAX_HTML_BYTES = 5 * 1024 * 1024;
const REQUIRED_MARKER = '<meta name="la-rich-artifact" content="v1">';
const REQUIRED_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";
const REQUIRED_CSP_TAG = `<meta http-equiv="Content-Security-Policy" content="${REQUIRED_CSP}">`;
const FORBIDDEN_TAG = /<\s*\/?\s*(?:a|img|image|use|foreignObject|script|iframe|frame|object|embed|link|base|form|input|button|textarea|select|video|audio|source|track|canvas|webview)\b/i;
const FORBIDDEN_ATTRIBUTE = /\s(?:on[a-z]+|(?:[a-z]+:)?src|(?:[a-z]+:)?href|action|formaction|srcdoc)\s*=/i;
const FORBIDDEN_SCHEME = /(?:javascript:|vbscript:)/i;
const FORBIDDEN_CSS = /(?:@import|url\s*\(|image-set\s*\(|cross-fade\s*\(|expression\s*\(|behavior\s*:)/i;

function record(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Rich Artifact export request must be an object.");
  return value;
}

function suggestedBaseName(value) {
  if (typeof value !== "string") return "rich-artifact";
  const trimmed = value.trim().replace(/\.(?:html|pdf|png)$/i, "");
  const safe = trimmed
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f/\\:]/g, "-")
    .replace(/^\.+/, "")
    .replace(/\s+/g, " ")
    .slice(0, 120)
    .trim();
  return safe || "rich-artifact";
}

export function parseRichArtifactExportRequest(value) {
  const row = record(value);
  if (typeof row.format !== "string" || !FORMATS.has(row.format)) throw new Error("Rich Artifact export format must be html, pdf, or png.");
  if (typeof row.html !== "string" || !row.html.startsWith("<!doctype html>")) throw new Error("Rich Artifact export requires trusted HTML.");
  if (Buffer.byteLength(row.html, "utf8") > MAX_HTML_BYTES) throw new Error("Rich Artifact export exceeds 5 MiB.");
  if (!row.html.includes(REQUIRED_MARKER) || !row.html.includes(REQUIRED_CSP_TAG)) throw new Error("Rich Artifact export marker or Content Security Policy is missing.");
  if ((row.html.match(/<meta name="la-rich-artifact" content="v1">/g) ?? []).length !== 1) throw new Error("Rich Artifact export marker must appear exactly once.");
  if ((row.html.match(/<meta http-equiv="Content-Security-Policy"/g) ?? []).length !== 1
    || /<meta\b[^>]*http-equiv/i.test(row.html.replace(REQUIRED_CSP_TAG, ""))) {
    throw new Error("Rich Artifact export may contain only the fixed Content Security Policy meta directive.");
  }
  if (FORBIDDEN_TAG.test(row.html) || FORBIDDEN_ATTRIBUTE.test(row.html) || FORBIDDEN_SCHEME.test(row.html) || FORBIDDEN_CSS.test(row.html)) {
    throw new Error("Rich Artifact export contains active, embedded, or network-capable content.");
  }
  return {
    format: row.format,
    html: row.html,
    suggestedName: suggestedBaseName(row.suggestedName),
  };
}

export function richArtifactSaveDialogOptions(request) {
  const formatLabel = request.format === "html" ? "HTML document" : request.format === "pdf" ? "PDF document" : "PNG image";
  return {
    title: `Export Rich Artifact as ${request.format.toUpperCase()}`,
    defaultPath: `${request.suggestedName}.${request.format}`,
    buttonLabel: "Export",
    filters: [{ name: formatLabel, extensions: [request.format] }],
    properties: ["createDirectory", "showOverwriteConfirmation"],
  };
}

async function showSaveDialog(dialog, owner, options) {
  return owner ? dialog.showSaveDialog(owner, options) : dialog.showSaveDialog(options);
}

async function renderBinary(request, BrowserWindow) {
  const preview = new BrowserWindow({
    show: false,
    width: 1200,
    height: 1600,
    backgroundColor: "#ffffff",
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      partition: `la-rich-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    },
  });
  try {
    preview.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    preview.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith("data:") }));
    preview.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    preview.webContents.on("will-attach-webview", (event) => event.preventDefault());
    await preview.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(request.html)}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (request.format === "pdf") {
      return await preview.webContents.printToPDF({ printBackground: true });
    }
    const contentHeight = await preview.webContents.executeJavaScript(
      "Math.min(16000, Math.max(900, Math.ceil(document.documentElement.scrollHeight)))",
      true,
    );
    preview.setContentSize(1200, contentHeight, false);
    const image = await preview.webContents.capturePage({ x: 0, y: 0, width: 1200, height: contentHeight });
    return image.toPNG();
  } finally {
    if (!preview.isDestroyed()) preview.destroy();
  }
}

export async function exportRichArtifact(value, dependencies) {
  const request = parseRichArtifactExportRequest(value);
  const selected = await showSaveDialog(
    dependencies.dialog,
    dependencies.owner,
    richArtifactSaveDialogOptions(request),
  );
  if (selected.canceled || !selected.filePath) return { ok: true, canceled: true, format: request.format };
  const data = request.format === "html" ? request.html : await renderBinary(request, dependencies.BrowserWindow);
  await writeFile(selected.filePath, data, { flag: "w" });
  return { ok: true, canceled: false, format: request.format, path: selected.filePath };
}

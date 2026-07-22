import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  exportRichArtifact,
  parseRichArtifactExportRequest,
  richArtifactSaveDialogOptions,
} from "../src/rich-artifact-export.mjs";

const trustedHtml = `<!doctype html><html><head><meta charset="utf-8"><meta name="la-rich-artifact" content="v1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><style>body{color:#171717}</style></head><body><main><h1>Review &amp; proof</h1></main></body></html>`;

test("Rich Artifact exports accept only marked, script-free, network-free HTML", () => {
  const parsed = parseRichArtifactExportRequest({ format: "pdf", html: trustedHtml, suggestedName: "Review / final.pdf" });
  assert.equal(parsed.format, "pdf");
  assert.equal(parsed.suggestedName, "Review - final");
  assert.deepEqual(richArtifactSaveDialogOptions(parsed), {
    title: "Export Rich Artifact as PDF",
    defaultPath: "Review - final.pdf",
    buttonLabel: "Export",
    filters: [{ name: "PDF document", extensions: ["pdf"] }],
    properties: ["createDirectory", "showOverwriteConfirmation"],
  });
  assert.throws(() => parseRichArtifactExportRequest({ format: "docx", html: trustedHtml }), /format/);
  assert.throws(() => parseRichArtifactExportRequest({ format: "html", html: trustedHtml.replace("</body>", "<script>alert(1)</script></body>") }), /active/);
  assert.match(parseRichArtifactExportRequest({ format: "html", html: trustedHtml.replace("Review", "https://example.com") }).html, /https:\/\//, "plain URL text cannot initiate a request");
  assert.throws(() => parseRichArtifactExportRequest({ format: "html", html: trustedHtml.replace("</body>", "<img src='https://example.com/a.png'></body>") }), /active/);
  assert.throws(() => parseRichArtifactExportRequest({ format: "html", html: trustedHtml.replace("body{", "@import 'evil';body{") }), /active/);
  assert.throws(() => parseRichArtifactExportRequest({ format: "html", html: trustedHtml.replace("</head>", "<meta http-equiv='refresh' content='0; https://example.com'></head>") }), /Content Security Policy/);
  assert.throws(() => parseRichArtifactExportRequest({ format: "html", html: trustedHtml.replace("la-rich-artifact", "other") }), /marker/);
});

test("HTML export writes only after an explicit native save selection and reports cancellation", async () => {
  const root = await mkdtemp(join(tmpdir(), "la-rich-artifact-export-"));
  try {
    const path = join(root, "review.html");
    const owner = { id: "owner" };
    let receivedOwner;
    const result = await exportRichArtifact(
      { format: "html", html: trustedHtml, suggestedName: "Review" },
      {
        BrowserWindow: class { constructor() { throw new Error("HTML export must not create a render window."); } },
        owner,
        dialog: { showSaveDialog: async (candidateOwner) => { receivedOwner = candidateOwner; return { canceled: false, filePath: path }; } },
      },
    );
    assert.equal(receivedOwner, owner);
    assert.deepEqual(result, { ok: true, canceled: false, format: "html", path });
    assert.equal(await readFile(path, "utf8"), trustedHtml);

    const canceled = await exportRichArtifact(
      { format: "html", html: trustedHtml, suggestedName: "Review" },
      { BrowserWindow: class {}, owner: null, dialog: { showSaveDialog: async () => ({ canceled: true }) } },
    );
    assert.deepEqual(canceled, { ok: true, canceled: true, format: "html" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("renderer preview is declarative and never injects Artifact HTML", async () => {
  const source = await readFile(new URL("../src/renderer/inspector/RichArtifactPreview.tsx", import.meta.url), "utf8");
  assert.match(source, /<ReactMarkdown[\s\S]*skipHtml/);
  assert.match(source, /a: \(\{ children \}\) => <span>/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|file:\/\/|<iframe|<webview/);
});

test("PDF and PNG use a sandboxed, network-denied hidden renderer", async () => {
  const root = await mkdtemp(join(tmpdir(), "la-rich-artifact-binary-"));
  const windows = [];
  class FakeBrowserWindow {
    constructor(options) {
      this.options = options;
      this.destroyed = false;
      this.webContents = {
        session: {
          setPermissionRequestHandler: (handler) => { this.permissionHandler = handler; },
          webRequest: { onBeforeRequest: (handler) => { this.requestHandler = handler; } },
        },
        setWindowOpenHandler: (handler) => { this.windowOpenHandler = handler; },
        on: () => undefined,
        printToPDF: async () => {
          await Promise.resolve();
          if (this.destroyed) throw new Error("PDF renderer was destroyed before printToPDF settled.");
          return Buffer.from("pdf-bytes");
        },
        executeJavaScript: async () => 1200,
        capturePage: async () => ({ toPNG: () => Buffer.from("png-bytes") }),
      };
      windows.push(this);
    }
    async loadURL(url) { this.loadedURL = url; }
    setContentSize(width, height) { this.contentSize = { width, height }; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
  }
  try {
    const dialog = {
      showSaveDialog: async (options) => ({ canceled: false, filePath: join(root, `review.${options.filters[0].extensions[0]}`) }),
    };
    for (const format of ["pdf", "png"]) {
      const result = await exportRichArtifact(
        { format, html: trustedHtml, suggestedName: "Review" },
        { BrowserWindow: FakeBrowserWindow, owner: null, dialog },
      );
      assert.equal(result.canceled, false);
      assert.equal(await readFile(join(root, `review.${format}`), "utf8"), `${format}-bytes`);
    }
    assert.equal(windows.length, 2);
    for (const window of windows) {
      assert.equal(window.options.show, false);
      assert.equal(window.options.webPreferences.sandbox, true);
      assert.equal(window.options.webPreferences.nodeIntegration, false);
      assert.match(window.loadedURL, /^data:text\/html/);
      assert.deepEqual(window.windowOpenHandler(), { action: "deny" });
      let networkDecision;
      window.requestHandler({ url: "https://example.com/a" }, (decision) => { networkDecision = decision; });
      assert.deepEqual(networkDecision, { cancel: true });
      assert.equal(window.destroyed, true);
    }
    assert.deepEqual(windows[1].contentSize, { width: 1200, height: 1200 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

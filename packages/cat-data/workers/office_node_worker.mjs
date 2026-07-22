#!/usr/bin/env node
/** Managed pdf-lib JSONL worker. The host owns grants, output paths and locks. */

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function finite(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be finite`);
  return parsed;
}

function pageIndices(value, pageCount) {
  if (!Array.isArray(value) || !value.length) throw new Error("pages must be a non-empty array of 1-based page numbers");
  const indices = value.map((item) => Math.trunc(finite(item, "page")) - 1);
  if (indices.some((index) => index < 0 || index >= pageCount)) throw new Error(`pages must stay between 1 and ${pageCount}`);
  return indices;
}

function formValue(field) {
  const name = field.getName();
  const type = field.constructor.name;
  let value = null;
  if (typeof field.getText === "function") value = field.getText() ?? "";
  else if (typeof field.isChecked === "function") value = field.isChecked();
  else if (typeof field.getSelected === "function") value = field.getSelected();
  return { name, type, value };
}

async function loadPdfLib(nodeModulesRoot) {
  const root = resolve(String(nodeModulesRoot || ""));
  if (!root) throw new Error("nodeModulesRoot is required");
  return require(resolve(root, "pdf-lib"));
}

async function handle(request) {
  const {
    PDFDocument,
    StandardFonts,
    degrees,
    grayscale,
  } = await loadPdfLib(request.nodeModulesRoot);
  const operation = String(request.operation || "inspect");
  const sourcePaths = Array.isArray(request.sourcePaths)
    ? request.sourcePaths.map((path) => resolve(String(path)))
    : request.sourcePath ? [resolve(String(request.sourcePath))] : [];
  const sourceBuffers = await Promise.all(sourcePaths.map((path) => readFile(path)));

  if (operation === "inspect") {
    if (sourceBuffers.length !== 1) throw new Error("PDF inspect requires exactly one sourcePath");
    const pdf = await PDFDocument.load(sourceBuffers[0], { updateMetadata: false });
    return {
      ok: true,
      sourcePath: sourcePaths[0],
      sourceSha256: sha256(sourceBuffers[0]),
      result: {
        format: "pdf",
        pages: pdf.getPages().map((page, index) => ({
          page: index + 1,
          width: page.getWidth(),
          height: page.getHeight(),
          rotation: page.getRotation().angle,
        })),
        formFields: pdf.getForm().getFields().map(formValue),
      },
    };
  }

  const outputPath = resolve(String(request.outputPath || ""));
  if (!request.outputPath) throw new Error(`${operation} requires outputPath`);
  let output;
  let diff;

  if (operation === "merge") {
    if (sourceBuffers.length < 2) throw new Error("PDF merge requires at least two sourcePaths");
    const merged = await PDFDocument.create();
    for (const bytes of sourceBuffers) {
      const source = await PDFDocument.load(bytes, { updateMetadata: false });
      const pages = await merged.copyPages(source, source.getPageIndices());
      for (const page of pages) merged.addPage(page);
    }
    output = await merged.save();
    diff = { operation, sourceCount: sourceBuffers.length, outputPages: merged.getPageCount() };
  } else {
    if (sourceBuffers.length !== 1) throw new Error(`${operation} requires exactly one sourcePath`);
    const source = await PDFDocument.load(sourceBuffers[0], { updateMetadata: false });
    if (operation === "extract_pages") {
      const selected = pageIndices(request.pages, source.getPageCount());
      const extracted = await PDFDocument.create();
      const pages = await extracted.copyPages(source, selected);
      for (const page of pages) extracted.addPage(page);
      output = await extracted.save();
      diff = { operation, pages: selected.map((index) => index + 1) };
    } else if (operation === "rotate") {
      const selected = request.pages ? new Set(pageIndices(request.pages, source.getPageCount())) : new Set(source.getPageIndices());
      const angle = Math.trunc(finite(request.angle, "angle"));
      if (![0, 90, 180, 270, -90, -180, -270].includes(angle)) throw new Error("angle must be a multiple of 90 between -270 and 270");
      source.getPages().forEach((page, index) => {
        if (selected.has(index)) page.setRotation(degrees(angle));
      });
      output = await source.save();
      diff = { operation, angle, pages: [...selected].map((index) => index + 1) };
    } else if (operation === "watermark") {
      const text = String(request.text || "");
      if (!text || /[^\x20-\x7e]/.test(text)) throw new Error("The first PDF watermark pass supports non-empty WinAnsi text only");
      const font = await source.embedFont(StandardFonts.Helvetica);
      const size = Math.max(6, Math.min(144, finite(request.fontSize ?? 32, "fontSize")));
      const opacity = Math.max(0.05, Math.min(1, finite(request.opacity ?? 0.22, "opacity")));
      source.getPages().forEach((page) => {
        const width = font.widthOfTextAtSize(text, size);
        page.drawText(text, {
          x: Math.max(12, (page.getWidth() - width) / 2),
          y: page.getHeight() / 2,
          size,
          font,
          color: grayscale(0.45),
          opacity,
          rotate: degrees(finite(request.rotation ?? 35, "rotation")),
        });
      });
      output = await source.save();
      diff = { operation, text, pages: source.getPageCount() };
    } else if (operation === "fill_form") {
      if (!Array.isArray(request.fields) || !request.fields.length) throw new Error("fill_form requires fields");
      const form = source.getForm();
      const changes = [];
      for (const item of request.fields) {
        if (!item || typeof item !== "object") throw new Error("Each form field update must be an object");
        const name = String(item.name || "");
        const field = form.getField(name);
        const before = formValue(field).value;
        if (typeof field.setText === "function") field.setText(String(item.value ?? ""));
        else if (typeof field.check === "function" && typeof item.value === "boolean") item.value ? field.check() : field.uncheck();
        else if (typeof field.select === "function") field.select(Array.isArray(item.value) ? item.value.map(String) : String(item.value ?? ""));
        else throw new Error(`Unsupported PDF form field type for ${name}: ${field.constructor.name}`);
        changes.push({ name, before, after: formValue(field).value });
      }
      output = await source.save({ updateFieldAppearances: true });
      diff = { operation, changes };
    } else {
      throw new Error(`Unsupported managed PDF operation: ${operation}`);
    }
  }

  await writeFile(outputPath, output, { flag: "wx" });
  const reopened = await PDFDocument.load(output, { updateMetadata: false });
  return {
    ok: true,
    sourcePaths,
    sourceSha256: sourceBuffers.length === 1 ? sha256(sourceBuffers[0]) : undefined,
    sourceDigests: sourceBuffers.map((bytes, index) => ({ path: sourcePaths[index], sha256: sha256(bytes) })),
    outputPath,
    outputSha256: sha256(output),
    diff,
    validation: {
      reopened: true,
      pageCount: reopened.getPageCount(),
      formFields: reopened.getForm().getFields().map(formValue),
    },
  };
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", async () => {
  for (const line of input.split(/\r?\n/).filter((value) => value.trim())) {
    try {
      const request = JSON.parse(line);
      if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("Worker request must be a JSON object");
      process.stdout.write(`${JSON.stringify(await handle(request))}\n`);
    } catch (error) {
      process.stdout.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error), errorType: error?.constructor?.name || "Error" })}\n`);
    }
  }
});

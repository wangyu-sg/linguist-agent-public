import { useMemo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  parseRichArtifactDocument,
  renderRichArtifactHtml,
  type RichArtifactBlockV1,
  type RichArtifactChartBlockV1,
  type RichArtifactDocumentV1,
  type RichArtifactFileReferenceV1,
} from "../../../../../packages/cat-data/src/rich_artifact.ts";
import { Button } from "../ui/index.ts";

type ExportFormat = "html" | "pdf" | "png";

function FileReference({ file }: { file: RichArtifactFileReferenceV1 }) {
  return (
    <dl className="rich-artifact__file">
      <div><dt>File</dt><dd>{file.label}</dd></div>
      <div><dt>Role</dt><dd><code>{file.role}</code></dd></div>
      <div><dt>Path</dt><dd><code>{file.path}</code></dd></div>
      {file.mimeType ? <div><dt>Type</dt><dd><code>{file.mimeType}</code></dd></div> : null}
      {file.sha256 ? <div><dt>SHA-256</dt><dd><code>{file.sha256}</code></dd></div> : null}
    </dl>
  );
}

function Chart({ block }: { block: RichArtifactChartBlockV1 }) {
  const maximum = Math.max(1, ...block.series.flatMap((series) => series.points.map((point) => Math.abs(point.value))));
  return (
    <figure className="rich-artifact__chart" data-kind={block.kind}>
      {block.caption ? <figcaption>{block.caption}</figcaption> : null}
      {block.series.map((series) => (
        <section key={series.label}>
          <h5>{series.label}</h5>
          {series.points.map((point, index) => (
            <div className="rich-artifact__chart-row" key={`${point.label}:${index}`}>
              <span>{point.label}</span>
              <i style={{ width: `${Math.max(1, Math.round(Math.abs(point.value) / maximum * 100))}%` }} />
              <strong>{point.value}</strong>
            </div>
          ))}
        </section>
      ))}
    </figure>
  );
}

export function RichArtifactBlockView({ block }: { block: RichArtifactBlockV1 }): ReactNode {
  if (block.type === "markdown") {
    return (
      <section className="rich-artifact__markdown">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          skipHtml
          components={{
            a: ({ children }) => <span>{children}</span>,
            img: ({ alt }) => <span>{alt ?? "Image"}</span>,
          }}
        >
          {block.markdown}
        </ReactMarkdown>
      </section>
    );
  }
  if (block.type === "table") {
    return (
      <figure className="rich-artifact__table-wrap">
        {block.caption ? <figcaption>{block.caption}</figcaption> : null}
        <div tabIndex={0} role="region" aria-label={block.caption ?? "Rich Artifact table"}>
          <table>
            <thead><tr>{block.columns.map((column) => <th key={column.key} style={{ textAlign: column.align ?? "left" }}>{column.label}</th>)}</tr></thead>
            <tbody>{block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>{block.columns.map((column) => <td key={column.key} style={{ textAlign: column.align ?? "left" }}>{String(row[column.key] ?? "")}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      </figure>
    );
  }
  if (block.type === "chart") return <Chart block={block} />;
  if (block.type === "image") {
    return (
      <figure className="rich-artifact__image" role="img" aria-label={block.alt}>
        <strong>{block.alt}</strong>
        {block.caption ? <figcaption>{block.caption}</figcaption> : null}
        <FileReference file={block.file} />
      </figure>
    );
  }
  if (block.type === "page_overlay") {
    return (
      <figure className="rich-artifact__overlay">
        <figcaption>Page {block.page} · {block.regions.length} region(s)</figcaption>
        <svg viewBox={`0 0 ${block.width} ${block.height}`} role="img" aria-label={`Page ${block.page} evidence overlay`}>
          {block.regions.map((region, index) => (
            <polygon key={index} points={region.polygon.map(([x, y]) => `${x},${y}`).join(" ")}>
              <title>{region.label ?? `Region ${index + 1}`}{region.confidence === undefined ? "" : ` · ${Math.round(region.confidence * 100)}%`}</title>
            </polygon>
          ))}
        </svg>
        {block.background ? <FileReference file={block.background} /> : null}
      </figure>
    );
  }
  if (block.type === "diff") {
    return (
      <section className="rich-artifact__diff">
        {block.label ? <h4>{block.label}</h4> : null}
        {block.before ? <><h5>Before</h5><pre>{block.before}</pre></> : null}
        {block.after ? <><h5>After</h5><pre>{block.after}</pre></> : null}
        {block.patch ? <><h5>Patch</h5><pre>{block.patch}</pre></> : null}
      </section>
    );
  }
  if (block.type === "todo_list") {
    return (
      <figure className="rich-artifact__todo-list">
        {block.caption ? <figcaption>{block.caption}</figcaption> : null}
        <ul>
          {block.items.map((item) => (
            <li className="rich-artifact__todo" data-status={item.status} key={item.id}>
              <span className="rich-artifact__todo-marker" aria-hidden="true">
                {item.status === "completed" ? "✓" : item.status === "in_progress" ? "◐" : "○"}
              </span>
              <span className="rich-artifact__todo-text">{item.text}</span>
            </li>
          ))}
        </ul>
      </figure>
    );
  }
  return <section><FileReference file={block.file} /></section>;
}

function safeSuggestedName(document: RichArtifactDocumentV1): string {
  return document.title.replace(/[\u0000-\u001f\u007f/\\:]/g, "-").replace(/\s+/g, " ").trim().slice(0, 100) || "rich-artifact";
}

export function RichArtifactPreview({ value }: { value: unknown }) {
  const parsed = useMemo(() => {
    try {
      return { document: parseRichArtifactDocument(value), error: null };
    } catch (cause) {
      return { document: null, error: cause instanceof Error ? cause.message : String(cause) };
    }
  }, [value]);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [exportState, setExportState] = useState<{ tone: "error" | "success"; message: string } | null>(null);

  if (!parsed.document) {
    return <div className="rich-artifact__invalid" role="alert"><strong>Rich Artifact is invalid.</strong><span>{parsed.error}</span></div>;
  }
  const document = parsed.document;

  async function exportAs(format: ExportFormat): Promise<void> {
    setExporting(format);
    setExportState(null);
    try {
      const result = await window.linguist.system.exportRichArtifact({
        format,
        html: renderRichArtifactHtml(document),
        suggestedName: safeSuggestedName(document),
      });
      if (!result.canceled) setExportState({ tone: "success", message: `Exported ${format.toUpperCase()} as ${result.file.name}.` });
    } catch (cause) {
      setExportState({ tone: "error", message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setExporting(null);
    }
  }

  return (
    <article className="rich-artifact" data-schema-version={document.schemaVersion}>
      <header>
        <div>
          <strong>{document.title}</strong>
          <span>{document.generator} · <time dateTime={document.createdAt}>{document.createdAt}</time></span>
        </div>
        <div className="rich-artifact__exports" aria-label="Export Rich Artifact">
          {(["html", "pdf", "png"] as const).map((format) => (
            <Button key={format} variant="ghost" loading={exporting === format} disabled={exporting !== null} onClick={() => void exportAs(format)}>
              {format.toUpperCase()}
            </Button>
          ))}
        </div>
      </header>
      {exportState ? <p className="rich-artifact__export-state" data-tone={exportState.tone} role={exportState.tone === "error" ? "alert" : "status"}>{exportState.message}</p> : null}
      <div className="rich-artifact__blocks">
        {document.blocks.map((block) => <RichArtifactBlockView key={block.id} block={block} />)}
      </div>
    </article>
  );
}

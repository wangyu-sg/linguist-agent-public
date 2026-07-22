import {
  FileStack,
  Info,
  Search,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  workspaceClient,
  type AssetParseResult,
  type ProjectAssetItem,
  type ProjectAssetReadResponse,
  type ProjectAssetSearchHit,
  type ProjectAssetSearchResponse,
  type ProjectAssetsCatalog,
  type ProjectSummary,
  type ProjectWorkbookPreview,
  type ProjectWorkbookSheetPage,
} from "../data/workspace-client.ts";
import { Button, StatusLabel } from "../ui/index.ts";
import {
  ingestProjectAssets,
  type AssetIngestionFile,
  type AssetIngestionStatus,
} from "./actions.ts";
import "./assets.css";

export interface ProjectAssetsProps {
  project: ProjectSummary | null;
  onCatalogChange?: (catalog: ProjectAssetsCatalog) => void;
}

type LoadState = "idle" | "loading" | "ready" | "error";

const roleLabels: Record<string, string> = {
  phrase_mxliff: "Phrase Batch",
  master_xliff: "Master XLIFF",
  xliff: "XLIFF",
  mqxliff: "memoQ Batch",
  sdlxliff: "Trados Batch",
  csv_batch: "CSV Batch",
  xlsx_batch: "XLSX Batch",
  tm: "翻译记忆库",
  termbase: "术语库",
  glossary: "术语表",
  source_table: "源文表",
  style_guide: "风格指南",
  reference: "参考资料",
  image: "图片",
  unknown: "未分类",
};

const kindLabels: Record<string, string> = {
  workbook: "工作簿",
  document: "文档",
  memory: "TM / TB",
  other: "其他",
  file: "文件内容",
  termbase: "术语",
  typed: "结构化资料",
};

const ingestionLabels: Record<AssetIngestionStatus, string> = {
  queued: "等待扫描",
  scanning: "正在登记",
  parsing: "正在解析",
  ready: "可以使用",
  registered: "已登记",
  failed: "失败",
};

function roleLabel(role: string): string {
  return roleLabels[role] ?? role.replaceAll("_", " ");
}

function kindLabel(kind: string): string {
  return kindLabels[kind] ?? kind.replaceAll("_", " ");
}

function searchGroupLabel(id: string, title: string): string {
  if (id === "files") return "正文命中";
  if (id === "termbase") return "术语命中";
  if (id === "typed") return "表格与结构化资料";
  return title;
}

function fileName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function fileExtension(path: string): string {
  const extension = fileName(path).split(".").at(-1);
  return extension && extension !== fileName(path) ? extension.toLocaleUpperCase() : "FILE";
}

function formatBytes(value?: number): string {
  if (value === undefined) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function ingestionTone(status: AssetIngestionStatus): "neutral" | "running" | "complete" | "failed" | "waiting" {
  if (status === "queued") return "waiting";
  if (status === "scanning" || status === "parsing") return "running";
  if (status === "ready") return "complete";
  if (status === "failed") return "failed";
  return "neutral";
}

function assetMatches(asset: ProjectAssetItem, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return [asset.relPath, asset.role, asset.selectedRole, asset.kind, ...asset.reasons, ...asset.roleReasons]
    .some((value) => value.toLocaleLowerCase().includes(needle));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function MetadataList({ asset }: { asset: ProjectAssetItem }) {
  return (
    <dl className="asset-metadata">
      <div><dt>类型</dt><dd>{kindLabel(asset.kind)}</dd></div>
      <div><dt>用途</dt><dd>{roleLabel(asset.selectedRole)}</dd></div>
      <div><dt>判断</dt><dd>{asset.roleStatus === "confirmed" ? "已确认" : `推断 · ${Math.round(asset.confidence * 100)}%`}</dd></div>
      <div><dt>大小</dt><dd>{formatBytes(asset.sizeBytes)}</dd></div>
      <div className="asset-metadata__path"><dt>项目路径</dt><dd>{asset.relPath}</dd></div>
    </dl>
  );
}

function AssetRow({ asset, selected, onSelect }: {
  asset: ProjectAssetItem;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li className="asset-list__item">
      <button type="button" className="asset-row" aria-current={selected ? "true" : undefined} onClick={onSelect}>
        <span className="asset-row__icon" aria-hidden="true">{fileExtension(asset.relPath)}</span>
        <span className="asset-row__main">
          <strong>{fileName(asset.relPath)}</strong>
          <span>{asset.relPath}</span>
        </span>
        <span className="asset-row__meta">
          <span>{roleLabel(asset.selectedRole)}</span>
          <span>{formatBytes(asset.sizeBytes)}</span>
        </span>
      </button>
    </li>
  );
}

function IngestionRow({ file, selected, onSelect }: {
  file: AssetIngestionFile;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li className="asset-list__item">
      <button type="button" className="asset-row asset-row--ingestion" aria-current={selected ? "true" : undefined} onClick={onSelect}>
        <span className="asset-row__icon" aria-hidden="true">{fileExtension(file.filePath)}</span>
        <span className="asset-row__main">
          <strong>{fileName(file.filePath)}</strong>
          <span>{file.relPath ?? file.filePath}</span>
        </span>
        <StatusLabel live state={ingestionTone(file.status)}>{ingestionLabels[file.status]}</StatusLabel>
      </button>
    </li>
  );
}

function SearchHitRow({ hit, selected, onSelect }: {
  hit: ProjectAssetSearchHit;
  selected: boolean;
  onSelect: () => void;
}) {
  const location = [hit.sheetName, hit.lineNo ? `第 ${hit.lineNo} 行` : null].filter(Boolean).join(" · ");
  return (
    <li className="asset-list__item">
      <button type="button" className="asset-search-hit" aria-current={selected ? "true" : undefined} onClick={onSelect}>
        <span className="asset-search-hit__source">
          <strong>{fileName(hit.relPath)}</strong>
          <span>{kindLabel(hit.kind)}{location ? ` · ${location}` : ""}</span>
        </span>
        <span className="asset-search-hit__text">{hit.source && hit.target ? `${hit.source} → ${hit.target}` : hit.text}</span>
        {hit.detail ? <span className="asset-search-hit__detail">{hit.detail}</span> : null}
      </button>
    </li>
  );
}

function WorkbookTable({ page }: { page: ProjectWorkbookSheetPage }) {
  const columnCount = Math.max(page.columnCount, page.headers.length, ...page.rows.map((row) => row.cells.length), 0);
  const headers = Array.from({ length: columnCount }, (_, index) => page.headers[index] || `列 ${index + 1}`);
  return (
    <div className="asset-workbook-table" tabIndex={0} aria-label={`${page.sheetName} 工作簿预览`}>
      <table>
        <caption className="la-sr-only">{page.sheetName}，预览 {page.rows.length} 行，共 {page.rowCount} 行</caption>
        <thead><tr><th scope="col">行</th>{headers.map((header, index) => <th key={`${index}:${header}`} scope="col">{header}</th>)}</tr></thead>
        <tbody>
          {page.rows.map((row) => (
            <tr key={row.rowNo}>
              <th scope="row">{row.rowNo}</th>
              {headers.map((_, index) => <td key={index}>{row.cells[index]?.displayValue ?? ""}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ParsePreview({ result }: { result: AssetParseResult }) {
  const structured = result.structuredPreview;
  const mineru = result.mineruPreview;
  return (
    <div className="asset-parse-preview">
      {structured ? (
        <section>
          <header><h3>结构化解析</h3><StatusLabel state={structured.status === "ready" ? "complete" : structured.status === "error" ? "failed" : "neutral"}>{structured.status}</StatusLabel></header>
          {structured.error ? <p className="asset-preview__error" role="alert">{structured.error}</p> : null}
          {(structured.structuredSheets ?? []).map((sheet) => (
            <section key={sheet.sheetName} className="asset-sheet-summary">
              <header>
                <strong>{sheet.sheetName}</strong>
                <span>{sheet.rowCount} 行 · {roleLabel(sheet.role)} · {sheet.action.replaceAll("_", " ")}</span>
              </header>
              {sheet.headers.length ? <p><span>列：</span>{sheet.headers.join(" · ")}</p> : null}
              {sheet.reason ? <p>{sheet.reason}</p> : null}
              {sheet.sampleRows.length ? (
                <div className="asset-sample-table" tabIndex={0} aria-label={`${sheet.sheetName} 样例行`}>
                  <table><tbody>{sheet.sampleRows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table>
                </div>
              ) : null}
            </section>
          ))}
        </section>
      ) : null}
      {mineru ? (
        <section>
          <header><h3>文档解析</h3><StatusLabel state={mineru.status === "ready" ? "complete" : mineru.status === "error" ? "failed" : "neutral"}>{mineru.status}</StatusLabel></header>
          {mineru.error ? <p className="asset-preview__error" role="alert">{mineru.error}</p> : null}
          {(mineru.mineruBlocks ?? []).map((block) => <p key={block.id}>{block.text}</p>)}
        </section>
      ) : null}
      {result.warnings.length ? (
        <section className="asset-preview__warnings"><h3>解析提示</h3><ul>{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></section>
      ) : null}
    </div>
  );
}

function PreviewShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <aside className="asset-preview" aria-label={`${title} 详情`}>
      <header className="asset-preview__header">
        <div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div>
      </header>
      <div className="asset-preview__body">{children}</div>
    </aside>
  );
}

export function ProjectAssets({ project, onCatalogChange }: ProjectAssetsProps) {
  const [catalog, setCatalog] = useState<ProjectAssetsCatalog | null>(null);
  const [catalogState, setCatalogState] = useState<LoadState>("idle");
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [search, setSearch] = useState<ProjectAssetSearchResponse | null>(null);
  const [searchState, setSearchState] = useState<LoadState>("idle");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedAssetPath, setSelectedAssetPath] = useState<string | null>(null);
  const [selectedHit, setSelectedHit] = useState<ProjectAssetSearchHit | null>(null);
  const [ingestion, setIngestion] = useState<AssetIngestionFile[]>([]);
  const [selectedIngestionPath, setSelectedIngestionPath] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [readPreview, setReadPreview] = useState<ProjectAssetReadResponse | null>(null);
  const [workbookPreview, setWorkbookPreview] = useState<ProjectWorkbookPreview | null>(null);
  const [workbookPage, setWorkbookPage] = useState<ProjectWorkbookSheetPage | null>(null);
  const [selectedSheet, setSelectedSheet] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<LoadState>("idle");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const catalogRequest = useRef(0);
  const searchRequest = useRef(0);
  const previewRequest = useRef(0);
  const sheetRequest = useRef(0);

  const selectedAsset = catalog?.assets.find((asset) => asset.relPath === selectedAssetPath) ?? null;
  const selectedIngestion = ingestion.find((file) => file.filePath === selectedIngestionPath) ?? null;
  const visibleAssets = useMemo(
    () => catalog?.assets.filter((asset) => assetMatches(asset, searchedQuery)) ?? [],
    [catalog, searchedQuery],
  );

  const loadCatalog = async (projectId: string) => {
    const request = ++catalogRequest.current;
    setCatalogState("loading");
    setCatalogError(null);
    try {
      const next = await workspaceClient.listProjectAssets(projectId);
      if (request !== catalogRequest.current) return;
      setCatalog(next);
      setCatalogState("ready");
      onCatalogChange?.(next);
      setSelectedAssetPath((current) => current && next.assets.some((asset) => asset.relPath === current) ? current : next.assets[0]?.relPath ?? null);
    } catch (error) {
      if (request !== catalogRequest.current) return;
      setCatalogState("error");
      setCatalogError(errorMessage(error));
    }
  };

  useEffect(() => {
    ++catalogRequest.current;
    ++searchRequest.current;
    ++previewRequest.current;
    ++sheetRequest.current;
    setCatalog(null);
    setCatalogState(project ? "loading" : "idle");
    setCatalogError(null);
    setQuery("");
    setSearchedQuery("");
    setSearch(null);
    setSearchState("idle");
    setSearchError(null);
    setSelectedAssetPath(null);
    setSelectedHit(null);
    setIngestion([]);
    setSelectedIngestionPath(null);
    setReadPreview(null);
    setWorkbookPreview(null);
    setWorkbookPage(null);
    setSelectedSheet(null);
    if (project) void loadCatalog(project.projectId);
    return () => {
      ++catalogRequest.current;
      ++searchRequest.current;
      ++previewRequest.current;
      ++sheetRequest.current;
    };
  }, [project?.projectId]);

  useEffect(() => {
    const asset = selectedAsset;
    if (!project || !asset || selectedIngestion) {
      setReadPreview(null);
      setWorkbookPreview(null);
      setWorkbookPage(null);
      setSelectedSheet(null);
      setPreviewState("idle");
      setPreviewError(null);
      return;
    }
    const request = ++previewRequest.current;
    setPreviewState("loading");
    setPreviewError(null);
    setReadPreview(null);
    setWorkbookPreview(null);
    setWorkbookPage(null);
    setSelectedSheet(null);
    const load = async () => {
      try {
        if (asset.relPath.toLocaleLowerCase().endsWith(".xlsx")) {
          const preview = await workspaceClient.previewProjectWorkbook(project.projectId, asset.relPath);
          if (request !== previewRequest.current) return;
          setWorkbookPreview(preview);
          setSelectedSheet(preview.sheets[0]?.sheetName ?? null);
          setPreviewState("ready");
        } else {
          const read = await workspaceClient.readProjectAsset(project.projectId, asset.relPath);
          if (request !== previewRequest.current) return;
          setReadPreview(read);
          setPreviewState("ready");
        }
      } catch (error) {
        if (request !== previewRequest.current) return;
        setPreviewState("error");
        setPreviewError(errorMessage(error));
      }
    };
    void load();
  }, [project?.projectId, selectedAsset?.relPath, selectedIngestionPath]);

  useEffect(() => {
    if (!project || !selectedAsset || !selectedSheet || !workbookPreview) return;
    const request = ++sheetRequest.current;
    setWorkbookPage(null);
    const load = async () => {
      try {
        const page = await workspaceClient.readProjectWorkbookRows(project.projectId, selectedAsset.relPath, selectedSheet, 0, 200);
        if (request !== sheetRequest.current) return;
        setWorkbookPage(page);
      } catch (error) {
        if (request !== sheetRequest.current) return;
        setPreviewError(errorMessage(error));
      }
    };
    void load();
  }, [project?.projectId, selectedAsset?.relPath, selectedSheet, workbookPreview]);

  const runSearch = async (event: FormEvent) => {
    event.preventDefault();
    if (!project) return;
    const normalized = query.trim();
    setSearchedQuery(normalized);
    setSearchError(null);
    if (!normalized) {
      ++searchRequest.current;
      setSearch(null);
      setSearchState("idle");
      return;
    }
    const request = ++searchRequest.current;
    setSearchState("loading");
    setSearch(null);
    try {
      const result = await workspaceClient.searchProjectAssets(project.projectId, normalized, 200);
      if (request !== searchRequest.current) return;
      setSearch(result);
      setSearchState("ready");
    } catch (error) {
      if (request !== searchRequest.current) return;
      setSearchState("error");
      setSearchError(errorMessage(error));
    }
  };

  const selectAsset = (asset: ProjectAssetItem, hit: ProjectAssetSearchHit | null = null) => {
    setSelectedIngestionPath(null);
    setSelectedAssetPath(asset.relPath);
    setSelectedHit(hit);
  };

  const selectHit = (hit: ProjectAssetSearchHit) => {
    setSelectedIngestionPath(null);
    setSelectedHit(hit);
    setSelectedAssetPath(catalog?.assets.find((asset) => asset.relPath === hit.relPath)?.relPath ?? null);
  };

  const importAssets = async () => {
    if (!project || !catalog || isImporting) return;
    setIsImporting(true);
    setCatalogError(null);
    try {
      const outcome = await ingestProjectAssets(
        {
          projectId: project.projectId,
          projectName: project.name,
          rootPath: project.root,
          sourceLanguage: catalog.sourceLanguage,
          targetLanguage: catalog.targetLanguage,
        },
        {
          pickImportFiles: () => window.linguist.system.pickImportFiles("asset"),
          refreshProject: (input) => workspaceClient.createProject(input),
          listAssets: (projectId) => workspaceClient.listProjectAssets(projectId),
          parseAsset: (projectId, filePath) => workspaceClient.parseProjectAsset(projectId, filePath, "structured"),
          readAsset: (projectId, filePath) => workspaceClient.readProjectAsset(projectId, filePath),
          onChange: (files) => {
            setIngestion(files);
            setSelectedIngestionPath((current) => current ?? files[0]?.filePath ?? null);
            setSelectedAssetPath(null);
            setSelectedHit(null);
          },
        },
      );
      if (outcome.catalog) {
        setCatalog(outcome.catalog);
        onCatalogChange?.(outcome.catalog);
      }
    } catch (error) {
      setCatalogError(errorMessage(error));
    } finally {
      setIsImporting(false);
    }
  };

  if (!project) {
    return (
      <section className="assets-workspace assets-workspace--empty">
        <h1>选择一个项目查看资料库</h1>
        <p>Assets 属于 Project；Task 只保存引用，不复制文件。</p>
      </section>
    );
  }

  const selectedHitOnly = selectedHit && !selectedAsset;
  const activeSearchGroups = search?.groups.filter((group) => group.hits.length) ?? [];
  const libraryIsEmpty = catalogState === "ready"
    && !catalog?.assets.length
    && !ingestion.length
    && !searchedQuery;

  return (
    <section className="assets-workspace" aria-label={`${project.name} 资料库`}>
      <header className="assets-workspace__header">
        <div>
          <h1>资料库</h1>
          <p>{project.name} · {catalog?.assets.length ?? project.assetCount} 个文件</p>
        </div>
        <Button variant="secondary" loading={isImporting} disabled={catalogState !== "ready"} onClick={() => void importAssets()}>选择并解析资料</Button>
      </header>

      <div className="assets-workspace__notice">
        <Info aria-hidden="true" />
        <p>只登记项目文件夹内的文件。系统选择器授予读取权限，Linguist Agent 不复制原文件，解析也不会启动 Agent 或模型。</p>
      </div>

      <form className="assets-search" role="search" onSubmit={(event) => void runSearch(event)}>
        <label>
          <span className="la-sr-only">搜索资料库</span>
          <Search className="assets-search__icon" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              if (!event.target.value) {
                setSearchedQuery("");
                setSearch(null);
                setSearchState("idle");
              }
            }}
            placeholder="搜索文件名、术语、正文或表格内容"
          />
        </label>
        <Button type="submit" variant="secondary" loading={searchState === "loading"}>搜索资料</Button>
      </form>

      <div className="assets-workspace__body" data-empty={libraryIsEmpty || undefined}>
        <div className="assets-library" aria-label="项目资料列表">
          {catalogError ? <p className="assets-library__error" role="alert">{catalogError}</p> : null}
          {searchError ? <p className="assets-library__error" role="alert">{searchError}</p> : null}
          {ingestion.length ? (
            <section className="asset-list-section" aria-labelledby="asset-ingestion-heading">
              <header><h2 id="asset-ingestion-heading">本次选择</h2><span>{ingestion.length}</span></header>
              <ul className="asset-list">
                {ingestion.map((file) => (
                  <IngestionRow
                    key={file.filePath}
                    file={file}
                    selected={selectedIngestionPath === file.filePath}
                    onSelect={() => {
                      setSelectedIngestionPath(file.filePath);
                      setSelectedAssetPath(null);
                      setSelectedHit(null);
                    }}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          <section className="asset-list-section" aria-labelledby="asset-files-heading">
            <header><h2 id="asset-files-heading">{searchedQuery ? "匹配文件" : "项目文件"}</h2><span>{visibleAssets.length}</span></header>
            {catalogState === "loading" ? <p className="asset-list-section__state" role="status">正在读取资料清单…</p> : null}
            {catalogState === "error" ? <Button variant="secondary" onClick={() => void loadCatalog(project.projectId)}>重新载入</Button> : null}
            {catalogState === "ready" && visibleAssets.length === 0 ? (
              searchedQuery ? <p className="asset-list-section__state">没有匹配的项目文件。</p> : (
                <div className="asset-library-empty">
                  <FileStack aria-hidden="true" />
                  <h2>还没有项目资料</h2>
                  <p>选择项目文件夹内的术语表、翻译记忆、脚本或参考文档。导入只建立安全引用，不触发模型。</p>
                  <Button variant="primary" onClick={() => void importAssets()}>选择资料</Button>
                </div>
              )
            ) : null}
            <ul className="asset-list">
              {visibleAssets.map((asset) => (
                <AssetRow key={asset.relPath} asset={asset} selected={!selectedIngestion && selectedAssetPath === asset.relPath && !selectedHit} onSelect={() => selectAsset(asset)} />
              ))}
            </ul>
          </section>

          {searchedQuery ? activeSearchGroups.map((group) => (
            <section key={group.id} className="asset-list-section" aria-labelledby={`asset-search-${group.id}`}>
              <header><h2 id={`asset-search-${group.id}`}>{searchGroupLabel(group.id, group.title)}</h2><span>{group.count}{group.count >= 200 ? "+" : ""}</span></header>
              <ul className="asset-list">
                {group.hits.map((hit) => <SearchHitRow key={hit.id} hit={hit} selected={selectedHit?.id === hit.id} onSelect={() => selectHit(hit)} />)}
              </ul>
              {group.count >= 200 ? <p className="asset-list-section__state">已显示前 200 个命中；请缩小搜索范围以定位更多结果。</p> : null}
            </section>
          )) : null}
          {searchedQuery && searchState === "ready" && visibleAssets.length === 0 && activeSearchGroups.length === 0 ? (
            <p className="asset-list-section__state">没有找到“{searchedQuery}”。</p>
          ) : null}
        </div>

        {libraryIsEmpty ? null : selectedIngestion ? (
          <PreviewShell title={fileName(selectedIngestion.filePath)} subtitle={selectedIngestion.relPath ?? "未登记"}>
            <dl className="asset-metadata">
              <div><dt>状态</dt><dd>{ingestionLabels[selectedIngestion.status]}</dd></div>
              <div><dt>原文件</dt><dd>保留在项目文件夹中，没有复制</dd></div>
              {selectedIngestion.asset ? <div><dt>用途</dt><dd>{roleLabel(selectedIngestion.asset.selectedRole)}</dd></div> : null}
            </dl>
            {selectedIngestion.message ? <p className="asset-preview__message">{selectedIngestion.message}</p> : null}
            {selectedIngestion.error ? <p className="asset-preview__error" role="alert">{selectedIngestion.error}</p> : null}
            {selectedIngestion.parse ? <ParsePreview result={selectedIngestion.parse} /> : null}
            {selectedIngestion.read ? (
              <section className="asset-text-preview">
                <h3>内容预览</h3>
                {selectedIngestion.read.skippedReason ? <p>{selectedIngestion.read.skippedReason}</p> : <pre>{selectedIngestion.read.text}</pre>}
              </section>
            ) : null}
          </PreviewShell>
        ) : selectedHitOnly ? (
          <PreviewShell title={fileName(selectedHit.relPath)} subtitle={kindLabel(selectedHit.kind)}>
            <dl className="asset-metadata">
              {selectedHit.sheetName ? <div><dt>工作表</dt><dd>{selectedHit.sheetName}</dd></div> : null}
              {selectedHit.lineNo ? <div><dt>位置</dt><dd>第 {selectedHit.lineNo} 行</dd></div> : null}
              {selectedHit.role ? <div><dt>用途</dt><dd>{roleLabel(selectedHit.role)}</dd></div> : null}
              <div className="asset-metadata__path"><dt>来源</dt><dd>{selectedHit.relPath}</dd></div>
            </dl>
            <section className="asset-search-excerpt">
              <h3>搜索命中</h3>
              {selectedHit.source ? <p><span>源</span>{selectedHit.source}</p> : null}
              {selectedHit.target ? <p><span>译</span>{selectedHit.target}</p> : null}
              {!selectedHit.source && !selectedHit.target ? <p>{selectedHit.text}</p> : null}
              {selectedHit.detail ? <small>{selectedHit.detail}</small> : null}
            </section>
          </PreviewShell>
        ) : selectedAsset ? (
          <PreviewShell title={fileName(selectedAsset.relPath)} subtitle={`${kindLabel(selectedAsset.kind)} · ${roleLabel(selectedAsset.selectedRole)}`}>
            <MetadataList asset={selectedAsset} />
            {selectedHit ? (
              <section className="asset-search-excerpt">
                <h3>搜索命中</h3>
                <p>{selectedHit.source && selectedHit.target ? `${selectedHit.source} → ${selectedHit.target}` : selectedHit.text}</p>
                {selectedHit.detail ? <small>{selectedHit.detail}</small> : null}
              </section>
            ) : null}
            {(selectedAsset.roleReasons.length || selectedAsset.reasons.length) ? (
              <section className="asset-role-reasons">
                <h3>用途依据</h3>
                <ul>{(selectedAsset.roleReasons.length ? selectedAsset.roleReasons : selectedAsset.reasons).map((reason) => <li key={reason}>{reason}</li>)}</ul>
              </section>
            ) : null}
            {previewState === "loading" ? <p className="asset-preview__state" role="status">正在生成本地预览…</p> : null}
            {previewError ? <p className="asset-preview__error" role="alert">{previewError}</p> : null}
            {readPreview ? (
              <section className="asset-text-preview">
                <header><h3>内容预览</h3>{readPreview.truncated ? <span>已显示前 24,000 字符</span> : null}</header>
                {readPreview.skippedReason ? <p>{readPreview.skippedReason}</p> : <pre>{readPreview.text}</pre>}
              </section>
            ) : null}
            {workbookPreview ? (
              <section className="asset-workbook-preview">
                <header><h3>工作簿预览</h3><span>{workbookPreview.sheets.length} 个工作表 · {workbookPreview.engine ?? "local"}</span></header>
                <div className="asset-sheet-tabs" role="group" aria-label="选择工作表">
                  {workbookPreview.sheets.map((sheet) => (
                    <button key={sheet.sheetName} type="button" aria-pressed={selectedSheet === sheet.sheetName} onClick={() => setSelectedSheet(sheet.sheetName)}>
                      <span>{sheet.sheetName}</span><small>{sheet.rowCount} 行</small>
                    </button>
                  ))}
                </div>
                {workbookPage ? (
                  <>
                    <p className="asset-workbook-preview__count">预览前 {workbookPage.rows.length} 行，共 {workbookPage.rowCount} 行。此处是预览，不代表文件被截断或复制。</p>
                    <WorkbookTable page={workbookPage} />
                  </>
                ) : selectedSheet ? <p className="asset-preview__state" role="status">正在读取工作表…</p> : null}
              </section>
            ) : null}
          </PreviewShell>
        ) : (
          <PreviewShell title="选择一项资料"><p className="asset-preview__state">查看文件用途、来源、解析状态和内容预览。</p></PreviewShell>
        )}
      </div>
    </section>
  );
}

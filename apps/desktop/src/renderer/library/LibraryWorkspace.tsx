import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  BookOpenText,
  Brain,
  Check,
  ChevronRight,
  Database,
  FilePlus2,
  FileText,
  LoaderCircle,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  workspaceClient,
  type AssistantLibraryCatalog,
  type AssistantLibraryScope,
  type AssistantLibrarySearchReport,
  type AssistantMemoryDTO,
  type AssistantMemoryKind,
  type AssistantMemoryRecallReport,
  type AssistantMemoryScope,
  type LocalEmbeddingCapabilityStatus,
} from "../data/workspace-client.ts";
import { Button, IconButton } from "../ui/index.ts";
import "./library.css";

type LibraryTab = "documents" | "memories" | "capability";
type LoadState = "idle" | "loading" | "ready" | "error";

export interface LibraryWorkspaceProps {
  projectId: string | null;
  taskId?: string | null;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function scopeLabel(scope: AssistantLibraryScope): string {
  return scope.kind === "personal" ? "Personal" : "Project";
}

function memoryScopeLabel(scope: AssistantMemoryScope): string {
  if (scope.kind === "personal") return "Personal";
  if (scope.kind === "project") return `Project · ${scope.projectId}`;
  if (scope.kind === "client") return `Client · ${scope.clientId}`;
  if (scope.kind === "franchise") return `Franchise · ${scope.franchiseId}`;
  return `Locale · ${scope.locale}`;
}

function scopeId(scope: AssistantMemoryScope): string {
  if (scope.kind === "client") return scope.clientId;
  if (scope.kind === "franchise") return scope.franchiseId;
  if (scope.kind === "project") return scope.projectId;
  if (scope.kind === "locale") return scope.locale;
  return "";
}

function toIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function locationLabel(hit: AssistantLibrarySearchReport["hits"][number]): string {
  if (hit.page) return `Page ${hit.page}`;
  if (hit.sheet) return `Sheet ${hit.sheet} · Row ${hit.lineNo}`;
  if (hit.slide) return `Slide ${hit.slide}`;
  return `Block ${hit.lineNo}`;
}

function ScopeSwitch({ scope, projectId, onChange }: {
  scope: AssistantLibraryScope;
  projectId: string | null;
  onChange: (scope: AssistantLibraryScope) => void;
}) {
  return (
    <div className="assistant-library__scope" role="group" aria-label="Library scope">
      <button type="button" aria-pressed={scope.kind === "personal"} onClick={() => onChange({ kind: "personal" })}>Personal</button>
      <button
        type="button"
        aria-pressed={scope.kind === "project"}
        disabled={!projectId}
        title={projectId ? "当前 Project Library" : "先打开一个项目"}
        onClick={() => projectId && onChange({ kind: "project", projectId })}
      >Project</button>
    </div>
  );
}

function DocumentsPanel({ scope }: { scope: AssistantLibraryScope }) {
  const [catalog, setCatalog] = useState<AssistantLibraryCatalog | null>(null);
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"import" | "reindex" | string | null>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<AssistantLibrarySearchReport | null>(null);
  const [searching, setSearching] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = async () => {
    setState("loading");
    setError(null);
    try {
      setCatalog(await workspaceClient.fetchLibrary(scope));
      setState("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setState("error");
    }
  };

  useEffect(() => {
    setCatalog(null);
    setSearch(null);
    setQuery("");
    void load();
  }, [scope.kind, scope.kind === "project" ? scope.projectId : "personal"]);

  const importFiles = async () => {
    if (busy) return;
    const sourceHandles = await window.linguist.system.pickImportFiles("asset");
    if (!sourceHandles.length) return;
    setBusy("import");
    setError(null);
    try {
      const report = await workspaceClient.importLibrary(scope, sourceHandles, true);
      setCatalog({ schemaVersion: 1, scope, documents: report.documents, updatedAt: new Date().toISOString() });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const reindex = async () => {
    if (busy) return;
    setBusy("reindex");
    setError(null);
    try {
      const report = await workspaceClient.reindexLibrary(scope, true);
      setCatalog({ schemaVersion: 1, scope, documents: report.documents, updatedAt: new Date().toISOString() });
      if (query.trim()) setSearch(await workspaceClient.searchLibrary(scope, query.trim(), { includePersonal: scope.kind === "project", retrievalMode: "hybrid" }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const submitSearch = async (event: FormEvent) => {
    event.preventDefault();
    const value = query.trim();
    if (!value || searching) return;
    setSearching(true);
    setError(null);
    try {
      setSearch(await workspaceClient.searchLibrary(scope, value, { includePersonal: scope.kind === "project", retrievalMode: "hybrid" }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSearching(false);
    }
  };

  const remove = async (documentId: string) => {
    if (busy) return;
    setBusy(documentId);
    setError(null);
    try {
      const report = await workspaceClient.removeLibraryDocument(scope, documentId);
      setCatalog({ schemaVersion: 1, scope, documents: report.documents, updatedAt: new Date().toISOString() });
      setSearch((current) => current ? { ...current, hits: current.hits.filter((hit) => hit.documentId !== documentId) } : null);
      setConfirmDelete(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="assistant-library__panel">
      <section className="assistant-library__hero" aria-labelledby="library-documents-title">
        <div>
          <span className="assistant-library__eyebrow">{scopeLabel(scope)} Library</span>
          <h2 id="library-documents-title">Documents</h2>
          <p>{scope.kind === "personal"
            ? "Only files you explicitly import are shared across Chats. Chat attachments are not indexed automatically."
            : "Current client and project documents. Project evidence takes priority over Personal recall."}</p>
        </div>
        <div className="assistant-library__actions">
          <Button variant="secondary" disabled={Boolean(busy)} onClick={() => void reindex()}>
            <RefreshCw aria-hidden="true" />{busy === "reindex" ? "Indexing…" : "Reindex"}
          </Button>
          <Button variant="primary" disabled={Boolean(busy)} onClick={() => void importFiles()}>
            <FilePlus2 aria-hidden="true" />{busy === "import" ? "Importing…" : "Import files"}
          </Button>
        </div>
      </section>

      <form className="assistant-library__search" onSubmit={submitSearch} role="search">
        <Search aria-hidden="true" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search in Chinese or English" aria-label="Search Library" />
        {query ? <IconButton type="button" aria-label="Clear search" onClick={() => { setQuery(""); setSearch(null); }}><X /></IconButton> : null}
        <Button type="submit" variant="secondary" disabled={!query.trim() || searching}>{searching ? "Searching…" : "Search"}</Button>
      </form>

      {error ? <div className="assistant-library__notice" data-tone="error" role="alert">{error}</div> : null}
      {search ? (
        <section className="assistant-library__results" aria-labelledby="library-results-title">
          <header>
            <div><h3 id="library-results-title">Results</h3><span>{search.hits.length} cited blocks</span></div>
            <span className="assistant-library__semantic" data-state={search.semanticState.state}>
              {search.semanticState.state === "ready" ? "Semantic + lexical" : search.semanticState.state === "blocked" ? "Semantic blocked" : "Lexical only"}
            </span>
          </header>
          {search.semanticState.message ? <p className="assistant-library__muted">{search.semanticState.message}</p> : null}
          <ol>
            {search.hits.map((hit) => (
              <li key={`${hit.scope.kind}:${hit.blockId}`}>
                <div className="assistant-library__result-source">
                  <span>{scopeLabel(hit.scope)}</span>
                  <strong>{hit.originalName}</strong>
                  <span>{locationLabel(hit)}</span>
                </div>
                <p>{hit.text}</p>
                <footer>
                  <span>{hit.retrievalMode}</span>
                  <span>{hit.parserVersion ?? "parser unknown"}</span>
                  <code title={hit.sourceDigest}>{hit.sourceDigest.slice(0, 10)}</code>
                </footer>
              </li>
            ))}
          </ol>
          {!search.hits.length ? <div className="assistant-library__empty">No matching blocks.</div> : null}
        </section>
      ) : null}

      <section className="assistant-library__documents" aria-labelledby="library-managed-title">
        <header><div><h3 id="library-managed-title">Managed sources</h3><span>{catalog?.documents.length ?? 0} files</span></div></header>
        {state === "loading" ? <div className="assistant-library__empty"><LoaderCircle className="assistant-library__spin" />Loading Library…</div> : null}
        {state === "error" ? <div className="assistant-library__empty"><Button variant="secondary" onClick={() => void load()}>Retry</Button></div> : null}
        {state === "ready" && !catalog?.documents.length ? <div className="assistant-library__empty"><BookOpenText />Import only the documents you want LA to recall.</div> : null}
        <ul>
          {catalog?.documents.map((document) => (
            <li key={document.id}>
              <FileText aria-hidden="true" />
              <div>
                <strong>{document.originalName}</strong>
                <span>{formatBytes(document.sizeBytes)} · {document.blockCount} blocks · {formatDate(document.importedAt)}</span>
                <code title={document.sourceDigest}>{document.sourceDigest.slice(0, 16)}</code>
              </div>
              {confirmDelete === document.id ? (
                <div className="assistant-library__confirm">
                  <span>Remove managed copy and index?</span>
                  <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button>
                  <Button variant="destructive" disabled={busy === document.id} onClick={() => void remove(document.id)}>{busy === document.id ? "Removing…" : "Remove"}</Button>
                </div>
              ) : (
                <IconButton aria-label={`Remove ${document.originalName}`} title="Remove" onClick={() => setConfirmDelete(document.id)}><Trash2 /></IconButton>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function MemoriesPanel({ scope, taskId }: { scope: AssistantLibraryScope; taskId?: string | null }) {
  const [memories, setMemories] = useState<AssistantMemoryDTO[]>([]);
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [draftKind, setDraftKind] = useState<AssistantMemoryKind>(scope.kind === "personal" ? "preference" : "guidance");
  const [scopeKind, setScopeKind] = useState<AssistantMemoryScope["kind"]>(scope.kind);
  const [scopeValue, setScopeValue] = useState(scope.kind === "project" ? scope.projectId : "");
  const [draftValidUntil, setDraftValidUntil] = useState("");
  const [draftConflictKey, setDraftConflictKey] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string; kind: AssistantMemoryKind; validUntil: string; conflictKey: string } | null>(null);
  const [previewQuery, setPreviewQuery] = useState("");
  const [preview, setPreview] = useState<AssistantMemoryRecallReport | null>(null);

  const memoryScope: AssistantMemoryScope | null = useMemo(() => {
    const value = scopeValue.trim();
    if (scopeKind === "personal") return { kind: "personal" };
    if (scopeKind === "project") return scope.kind === "project" ? { kind: "project", projectId: scope.projectId } : null;
    if (!value) return null;
    if (scopeKind === "client") return { kind: "client", clientId: value };
    if (scopeKind === "franchise") return { kind: "franchise", franchiseId: value };
    return { kind: "locale", locale: value };
  }, [scope.kind, scope.kind === "project" ? scope.projectId : "", scopeKind, scopeValue]);

  const load = async () => {
    if (!memoryScope) {
      setMemories([]);
      setState("ready");
      return;
    }
    setState("loading");
    setError(null);
    try {
      setMemories((await workspaceClient.listAssistantMemories(memoryScope)).memories);
      setState("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setState("error");
    }
  };

  useEffect(() => {
    setDraft("");
    setDraftKind(scope.kind === "personal" ? "preference" : "guidance");
    setScopeKind(scope.kind);
    setScopeValue(scope.kind === "project" ? scope.projectId : "");
    setDraftValidUntil("");
    setDraftConflictKey("");
    setEditing(null);
  }, [scope.kind, scope.kind === "project" ? scope.projectId : "personal"]);

  useEffect(() => { void load(); }, [memoryScope?.kind, memoryScope ? scopeId(memoryScope) : ""]);

  const update = (memory: AssistantMemoryDTO) => setMemories((current) => [memory, ...current.filter((entry) => entry.id !== memory.id)]);

  const propose = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim() || busy || !memoryScope) return;
    setBusy("proposal");
    setError(null);
    try {
      const { memory } = await workspaceClient.proposeAssistantMemory(memoryScope, {
        kind: draftKind,
        text: draft.trim(),
        source: { taskId: taskId ?? "library-manual" },
        validUntil: toIso(draftValidUntil),
        conflictKey: draftConflictKey.trim() || undefined,
      });
      update(memory);
      setDraft("");
      setDraftValidUntil("");
      setDraftConflictKey("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const act = async (memory: AssistantMemoryDTO, action: "confirm" | "revoke") => {
    if (busy || !memoryScope) return;
    setBusy(memory.id);
    setError(null);
    try {
      const result = action === "confirm"
        ? await workspaceClient.confirmAssistantMemory(memoryScope, memory.id, memory.conflictsWith)
        : await workspaceClient.revokeAssistantMemory(memoryScope, memory.id);
      update(result.memory);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const saveEdit = async (memory: AssistantMemoryDTO) => {
    if (!editing?.text.trim() || busy || !memoryScope) return;
    setBusy(memory.id);
    setError(null);
    try {
      const result = await workspaceClient.editAssistantMemory(memoryScope, memory.id, {
        expectedRevision: memory.revision,
        text: editing.text.trim(),
        kind: editing.kind,
        validUntil: editing.validUntil ? toIso(editing.validUntil) : null,
        conflictKey: editing.conflictKey.trim() || null,
      });
      update(result.memory);
      setEditing(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const ordered = useMemo(() => [...memories].sort((left, right) => {
    const rank = { proposed: 0, active: 1, superseded: 2, revoked: 3 } as const;
    return rank[left.status] - rank[right.status] || right.updatedAt.localeCompare(left.updatedAt);
  }), [memories]);

  const previewRecall = async (event: FormEvent) => {
    event.preventDefault();
    if (!memoryScope || !previewQuery.trim() || busy) return;
    setBusy("preview");
    setError(null);
    try { setPreview(await workspaceClient.searchAssistantMemories(memoryScope, { query: previewQuery.trim() })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(null); }
  };

  return (
    <div className="assistant-library__panel">
      <section className="assistant-library__hero" aria-labelledby="library-memory-title">
        <div>
          <span className="assistant-library__eyebrow">{memoryScope ? memoryScopeLabel(memoryScope) : "Memory scope required"}</span>
          <h2 id="library-memory-title">Confirmed recall</h2>
          <p>Raw Chats remain isolated. Only confirmed preference, fact, or guidance items can be recalled; memory is never client evidence.</p>
        </div>
        <Button variant="secondary" disabled={state === "loading"} onClick={() => void load()}><RefreshCw />Refresh</Button>
      </section>

      <section className="assistant-library__memory-scope" aria-label="Memory scope">
        <label>Scope
          <select value={scopeKind} onChange={(event) => {
            const next = event.target.value as AssistantMemoryScope["kind"];
            setScopeKind(next);
            setScopeValue(next === "project" && scope.kind === "project" ? scope.projectId : "");
            setPreview(null);
          }}>
            <option value="personal">Personal</option>
            <option value="project" disabled={scope.kind !== "project"}>Current Project</option>
            <option value="client">Client (explicit ID)</option>
            <option value="franchise">Franchise (explicit ID)</option>
            <option value="locale">Locale (explicit ID)</option>
          </select>
        </label>
        {scopeKind !== "personal" && scopeKind !== "project" ? <label>{scopeKind === "client" ? "Client ID" : scopeKind === "franchise" ? "Franchise ID" : "Locale"}<input value={scopeValue} onChange={(event) => setScopeValue(event.target.value)} placeholder={scopeKind === "locale" ? "e.g. zh-CN" : "Explicit identifier"} /></label> : null}
        <p>Client and Franchise have no inferred Project mapping. They are included only when you explicitly choose their identifier.</p>
      </section>

      <form className="assistant-library__memory-proposal" onSubmit={propose}>
        <div>
          <label htmlFor="memory-kind">Kind</label>
          <select id="memory-kind" value={draftKind} onChange={(event) => setDraftKind(event.target.value as AssistantMemoryKind)}>
            <option value="preference">Preference</option>
            <option value="fact">Fact</option>
            <option value="guidance">Guidance</option>
          </select>
        </div>
        <label className="assistant-library__memory-text">
          <span>New proposal</span>
          <textarea value={draft} maxLength={20_000} onChange={(event) => setDraft(event.target.value)} placeholder="Propose one durable item. It will remain inactive until you confirm it." />
        </label>
        <label>Expires at (optional)<input type="datetime-local" value={draftValidUntil} onChange={(event) => setDraftValidUntil(event.target.value)} /></label>
        <label>Conflict group (optional)<input value={draftConflictKey} maxLength={256} onChange={(event) => setDraftConflictKey(event.target.value)} placeholder="Explicit user-defined topic" /></label>
        <Button type="submit" variant="primary" disabled={!draft.trim() || !memoryScope || Boolean(busy)}>{busy === "proposal" ? "Proposing…" : "Create proposal"}</Button>
      </form>

      <form className="assistant-library__memory-preview" onSubmit={previewRecall}>
        <label>Recall preview<input value={previewQuery} onChange={(event) => setPreviewQuery(event.target.value)} placeholder="Check lexical/local semantic recall" /></label>
        <Button type="submit" variant="secondary" disabled={!previewQuery.trim() || !memoryScope || Boolean(busy)}><Search />Preview</Button>
        {preview ? <p data-state={preview.semantic.state}>{preview.semantic.state === "ready" ? `Local semantic ready: ${preview.semantic.embeddingModel}` : `Lexical-only: ${preview.semantic.message ?? "managed semantic pack unavailable"}`} · {preview.hits.length} selected · {preview.conflicts.length} conflict group(s) withheld</p> : null}
      </form>

      {error ? <div className="assistant-library__notice" data-tone="error" role="alert">{error}</div> : null}
      {state === "loading" ? <div className="assistant-library__empty"><LoaderCircle className="assistant-library__spin" />Loading memory…</div> : null}
      {state === "ready" && !ordered.length ? <div className="assistant-library__empty"><Brain />No memory has been proposed.</div> : null}
      <ul className="assistant-library__memory-list">
        {ordered.map((memory) => (
          <li key={memory.id} data-status={memory.status}>
            <header>
              <div><span className="assistant-library__memory-kind">{memory.kind}</span><span className="assistant-library__memory-status">{memory.status}</span></div>
              <span>v{memory.revision} · {formatDate(memory.updatedAt)}</span>
            </header>
            {editing?.id === memory.id ? (
              <div className="assistant-library__memory-edit">
                <select value={editing.kind} onChange={(event) => setEditing({ ...editing, kind: event.target.value as AssistantMemoryKind })}>
                  <option value="preference">Preference</option><option value="fact">Fact</option><option value="guidance">Guidance</option>
                </select>
                <textarea value={editing.text} onChange={(event) => setEditing({ ...editing, text: event.target.value })} />
                <input type="datetime-local" value={editing.validUntil} onChange={(event) => setEditing({ ...editing, validUntil: event.target.value })} aria-label="Expiry" />
                <input value={editing.conflictKey} maxLength={256} onChange={(event) => setEditing({ ...editing, conflictKey: event.target.value })} aria-label="Conflict group" />
                <div><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" disabled={busy === memory.id} onClick={() => void saveEdit(memory)}>Save</Button></div>
              </div>
            ) : <p>{memory.text}</p>}
            <div className="assistant-library__memory-source">
              <span>Scope</span><code>{memoryScopeLabel(memory.scope)}</code><span>Source</span><code>{memory.source.taskId}</code>{memory.source.activityId ? <code>{memory.source.activityId}</code> : null}
            </div>
            <div className="assistant-library__memory-meta">{memory.validUntil ? <span data-state={Date.parse(memory.validUntil) <= Date.now() ? "expired" : "expiring"}>{Date.parse(memory.validUntil) <= Date.now() ? "Expired" : `Expires ${formatDate(memory.validUntil)}`}</span> : <span>No expiry</span>}{memory.conflictKey ? <span>Conflict group: {memory.conflictKey}</span> : null}{memory.conflictsWith?.length ? <span data-state="conflict">Conflicts with {memory.conflictsWith.length} active memory item(s)</span> : null}</div>
            <footer>
              <details>
                <summary>History <span>{memory.history.length}</span><ChevronRight /></summary>
                <ol>{memory.history.map((entry) => <li key={entry.revision}><strong>v{entry.revision} · {entry.action}</strong><span>{entry.actor} · {formatDate(entry.at)}</span><p>{entry.text}</p></li>)}</ol>
              </details>
              <div>
                {memory.status === "proposed" ? <Button variant="primary" disabled={busy === memory.id} onClick={() => void act(memory, "confirm")}><Check />{memory.conflictsWith?.length ? "Confirm & supersede conflict" : "Confirm"}</Button> : null}
                {(memory.status === "proposed" || memory.status === "active") && editing?.id !== memory.id ? <Button variant="secondary" disabled={Boolean(busy)} onClick={() => setEditing({ id: memory.id, text: memory.text, kind: memory.kind, validUntil: memory.validUntil ? new Date(memory.validUntil).toISOString().slice(0, 16) : "", conflictKey: memory.conflictKey ?? "" })}>Edit</Button> : null}
                {(memory.status === "proposed" || memory.status === "active" || memory.status === "superseded") ? <Button variant="secondary" disabled={busy === memory.id} onClick={() => void act(memory, "revoke")}><Trash2 />Revoke</Button> : null}
              </div>
            </footer>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CapabilityPanel() {
  const [status, setStatus] = useState<LocalEmbeddingCapabilityStatus | null>(null);
  const [state, setState] = useState<LoadState>("idle");
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setState("loading");
    setError(null);
    try { setStatus(await workspaceClient.fetchLocalEmbeddingCapability()); setState("ready"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setState("error"); }
  };
  useEffect(() => { void load(); }, []);

  const install = async () => {
    if (installing) return;
    setInstalling(true);
    setError(null);
    try { setStatus(await workspaceClient.installLocalEmbeddingCapability()); setState("ready"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setInstalling(false); }
  };

  return (
    <div className="assistant-library__panel">
      <section className="assistant-library__hero" aria-labelledby="library-capability-title">
        <div><span className="assistant-library__eyebrow">Managed capability</span><h2 id="library-capability-title">Multilingual retrieval</h2><p>The embedding model runs locally. It is not placed in the Agent prompt and no cloud embedding service is required.</p></div>
        <Button variant="secondary" disabled={state === "loading" || installing} onClick={() => void load()}><RefreshCw />Check</Button>
      </section>
      {error ? <div className="assistant-library__notice" data-tone="error" role="alert">{error}</div> : null}
      <section className="assistant-library__capability-card">
        <div className="assistant-library__capability-icon"><Sparkles /></div>
        <div>
          <span className="assistant-library__eyebrow">Xenova/multilingual-e5-small</span>
          <h3>{status?.state === "ready" ? "Ready" : status?.state === "corrupt" ? "Repair required" : "Not installed"}</h3>
          <p>{status?.message ?? "Pinned multilingual E5 model with a verified model and tokenizer."}</p>
          <dl>
            <div><dt>Revision</dt><dd><code>{status?.revision?.slice(0, 12) ?? "761b726dd34f"}</code></dd></div>
            <div><dt>Dimensions</dt><dd>{status?.dimensions ?? 384}</dd></div>
            <div><dt>Runtime</dt><dd>Transformers.js · uint8 · local only</dd></div>
            {status?.lock?.installedAt ? <div><dt>Installed</dt><dd>{formatDate(status.lock.installedAt)}</dd></div> : null}
          </dl>
        </div>
        <div className="assistant-library__capability-action">
          {status?.state === "ready" ? <span><Check />SHA-256 verified</span> : (
            <Button variant="primary" disabled={installing} onClick={() => void install()}>{installing ? "Downloading and verifying…" : status?.state === "corrupt" ? "Repair pack" : "Install pack"}</Button>
          )}
          <small>Explicit action only. About 130 MB; active Agent Runs must finish first.</small>
        </div>
      </section>
      <div className="assistant-library__notice"><Database /><span>After installation, reindex each Library scope. Missing or damaged packs remain visibly lexical-only.</span></div>
    </div>
  );
}

export function LibraryWorkspace({ projectId, taskId }: LibraryWorkspaceProps) {
  const [tab, setTab] = useState<LibraryTab>("documents");
  const [scope, setScope] = useState<AssistantLibraryScope>({ kind: "personal" });

  useEffect(() => {
    if (scope.kind === "project" && scope.projectId !== projectId) setScope({ kind: "personal" });
  }, [projectId, scope]);

  return (
    <section className="assistant-library" aria-label="Library and memory">
      <header className="assistant-library__header">
        <div><span className="assistant-library__eyebrow">Linguist Agent</span><h1>Library</h1></div>
        {tab !== "capability" ? <ScopeSwitch scope={scope} projectId={projectId} onChange={setScope} /> : null}
      </header>
      <nav className="assistant-library__tabs" aria-label="Library sections">
        <button type="button" aria-current={tab === "documents" ? "page" : undefined} onClick={() => setTab("documents")}><BookOpenText />Documents</button>
        <button type="button" aria-current={tab === "memories" ? "page" : undefined} onClick={() => setTab("memories")}><Brain />Memory</button>
        <button type="button" aria-current={tab === "capability" ? "page" : undefined} onClick={() => setTab("capability")}><Sparkles />Embedding pack</button>
      </nav>
      {tab === "documents" ? <DocumentsPanel scope={scope} /> : null}
      {tab === "memories" ? <MemoriesPanel scope={scope} taskId={taskId} /> : null}
      {tab === "capability" ? <CapabilityPanel /> : null}
    </section>
  );
}

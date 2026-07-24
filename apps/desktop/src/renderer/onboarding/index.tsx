import { type FormEvent, useRef, useState } from "react";
import { workspaceClient } from "../data/workspace-client.ts";
import { WorkspaceStore, workspaceStore } from "../data/workspace-store.ts";
import { Button, StatusLabel } from "../ui/index.ts";
import {
  createProjectFromPicker,
  importBatchesFromPicker,
  shouldDismissBatchImport,
  type BatchImportFileResult,
  type ProjectDraft,
} from "./actions.ts";
import "./onboarding.css";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface NewProjectFlowProps {
  store?: WorkspaceStore;
  onCancel?(): void;
  onCreated?(projectId: string): void;
}

export function NewProjectFlow({ store = workspaceStore, onCancel, onCreated }: NewProjectFlowProps) {
  const folderPickerButtonRef = useRef<HTMLButtonElement>(null);
  const [step, setStep] = useState<"metadata" | "folder">("metadata");
  const [draft, setDraft] = useState<ProjectDraft>({ name: "", sourceLocale: "", targetLocale: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function continueToFolder(event: FormEvent) {
    event.preventDefault();
    if (!draft.name.trim() || !draft.sourceLocale.trim() || !draft.targetLocale.trim()) {
      setError("请填写项目名称、源语言和目标语言。");
      return;
    }
    setError(null);
    setStep("folder");
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await createProjectFromPicker(draft, {
        pickProjectFolder: () => window.linguist.system.pickProjectFolder(),
        createProject: workspaceClient.createProject,
        refreshProjects: () => store.refreshProjects(),
        selectProject: (projectId) => store.selectProject(projectId),
        onFolderSelected: (folderHandle) => setDraft((current) => ({ ...current, folderHandle })),
      });
      if (result.status === "created") onCreated?.(result.projectId);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
      requestAnimationFrame(() => folderPickerButtonRef.current?.focus());
    }
  }

  return (
    <section className="la-onboarding" aria-labelledby="new-project-title">
      <header className="la-onboarding__header">
        <p className="la-onboarding__eyebrow">{step === "metadata" ? "1 / 2" : "2 / 2"}</p>
        <h1 id="new-project-title">新建本地化项目</h1>
        <p>{step === "metadata" ? "先定义项目与语言范围。" : "再通过系统选择器明确授权一个项目文件夹。"}</p>
      </header>

      {step === "metadata" ? (
        <form className="la-onboarding__form" onSubmit={continueToFolder}>
          <label>
            <span>项目名称</span>
            <input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：合成游戏项目" />
          </label>
          <div className="la-onboarding__locales">
            <label>
              <span>源语言</span>
              <input value={draft.sourceLocale} onChange={(event) => setDraft({ ...draft, sourceLocale: event.target.value })} placeholder="例如 zh-CN" autoCapitalize="off" spellCheck={false} />
            </label>
            <span aria-hidden="true">→</span>
            <label>
              <span>目标语言</span>
              <input value={draft.targetLocale} onChange={(event) => setDraft({ ...draft, targetLocale: event.target.value })} placeholder="例如 en-US" autoCapitalize="off" spellCheck={false} />
            </label>
          </div>
          <p className="la-onboarding__hint">创建项目和导入文件都不会产生模型费用。</p>
          {error ? <p className="la-onboarding__error" role="alert">{error}</p> : null}
          <footer className="la-onboarding__actions">
            {onCancel ? <Button variant="ghost" onClick={onCancel}>取消</Button> : null}
            <Button variant="primary" type="submit">继续</Button>
          </footer>
        </form>
      ) : (
        <form className="la-onboarding__form" onSubmit={(event) => void create(event)}>
          <div className="la-onboarding__folder">
            <span>{draft.folderHandle ? draft.folderHandle.name : "尚未选择文件夹"}</span>
            <small>{draft.folderHandle ? "已明确选择；创建失败时会保留" : "只访问你在系统选择器中选中的位置"}</small>
          </div>
          <p className="la-onboarding__hint">创建完成后进入 Batch 导入；Agent 不会自动运行。</p>
          {error ? <p className="la-onboarding__error" role="alert">{error}</p> : null}
          <footer className="la-onboarding__actions">
            <Button variant="ghost" onClick={() => setStep("metadata")} disabled={busy}>返回</Button>
            <Button ref={folderPickerButtonRef} variant="primary" type="submit" loading={busy} loadingLabel="正在创建…">
              {draft.folderHandle ? "重试创建" : "选择文件夹并创建"}
            </Button>
          </footer>
        </form>
      )}
    </section>
  );
}

export interface ImportBatchActionProps {
  projectId: string;
  store?: WorkspaceStore;
  onImported?(batchId: string): void;
}

export function ImportBatchAction({ projectId, store = workspaceStore, onImported }: ImportBatchActionProps) {
  const filePickerButtonRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<BatchImportFileResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function runImport() {
    setBusy(true);
    setError(null);
    try {
      const outcome = await importBatchesFromPicker(projectId, {
        pickImportFiles: () => window.linguist.system.pickImportFiles("batch"),
        importBatch: workspaceClient.importBatch,
        refreshProjects: () => store.refreshProjects(),
        openBatch: (selectedProjectId, batchId) => store.openBatch(selectedProjectId, batchId),
      });
      setResults(outcome.results);
      setError(outcome.followUpError ?? null);
      if (shouldDismissBatchImport(outcome)) onImported?.(outcome.openedBatchId!);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
      requestAnimationFrame(() => filePickerButtonRef.current?.focus());
    }
  }

  return (
    <section className="la-import-action" aria-labelledby="import-batch-title">
      <div className="la-import-action__heading">
        <div>
          <h2 id="import-batch-title">导入 Batch</h2>
          <p>选择一个或多个 CAT 文件。导入只解析文件，不会启动 Agent。</p>
        </div>
        <Button ref={filePickerButtonRef} variant="primary" onClick={() => void runImport()} loading={busy} loadingLabel="正在导入…">选择文件…</Button>
      </div>
      {results.length ? (
        <ul className="la-import-results" aria-live="polite">
          {results.map((result) => (
            <li key={result.file.id}>
              <span>{result.file.name}</span>
              <StatusLabel state={result.status === "imported" ? "complete" : "failed"}>
                {result.status === "imported" ? `${result.segmentCount ?? 0} 个句段` : result.message ?? "导入失败"}
              </StatusLabel>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="la-onboarding__error" role="alert">{error}</p> : null}
    </section>
  );
}

export * from "./actions.ts";

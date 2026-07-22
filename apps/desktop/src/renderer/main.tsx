import { Component, StrictMode, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ImportBatchAction, NewProjectFlow } from "./onboarding/index.tsx";
import { ProductWorkspace } from "./shell/index.ts";
import "./font-choice.ts";
import "./theme-choice.ts";
import "./styles.css";

type Overlay =
  | { kind: "new-project" }
  | { kind: "import-batch"; projectId: string }
  | null;

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Electron renderer failed", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="desktop-fatal" role="alert">
        <p>工作区发生错误</p>
        <h1>界面未能继续渲染</h1>
        <span>{this.state.error.message}</span>
        <button type="button" onClick={() => window.location.reload()}>重新载入工作区</button>
      </main>
    );
  }
}

function WorkspaceDialog({ overlay, onClose }: { overlay: Exclude<Overlay, null>; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="workspace-dialog"
      aria-label={overlay.kind === "new-project" ? "新建项目" : "导入 Batch"}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
    >
      {overlay.kind === "new-project" ? (
        <NewProjectFlow onCancel={onClose} onCreated={onClose} />
      ) : (
        <div className="workspace-dialog__body">
          <ImportBatchAction projectId={overlay.projectId} onImported={onClose} />
          <button className="workspace-dialog__close" type="button" onClick={onClose}>关闭</button>
        </div>
      )}
    </dialog>
  );
}

function App() {
  const [overlay, setOverlay] = useState<Overlay>(null);

  return (
    <>
      <div className="desktop-drag-region" aria-hidden="true" />
      <ProductWorkspace
        onCreateProject={() => setOverlay({ kind: "new-project" })}
        onImportBatch={(projectId) => setOverlay({ kind: "import-batch", projectId })}
      />
      {overlay ? <WorkspaceDialog overlay={overlay} onClose={() => setOverlay(null)} /> : null}
    </>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Renderer root is missing.");
createRoot(root).render(<StrictMode><AppErrorBoundary><App /></AppErrorBoundary></StrictMode>);

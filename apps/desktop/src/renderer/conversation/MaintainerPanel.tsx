import { useEffect, useMemo, useState } from "react";
import { ChevronDown, FolderKey, LoaderCircle, ShieldCheck, Wrench } from "lucide-react";
import {
  workspaceClient,
  type MaintenanceActivationHandoff,
  type MaintenanceJobDTO,
  type MaintenancePlanDTO,
  type StandaloneFileGrantDTO,
} from "../data/workspace-client.ts";
import { Button } from "../ui/index.ts";

export interface MaintainerPanelProps {
  taskId: string;
  disabled?: boolean;
  onCanonicalUpdate: () => Promise<unknown>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function MaintainerPanel({ taskId, disabled = false, onCanonicalUpdate }: MaintainerPanelProps) {
  const [grants, setGrants] = useState<StandaloneFileGrantDTO[]>([]);
  const [grantId, setGrantId] = useState("");
  const [targetPiVersion, setTargetPiVersion] = useState("");
  const [plan, setPlan] = useState<MaintenancePlanDTO | null>(null);
  const [job, setJob] = useState<MaintenanceJobDTO | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [handoff, setHandoff] = useState<MaintenanceActivationHandoff | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const repositories = useMemo(
    () => grants.filter((grant) => grant.kind === "directory" && grant.access === "read_write" && grant.recursive),
    [grants],
  );

  const refreshGrants = async () => {
    const response = await workspaceClient.listChatFileGrants(taskId);
    setGrants(response.grants);
    setGrantId((current) => current || response.grants.find((grant) => grant.kind === "directory" && grant.access === "read_write" && grant.recursive)?.id || "");
  };

  useEffect(() => {
    if (job?.status !== "running") return;
    const timer = window.setInterval(() => {
      void workspaceClient.fetchMaintenanceBuild(taskId).then(async ({ job: next }) => {
        setJob(next);
        if (next.status !== "running") {
          window.clearInterval(timer);
          if (next.status === "complete") {
            setStatus("Candidate validated. Review the report, then approve the exact report hash.");
            await onCanonicalUpdate();
          } else setError(next.error?.message ?? "Candidate validation failed.");
        }
      }).catch((cause) => setError(errorMessage(cause)));
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [job?.status, onCanonicalUpdate, taskId]);

  const grantRepository = async () => {
    setBusy(true);
    setError(null);
    try {
      const path = await window.linguist.system.pickProjectFolder();
      if (!path) return;
      const response = await workspaceClient.createChatFileGrant(taskId, {
        path,
        kind: "directory",
        access: "read_write",
        recursive: true,
      });
      setGrants(response.grants);
      setGrantId(response.grant.id);
      setStatus("Repository access granted to this Chat only.");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const preview = async () => {
    if (!grantId || !targetPiVersion.trim()) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    setPlan(null);
    setJob(null);
    setHandoff(null);
    try {
      const response = await workspaceClient.previewMaintenance(taskId, { grantId, targetPiVersion: targetPiVersion.trim() });
      setPlan(response.plan);
      setStatus("Read-only inspection complete. The current worktree has not been modified.");
      await onCanonicalUpdate();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const build = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const response = await workspaceClient.startMaintenanceBuild(taskId, plan.planHash);
      setJob(response.job);
      setStatus("Building and validating the isolated candidate. You may leave this panel open in the background.");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const activate = async () => {
    const candidate = job?.candidate;
    if (!candidate) return;
    setBusy(true);
    setError(null);
    try {
      const response = await workspaceClient.approveMaintenanceActivation(taskId, {
        reportSha256: candidate.reportSha256,
        confirmation: confirmation.trim(),
      });
      setHandoff(response.handoff);
      if (response.handoff.action === "electron_runtime_installer") {
        const result = await window.linguist.runtime.installCandidate({ bundleRoot: response.handoff.candidateBundleRoot });
        if (!result.ok) throw new Error(result.message);
        setStatus(result.message);
      } else {
        await window.linguist.system.revealPath(response.handoff.candidateAppPath);
        setStatus("Protocol mismatch blocks runtime-only activation. The full signed app candidate is ready for manual installation.");
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const candidate = job?.candidate;
  const expectedConfirmation = candidate ? `activate ${candidate.reportSha256.slice(0, 12)}` : "";

  return (
    <details className="conversation-maintainer" onToggle={(event) => {
      if (event.currentTarget.open && grants.length === 0) void refreshGrants().catch((cause) => setError(errorMessage(cause)));
    }}>
      <summary><Wrench aria-hidden="true" /><span>Runtime maintenance</span><span className="conversation-maintainer__summary">isolated candidate</span><ChevronDown aria-hidden="true" /></summary>
      <div className="conversation-maintainer__panel">
        <header>
          <div><strong>Runtime maintenance</strong><p>Inspect, build, validate, then activate an isolated Pi runtime candidate with two exact approvals. Never edits the running instance.</p></div>
          <ShieldCheck aria-hidden="true" />
        </header>
        <div className="conversation-maintainer__fields">
          <label><span>Repository grant</span><select value={grantId} disabled={disabled || busy} onChange={(event) => setGrantId(event.target.value)}><option value="">Choose a read/write repository…</option>{repositories.map((grant) => <option key={grant.id} value={grant.id}>{grant.realPath}</option>)}</select></label>
          <label><span>Target Pi version</span><input value={targetPiVersion} disabled={disabled || busy} onChange={(event) => setTargetPiVersion(event.target.value)} placeholder="0.80.11" inputMode="decimal" /></label>
        </div>
        <div className="conversation-maintainer__actions">
          <Button variant="ghost" disabled={disabled || busy} onClick={() => void grantRepository()}><FolderKey aria-hidden="true" />Grant repository</Button>
          <Button disabled={disabled || busy || !grantId || !targetPiVersion.trim()} onClick={() => void preview()}>{busy && !plan ? <LoaderCircle className="conversation-composer__spin" aria-hidden="true" /> : null}Create plan</Button>
        </div>
        {plan ? <section className="conversation-maintainer__report" aria-label="Maintenance plan">
          <div><span>Candidate baseline</span><strong>Pi {plan.current.piVersion}</strong></div><div><span>Target</span><strong>Pi {plan.target.piVersion}</strong></div><div><span>Repository</span><strong>{plan.repository.dirty ? `Dirty · ${plan.repository.changedPaths.length} paths` : "Clean"}</strong></div><div><span>Candidate</span><strong>Isolated worktree</strong></div>
          {plan.workingTree.piVersion !== plan.current.piVersion ? <p>Working tree pins Pi {plan.workingTree.piVersion}; the candidate is deliberately seeded from approved HEAD Pi {plan.current.piVersion}.</p> : null}
          <code>{plan.planHash}</code>
          <Button disabled={disabled || busy || job?.status === "running"} onClick={() => void build()}>Approve plan &amp; build candidate</Button>
        </section> : null}
        {job ? <section className="conversation-maintainer__job" data-state={job.status}>
          <strong>{job.status === "running" ? "Validating candidate…" : job.status === "complete" ? "Candidate validated" : "Candidate failed"}</strong>
          {job.status === "running" ? <p>Focused tests, full tests, typecheck, packaging, verification and release checks run in the isolated worktree.</p> : null}
          {job.error ? <p>{job.error.message}</p> : null}
          {candidate ? <><p>{candidate.validation.length} checks passed · {candidate.changedPaths.length} changed paths · {candidate.disposition === "runtime_candidate" ? "runtime compatible" : "full app required"}</p><p>{candidate.migration.status === "completed" ? `Maintainer Agent: ${candidate.migration.summary}` : candidate.migration.summary}</p><code>{candidate.reportSha256}</code><label><span>Second approval</span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={expectedConfirmation} /></label><Button disabled={disabled || busy || confirmation.trim() !== expectedConfirmation} onClick={() => void activate()}>{candidate.disposition === "runtime_candidate" ? "Activate validated runtime" : "Reveal full app candidate"}</Button></> : null}
        </section> : null}
        {handoff ? <p className="conversation-maintainer__handoff">Approved handoff: {handoff.action}</p> : null}
        {status ? <p className="conversation-maintainer__status" role="status">{status}</p> : null}
        {error ? <p className="conversation-maintainer__error" role="alert">{error}</p> : null}
      </div>
    </details>
  );
}

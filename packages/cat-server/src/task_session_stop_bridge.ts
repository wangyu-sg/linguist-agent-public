export interface TaskSessionStopTarget {
  abort(): Promise<void>;
  dispose(): void;
}

export class TaskSessionForcedStopError extends Error {
  constructor(message = "Task Session was forcibly stopped.") {
    super(message);
    this.name = "TaskSessionForcedStopError";
  }
}

/**
 * Gives ActiveAgentRunRegistry a stable handle before Pi finishes constructing
 * its real Session. Disposal is the terminal signal: it tears down an already
 * bound Session immediately and rejects every active prompt race.
 */
export function createTaskSessionStopBridge() {
  let boundSession: TaskSessionStopTarget | undefined;
  let abortRequested = false;
  let disposeRequested = false;
  let boundSessionDisposed = false;
  let forcedStopError: TaskSessionForcedStopError | undefined;
  let rejectForcedStop!: (error: TaskSessionForcedStopError) => void;
  const forcedStop = new Promise<never>((_resolve, reject) => { rejectForcedStop = reject; });
  void forcedStop.catch(() => undefined);

  const disposeBoundSession = (): void => {
    if (!boundSession || boundSessionDisposed) return;
    boundSessionDisposed = true;
    boundSession.dispose();
  };

  const forceStop = (): void => {
    disposeRequested = true;
    if (!forcedStopError) {
      forcedStopError = new TaskSessionForcedStopError();
      rejectForcedStop(forcedStopError);
    }
    disposeBoundSession();
  };

  const registrySession: TaskSessionStopTarget = {
    async abort() {
      abortRequested = true;
      if (boundSession) await boundSession.abort();
    },
    dispose: forceStop,
  };

  const bind = <Session extends TaskSessionStopTarget>(session: Session): Session => {
    if (boundSession) throw new Error("Task Session Stop bridge is already bound.");
    boundSession = session;
    if (disposeRequested) {
      disposeBoundSession();
      throw forcedStopError ?? new TaskSessionForcedStopError();
    }
    if (abortRequested) void session.abort().catch(() => undefined);
    return session;
  };

  return {
    registrySession,
    forcedStop,
    bind,
    isForcedStopError(error: unknown): boolean {
      return error === forcedStopError || error instanceof TaskSessionForcedStopError;
    },
    throwIfForcedStopped(): void {
      if (forcedStopError) throw forcedStopError;
    },
  };
}

/**
 * TaskManager — tracks subagent (Task tool) invocations.
 *
 * Why a manager and not just calling `queryLoop` inline?
 *  - Subagents are run inside a SINGLE tool call from the parent's
 *    perspective but produce many events (tokens, child tool calls,
 *    cost, retries). Surfacing all of those into the parent stream
 *    would drown out the parent's own output.
 *  - Users may want to peek at a running subagent ("what's it doing
 *    right now?") via the RunningTasksTray. The manager owns the
 *    metadata (agent_task row), the AbortController, and the most
 *    recent text snippet.
 *
 * Public API:
 *   - `start({ projectId, conversationId, type, payload, run })` →
 *     allocates a row, kicks off `run(signal)`, returns `{ id, abort }`.
 *     On completion / error / cancel the row's `status` / `result_json`
 *     / `ended_at` are updated and the bookkeeping map is cleaned.
 *   - `cancel(id)` — abort a running task.
 *   - `cancelAllForProject(projectId)` — used on app exit.
 *   - `snapshot(projectId)` — last-N tasks for the UI.
 */

import { AppDatabase } from "../../db/database.js";
import type { AgentTask } from "../../db/agent-store.js";

export interface TaskRunHandle {
  id: string;
  abort: () => void;
  promise: Promise<TaskResult>;
}

export interface TaskResult {
  status: "completed" | "errored" | "cancelled";
  /** Final text the subagent produced (last assistant message). */
  text?: string;
  /** Free-form payload tools may attach (e.g. structured findings). */
  data?: unknown;
  /** Human-readable error when status === "errored". */
  errorMessage?: string;
}

interface RunningEntry {
  task: AgentTask;
  ac: AbortController;
  promise: Promise<TaskResult>;
}

export class TaskManager {
  private running = new Map<string, RunningEntry>();

  constructor(private readonly db: AppDatabase) {
    // On boot, any rows left in pending/running belong to a previous
    // process — flip them to "killed" so the tray UI doesn't show
    // ghosts. The IPC layer calls this at startup.
    this.db.agent.killOrphanTasks();
  }

  start(input: {
    projectId: string;
    conversationId: string | null;
    type: string;
    payload: unknown;
    run: (signal: AbortSignal) => Promise<TaskResult>;
  }): TaskRunHandle {
    const task = this.db.agent.insertAgentTask({
      projectId: input.projectId,
      conversationId: input.conversationId,
      type: input.type,
      payload: input.payload
    });
    this.db.agent.updateAgentTask(task.id, { status: "running" });

    const ac = new AbortController();
    const promise: Promise<TaskResult> = (async () => {
      try {
        const result = await input.run(ac.signal);
        const dbStatus: "completed" | "failed" | "killed" =
          result.status === "cancelled" ? "killed" : result.status === "errored" ? "failed" : "completed";
        this.db.agent.updateAgentTask(task.id, {
          status: dbStatus,
          resultJson: JSON.stringify(result),
          endedAt: Date.now()
        });
        return result;
      } catch (e) {
        const errored: TaskResult = {
          status: ac.signal.aborted ? "cancelled" : "errored",
          errorMessage: (e as Error)?.message ?? String(e)
        };
        this.db.agent.updateAgentTask(task.id, {
          status: ac.signal.aborted ? "killed" : "failed",
          resultJson: JSON.stringify(errored),
          endedAt: Date.now()
        });
        return errored;
      } finally {
        this.running.delete(task.id);
      }
    })();

    this.running.set(task.id, { task, ac, promise });
    return {
      id: task.id,
      abort: () => ac.abort(),
      promise
    };
  }

  cancel(id: string): boolean {
    const e = this.running.get(id);
    if (!e) return false;
    e.ac.abort();
    return true;
  }

  cancelAllForProject(projectId: string): number {
    let n = 0;
    for (const [, e] of this.running) {
      if (e.task.projectId === projectId) {
        e.ac.abort();
        n += 1;
      }
    }
    return n;
  }

  cancelAll(): number {
    let n = 0;
    for (const [, e] of this.running) {
      e.ac.abort();
      n += 1;
    }
    return n;
  }

  /** Snapshot of recent tasks (running + recently-finished) for a
   *  project. Pure read from the DB so it reflects persistent state. */
  snapshot(projectId: string, limit = 20): AgentTask[] {
    return this.db.agent.listAgentTasks(projectId, limit);
  }
}

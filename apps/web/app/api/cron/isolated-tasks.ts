/** Where a failed task is logged. */
export interface IsolatedTaskLogs {
  /**
   * The request's wide event. It merges every error into one, so a second
   * failure overwrites the first one's message and stack.
   */
  request: { error(error: Error, context: Record<string, unknown>): void };
  /** One event per failure, which keeps its own message and stack. */
  event: { error(event: Record<string, unknown>): void };
}

export interface IsolatedTask {
  /** Its name in the cron's task list and in the logs. */
  task: string;
  /** The key of its result in the cron response. */
  key: string;
  run: () => Promise<unknown>;
}

/**
 * Runs the tasks in turn. A failure is logged, its result is `{ failed: true }`,
 * and the next tasks still run. It never throws.
 */
export async function runIsolatedTasks(
  isolated: readonly IsolatedTask[],
  logs: IsolatedTaskLogs,
): Promise<{ tasks: string[]; results: Record<string, unknown> }> {
  const tasks: string[] = [];
  const results: Record<string, unknown> = {};
  for (const { task, key, run } of isolated) {
    tasks.push(task);
    try {
      results[key] = await run();
    } catch (caught) {
      const error = caught instanceof Error ? caught : new Error(String(caught));
      logs.event.error({
        cron: {
          event: "task_failed",
          task,
          error: { name: error.name, message: error.message, stack: error.stack },
        },
      });
      // evlog appends arrays when it merges, so this list keeps every failed task.
      logs.request.error(error, { cron: { failedTasks: [task] } });
      results[key] = { failed: true };
    }
  }
  return { tasks, results };
}

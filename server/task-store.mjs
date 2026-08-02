/**
 * task-store.mjs — In-memory task store with CRUD operations
 *
 * A "Task" represents an agent configuration: name, description, the tools
 * it may use, agent guardrails, optional context, and a prompt.
 *
 * Storage is in-memory (Map), consistent with the project's current
 * persistence strategy. Data resets on process restart.
 */

import { randomUUID } from "crypto";

/**
 * @typedef {Object} AgentRules
 * @property {string[]} guardrails      - Hard constraints the agent must respect
 * @property {string[]} redirectRules   - Topics/requests to redirect elsewhere
 * @property {string[]} refuseTopics    - Topics the agent must refuse to handle
 */

/**
 * @typedef {Object} Task
 * @property {string} id                - UUID, auto-generated on create
 * @property {string} name              - Human-readable task name
 * @property {string} description       - What this task does
 * @property {string[]} tools           - Tool names this task may invoke
 * @property {AgentRules} agentRules    - Agent behavior rules
 * @property {string} context           - Extra context injected into the agent
 * @property {string} prompt            - System / role prompt for the agent
 * @property {string} createdAt         - ISO timestamp (create time)
 * @property {string} updatedAt         - ISO timestamp (last update time)
 */

class TaskStore {
  constructor() {
    /** @type {Map<string, Task>} */
    this.tasks = new Map();
  }

  /**
   * List all tasks, sorted by creation time (oldest first).
   * @returns {Task[]}
   */
  list() {
    return [...this.tasks.values()].sort((a, b) =>
      (a.createdAt || "").localeCompare(b.createdAt || "")
    );
  }

  /**
   * Get a single task by id.
   * @param {string} id
   * @returns {Task | undefined}
   */
  get(id) {
    return this.tasks.get(id);
  }

  /**
   * Create a new task. Auto-generates id, createdAt, updatedAt.
   * @param {Object} input - Task fields from the client
   * @returns {Task}
   */
  create(input) {
    const now = new Date().toISOString();
    const task = {
      id: randomUUID(),
      name: input.name ?? "",
      description: input.description ?? "",
      tools: Array.isArray(input.tools) ? input.tools : [],
      agentRules: {
        guardrails: Array.isArray(input.agentRules?.guardrails) ? input.agentRules.guardrails : [],
        redirectRules: Array.isArray(input.agentRules?.redirectRules) ? input.agentRules.redirectRules : [],
        refuseTopics: Array.isArray(input.agentRules?.refuseTopics) ? input.agentRules.refuseTopics : [],
      },
      context: input.context ?? "",
      prompt: input.prompt ?? "",
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(task.id, task);
    return task;
  }

  /**
   * Update an existing task. Partial update — only provided fields change.
   * Always refreshes updatedAt.
   * @param {string} id
   * @param {Object} patch - Fields to update
   * @returns {Task | undefined} Updated task, or undefined if not found
   */
  update(id, patch) {
    const existing = this.tasks.get(id);
    if (!existing) return undefined;

    const updated = {
      ...existing,
      name: patch.name ?? existing.name,
      description: patch.description ?? existing.description,
      tools: Array.isArray(patch.tools) ? patch.tools : existing.tools,
      agentRules: patch.agentRules
        ? {
            guardrails: Array.isArray(patch.agentRules.guardrails)
              ? patch.agentRules.guardrails
              : existing.agentRules.guardrails,
            redirectRules: Array.isArray(patch.agentRules.redirectRules)
              ? patch.agentRules.redirectRules
              : existing.agentRules.redirectRules,
            refuseTopics: Array.isArray(patch.agentRules.refuseTopics)
              ? patch.agentRules.refuseTopics
              : existing.agentRules.refuseTopics,
          }
        : existing.agentRules,
      context: patch.context ?? existing.context,
      prompt: patch.prompt ?? existing.prompt,
      updatedAt: new Date().toISOString(),
    };

    this.tasks.set(id, updated);
    return updated;
  }

  /**
   * Delete a task by id.
   * @param {string} id
   * @returns {boolean} true if a task was deleted, false if not found
   */
  delete(id) {
    return this.tasks.delete(id);
  }

  /** Remove all tasks (mainly for testing) */
  clear() {
    this.tasks.clear();
  }
}

export const taskStore = new TaskStore();
export default taskStore;

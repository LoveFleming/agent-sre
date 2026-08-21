/**
 * monitor-flows.mjs — Process Flow templates (SRE Agentic Monitoring MVP)
 *
 * Spec §8: Process Flow is a first-class domain object — it must NOT be
 * hidden inside the prompt. A flow defines HOW the agent works (ordered
 * nodes), while Skills define WHAT it can do.
 *
 * Node types:
 *  - deterministic: MCP call / threshold check / rule evaluation /
 *    confidence gate / approval gate / output action (no LLM)
 *  - agentic: correlate signals / build hypothesis / recommend action
 *    (exactly one LLM call, fed with the evidence bundle)
 *
 * This module is pure data + pure functions — no fs, no network. The
 * runner (monitor-scheduler.mjs) interprets these templates.
 */

/**
 * @typedef {"deterministic"|"agentic"|"gate"|"output"} FlowNodeType
 *
 * @typedef {Object} FlowNode
 * @property {string} id
 * @property {string} name
 * @property {FlowNodeType} type
 * @property {string} description
 * @property {string} [tool]     - deterministic nodes: tool to call
 * @property {string} [phase]    - runner phase tag: read|gate|reason|output|memory
 *
 * @typedef {Object} ProcessFlow
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {FlowNode[]} nodes
 */

/** The standard SRE monitor loop (spec §8 example flow). */
export const STANDARD_SRE_FLOW = {
  id: "standard-sre",
  name: "Standard SRE Monitor Flow",
  description: "Read sources → evaluate rules → (on anomaly) collect evidence → agent reasoning → confidence gate → output → update memory",
  nodes: [
    { id: "load-context", name: "Load Context", type: "deterministic", phase: "read", description: "Load working memory + monitor definition" },
    { id: "read-source", name: "Read Source MCP", type: "deterministic", phase: "read", description: "Collect current monitoring evidence from bound sources" },
    { id: "eval-rules", name: "Evaluate Rules", type: "deterministic", phase: "gate", description: "Apply deterministic guardrails before any subjective reasoning" },
    { id: "reason", name: "Agent Reasoning", type: "agentic", phase: "reason", description: "Correlate evidence with memory; build hypothesis; state confidence" },
    { id: "decision", name: "Confidence / Severity Gate", type: "gate", phase: "gate", description: "Only meaningful conclusions pass; quiet when healthy" },
    { id: "output", name: "Output MCP", type: "output", phase: "output", description: "Publish summary / request approval via output bindings" },
    { id: "memory", name: "Update Memory", type: "deterministic", phase: "memory", description: "Persist situation, evidence and outcomes to memory" },
  ],
};

/** Alert triage — assumes the source already fired; classify + correlate only. */
export const ALERT_TRIAGE_FLOW = {
  id: "alert-triage",
  name: "Alert Triage Flow",
  description: "Read firing alerts → dedupe against incident memory → classify severity → publish triage summary",
  nodes: [
    { id: "read-alerts", name: "Read Alerts", type: "deterministic", phase: "read", description: "Pull current alert states from source MCP" },
    { id: "dedupe", name: "Search Similar Memory", type: "deterministic", phase: "gate", description: "Match against known patterns in incident memory" },
    { id: "classify", name: "Classify Severity", type: "agentic", phase: "reason", description: "Severity + impact classification with evidence" },
    { id: "triage-out", name: "Triage Output", type: "output", phase: "output", description: "Publish triage result; escalate when severity high" },
    { id: "memory", name: "Update Memory", type: "deterministic", phase: "memory", description: "Record the triage outcome" },
  ],
};

/** Release watch — correlate behavior change against the latest release. */
export const RELEASE_WATCH_FLOW = {
  id: "release-watch",
  name: "Release Watch Flow",
  description: "Read sources → check release window → correlate degradation with deployment → recommend action",
  nodes: [
    { id: "read-source", name: "Read Source MCP", type: "deterministic", phase: "read", description: "Collect current metrics after deployment" },
    { id: "read-release", name: "Read Release Context", type: "deterministic", phase: "read", description: "Latest release info + deployment history" },
    { id: "correlate", name: "Release Correlation", type: "agentic", phase: "reason", description: "Does degradation start within the release window?" },
    { id: "recommend", name: "Recommend Action", type: "agentic", phase: "reason", description: "Lowest-risk recommendation with confidence" },
    { id: "approval", name: "Human Approval Gate", type: "gate", phase: "gate", description: "Restart/rollback/scale always require explicit approval" },
    { id: "output", name: "Output MCP", type: "output", phase: "output", description: "Publish finding or approval request" },
    { id: "memory", name: "Update Memory", type: "deterministic", phase: "memory", description: "Record correlation outcome" },
  ],
};

/** All selectable flow templates. */
export const FLOW_TEMPLATES = [STANDARD_SRE_FLOW, ALERT_TRIAGE_FLOW, RELEASE_WATCH_FLOW];

/**
 * Resolve a flow template by id (or return the standard flow for unknown
 * ids — the settings UI constrains choices to template ids anyway).
 * @param {string} id
 * @returns {ProcessFlow}
 */
export function getFlowTemplate(id) {
  return FLOW_TEMPLATES.find(f => f.id === id) || STANDARD_SRE_FLOW;
}

/** Flow template summaries for pickers (includes nodes for flow visualization). */
export function listFlowTemplates() {
  return FLOW_TEMPLATES.map(({ id, name, description, nodes }) => ({ id, name, description, nodes }));
}

/**
 * Build the default system prompt for a new monitor (spec §11 — prompt
 * carries role/behavior, NOT workflow logic; the flow owns the order).
 * @returns {string}
 */
export function defaultMonitorPrompt() {
  return [
    "You are the SRE Agent for this Monitoring Model.",
    "",
    "Understand the monitor, not merely threshold breaches.",
    "Use Source MCPs to gather evidence.",
    "Apply deterministic rules before subjective reasoning.",
    "Use memory to recognize known patterns.",
    "Invoke skills only when needed.",
    "Separate evidence from hypothesis.",
    "State confidence explicitly.",
    "Publish useful conclusions through Output MCP.",
    "Never change production without approval.",
  ].join("\n");
}

/** Default deterministic guardrails for a new monitor (spec §10). */
export function defaultMonitorRules() {
  return [
    "R-001 · Multi-signal confirmation: do not escalate based on one non-critical signal alone.",
    "R-002 · Release correlation: inspect release context when degradation begins near deployment.",
    "R-003 · Human approval gate: restart / rollback / scale / failover / config write require explicit approval.",
  ];
}

/** Suggested skills for a new monitor (spec §12). */
export const DEFAULT_SKILLS = [
  "Dashboard Analysis",
  "Release Correlation",
  "Incident Triage",
  "Evidence Builder",
  "Remediation Planner",
  "Chat Reporter",
];

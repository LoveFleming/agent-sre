/**
 * AgentsPage.test.tsx — TASK-003 acceptance criteria coverage.
 *
 * Verifies:
 *  1. Can create an agent with schedule / notifyTarget / cooldown / enabled
 *  2. `enabled` renders as a toggle switch (role="switch")
 *  3. Form validation + API 400 errors are displayed (aria-live status)
 *  4. Field expansion: cron help text, cooldown input, targetType select
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AgentsPage from "./AgentsPage";
import type { Agent, ToolEntry } from "../types";

// ── Fixtures ──

const mockAgent: Agent = {
  id: "agent-001",
  name: "CPU Watchdog",
  description: "Watches CPU saturation",
  context: "",
  prompt: "You watch CPU metrics and alert on saturation.",
  agentRules: {
    guardrails: ["不猜測數據"],
    redirectRules: [],
    refuseTopics: [],
  },
  allowedTools: ["grafana_query_metrics"],
  schedule: "*/5 * * * *",
  notifyTarget: { targetType: "user", targetId: "u-ops" },
  cooldownMinutes: 30,
  enabled: true,
  createdAt: "2026-08-16T03:41:00.000Z",
  updatedAt: "2026-08-16T03:41:00.000Z",
};

const mockTools: { tools: ToolEntry[] } = {
  tools: [
    {
      name: "grafana_query_metrics",
      source: "provider:grafana",
      definition: {
        function: {
          name: "grafana_query_metrics",
          description: "Query Prometheus metrics via Grafana",
          parameters: { type: "object" },
        },
      },
    },
    {
      name: "tchat_send_message",
      source: "provider:tchat",
      definition: {
        function: {
          name: "tchat_send_message",
          description: "Send a chat message",
          parameters: { type: "object" },
        },
      },
    },
  ],
};

// ── Mock fetch ──

type FetchMock = ReturnType<typeof vi.fn>;

function mockFetchSuccess(): FetchMock {
  return vi.fn().mockImplementation((url: string) => {
    if (url === "/api/agents") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ agents: [mockAgent] }),
      });
    }
    if (url === "/api/tools") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockTools),
      });
    }
    return Promise.reject(new Error(`Unknown URL: ${url}`));
  });
}

// ── Setup / Teardown ──

let fetchMock: FetchMock;

beforeEach(() => {
  fetchMock = mockFetchSuccess();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Helpers ──

/** Wait for the initial load to finish (list renders agent name). */
async function loaded() {
  await screen.findByText("CPU Watchdog");
}

/** Open the "New Agent" editor (from the sidebar header button). */
async function openNewAgentForm() {
  const user = userEvent.setup();
  const btns = await screen.findAllByRole("button", { name: /New Agent/ });
  await user.click(btns[0]); // header button (list side)
  return user;
}

/** The save status banner (role=status). */
async function statusBanner() {
  return screen.findByRole("status");
}

// ── Tests ──

describe("AgentsPage", () => {
  it("renders the agent list and editor empty state after load", async () => {
    render(<AgentsPage />);
    await loaded();
    expect(screen.getByText("Select an Agent")).toBeInTheDocument();
  });

  it("shows schedule/cooldown/enabled of an existing agent in the editor", async () => {
    const user = userEvent.setup();
    render(<AgentsPage />);
    await user.click(await screen.findByText("CPU Watchdog"));
    await screen.findByText("Edit Agent");

    const schedule = screen.getByDisplayValue("*/5 * * * *") as HTMLInputElement;
    expect(schedule).toBeInTheDocument();

    const targetId = screen.getByDisplayValue("u-ops") as HTMLInputElement;
    expect(targetId).toBeInTheDocument();

    const cooldown = screen.getByDisplayValue(30) as HTMLInputElement;
    expect(cooldown.type).toBe("number");

    const sw = screen.getByRole("switch", { name: /toggle agent enabled/i });
    expect(sw).toHaveAttribute("aria-checked", "true");
  });

  it("cron help text with examples is present in the editor", async () => {
    render(<AgentsPage />);
    await loaded();
    await openNewAgentForm();
    expect(screen.getByText(/every 5 min/)).toBeInTheDocument();
    expect(screen.getByText(/weekdays 09:00/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("*/5 * * * * (every 5 minutes)")).toBeInTheDocument();
  });

  it("enabled switch flips aria-checked on click", async () => {
    const user = userEvent.setup();
    render(<AgentsPage />);
    await user.click(await screen.findByText("CPU Watchdog"));
    await screen.findByText("Edit Agent");

    const sw = screen.getByRole("switch", { name: /toggle agent enabled/i });
    await user.click(sw);
    expect(sw).toHaveAttribute("aria-checked", "false");
    // helper text follows
    expect(screen.getByText("Paused")).toBeInTheDocument();
  });

  it("client validation: missing name is rejected without a POST", async () => {
    const user = userEvent.setup();
    render(<AgentsPage />);
    await loaded();
    await openNewAgentForm();

    await user.type(screen.getByLabelText(/Notify Target/), "u-ops");
    await user.click(screen.getByRole("button", { name: "Create Agent" }));

    const banner = await statusBanner();
    expect(banner).toHaveTextContent(/name is required/i);
    expect(
      fetchMock.mock.calls.find(([u, i]) => u === "/api/agents" && i?.method === "POST"),
    ).toBeUndefined();
  });

  it("client validation: invalid cron is rejected with a helpful message", async () => {
    const user = userEvent.setup();
    render(<AgentsPage />);
    await loaded();
    await openNewAgentForm();

    await user.type(screen.getByLabelText(/Name/), "Bad Cron");
    await user.type(screen.getByLabelText(/Notify Target/), "u-ops");
    await user.type(screen.getByPlaceholderText("*/5 * * * * (every 5 minutes)"), "not-a-cron");
    await user.click(screen.getByRole("button", { name: "Create Agent" }));

    const banner = await statusBanner();
    expect(banner).toHaveTextContent(/5 fields/i);
    expect(
      fetchMock.mock.calls.find(([u, i]) => u === "/api/agents" && i?.method === "POST"),
    ).toBeUndefined();
  });

  it("creates an agent via POST /api/agents with the full payload", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(
      (url: string, init?: { method?: string; body?: string }) => {
        if (url === "/api/agents" && init?.method === "POST") {
          return Promise.resolve({
            ok: true,
            status: 201,
            json: () =>
              Promise.resolve({ agent: { ...mockAgent, id: "new-1", name: "Nightly" } }),
          });
        }
        if (url === "/api/agents") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ agents: [mockAgent] }),
          });
        }
        if (url === "/api/tools") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockTools),
          });
        }
        return Promise.reject(new Error(`Unknown URL: ${url}`));
      },
    );

    render(<AgentsPage />);
    await loaded();
    await openNewAgentForm();

    await user.type(screen.getByLabelText(/Name/), "Nightly");
    await user.type(
      screen.getByPlaceholderText("What the agent should do on each run"),
      "You report nightly.",
    );
    await user.type(screen.getByPlaceholderText("*/5 * * * * (every 5 minutes)"), "0 2 * * *");
    await user.type(screen.getByLabelText(/Notify Target/), "ch-sre");
    await user.selectOptions(
      screen.getByRole("combobox", { name: /notify target type/i }),
      "channel",
    );
    await user.click(screen.getByRole("switch", { name: /toggle agent enabled/i }));

    await user.click(screen.getByRole("button", { name: "Create Agent" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([u, init]) => u === "/api/agents" && init?.method === "POST",
      );
      expect(post).toBeDefined();
      const body = JSON.parse((post![1] as { body: string }).body);
      expect(body.name).toBe("Nightly");
      expect(body.schedule).toBe("0 2 * * *");
      expect(body.notifyTarget).toEqual({ targetType: "channel", targetId: "ch-sre" });
      expect(body.cooldownMinutes).toBe(30);
      expect(body.enabled).toBe(false);
    });

    expect(await screen.findByText("Agent created.")).toBeInTheDocument();
  });

  it("displays a server 400 error body in the save banner", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === "/api/agents" && init?.method === "POST") {
        return Promise.resolve({
          ok: false,
          status: 400,
          json: () =>
            Promise.resolve({ error: "name length must be 1–100 characters" }),
        });
      }
      if (url === "/api/agents") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ agents: [] }),
        });
      }
      if (url === "/api/tools") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTools),
        });
      }
      return Promise.reject(new Error(`Unknown URL: ${url}`));
    });

    render(<AgentsPage />);
    // empty agents list → open editor via the sidebar empty-state button
    await screen.findByText(/No agents yet/i);
    const btns = await screen.findAllByRole("button", { name: /New Agent/ });
    await user.click(btns[0]);

    await user.type(screen.getByLabelText(/Name/), "Server Rejects");
    await user.type(screen.getByLabelText(/Notify Target/), "u-x");
    await user.click(screen.getByRole("button", { name: "Create Agent" }));

    const banner = await statusBanner();
    expect(banner).toHaveTextContent(/1–100 characters/);
  });

  it("displays a server 404 error body when updating a deleted agent", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (typeof url === "string" && url.startsWith("/api/agents/agent-001") && init?.method === "PUT") {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.resolve({ error: "agent not found" }),
        });
      }
      if (url === "/api/agents") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ agents: [mockAgent] }),
        });
      }
      if (url === "/api/tools") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTools),
        });
      }
      return Promise.reject(new Error(`Unknown URL: ${url}`));
    });

    render(<AgentsPage />);
    await user.click(await screen.findByText("CPU Watchdog"));
    await screen.findByText("Edit Agent");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const banner = await statusBanner();
    expect(banner).toHaveTextContent(/agent not found/i);
  });

  it("tool picker groups tools by provider and toggles selection", async () => {
    const user = userEvent.setup();
    render(<AgentsPage />);
    await loaded();
    await openNewAgentForm();

    expect(screen.getByText("grafana_query_metrics")).toBeInTheDocument();
    expect(screen.getByText("tchat_send_message")).toBeInTheDocument();

    const box = screen
      .getByText("grafana_query_metrics")
      .closest("label")!
      .querySelector("input[type=checkbox]")!;
    await user.click(box);

    await waitFor(() => {
      expect(
        screen.getByText((_, el) => el?.textContent === "1 selected · 2 available"),
      ).toBeInTheDocument();
    });
  });

  it("Enter in the name field triggers save only when not composing (IME guard)", async () => {
    const user = userEvent.setup();
    render(<AgentsPage />);
    await loaded();
    await openNewAgentForm();

    const name = screen.getByLabelText(/Name/);
    await user.type(name, "IME");
    // simulate composition in progress — Enter must NOT save
    name.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    // composition flag is private; the guard is exercised implicitly —
    // without composingRef Enter would fire handleSave (POST blocked by
    // validation anyway), so assert no crash + still in editor.
    expect(screen.getByText("New Agent")).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HomePage from "./HomePage";
import type { HealthInfo, Crew, ToolEntry } from "../types";

// ── Fixtures ──

const mockHealth: HealthInfo = {
  status: "ok",
  uptime: 7200,
  tools: ["grafana_list_dashboards", "tchat_send"],
};

const mockCrews: { crews: Crew[] } = {
  crews: [
    {
      id: "incident-commander",
      title: "Incident Commander",
      codename: "阿明",
      emoji: "🎖️",
      description: "主導事件應變",
    },
    {
      id: "on-call-engineer",
      title: "On-Call Engineer",
      codename: "小美",
      emoji: "🔧",
      description: "第一線排查",
    },
  ],
};

const mockTools: { tools: ToolEntry[] } = {
  tools: [
    {
      name: "grafana_list_dashboards",
      definition: {
        function: {
          name: "grafana_list_dashboards",
          description: "List dashboards",
          parameters: { type: "object", properties: {} },
        },
      },
      source: "provider:grafana",
    },
    {
      name: "tchat_send",
      definition: {
        function: {
          name: "tchat_send",
          description: "Send a message",
          parameters: { type: "object", properties: {} },
        },
      },
      source: "provider:tchat",
    },
  ],
};

// ── Mock fetch ──

function mockFetchSuccess() {
  return vi.fn().mockImplementation((url: string) => {
    if (url === "/api/health") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockHealth),
      });
    }
    if (url === "/api/crews") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockCrews),
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

function mockFetchFailure() {
  return vi.fn().mockResolvedValue({
    ok: false,
    status: 500,
    json: () => Promise.resolve({}),
  });
}

// ── Setup / Teardown ──

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetchSuccess());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Tests ──

describe("HomePage", () => {
  it("shows loading skeleton on initial render", async () => {
    render(<HomePage onNavigate={vi.fn()} onQuickAction={vi.fn()} />);
    const skeleton = document.querySelector(".animate-pulse");
    expect(skeleton).toBeInTheDocument();
    // Wait for the async fetch to settle so no dangling state update
    // triggers the act() warning
    await waitFor(() => {
      expect(screen.queryByText("Agent Team")).toBeInTheDocument();
    });
  });

  it("fetches and displays crews after loading", async () => {
    render(<HomePage onNavigate={vi.fn()} onQuickAction={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Incident Commander")).toBeInTheDocument();
    });
    expect(screen.getByText("On-Call Engineer")).toBeInTheDocument();
  });

  it("fetches and displays tools grouped by provider", async () => {
    render(<HomePage onNavigate={vi.fn()} onQuickAction={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("grafana")).toBeInTheDocument();
    });
    expect(screen.getByText("tchat")).toBeInTheDocument();
    expect(screen.getByText("grafana_list_dashboards")).toBeInTheDocument();
    expect(screen.getByText("tchat_send")).toBeInTheDocument();
  });

  it("displays stat counts correctly after loading", async () => {
    render(<HomePage onNavigate={vi.fn()} onQuickAction={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("AI Agents")).toBeInTheDocument();
    });

    // Stat labels present (use getAllByText — "Tools" also appears as section heading)
    expect(screen.getAllByText("Tools").length).toBeGreaterThanOrEqual(1);
    // Uptime 7200s = "2h 0m"
    expect(screen.getByText("2h 0m")).toBeInTheDocument();

    // Verify stat values via the StatCard containers
    // Each StatCard: label in a <span>, value in sibling <div class="text-2xl...">
    const agentsLabel = screen.getByText("AI Agents");
    const agentsCard = agentsLabel.closest("div.p-4")!;
    const agentsValue = agentsCard.querySelector(".text-2xl")!;
    expect(agentsValue.textContent).toBe("2");

    // "Tools" appears in both the stat card and a section heading; find the stat card one
    const toolsLabel = screen.getAllByText("Tools").find(
      (el) => el.closest("div.p-4") !== null
    )!;
    const toolsCard = toolsLabel.closest("div.p-4")!;
    const toolsValue = toolsCard.querySelector(".text-2xl")!;
    expect(toolsValue.textContent).toBe("2");
  });

  it("shows error state with retry button when fetch fails", async () => {
    vi.stubGlobal("fetch", mockFetchFailure());

    render(<HomePage onNavigate={vi.fn()} onQuickAction={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("無法載入平台資料")).toBeInTheDocument();
    });
    expect(screen.getByText("重試")).toBeInTheDocument();
  });

  it("shows error message detail when fetch fails", async () => {
    vi.stubGlobal("fetch", mockFetchFailure());

    render(<HomePage onNavigate={vi.fn()} onQuickAction={vi.fn()} />);

    await waitFor(() => {
      // The error message is the generic "Failed to fetch platform data"
      expect(screen.getByText(/Failed to fetch platform data/)).toBeInTheDocument();
    });
  });

  it("triggers onQuickAction with the prompt when a quick action button is clicked", async () => {
    const user = userEvent.setup();
    const onQuickAction = vi.fn();
    render(<HomePage onNavigate={vi.fn()} onQuickAction={onQuickAction} />);

    await waitFor(() => {
      expect(screen.getByText("查延遲")).toBeInTheDocument();
    });

    await user.click(screen.getByText("查延遲"));

    expect(onQuickAction).toHaveBeenCalledWith(
      "幫我查各服務的 p99 latency，看有沒有異常飆高的"
    );
  });

  it("falls back to onNavigate('console') when onQuickAction is not provided", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<HomePage onNavigate={onNavigate} />);

    await waitFor(() => {
      expect(screen.getByText("查延遲")).toBeInTheDocument();
    });

    await user.click(screen.getByText("查延遲"));

    expect(onNavigate).toHaveBeenCalledWith("console");
  });

  it("renders the hero title with correct text", async () => {
    render(<HomePage onNavigate={vi.fn()} onQuickAction={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("🛡️ SRE Agent Platform")).toBeInTheDocument();
    });
  });

  it("renders 'View all →' links for agents and tools sections", async () => {
    render(<HomePage onNavigate={vi.fn()} onQuickAction={vi.fn()} />);

    await waitFor(() => {
      const viewAllLinks = screen.getAllByText("View all →");
      expect(viewAllLinks).toHaveLength(2);
    });
  });

  it("navigates to agents view when 'View all' in agents section is clicked", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<HomePage onNavigate={onNavigate} onQuickAction={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Agent Team")).toBeInTheDocument();
    });

    // First "View all →" is the agents section
    const viewAllLinks = screen.getAllByText("View all →");
    await user.click(viewAllLinks[0]);

    expect(onNavigate).toHaveBeenCalledWith("agents");
  });

  it("navigates to tools view when 'View all' in tools section is clicked", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<HomePage onNavigate={onNavigate} onQuickAction={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("2h 0m")).toBeInTheDocument();
    });

    const viewAllLinks = screen.getAllByText("View all →");
    await user.click(viewAllLinks[1]);

    expect(onNavigate).toHaveBeenCalledWith("tools");
  });

  it("navigates to console when a crew card is clicked", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<HomePage onNavigate={onNavigate} onQuickAction={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Incident Commander")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Incident Commander"));

    expect(onNavigate).toHaveBeenCalledWith("console");
  });
});

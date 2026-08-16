import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Sidebar from "./Sidebar";
import type { NavItem, ViewId } from "../types";

// ── Fixtures ──

const ITEMS: NavItem[] = [
  { id: "home", label: "首頁", icon: "🏠" },
  { id: "agents", label: "Agents", icon: "👥" },
  { id: "tools", label: "Tools", icon: "🔧" },
  { id: "monitor", label: "Monitor", icon: "📊" },
  { id: "console", label: "Console", icon: "💬" },
  { id: "config", label: "Config", icon: "⚙️", badge: "soon" },
];

const defaultProps = () => ({
  items: ITEMS,
  activeId: "home" as ViewId,
  onSelect: vi.fn(),
  healthStatus: "online" as const,
});

// ── Tests ──

describe("Sidebar", () => {
  it("renders all nav items with their labels", () => {
    render(<Sidebar {...defaultProps()} />);
    ITEMS.forEach((item) => {
      expect(screen.getByText(item.label)).toBeInTheDocument();
    });
  });

  it("renders icons for each nav item", () => {
    render(<Sidebar {...defaultProps()} />);
    ITEMS.forEach((item) => {
      expect(screen.getByText(item.icon)).toBeInTheDocument();
    });
  });

  it("marks the active item with aria-current='page'", () => {
    render(<Sidebar {...defaultProps()} />);
    const activeItem = screen.getByText("首頁").closest("button");
    expect(activeItem).toHaveAttribute("aria-current", "page");
  });

  it("does not mark non-active items with aria-current", () => {
    render(<Sidebar {...defaultProps()} />);
    const inactiveItem = screen.getByText("Agents").closest("button");
    expect(inactiveItem).not.toHaveAttribute("aria-current");
  });

  it("applies accent border-left and background style on active item", () => {
    render(<Sidebar {...defaultProps()} />);
    const activeBtn = screen.getByText("首頁").closest("button")!;
    const style = activeBtn.style;
    // Active should have a 3px orange border (jsdom may normalize hex → rgb)
    expect(style.borderLeft).toMatch(/3px solid/i);
    expect(style.borderLeft).toMatch(/#f97316|rgb\(249,\s*115,\s*22\)/);
    // Active should have orange background tint (#fff7ed = rgb(255,247,237))
    expect(style.backgroundColor).toMatch(/#fff7ed|rgb\(255,\s*247,\s*237\)/);
  });

  it("calls onSelect with the item id when clicking a normal item", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Sidebar {...defaultProps()} onSelect={onSelect} />);
    await user.click(screen.getByText("Agents"));
    expect(onSelect).toHaveBeenCalledWith("agents");
  });

  it("does NOT call onSelect when clicking a 'soon' badge item", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Sidebar {...defaultProps()} onSelect={onSelect} />);
    await user.click(screen.getByText("Config"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("renders the 'soon' badge text on disabled items", () => {
    render(<Sidebar {...defaultProps()} />);
    expect(screen.getByText("soon")).toBeInTheDocument();
  });

  it("sets the button as disabled for 'soon' items", () => {
    render(<Sidebar {...defaultProps()} />);
    const disabledBtn = screen.getByText("Config").closest("button");
    expect(disabledBtn).toBeDisabled();
  });

  it("renders the StatusBadge at the bottom", () => {
    render(<Sidebar {...defaultProps()} healthStatus="online" />);
    expect(screen.getByText("Online")).toBeInTheDocument();
  });

  it("updates StatusBadge display when healthStatus changes", () => {
    const { rerender } = render(<Sidebar {...defaultProps()} healthStatus="online" />);
    expect(screen.getByText("Online")).toBeInTheDocument();
    rerender(<Sidebar {...defaultProps()} healthStatus="offline" />);
    expect(screen.getByText("Offline")).toBeInTheDocument();
  });

  it("renders the brand title 'Agent SRE'", () => {
    render(<Sidebar {...defaultProps()} />);
    expect(screen.getByText("Agent SRE")).toBeInTheDocument();
  });
});

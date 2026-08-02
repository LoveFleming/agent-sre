import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StatusBadge from "./StatusBadge";

describe("StatusBadge", () => {
  it("renders green dot and 'Online' label for 'online' status", () => {
    render(<StatusBadge status="online" />);
    const label = screen.getByText("Online");
    expect(label).toHaveClass("text-emerald-600");
    // The dot is the sibling span
    const dot = label.previousElementSibling;
    expect(dot).toHaveClass("bg-emerald-500");
  });

  it("renders red dot and 'Offline' label for 'offline' status", () => {
    render(<StatusBadge status="offline" />);
    const label = screen.getByText("Offline");
    expect(label).toHaveClass("text-red-500");
    const dot = label.previousElementSibling;
    expect(dot).toHaveClass("bg-red-500");
  });

  it("renders amber dot with pulse animation and 'Connecting…' label for 'checking' status", () => {
    render(<StatusBadge status="checking" />);
    const label = screen.getByText("Connecting…");
    expect(label).toHaveClass("text-amber-500");
    const dot = label.previousElementSibling;
    expect(dot).toHaveClass("bg-amber-400");
    expect(dot).toHaveClass("animate-pulse");
  });

  it("renders the label text exactly as expected for each status", () => {
    const { rerender } = render(<StatusBadge status="online" />);
    expect(screen.getByText("Online")).toBeInTheDocument();
    rerender(<StatusBadge status="offline" />);
    expect(screen.getByText("Offline")).toBeInTheDocument();
    rerender(<StatusBadge status="checking" />);
    expect(screen.getByText("Connecting…")).toBeInTheDocument();
  });
});

import { describe, it, expect } from "vitest";
import { getProvider, formatUptime } from "./types";

// ── getProvider ──

describe("getProvider", () => {
  it("extracts provider from 'provider:grafana' format", () => {
    expect(getProvider("provider:grafana")).toBe("grafana");
  });

  it("extracts provider from 'provider:tchat' format", () => {
    expect(getProvider("provider:tchat")).toBe("tchat");
  });

  it("returns 'other' when source is undefined", () => {
    expect(getProvider(undefined)).toBe("other");
  });

  it("returns first part if no colon separator", () => {
    expect(getProvider("grafana")).toBe("grafana");
  });

  it("falls back to first part when second part is empty string", () => {
    // parts[1] || parts[0] — empty string is falsy, so parts[0] is used
    expect(getProvider("provider:")).toBe("provider");
  });

  it("returns 'other' for empty string", () => {
    expect(getProvider("")).toBe("other");
  });
});

// ── formatUptime ──

describe("formatUptime", () => {
  it("returns '—' for undefined", () => {
    expect(formatUptime(undefined)).toBe("—");
  });

  it("returns '—' for null-ish (no value)", () => {
    expect(formatUptime(undefined)).toBe("—");
  });

  it("formats hours + minutes correctly", () => {
    // 7236s = 2h 0m
    expect(formatUptime(7200)).toBe("2h 0m");
  });

  it("formats hours + minutes with remainder", () => {
    // 3900s = 1h 5m
    expect(formatUptime(3900)).toBe("1h 5m");
  });

  it("formats minutes-only when under 1 hour", () => {
    expect(formatUptime(600)).toBe("10m");
  });

  it("formats 0 seconds as '0m'", () => {
    expect(formatUptime(0)).toBe("0m");
  });

  it("formats very small values", () => {
    expect(formatUptime(30)).toBe("0m");
  });

  it("formats large uptime correctly", () => {
    // 86400s = 24h 0m
    expect(formatUptime(86400)).toBe("24h 0m");
  });
});

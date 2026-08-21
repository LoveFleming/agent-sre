/**
 * config.test.mjs — Unit tests for resolveLLM / config / PORT (config.mjs)
 *
 * The `config` object is loaded once from config/providers.json at import
 * time (active=zai, defaultModel=glm-5.1). Tests below assert against that
 * real fixture. The env-fallback branch is exercised by temporarily setting
 * process.env and restoring it afterwards.
 */

import { describe, it, expect, afterEach } from "vitest";

// Fixed fixture — the real config/providers.json is local runtime config
// (untracked since it holds real API keys) and its contents vary per machine.
process.env.SRE_PROVIDERS_PATH = new URL("./__fixtures__/providers.test.json", import.meta.url).pathname;

const { config, resolveLLM, ROOT, PORT } = await import("./config.mjs");

// Snapshot original env keys we may mutate, restore after each test.
const ENV_KEYS = ["SRE_LLM_API_KEY", "OPENAI_API_KEY", "SRE_LLM_BASE_URL"];
const originalEnv = new Map(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (originalEnv.get(k) === undefined) delete process.env[k];
    else process.env[k] = originalEnv.get(k);
  }
});

// Hard-code expectations derived from the real config/providers.json fixture.
const ZAI_BASE = "https://open.bigmodel.cn/api/paas/v4";
const OR_BASE = "https://openrouter.ai/api/v1";

describe("config (loaded from providers.json)", () => {
  it("存在 ROOT 且指向專案根目錄", () => {
    expect(ROOT.length).toBeGreaterThan(0);
  });

  it("載入 active 與 defaultModel", () => {
    expect(config.active).toBe("zai");
    expect(config.defaultModel).toBe("glm-5.1");
  });

  it("載入 zai 與 openrouter providers", () => {
    expect(config.providers.zai).toBeTruthy();
    expect(config.providers.openrouter).toBeTruthy();
    expect(config.providers.zai.baseURL).toBe(ZAI_BASE);
  });

  it("PORT 預設為 4200", () => {
    expect(PORT).toBe(4200);
  });
});

describe("resolveLLM — config-provider path", () => {
  it("無 override 時使用 active provider + defaultModel", () => {
    const r = resolveLLM();
    expect(r.apiUrl).toBe(`${ZAI_BASE}/chat/completions`);
    expect(r.headers.Authorization).toContain("Bearer");
    expect(r.model).toBe("glm-5.1");
  });

  it("override 無斜線時沿用 active provider 但替換 model", () => {
    const r = resolveLLM("glm-4");
    expect(r.apiUrl).toBe(`${ZAI_BASE}/chat/completions`);
    expect(r.model).toBe("glm-4");
  });

  it("override 含 provider/model 斜線時切換到對應 provider", () => {
    const r = resolveLLM("openrouter/deepseek/deepseek-v4-flash");
    expect(r.apiUrl).toBe(`${OR_BASE}/chat/completions`);
    expect(r.model).toBe("deepseek-v4-flash"); // 前綴被移除
  });

  it("openrouter provider 加上 referer 與 title headers", () => {
    const r = resolveLLM("openrouter/z-ai/glm-5.1");
    expect(r.headers["HTTP-Referer"]).toContain("github.com");
    expect(r.headers["X-Title"]).toBe("Agent SRE");
  });

  it("非 openrouter provider 不加 referer header", () => {
    const r = resolveLLM();
    expect(r.headers["HTTP-Referer"]).toBeUndefined();
  });

  it("回傳 fallbacks（若 provider 定義）", () => {
    const r = resolveLLM();
    expect(Array.isArray(r.fallbacks)).toBe(true);
  });
});

describe("resolveLLM — env fallback path", () => {
  it("provider 不存在且無 api key 時丟出錯誤", () => {
    delete process.env.SRE_LLM_API_KEY;
    delete process.env.OPENAI_API_KEY;
    expect(() => resolveLLM("ghost-provider/model")).toThrow(/No LLM provider configured/);
  });

  it("provider 不存在但有 api key 時用 env 建構 endpoint", () => {
    process.env.SRE_LLM_API_KEY = "test-key";
    process.env.SRE_LLM_BASE_URL = "https://example.com/v1/";
    const r = resolveLLM("ghost/model");
    expect(r.apiUrl).toBe("https://example.com/v1/chat/completions");
    expect(r.headers.Authorization).toBe("Bearer test-key");
    expect(r.model).toBe("model");
  });

  it("env baseURL 尾端斜線會被移除", () => {
    process.env.SRE_LLM_API_KEY = "k";
    process.env.SRE_LLM_BASE_URL = "https://example.com/v1//";
    const r = resolveLLM("ghost/model");
    expect(r.apiUrl).toBe("https://example.com/v1/chat/completions");
  });
});

/**
 * tool-registry.test.mjs — Unit tests for ToolRegistry (tool-registry.mjs)
 *
 * Covers register/registerAll/getDefinitions/get/list, and execute()
 * argument parsing, handler dispatch, unknown-tool errors, and handler-throw
 * containment.
 *
 * Interacts with a fresh isolated instance per test (module exports a
 * singleton; we build independent instances via prototype cloning).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { default as singleton } from "./tool-registry.mjs";

function makeRegistry() {
  const reg = Object.create(Object.getPrototypeOf(singleton));
  reg.tools = new Map();
  return reg;
}

function sampleEntry(name = "gr") {
  return {
    name,
    definition: { type: "function", function: { name, description: name } },
    handler: vi.fn(async (args) => ({ text: `ran:${name}`, data: args })),
  };
}

describe("ToolRegistry — registration", () => {
  let reg;
  beforeEach(() => {
    reg = makeRegistry();
  });

  it("register 工具後可 get/list", () => {
    reg.register(sampleEntry("a"));
    expect(reg.get("a")).toBeTruthy();
    expect(reg.list()).toEqual(["a"]);
  });

  it("register 會覆寫同名工具", () => {
    reg.register(sampleEntry("a"));
    reg.register(sampleEntry("a"));
    expect(reg.list()).toEqual(["a"]);
  });

  it("register 無 name 時丟出錯誤", () => {
    expect(() => reg.register({})).toThrow(/must have a name/);
  });

  it("registerAll 批次註冊多個工具", () => {
    reg.registerAll([sampleEntry("a"), sampleEntry("b")]);
    expect(reg.list()).toEqual(["a", "b"]);
  });

  it("getDefinitions 回傳全部 definition", () => {
    reg.registerAll([sampleEntry("a"), sampleEntry("b")]);
    const defs = reg.getDefinitions();
    expect(defs).toHaveLength(2);
    expect(defs[0].type).toBe("function");
  });

  it("getDefinitions 支援 filterNames 過濾", () => {
    reg.registerAll([sampleEntry("a"), sampleEntry("b")]);
    const defs = reg.getDefinitions(["a"]);
    expect(defs).toHaveLength(1);
    expect(defs[0].function.name).toBe("a");
  });

  it("clear 清空所有工具", () => {
    reg.register(sampleEntry("a"));
    reg.clear();
    expect(reg.list()).toHaveLength(0);
  });
});

describe("ToolRegistry — execute()", () => {
  let reg;
  beforeEach(() => {
    reg = makeRegistry();
  });

  it("缺少 name 回傳錯誤結果", async () => {
    const res = await reg.execute({});
    expect(res.error).toBe(true);
    expect(res.text).toMatch(/missing name/);
  });

  it("未知工具回傳 Unknown tool", async () => {
    const res = await reg.execute({ function: { name: "nope" } });
    expect(res.error).toBe(true);
    expect(res.text).toMatch(/Unknown tool/);
  });

  it("執行 handler 並傳入解析後的 arguments", async () => {
    const entry = sampleEntry("calc");
    reg.register(entry);
    const res = await reg.execute({
      function: { name: "calc", arguments: '{"a":1,"b":2}' },
    });
    expect(entry.handler).toHaveBeenCalledWith({ a: 1, b: 2 }, expect.any(Object));
    expect(res.text).toBe("ran:calc");
    expect(res.data).toEqual({ a: 1, b: 2 });
  });

  it("arguments 為 JSON 字串時解析", async () => {
    const entry = sampleEntry("calc");
    reg.register(entry);
    await reg.execute({ function: { name: "calc", arguments: '{"x":9}' } });
    expect(entry.handler).toHaveBeenCalledWith({ x: 9 }, expect.anything());
  });

  it("arguments 非法 JSON 時傳入空物件", async () => {
    const entry = sampleEntry("calc");
    reg.register(entry);
    await reg.execute({ function: { name: "calc", arguments: "{bad json" } });
    expect(entry.handler).toHaveBeenCalledWith({}, expect.anything());
  });

  it("call.function.arguments 為物件時無法 JSON.parse 而退回空物件", async () => {
    // Edge case: execute only JSON.parse's call.function.arguments and treats
    // an already-parsed object as a parse failure -> falls back to {}.
    const entry = sampleEntry("calc");
    reg.register(entry);
    await reg.execute({ function: { name: "calc", arguments: { z: 3 } } });
    expect(entry.handler).toHaveBeenCalledWith({}, expect.anything());
  });

  it("call.arguments（無 function）為物件時直接使用", async () => {
    // execute falls back to call.arguments when call.function.arguments is
    // falsy; an already-parsed object is used as-is.
    const entry = sampleEntry("calc");
    reg.register(entry);
    await reg.execute({ name: "calc", arguments: { z: 3 } });
    expect(entry.handler).toHaveBeenCalledWith({ z: 3 }, expect.anything());
  });

  it("ctx.toolName 被設定為工具名稱", async () => {
    const entry = sampleEntry("calc");
    reg.register(entry);
    await reg.execute({ function: { name: "calc", arguments: "{}" } });
    const ctx = entry.handler.mock.calls[0][1];
    expect(ctx.toolName).toBe("calc");
  });

  it("handler 拋錯時回傳錯誤結果而非向外拋", async () => {
    const entry = { name: "boom", handler: async () => { throw new Error("kaboom"); } };
    reg.register(entry);
    const res = await reg.execute({ function: { name: "boom" } });
    expect(res.error).toBe(true);
    expect(res.text).toContain("kaboom");
  });

  it("handler 回傳 falsy 時以 (no output) 取代", async () => {
    const entry = { name: "void", handler: async () => undefined };
    reg.register(entry);
    const res = await reg.execute({ function: { name: "void" } });
    expect(res.text).toBe("(no output)");
  });
});

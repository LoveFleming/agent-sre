/**
 * task-store.test.mjs — Unit tests for TaskStore in-memory CRUD (task-store.mjs)
 *
 * Covers: create/list/get/update/delete/clear, defaults normalization,
 * partial update semantics, and sorted-by-createdAt listing.
 *
 * Each test uses a fresh TaskStore instance to guarantee isolation.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { taskStore as singleton } from "./task-store.mjs";

// The module exports a singleton TaskStore (not the constructor). To isolate
// each test we build a fresh instance sharing the singleton's prototype but
// with its own internal Map, so no test depends on another's mutations.
function makeStore() {
  const store = Object.create(Object.getPrototypeOf(singleton));
  store.tasks = new Map();
  return store;
}

describe("TaskStore — create()", () => {
  let store;
  beforeEach(() => {
    store = makeStore();
  });

  it("建立最小輸入應產出完整 task 欄位且帶 id/timestamp", () => {
    const task = store.create({ name: "alpha" });
    expect(task.id).toBeTruthy();
    expect(task.name).toBe("alpha");
    expect(task.description).toBe("");
    expect(task.tools).toEqual([]);
    expect(task.agentRules).toEqual({
      guardrails: [],
      redirectRules: [],
      refuseTopics: [],
    });
    expect(task.context).toBe("");
    expect(task.prompt).toBe("");
    expect(task.createdAt).toBeTruthy();
    expect(task.updatedAt).toBeTruthy();
    expect(task.createdAt).toEqual(task.updatedAt);
  });

  it("未提供 name 時預設為空字串", () => {
    const task = store.create({});
    expect(task.name).toBe("");
    expect(task.id).toBeTruthy();
  });

  it("tools 非陣列時應正規化為空陣列", () => {
    const task = store.create({ name: "t", tools: "not-array" });
    expect(task.tools).toEqual([]);
  });

  it("agentRules 各欄位非陣列時應正規化為空陣列", () => {
    const task = store.create({
      name: "t",
      agentRules: { guardrails: "x", redirectRules: 123, refuseTopics: null },
    });
    expect(task.agentRules).toEqual({
      guardrails: [],
      redirectRules: [],
      refuseTopics: [],
    });
  });

  it("每次 create 產生唯一 id", () => {
    const a = store.create({ name: "a" });
    const b = store.create({ name: "b" });
    expect(a.id).not.toBe(b.id);
  });
});

describe("TaskStore — get() / list() / clear()", () => {
  let store;
  beforeEach(() => {
    store = makeStore();
  });

  it("get 回傳已建立的 task，未知 id 回傳 undefined", () => {
    const t = store.create({ name: "hit" });
    expect(store.get(t.id)).toBe(t);
    expect(store.get("nope")).toBeUndefined();
  });

  it("list 依 createdAt 由舊到新排序", () => {
    const a = store.create({ name: "a" });
    const b = store.create({ name: "b" });
    const c = store.create({ name: "c" });
    expect(store.list()).toEqual([a, b, c]);
  });

  it("clear 清空所有 task", () => {
    store.create({ name: "a" });
    store.create({ name: "b" });
    expect(store.list()).toHaveLength(2);
    store.clear();
    expect(store.list()).toHaveLength(0);
  });
});

describe("TaskStore — update()", () => {
  let store;
  beforeEach(() => {
    store = makeStore();
  });

  it("未知 id 回傳 undefined 且不改動 store", () => {
    const before = store.list().length;
    expect(store.update("missing", { name: "x" })).toBeUndefined();
    expect(store.list()).toHaveLength(before);
  });

  it("部分更新只改提供的欄位，其餘保留", () => {
    const t = store.create({ name: "orig", description: "desc", tools: ["a"] });
    const updated = store.update(t.id, { name: "renamed" });
    expect(updated.name).toBe("renamed");
    expect(updated.description).toBe("desc");
    expect(updated.tools).toEqual(["a"]);
    expect(updated.context).toBe("");
  });

  it("更新不改動 createdAt，且回傳新 task 帶更新內容", () => {
    const t = store.create({ name: "x" });
    const origCreated = t.createdAt;
    const updated = store.update(t.id, { name: "y" });
    expect(updated.createdAt).toBe(origCreated);
    expect(updated.name).toBe("y");
    // updatedAt 會重新取系統時間；通常與 createdAt 不同，但不作毫秒級嚴格斷言以避免 flaky
    expect(typeof updated.updatedAt).toBe("string");
  });

  it("tools 傳入新陣列時整體替換", () => {
    const t = store.create({ name: "x", tools: ["old"] });
    const updated = store.update(t.id, { tools: ["new1", "new2"] });
    expect(updated.tools).toEqual(["new1", "new2"]);
  });

  it("tools 傳入非陣列時保留原值", () => {
    const t = store.create({ name: "x", tools: ["old"] });
    const updated = store.update(t.id, { tools: "bad" });
    expect(updated.tools).toEqual(["old"]);
  });

  it("agentRules 整體替換時各欄位正規化", () => {
    const t = store.create({ name: "x", agentRules: { guardrails: ["g"] } });
    const updated = store.update(t.id, {
      agentRules: {
        guardrails: ["g1", "g2"],
        redirectRules: "not-array",
        refuseTopics: ["r"],
      },
    });
    expect(updated.agentRules).toEqual({
      guardrails: ["g1", "g2"],
      redirectRules: [],
      refuseTopics: ["r"],
    });
  });

  it("未提供 agentRules 時保留原 agentRules", () => {
    const t = store.create({ name: "x", agentRules: { guardrails: ["keep"] } });
    const updated = store.update(t.id, { name: "y" });
    expect(updated.agentRules).toEqual(t.agentRules);
  });

  it("store 內物件已被更新（同一參考）", () => {
    const t = store.create({ name: "x" });
    store.update(t.id, { name: "changed" });
    expect(store.get(t.id).name).toBe("changed");
  });
});

describe("TaskStore — delete()", () => {
  let store;
  beforeEach(() => {
    store = makeStore();
  });

  it("刪除存在的 task 回傳 true 且從 list 消失", () => {
    const t = store.create({ name: "x" });
    expect(store.delete(t.id)).toBe(true);
    expect(store.get(t.id)).toBeUndefined();
    expect(store.list()).toHaveLength(0);
  });

  it("刪除不存在的 id 回傳 false", () => {
    expect(store.delete("missing")).toBe(false);
  });
});

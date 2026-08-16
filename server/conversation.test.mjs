import { describe, it, expect, afterAll } from "vitest";
import {
  loadConversation,
  saveConversation,
  archiveConversation,
  listArchives,
  loadArchive,
} from "./conversation.mjs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { rmSync, existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CONV_DIR = resolve(ROOT, "data/conversations");

// Unique id to avoid clobbering real data.
const CREW = "testcrew-abc_123";

describe("conversation.mjs — sanitizeId path traversal guard", () => {
  describe("合法 id 可正常存取", () => {
    it("saveConversation/loadConversation 可正常寫讀合法 id", () => {
      saveConversation(CREW, [{ role: "user", content: "hi" }]);
      const msgs = loadConversation(CREW);
      expect(msgs).toEqual([{ role: "user", content: "hi" }]);
    });

    it("listArchives / loadArchive 合法 id 不會 throw", () => {
      expect(Array.isArray(listArchives(CREW))).toBe(true);
      // 未存 archive 時 loadArchive 回傳空陣列，不 throw
      expect(loadArchive(CREW, "s-2026-no-such")).toEqual([]);
    });
  });

  describe("非法 / 穿越 id 會被 throw", () => {
    const badCrewIds = ["..", "../../etc", "a/b", "a\\b", "..%2fetc", ""];
    const badSessionIds = ["..", "../../etc", "s-1/2", "s-1\\2", ""];

    it.each(badCrewIds)("loadConversation 對 crewId=%j throw", (id) => {
      expect(() => loadConversation(id)).toThrow();
    });
    it.each(badCrewIds)("saveConversation 對 crewId=%j throw", (id) => {
      expect(() => saveConversation(id, [])).toThrow();
    });
    it.each(badCrewIds)("archiveConversation 對 crewId=%j throw", (id) => {
      expect(() => archiveConversation(id)).toThrow();
    });
    it.each(badCrewIds)("listArchives 對 crewId=%j throw", (id) => {
      expect(() => listArchives(id)).toThrow();
    });
    it.each(badCrewIds)("loadArchive 對 crewId=%j throw", (id) => {
      expect(() => loadArchive(id, "s-ok")).toThrow();
    });
    it.each(badSessionIds)("loadArchive 對 sessionId=%j throw", (id) => {
      expect(() => loadArchive(CREW, id)).toThrow();
    });
    it.each([null, undefined, 123, {}, ["a"]])("loadConversation 對非字串 %j throw", (id) => {
      expect(() => loadConversation(id)).toThrow();
    });
  });
});

afterAll(() => {
  // Clean up test-created data directory.
  const crewDir = join(CONV_DIR, CREW);
  if (existsSync(crewDir)) rmSync(crewDir, { recursive: true, force: true });
});

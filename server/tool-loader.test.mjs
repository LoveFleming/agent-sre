import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { safeResolve } from "./tool-loader.mjs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, existsSync, writeFileSync } from "fs";
import { tmpdir } from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const TOOLS_DIR = resolve(ROOT, "tools");

describe("safeResolve", () => {
  // ----------------------------------------------------------------
  // 1) 正常子路徑應通過
  // ----------------------------------------------------------------
  describe("正常子路徑應通過", () => {
    it("單層子目錄應回傳 base 下的絕對路徑", () => {
      const result = safeResolve(ROOT, "tools");
      expect(result).toBe(resolve(ROOT, "tools"));
    });

    it("多層巢狀子路徑應正確解析", () => {
      const result = safeResolve(ROOT, "tools", "grafana", "handler.mjs");
      expect(result).toBe(resolve(ROOT, "tools/grafana/handler.mjs"));
    });

    it("多層巢狀子路徑以單一字串傳入應同樣通過", () => {
      const result = safeResolve(ROOT, "tools/grafana/handler.mjs");
      expect(result).toBe(resolve(ROOT, "tools/grafana/handler.mjs"));
    });

    it("回傳值必須是絕對路徑", () => {
      const result = safeResolve(ROOT, "tools");
      expect(resolve(result)).toBe(result); // resolve 對絕對路徑為 identity
    });

    it("回傳值必須以 base 為前綴", () => {
      const result = safeResolve(ROOT, "server");
      expect(result.startsWith(ROOT)).toBe(true);
    });

    it("傳入 base 本身（空相對路徑）應回傳 base", () => {
      const result = safeResolve(ROOT, ".");
      expect(result).toBe(resolve(ROOT));
    });
  });

  // ----------------------------------------------------------------
  // 2) ../ 路徑穿越應被拒絕
  // ----------------------------------------------------------------
  describe("路徑穿越 (../) 應被拒絕", () => {
    it("單層 ../ 應拋出錯誤", () => {
      expect(() => safeResolve(ROOT, "..")).toThrow(
        /Path traversal blocked/
      );
    });

    it("多層 ../../ 應拋出錯誤", () => {
      expect(() => safeResolve(ROOT, "../../etc")).toThrow(
        /Path traversal blocked/
      );
    });

    it("隱藏在子路徑中的 ../ 應被攔截", () => {
      expect(() => safeResolve(ROOT, "tools/../../etc/passwd")).toThrow(
        /Path traversal blocked/
      );
    });

    it("base 內移動後再穿越 ../ 應被攔截", () => {
      expect(() => safeResolve(ROOT, "tools", "..", "..", "etc")).toThrow(
        /Path traversal blocked/
      );
    });

    it("多段 child 參數中包含 ../ 應被攔截", () => {
      expect(() => safeResolve(ROOT, "tools", "../../../secret")).toThrow(
        /Path traversal blocked/
      );
    });

    it("嘗試讀取 /etc/passwd 的經典穿越應被攔截", () => {
      expect(() => safeResolve(ROOT, "../../../etc/passwd")).toThrow(
        /Path traversal blocked/
      );
    });

    it("錯誤訊息應包含被拒絕的路徑片段", () => {
      try {
        safeResolve(ROOT, "../../etc/passwd");
        expect.fail("should have thrown");
      } catch (e) {
        expect(e.message).toContain("../../etc/passwd");
      }
    });
  });

  // ----------------------------------------------------------------
  // 3) 絕對路徑應被拒絕
  // ----------------------------------------------------------------
  describe("絕對路徑應被拒絕", () => {
    it("Unix 絕對路徑應拋出錯誤", () => {
      expect(() => safeResolve(ROOT, "/etc/passwd")).toThrow(
        /absolute path/
      );
    });

    it("絕對路徑不應讓 resolve() 覆蓋 base", () => {
      expect(() => safeResolve(ROOT, "/tmp/evil")).toThrow(
        /absolute path "\/tmp\/evil"/
      );
    });

    it("多段 child 中第一段為絕對路徑應被攔截", () => {
      expect(() => safeResolve(ROOT, "/etc", "passwd")).toThrow(
        /absolute path/
      );
    });

    it("絕對路徑的錯誤訊息應包含原始路徑", () => {
      try {
        safeResolve(ROOT, "/var/log/secrets");
        expect.fail("should have thrown");
      } catch (e) {
        expect(e.message).toContain("/var/log/secrets");
      }
    });
  });

  // ----------------------------------------------------------------
  // 4) 符號連結邊界案例
  // ----------------------------------------------------------------
  describe("符號連結邊界案例", () => {
    let sandbox;
    let linkTarget;
    let outsideFile;

    beforeEach(() => {
      // 建立臨時沙箱目錄結構：
      //   sandbox/
      //     inside/          ← base 目錄
      //       link -> ../outside/real.txt   ← 符號連結指向 base 外部
      //     outside/
      //       real.txt       ← 在 base 之外
      sandbox = mkdtempSync(resolve(tmpdir(), "safepresolve-test-"));
      const inside = resolve(sandbox, "inside");
      const outside = resolve(sandbox, "outside");
      mkdirSync(inside, { recursive: true });
      mkdirSync(outside, { recursive: true });

      outsideFile = resolve(outside, "real.txt");
      linkTarget = resolve(inside, "link");

      // 寫入測試檔案
      writeFileSync(outsideFile, "secret");
      // 建立符號連結：inside/link -> ../outside/real.txt
      symlinkSync("../outside/real.txt", linkTarget);
    });

    afterEach(() => {
      rmSync(sandbox, { recursive: true, force: true });
    });

    it("指向 base 外部的符號連結：safeResolve 本身應允許（因為符號連結的字面路徑在 base 內）", () => {
      // safeResolve 只做字面路徑解析，不解析符號連結（非 fs.realpath）。
      // "link" 的字面路徑在 base 內，所以 safeResolve 放行。
      // 這是 by-design 的行為——防止字面 ../ 穿越，不做 symlink chasing。
      const base = resolve(sandbox, "inside");
      const result = safeResolve(base, "link");
      expect(result).toBe(resolve(base, "link"));
    });

    it("符號連結指向的字面路徑含 ../ 應被攔截", () => {
      // 如果攻擊者用 symlink target 本身作為輸入，含 ../ 會被攔截
      const base = resolve(sandbox, "inside");
      expect(() => safeResolve(base, "../outside/real.txt")).toThrow(
        /Path traversal blocked/
      );
    });

    it("safeResolve 不應跟隨符號連結到 base 外（不做 realpath 解析）", () => {
      // 這驗證 safeResolve 的設計邏輯：它是字面圍欄，不是 symlink resolver。
      // 回傳的路徑不應被 resolve 成 outside 目標。
      const base = resolve(sandbox, "inside");
      const result = safeResolve(base, "link");
      // 字面結果仍在 base 內
      expect(result.startsWith(base)).toBe(true);
      // 且不等於 outside 的真實檔案路徑
      expect(result).not.toBe(outsideFile);
    });
  });

  // ----------------------------------------------------------------
  // 5) 空字串與 null 輸入處理
  // ----------------------------------------------------------------
  describe("空字串與 null 輸入處理", () => {
    it("空字串 child 應回傳 base（resolve 行為）", () => {
      const result = safeResolve(ROOT, "");
      expect(result).toBe(resolve(ROOT));
    });

    it("不傳 child 參數應回傳 base", () => {
      const result = safeResolve(ROOT);
      expect(result).toBe(resolve(ROOT));
    });

    it("null 作為 child 應拋出錯誤（join 無法處理）", () => {
      expect(() => safeResolve(ROOT, null)).toThrow();
    });

    it("undefined 作為 child 應拋出錯誤", () => {
      expect(() => safeResolve(ROOT, undefined)).toThrow();
    });

    it("多段中間有空字串應正常解析", () => {
      const result = safeResolve(ROOT, "tools", "", "grafana");
      // resolve 會忽略空段
      expect(result).toBe(resolve(ROOT, "tools/grafana"));
    });

    it("純空白字串應被當作有效（不穿越，不拋錯）", () => {
      // resolve("base", " ") → "base/ " 路徑名含空白，仍合法
      expect(() => safeResolve(ROOT, " ")).not.toThrow();
    });
  });

  // ----------------------------------------------------------------
  // 6) Unicode / 編碼繞過嘗試
  // ----------------------------------------------------------------
  describe("Unicode / 編碼繞過嘗試", () => {
    it("URL 編碼的 ../ (%2e%2e%2f) 不應繞過（字面不含 .. 所以通過，但不穿越）", () => {
      // %2e%2e%2f 是字面 "%2e%2e%2f"，不是 ".."，resolve 不會解析為穿越
      const result = safeResolve(ROOT, "%2e%2e%2fetc");
      expect(result).toBe(resolve(ROOT, "%2e%2e%2fetc"));
      expect(result.startsWith(ROOT)).toBe(true);
    });

    it("Unicode 全形 .. （％2e 變體）應被當作普通字元", () => {
      // 全形點號不是 ASCII ".", resolve 不視為 ..
      const result = safeResolve(ROOT, "．．／etc");
      expect(result.startsWith(ROOT)).toBe(true);
    });

    it("UTF-8 過長編碼的 .. 不應造成穿越", () => {
      // 0xC0 0xAE 是 "." 的過長 UTF-8 編碼，但在 JS 字串中就是普通字元
      const weirdDots = "\u00c0\u00ae\u00c0\u00ae\u002f";
      const result = safeResolve(ROOT, weirdDots);
      expect(result.startsWith(ROOT)).toBe(true);
    });

    it("null byte 注入 (%00) 不應導致路徑截斷穿越", () => {
      // null byte 前如果有 ../ 仍應被攔截
      expect(() => safeResolve(ROOT, "../secret\0.txt")).toThrow(
        /Path traversal blocked/
      );
    });

    it("混合大小寫不應繞過（path 模組大小寫敏感）", () => {
      expect(() => safeResolve(ROOT, "..\\..\\etc")).toThrow(
        /Path traversal blocked/
      );
    });

    it("Unicode 檔名（CJK）應正常通過", () => {
      const result = safeResolve(ROOT, "工具", "測試.mjs");
      expect(result).toBe(resolve(ROOT, "工具/測試.mjs"));
      expect(result.startsWith(ROOT)).toBe(true);
    });

    it("emoji 路徑段應正常通過", () => {
      const result = safeResolve(ROOT, "🛠️tools");
      expect(result.startsWith(ROOT)).toBe(true);
    });

    it("路徑中包含 .. 但不構成穿越（例如檔名的一部分）應通過", () => {
      // "file..txt" 不是 "..",  "a..b" 也不是
      expect(() => safeResolve(ROOT, "file..txt")).not.toThrow();
      expect(() => safeResolve(ROOT, "a..b", "c")).not.toThrow();
    });

    it("路徑段以 '..something' 命名應被保守攔截（false-positive 可接受）", () => {
      // 這是 safeResolve 的保守行為：relative(base, resolve(base, "..foo")) 回傳 "..foo"，
      // 而 "..foo".startsWith("..") === true → 被攔截。
      // 雖然 "..foo" 是合法檔名不是穿越，但安全函式寧可誤殺（false positive）
      // 也不冒險放行——這是 by-design 的保守圍欄策略。
      expect(() => safeResolve(ROOT, "..foo")).toThrow(/Path traversal blocked/);
    });
  });
});

/**
 * 整合級別測試 — 驗證 safeResolve 與實際 TOOLS_DIR 的配合
 */
describe("safeResolve 與真實 TOOLS_DIR 整合", () => {
  it("解析真實 tools 子目錄應成功", () => {
    const result = safeResolve(TOOLS_DIR, "grafana", "handler.mjs");
    expect(result).toBe(resolve(TOOLS_DIR, "grafana/handler.mjs"));
    // 確認這個檔案確實存在（真實路徑）
    expect(existsSync(result)).toBe(true);
  });

  it("嘗試從 TOOLS_DIR 穿越到 server 原始碼應被攔截", () => {
    expect(() => safeResolve(TOOLS_DIR, "../server/index.mjs")).toThrow(
      /Path traversal blocked/
    );
  });

  it("嘗試從 TOOLS_DIR 讀取 package.json 應被攔截", () => {
    expect(() => safeResolve(TOOLS_DIR, "../package.json")).toThrow(
      /Path traversal blocked/
    );
  });
});

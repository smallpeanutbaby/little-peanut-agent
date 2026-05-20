import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  enrichFileNotFoundReason,
  listProjectLayout,
  suggestSimilarPaths
} from "../main/agent/permissions/pathSuggestions.js";
import { validatePathForTool } from "../main/agent/permissions/validatePathForTool.js";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "path-suggest-"));
  await fs.mkdir(path.join(tmpRoot, "src", "OpsAdminApi.Application", "Merchants"), { recursive: true });
  await fs.writeFile(
    path.join(tmpRoot, "src", "OpsAdminApi.Application", "Merchants", "MerchantAppService.cs"),
    "class MerchantAppService { Task GetWithDetailsAsync() {} }"
  );
  await fs.mkdir(path.join(tmpRoot, "src", "OpsAdminApi.HttpApi"), { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("suggestSimilarPaths", () => {
  it("suggests longer folder names when a segment is shortened", async () => {
    const wrong = path.join(tmpRoot, "src", "OpsAdminApi", "Merchants", "MerchantAppService.cs");
    const suggestions = await suggestSimilarPaths(tmpRoot, wrong);
    expect(suggestions.some((s) => s.includes("OpsAdminApi.Application"))).toBe(true);
  });

  it("suggests by basename when only the filename is correct", async () => {
    const wrong = path.join(tmpRoot, "src", "DoesNotExist", "MerchantAppService.cs");
    const suggestions = await suggestSimilarPaths(tmpRoot, wrong);
    expect(suggestions.some((s) => s.endsWith("MerchantAppService.cs"))).toBe(true);
  });
});

describe("enrichFileNotFoundReason", () => {
  it("includes Glob guidance and candidate paths", async () => {
    const wrong = path.join(tmpRoot, "src", "OpsAdminApi", "MerchantAppService.cs");
    const msg = await enrichFileNotFoundReason(tmpRoot, wrong, wrong);
    expect(msg).toContain("file does not exist:");
    expect(msg).toContain("Glob:");
    expect(msg).toContain("Do NOT guess");
    expect(msg).toMatch(/OpsAdminApi\.Application|MerchantAppService\.cs/);
  });
});

describe("validatePathForTool", () => {
  it("returns enriched reason for missing files", async () => {
    const wrong = path.join(tmpRoot, "src", "OpsAdminApi", "MerchantAppService.cs");
    const result = await validatePathForTool(wrong, tmpRoot, { mustExist: true });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Glob:");
    expect(result.reason).toMatch(/Did you mean|MerchantAppService/);
  });
});

describe("listProjectLayout", () => {
  it("lists top-level project folders", async () => {
    const layout = await listProjectLayout(tmpRoot);
    expect(layout.some((l) => l.startsWith("src/"))).toBe(true);
    expect(layout.some((l) => l.includes("OpsAdminApi.Application"))).toBe(true);
  });
});

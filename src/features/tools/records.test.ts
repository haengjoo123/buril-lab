import { describe, it, expect } from "vitest";
import { pickRecord, spareDrafts } from "./records";
import type { ToolRecord } from "./repository";

const record = (
  id: string,
  tool: string,
  extra: Partial<ToolRecord> & {
    data?: Record<string, unknown>;
    updated?: string;
    deleted?: string;
  } = {}
): ToolRecord =>
  ({
    dirty: false,
    generation: 1,
    status: "local",
    ...extra,
    doc: {
      id,
      owner_id: "u1",
      tool_id: tool,
      title: id,
      data: extra.data ?? {},
      schema_version: 1,
      engine_version: "1",
      revision: 0,
      updated_at: extra.updated ?? "2026-11-27T00:00:00.000Z",
      deleted_at: extra.deleted ?? null,
    },
  } as ToolRecord);

describe("choosing the record a tool page works on", () => {
  it("prefers the draft the user worked in over an empty duplicate", () => {
    // What an old race left on some devices: the edited draft plus empty ones,
    // in whatever order the device store returns them.
    const edited = record("edited", "primer", {
        draft: true,
        generation: 4,
        updated: "2026-11-26T10:00:00.000Z",
      }),
      empty1 = record("empty1", "primer", {
        draft: true,
        updated: "2026-11-27T09:00:00.000Z",
      }),
      empty2 = record("empty2", "primer", {
        draft: true,
        updated: "2026-11-27T08:00:00.000Z",
      });
    const items = [empty1, edited, empty2];
    expect(pickRecord(items, "primer", undefined, false)).toBe(edited);
    expect(spareDrafts(items, "primer", edited)).toEqual([empty1, empty2]);
  });
  it("falls back to the most recent draft when none was edited", () => {
    const older = record("a", "dilution", {
        draft: true,
        updated: "2026-11-01T00:00:00.000Z",
      }),
      newer = record("b", "dilution", {
        draft: true,
        updated: "2026-11-20T00:00:00.000Z",
      });
    expect(pickRecord([older, newer], "dilution", undefined, false)).toBe(newer);
    // The one in use is never offered for removal.
    expect(spareDrafts([older, newer], "dilution", newer)).toEqual([older]);
  });
  it("never removes a draft that holds edits", () => {
    const first = record("a", "mix", { draft: true, generation: 3 }),
      second = record("b", "mix", { draft: true, generation: 5 });
    expect(pickRecord([first, second], "mix", undefined, false)).toBe(second);
    expect(spareDrafts([first, second], "mix", second)).toEqual([]);
  });
  it("finds named work by id and a workspace by its flag", () => {
    const named = record("doc-1", "gel-blot"),
      draft = record("draft", "gel-blot", { draft: true }),
      workspace = record("ws", "timer", { data: { _workspace: true } }),
      trashed = record("old", "gel-blot", { deleted: "2026-11-01" });
    const items = [named, draft, workspace, trashed];
    expect(pickRecord(items, "gel-blot", "doc-1", false)).toBe(named);
    expect(pickRecord(items, "gel-blot", "old", false)).toBeUndefined();
    expect(pickRecord(items, "gel-blot", undefined, false)).toBe(draft);
    expect(pickRecord(items, "timer", undefined, true)).toBe(workspace);
    expect(pickRecord(items, "alarm", undefined, true)).toBeUndefined();
  });
});

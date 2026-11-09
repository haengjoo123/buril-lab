import "fake-indexeddb/auto";
import { beforeEach, describe, it, expect, vi } from "vitest";
import type { ToolDocument } from "./registry";
const cloud = vi.hoisted(() => ({
  docs: new Map<string, ToolDocument>(),
  owner: "u1",
  online: true,
}));
vi.mock("../../services/supabaseClient", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: cloud.owner } } }) },
    rpc: async (_name: string, p: Record<string, unknown>) => {
      const id = String(p.p_id),
        old = cloud.docs.get(id);
      if ((old?.revision ?? 0) !== p.p_expected_revision)
        return { error: { code: "40001", message: "conflict" }, data: null };
      const doc: ToolDocument = {
        id,
        owner_id: cloud.owner,
        tool_id: p.p_tool_id as ToolDocument["tool_id"],
        title: String(p.p_title),
        data: p.p_data as Record<string, unknown>,
        revision: (old?.revision ?? 0) + 1,
        schema_version: 1,
        engine_version: "1",
        updated_at: new Date().toISOString(),
      };
      cloud.docs.set(id, doc);
      return { data: doc, error: null };
    },
    from: () => ({
      select: () => ({
        order: async () => ({
          data: [...cloud.docs.values()].filter(
            (d) => d.owner_id === cloud.owner
          ),
          error: null,
        }),
        eq: (_key: string, id: string) => ({
          single: async () => ({ data: cloud.docs.get(id), error: null }),
        }),
      }),
    }),
  },
}));
import { ToolRepository, clearToolCache } from "./repository";
beforeEach(async () => {
  cloud.docs.clear();
  cloud.owner = "u1";
  cloud.online = true;
  vi.stubGlobal("navigator", {
    get onLine() {
      return cloud.online;
    },
  });
  vi.stubGlobal("localStorage", { removeItem: vi.fn() });
  await clearToolCache("u1");
  await clearToolCache("u2");
});
describe("offline private documents", () => {
  it("keeps quick-use inputs local until the user explicitly saves work", async () => {
    const repo = new ToolRepository("u1");
    await repo.init();
    const doc = await repo.create(
      "molarity",
      "Draft",
      { mass: "1" },
      { draft: true }
    );
    await repo.update(doc.id, { data: { mass: "2" } });
    await repo.sync();
    expect(cloud.docs.has(doc.id)).toBe(false);
    expect(repo.items.find((row) => row.doc.id === doc.id)?.draft).toBe(true);
    await repo.saveDraft(doc.id, "Saved calculation");
    await vi.waitFor(() =>
      expect(cloud.docs.get(doc.id)?.title).toBe("Saved calculation")
    );
    repo.close();
  });
  it("restores offline edits and synchronizes them on reconnection", async () => {
    cloud.online = false;
    const repo = new ToolRepository("u1");
    await repo.init();
    const doc = await repo.create("notes", "Offline", { body: "draft" });
    await repo.update(doc.id, { data: { body: "edited" } });
    repo.close();
    const reopened = new ToolRepository("u1");
    await reopened.init();
    expect(reopened.items[0].doc.data.body).toBe("edited");
    cloud.online = true;
    await reopened.sync();
    expect(cloud.docs.get(doc.id)?.data.body).toBe("edited");
    expect(reopened.items[0].status).toBe("synced");
    reopened.close();
  });
  it("preserves both sides of a version conflict", async () => {
    const repo = new ToolRepository("u1");
    await repo.init();
    const doc = await repo.create("notes", "First", { body: "initial" });
    await vi.waitFor(() => expect(repo.items[0].status).toBe("synced"));
    cloud.online = false;
    await repo.update(doc.id, { data: { body: "local" } });
    const remote = {
      ...cloud.docs.get(doc.id)!,
      revision: 2,
      data: { body: "remote" },
    };
    cloud.docs.set(doc.id, remote);
    cloud.online = true;
    await repo.sync();
    expect(repo.items[0].status).toBe("conflict");
    expect(repo.items[0].doc.data.body).toBe("local");
    expect(repo.items[0].remote?.data.body).toBe("remote");
    await repo.resolve(doc.id, "local");
    await vi.waitFor(() => expect(cloud.docs.get(doc.id)?.revision).toBe(3));
    repo.close();
  });
  it("isolates caches by account and clears them on logout", async () => {
    cloud.online = false;
    const first = new ToolRepository("u1");
    await first.init();
    await first.create("notes", "Private");
    const other = new ToolRepository("u2");
    await other.init();
    expect(other.items).toHaveLength(0);
    first.close();
    await clearToolCache("u1");
    const reopened = new ToolRepository("u1");
    await reopened.init();
    expect(reopened.items).toHaveLength(0);
    other.close();
    reopened.close();
  });
});

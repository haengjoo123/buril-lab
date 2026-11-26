import "fake-indexeddb/auto";
import { beforeEach, describe, it, expect, vi } from "vitest";
import type { ToolDocument } from "./registry";
const cloud = vi.hoisted(() => ({
  docs: new Map<string, ToolDocument>(),
  owner: "u1",
  online: true,
  // Tests hold these to keep a request in flight at a known point.
  userGate: undefined as Promise<void> | undefined,
  rpcGate: undefined as Promise<void> | undefined,
  rpcWaiting: 0,
  rpcCalls: 0,
  pulls: 0,
}));
vi.mock("../../services/supabaseClient", () => ({
  supabase: {
    auth: {
      getUser: async () => {
        await cloud.userGate;
        return { data: { user: { id: cloud.owner } } };
      },
    },
    rpc: async (_name: string, p: Record<string, unknown>) => {
      cloud.rpcCalls += 1;
      if (cloud.rpcGate) {
        cloud.rpcWaiting += 1;
        await cloud.rpcGate;
      }
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
          data: [...((cloud.pulls += 1), cloud.docs.values())].filter(
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
import {
  ToolRepository,
  clearToolCache,
  closeToolRepository,
  getToolRepository,
  mergePreferences,
  prepareToolSignOut,
} from "./repository";
import { pendingWorkMessage, saveState } from "./status";
const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
};
const serverDoc = (
  id: string,
  tool_id: ToolDocument["tool_id"],
  data: Record<string, unknown>,
  revision: number
): ToolDocument => ({
  id,
  owner_id: "u1",
  tool_id,
  title: "Server copy",
  data,
  revision,
  schema_version: 1,
  engine_version: "1",
  updated_at: new Date().toISOString(),
});
beforeEach(async () => {
  cloud.docs.clear();
  cloud.owner = "u1";
  cloud.online = true;
  cloud.userGate = undefined;
  cloud.rpcGate = undefined;
  cloud.rpcWaiting = 0;
  cloud.rpcCalls = 0;
  cloud.pulls = 0;
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
describe("first sync on an empty cache", () => {
  it("adopts the server workspace when the local copy was never edited", async () => {
    cloud.docs.set(
      "w1",
      serverDoc("w1", "timer", { _workspace: true, clocks: [{ id: "c1" }] }, 3)
    );
    const hold = gate();
    cloud.userGate = hold.promise;
    const repo = new ToolRepository("u1");
    const started = repo.init();
    await vi.waitFor(() => expect(repo.ready).toBe(true));
    expect(repo.hydrated).toBe(false);
    // The shell opens the tool before the first pull has finished.
    await repo.create("timer", "Timer", { _workspace: true }, { id: "w1" });
    hold.release();
    await started;
    await repo.sync();
    const item = repo.items.find((row) => row.doc.id === "w1")!;
    expect(repo.hydrated).toBe(true);
    expect(item.status).toBe("synced");
    expect(item.remote).toBeUndefined();
    expect(item.doc.data.clocks).toHaveLength(1);
    expect(cloud.docs.get("w1")?.revision).toBe(3);
    repo.close();
  });
  it("still reports a conflict when the local copy was edited before the first pull", async () => {
    cloud.docs.set(
      "w1",
      serverDoc("w1", "timer", { _workspace: true, clocks: [{ id: "c1" }] }, 3)
    );
    const hold = gate();
    cloud.userGate = hold.promise;
    const repo = new ToolRepository("u1");
    const started = repo.init();
    await vi.waitFor(() => expect(repo.ready).toBe(true));
    await repo.create("timer", "Timer", { _workspace: true }, { id: "w1" });
    await repo.update("w1", {
      data: { _workspace: true, clocks: [{ id: "local" }] },
    });
    hold.release();
    await started;
    await repo.sync();
    const item = repo.items.find((row) => row.doc.id === "w1")!;
    expect(item.status).toBe("conflict");
    expect((item.doc.data.clocks as { id: string }[])[0].id).toBe("local");
    expect((item.remote?.data.clocks as { id: string }[])[0].id).toBe("c1");
    expect(cloud.docs.get("w1")?.revision).toBe(3);
    repo.close();
  });
  it("keeps a workspace that was created already holding work", async () => {
    cloud.docs.set(
      "w1",
      serverDoc("w1", "timer", { _workspace: true, clocks: [{ id: "c1" }] }, 3)
    );
    const hold = gate();
    cloud.userGate = hold.promise;
    const repo = new ToolRepository("u1");
    const started = repo.init();
    await vi.waitFor(() => expect(repo.ready).toBe(true));
    // A timer started from another tool before the first pull: never edited
    // afterwards, but not empty either.
    await repo.create(
      "timer",
      "Timer",
      { _workspace: true, clocks: [{ id: "started-elsewhere" }] },
      { id: "w1" }
    );
    hold.release();
    await started;
    await repo.sync();
    const item = repo.items.find((row) => row.doc.id === "w1")!;
    expect(item.status).toBe("conflict");
    expect((item.doc.data.clocks as { id: string }[])[0].id).toBe(
      "started-elsewhere"
    );
    repo.close();
  });
  it("marks the cache hydrated when the first pull cannot run", async () => {
    cloud.online = false;
    const repo = new ToolRepository("u1");
    await repo.init();
    expect(repo.hydrated).toBe(true);
    repo.close();
  });
});
describe("preferences document", () => {
  it("merges favorites from both sides instead of stopping on a conflict", async () => {
    cloud.docs.set(
      "p1",
      serverDoc("p1", "notes", { _preferences: true, favorites: ["timer"] }, 2)
    );
    const hold = gate();
    cloud.userGate = hold.promise;
    const repo = new ToolRepository("u1");
    const started = repo.init();
    await vi.waitFor(() => expect(repo.ready).toBe(true));
    // Created already holding the favorite the user just picked: an unedited
    // preferences document is not an empty placeholder.
    await repo.create(
      "notes",
      ".preferences",
      { _preferences: true, favorites: ["dilution"] },
      { id: "p1" }
    );
    hold.release();
    await started;
    await repo.sync();
    const item = repo.items.find((row) => row.doc.id === "p1")!;
    expect(item.status).toBe("synced");
    expect(item.remote).toBeUndefined();
    expect(cloud.docs.get("p1")?.data.favorites).toEqual(["timer", "dilution"]);
    await repo.update("p1", {
      data: { _preferences: true, favorites: ["timer", "dilution", "molarity"] },
    });
    await vi.waitFor(() =>
      expect(cloud.docs.get("p1")?.data.favorites).toHaveLength(3)
    );
    repo.close();
  });
  it("recovers a preferences document stuck in a conflict", async () => {
    const repo = new ToolRepository("u1");
    await repo.init();
    await repo.create(
      "notes",
      ".preferences",
      { _preferences: true, favorites: ["dilution"] },
      { id: "p1" }
    );
    await vi.waitFor(() => expect(cloud.docs.get("p1")?.revision).toBe(1));
    // The state an earlier build left behind: both versions kept, sync halted.
    const stuck = repo.items.find((row) => row.doc.id === "p1")!;
    const remote = {
      ...cloud.docs.get("p1")!,
      revision: 2,
      data: { _preferences: true, favorites: ["timer"] },
    };
    cloud.docs.set("p1", remote);
    stuck.remote = remote;
    stuck.dirty = true;
    stuck.status = "conflict";
    await repo.sync();
    const item = repo.items.find((row) => row.doc.id === "p1")!;
    expect(item.status).toBe("synced");
    expect(item.remote).toBeUndefined();
    expect(cloud.docs.get("p1")?.data.favorites).toEqual(["timer", "dilution"]);
    repo.close();
  });
  it("keeps unknown keys from both sides", () => {
    expect(
      mergePreferences(
        { _preferences: true, favorites: ["a", "b"], localOnly: 1 },
        { _preferences: true, favorites: ["b", "c"], remoteOnly: 2 }
      )
    ).toEqual({
      _preferences: true,
      favorites: ["b", "c", "a"],
      localOnly: 1,
      remoteOnly: 2,
    });
  });
});
describe("sign-out", () => {
  const openRepository = async () => {
    const repo = getToolRepository("u1");
    await vi.waitFor(() => expect(repo.hydrated).toBe(true));
    return repo;
  };
  it("sends unsynced work before the device cache is cleared", async () => {
    cloud.online = false;
    const repo = await openRepository();
    const doc = await repo.create("notes", "Written offline", { body: "x" });
    cloud.online = true;
    const pending = await prepareToolSignOut("u1");
    expect(cloud.docs.get(doc.id)?.data.body).toBe("x");
    expect(pending.documents).toHaveLength(0);
    expect(pendingWorkMessage(pending, true)).toBe("");
    await closeToolRepository("u1");
  });
  it("reports what would be deleted when it cannot be sent", async () => {
    cloud.online = false;
    const repo = await openRepository();
    await repo.create("notes", "Written offline", { body: "x" });
    const project = await repo.create("master-mix", "Mix", {}, { draft: true });
    await repo.update(project.id, { data: { count: 8 } });
    // Tools that were merely opened have nothing to lose.
    await repo.create("plate-labelling", "Plate", {}, { draft: true });
    await repo.create("timer", "Timer", { _workspace: true }, { id: "w1" });
    await repo.create(
      "notes",
      ".preferences",
      { _preferences: true, favorites: ["timer"] },
      { id: "p1" }
    );
    const pending = await prepareToolSignOut("u1");
    expect(pending.documents.map((doc) => doc.title)).toEqual([
      "Written offline",
    ]);
    expect(pending.drafts.map((doc) => doc.title)).toEqual(["Mix"]);
    const question = pendingWorkMessage(pending, true);
    expect(question).toContain("동기화되지 않은 작업 1개");
    expect(question).toContain("저장하지 않은 초안 1개");
    expect(question).not.toContain("이미지");
    expect(pendingWorkMessage(pending, false)).not.toMatch(/[가-힣]/);
    await closeToolRepository("u1");
  });
  it("does not wait past the limit for a request that hangs", async () => {
    const repo = await openRepository();
    const hold = gate();
    cloud.rpcGate = hold.promise;
    await repo.create("notes", "Slow network", { body: "x" });
    const started = Date.now();
    const pending = await prepareToolSignOut("u1", 80);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(pending.documents).toHaveLength(1);
    cloud.rpcGate = undefined;
    hold.release();
    await closeToolRepository("u1");
  });
  it("has nothing to report for an account that never opened the tools", async () => {
    expect(await prepareToolSignOut("u2")).toEqual({
      documents: [],
      drafts: [],
      images: 0,
    });
  });
});
describe("batched writes", () => {
  it("sends a burst of edits as one request and without re-fetching everything", async () => {
    const repo = new ToolRepository("u1");
    await repo.init();
    const doc = await repo.create("notes", "Note", { body: "" });
    await vi.waitFor(() => expect(cloud.docs.has(doc.id)).toBe(true));
    await vi.waitFor(() =>
      expect(repo.items.find((row) => row.doc.id === doc.id)?.status).toBe(
        "synced"
      )
    );
    const sent = cloud.rpcCalls,
      pulled = cloud.pulls;
    for (const body of ["h", "he", "hel", "hell", "hello"])
      void repo.update(doc.id, { data: { body } });
    // Subscribers see each edit at once, before anything is written or sent.
    expect(repo.items.find((row) => row.doc.id === doc.id)?.doc.data.body).toBe(
      "hello"
    );
    await vi.waitFor(
      () => expect(cloud.docs.get(doc.id)?.data.body).toBe("hello"),
      { timeout: 4000 }
    );
    expect(cloud.rpcCalls - sent).toBe(1);
    expect(cloud.pulls).toBe(pulled);
    await repo.sync();
    expect(cloud.pulls).toBe(pulled + 1);
    repo.close();
  });
  it("writes pending edits to the device at once when asked", async () => {
    cloud.online = false;
    const repo = new ToolRepository("u1");
    await repo.init();
    const doc = await repo.create("notes", "Note", { body: "" });
    const pending = repo.update(doc.id, { data: { body: "typed" } });
    await repo.flush();
    const other = new ToolRepository("u1");
    await other.init();
    expect(other.items.find((row) => row.doc.id === doc.id)?.doc.data.body).toBe(
      "typed"
    );
    await pending;
    other.close();
    repo.close();
  });
  it("sends a rename without waiting for a pause", async () => {
    const repo = new ToolRepository("u1");
    await repo.init();
    const doc = await repo.create("notes", "Old name", {});
    await vi.waitFor(() => expect(cloud.docs.has(doc.id)).toBe(true));
    await repo.update(doc.id, { title: "New name" });
    await vi.waitFor(() =>
      expect(cloud.docs.get(doc.id)?.title).toBe("New name")
    );
    repo.close();
  });
  it("drops a device draft without touching the server", async () => {
    const repo = new ToolRepository("u1");
    await repo.init();
    const draft = await repo.create("calculator", "Calc", {}, { draft: true });
    const saved = await repo.create("notes", "Keep", {});
    await repo.discard(draft.id);
    await repo.discard(saved.id);
    expect(repo.items.map((row) => row.doc.id)).toEqual([saved.id]);
    const reopened = new ToolRepository("u1");
    await reopened.init();
    expect(reopened.items.map((row) => row.doc.title)).toEqual(["Keep"]);
    reopened.close();
    repo.close();
  });
});
describe("save status", () => {
  it("pushes an edit made while a save request is in flight", async () => {
    const repo = new ToolRepository("u1");
    await repo.init();
    const doc = await repo.create("notes", "Note", { body: "a" });
    await vi.waitFor(() =>
      expect(cloud.docs.get(doc.id)?.data.body).toBe("a")
    );
    await vi.waitFor(() =>
      expect(repo.items.find((row) => row.doc.id === doc.id)?.status).toBe(
        "synced"
      )
    );
    const hold = gate();
    cloud.rpcGate = hold.promise;
    await repo.update(doc.id, { data: { body: "b" } }, { immediate: true });
    await vi.waitFor(() => expect(cloud.rpcWaiting).toBe(1));
    await repo.update(doc.id, { data: { body: "c" } }, { immediate: true });
    cloud.rpcGate = undefined;
    hold.release();
    await vi.waitFor(
      () => expect(cloud.docs.get(doc.id)?.data.body).toBe("c"),
      { timeout: 4000 }
    );
    repo.close();
  });
  it("reports offline instead of an endless saving state", async () => {
    cloud.online = false;
    const repo = new ToolRepository("u1");
    await repo.init();
    const doc = await repo.create("notes", "Offline note", { body: "x" });
    const find = () => repo.items.find((row) => row.doc.id === doc.id)!;
    expect(repo.offline).toBe(true);
    expect(saveState(find(), repo)).toBe("offline");
    cloud.online = true;
    await repo.sync();
    expect(repo.offline).toBe(false);
    expect(saveState(find(), repo)).toBe("saved");
    repo.close();
  });
  it("names every state the shell can show", () => {
    const base = { status: "synced" as const, dirty: false };
    const repo = { error: "", offline: false };
    expect(saveState({ ...base, draft: true }, repo)).toBe("draft");
    expect(saveState(base, repo)).toBe("saved");
    expect(saveState({ status: "local", dirty: true }, repo)).toBe("saving");
    expect(
      saveState({ status: "error", dirty: true }, { ...repo, error: "boom" })
    ).toBe("retrying");
    expect(saveState({ status: "conflict", dirty: true }, repo)).toBe(
      "conflict"
    );
    expect(
      saveState(base, { error: "Local storage failed", offline: false })
    ).toBe("storage-error");
    expect(saveState(undefined, { error: "", offline: true })).toBe("offline");
  });
});

import { supabase } from "../../services/supabaseClient";
import { v5 } from "uuid";
export const toolWorkspaceId = (owner: string, tool: string) =>
  v5(`burillab:tools:${owner}:${tool}`, v5.URL);
import {
  ENGINE_VERSION,
  type ToolDocument,
  type ToolId,
  type SaveStatus,
} from "./registry";
type Local = {
  doc: ToolDocument;
  dirty: boolean;
  generation: number;
  status: SaveStatus;
  remote?: ToolDocument;
  error?: string;
  draft?: boolean;
};
export type ToolRecord = Local;
const isPreferences = (doc: ToolDocument) => doc.data._preferences === true;
const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
/**
 * Preferences are one hidden document per account, edited from every device.
 * A revision conflict there has no screen to resolve it on, so both sides are
 * combined: lists are unioned (server order first) and other keys keep the
 * local value. Removing a favorite on one device can therefore be undone by a
 * concurrent edit elsewhere, which is the cheaper mistake.
 */
export function mergePreferences(
  local: Record<string, unknown>,
  remote: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...remote,
    ...local,
    _preferences: true,
    favorites: [
      ...new Set([...strings(remote.favorites), ...strings(local.favorites)]),
    ],
  };
}
type Asset = {
  id: string;
  owner: string;
  document: string;
  blob: Blob;
  preview?: Blob;
  uploaded: boolean;
};
const HYDRATION_WAIT_MS = 8000;
const FOLLOW_UP_SYNC_MS = 1000;
const messageOf = (e: unknown) =>
  e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
const dbPromise = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("buril-tools-v1", 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("documents", { keyPath: "id" });
      r.result.createObjectStore("assets", { keyPath: "id" });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
async function dbGet<T>(store: string, id: string): Promise<T | undefined> {
  const db = await dbPromise();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(store).objectStore(store).get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
async function imagePreview(blob: Blob): Promise<Blob | undefined> {
  if (typeof document === "undefined" || typeof Image === "undefined") return;
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const ratio = Math.min(1, 2048 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * ratio));
    canvas.height = Math.max(1, Math.round(image.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) =>
      canvas.toBlob((result) => resolve(result ?? undefined), blob.type, 0.9)
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function dbRead<T>(store: string): Promise<T[]> {
  const db = await dbPromise();
  try {
    return await new Promise((resolve, reject) => {
      const r = db.transaction(store).objectStore(store).getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}
async function dbWrite<T extends { id: string }>(
  store: string,
  value: T | string
) {
  const db = await dbPromise();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      if (typeof value === "string") tx.objectStore(store).delete(value);
      else tx.objectStore(store).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export class ToolRepository {
  items: Local[] = [];
  /** Local cache has been read; documents can be shown and edited. */
  ready = false;
  /**
   * The first pull has finished, or cannot run (offline, failed, timed out).
   * Until then the cache may simply be missing documents the account already
   * has, so nothing with a fixed id should be created.
   */
  hydrated = false;
  /** The last sync attempt was skipped because the device is offline. */
  offline = false;
  error = "";
  private listeners = new Set<() => void>();
  private syncing = false;
  /** An edit asked for a sync while one was running. */
  private resync = false;
  private followUp?: ReturnType<typeof setTimeout>;
  private closed = false;
  private writes: Promise<unknown> = Promise.resolve();
  readonly owner: string;
  constructor(owner: string) {
    this.owner = owner;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit() {
    this.items = [...this.items];
    this.listeners.forEach((l) => l());
  }
  private async persist(item: Local) {
    try {
      if (this.closed) return;
      const snapshot = structuredClone({ id: item.doc.id, ...item });
      this.writes = this.writes
        .catch(() => {})
        .then(() => (this.closed ? undefined : dbWrite("documents", snapshot)));
      await this.writes;
    } catch (e) {
      item.status = "error";
      item.error = String(e);
      this.error = "Local storage failed";
      this.emit();
      throw e;
    }
  }
  async init() {
    try {
      this.items = (await dbRead<Local & { id: string }>("documents")).filter(
        (i) => i.doc.owner_id === this.owner
      );
      this.ready = true;
      this.emit();
      // A stalled request must not keep fixed-id tools closed forever. If the
      // pull is still pending after the wait, an untouched local placeholder
      // is still replaced by the server copy when its first push conflicts.
      const giveUp = setTimeout(() => this.markHydrated(), HYDRATION_WAIT_MS);
      try {
        await this.sync();
      } finally {
        clearTimeout(giveUp);
        this.markHydrated();
      }
    } catch (e) {
      this.ready = true;
      this.hydrated = true;
      this.error = String(e);
      this.emit();
    }
  }
  private markHydrated() {
    if (this.hydrated || this.closed) return;
    this.hydrated = true;
    this.emit();
  }
  async create(
    tool_id: ToolId,
    title: string,
    data: Record<string, unknown> = {},
    options: { draft?: boolean; id?: string } = {}
  ) {
    const item: Local = {
      doc: {
        id: options.id ?? crypto.randomUUID(),
        owner_id: this.owner,
        tool_id,
        title,
        data,
        schema_version: 1,
        engine_version: ENGINE_VERSION,
        revision: 0,
        updated_at: new Date().toISOString(),
      },
      dirty: !options.draft,
      draft: !!options.draft,
      generation: 1,
      status: "local",
    };
    await this.persist(item);
    if (this.closed) return item.doc;
    this.items.unshift(item);
    this.emit();
    void this.sync();
    return item.doc;
  }
  async update(
    id: string,
    patch: Partial<Pick<ToolDocument, "title" | "data" | "deleted_at">>
  ) {
    if (this.closed) return;
    const current = this.items.find((i) => i.doc.id === id);
    if (!current) return;
    const item = {
      ...current,
      doc: { ...current.doc, ...patch, updated_at: new Date().toISOString() },
      dirty: !current.draft,
      generation: current.generation + 1,
      status: (current.remote ? "conflict" : "saving") as SaveStatus,
    };
    this.items = this.items.map((i) => (i.doc.id === id ? item : i));
    this.emit();
    await this.persist(item);
    if (item.status !== "conflict") {
      item.status = "local";
      this.emit();
      void this.sync();
    }
  }
  async resolve(id: string, choice: "local" | "remote") {
    const item = this.items.find((i) => i.doc.id === id);
    if (!item?.remote) return;
    if (choice === "remote") {
      item.doc = item.remote;
      item.dirty = false;
    } else {
      item.doc = { ...item.doc, revision: item.remote.revision };
      item.dirty = true;
    }
    item.remote = undefined;
    item.status = item.dirty ? "local" : "synced";
    await this.persist(item);
    this.emit();
    void this.sync();
  }
  async saveDraft(id: string, title: string) {
    const item = this.items.find((row) => row.doc.id === id);
    if (!item) return;
    item.draft = false;
    await this.update(id, { title });
  }
  /**
   * Sends one dirty document. A revision conflict normally keeps both versions
   * for the user to choose from, with two exceptions that need no choice: a
   * local copy that was created and never edited, and the preferences
   * document, which is merged and sent again.
   */
  private async push(id: string, attempt = 0): Promise<void> {
    const item = this.items.find((i) => i.doc.id === id);
    if (!item) return;
    // A preferences conflict left by an earlier version of this code.
    if (item.remote) this.mergeRemotePreferences(item, item.remote);
    const generation = item.generation;
    const { data, error } = await supabase.rpc("save_tool_document", {
      p_id: item.doc.id,
      p_tool_id: item.doc.tool_id,
      p_title: item.doc.title,
      p_data: item.doc.data,
      p_engine_version: ENGINE_VERSION,
      p_expected_revision: item.doc.revision,
      p_deleted_at: item.doc.deleted_at ?? null,
    });
    if (this.closed) return;
    const current = this.items.find((i) => i.doc.id === id);
    if (!current) return;
    if (!error) {
      const remote = (Array.isArray(data) ? data[0] : data) as ToolDocument;
      current.doc =
        current.generation === generation
          ? remote
          : { ...current.doc, revision: remote.revision };
      current.dirty = current.generation !== generation;
      current.status = current.dirty ? "local" : "synced";
      await this.persist(current);
      return;
    }
    if (error.code !== "40001") {
      current.status = "error";
      current.error = error.message;
      await this.persist(current);
      return;
    }
    const r = await supabase
      .from("tool_documents")
      .select("*")
      .eq("id", id)
      .single();
    if (this.closed) return;
    const remote = r.data as ToolDocument | null;
    if (!remote) {
      current.status = "error";
      current.error = error.message;
    } else if (isPreferences(current.doc) && attempt < 2) {
      // Checked first: a preferences document is created already holding the
      // favorite the user just picked, so "never edited" does not mean empty.
      this.mergeRemotePreferences(current, remote);
      await this.persist(current);
      return this.push(id, attempt + 1);
    } else if (current.doc.revision === 0 && current.generation === 1) {
      // Created here before the account's copy arrived and never touched:
      // there is nothing local to lose, so the server copy simply replaces it.
      current.doc = remote;
      current.dirty = false;
      current.remote = undefined;
      current.status = "synced";
    } else {
      current.remote = remote;
      current.status = "conflict";
    }
    await this.persist(current);
  }
  private mergeRemotePreferences(item: Local, remote: ToolDocument) {
    item.doc = {
      ...item.doc,
      data: mergePreferences(item.doc.data, remote.data),
      revision: remote.revision,
    };
    item.remote = undefined;
    item.dirty = true;
    item.status = "local";
  }
  async sync() {
    if (this.closed) return;
    if (!navigator.onLine) {
      if (!this.offline) {
        this.offline = true;
        this.emit();
      }
      return;
    }
    if (this.syncing) {
      // The running sync may already have sent this document; ask for one
      // more pass so the newer edit does not wait for the periodic sync.
      this.resync = true;
      return;
    }
    this.syncing = true;
    this.resync = false;
    this.offline = false;
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (this.closed || user?.id !== this.owner) return;
      for (const item of [...this.items]) {
        if (!item.dirty || item.draft) continue;
        if (item.remote && !isPreferences(item.doc)) continue;
        await this.push(item.doc.id);
        if (this.closed) return;
      }
      const { data, error } = await supabase
        .from("tool_documents")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      if (this.closed) return;
      for (const doc of (data ?? []) as ToolDocument[]) {
        const local = this.items.find((i) => i.doc.id === doc.id);
        if (local?.dirty || local?.remote) continue;
        const item: Local = {
          doc,
          dirty: false,
          generation: local?.generation ?? 0,
          status: "synced",
        };
        this.items = this.items.filter((i) => i.doc.id !== doc.id);
        this.items.push(item);
        await this.persist(item);
      }
      for (const asset of await dbRead<Asset>("assets")) {
        if (asset.owner !== this.owner || asset.uploaded || this.closed)
          continue;
        const parent = this.items.find((i) => i.doc.id === asset.document);
        if (!parent || parent.draft || parent.doc.revision === 0) continue;
        const path = `${this.owner}/${asset.id}`;
        const upload = await supabase.storage
          .from("tool-images")
          .upload(path, asset.blob, {
            contentType: asset.blob.type,
            upsert: true,
          });
        if (upload.error) throw upload.error;
        const meta = await supabase.from("tool_attachments").upsert(
          {
            id: asset.id,
            owner_id: this.owner,
            document_id: asset.document,
            path,
            mime_type: asset.blob.type,
          },
          { onConflict: "id" }
        );
        if (meta.error) throw meta.error;
        if (this.closed) return;
        await dbWrite("assets", { ...asset, uploaded: true });
      }
      this.error = "";
    } catch (e) {
      if (!this.closed) this.error = messageOf(e);
    } finally {
      this.syncing = false;
      if (!this.closed) {
        this.emit();
        if (this.resync && !this.followUp)
          this.followUp = setTimeout(() => {
            this.followUp = undefined;
            void this.sync();
          }, FOLLOW_UP_SYNC_MS);
      }
    }
  }
  async putImage(document: string, blob: Blob) {
    if (
      !["image/png", "image/jpeg"].includes(blob.type) ||
      blob.size > 20 * 1024 * 1024
    )
      throw Error("PNG/JPEG, maximum 20 MB");
    const asset: Asset = {
      id: crypto.randomUUID(),
      owner: this.owner,
      document,
      blob,
      preview: await imagePreview(blob).catch(() => undefined),
      uploaded: false,
    };
    await dbWrite("assets", asset);
    if (this.closed) {
      await dbWrite("assets", asset.id);
      throw Error("Session ended");
    }
    void this.sync();
    return asset.id;
  }
  async getImage(id: string, preview = false) {
    const cached = await dbGet<Asset>("assets", id),
      local = cached?.owner === this.owner ? cached : undefined;
    if (local) {
      if (!preview) return local.blob;
      if (local.preview) return local.preview;
      const generated = await imagePreview(local.blob).catch(() => undefined);
      if (generated && !this.closed)
        await dbWrite("assets", { ...local, preview: generated });
      return generated ?? local.blob;
    }
    const { data, error } = await supabase.storage
      .from("tool-images")
      .download(`${this.owner}/${id}`);
    if (error) throw error;
    if (this.closed) throw Error("Session ended");
    const generated = preview
      ? await imagePreview(data).catch(() => undefined)
      : undefined;
    await dbWrite("assets", {
      id,
      owner: this.owner,
      document: "",
      blob: data,
      preview: generated,
      uploaded: true,
    });
    if (this.closed) {
      await dbWrite("assets", id);
      throw Error("Session ended");
    }
    return generated ?? data;
  }
  close() {
    this.closed = true;
    clearTimeout(this.followUp);
    this.listeners.clear();
  }
  async drain() {
    await this.writes.catch(() => {});
  }
}
export async function clearToolCache(owner: string) {
  for (const i of await dbRead<Local & { id: string }>("documents"))
    if (i.doc.owner_id === owner) await dbWrite("documents", i.id);
  for (const a of await dbRead<Asset>("assets"))
    if (a.owner === owner) await dbWrite("assets", a.id);
  localStorage.removeItem(`buril-tools-favorites:${owner}`);
  localStorage.removeItem(`buril-tools-notifications:${owner}`);
}
const repositories = new Map<string, ToolRepository>();
export function getToolRepository(owner: string) {
  let repo = repositories.get(owner);
  if (!repo) {
    repo = new ToolRepository(owner);
    repositories.set(owner, repo);
    void repo.init();
  }
  return repo;
}
export async function closeToolRepository(owner: string) {
  const repo = repositories.get(owner);
  repo?.close();
  repositories.delete(owner);
  await repo?.drain();
  await clearToolCache(owner);
}

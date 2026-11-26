import { supabase } from "../../services/supabaseClient";
import { v5 } from "uuid";
import { mergeRecent } from "./catalog";
export const toolWorkspaceId = (owner: string, tool: string) =>
  v5(`burillab:tools:${owner}:${tool}`, v5.URL);
import {
  ENGINE_VERSION,
  projectToolIds,
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
/** Work that exists only in this device's cache and would go with it. */
export type PendingToolWork = {
  /** Named or workspace documents with edits the server does not have. */
  documents: ToolDocument[];
  /** Edited quick-use drafts of tools whose work can be saved. */
  drafts: ToolDocument[];
  /** Images not uploaded yet. */
  images: number;
};
const NO_PENDING_WORK: PendingToolWork = { documents: [], drafts: [], images: 0 };
const isPreferences = (doc: ToolDocument) => doc.data._preferences === true;
/**
 * A workspace the shell created on opening a tool and nothing has been put in.
 * Not merely "never edited": a document can be created already holding work
 * (a timer started from another tool), and that must not be thrown away.
 */
const isEmptyPlaceholder = (item: Local) =>
  item.doc.revision === 0 &&
  item.generation === 1 &&
  Object.keys(item.doc.data).every((key) => key === "_workspace");
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
  const merged: Record<string, unknown> = {
    ...remote,
    ...local,
    _preferences: true,
    favorites: [
      ...new Set([...strings(remote.favorites), ...strings(local.favorites)]),
    ],
  };
  if ("recent" in local || "recent" in remote)
    merged.recent = mergeRecent(local.recent, remote.recent);
  return merged;
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
// Typing changes a document many times a second. The screen follows every
// change at once; the device write and the server request wait for a pause,
// with a ceiling so steady typing is still saved every few seconds.
const PERSIST_DELAY_MS = 400;
const PERSIST_MAX_WAIT_MS = 2000;
const SYNC_DELAY_MS = 1500;
const SYNC_MAX_WAIT_MS = 10000;
// The API returns at most this many rows per request by default; a full page
// may be a truncated answer.
const PULL_ROW_CAP = 1000;
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
  private inFlight?: Promise<void>;
  /** An edit asked for a sync while one was running. */
  private resync = false;
  private resyncPull = false;
  private followUp?: ReturnType<typeof setTimeout>;
  /** Documents changed in memory and not yet written to the device. */
  private unwritten = new Set<string>();
  private pendingWrite?: {
    promise: Promise<void>;
    resolve: () => void;
    reject: (reason: unknown) => void;
    timer?: ReturnType<typeof setTimeout>;
    since: number;
  };
  private syncTimer?: ReturnType<typeof setTimeout>;
  private syncSince = 0;
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
  /**
   * Bumped on every change. A subscriber compares it after subscribing, so a
   * change that lands between its first read and its subscription is not
   * missed (the cache finishing its load right then used to be).
   */
  version = 0;
  private emit() {
    this.items = [...this.items];
    this.version += 1;
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
    if (!item.draft) void this.sync({ pull: false });
    return item.doc;
  }
  /**
   * Changes a document. Memory and subscribers see the change at once; the
   * device write and the server request are batched across rapid edits (see
   * the delays above). The returned promise settles once this change is on
   * the device. Renaming and trashing are written and sent immediately, as is
   * anything passed `immediate`.
   */
  async update(
    id: string,
    patch: Partial<Pick<ToolDocument, "title" | "data" | "deleted_at">>,
    options: { immediate?: boolean } = {}
  ) {
    if (this.closed) return;
    const current = this.items.find((i) => i.doc.id === id);
    if (!current) return;
    const immediate =
      options.immediate ?? ("title" in patch || "deleted_at" in patch);
    const item = {
      ...current,
      doc: { ...current.doc, ...patch, updated_at: new Date().toISOString() },
      dirty: !current.draft,
      generation: current.generation + 1,
      status: (current.remote ? "conflict" : "local") as SaveStatus,
    };
    this.items = this.items.map((i) => (i.doc.id === id ? item : i));
    this.emit();
    this.unwritten.add(id);
    await this.scheduleWrite(immediate);
    if (item.status !== "conflict" && !item.draft) this.requestSync(immediate);
  }
  private scheduleWrite(immediate: boolean): Promise<void> {
    if (!this.pendingWrite) {
      let resolve!: () => void, reject!: (reason: unknown) => void;
      const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      // Most callers do not wait for the write; a failure is already shown
      // through `error` and must not surface as an unhandled rejection too.
      promise.catch(() => {});
      this.pendingWrite = { promise, resolve, reject, since: Date.now() };
    }
    const pending = this.pendingWrite;
    clearTimeout(pending.timer);
    if (immediate) void this.flush();
    else
      pending.timer = setTimeout(
        () => void this.flush(),
        Math.min(
          PERSIST_DELAY_MS,
          Math.max(0, pending.since + PERSIST_MAX_WAIT_MS - Date.now())
        )
      );
    return pending.promise;
  }
  /**
   * Writes every pending change to the device now. Called when the page is
   * hidden or left, since a timer may never fire after that.
   */
  async flush() {
    const pending = this.pendingWrite;
    if (!pending) return;
    this.pendingWrite = undefined;
    clearTimeout(pending.timer);
    const ids = [...this.unwritten];
    this.unwritten.clear();
    try {
      for (const id of ids) {
        const item = this.items.find((i) => i.doc.id === id);
        if (item) await this.persist(item);
      }
      pending.resolve();
    } catch (e) {
      pending.reject(e);
    }
  }
  /** Sends pending edits after a pause in editing. Edits only push. */
  private requestSync(immediate: boolean) {
    clearTimeout(this.syncTimer);
    if (immediate) {
      this.syncTimer = undefined;
      this.syncSince = 0;
      void this.sync({ pull: false });
      return;
    }
    if (!this.syncSince) this.syncSince = Date.now();
    this.syncTimer = setTimeout(() => {
      this.syncTimer = undefined;
      this.syncSince = 0;
      void this.sync({ pull: false });
    }, Math.min(SYNC_DELAY_MS, Math.max(0, this.syncSince + SYNC_MAX_WAIT_MS - Date.now())));
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
  /**
   * Forgets documents that were permanently deleted on another device: synced
   * here, unchanged since, and no longer on the server. Skipped when the
   * server's answer may be incomplete (the API's row cap) or is empty while
   * this device holds synced work, where a wrong guess would delete it.
   */
  private async dropPurged(server: ToolDocument[]) {
    const present = new Set(server.map((doc) => doc.id));
    const gone = this.items.filter(
      (i) =>
        !i.draft &&
        !i.dirty &&
        !i.remote &&
        i.doc.revision > 0 &&
        !present.has(i.doc.id)
    );
    if (!gone.length || !server.length || server.length >= PULL_ROW_CAP) return;
    this.items = this.items.filter((i) => !gone.includes(i));
    for (const item of gone) await dbWrite("documents", item.doc.id);
  }
  /**
   * Permanently deletes work that is in the trash, on the server and here.
   * The image it holds goes too, unless another document (a duplicate) still
   * shows the same image.
   */
  async purge(id: string) {
    const item = this.items.find((i) => i.doc.id === id);
    if (!item || item.draft || !item.doc.deleted_at || this.closed) return;
    const forget = async () => {
      this.items = this.items.filter((i) => i.doc.id !== id);
      await dbWrite("documents", id);
      for (const asset of await dbRead<Asset>("assets"))
        if (asset.owner === this.owner && asset.document === id)
          await dbWrite("assets", asset.id);
      this.emit();
    };
    // Never reached the server: there is nothing to delete there.
    if (item.doc.revision === 0) return forget();
    if (!navigator.onLine) throw Error("Connect to delete permanently");
    // The server must know the document is in the trash before it will purge it.
    if (item.dirty) await this.sync({ pull: false });
    if (this.items.find((i) => i.doc.id === id)?.dirty)
      throw Error("Connect to delete permanently");
    const image = item.doc.data.asset;
    if (
      typeof image === "string" &&
      image &&
      !this.items.some((i) => i.doc.id !== id && i.doc.data.asset === image)
    )
      // Best effort: a leftover image is removed with the account at the latest.
      await supabase.storage
        .from("tool-images")
        .remove([`${this.owner}/${image}`])
        .catch(() => undefined);
    const { error } = await supabase.rpc("purge_tool_document", { p_id: id });
    if (error) {
      // The function arrives with a migration applied separately from the app.
      if (["PGRST202", "42883"].includes(String(error.code)))
        throw Error("Permanent delete is not available yet");
      throw Error(messageOf(error));
    }
    await forget();
  }
  /**
   * Removes a device-only draft for good. Only drafts: anything the server
   * knows about is trashed through `update`, never dropped locally.
   */
  async discard(id: string) {
    const item = this.items.find((row) => row.doc.id === id);
    if (!item?.draft || this.closed) return;
    this.items = this.items.filter((row) => row.doc.id !== id);
    this.writes = this.writes
      .catch(() => {})
      .then(() => (this.closed ? undefined : dbWrite("documents", id)));
    await this.writes;
    this.emit();
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
    } else if (isEmptyPlaceholder(current)) {
      // Created empty here before the account's copy arrived and never used:
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
  /**
   * Sends dirty documents and, unless `pull` is false, fetches the account's
   * documents. Edits ask for a push only; the full exchange runs at start-up,
   * on reconnect or focus, on the periodic timer and on request.
   */
  async sync(options: { pull?: boolean } = {}) {
    const pull = options.pull ?? true;
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
      this.resyncPull ||= pull;
      return this.inFlight;
    }
    this.inFlight = this.runSync(pull);
    return this.inFlight;
  }
  private async runSync(pull: boolean) {
    this.syncing = true;
    this.resync = false;
    this.resyncPull = false;
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
      if (pull) {
        const { data, error } = await supabase
          .from("tool_documents")
          .select("*")
          .order("updated_at", { ascending: false });
        if (error) throw error;
        if (this.closed) return;
        await this.dropPurged((data ?? []) as ToolDocument[]);
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
            void this.sync({ pull: this.resyncPull });
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
  /**
   * Documents that exist only on this device. Preferences and a workspace that
   * was opened but never used are left out: losing them loses no work.
   */
  localOnlyDocuments(): Pick<PendingToolWork, "documents" | "drafts"> {
    const documents = this.items
      .filter(
        (i) =>
          !i.draft &&
          (i.dirty || i.remote) &&
          !isPreferences(i.doc) &&
          !isEmptyPlaceholder(i)
      )
      .map((i) => i.doc);
    const drafts = this.items
      .filter(
        (i) =>
          i.draft &&
          i.generation > 1 &&
          !i.doc.deleted_at &&
          projectToolIds.includes(i.doc.tool_id)
      )
      .map((i) => i.doc);
    return { documents, drafts };
  }
  private async pendingImages() {
    return (await dbRead<Asset>("assets")).filter(
      (a) => a.owner === this.owner && !a.uploaded
    );
  }
  async pendingWork(): Promise<PendingToolWork> {
    return {
      ...this.localOnlyDocuments(),
      images: (await this.pendingImages()).length,
    };
  }
  /**
   * Gives unsent edits and images a last chance to reach the server, for at
   * most `limitMs`. A pass can end having sent only the state from before the
   * newest edit, hence the retries.
   */
  async settle(limitMs: number) {
    const deadline = Date.now() + limitMs;
    for (let pass = 0; pass < 3; pass++) {
      const left = deadline - Date.now();
      if (left <= 0 || this.closed || !navigator.onLine) return;
      const unsent =
        this.items.some((i) => i.dirty && !i.draft && !i.remote) ||
        (await this.pendingImages()).some((a) => {
          const parent = this.items.find((i) => i.doc.id === a.document);
          return parent && !parent.draft;
        });
      if (!unsent) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        this.sync(),
        new Promise<void>((resolve) => (timer = setTimeout(resolve, left))),
      ]);
      clearTimeout(timer);
    }
  }
  close() {
    this.closed = true;
    clearTimeout(this.followUp);
    clearTimeout(this.syncTimer);
    clearTimeout(this.pendingWrite?.timer);
    // Nothing more is written once closed; let anyone awaiting a write go.
    this.pendingWrite?.resolve();
    this.pendingWrite = undefined;
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
/**
 * Run before the device cache is cleared on sign-out. Tries once more to send
 * what the server does not have, then reports what would still be deleted so
 * the caller can ask first. Drafts are never uploaded here: they stay on the
 * device until the user saves them as named work.
 */
export async function prepareToolSignOut(
  owner: string,
  limitMs = 3000
): Promise<PendingToolWork> {
  const repo = repositories.get(owner);
  if (!repo?.ready) return NO_PENDING_WORK;
  await repo.settle(limitMs);
  return repo.pendingWork();
}
export async function closeToolRepository(owner: string) {
  const repo = repositories.get(owner);
  repo?.close();
  repositories.delete(owner);
  await repo?.drain();
  await clearToolCache(owner);
}

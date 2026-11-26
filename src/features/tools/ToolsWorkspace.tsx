import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { isToolId, toolById, type ToolCategory } from "./registry";
import {
  getToolRepository,
  toolWorkspaceId,
  type ToolRecord,
  type ToolRepository,
} from "./repository";
import { saveState } from "./status";
import { useText, ErrorMessage, download } from "./ui";
import "./tools.css";
import { isLabToolsEnabled } from "../../config/featureFlags";
import { touchRecent } from "./catalog";
import { pickRecord, spareDrafts } from "./records";
import { recordToolUsage } from "./usage";
import { readPreferences, updatePreferences } from "./preferences";
import ToolCatalog from "./ToolCatalog";
import SavedWorkList from "./SavedWorkList";
import ToolHost from "./ToolHost";

/**
 * The page heading: back link, title and the save status with its detail
 * panel. Keyed by route so the panel closes when the page changes.
 */
function ToolHeader({
  back,
  title,
  record,
  repo,
  showsStatus,
  savable,
}: {
  back: string | null;
  title: string;
  record: ToolRecord | undefined;
  repo: ToolRepository;
  showsStatus: boolean;
  /** Whether this tool's draft can be kept as named work. */
  savable: boolean;
}) {
  const t = useText();
  const [open, setOpen] = useState(false);
  const state = saveState(record, repo);
  const [status, detail] = {
    draft: [
      t("이 기기에만 보관", "On this device only"),
      savable
        ? t(
            "입력은 이 기기에 보관됩니다. 작업 저장을 선택하면 계정에 보관할 수 있습니다.",
            "Inputs are kept on this device. Save work to keep a named copy in your account."
          )
        : t(
            "입력은 이 기기에만 보관되며 로그아웃하면 지워집니다.",
            "Inputs are kept on this device only and are cleared when you sign out."
          ),
    ],
    saving: [
      t("저장 중", "Saving"),
      t(
        "계정에 저장하고 다른 기기와 동기화합니다.",
        "Saved to your account and synchronized across devices."
      ),
    ],
    saved: [
      t("저장됨", "Saved"),
      t(
        "계정에 저장하고 다른 기기와 동기화합니다.",
        "Saved to your account and synchronized across devices."
      ),
    ],
    offline: [
      t("오프라인 · 기기에 저장됨", "Offline · saved on device"),
      t(
        "오프라인입니다. 변경 내용은 이 기기에 저장되어 있으며 연결되면 계정에 동기화됩니다.",
        "You are offline. Changes are saved on this device and sync to your account when you reconnect."
      ),
    ],
    retrying: [
      t("동기화 대기 중", "Waiting to sync"),
      t(
        "현재 서버와 연결되지 않아 기기에 저장하고 있습니다. 연결되면 저장한 작업이 동기화됩니다.",
        "Working on this device while the server is unavailable. Saved work syncs when connected."
      ),
    ],
    conflict: [
      t("충돌 확인", "Review conflict"),
      t(
        "두 기기에서 수정되었습니다. 아래에서 유지할 버전을 선택하세요.",
        "This work was edited on two devices. Choose which version to keep below."
      ),
    ],
    "storage-error": [
      t("저장 오류", "Storage error"),
      t(
        "기기 저장에 실패했습니다. 저장 공간을 확인하세요.",
        "Device storage failed. Check available space."
      ),
    ],
  }[state];
  // Sign-out clears the device cache, so the panel offers a copy of whatever
  // the account does not have yet.
  const deviceOnly = open ? repo.localOnlyDocuments() : null;
  const localOnly = deviceOnly
    ? [...deviceOnly.documents, ...deviceOnly.drafts]
    : [];
  return (
    <>
      <header className="tool-toolbar tool-heading">
        {back && (
          <Link
            className="tool-button tool-back"
            to={back}
            aria-label={t("뒤로", "Back")}
          >
            <ArrowLeft size={20} />
          </Link>
        )}
        <h1 tabIndex={-1}>{title}</h1>
        {showsStatus && (
          <button
            className="tool-save-status"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-controls="tool-save-status-detail"
          >
            {status}
          </button>
        )}
      </header>
      {/* Announces a change of state (saved, offline, conflict), not every keystroke. */}
      <p className="sr-only" role="status" aria-live="polite">
        {showsStatus && state !== "saving" ? status : ""}
      </p>
      {open && showsStatus && (
        <div className="tool-connection" id="tool-save-status-detail">
          <p>{detail}</p>
          {state !== "draft" && state !== "storage-error" && (
            <button onClick={() => repo.sync()}>
              {t("동기화 다시 시도", "Retry sync")}
            </button>
          )}
          {localOnly.length > 0 && (
            <button
              onClick={() =>
                download(
                  JSON.stringify(localOnly, null, 2),
                  `buril-tools-device-only-${new Date()
                    .toISOString()
                    .slice(0, 10)}.json`,
                  "application/json"
                )
              }
            >
              {t(
                `이 기기에만 있는 작업 내보내기 (${localOnly.length})`,
                `Export work only on this device (${localOnly.length})`
              )}
            </button>
          )}
        </div>
      )}
    </>
  );
}

/**
 * The lab tools tab. Routes are read from the path:
 *   /app/tools?category=…          the tool list
 *   /app/tools/:tool               the tool on its quick-use draft or workspace
 *   /app/tools/:tool/:document     named work
 *   /app/tools/:tool?view=saved    that tool's named work and trash
 * It stays mounted while the user moves between these, so the list keeps its
 * search text; what must start fresh per page is keyed below.
 */
export default function ToolsWorkspace({ ownerId }: { ownerId: string }) {
  const t = useText(),
    location = useLocation(),
    navigate = useNavigate();
  const [repo] = useState(() => getToolRepository(ownerId));
  // Re-renders on every repository change, including one that happens after
  // the first render but before this component has subscribed.
  useSyncExternalStore(repo.subscribe, () => repo.version);
  const [query, setQuery] = useState(""),
    [favoritesOnly, setFavoritesOnly] = useState(false),
    [error, setError] = useState("");
  const initializing = useRef(new Set<string>()),
    root = useRef<HTMLDivElement>(null),
    visited = useRef("");
  const parts = location.pathname.split("/").filter(Boolean),
    id = parts[2] ?? "",
    documentId = parts[3],
    params = new URLSearchParams(location.search),
    savedView = params.get("view") === "saved";
  const tool = toolById(id),
    reference = tool?.kind === "reference",
    workspace = tool?.kind === "workspace";
  const requestedCategory = params.get("category");
  const category: ToolCategory =
    requestedCategory === "General" || requestedCategory === "Library"
      ? requestedCategory
      : "Lab";
  const catalogReturn = (
    location.state as { toolsCatalogReturn?: string } | null
  )?.toolsCatalogReturn;
  const catalog =
    catalogReturn && /^\/app\/tools(?:\?.*)?$/.test(catalogReturn)
      ? catalogReturn
      : `/app/tools?category=${tool?.category ?? "Lab"}`;
  const documents = repo.items
    .filter(
      (row) =>
        !row.draft &&
        !row.doc.deleted_at &&
        !row.doc.data._preferences &&
        !row.doc.data._workspace
    )
    .map((row) => row.doc);
  const record = pickRecord(repo.items, id, documentId, workspace);
  const preferences = readPreferences(repo);
  const title = tool ? t(tool.ko, tool.en) : t("실험 도구", "Lab tools");
  // A new page starts at its top with the heading focused, as a full page
  // load would. The first render is left alone.
  const page = `${location.pathname}${savedView ? "?saved" : ""}`;
  useEffect(() => {
    if (visited.current && visited.current !== page) {
      root.current?.scrollIntoView?.({ block: "start" });
      root.current?.querySelector<HTMLElement>("h1")?.focus({
        preventScroll: true,
      });
    }
    visited.current = page;
    // Leaving a tool writes its last edits without waiting for the pause.
    return () => void repo.flush();
  }, [page, repo]);
  useEffect(() => {
    if (
      !repo.ready ||
      // A fixed-id workspace may already exist on the account. Creating an
      // empty one before the first pull would shadow it and report a conflict.
      (workspace && !repo.hydrated) ||
      !isToolId(id) ||
      reference ||
      savedView ||
      documentId ||
      // Looked up now, not taken from the render: the cache may have finished
      // loading since, and creating a draft then would hide the real one.
      pickRecord(repo.items, id, undefined, workspace) ||
      initializing.current.has(id)
    )
      return;
    initializing.current.add(id);
    // A tool that used to keep a device-only draft and now has a synced
    // workspace carries that draft over once, so its history is not lost.
    const legacy = workspace
      ? repo.items.find(
          (row) => row.draft && row.doc.tool_id === id && !row.doc.deleted_at
        )
      : undefined;
    void repo
      .create(
        id,
        title,
        workspace ? { ...(legacy?.doc.data ?? {}), _workspace: true } : {},
        workspace ? { id: toolWorkspaceId(ownerId, id) } : { draft: true }
      )
      .then(() => (legacy ? repo.discard(legacy.doc.id) : undefined))
      .catch((e) => {
        setError(String(e));
      })
      .finally(() => initializing.current.delete(id));
  }, [
    repo,
    repo.ready,
    repo.hydrated,
    id,
    reference,
    savedView,
    documentId,
    record,
    title,
    workspace,
    ownerId,
  ]);
  // Empty drafts left beside the one in use (see `pickRecord`) are removed.
  useEffect(() => {
    if (!repo.ready || !record?.draft) return;
    for (const spare of spareDrafts(repo.items, id, record))
      void repo.discard(spare.doc.id);
  }, [repo, repo.ready, id, record]);
  // Opening a tool moves it to the head of "recently used". Waits for the
  // first pull like any other write to a fixed-id document.
  useEffect(() => {
    if (isToolId(id)) recordToolUsage(id, "open");
  }, [id]);
  useEffect(() => {
    if (!repo.hydrated || !isToolId(id)) return;
    const { recent } = readPreferences(repo);
    if (recent[0]?.id === id) return;
    void updatePreferences(repo, {
      recent: touchRecent(recent, id, Date.now()),
    }).catch(() => {
      /* A convenience list; failing to store it must not disturb the tool. */
    });
  }, [repo, repo.hydrated, id]);

  if (!isLabToolsEnabled)
    return (
      <div className="tools-workspace">
        {t(
          "실험 도구는 현재 검증 중입니다.",
          "Lab tools are under validation."
        )}
      </div>
    );
  // Back goes one level up: named work → that tool's saved list → the tool →
  // the tool list.
  const back = !id
    ? null
    : documentId
    ? `/app/tools/${id}?view=saved`
    : savedView
    ? `/app/tools/${id}`
    : catalog;
  return (
    <div
      ref={root}
      className={`tools-workspace ${!id ? "tools-catalog-page" : ""}`}
    >
      <div className="tools-inner">
        <ToolHeader
          key={page}
          back={back}
          title={`${documentId && record ? record.doc.title : title}${
            savedView ? ` · ${t("저장한 작업", "Saved work")}` : ""
          }`}
          record={record}
          repo={repo}
          savable={tool?.kind === "project"}
          showsStatus={
            !!id && !reference && !savedView && repo.ready && !!(record || repo.error)
          }
        />
        <ErrorMessage message={error} />
        {!id ? (
          <ToolCatalog
            category={category}
            onCategory={(value) =>
              navigate(`/app/tools?category=${value}`, { replace: true })
            }
            query={query}
            onQuery={setQuery}
            favoritesOnly={favoritesOnly}
            onFavoritesOnly={setFavoritesOnly}
            favorites={preferences.favorites}
            recent={preferences.recent}
            onToggleFavorite={(toolId) =>
              void updatePreferences(repo, {
                favorites: preferences.favorites.includes(toolId)
                  ? preferences.favorites.filter((value) => value !== toolId)
                  : [...preferences.favorites, toolId],
              }).catch((e) => setError(String(e)))
            }
            returnTo={`/app/tools${location.search}`}
          />
        ) : !tool ? (
          <ErrorMessage
            message={t("도구를 찾을 수 없습니다.", "Tool not found.")}
          />
        ) : !repo.ready ? (
          <p role="status">{t("불러오는 중…", "Loading…")}</p>
        ) : savedView ? (
          <SavedWorkList key={id} toolId={tool.id} repo={repo} />
        ) : record || reference ? (
          <ToolHost
            key={record?.doc.id ?? id}
            tool={tool}
            record={record}
            repo={repo}
            documents={documents}
            ownerId={ownerId}
            catalog={catalog}
          />
        ) : documentId ? (
          <ErrorMessage
            message={t(
              "저장한 작업을 찾을 수 없습니다.",
              "Saved work not found."
            )}
          />
        ) : (
          <p role="status">{t("도구 여는 중…", "Opening tool…")}</p>
        )}
      </div>
    </div>
  );
}

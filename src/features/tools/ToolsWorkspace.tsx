import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Star,
  FlaskConical,
  Calculator,
  BookOpen,
  ArrowLeft,
  Plus,
  Search,
} from "lucide-react";
import { tools, isToolId, type ToolCategory, type ToolId } from "./registry";
import { getToolRepository, toolWorkspaceId } from "./repository";
import {
  ToolContext,
  useText,
  Panel,
  Field,
  ErrorMessage,
  download,
} from "./ui";
import "./tools.css";
import ToolGuide from "./ToolGuide";
import { isLabToolsEnabled } from "../../config/featureFlags";
const Equation = lazy(() => import("./EquationTool")),
  Calibration = lazy(() => import("./CalibrationTool")),
  Culture = lazy(() => import("./CultureTool")),
  ImageEditor = lazy(() => import("./ImageTool")),
  Calendar = lazy(() => import("./CalendarTool")),
  Plate = lazy(() => import("./PlateTool"));
const Dilution = lazy(() =>
    import("./CalculationTools").then((m) => ({ default: m.DilutionTool }))
  ),
  Molarity = lazy(() =>
    import("./CalculationTools").then((m) => ({ default: m.MolarityTool }))
  ),
  Mix = lazy(() =>
    import("./CalculationTools").then((m) => ({ default: m.MixTool }))
  ),
  Unit = lazy(() =>
    import("./CalculationTools").then((m) => ({ default: m.UnitTool }))
  ),
  Counter = lazy(() =>
    import("./CalculationTools").then((m) => ({ default: m.CounterTool }))
  ),
  CellCounter = lazy(() =>
    import("./CalculationTools").then((m) => ({ default: m.CellCounterTool }))
  );
const Timer = lazy(() =>
    import("./TimeTools").then((m) => ({ default: m.TimerTool }))
  ),
  Alarm = lazy(() =>
    import("./TimeTools").then((m) => ({ default: m.AlarmTool }))
  ),
  Notes = lazy(() =>
    import("./TimeTools").then((m) => ({ default: m.NotesTool }))
  );
const Amino = lazy(() =>
    import("./LibraryTools").then((m) => ({ default: m.AminoTool }))
  ),
  Codon = lazy(() =>
    import("./LibraryTools").then((m) => ({ default: m.CodonTool }))
  ),
  Periodic = lazy(() =>
    import("./LibraryTools").then((m) => ({ default: m.PeriodicTool }))
  ),
  Ladder = lazy(() =>
    import("./LibraryTools").then((m) => ({ default: m.LadderTool }))
  );
const toolsEnabled = isLabToolsEnabled;
function Screen({ id }: { id: ToolId }) {
  switch (id) {
    case "dilution":
      return <Dilution />;
    case "molarity":
      return <Molarity />;
    case "master-mix":
      return <Mix />;
    case "medium-buffer":
      return <Mix medium />;
    case "unit-converter":
      return <Unit />;
    case "counter":
      return <Counter />;
    case "cell-counter":
      return <CellCounter />;
    case "custom-equation":
      return <Equation />;
    case "calculator":
      return <Equation calculator />;
    case "calibration-curve":
      return <Calibration />;
    case "cell-culture":
      return <Culture />;
    case "image-measurer":
      return <ImageEditor />;
    case "gel-blot":
      return <ImageEditor gel />;
    case "plate-labelling":
      return <Plate />;
    case "timer":
      return <Timer />;
    case "stopwatch":
      return <Timer stopwatch />;
    case "alarm":
      return <Alarm />;
    case "notes":
      return <Notes />;
    case "calendar":
      return <Calendar />;
    case "amino-acids":
      return <Amino />;
    case "codons":
      return <Codon />;
    case "periodic-table":
      return <Periodic />;
    case "ladders":
      return <Ladder />;
  }
}
class ToolBoundary extends Component<
  { children: ReactNode },
  { error: string }
> {
  state = { error: "" };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <p role="alert">{this.state.error}</p>
    ) : (
      this.props.children
    );
  }
}
export default function ToolsWorkspace({ ownerId }: { ownerId: string }) {
  const t = useText(),
    location = useLocation(),
    navigate = useNavigate();
  const [repo] = useState(() => getToolRepository(ownerId)),
    [, refresh] = useState(0);
  const [query, setQuery] = useState(""),
    [favoritesOnly, setFavoritesOnly] = useState(false),
    [error, setError] = useState(""),
    [naming, setNaming] = useState(false),
    [name, setName] = useState(""),
    [showStatus, setShowStatus] = useState(false);
  const initializing = useRef(new Set<string>());
  useEffect(() => repo.subscribe(() => refresh((n) => n + 1)), [repo]);
  const parts = location.pathname.split("/").filter(Boolean),
    id = parts[2] ?? "",
    documentId = parts[3],
    savedView = new URLSearchParams(location.search).get("view") === "saved";
  const tool = tools.find((row) => row[0] === id),
    readonly = ["amino-acids", "codons", "periodic-table"].includes(id),
    automatic = [
      "timer",
      "stopwatch",
      "alarm",
      "counter",
      "calendar",
      "notes",
    ].includes(id);
  const requestedCategory = new URLSearchParams(location.search).get(
    "category"
  );
  const category: ToolCategory =
    requestedCategory === "General" || requestedCategory === "Library"
      ? requestedCategory
      : "Lab";
  const setCategory = (value: ToolCategory) =>
    navigate(`/app/tools?category=${value}`, { replace: true });
  const catalogReturn = (
    location.state as { toolsCatalogReturn?: string } | null
  )?.toolsCatalogReturn;
  const backToCatalog =
    catalogReturn && /^\/app\/tools(?:\?.*)?$/.test(catalogReturn)
      ? catalogReturn
      : `/app/tools?category=${tool?.[1] ?? "Lab"}`;
  const documents = repo.items
    .filter(
      (row) =>
        !row.draft &&
        !row.doc.deleted_at &&
        !row.doc.data._preferences &&
        !row.doc.data._workspace
    )
    .map((row) => row.doc);
  const record = repo.items.find(
    (row) =>
      !row.doc.deleted_at &&
      row.doc.tool_id === id &&
      (documentId
        ? row.doc.id === documentId
        : automatic
        ? row.doc.data._workspace === true
        : row.draft)
  );
  const preference = repo.items.find((row) => row.doc.data._preferences),
    favorites = (preference?.doc.data.favorites ?? []) as string[];
  const title = tool ? t(tool[2], tool[3]) : t("실험 도구", "Lab tools");
  const projectTool = [
    "master-mix",
    "medium-buffer",
    "plate-labelling",
    "gel-blot",
    "image-measurer",
    "cell-culture",
    "custom-equation",
    "calibration-curve",
    "ladders",
    "cell-counter",
  ].includes(id);
  useEffect(() => {
    if (
      !repo.ready ||
      !isToolId(id) ||
      readonly ||
      savedView ||
      documentId ||
      record ||
      initializing.current.has(id)
    )
      return;
    initializing.current.add(id);
    void repo
      .create(
        id,
        title,
        automatic ? { _workspace: true } : {},
        automatic ? { id: toolWorkspaceId(ownerId, id) } : { draft: true }
      )
      .catch((e) => {
        setError(String(e));
      })
      .finally(() => initializing.current.delete(id));
  }, [
    repo,
    repo.ready,
    id,
    readonly,
    savedView,
    documentId,
    record,
    title,
    automatic,
    ownerId,
  ]);

  const favorite = async (toolId: string) => {
    const next = favorites.includes(toolId)
      ? favorites.filter((value) => value !== toolId)
      : [...favorites, toolId];
    if (preference)
      await repo.update(preference.doc.id, {
        data: { _preferences: true, favorites: next },
      });
    else
      await repo.create(
        "notes",
        ".preferences",
        { _preferences: true, favorites: next },
        { id: toolWorkspaceId(ownerId, "preferences") }
      );
  };
  const filtered = documents.filter(
    (doc) =>
      doc.tool_id === id &&
      `${doc.title} ${doc.data.vendor ?? ""} ${doc.data.kind ?? ""} ${
        doc.data.body ?? ""
      } ${doc.data.tags ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase())
  );
  const save = async () => {
    if (!record || !name.trim()) return;
    try {
      if (record.draft) await repo.saveDraft(record.doc.id, name.trim());
      else await repo.update(record.doc.id, { title: name.trim() });
      setNaming(false);
      navigate(`/app/tools/${id}/${record.doc.id}`);
    } catch (e) {
      setError(String(e));
    }
  };
  const storageFailed = repo.error === "Local storage failed";
  const status =
    record?.status === "conflict"
      ? t("충돌 확인", "Review conflict")
      : storageFailed
      ? t("저장 오류", "Storage error")
      : repo.error || record?.status === "error"
      ? t("기기에 저장", "On this device")
      : record?.draft
      ? t("기기에 저장", "On this device")
      : record?.status === "synced"
      ? t("저장됨", "Saved")
      : t("저장 중", "Saving");
  if (!toolsEnabled)
    return (
      <div className="tools-workspace">
        {t(
          "실험 도구는 현재 검증 중입니다.",
          "Lab tools are under validation."
        )}
      </div>
    );
  return (
    <div className={`tools-workspace ${!id ? "tools-catalog-page" : ""}`}>
      <div className="tools-inner">
        <header className="tool-toolbar tool-heading">
          {id && (
            <Link
              className="tool-button tool-back"
              to={documentId || savedView ? `/app/tools/${id}` : backToCatalog}
              aria-label={t("뒤로", "Back")}
            >
              <ArrowLeft size={20} />
            </Link>
          )}
          <h1>
            {documentId && record ? record.doc.title : title}
            {savedView && ` · ${t("저장한 작업", "Saved work")}`}
          </h1>
          {!readonly && repo.ready && (record || repo.error) && (
            <button
              className="tool-save-status"
              onClick={() => setShowStatus(!showStatus)}
              aria-expanded={showStatus}
            >
              {status}
            </button>
          )}
        </header>
        {showStatus && (
          <div className="tool-connection">
            <p>
              {storageFailed
                ? t(
                    "기기 저장에 실패했습니다. 저장 공간을 확인하세요.",
                    "Device storage failed. Check available space."
                  )
                : repo.error
                ? t(
                    "현재 서버와 연결되지 않아 기기에 저장하고 있습니다. 연결되면 저장한 작업이 동기화됩니다.",
                    "Working on this device while the server is unavailable. Saved work syncs when connected."
                  )
                : record?.draft
                ? t(
                    "입력은 이 기기에 보관됩니다. 작업 저장을 선택하면 계정에 보관할 수 있습니다.",
                    "Inputs are kept on this device. Save work to keep a named copy in your account."
                  )
                : t(
                    "계정에 저장하고 다른 기기와 동기화합니다.",
                    "Saved to your account and synchronized across devices."
                  )}
            </p>
            <button onClick={() => repo.sync()}>
              {t("동기화 다시 시도", "Retry sync")}
            </button>
          </div>
        )}
        <ErrorMessage message={error} />
        {!id ? (
          <>
            <div
              role="tablist"
              aria-label={t("도구 분류", "Tool categories")}
              className="tool-tabs"
            >
              {(["Lab", "General", "Library"] as const).map((value) => (
                <button
                  key={value}
                  role="tab"
                  aria-selected={category === value}
                  onClick={() => setCategory(value)}
                >
                  {value === "Lab" ? (
                    <FlaskConical size={17} />
                  ) : value === "General" ? (
                    <Calculator size={17} />
                  ) : (
                    <BookOpen size={17} />
                  )}
                  <span>
                    {t(
                      (
                        {
                          Lab: "실험",
                          General: "일반",
                          Library: "라이브러리",
                        } as Record<string, string>
                      )[value],
                      value
                    )}
                  </span>
                </button>
              ))}
            </div>
            <div className="tool-search-row">
              <label className="tool-search">
                <Search size={19} aria-hidden="true" />
                <input
                  type="search"
                  enterKeyHint="search"
                  aria-label={t("도구 검색", "Search tools")}
                  placeholder={t("도구 검색", "Search tools")}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                />
              </label>
              <button
                className={`tool-favorite-filter ${
                  favoritesOnly ? "active" : ""
                }`}
                aria-pressed={favoritesOnly}
                aria-label={t("즐겨찾기만 보기", "Show favorites")}
                onClick={() => setFavoritesOnly(!favoritesOnly)}
              >
                <Star
                  size={20}
                  fill={favoritesOnly ? "currentColor" : "none"}
                />
                <span>{t("즐겨찾기", "Favorites")}</span>
              </button>
            </div>
            <div className="tool-catalog">
              {tools
                .filter(
                  (row) =>
                    (query || row[1] === category) &&
                    (!favoritesOnly || favorites.includes(row[0])) &&
                    row
                      .slice(2)
                      .join(" ")
                      .toLowerCase()
                      .includes(query.toLowerCase())
                )
                .map((row) => (
                  <article className="tool-card" key={row[0]}>
                    <Link
                      to={`/app/tools/${row[0]}`}
                      state={{
                        toolsCatalogReturn: `/app/tools${location.search}`,
                      }}
                    >
                      {t(row[2], row[3])}
                    </Link>
                    <button
                      aria-label={`${t("즐겨찾기", "Favorite")} ${t(
                        row[2],
                        row[3]
                      )}`}
                      aria-pressed={favorites.includes(row[0])}
                      onClick={() => favorite(row[0])}
                    >
                      <Star
                        size={16}
                        fill={
                          favorites.includes(row[0]) ? "currentColor" : "none"
                        }
                      />
                    </button>
                    <p>{t(row[4], row[5])}</p>
                  </article>
                ))}
            </div>
          </>
        ) : !tool ? (
          <ErrorMessage
            message={t("도구를 찾을 수 없습니다.", "Tool not found.")}
          />
        ) : !repo.ready ? (
          <p role="status">{t("불러오는 중…", "Loading…")}</p>
        ) : savedView ? (
          <>
            <div className="tool-toolbar">
              <Link className="tool-button primary" to={`/app/tools/${id}`}>
                <Plus size={16} /> {t("바로 사용", "Use tool")}
              </Link>
              <label className="tool-search">
                <Search size={18} />
                <input
                  type="search"
                  aria-label={t("저장한 작업 검색", "Search saved work")}
                  placeholder={t("이름으로 검색", "Search by name")}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
            </div>
            {filtered.length === 0 && (
              <p className="tool-empty">
                {t(
                  "보관한 작업이 없습니다. 도구를 바로 사용한 뒤 필요할 때 저장하세요.",
                  "No saved work. Use the tool first and save a copy when needed."
                )}
              </p>
            )}
            {filtered.map((doc) => (
              <Panel key={doc.id}>
                <Link to={`/app/tools/${id}/${doc.id}`}>
                  <strong>{doc.title}</strong>
                </Link>
              </Panel>
            ))}
            {repo.items
              .filter((row) => row.doc.tool_id === id && row.doc.deleted_at)
              .map((row) => (
                <div className="tool-actions" key={row.doc.id}>
                  <span>{row.doc.title}</span>
                  <button
                    onClick={() =>
                      repo.update(row.doc.id, { deleted_at: null })
                    }
                  >
                    {t("복원", "Restore")}
                  </button>
                </div>
              ))}
          </>
        ) : record || readonly ? (
          <ToolBoundary key={documentId ?? id}>
            <ToolContext.Provider
              value={{
                doc: record?.doc ?? {
                  id: "reference",
                  owner_id: ownerId,
                  tool_id: id as ToolId,
                  title,
                  data: {},
                  schema_version: 1,
                  engine_version: "1",
                  revision: 0,
                  updated_at: "",
                },
                repo,
                documents,
              }}
            >
              {!readonly && !automatic && projectTool && (
                <div className="tool-actions tool-work-actions">
                  <button
                    className="primary"
                    onClick={() => {
                      setName(
                        record?.draft
                          ? `${title} ${
                              documents.filter((doc) => doc.tool_id === id)
                                .length + 1
                            }`
                          : record!.doc.title
                      );
                      setNaming(true);
                    }}
                  >
                    {record?.draft
                      ? t("작업 저장", "Save work")
                      : t("이름 변경", "Rename")}
                  </button>
                  <Link
                    className="tool-button"
                    to={`/app/tools/${id}?view=saved`}
                  >
                    {t("저장한 작업", "Saved work")}
                  </Link>
                </div>
              )}
              {naming && (
                <form
                  className="tool-name-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void save();
                  }}
                >
                  <Field
                    label={t("작업 이름", "Work name")}
                    type="text"
                    value={name}
                    onChange={setName}
                  />
                  <div className="tool-actions">
                    <button
                      className="primary"
                      type="submit"
                      disabled={!name.trim()}
                    >
                      {t("저장", "Save")}
                    </button>
                    <button type="button" onClick={() => setNaming(false)}>
                      {t("취소", "Cancel")}
                    </button>
                  </div>
                </form>
              )}
              {record?.remote && (
                <Panel
                  title={t(
                    "두 기기에서 수정되었습니다",
                    "Edited on two devices"
                  )}
                >
                  <p>
                    {t(
                      "두 버전을 확인한 뒤 유지할 버전을 선택하세요.",
                      "Review both versions and choose which to keep."
                    )}
                  </p>
                  <div className="tool-actions">
                    <button
                      onClick={() =>
                        download(
                          JSON.stringify(
                            { local: record.doc, remote: record.remote },
                            null,
                            2
                          ),
                          "conflict.json",
                          "application/json"
                        )
                      }
                    >
                      {t("양쪽 버전 내보내기", "Export both versions")}
                    </button>
                    <button
                      onClick={() => repo.resolve(record.doc.id, "local")}
                    >
                      {t("이 기기 버전 유지", "Keep local")}
                    </button>
                    <button
                      onClick={() => repo.resolve(record.doc.id, "remote")}
                    >
                      {t("서버 버전 유지", "Keep server")}
                    </button>
                  </div>
                </Panel>
              )}
              <ToolGuide id={id as ToolId} />
              <Suspense
                fallback={
                  <p role="status">{t("도구 여는 중…", "Opening tool…")}</p>
                }
              >
                <Screen id={id as ToolId} />
              </Suspense>
              {record && !readonly && !automatic && !record.draft && (
                <details className="tool-guide">
                  <summary>{t("작업 관리", "Manage work")}</summary>
                  <div className="tool-actions">
                    <button
                      onClick={() =>
                        download(
                          JSON.stringify(record.doc, null, 2),
                          `${record.doc.title}.json`,
                          "application/json"
                        )
                      }
                    >
                      {t("데이터 내보내기", "Export data")}
                    </button>
                    <button
                      onClick={async () => {
                        const doc = await repo.create(
                          record.doc.tool_id,
                          `${record.doc.title} (${t("복사", "copy")})`,
                          {
                            ...record.doc.data,
                            ...(record.doc.tool_id === "cell-culture"
                              ? { timer: null }
                              : {}),
                          }
                        );
                        navigate(`/app/tools/${id}/${doc.id}`);
                      }}
                    >
                      {t("복제", "Duplicate")}
                    </button>
                    <button
                      onClick={async () => {
                        await repo.update(record.doc.id, {
                          deleted_at: new Date().toISOString(),
                        });
                        navigate(`/app/tools/${id}?view=saved`);
                      }}
                    >
                      {t("휴지통으로", "Move to trash")}
                    </button>
                  </div>
                </details>
              )}
            </ToolContext.Provider>
          </ToolBoundary>
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

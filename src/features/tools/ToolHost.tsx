import { Component, Suspense, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Tool, ToolDocument } from "./registry";
import type { ToolRecord, ToolRepository } from "./repository";
import {
  ToolContext,
  useText,
  Panel,
  Field,
  ErrorMessage,
  download,
} from "./ui";
import ToolGuide from "./ToolGuide";
import ToolScreen from "./ToolScreen";
import { duplicateData } from "./work";

class ToolBoundary extends Component<
  { children: ReactNode; fallback: (error: string) => ReactNode },
  { error: string }
> {
  state = { error: "" };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message || String(error) };
  }
  render() {
    return this.state.error
      ? this.props.fallback(this.state.error)
      : this.props.children;
  }
}

/**
 * One opened tool: the work actions around it (save, rename, conflict,
 * manage), its guide and its screen. Mounted with a key per document, so its
 * state starts fresh for another tool or another piece of saved work.
 */
export default function ToolHost({
  tool,
  record,
  repo,
  documents,
  ownerId,
  catalog,
}: {
  tool: Tool;
  /** Missing only for reference tools, which keep no document. */
  record: ToolRecord | undefined;
  repo: ToolRepository;
  /** All named work of the account, for tools that link to it. */
  documents: ToolDocument[];
  ownerId: string;
  /** Where "back to the tool list" goes. */
  catalog: string;
}) {
  const t = useText(),
    navigate = useNavigate();
  const [naming, setNaming] = useState(false),
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [resolving, setResolving] = useState<"local" | "remote" | null>(null),
    [confirmReset, setConfirmReset] = useState(false),
    // Bumped to remount the screen: after a crash, or after starting over.
    [attempt, setAttempt] = useState(0);
  const id = tool.id,
    title = t(tool.ko, tool.en),
    project = tool.kind === "project",
    saved = documents
      .filter((doc) => doc.tool_id === id)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const save = async () => {
    if (!record || !name.trim()) return;
    try {
      if (record.draft) await repo.saveDraft(record.doc.id, name.trim());
      else await repo.update(record.doc.id, { title: name.trim() });
      setNaming(false);
      // Replace, not push: the entry being left is the tool's blank quick-use
      // address, and going back to it would open a new empty draft as if the
      // work just saved had been lost.
      navigate(`/app/tools/${id}/${record.doc.id}`, { replace: true });
    } catch (e) {
      setError(String(e));
    }
  };
  const exportJson = (doc: ToolDocument) =>
    download(
      JSON.stringify(doc, null, 2),
      `${doc.title}.json`,
      "application/json"
    );
  return (
    <ToolContext.Provider
      value={{
        doc: record?.doc ?? {
          id: "reference",
          owner_id: ownerId,
          tool_id: id,
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
      <ErrorMessage message={error} />
      {record && project && (
        <div className="tool-actions tool-work-actions">
          <button
            className="primary"
            onClick={() => {
              setName(
                record.draft ? `${title} ${saved.length + 1}` : record.doc.title
              );
              setNaming(true);
            }}
          >
            {record.draft ? t("작업 저장", "Save work") : t("이름 변경", "Rename")}
          </button>
          <Link className="tool-button" to={`/app/tools/${id}?view=saved`}>
            {t("저장한 작업", "Saved work")}
            {saved.length > 0 && ` (${saved.length})`}
          </Link>
          {record.draft && record.generation > 1 && (
            <button onClick={() => setConfirmReset(true)}>
              {t("새로 시작", "Start over")}
            </button>
          )}
        </div>
      )}
      {confirmReset && record && (
        <div className="tool-inline-confirm" role="alert">
          <span>
            {t(
              "지금 입력한 내용을 지우고 처음 상태로 돌아갑니다. 저장한 작업은 그대로입니다.",
              "This clears what is entered here and returns to the starting state. Saved work is not affected."
            )}
          </span>
          <button
            onClick={async () => {
              setConfirmReset(false);
              await repo.update(record.doc.id, { data: {} });
              setAttempt((n) => n + 1);
            }}
          >
            {t("지우고 새로 시작", "Clear and start over")}
          </button>
          <button onClick={() => setConfirmReset(false)}>
            {t("취소", "Cancel")}
          </button>
        </div>
      )}
      {record?.draft && project && saved.length > 0 && (
        <p className="tool-recent-work">
          <span>{t("최근 저장한 작업", "Recently saved")}</span>
          {saved.slice(0, 3).map((doc) => (
            <Link key={doc.id} to={`/app/tools/${id}/${doc.id}`}>
              {doc.title}
            </Link>
          ))}
        </p>
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
            <button className="primary" type="submit" disabled={!name.trim()}>
              {t("저장", "Save")}
            </button>
            <button type="button" onClick={() => setNaming(false)}>
              {t("취소", "Cancel")}
            </button>
          </div>
        </form>
      )}
      {record?.remote && (
        <Panel title={t("두 기기에서 수정되었습니다", "Edited on two devices")}>
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
              aria-pressed={resolving === "local"}
              onClick={() => setResolving("local")}
            >
              {t("이 기기 버전 유지", "Keep local")}
            </button>
            <button
              aria-pressed={resolving === "remote"}
              onClick={() => setResolving("remote")}
            >
              {t("서버 버전 유지", "Keep server")}
            </button>
          </div>
          {resolving && (
            <div className="tool-inline-confirm" role="alert">
              <span>
                {resolving === "local"
                  ? t(
                      "서버에 있는 버전이 이 기기의 내용으로 바뀝니다. 되돌릴 수 없습니다.",
                      "The server version will be replaced with this device's content. This cannot be undone."
                    )
                  : t(
                      "이 기기에서 수정한 내용이 사라지고 서버 버전으로 바뀝니다. 되돌릴 수 없습니다.",
                      "Edits made on this device will be discarded and replaced with the server version. This cannot be undone."
                    )}
              </span>
              <button
                onClick={() => {
                  const choice = resolving;
                  setResolving(null);
                  void repo.resolve(record.doc.id, choice);
                }}
              >
                {resolving === "local"
                  ? t("이 기기 버전으로 바꾸기", "Replace with local")
                  : t("서버 버전으로 바꾸기", "Replace with server")}
              </button>
              <button onClick={() => setResolving(null)}>
                {t("취소", "Cancel")}
              </button>
            </div>
          )}
        </Panel>
      )}
      <ToolGuide id={id} />
      <ToolBoundary
        key={attempt}
        fallback={(message) => (
          <div className="tool-empty-state" role="alert">
            <strong>
              {t("이 도구를 표시하지 못했습니다", "This tool could not be shown")}
            </strong>
            <p>
              {t(
                "다시 시도해 보세요. 계속되면 저장된 내용에 문제가 있을 수 있습니다. 내용을 내보낸 뒤 새로 시작할 수 있습니다.",
                "Try again. If it keeps happening, the saved content may be the cause: export it, then start over."
              )}
            </p>
            <div className="tool-actions">
              <button
                className="primary"
                onClick={() => setAttempt((n) => n + 1)}
              >
                {t("다시 시도", "Try again")}
              </button>
              <Link className="tool-button" to={catalog}>
                {t("도구 목록으로", "Back to tools")}
              </Link>
              {record && (
                <button onClick={() => exportJson(record.doc)}>
                  {t("내용 내보내기 (JSON)", "Export content (JSON)")}
                </button>
              )}
              {record && (
                <button onClick={() => setConfirmReset(true)}>
                  {t("새로 시작", "Start over")}
                </button>
              )}
            </div>
            <details>
              <summary>{t("오류 내용", "Error details")}</summary>
              <code>{message}</code>
            </details>
          </div>
        )}
      >
        <Suspense
          fallback={<p role="status">{t("도구 여는 중…", "Opening tool…")}</p>}
        >
          <ToolScreen id={id} />
        </Suspense>
      </ToolBoundary>
      {record && project && !record.draft && (
        <details className="tool-guide">
          <summary>{t("작업 관리", "Manage work")}</summary>
          <div className="tool-actions">
            <button onClick={() => exportJson(record.doc)}>
              {t("데이터 내보내기", "Export data")}
            </button>
            <button
              onClick={async () => {
                const doc = await repo.create(
                  record.doc.tool_id,
                  `${record.doc.title} (${t("복사", "copy")})`,
                  duplicateData(record.doc)
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
                // Back must not return to the document just trashed.
                navigate(`/app/tools/${id}?view=saved`, { replace: true });
              }}
            >
              {t("휴지통으로", "Move to trash")}
            </button>
          </div>
        </details>
      )}
    </ToolContext.Provider>
  );
}

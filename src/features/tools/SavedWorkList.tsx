import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FolderOpen, Plus, Search } from "lucide-react";
import type { ToolDocument, ToolId } from "./registry";
import type { ToolRepository } from "./repository";
import { useText, ErrorMessage } from "./ui";
import { duplicateData } from "./work";

/** One tool's named work: open, rename, duplicate, trash and restore. */
export default function SavedWorkList({
  toolId,
  repo,
}: {
  toolId: ToolId;
  repo: ToolRepository;
}) {
  const t = useText(),
    navigate = useNavigate();
  const [query, setQuery] = useState(""),
    [sort, setSort] = useState<"recent" | "name">("recent"),
    [renaming, setRenaming] = useState(""),
    [name, setName] = useState(""),
    [purging, setPurging] = useState(""),
    [error, setError] = useState("");
  const all = repo.items
    .filter(
      (row) =>
        row.doc.tool_id === toolId &&
        !row.draft &&
        !row.doc.data._workspace &&
        !row.doc.data._preferences
    )
    .map((row) => row.doc);
  const needle = query.trim().toLowerCase();
  const saved = all
    .filter(
      (doc) =>
        !doc.deleted_at &&
        `${doc.title} ${doc.data.vendor ?? ""} ${doc.data.kind ?? ""} ${
          doc.data.body ?? ""
        } ${doc.data.tags ?? ""}`
          .toLowerCase()
          .includes(needle)
    )
    .sort((a, b) =>
      sort === "name"
        ? a.title.localeCompare(b.title)
        : b.updated_at.localeCompare(a.updated_at)
    );
  const trashed = all.filter((doc) => doc.deleted_at);
  const edited = (doc: ToolDocument) =>
    new Date(doc.updated_at).toLocaleString(t("ko-KR", "en-US"), {
      dateStyle: "medium",
      timeStyle: "short",
    });
  return (
    <>
      <div className="tool-toolbar">
        <Link className="tool-button primary" to={`/app/tools/${toolId}`}>
          <Plus size={16} /> {t("바로 사용", "Use tool")}
        </Link>
        <label className="tool-search">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            aria-label={t("저장한 작업 검색", "Search saved work")}
            placeholder={t("이름으로 검색", "Search by name")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <select
          aria-label={t("정렬", "Sort")}
          value={sort}
          onChange={(event) => setSort(event.target.value as typeof sort)}
        >
          <option value="recent">{t("최근 수정순", "Recently edited")}</option>
          <option value="name">{t("이름순", "By name")}</option>
        </select>
      </div>
      {saved.length === 0 ? (
        <div className="tool-empty-state">
          <FolderOpen size={28} aria-hidden="true" />
          <strong>
            {needle
              ? t("맞는 작업이 없습니다", "No matching work")
              : t("저장한 작업이 없습니다", "No saved work")}
          </strong>
          <p>
            {needle
              ? t("다른 이름으로 검색해 보세요.", "Try another name.")
              : t(
                  "도구를 바로 사용한 뒤 다시 쓸 작업은 ‘작업 저장’으로 보관하세요.",
                  "Use the tool first, then keep work you will reuse with “Save work”."
                )}
          </p>
        </div>
      ) : (
        <ul className="tool-saved-list">
          {saved.map((doc) => (
            <li className="tool-saved-row" key={doc.id}>
              {renaming === doc.id ? (
                <form
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (!name.trim()) return;
                    await repo.update(doc.id, { title: name.trim() });
                    setRenaming("");
                  }}
                >
                  <input
                    type="text"
                    autoFocus
                    maxLength={200}
                    aria-label={t("작업 이름", "Work name")}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                  <button className="primary" disabled={!name.trim()}>
                    {t("저장", "Save")}
                  </button>
                  <button type="button" onClick={() => setRenaming("")}>
                    {t("취소", "Cancel")}
                  </button>
                </form>
              ) : (
                <>
                  <Link to={`/app/tools/${toolId}/${doc.id}`}>
                    <strong>{doc.title}</strong>
                    <span>
                      {t("수정", "Edited")} {edited(doc)}
                    </span>
                  </Link>
                  <div className="tool-saved-actions">
                    <button
                      aria-label={`${doc.title} ${t("이름 변경", "Rename")}`}
                      onClick={() => {
                        setName(doc.title);
                        setRenaming(doc.id);
                      }}
                    >
                      {t("이름 변경", "Rename")}
                    </button>
                    <button
                      aria-label={`${doc.title} ${t("복제", "Duplicate")}`}
                      onClick={async () => {
                        const copy = await repo.create(
                          doc.tool_id,
                          `${doc.title} (${t("복사", "copy")})`,
                          duplicateData(doc)
                        );
                        navigate(`/app/tools/${toolId}/${copy.id}`);
                      }}
                    >
                      {t("복제", "Duplicate")}
                    </button>
                    <button
                      aria-label={`${doc.title} ${t(
                        "휴지통으로",
                        "Move to trash"
                      )}`}
                      onClick={() =>
                        repo.update(doc.id, {
                          deleted_at: new Date().toISOString(),
                        })
                      }
                    >
                      {t("휴지통으로", "Move to trash")}
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {trashed.length > 0 && (
        <details className="tool-guide">
          <summary>
            {t("휴지통", "Trash")} ({trashed.length})
          </summary>
          <ul className="tool-saved-list">
            {trashed.map((doc) => (
              <li className="tool-saved-row" key={doc.id}>
                <span>
                  <strong>{doc.title}</strong>
                </span>
                <div className="tool-saved-actions">
                  <button
                    aria-label={`${doc.title} ${t("복원", "Restore")}`}
                    onClick={() => repo.update(doc.id, { deleted_at: null })}
                  >
                    {t("복원", "Restore")}
                  </button>
                  <button
                    aria-label={`${doc.title} ${t(
                      "영구 삭제",
                      "Delete permanently"
                    )}`}
                    onClick={() => {
                      setError("");
                      setPurging(doc.id);
                    }}
                  >
                    {t("영구 삭제", "Delete permanently")}
                  </button>
                </div>
                {purging === doc.id && (
                  <div className="tool-inline-confirm" role="alert">
                    <span>
                      {t(
                        "이 작업과 포함된 이미지를 계정과 모든 기기에서 지웁니다. 되돌릴 수 없습니다.",
                        "This removes the work and its image from your account and every device. It cannot be undone."
                      )}
                    </span>
                    <button
                      onClick={async () => {
                        setPurging("");
                        try {
                          await repo.purge(doc.id);
                        } catch (e) {
                          setError(String(e));
                        }
                      }}
                    >
                      {t("영구 삭제", "Delete permanently")}
                    </button>
                    <button onClick={() => setPurging("")}>
                      {t("취소", "Cancel")}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <ErrorMessage message={error} />
        </details>
      )}
    </>
  );
}

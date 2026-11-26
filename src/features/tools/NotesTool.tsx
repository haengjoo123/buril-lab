import { useContext, useState } from "react";
import { Link } from "react-router-dom";
import { ToolContext, Field, Select, useText } from "./ui";
/**
 * A stored title may not be empty, but the field must be: selecting the text
 * and typing a new title passes through "". The text being typed is kept here
 * and only non-empty titles are saved; leaving the field empty restores the
 * saved one.
 */
function NoteTitleField({
  label,
  title,
  onCommit,
}: {
  label: string;
  title: string;
  onCommit: (title: string) => void;
}) {
  const [text, setText] = useState(title);
  return (
    <label className="tool-field">
      <span>{label}</span>
      <input
        type="text"
        maxLength={200}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value.trim()) onCommit(e.target.value.slice(0, 200));
        }}
        onBlur={() => {
          if (!text.trim()) setText(title);
        }}
      />
    </label>
  );
}
export default function NotesTool() {
  const t = useText(),
    ctx = useContext(ToolContext)!;
  const [query, setQuery] = useState(""),
    [activeId, setActiveId] = useState(
      ctx.doc.data._workspace ? "" : ctx.doc.id
    );
  const notes = ctx.documents.filter((doc) => doc.tool_id === "notes"),
    note = notes.find((doc) => doc.id === activeId);
  const content = note?.data as
    | { body?: string; tags?: string; links?: string[] }
    | undefined;
  const patch = (data: Record<string, unknown>) => {
    if (note)
      void ctx.repo.update(note.id, { data: { ...note.data, ...data } });
  };
  return (
    <div className={`tool-notes-layout ${note ? "editing" : ""}`}>
      <aside className="tool-note-list">
        <div className="tool-actions">
          <button
            className="primary"
            onClick={async () => {
              const doc = await ctx.repo.create(
                "notes",
                t("새 메모", "New note"),
                { body: "", tags: "", links: [] }
              );
              setActiveId(doc.id);
            }}
          >
            {t("메모 추가", "Add note")}
          </button>
        </div>
        <Field
          type="search"
          label={t("메모 검색", "Search notes")}
          value={query}
          onChange={setQuery}
        />
        {notes
          .filter((doc) =>
            `${doc.title} ${doc.data.body ?? ""} ${doc.data.tags ?? ""}`
              .toLowerCase()
              .includes(query.toLowerCase())
          )
          .map((doc) => (
            <button
              className="tool-note-item"
              key={doc.id}
              aria-current={note?.id === doc.id ? "true" : undefined}
              onClick={() => setActiveId(doc.id)}
            >
              <strong>{doc.title}</strong>
              <span>{String(doc.data.body ?? "").slice(0, 90)}</span>
            </button>
          ))}
        {notes.length === 0 && (
          <p className="tool-empty">
            {t("첫 메모를 추가하세요.", "Add your first note.")}
          </p>
        )}
        {ctx.repo.items.some(
          (row) => row.doc.tool_id === "notes" && row.doc.deleted_at
        ) && (
          <details className="tool-guide">
            <summary>{t("휴지통", "Trash")}</summary>
            {ctx.repo.items
              .filter(
                (row) => row.doc.tool_id === "notes" && row.doc.deleted_at
              )
              .map((row) => (
                <div className="tool-actions" key={row.doc.id}>
                  <span>{row.doc.title}</span>
                  <button
                    onClick={() =>
                      ctx.repo.update(row.doc.id, { deleted_at: null })
                    }
                  >
                    {t("복원", "Restore")}
                  </button>
                </div>
              ))}
          </details>
        )}
      </aside>
      <section className="tool-note-editor">
        {note ? (
          <>
            <button className="tool-note-back" onClick={() => setActiveId("")}>
              {t("메모 목록", "Back to notes")}
            </button>
            <NoteTitleField
              key={note.id}
              label={t("제목", "Title")}
              title={note.title}
              onCommit={(title) => void ctx.repo.update(note.id, { title })}
            />
            <Field
              type="text"
              label={t("태그 (쉼표 구분)", "Tags (comma separated)")}
              value={content?.tags ?? ""}
              onChange={(tags) => patch({ tags })}
            />
            <label className="tool-field">
              <span>{t("본문", "Body")}</span>
              <textarea
                rows={16}
                maxLength={200000}
                value={content?.body ?? ""}
                onChange={(e) => patch({ body: e.target.value })}
              />
            </label>
            <Select
              label={t("저장한 작업 연결", "Link saved work")}
              value=""
              options={[
                "",
                ...ctx.documents
                  .filter((doc) => doc.id !== note.id)
                  .map((doc) => [doc.id, doc.title] as const),
              ]}
              onChange={(id) => {
                if (id)
                  patch({
                    links: [...new Set([...(content?.links ?? []), id])],
                  });
              }}
            />
            {(content?.links ?? []).map((id) => {
              const doc = ctx.documents.find((row) => row.id === id);
              return (
                <div className="tool-actions" key={id}>
                  {doc ? (
                    // A router link: a plain href reloads the whole app.
                    <Link to={`/app/tools/${doc.tool_id}/${id}`}>
                      {doc.title}
                    </Link>
                  ) : (
                    <span>{t("삭제된 작업", "Deleted work")}</span>
                  )}
                  <button
                    aria-label={t("연결 해제", "Remove link")}
                    onClick={() =>
                      patch({
                        links: content?.links?.filter((value) => value !== id),
                      })
                    }
                  >
                    ×
                  </button>
                </div>
              );
            })}
            <div className="tool-actions">
              <button
                onClick={() =>
                  import("./ui").then(({ download }) =>
                    download(content?.body ?? "", `${note.title}.txt`)
                  )
                }
              >
                {t("텍스트 내보내기", "Export text")}
              </button>
              <button
                onClick={async () => {
                  await ctx.repo.update(note.id, {
                    deleted_at: new Date().toISOString(),
                  });
                  setActiveId("");
                }}
              >
                {t("휴지통으로", "Move to trash")}
              </button>
            </div>
          </>
        ) : (
          <p className="tool-empty">
            {t(
              "메모를 선택하거나 새 메모를 추가하세요.",
              "Select a note or add a new one."
            )}
          </p>
        )}
      </section>
    </div>
  );
}

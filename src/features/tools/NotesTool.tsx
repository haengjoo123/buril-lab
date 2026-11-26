import { useContext, useId, useState } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import {
  ToolContext,
  Field,
  Select,
  EmptyState,
  download,
  useText,
  useUndo,
} from "./ui";
import { exportFileName } from "./format";
import { toolById } from "./registry";
import { toolIcons } from "./toolIcons";
import {
  DEFAULT_NOTE_TITLES,
  addTags,
  firstLine,
  formatTags,
  matchesNote,
  noteText,
  parseTags,
  sortNotes,
  tagCounts,
  type NoteSort,
} from "./notes";
/**
 * A stored title may not be empty, but the field must be: selecting the text
 * and typing a new title passes through "". The text being typed is kept here
 * and only non-empty titles are saved; leaving the field empty restores the
 * saved one.
 *
 * A note that has no title of its own (it is still called "New note", or the
 * field has been emptied) is offered the first line of its body as the title.
 * The title is only ever changed by pressing that button, never by itself.
 */
function NoteTitleField({
  label,
  title,
  line,
  onCommit,
}: {
  label: string;
  title: string;
  /** The first line of the body, or "" when there is none. */
  line: string;
  onCommit: (title: string) => void;
}) {
  const t = useText();
  const [text, setText] = useState(title);
  const offer =
    line !== "" &&
    line !== title &&
    (!text.trim() || DEFAULT_NOTE_TITLES.includes(title));
  return (
    <>
      <label className="tool-field">
        <span>{label}</span>
        <input
          type="text"
          maxLength={200}
          value={text}
          // An emptied field still has its saved title until another is typed.
          placeholder={title}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value.trim()) onCommit(e.target.value.slice(0, 200));
          }}
          onBlur={() => {
            // While the first line is on offer the field stays empty, so the
            // offer is still there once the field has been left.
            if (!text.trim() && !offer) setText(title);
          }}
        />
      </label>
      {offer && (
        <div className="tool-notes-x-firstline">
          <button
            onClick={() => {
              setText(line);
              onCommit(line);
            }}
          >
            {t("본문 첫 줄을 제목으로", "Use first line as title")}
          </button>
          <span className="tool-muted">{line}</span>
        </div>
      )}
    </>
  );
}
/**
 * Tags as chips. A tag is added with Enter or a comma (or by leaving the
 * field) and removed with its × button, or with Backspace in the empty field.
 */
function TagField({
  label,
  tags,
  onChange,
}: {
  label: string;
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const t = useText(),
    id = useId();
  const [text, setText] = useState("");
  const commit = (typed: string) => {
    const next = addTags(tags, typed);
    if (next.length !== tags.length) onChange(next);
    setText("");
  };
  return (
    <div className="tool-field tool-notes-x-tags">
      <label htmlFor={id}>{label}</label>
      <div className="tool-notes-x-tagbox">
        {tags.map((tag) => (
          <span className="tool-notes-x-chip" key={tag}>
            {tag}
            <button
              type="button"
              aria-label={t(`태그 삭제: ${tag}`, `Remove tag: ${tag}`)}
              onClick={() => onChange(tags.filter((other) => other !== tag))}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          id={id}
          type="text"
          value={text}
          autoCapitalize="none"
          placeholder={t("태그 입력 후 Enter", "Type a tag, then Enter")}
          onChange={(e) => {
            // A comma ends the tag; pasted text may bring several at once.
            if (/[,，\n]/.test(e.target.value)) commit(e.target.value);
            else setText(e.target.value);
          }}
          onKeyDown={(e) => {
            // Enter also confirms a Korean syllable being composed; that
            // Enter belongs to the input method, not to the tag.
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              commit(text);
            } else if (e.key === "Backspace" && !text && tags.length)
              onChange(tags.slice(0, -1));
          }}
          onBlur={() => {
            if (text.trim()) commit(text);
          }}
        />
      </div>
    </div>
  );
}
export default function NotesTool() {
  const t = useText(),
    ctx = useContext(ToolContext)!;
  const [undoBar, offerUndo] = useUndo();
  const [query, setQuery] = useState(""),
    [tagFilter, setTagFilter] = useState(""),
    [sort, setSort] = useState<NoteSort>("updated"),
    [activeId, setActiveId] = useState(
      ctx.doc.data._workspace ? "" : ctx.doc.id
    );
  const notes = ctx.documents.filter((doc) => doc.tool_id === "notes"),
    note = notes.find((doc) => doc.id === activeId),
    usedTags = tagCounts(notes),
    // A tag that no note carries any more cannot be switched off in the list.
    activeTag = usedTags.some((entry) => entry.tag === tagFilter)
      ? tagFilter
      : "",
    shown = sortNotes(
      notes.filter((doc) => matchesNote(doc, query, activeTag)),
      sort
    );
  const content = note?.data ?? {},
    body = typeof content.body === "string" ? content.body : "",
    tags = parseTags(content.tags),
    links = Array.isArray(content.links)
      ? content.links.filter((id): id is string => typeof id === "string")
      : [];
  const patch = (data: Record<string, unknown>) => {
    if (note)
      void ctx.repo.update(note.id, { data: { ...note.data, ...data } });
  };
  const toolName = (toolId: string) => {
    const tool = toolById(toolId);
    return tool ? t(tool.ko, tool.en) : toolId;
  };
  return (
    <>
      {undoBar}
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
          <Select
            label={t("정렬", "Sort by")}
            value={sort}
            onChange={(value) => setSort(value as NoteSort)}
            options={[
              ["updated", t("최근 수정순", "Last edited")],
              ["title", t("제목순", "Title")],
            ]}
          />
          {usedTags.length > 0 && (
            <div
              className="tool-notes-x-filter"
              role="group"
              aria-label={t("태그로 거르기", "Filter by tag")}
            >
              {usedTags.map(({ tag, count }) => (
                <button
                  key={tag}
                  aria-pressed={activeTag === tag}
                  onClick={() => setTagFilter(activeTag === tag ? "" : tag)}
                >
                  {tag}
                  <small>{count}</small>
                </button>
              ))}
            </div>
          )}
          {shown.map((doc) => {
            const docTags = parseTags(doc.data.tags);
            return (
              <button
                className="tool-note-item"
                key={doc.id}
                aria-current={note?.id === doc.id ? "true" : undefined}
                onClick={() => setActiveId(doc.id)}
              >
                <strong>{doc.title}</strong>
                <span>{String(doc.data.body ?? "").slice(0, 90)}</span>
                {docTags.length > 0 && (
                  <em className="tool-notes-x-itemtags">
                    {docTags.map((tag) => `#${tag}`).join(" ")}
                  </em>
                )}
              </button>
            );
          })}
          {notes.length === 0 ? (
            <EmptyState title={t("메모가 없습니다", "No notes yet")}>
              <p>
                {t(
                  "‘메모 추가’를 눌러 첫 메모를 쓰세요.",
                  "Press Add note to write your first one."
                )}
              </p>
            </EmptyState>
          ) : (
            shown.length === 0 && (
              <EmptyState
                title={t("조건에 맞는 메모가 없습니다", "No notes match")}
              >
                <button
                  onClick={() => {
                    setQuery("");
                    setTagFilter("");
                  }}
                >
                  {t("검색·태그 지우기", "Clear search and tag")}
                </button>
              </EmptyState>
            )
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
              <button
                className="tool-note-back"
                onClick={() => setActiveId("")}
              >
                {t("메모 목록", "Back to notes")}
              </button>
              <NoteTitleField
                key={note.id}
                label={t("제목", "Title")}
                title={note.title}
                line={firstLine(body)}
                onCommit={(title) => void ctx.repo.update(note.id, { title })}
              />
              <TagField
                key={`tags:${note.id}`}
                label={t("태그", "Tags")}
                tags={tags}
                onChange={(next) => patch({ tags: formatTags(next) })}
              />
              <label className="tool-field">
                <span>{t("본문", "Body")}</span>
                <textarea
                  rows={16}
                  maxLength={200000}
                  value={body}
                  onChange={(e) => patch({ body: e.target.value })}
                />
              </label>
              <Select
                label={t("저장한 작업 연결", "Link saved work")}
                value=""
                options={[
                  "",
                  ...ctx.documents
                    .filter(
                      (doc) => doc.id !== note.id && !links.includes(doc.id)
                    )
                    .map(
                      (doc) =>
                        [
                          doc.id,
                          `${toolName(doc.tool_id)} · ${doc.title}`,
                        ] as const
                    ),
                ]}
                onChange={(id) => {
                  if (id) patch({ links: [...new Set([...links, id])] });
                }}
              />
              {links.length > 0 && (
                <ul
                  className="tool-notes-x-links"
                  aria-label={t("연결한 작업", "Linked work")}
                >
                  {links.map((id) => {
                    const doc = ctx.documents.find((row) => row.id === id);
                    const Icon = doc ? toolIcons[doc.tool_id] : null;
                    return (
                      <li key={id}>
                        {doc ? (
                          <>
                            {Icon && <Icon size={18} aria-hidden="true" />}
                            <span className="tool-notes-x-linktool">
                              {toolName(doc.tool_id)}
                            </span>
                            {/* A router link: a plain href reloads the whole app. */}
                            <Link to={`/app/tools/${doc.tool_id}/${id}`}>
                              {doc.title}
                            </Link>
                          </>
                        ) : (
                          <span className="tool-muted">
                            {t("삭제된 작업", "Deleted work")}
                          </span>
                        )}
                        <button
                          aria-label={
                            doc
                              ? t(
                                  `연결 해제: ${doc.title}`,
                                  `Remove link: ${doc.title}`
                                )
                              : t("연결 해제", "Remove link")
                          }
                          onClick={() =>
                            patch({
                              links: links.filter((value) => value !== id),
                            })
                          }
                        >
                          <X size={16} aria-hidden="true" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="tool-actions">
                <button
                  onClick={() =>
                    void download(
                      noteText(
                        { title: note.title, tags, body },
                        t("태그", "Tags")
                      ),
                      exportFileName("notes", note.title, "txt")
                    )
                  }
                >
                  {t("텍스트 내보내기", "Export text")}
                </button>
                <button
                  onClick={async () => {
                    const id = note.id;
                    await ctx.repo.update(id, {
                      deleted_at: new Date().toISOString(),
                    });
                    setActiveId("");
                    offerUndo(
                      t(
                        "메모를 휴지통으로 옮겼습니다.",
                        "Note moved to the trash."
                      ),
                      () => {
                        void ctx.repo.update(id, { deleted_at: null });
                        setActiveId(id);
                      }
                    );
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
    </>
  );
}

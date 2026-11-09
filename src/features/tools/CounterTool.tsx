import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ArrowLeft,
  Maximize2,
  Minus,
  Plus,
  RotateCcw,
  Undo2,
  X,
} from "lucide-react";
import {
  ColorField,
  Field,
  csv,
  download,
  toolColors,
  useText,
  useToolData,
} from "./ui";

type CountItem = { id: string; name: string; value: number; color: string };
type CountGroup = { id: string; name: string; items: CountItem[] };
type CountData = {
  groups: CountGroup[];
  counters: { id: string; name: string; value: number }[];
};
const currentGroups = (data: CountData) =>
  data.groups.length
    ? data.groups
    : data.counters.map((item, i) => ({
        id: item.id,
        name: item.name,
        items: [{ ...item, color: toolColors[i % toolColors.length] }],
      }));
export default function CounterTool() {
  const t = useText();
  const [d, set] = useToolData({
    groups: [] as CountGroup[],
    counters: [] as { id: string; name: string; value: number }[],
  });
  const groups = d.groups.length
    ? d.groups
    : d.counters.map((item, i) => ({
        id: item.id,
        name: item.name,
        items: [{ ...item, color: toolColors[i % toolColors.length] }],
      }));
  const [activeId, setActiveId] = useState(""),
    [creating, setCreating] = useState(false),
    [focus, setFocus] = useState(false),
    [confirmReset, setConfirmReset] = useState(false),
    [history, setHistory] = useState<CountGroup[]>([]);
  const [draftName, setDraftName] = useState(""),
    [draftItems, setDraftItems] = useState<CountItem[]>([]);
  const active = groups.find((group) => group.id === activeId),
    exitRef = useRef<HTMLButtonElement>(null),
    focusRef = useRef<HTMLDivElement>(null);
  const total = active?.items.reduce((sum, item) => sum + item.value, 0) ?? 0;
  useEffect(() => {
    if (!focus) return;
    const previous = document.activeElement as HTMLElement | null;
    exitRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFocus(false);
      if (event.key === "Tab") {
        const buttons = Array.from(
          focusRef.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input"
          ) ?? []
        );
        const first = buttons[0],
          last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [focus]);
  const replace = (next: CountGroup, remember = false) => {
    if (remember && active)
      setHistory((old) => [...old.slice(-49), structuredClone(active)]);
    set((old) => ({
      ...old,
      groups: currentGroups(old).map((group) =>
        group.id === next.id ? next : group
      ),
      counters: [],
    }));
  };
  const count = (id: string, delta: number) => {
    if (!active) return;
    set((old) => {
      const latest = currentGroups(old),
        snapshot = latest.find((group) => group.id === activeId);
      if (!snapshot) return old;
      setHistory((history) => [
        ...history.slice(-49),
        structuredClone(snapshot),
      ]);
      return {
        ...old,
        counters: [],
        groups: latest.map((group) =>
          group.id !== activeId
            ? group
            : {
                ...group,
                items: group.items.map((item) =>
                  item.id === id
                    ? { ...item, value: Math.max(0, item.value + delta) }
                    : item
                ),
              }
        ),
      };
    });
  };
  const open = (id: string) => {
    setActiveId(id);
    setHistory([]);
    setConfirmReset(false);
  };
  const createSingle = () => {
    const id = crypto.randomUUID(),
      name = `${t("카운터", "Counter")} ${groups.length + 1}`;
    set({
      ...d,
      groups: [
        ...groups,
        {
          id,
          name,
          items: [
            { id: crypto.randomUUID(), name, value: 0, color: toolColors[0] },
          ],
        },
      ],
      counters: [],
    });
    open(id);
  };
  const item = (index: number): CountItem => ({
    id: crypto.randomUUID(),
    name: `${t("항목", "Item")} ${index + 1}`,
    value: 0,
    color: toolColors[index % toolColors.length],
  });
  return (
    <div
      className={focus ? "tool-counter-focus" : ""}
      role={focus ? "dialog" : undefined}
      aria-modal={focus ? true : undefined}
      aria-label={focus ? t("집중 계수", "Focus counting") : undefined}
      ref={focusRef}
    >
      {active ? (
        <>
          <div className="tool-counter-heading">
            <button
              ref={exitRef}
              className="tool-icon-button"
              aria-label={
                focus
                  ? t("집중 모드 종료", "Exit focus mode")
                  : t("카운터 목록", "Counter list")
              }
              onClick={() => (focus ? setFocus(false) : setActiveId(""))}
            >
              {focus ? <X size={20} /> : <ArrowLeft size={20} />}
            </button>
            <h2>{active.name}</h2>
            {active.items.length > 1 && (
              <output
                aria-label={t("전체 계수", "Total count")}
                className="tool-counter-total"
              >
                {total.toLocaleString()}
                <span>{t("전체", "Total")}</span>
              </output>
            )}
          </div>
          <div
            className={`tool-counting-grid ${
              active.items.length === 1 ? "single" : ""
            }`}
          >
            {active.items.map((entry) => (
              <div
                className="tool-counting-tile"
                key={entry.id}
                style={{ "--count-color": entry.color } as CSSProperties}
              >
                <button
                  className="tool-counting-hit"
                  aria-label={`${entry.name} +1`}
                  onClick={() => count(entry.id, 1)}
                >
                  <span className="tool-counting-name">{entry.name}</span>
                  <strong>{entry.value.toLocaleString()}</strong>
                  <span className="tool-counting-hint">
                    {active.items.length > 1
                      ? `${
                          total ? ((entry.value / total) * 100).toFixed(1) : "0"
                        }%`
                      : t("눌러서 +1", "Tap to count +1")}
                  </span>
                </button>
                <button
                  className="tool-counting-minus"
                  aria-label={`${entry.name} −1`}
                  disabled={entry.value === 0}
                  onClick={() => count(entry.id, -1)}
                >
                  <Minus size={20} />
                </button>
              </div>
            ))}
          </div>
          <div className="tool-actions tool-counter-controls">
            <button
              disabled={!history.length}
              onClick={() => {
                const snapshot = history.at(-1);
                if (snapshot) {
                  replace(snapshot);
                  setHistory((old) => old.slice(0, -1));
                }
              }}
            >
              <Undo2 size={17} />
              {t("실행 취소", "Undo")}
            </button>
            <button disabled={!total} onClick={() => setConfirmReset(true)}>
              <RotateCcw size={17} />
              {t("초기화", "Reset")}
            </button>
            {!focus && (
              <button onClick={() => setFocus(true)}>
                <Maximize2 size={17} />
                {t("집중 모드", "Focus mode")}
              </button>
            )}
          </div>
          {confirmReset && (
            <div className="tool-inline-confirm">
              <span>
                {t(
                  "이 카운터의 모든 값을 0으로 초기화할까요?",
                  "Reset every value in this counter to zero?"
                )}
              </span>
              <button
                onClick={() => {
                  replace(
                    {
                      ...active,
                      items: active.items.map((entry) => ({
                        ...entry,
                        value: 0,
                      })),
                    },
                    true
                  );
                  setConfirmReset(false);
                }}
              >
                {t("초기화", "Reset")}
              </button>
              <button onClick={() => setConfirmReset(false)}>
                {t("취소", "Cancel")}
              </button>
            </div>
          )}
          {!focus && (
            <details className="tool-guide">
              <summary>
                {t("이름·색상 및 내보내기", "Names, colors and export")}
              </summary>
              <Field
                type="text"
                label={t("카운터 이름", "Counter name")}
                value={active.name}
                onChange={(name) => replace({ ...active, name })}
              />
              {active.items.map((entry, index) => (
                <div className="tool-counter-setting" key={entry.id}>
                  <Field
                    type="text"
                    label={`${t("항목", "Item")} ${index + 1}`}
                    value={entry.name}
                    onChange={(name) =>
                      replace({
                        ...active,
                        items: active.items.map((row) =>
                          row.id === entry.id ? { ...row, name } : row
                        ),
                      })
                    }
                  />
                  <ColorField
                    label={t("색상", "Color")}
                    value={entry.color}
                    onChange={(color) =>
                      replace({
                        ...active,
                        items: active.items.map((row) =>
                          row.id === entry.id ? { ...row, color } : row
                        ),
                      })
                    }
                  />
                </div>
              ))}
              <button
                onClick={() =>
                  download(
                    csv([
                      [
                        t("항목", "Item"),
                        t("계수", "Count"),
                        t("비율 (%)", "Percentage (%)"),
                      ],
                      ...active.items.map((entry) => [
                        entry.name,
                        entry.value,
                        total ? (entry.value / total) * 100 : 0,
                      ]),
                    ]),
                    `${active.name}.csv`,
                    "text/csv"
                  )
                }
              >
                CSV
              </button>
            </details>
          )}
        </>
      ) : (
        <>
          <div className="tool-actions">
            <button className="primary" onClick={createSingle}>
              <Plus size={18} />
              {t("단일 카운터", "Single counter")}
            </button>
            <button
              onClick={() => {
                setDraftName(t("다중 카운터", "Multi counter"));
                setDraftItems([item(0), item(1)]);
                setCreating(true);
              }}
            >
              <Plus size={18} />
              {t("다중 카운터", "Multi counter")}
            </button>
          </div>
          {creating && (
            <form
              className="tool-counter-create"
              onSubmit={(event) => {
                event.preventDefault();
                const id = crypto.randomUUID();
                set({
                  ...d,
                  groups: [
                    ...groups,
                    { id, name: draftName.trim(), items: draftItems },
                  ],
                  counters: [],
                });
                setCreating(false);
                open(id);
              }}
            >
              <Field
                type="text"
                label={t("카운터 이름", "Counter name")}
                value={draftName}
                onChange={setDraftName}
              />
              {draftItems.map((entry, index) => (
                <div className="tool-counter-setting" key={entry.id}>
                  <Field
                    type="text"
                    label={`${t("항목", "Item")} ${index + 1}`}
                    value={entry.name}
                    onChange={(name) =>
                      setDraftItems((rows) =>
                        rows.map((row) =>
                          row.id === entry.id ? { ...row, name } : row
                        )
                      )
                    }
                  />
                  <ColorField
                    label={t("색상", "Color")}
                    value={entry.color}
                    onChange={(color) =>
                      setDraftItems((rows) =>
                        rows.map((row) =>
                          row.id === entry.id ? { ...row, color } : row
                        )
                      )
                    }
                  />
                  {draftItems.length > 2 && (
                    <button
                      type="button"
                      aria-label={t("항목 삭제", "Remove item")}
                      onClick={() =>
                        setDraftItems((rows) =>
                          rows.filter((row) => row.id !== entry.id)
                        )
                      }
                    >
                      <X size={17} />
                    </button>
                  )}
                </div>
              ))}
              <div className="tool-actions">
                <button
                  type="button"
                  disabled={draftItems.length >= 12}
                  onClick={() =>
                    setDraftItems((rows) => [...rows, item(rows.length)])
                  }
                >
                  {t("항목 추가", "Add item")}
                </button>
                <button
                  type="submit"
                  className="primary"
                  disabled={
                    !draftName.trim() ||
                    draftItems.some((entry) => !entry.name.trim())
                  }
                >
                  {t("카운터 만들기", "Create counter")}
                </button>
                <button type="button" onClick={() => setCreating(false)}>
                  {t("취소", "Cancel")}
                </button>
              </div>
            </form>
          )}
          <div className="tool-counter-list">
            {groups.map((group) => (
              <button
                className="tool-counter-preview"
                key={group.id}
                onClick={() => open(group.id)}
              >
                <div className="tool-counter-preview-values">
                  {group.items.slice(0, 4).map((entry) => (
                    <span key={entry.id} style={{ background: entry.color }}>
                      {entry.value.toLocaleString()}
                    </span>
                  ))}
                </div>
                <strong>{group.name}</strong>
                {group.items.length > 1 && (
                  <span>
                    {t("전체", "Total")}{" "}
                    {group.items
                      .reduce((sum, entry) => sum + entry.value, 0)
                      .toLocaleString()}
                  </span>
                )}
              </button>
            ))}
          </div>
          {!groups.length && !creating && (
            <p className="tool-empty">
              {t(
                "단일 카운터로 수량을 세거나, 다중 카운터로 항목을 나눠 계수하세요.",
                "Count quantities with a single counter, or separate categories with a multi counter."
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}

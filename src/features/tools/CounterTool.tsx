import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  ArrowLeft,
  Maximize2,
  Minus,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import {
  ColorField,
  CopyButton,
  EmptyState,
  ErrorMessage,
  Field,
  NumberField,
  StoredNumberField,
  calculate,
  csv,
  download,
  format,
  need,
  plainNumber,
  toolColors,
  useExportName,
  useText,
  useToolData,
  useUndo,
} from "./ui";
import {
  MAX_ITEMS,
  MAX_STEP,
  changeText,
  countBy,
  counterGroups,
  counterShortcut,
  csvRows,
  fileNamePart,
  insertGroup,
  insertItem,
  percentText,
  removeItem,
  renameGroup,
  resetGroup,
  setValue,
  stepOf,
  summaryText,
  totalOf,
  undoLast,
  updateItem,
  validStep,
  wholeCount,
  type CountData,
  type CountGroup,
  type CountItem,
} from "./counter";
import { BarList, ChartFrame, SegmentedBar, type Part } from "./charts";

// Vibration is a property of the device in hand, not of the account: the same
// counters open on a laptop that cannot vibrate. Hence localStorage.
const HAPTICS_KEY = "buril-tools-counter-haptics";
const canVibrate = () =>
  typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
function hapticsOn() {
  try {
    return localStorage.getItem(HAPTICS_KEY) !== "off";
  } catch {
    return true;
  }
}
function saveHaptics(on: boolean) {
  try {
    if (on) localStorage.removeItem(HAPTICS_KEY);
    else localStorage.setItem(HAPTICS_KEY, "off");
  } catch {
    /* Storage is unavailable (private mode): the choice lasts for this visit. */
  }
}
function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate(pattern);
  } catch {
    /* Refused or unsupported: counting goes on without it. */
  }
}
/** One short pulse for a count up; two for anything that takes a count back. */
const PULSE_UP = 12,
  PULSE_BACK = [12, 60, 12];

/** Typing a value in place of the big button. Opens with the value selected. */
function ValueEntry({
  name,
  value,
  onApply,
  onCancel,
}: {
  name: string;
  value: number;
  onApply: (value: number) => void;
  onCancel: () => void;
}) {
  const t = useText();
  const [text, setText] = useState(() => plainNumber(value));
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const input = form.current?.querySelector("input");
    input?.focus();
    input?.select();
  }, []);
  const typed = calculate(() => wholeCount(need(text)));
  return (
    <form
      ref={form}
      className="tool-counter-x-entry"
      onSubmit={(event) => {
        event.preventDefault();
        if (typed.value != null) onApply(typed.value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <NumberField
        label={t(`${name} 값`, `${name} value`)}
        value={text}
        onChange={setText}
      />
      {typed.incomplete && (
        <p className="tool-muted" role="status">
          {t("0 이상의 정수를 입력하세요.", "Enter a whole number, 0 or more.")}
        </p>
      )}
      <ErrorMessage message={typed.error} />
      <div className="tool-actions">
        <button type="submit" className="primary" disabled={typed.value == null}>
          {t("적용", "Apply")}
        </button>
        <button type="button" onClick={onCancel}>
          {t("취소", "Cancel")}
        </button>
      </div>
    </form>
  );
}

export default function CounterTool() {
  const t = useText(),
    exportName = useExportName(),
    [undoBar, offerUndo] = useUndo(),
    valueId = useId();
  const [d, set] = useToolData<CountData>({ groups: [], counters: [] });
  const groups = counterGroups(d, toolColors);
  const [activeId, setActiveId] = useState(""),
    [creating, setCreating] = useState(false),
    [focus, setFocus] = useState(false),
    [confirmReset, setConfirmReset] = useState(false),
    [editingId, setEditingId] = useState(""),
    [selectedId, setSelectedId] = useState(""),
    [announcement, setAnnouncement] = useState(""),
    [haptics, setHaptics] = useState(hapticsOn);
  const [draftName, setDraftName] = useState(""),
    [draftItems, setDraftItems] = useState<CountItem[]>([]);
  const active = groups.find((group) => group.id === activeId),
    exitRef = useRef<HTMLButtonElement>(null),
    focusButtonRef = useRef<HTMLButtonElement>(null),
    focusRef = useRef<HTMLDivElement>(null),
    areaRef = useRef<HTMLDivElement>(null),
    // Index of the tile whose "type a value" button gets focus back.
    refocusEdit = useRef(-1);
  const total = active ? totalOf(active) : 0,
    step = active ? stepOf(active) : 1,
    multi = (active?.items.length ?? 0) > 1,
    totalLabel = t("전체", "Total"),
    ceiling = t(
      `항목은 최대 ${MAX_ITEMS}개까지 만들 수 있습니다.`,
      `A counter can have up to ${MAX_ITEMS} items.`
    );
  // Space and Enter count this one: the item last counted or focused, or the
  // only item of a single counter.
  const selected =
    active?.items.find((entry) => entry.id === selectedId) ??
    (active?.items.length === 1 ? active.items[0] : undefined);
  const itemName = (entry: CountItem, index: number) =>
    entry.name.trim() || `${t("항목", "Item")} ${index + 1}`;

  /**
   * Replaces the open counter with `update` of its newest saved state, not of
   * the state last drawn: several presses can arrive before a redraw.
   */
  const write = (update: (group: CountGroup) => CountGroup) => {
    const seen: { before?: CountGroup; after?: CountGroup } = {};
    set((old) => {
      const latest = counterGroups(old, toolColors),
        before = latest.find((group) => group.id === activeId);
      if (!before) return old;
      const after = update(before);
      seen.before = before;
      seen.after = after;
      return {
        ...old,
        counters: [],
        groups: latest.map((group) => (group === before ? after : group)),
      };
    });
    return seen;
  };
  /**
   * A change to the counts. One that would change nothing (− at zero, undo
   * with nothing to undo) is not written, so it does not cost a save. A real
   * one is announced to screen readers and felt as a vibration.
   */
  const change = (
    update: (group: CountGroup) => CountGroup,
    pulse: number | number[]
  ) => {
    if (!active || update(active) === active) return;
    const { before, after } = write(update);
    if (!before || !after || after === before) return;
    setAnnouncement(changeText(before, after, totalLabel));
    if (haptics && canVibrate()) vibrate(pulse);
  };
  /** A tile's button by item position; a tile being typed into has none. */
  const tileButton = (className: string, index: number) =>
    areaRef.current?.querySelector<HTMLElement>(
      `.${className}[data-index="${index}"]`
    );
  const count = (itemId: string, direction: 1 | -1) => {
    setSelectedId(itemId);
    change(
      (group) => countBy(group, itemId, direction),
      direction > 0 ? PULSE_UP : PULSE_BACK
    );
  };
  const undo = () => change(undoLast, PULSE_BACK);
  /**
   * A button that disables or disappears under the finger takes keyboard
   * focus with it; this keeps focus in the counting area so the keys go on
   * working.
   */
  const keepFocus = () => areaRef.current?.focus({ preventScroll: true });

  const shortcut = (event: KeyboardEvent) => {
    if (!active) return;
    const target = event.target instanceof Element ? event.target : null;
    // Typing a value or a name is not counting.
    if (target?.closest("input, textarea, select")) return;
    const key = counterShortcut(event);
    if (!key) return;
    if (key.action === "count-selected") {
      // A focused button already acts on Space and Enter. Holding Enter must
      // not keep counting.
      if (target?.closest("button, a, summary")) {
        if (event.repeat && event.key === "Enter") event.preventDefault();
        return;
      }
      event.preventDefault();
      if (!event.repeat && selected) count(selected.id, 1);
      return;
    }
    event.preventDefault();
    // One press, one count: a held key does not repeat.
    if (event.repeat) return;
    if (key.action === "undo") undo();
    else if (active.items[key.index]) {
      count(active.items[key.index].id, key.direction);
      // Focus follows the count, so Space and Enter then press this item.
      tileButton("tool-counting-hit", key.index)?.focus();
    }
  };
  const onWindowKey = useEffectEvent(shortcut);
  const enterFocusMode = useEffectEvent(() => {
    const index = active
      ? active.items.findIndex((entry) => entry.id === selectedId)
      : -1;
    // On the button Space and Enter will press, not on "exit".
    (
      tileButton("tool-counting-hit", Math.max(0, index)) ?? exitRef.current
    )?.focus();
  });
  const leaveFocusMode = useEffectEvent((previous: HTMLElement | null) => {
    // The "Focus mode" button that opened the mode is gone by the time the
    // mode starts (focus is then on the page) and is drawn anew afterwards.
    (previous?.isConnected && previous !== document.body
      ? previous
      : focusButtonRef.current
    )?.focus();
  });
  useEffect(() => {
    if (!focus) return;
    const previous = document.activeElement as HTMLElement | null;
    enterFocusMode();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFocus(false);
      else if (event.key === "Tab") {
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
      } else onWindowKey(event);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      leaveFocusMode(previous);
    };
  }, [focus]);
  // The shortcuts work while focus is in the counting area, so an opened
  // counter starts with focus there rather than on the page.
  useEffect(() => {
    if (activeId) areaRef.current?.focus({ preventScroll: true });
  }, [activeId]);
  useEffect(() => {
    if (refocusEdit.current < 0) return;
    tileButton("tool-counter-x-edit", refocusEdit.current)?.focus();
    refocusEdit.current = -1;
  });

  const open = (id: string) => {
    setActiveId(id);
    setConfirmReset(false);
    setEditingId("");
    setSelectedId("");
    setAnnouncement("");
  };
  const closeEntry = (index: number) => {
    refocusEdit.current = index;
    setEditingId("");
  };
  const newItem = (index: number): CountItem => ({
    id: crypto.randomUUID(),
    name: `${t("항목", "Item")} ${index + 1}`,
    value: 0,
    color: toolColors[index % toolColors.length],
  });
  const createSingle = () => {
    const id = crypto.randomUUID(),
      name = `${t("카운터", "Counter")} ${groups.length + 1}`;
    set((old) => ({
      ...old,
      counters: [],
      groups: [
        ...counterGroups(old, toolColors),
        {
          id,
          name,
          items: [
            { id: crypto.randomUUID(), name, value: 0, color: toolColors[0] },
          ],
        },
      ],
    }));
    open(id);
  };
  const removeEntry = (entry: CountItem, index: number) => {
    if (!active) return;
    const groupId = active.id,
      name = itemName(entry, index);
    write((group) => removeItem(group, entry.id));
    if (editingId === entry.id) setEditingId("");
    offerUndo(
      t(`‘${name}’ 항목을 삭제했습니다.`, `Item “${name}” removed.`),
      () =>
        set((old) => ({
          ...old,
          counters: [],
          groups: counterGroups(old, toolColors).map((group) =>
            group.id === groupId ? insertItem(group, entry, index) : group
          ),
        }))
    );
  };
  const removeCounter = () => {
    if (!active) return;
    const removed = active,
      index = groups.indexOf(active);
    set((old) => ({
      ...old,
      counters: [],
      groups: counterGroups(old, toolColors).filter(
        (group) => group.id !== removed.id
      ),
    }));
    setActiveId("");
    setConfirmReset(false);
    setEditingId("");
    offerUndo(
      t(
        `‘${removed.name}’ 카운터를 삭제했습니다.`,
        `Counter “${removed.name}” deleted.`
      ),
      () =>
        set((old) => ({
          ...old,
          counters: [],
          groups: insertGroup(counterGroups(old, toolColors), removed, index),
        }))
    );
  };
  const keys: [combo: string, effect: string][] = multi
    ? [
        ["1–9", t("해당 항목에 더하기", "add to that item")],
        ["Shift+1–9", t("빼기", "subtract")],
        ["Space / Enter", t("선택한 항목에 더하기", "add to the selected item")],
      ]
    : [
        ["1 / Space / Enter", t("더하기", "add")],
        ["Shift+1", t("빼기", "subtract")],
      ];
  keys.push(["Backspace", t("실행 취소", "undo")]);
  if (focus) keys.push(["Esc", t("집중 모드 종료", "exit focus mode")]);
  return (
    <div
      className={focus ? "tool-counter-focus" : ""}
      role={focus ? "dialog" : undefined}
      aria-modal={focus ? true : undefined}
      aria-label={focus ? t("집중 계수", "Focus counting") : undefined}
      ref={focusRef}
    >
      {!focus && undoBar}
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
            {multi && (
              <output
                aria-label={t("전체 계수", "Total count")}
                className="tool-counter-total"
              >
                {format(total)}
                <span>{totalLabel}</span>
              </output>
            )}
          </div>
          {/* How the total splits between the items, at a glance. Left out of
              focus mode, where the tap targets take the whole screen. */}
          {multi && !focus && total > 0 && (
            <ChartFrame
              title={t("항목 비율", "Share by item")}
              table={{
                headers: [t("항목", "Item"), t("개수", "Count"), "%"],
                rows: active.items.map((entry) => [
                  entry.name,
                  entry.value,
                  percentText(entry.value, total),
                ]),
              }}
            >
              {active.items.length <= 6 ? (
                <SegmentedBar
                  label={t("항목별 비율", "Share of the total by item")}
                  parts={active.items.map(
                    (entry): Part => ({ label: entry.name, value: entry.value })
                  )}
                />
              ) : (
                // More parts than colours that can be told apart: one hue,
                // one bar per item, compared on a shared baseline.
                <BarList
                  label={t("항목별 개수", "Count by item")}
                  rows={active.items.map((entry) => ({
                    label: entry.name,
                    value: entry.value,
                    figure: `${format(entry.value)} (${percentText(
                      entry.value,
                      total
                    )}%)`,
                  }))}
                />
              )}
            </ChartFrame>
          )}
          <div
            ref={areaRef}
            className="tool-counter-x-area"
            role="group"
            aria-label={t("계수 영역", "Counting area")}
            tabIndex={-1}
            onKeyDown={
              // In focus mode the window listener handles keys wherever focus is.
              focus ? undefined : (event) => shortcut(event.nativeEvent)
            }
          >
            <div className={`tool-counting-grid ${multi ? "" : "single"}`}>
              {active.items.map((entry, index) => {
                const name = itemName(entry, index);
                return (
                  <div
                    className={`tool-counting-tile${
                      multi && selected?.id === entry.id
                        ? " tool-counter-x-selected"
                        : ""
                    }`}
                    key={entry.id}
                    style={{ "--count-color": entry.color } as CSSProperties}
                  >
                    {!focus && editingId === entry.id ? (
                      <ValueEntry
                        name={name}
                        value={entry.value}
                        onApply={(value) => {
                          change(
                            (group) => setValue(group, entry.id, value),
                            PULSE_UP
                          );
                          closeEntry(index);
                        }}
                        onCancel={() => closeEntry(index)}
                      />
                    ) : (
                      <>
                        <button
                          className="tool-counting-hit"
                          data-index={index}
                          aria-label={`${name} +${step}`}
                          aria-describedby={`${valueId}-${index}`}
                          onFocus={() => setSelectedId(entry.id)}
                          onClick={() => count(entry.id, 1)}
                        >
                          <span className="tool-counting-name">
                            {/* The same colour as this item's block in the share bar. */}
                            {multi && active.items.length <= 6 && (
                              <i
                                aria-hidden="true"
                                className={`tool-chart-key tool-chart-fill-${
                                  index + 1
                                }`}
                              />
                            )}
                            {entry.name}
                          </span>
                          <strong id={`${valueId}-${index}`}>
                            {format(entry.value)}
                          </strong>
                          <span className="tool-counting-hint">
                            {multi
                              ? `${percentText(entry.value, total)}%`
                              : t(`눌러서 +${step}`, `Tap to count +${step}`)}
                          </span>
                        </button>
                        <button
                          className="tool-counting-minus"
                          aria-label={`${name} −${step}`}
                          disabled={entry.value === 0}
                          onClick={() => {
                            count(entry.id, -1);
                            // At zero this button disables itself.
                            if (entry.value <= step)
                              tileButton("tool-counting-hit", index)?.focus();
                          }}
                        >
                          <Minus size={20} />
                        </button>
                        {!focus && (
                          <button
                            className="tool-counter-x-edit"
                            data-index={index}
                            aria-label={t(
                              `${name} 값 직접 입력`,
                              `Type a value for ${name}`
                            )}
                            onClick={() => {
                              setSelectedId(entry.id);
                              setEditingId(entry.id);
                            }}
                          >
                            <Pencil size={18} />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="sr-only" aria-live="polite" aria-atomic="true">
              {announcement}
            </p>
            <div className="tool-actions tool-counter-controls">
              <button
                disabled={!active.undo?.length}
                onClick={() => {
                  undo();
                  if ((active.undo?.length ?? 0) <= 1) keepFocus();
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
                <button
                  ref={focusButtonRef}
                  onClick={() => {
                    setEditingId("");
                    setFocus(true);
                  }}
                >
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
                    change(resetGroup, PULSE_BACK);
                    setConfirmReset(false);
                    keepFocus();
                  }}
                >
                  {t("초기화", "Reset")}
                </button>
                <button
                  onClick={() => {
                    setConfirmReset(false);
                    keepFocus();
                  }}
                >
                  {t("취소", "Cancel")}
                </button>
              </div>
            )}
            <p className="tool-counter-x-keys">
              {keys.map(([combo, label]) => (
                <span key={combo}>
                  <kbd>{combo}</kbd> {label}
                </span>
              ))}
            </p>
          </div>
          {!focus && (
            <details className="tool-guide">
              <summary>
                {t("설정·항목 및 내보내기", "Settings, items and export")}
              </summary>
              <Field
                type="text"
                label={t("카운터 이름", "Counter name")}
                value={active.name}
                onChange={(name) => write((group) => renameGroup(group, name))}
              />
              <div className="tool-counter-x-step">
                <StoredNumberField
                  label={t("한 번에 세는 수", "Count by")}
                  value={active.step === undefined ? 1 : active.step}
                  onChange={(value) => {
                    // Anything but a whole number in range is not kept, and
                    // the field shows the last valid step again.
                    if (value === null || validStep(value))
                      write((group) => ({ ...group, step: value }));
                  }}
                />
                <div
                  className="tool-actions"
                  role="group"
                  aria-label={t("자주 쓰는 단위", "Common steps")}
                >
                  {[1, 5, 10].map((size) => (
                    <button
                      key={size}
                      aria-pressed={step === size}
                      onClick={() =>
                        write((group) => ({ ...group, step: size }))
                      }
                    >
                      ±{size}
                    </button>
                  ))}
                </div>
              </div>
              <p className="tool-muted">
                {t(
                  `1~${MAX_STEP} 사이의 정수. 비워 두면 1씩 셉니다.`,
                  `A whole number from 1 to ${MAX_STEP}. Left empty, it counts by 1.`
                )}
              </p>
              {active.items.map((entry, index) => (
                <div className="tool-counter-setting" key={entry.id}>
                  <Field
                    type="text"
                    label={`${t("항목", "Item")} ${index + 1}`}
                    value={entry.name}
                    onChange={(name) =>
                      write((group) => updateItem(group, entry.id, { name }))
                    }
                  />
                  <ColorField
                    label={t("색상", "Color")}
                    value={entry.color}
                    onChange={(color) =>
                      write((group) => updateItem(group, entry.id, { color }))
                    }
                  />
                  {multi && (
                    <button
                      aria-label={`${t("항목 삭제", "Remove item")}: ${itemName(
                        entry,
                        index
                      )}`}
                      onClick={() => removeEntry(entry, index)}
                    >
                      <X size={17} />
                    </button>
                  )}
                </div>
              ))}
              <div className="tool-actions">
                <button
                  disabled={active.items.length >= MAX_ITEMS}
                  onClick={() =>
                    write((group) =>
                      insertItem(group, newItem(group.items.length))
                    )
                  }
                >
                  <Plus size={17} />
                  {t("항목 추가", "Add item")}
                </button>
              </div>
              {active.items.length >= MAX_ITEMS && (
                <p className="tool-muted" role="status">
                  {ceiling}
                </p>
              )}
              {canVibrate() && (
                <label>
                  <input
                    type="checkbox"
                    checked={haptics}
                    onChange={(event) => {
                      const on = event.target.checked;
                      setHaptics(on);
                      saveHaptics(on);
                      if (on) vibrate(PULSE_UP);
                    }}
                  />
                  {t("셀 때 진동 (이 기기)", "Vibrate on each count (this device)")}
                </label>
              )}
              <div className="tool-actions">
                <CopyButton text={() => summaryText(active, totalLabel)}>
                  {t("결과 복사", "Copy result")}
                </CopyButton>
                <button
                  onClick={() =>
                    download(
                      csv(
                        csvRows(active, [
                          t("항목", "Item"),
                          t("계수", "Count"),
                          t("비율 (%)", "Percentage (%)"),
                        ])
                      ),
                      exportName("csv", fileNamePart(active.name)),
                      "text/csv"
                    )
                  }
                >
                  {t("CSV 내보내기", "Export CSV")}
                </button>
                <button onClick={removeCounter}>
                  <Trash2 size={17} />
                  {t("카운터 삭제", "Delete counter")}
                </button>
              </div>
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
                setDraftItems([newItem(0), newItem(1)]);
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
                set((old) => ({
                  ...old,
                  counters: [],
                  groups: [
                    ...counterGroups(old, toolColors),
                    { id, name: draftName.trim(), items: draftItems },
                  ],
                }));
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
                      aria-label={`${t("항목 삭제", "Remove item")}: ${itemName(
                        entry,
                        index
                      )}`}
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
              {draftItems.length >= MAX_ITEMS && (
                <p className="tool-muted" role="status">
                  {ceiling}
                </p>
              )}
              <div className="tool-actions">
                <button
                  type="button"
                  disabled={draftItems.length >= MAX_ITEMS}
                  onClick={() =>
                    setDraftItems((rows) =>
                      rows.length >= MAX_ITEMS
                        ? rows
                        : [...rows, newItem(rows.length)]
                    )
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
                <strong>{group.name}</strong>
                {group.items.length > 1 ? (
                  <>
                    <span className="tool-counter-x-total">
                      {totalLabel} <b>{format(totalOf(group))}</b>
                    </span>
                    <div className="tool-counter-x-items">
                      {group.items.map((entry) => (
                        <span
                          key={entry.id}
                          style={{ background: entry.color }}
                        >
                          <b>{format(entry.value)}</b>
                          <small>{entry.name}</small>
                        </span>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="tool-counter-preview-values tool-counter-x-first">
                    {group.items.map((entry) => (
                      <span key={entry.id} style={{ background: entry.color }}>
                        {format(entry.value)}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            ))}
          </div>
          {!groups.length && !creating && (
            <EmptyState title={t("카운터가 없습니다", "No counters yet")}>
              <p>
                {t(
                  "단일 카운터로 수량을 세거나, 다중 카운터로 항목을 나눠 계수하세요.",
                  "Count quantities with a single counter, or separate categories with a multi counter."
                )}
              </p>
            </EmptyState>
          )}
        </>
      )}
    </div>
  );
}

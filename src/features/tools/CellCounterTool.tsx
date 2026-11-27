import {
  useContext,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minus,
  Plus,
  Undo2,
  X,
} from "lucide-react";
import {
  ToolContext,
  useToolData,
  useText,
  Panel,
  Select,
  StoredNumberField,
  QuantityField,
  Result,
  ErrorMessage,
  CopyButton,
  calculate,
  need,
  format,
  plainNumber,
  useUndo,
} from "./ui";
import { cellCount } from "./labMath";
import {
  CHAMBER_SOURCE,
  DEFAULT_CHAMBER,
  VOLUME_UNITS,
  cellsPerMlFactor,
  chamberOf,
  chamberPresets,
  countSpread,
  microlitresOf,
  millilitresOf,
  oneDecimal,
  scientific,
  totalCells,
  type ChamberPreset,
} from "./culture";
import { BarList, ChartFrame, SegmentedBar } from "./charts";

type Kind = "live" | "dead";
/** One counted square. A count field left empty is null, not zero. */
type Row = Record<Kind, number | null>;
type CountData = {
  rows: Row[];
  factor: number | null;
  /** mL above one counted square. The chamber preset fills it in. */
  volume: number | null;
  // Added after the first release; counts saved before then open with these.
  /** Id of the chamber preset, or "custom" for a typed volume. */
  chamber: string;
  suspensionVolume: string;
  suspensionUnit: string;
};
/** One press of a count button, kept so the last ones can be taken back. */
type Tap = { row: number; kind: Kind; by: 1 | -1 };

const CUSTOM = "custom";
const empty = (): Row => ({ live: 0, dead: 0 });
const rowsOf = (data: CountData): Row[] =>
  Array.isArray(data.rows) && data.rows.length ? data.rows : [empty()];
/** A number inside a copied sentence: as shown, without grouping. */
const plain = (value: number) => plainNumber(value, 7);

export default function CellCounterTool() {
  const t = useText(),
    ctx = useContext(ToolContext),
    valueId = useId(),
    [undoBar, offerUndo] = useUndo();
  const [d, set] = useToolData<CountData>({
    rows: [empty()],
    factor: 2,
    volume: 0.0001,
    chamber: DEFAULT_CHAMBER,
    suspensionVolume: "",
    suspensionUnit: "mL",
  });
  const rows = rowsOf(d);
  const [active, setActive] = useState(0),
    [taps, setTaps] = useState<Tap[]>([]),
    [focus, setFocus] = useState(false),
    [announcement, setAnnouncement] = useState("");
  const index = Math.min(active, rows.length - 1),
    panelRef = useRef<HTMLDivElement>(null),
    focusButtonRef = useRef<HTMLButtonElement>(null);
  const kindName = (kind: Kind) =>
      kind === "live" ? t("생존", "Live") : t("사멸", "Dead"),
    squareName = (i: number) => t(`구획 ${i + 1}`, `Square ${i + 1}`);

  const preset = chamberOf(d.chamber, d.volume);
  const presetName = (row: ChamberPreset) =>
    `${row.ruling} · ${
      row.square === "large"
        ? t("큰 사각형", "large square")
        : t("그룹 사각형", "group square")
    } ${plainNumber(row.sideMm)} × ${plainNumber(row.sideMm)} mm (${plainNumber(
      row.volumeUl
    )} µL)`;
  const unit = (VOLUME_UNITS as readonly string[]).includes(d.suspensionUnit)
    ? d.suspensionUnit
    : "mL";

  const r = calculate(() =>
    cellCount(
      rows.map((row) => need(row.live)),
      rows.map((row) => need(row.dead)),
      need(d.factor),
      need(d.volume)
    )
  );
  // The suspension volume is optional: without it there is no total to show.
  const total = calculate(() =>
    r.value && d.suspensionVolume.trim()
      ? totalCells(r.value.concentration, need(d.suspensionVolume), unit)
      : null
  );
  const perSquare = rows.map((row) => (row.live ?? 0) + (row.dead ?? 0)),
    spread = countSpread(perSquare),
    // A square added but not counted pulls the mean down as a zero.
    uncounted = perSquare.some((count) => count > 0)
      ? perSquare.flatMap((count, i) => (count === 0 ? [i + 1] : []))
      : [];

  /**
   * Adds to (or takes from) one count of the square being counted, from the
   * newest saved state: several presses can arrive before a redraw.
   */
  const tap = (kind: Kind, by: 1 | -1) => {
    const seen: { after?: number } = {};
    set((old) => {
      const list = rowsOf(old),
        at = Math.min(index, list.length - 1),
        before = list[at][kind] ?? 0;
      // − at zero changes nothing, so it is neither saved nor remembered.
      if (by < 0 && before <= 0) return old;
      const after = before + by;
      seen.after = after;
      return {
        ...old,
        rows: list.map((row, i) => (i === at ? { ...row, [kind]: after } : row)),
      };
    });
    if (seen.after === undefined) return;
    setTaps((list) => [...list, { row: index, kind, by }].slice(-100));
    setAnnouncement(`${squareName(index)} ${kindName(kind)} ${seen.after}`);
  };
  const undoTap = () => {
    const last = taps.at(-1);
    if (!last) return;
    const seen: { after?: number } = {};
    set((old) => {
      const list = rowsOf(old);
      if (!list[last.row]) return old;
      const after = Math.max(0, (list[last.row][last.kind] ?? 0) - last.by);
      seen.after = after;
      return {
        ...old,
        rows: list.map((row, i) =>
          i === last.row ? { ...row, [last.kind]: after } : row
        ),
      };
    });
    setTaps((list) => list.slice(0, -1));
    setActive(last.row);
    if (seen.after !== undefined)
      setAnnouncement(
        `${squareName(last.row)} ${kindName(last.kind)} ${seen.after}`
      );
  };
  const go = (to: number) => {
    setActive(to);
    setAnnouncement(
      t(`구획 ${to + 1} / ${rows.length}`, `Square ${to + 1} of ${rows.length}`)
    );
  };
  const addRow = () => {
    set((old) => ({ ...old, rows: [...rowsOf(old), empty()] }));
    setActive(rows.length);
    setAnnouncement(
      t(`구획 ${rows.length + 1} 추가`, `Square ${rows.length + 1} added`)
    );
  };
  const removeRow = (i: number) => {
    const removed = rows[i];
    set({ ...d, rows: rows.filter((_, j) => j !== i) });
    // The remaining squares are renumbered, so earlier presses no longer
    // point at the square they were made on.
    setTaps([]);
    setActive(index > i ? index - 1 : Math.min(index, rows.length - 2));
    offerUndo(
      t(`${i + 1}번 구획을 삭제했습니다.`, `Square ${i + 1} removed.`),
      () =>
        set((old) => {
          const list = [...rowsOf(old)];
          list.splice(Math.min(i, list.length), 0, removed);
          return { ...old, rows: list };
        })
    );
  };

  const shortcut = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target : null;
    // Typing a count is not tapping one.
    if (target?.closest("input, textarea, select")) return;
    // Read from the physical key: Shift turns the character into "!" or "@".
    const digit =
      /^Digit([12])$/.exec(event.code ?? "")?.[1] ??
      /^[12]$/.exec(event.key)?.[0];
    if (digit) {
      event.preventDefault();
      // One press, one count: a held key does not repeat.
      if (!event.repeat)
        tap(digit === "1" ? "live" : "dead", event.shiftKey ? -1 : 1);
    } else if (event.key === "ArrowRight" && index < rows.length - 1) {
      event.preventDefault();
      go(index + 1);
    } else if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      go(index - 1);
    } else if (event.key === "Backspace") {
      event.preventDefault();
      if (!event.repeat) undoTap();
    }
  };
  const onWindowKey = useEffectEvent(shortcut);
  const panelButtons = () =>
    Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled)"
      ) ?? []
    );
  const enterFocusMode = useEffectEvent(() =>
    // On the button a press of Space or Enter will count with, not on "exit".
    panelRef.current?.querySelector<HTMLElement>(".tool-cells-hit")?.focus()
  );
  const trapTab = useEffectEvent((event: KeyboardEvent) => {
    const buttons = panelButtons(),
      first = buttons[0],
      last = buttons.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  });
  // The button that opened the mode is drawn again by the time it ends.
  const leaveFocusMode = useEffectEvent(() => focusButtonRef.current?.focus());
  useEffect(() => {
    if (!focus) return;
    enterFocusMode();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFocus(false);
      else if (event.key === "Tab") trapTab(event);
      else onWindowKey(event);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      leaveFocusMode();
    };
  }, [focus]);

  const sentence = () => {
    if (!r.value) return "";
    const viability =
        r.value.viability == null
          ? "—"
          : `${plain(oneDecimal(r.value.viability))}%`,
      squares = `${plain(microlitresOf(need(d.volume)))} µL`;
    return t(
      `생존 세포 ${plain(r.value.concentration)} cells/mL, 생존율 ${viability}, 희석배수 ${plain(
        need(d.factor)
      )}${
        total.value != null
          ? `, 총 생존 세포 ${plain(total.value)}개 (현탁액 ${d.suspensionVolume.trim()} ${unit})`
          : ""
      } · 구획 ${rows.length}개, 구획당 ${squares}`,
      `Viable cells ${plain(r.value.concentration)} cells/mL, viability ${viability}, dilution factor ${plain(
        need(d.factor)
      )}${
        total.value != null
          ? `, total viable cells ${plain(
              total.value
            )} in ${d.suspensionVolume.trim()} ${unit}`
          : ""
      } (${rows.length} ${
        rows.length === 1 ? "square" : "squares"
      } of ${squares})`
    );
  };

  return (
    <>
      {undoBar}
      <Panel title={t("계수판과 희석", "Chamber and dilution")}>
        {/* On a row of its own: the option names the square and its volume,
            which half a phone's width would cut off. */}
        <div className="tool-cells-narrow">
          <Select
            label={t("계수판 · 세는 구획", "Chamber and counted square")}
            value={preset?.id ?? CUSTOM}
            onChange={(id) => {
              const chosen = chamberPresets.find((row) => row.id === id);
              set({
                ...d,
                chamber: chosen ? chosen.id : CUSTOM,
                volume: chosen ? millilitresOf(chosen.volumeUl) : d.volume,
              });
            }}
            options={[
              ...chamberPresets.map((row) => [row.id, presetName(row)] as const),
              [CUSTOM, t("직접 입력", "Custom volume")] as const,
            ]}
          />
        </div>
        <div className="tool-grid">
          {!preset && (
            <StoredNumberField
              label={t("구획당 계수 부피 (µL)", "Volume above one square (µL)")}
              value={d.volume == null ? null : microlitresOf(d.volume)}
              onChange={(value) =>
                set({
                  ...d,
                  chamber: CUSTOM,
                  volume: value == null ? null : millilitresOf(value),
                })
              }
            />
          )}
          <StoredNumberField
            label={t("희석배수", "Dilution factor")}
            value={d.factor}
            onChange={(factor) => set({ ...d, factor })}
          />
        </div>
        <p className="tool-muted tool-cells-note">
          {preset
            ? t(
                `한 변 ${plainNumber(preset.sideMm)} mm × 깊이 ${plainNumber(
                  preset.depthMm
                )} mm = ${plainNumber(preset.volumeUl)} µL. `,
                `Side ${plainNumber(preset.sideMm)} mm × depth ${plainNumber(
                  preset.depthMm
                )} mm = ${plainNumber(preset.volumeUl)} µL. `
              )
            : ""}
          {d.volume != null &&
            d.volume > 0 &&
            t(
              `구획 하나에서 센 세포 1개는 희석 전 ${format(
                cellsPerMlFactor(d.volume)
              )} cells/mL에 해당합니다. `,
              `One cell counted in a square stands for ${format(
                cellsPerMlFactor(d.volume)
              )} cells/mL before dilution. `
            )}
          {t(
            "트리판 블루와 1 : 1로 섞었다면 희석배수는 2입니다.",
            "Mixed 1 : 1 with trypan blue, the dilution factor is 2."
          )}
        </p>
        <p className="tool-muted tool-cells-note">
          {t("계수판 규격 출처", "Chamber dimensions from")}:{" "}
          <a href={CHAMBER_SOURCE.url} target="_blank" rel="noopener noreferrer">
            {CHAMBER_SOURCE.name}
          </a>
          {" · "}
          {t(
            "사용하는 계수판에 새겨진 깊이와 눈금이 같은지 확인하세요.",
            "Check that the depth and ruling engraved on your chamber match."
          )}
        </p>
      </Panel>

      <div
        ref={panelRef}
        className={`tool-cells-tap${focus ? " tool-cells-focus" : ""}`}
        role={focus ? "dialog" : "group"}
        aria-modal={focus ? true : undefined}
        aria-label={t("눌러서 세기", "Tap to count")}
        onKeyDown={
          // In focus mode the window listener handles keys wherever focus is.
          focus ? undefined : (event) => shortcut(event.nativeEvent)
        }
      >
        <div className="tool-cells-tap-head">
          <button
            aria-label={t("이전 구획", "Previous square")}
            disabled={index === 0}
            onClick={() => go(index - 1)}
          >
            <ChevronLeft size={24} aria-hidden="true" />
          </button>
          <strong>
            {t(
              `구획 ${index + 1} / ${rows.length}`,
              `Square ${index + 1} of ${rows.length}`
            )}
          </strong>
          {index < rows.length - 1 ? (
            <button
              aria-label={t("다음 구획", "Next square")}
              onClick={() => go(index + 1)}
            >
              <ChevronRight size={24} aria-hidden="true" />
            </button>
          ) : (
            <button
              aria-label={t("다음 구획 추가", "Add the next square")}
              onClick={addRow}
            >
              <Plus size={24} aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="tool-cells-tiles">
          {(["live", "dead"] as const).map((kind, slot) => {
            const name = `${squareName(index)} ${kindName(kind)}`,
              value = rows[index][kind] ?? 0;
            return (
              <div className="tool-cells-tile" key={kind}>
                <button
                  className="tool-cells-hit"
                  aria-label={`${name} +1`}
                  aria-describedby={`${valueId}-${kind}`}
                  onClick={() => tap(kind, 1)}
                >
                  <span className="tool-cells-hit-name">
                    {/* The same colour as this group's block in the viability bar. */}
                    <i
                      aria-hidden="true"
                      className={`tool-chart-key tool-chart-fill-${slot + 1}`}
                    />
                    {kindName(kind)}
                  </span>
                  <strong id={`${valueId}-${kind}`}>{format(value)}</strong>
                  <span className="tool-cells-hit-hint">
                    {t("눌러서 +1", "Tap to add 1")}
                  </span>
                </button>
                <button
                  className="tool-cells-minus"
                  aria-label={`${name} −1`}
                  disabled={value <= 0}
                  onClick={() => tap(kind, -1)}
                >
                  <Minus size={20} aria-hidden="true" />1
                </button>
              </div>
            );
          })}
        </div>
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>
        <div className="tool-actions tool-cells-tap-actions">
          <button disabled={!taps.length} onClick={undoTap}>
            <Undo2 size={17} aria-hidden="true" />
            {t("실행 취소", "Undo")}
          </button>
          {focus ? (
            <button onClick={() => setFocus(false)}>
              <X size={17} aria-hidden="true" />
              {t("집중 모드 종료", "Exit focus mode")}
            </button>
          ) : (
            <button ref={focusButtonRef} onClick={() => setFocus(true)}>
              <Maximize2 size={17} aria-hidden="true" />
              {t("집중 모드", "Focus mode")}
            </button>
          )}
        </div>
        <p className="tool-cells-keys">
          <span>
            <kbd>1</kbd> {t("생존", "live")}
          </span>
          <span>
            <kbd>2</kbd> {t("사멸", "dead")}
          </span>
          <span>
            <kbd>Shift</kbd> {t("빼기", "subtract")}
          </span>
          <span>
            <kbd>← →</kbd> {t("구획 이동", "change square")}
          </span>
          <span>
            <kbd>Backspace</kbd> {t("실행 취소", "undo")}
          </span>
        </p>
      </div>

      <Panel title={t("구획별 계수", "Counts by square")}>
        <p className="tool-muted tool-cells-note">
          {t(
            "숫자를 직접 입력하거나 고칠 수 있습니다. 번호를 누르면 그 구획을 눌러서 셉니다.",
            "Type or correct a count here. Press a number to tap-count that square."
          )}
        </p>
        {rows.map((row, i) => (
          <div className="tool-cells-row" key={i}>
            <button
              className="tool-cells-row-pick"
              aria-pressed={i === index}
              aria-label={t(
                `구획 ${i + 1} 눌러서 세기`,
                `Tap-count square ${i + 1}`
              )}
              onClick={() => go(i)}
            >
              {i + 1}
            </button>
            {(["live", "dead"] as const).map((kind) => (
              <StoredNumberField
                key={kind}
                label={`${i + 1} · ${kindName(kind)}`}
                value={row[kind]}
                onChange={(value) =>
                  set({
                    ...d,
                    rows: rows.map((other, j) =>
                      j === i ? { ...other, [kind]: value } : other
                    ),
                  })
                }
              />
            ))}
            {rows.length > 1 && (
              <button
                className="tool-cells-row-remove"
                aria-label={`${t("구획 삭제", "Remove square")} ${i + 1}`}
                onClick={() => removeRow(i)}
              >
                <X size={18} aria-hidden="true" />
              </button>
            )}
          </div>
        ))}
        <div className="tool-actions">
          <button onClick={addRow}>
            <Plus size={17} aria-hidden="true" />
            {t("구획 추가", "Add square")}
          </button>
        </div>
        {uncounted.length > 0 && (
          <p className="tool-muted tool-cells-warning" role="status">
            {t(
              `${uncounted.join(
                ", "
              )}번 구획은 센 세포가 없어 평균에 0으로 들어갑니다. 세지 않은 구획이면 삭제하세요.`,
              `Square ${uncounted.join(
                ", "
              )} has no cells and counts as zero in the mean. Remove it if it was not counted.`
            )}
          </p>
        )}
        <div className="tool-cells-narrow">
          <QuantityField
            label={t("현탁액 부피 (선택)", "Suspension volume (optional)")}
            unitLabel={t("현탁액 부피 단위", "Suspension volume unit")}
            value={d.suspensionVolume}
            onChange={(suspensionVolume) => set({ ...d, suspensionVolume })}
            unit={unit}
            units={VOLUME_UNITS}
            onUnit={(suspensionUnit) => set({ ...d, suspensionUnit })}
          />
        </div>
      </Panel>

      <Panel title={t("결과", "Result")}>
        <ErrorMessage message={r.error || total.error} />
        {r.incomplete && (
          <p className="tool-muted" role="status">
            {t(
              "모든 구획의 생존·사멸 수, 희석배수, 구획당 부피를 입력하면 계산합니다. 세포가 없는 칸은 0을 입력하세요.",
              "Enter the live and dead counts of every square, the dilution factor and the volume above a square to calculate. Enter 0 where there were no cells."
            )}
          </p>
        )}
        {r.value && (
          <>
            <p className="tool-cells-result-label">
              {t("생존 세포 농도", "Viable cell density")}
            </p>
            <Result>{format(r.value.concentration)} cells/mL</Result>
            <dl className="tool-cells-figures">
              <div>
                <dt>{t("지수 표기", "Scientific")}</dt>
                <dd>{scientific(r.value.concentration)} cells/mL</dd>
              </div>
              <div>
                <dt>{t("생존율", "Viability")}</dt>
                <dd>
                  {r.value.viability == null
                    ? t("센 세포 없음", "no cells counted")
                    : `${format(oneDecimal(r.value.viability))}%`}
                </dd>
              </div>
              <div>
                <dt>{t("전체 세포 (생존 + 사멸)", "All cells (live + dead)")}</dt>
                <dd>{format(r.value.totalConcentration)} cells/mL</dd>
              </div>
              {total.value != null && (
                <div>
                  <dt>
                    {t(
                      `총 생존 세포 (${d.suspensionVolume.trim()} ${unit})`,
                      `Total viable cells (${d.suspensionVolume.trim()} ${unit})`
                    )}
                  </dt>
                  <dd>
                    {format(total.value)}
                    {total.value >= 1e4 && ` (${scientific(total.value)})`}
                  </dd>
                </div>
              )}
            </dl>
            {r.value.total > 0 && (
              <ChartFrame
                title={t("생존율", "Viability")}
                note={t(
                  `센 세포 ${format(r.value.total)}개 기준`,
                  `Of the ${format(r.value.total)} cells counted`
                )}
                table={{
                  headers: [t("구분", "Group"), t("센 세포 수", "Counted"), "%"],
                  rows: (["live", "dead"] as const).map((kind) => [
                    kindName(kind),
                    r.value![kind],
                    oneDecimal((100 * r.value![kind]) / r.value!.total),
                  ]),
                }}
              >
                <SegmentedBar
                  label={t(
                    "생존 세포와 사멸 세포의 비율",
                    "Share of live and dead cells"
                  )}
                  parts={(["live", "dead"] as const).map((kind) => ({
                    label: kindName(kind),
                    value: r.value![kind],
                  }))}
                />
              </ChartFrame>
            )}
            {rows.length >= 2 && (
              <ChartFrame
                title={t("구획 간 편차", "Spread between squares")}
                note={
                  spread.cv == null
                    ? undefined
                    : t(
                        `평균 ${format(oneDecimal(spread.mean))} · 변동계수 ${format(
                          oneDecimal(spread.cv)
                        )}%`,
                        `Mean ${format(oneDecimal(spread.mean))} · CV ${format(
                          oneDecimal(spread.cv)
                        )}%`
                      )
                }
                table={{
                  headers: [
                    t("구획", "Square"),
                    t("생존", "Live"),
                    t("사멸", "Dead"),
                    t("합계", "Total"),
                  ],
                  rows: rows.map((row, i) => [
                    i + 1,
                    row.live ?? 0,
                    row.dead ?? 0,
                    perSquare[i],
                  ]),
                }}
              >
                <BarList
                  label={t(
                    "구획별 센 세포 수 (생존 + 사멸)",
                    "Cells counted per square (live + dead)"
                  )}
                  rows={rows.map((row, i) => ({
                    label: squareName(i),
                    value: perSquare[i],
                    figure: `${format(perSquare[i])} (${t(
                      "생존",
                      "live"
                    )} ${format(row.live ?? 0)} · ${t("사멸", "dead")} ${format(
                      row.dead ?? 0
                    )})`,
                  }))}
                />
              </ChartFrame>
            )}
            <div className="tool-actions">
              <CopyButton text={sentence}>
                {t("결과 복사", "Copy result")}
              </CopyButton>
              {ctx?.sendTo && r.value.concentration > 0 && (
                <button
                  onClick={() =>
                    ctx.sendTo?.("cell-culture", {
                      kind: "cell-density",
                      value: Number(plainNumber(r.value!.concentration)),
                      unit: "cells/mL",
                      label: t("생존 세포 농도", "Viable cell density"),
                      source: "cell-counter",
                    })
                  }
                >
                  {t("세포 배양으로 보내기", "Send to Cell Culture")}
                </button>
              )}
            </div>
          </>
        )}
      </Panel>
    </>
  );
}

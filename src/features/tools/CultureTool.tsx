import { useContext, useEffect, useRef, useState } from "react";
import { CalendarPlus, Pencil, Trash2 } from "lucide-react";
import { seeding } from "./labMath";
import DeviceToggle from "./DeviceToggle";
import { clockText } from "./clock";
import { useNow } from "./useNow";
import { setDeviceEnabled, enableNotifications } from "./notifications";
import { addCalendarEvent } from "./calendarEvents";
import {
  ToolContext,
  useText,
  useToolData,
  Panel,
  Field,
  Select,
  StoredNumberField,
  Result,
  ErrorMessage,
  HandoffBanner,
  EmptyState,
  calculate,
  need,
  format,
  csv,
  download,
  useUndo,
  useExportName,
} from "./ui";
import { ChartFrame, Plot } from "./charts";
import {
  MAX_PASSAGE,
  VESSEL_SOURCE,
  densityPerMl,
  fromLocalInput,
  growthCurve,
  growthPlan,
  growthTable,
  latestPassage,
  localInput,
  mediumRange,
  nextPassageNumber,
  oneDecimal,
  passageCsvRows,
  passageNumber,
  presetVolume,
  seedingProfile,
  seedingVessel,
  sortPassages,
  vesselPresetOf,
  vesselPresets,
  type Passage,
  type StoredProfile,
  type StoredVessel,
  type VesselPreset,
} from "./culture";

type CultureData = {
  name: string;
  profile: StoredProfile;
  maxPassages: number | null;
  notes: string;
  concentration: number | null;
  available: number | null;
  vessels: StoredVessel[];
  checked: string[];
  start: number | null;
  target: number | null;
  /** `name` is the cell line when the timer was started (added later). */
  timer: null | { id: string; end: number; name?: string };
  passages: Passage[];
  medium: string;
  antibiotics: string;
  conditions: string;
  passageNotes: string;
  // Added after the first release; work saved before then opens with this.
  /** The number the first record gets. Empty counts from 0. */
  startPassage: number | null;
};
/** A passage record while it is being corrected. */
type PassageDraft = {
  id: string;
  number: string;
  at: string;
  medium: string;
  antibiotics: string;
  conditions: string;
  notes: string;
};
const CUSTOM = "custom";
const HOUR = 3600000;

/**
 * The seeding calculation saved with a passage record, as a table. A record
 * that does not have the expected shape is shown as its raw data rather than
 * hidden.
 */
function SeedingSnapshot({ snapshot }: { snapshot: unknown }) {
  const t = useText();
  const saved = snapshot as {
    concentration?: unknown;
    available?: unknown;
    result?: { rows?: unknown; stockTotal?: unknown; mediumTotal?: unknown };
  } | null;
  const rows = Array.isArray(saved?.result?.rows)
    ? (saved.result.rows as Record<string, unknown>[])
    : null;
  const number = (value: unknown) =>
    typeof value === "number" ? format(value) : "—";
  if (!rows)
    return (
      <pre
        style={{
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          fontSize: 12,
        }}
      >
        {JSON.stringify(snapshot, null, 2)}
      </pre>
    );
  return (
    <>
      <p className="tool-muted">
        {t("세포 농도", "Cell concentration")}: {number(saved?.concentration)}{" "}
        cells/mL · {t("보유 현탁액", "Available suspension")}:{" "}
        {number(saved?.available)} mL
      </p>
      <div className="tool-table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("용기", "Vessel")}</th>
              <th>{t("용기당 세포 수", "Cells per vessel")}</th>
              <th>
                {t("원액 / 배지 (용기당 mL)", "Stock / medium (mL per vessel)")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                <td>
                  {String(row.name ?? "")} ×{number(row.count)}
                </td>
                <td>{number(row.cells)}</td>
                <td>
                  {number(row.stock)} / {number(row.medium)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="tool-muted">
        {t("전체 필요 원액", "Total stock")}:{" "}
        {number(saved?.result?.stockTotal)} mL · {t("전체 배지", "Total medium")}
        : {number(saved?.result?.mediumTotal)} mL
      </p>
    </>
  );
}
/** The time left on the culture timer. Alone, so only the digits redraw. */
function Countdown({ end }: { end: number }) {
  const now = useNow();
  return <div className="tool-clock">{clockText(Math.max(0, end - now))}</div>;
}

export default function CultureTool() {
  const t = useText(),
    ctx = useContext(ToolContext)!,
    exportName = useExportName(),
    [undoBar, offerUndo] = useUndo(),
    // Only the estimated clock time depends on it, to the minute.
    now = useNow(30000);
  const [permissionError, setPermissionError] = useState(""),
    [calendarError, setCalendarError] = useState(""),
    [passageError, setPassageError] = useState(""),
    [editError, setEditError] = useState(""),
    [unreadUnit, setUnreadUnit] = useState("");
  const [d, set] = useToolData<CultureData>({
    name: "",
    profile: {
      kind: "adherent",
      doublingHours: 24,
      density: 100000,
      maxDensity: 1000000,
    },
    maxPassages: 30,
    notes: "",
    concentration: 1000000,
    available: 10,
    vessels: [
      {
        id: "t25",
        name: "T-25",
        area: 25,
        volume: 5,
        count: 1,
        mode: "split",
        target: 5,
        preset: "t25",
      },
    ],
    checked: [],
    start: 30,
    target: 80,
    timer: null,
    passages: [],
    medium: "",
    antibiotics: "",
    conditions: "",
    passageNotes: "",
    startPassage: 0,
  });
  const adherent = d.profile.kind === "adherent";
  // A value sent from the cell counter goes into the seeding section, which is
  // folded away: it opens, and comes into view, while the offer is there.
  const offered = ctx.handoff?.kind === "cell-density";
  const [seedingOpen, setSeedingOpen] = useState(offered),
    seedingRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (offered) seedingRef.current?.scrollIntoView?.({ block: "start" });
  }, [offered]);
  /** The calendar event last added, and the estimate it was added for. */
  const [calendar, setCalendar] = useState<{
    key: string;
    at: number;
    title: string;
  } | null>(null);
  const [draftAt, setDraftAt] = useState(""),
    [editing, setEditing] = useState<PassageDraft | null>(null);

  const result = calculate(() =>
    seeding(
      seedingProfile(d.profile),
      need(d.concentration),
      need(d.available),
      d.vessels.map(seedingVessel)
    )
  );
  const growth = calculate(() => {
    const start = need(d.start),
      target = need(d.target),
      doublingHours = need(d.profile.doublingHours);
    const plan = growthPlan(
      {
        kind: d.profile.kind,
        doublingHours,
        maxDensity: adherent ? 0 : need(d.profile.maxDensity),
      },
      start,
      target
    );
    const curve = growthCurve(start, target, doublingHours, plan.cap);
    return {
      ...plan,
      start,
      target,
      curve,
      table: growthTable(curve, start, target, doublingHours, plan.cap),
    };
  });
  const profile = (patch: Partial<StoredProfile>) =>
    set({ ...d, profile: { ...d.profile, ...patch } });
  const vessel = (id: string, patch: Partial<StoredVessel>) =>
    set({
      ...d,
      checked: [],
      vessels: d.vessels.map((v) => (v.id === id ? { ...v, ...patch } : v)),
    });
  const unitText = adherent ? "%" : " cells/mL";
  const hoursText = (hours: number) => {
    const text = `${format(oneDecimal(hours))} h`;
    return hours >= 48
      ? t(
          `${text} (약 ${format(oneDecimal(hours / 24))}일)`,
          `${text} (about ${format(oneDecimal(hours / 24))} days)`
        )
      : text;
  };
  const when = (ms: number) =>
    new Date(ms).toLocaleString(t("ko-KR", "en-US"), {
      month: "short",
      day: "numeric",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  const lineName = d.name.trim();
  // The running timer fixes the moment; without one it is counted from now.
  const plannedAt = d.timer
    ? d.timer.end
    : growth.value
    ? now + growth.value.hours * HOUR
    : null;
  const planKey = [
    d.start,
    d.target,
    d.profile.doublingHours,
    d.timer?.end ?? "",
    lineName,
  ].join("|");

  const presetLabel = (preset: VesselPreset) =>
    `${preset.name} ${
      preset.kind === "dish"
        ? t("디시", "dish")
        : preset.kind === "plate"
        ? t("플레이트 (웰당)", "plate (per well)")
        : t("플라스크", "flask")
    } · ${format(preset.area)} cm²`;
  const presetVesselName = (preset: VesselPreset) =>
    preset.kind === "dish"
      ? `${preset.name} ${t("디시", "dish")}`
      : preset.name;
  const removeVessel = (removed: StoredVessel) => {
    const index = d.vessels.findIndex((row) => row.id === removed.id);
    set({
      ...d,
      vessels: d.vessels.filter((row) => row.id !== removed.id),
      checked: [],
    });
    offerUndo(
      t(
        `‘${removed.name}’ 용기 그룹을 삭제했습니다.`,
        `Vessel group “${removed.name}” removed.`
      ),
      () =>
        set((old) => {
          if (old.vessels.some((row) => row.id === removed.id)) return old;
          const vessels = [...old.vessels];
          vessels.splice(Math.min(index, vessels.length), 0, removed);
          return { ...old, vessels, checked: [] };
        })
    );
  };

  const passages = sortPassages(d.passages),
    latest = latestPassage(d.passages),
    next = nextPassageNumber(d.passages, d.startPassage);
  const addPassage = () => {
    const at = calculate(() =>
      draftAt.trim() ? fromLocalInput(draftAt) : new Date().toISOString()
    );
    if (at.value == null) return setPassageError(at.error);
    setPassageError("");
    set({
      ...d,
      passages: [
        ...d.passages,
        {
          id: crypto.randomUUID(),
          number: next,
          at: at.value,
          medium: d.medium,
          antibiotics: d.antibiotics,
          conditions: d.conditions,
          notes: d.passageNotes,
          snapshot:
            result.value?.valid &&
            d.vessels.length > 0 &&
            d.checked.length === d.vessels.length
              ? {
                  profile: d.profile,
                  concentration: d.concentration,
                  available: d.available,
                  vessels: d.vessels,
                  result: result.value,
                }
              : null,
        },
      ],
      checked: [],
    });
    setDraftAt("");
  };
  const saveEdit = () => {
    if (!editing) return;
    const parsed = calculate(() => ({
      number: passageNumber(need(editing.number)),
      at: fromLocalInput(editing.at),
    }));
    if (!parsed.value)
      return setEditError(
        parsed.incomplete
          ? "Passage number must be a whole number from 0 to 9999"
          : parsed.error
      );
    const { number, at } = parsed.value;
    set({
      ...d,
      passages: d.passages.map((row) =>
        row.id === editing.id
          ? {
              ...row,
              number,
              at,
              medium: editing.medium,
              antibiotics: editing.antibiotics,
              conditions: editing.conditions,
              notes: editing.notes,
            }
          : row
      ),
    });
    setEditing(null);
    setEditError("");
  };
  const removePassage = (removed: Passage) => {
    const index = d.passages.findIndex((row) => row.id === removed.id);
    set({
      ...d,
      passages: d.passages.filter((row) => row.id !== removed.id),
    });
    if (editing?.id === removed.id) setEditing(null);
    offerUndo(
      t(
        `P${removed.number} 기록을 삭제했습니다.`,
        `Passage P${removed.number} deleted.`
      ),
      () =>
        set((old) => {
          if (old.passages.some((row) => row.id === removed.id)) return old;
          const list = [...old.passages];
          list.splice(Math.min(index, list.length), 0, removed);
          return { ...old, passages: list };
        })
    );
  };
  const startTimer = async () => {
    if (!growth.value) return;
    // The countdown below runs either way. Without permission it must
    // not also claim that this device will be notified.
    let allowed = true;
    try {
      await enableNotifications();
      setPermissionError("");
    } catch (e) {
      allowed = false;
      setPermissionError(String(e));
    }
    if (d.timer) setDeviceEnabled(ctx.repo.owner, d.timer.id, false);
    const id = crypto.randomUUID();
    set({
      ...d,
      // The cell line's name travels with the timer, for whatever alerts
      // about it.
      timer: { id, end: Date.now() + growth.value.hours * HOUR, name: lineName },
    });
    setDeviceEnabled(ctx.repo.owner, id, allowed);
  };
  const addToCalendar = async () => {
    if (!growth.value) return;
    const at =
        Math.round(
          (d.timer?.end ?? Date.now() + growth.value.hours * HOUR) / 60000
        ) * 60000,
      title = lineName
        ? t(`${lineName} 계대 예정`, `${lineName}: passage due`)
        : t("세포 계대 예정", "Cell passage due");
    try {
      await addCalendarEvent(ctx.repo, { title, start: new Date(at) });
      setCalendar({ key: planKey, at, title });
      setCalendarError("");
    } catch (e) {
      setCalendarError(String(e));
    }
  };
  const days = !!growth.value && growth.value.curve.end > 96,
    axisTime = (hours: number) => (days ? hours / 24 : hours),
    valueTitle = adherent
      ? "Confluence (%)"
      : t("농도 (cells/mL)", "Density (cells/mL)");

  return (
    <>
      {undoBar}
      <p className="culture-identity">
        <strong>{lineName || t("세포주 이름 미설정", "Unnamed cell line")}</strong>
        <span className="tool-muted">
          {t("최근 계대", "Latest passage")}: {latest == null ? "—" : `P${latest}`}
        </span>
      </p>
      <div
        className="culture-overview"
        aria-label={t("배양 현황", "Culture overview")}
      >
        <div>
          <span>
            {adherent
              ? t("현재 confluence", "Current confluence")
              : t("현재 농도", "Current density")}
          </span>
          <strong>
            {format(d.start)}
            {adherent && d.start != null ? "%" : ""}
          </strong>
          {!adherent && <span>cells/mL</span>}
        </div>
        <div>
          <span>{t("계대 목표", "Passage target")}</span>
          <strong>
            {format(d.target)}
            {adherent && d.target != null ? "%" : ""}
          </strong>
          {!adherent && <span>cells/mL</span>}
        </div>
        <div>
          <span>{t("예상 소요 시간", "Estimated time")}</span>
          <strong>{growth.value ? hoursText(growth.value.hours) : "—"}</strong>
        </div>
      </div>
      <Panel
        title={t("성장 예측과 다음 계대", "Growth estimate and next passage")}
      >
        <p className="tool-muted">
          {t(
            "모델 예상치입니다. 실제 증식 측정값과 다를 수 있습니다.",
            "Model estimate; actual growth may differ."
          )}
        </p>
        <div className="tool-grid">
          <StoredNumberField
            label={
              adherent
                ? t("현재 confluence (%)", "Current confluence (%)")
                : t("현재 농도 (cells/mL)", "Current cells/mL")
            }
            value={d.start}
            onChange={(start) => set({ ...d, start })}
          />
          <StoredNumberField
            label={
              adherent
                ? t("목표 confluence (%)", "Target confluence (%)")
                : t("목표 농도 (cells/mL)", "Target cells/mL")
            }
            value={d.target}
            onChange={(target) => set({ ...d, target })}
          />
          <StoredNumberField
            label={t("배가 시간 (h)", "Doubling time (h)")}
            value={d.profile.doublingHours}
            onChange={(doublingHours) => profile({ doublingHours })}
          />
        </div>
        <ErrorMessage message={growth.error} />
        {growth.incomplete && (
          <p className="tool-muted" role="status">
            {adherent
              ? t(
                  "현재·목표 confluence와 배가 시간을 입력하면 예상 시간을 계산합니다.",
                  "Enter the current and target confluence and the doubling time to get the estimate."
                )
              : t(
                  "현재·목표 농도, 배가 시간, 세포주 설정의 최대 밀도를 입력하면 예상 시간을 계산합니다.",
                  "Enter the current and target density, the doubling time and the maximum density in the cell line profile to get the estimate."
                )}
          </p>
        )}
        {growth.value && (
          <>
            <Result>
              {t("목표까지 예상 시간", "Estimated time to target")}:{" "}
              {hoursText(growth.value.hours)}
            </Result>
            {plannedAt != null && (
              <p className="tool-muted tool-cells-note">
                {d.timer
                  ? t("타이머 종료 시각", "Timer ends")
                  : t("지금부터 계산한 예상 시각", "Estimated time, counted from now")}
                : {when(plannedAt)}
              </p>
            )}
            <ChartFrame
              title={t("예상 성장 곡선", "Estimated growth curve")}
              note={t(
                "모델 예상 (지연기 없는 지수 성장) · 실측값이 아닙니다",
                "Model estimate (exponential growth, no lag phase), not a measurement"
              )}
              table={{
                headers: [
                  t("경과 시간 (h)", "Time from now (h)"),
                  valueTitle,
                  t("비고", "Note"),
                ],
                rows: growth.value.table.map((row) => [
                  oneDecimal(row.hours),
                  adherent ? oneDecimal(row.value) : Math.round(row.value),
                  row.hours === 0
                    ? t("현재", "Now")
                    : row.reached
                    ? t("목표 도달 예상", "Target reached (estimate)")
                    : "",
                ]),
              }}
            >
              <Plot
                label={
                  adherent
                    ? t(
                        "시간에 따른 예상 confluence",
                        "Estimated confluence over time"
                      )
                    : t("시간에 따른 예상 농도", "Estimated density over time")
                }
                series={[
                  {
                    name: t("모델 예상", "Model estimate"),
                    points: growth.value.curve.points.map((point) => ({
                      x: axisTime(point.hours),
                      y: point.value,
                    })),
                  },
                ]}
                xTitle={
                  days
                    ? t("경과 시간 (일)", "Time from now (days)")
                    : t("경과 시간 (h)", "Time from now (h)")
                }
                yTitle={valueTitle}
                rules={[{ axis: "y", at: growth.value.target }]}
                marks={[
                  { x: 0, y: growth.value.start, label: t("현재", "Now") },
                  {
                    x: axisTime(growth.value.hours),
                    y: growth.value.target,
                    label: t(
                      `목표 ${format(growth.value.target)}${unitText} · ${format(
                        oneDecimal(growth.value.hours)
                      )} h 후`,
                      `Target ${format(growth.value.target)}${unitText} in ${format(
                        oneDecimal(growth.value.hours)
                      )} h`
                    ),
                  },
                ]}
                yDomain={adherent ? [0, 100] : undefined}
                zeroBased
              />
            </ChartFrame>
          </>
        )}
        <div className="tool-actions">
          <button disabled={!growth.value} onClick={startTimer}>
            {t("예상 시점 타이머 시작", "Start target timer")}
          </button>
          <button
            disabled={!growth.value || calendar?.key === planKey}
            onClick={addToCalendar}
          >
            <CalendarPlus size={17} aria-hidden="true" />
            {calendar?.key === planKey
              ? t("캘린더에 추가됨", "Added to calendar")
              : t("다음 계대를 캘린더에 추가", "Add next passage to calendar")}
          </button>
        </div>
        {calendar && (
          <p className="tool-cells-added" role="status">
            {t(
              `캘린더에 추가했습니다: ${when(calendar.at)}, ‘${
                calendar.title
              }’. 시각과 알림은 캘린더 도구에서 바꿀 수 있습니다.`,
              `Added to the calendar: ${when(calendar.at)}, “${
                calendar.title
              }”. Change its time or reminder in the Calendar tool.`
            )}
          </p>
        )}
        <ErrorMessage message={calendarError} />
        <ErrorMessage message={permissionError} />
        {d.timer && (
          <>
            {(d.timer.name || lineName) && (
              <p className="tool-cells-timer-name">
                {d.timer.name || lineName}
              </p>
            )}
            <Countdown end={d.timer.end} />
            <p>{new Date(d.timer.end).toLocaleString(t("ko-KR", "en-US"))}</p>
            <DeviceToggle id={d.timer.id} />
            <button
              onClick={() => {
                setDeviceEnabled(ctx.repo.owner, d.timer!.id, false);
                set({ ...d, timer: null });
              }}
            >
              {t("타이머 취소", "Cancel timer")}
            </button>
          </>
        )}
      </Panel>
      <Panel title={t("계대 기록", "Passage history")}>
        <div className="tool-grid">
          <Field
            type="text"
            label={t("배지", "Medium")}
            value={d.medium}
            onChange={(medium) => set({ ...d, medium })}
          />
          <Field
            type="text"
            label={t("항생제", "Antibiotics")}
            value={d.antibiotics}
            onChange={(antibiotics) => set({ ...d, antibiotics })}
          />
          <Field
            type="text"
            label={t("배양 조건", "Culture conditions")}
            value={d.conditions}
            onChange={(conditions) => set({ ...d, conditions })}
          />
          <Field
            type="text"
            label={t("계대 메모", "Passage notes")}
            value={d.passageNotes}
            onChange={(passageNotes) => set({ ...d, passageNotes })}
          />
          <Field
            type="datetime-local"
            label={t(
              "계대 일시 (비우면 지금)",
              "Passage date and time (empty: now)"
            )}
            value={draftAt}
            onChange={setDraftAt}
          />
          {latest == null && (
            <StoredNumberField
              label={t(
                "시작 계대 번호 (첫 기록의 번호)",
                "Starting passage number (of the first record)"
              )}
              value={d.startPassage}
              onChange={(value) => {
                // Anything but a whole number in range is not kept.
                if (
                  value === null ||
                  (Number.isInteger(value) && value >= 0 && value <= MAX_PASSAGE)
                )
                  set({ ...d, startPassage: value });
              }}
            />
          )}
        </div>
        <p className="tool-muted">
          {t(
            "분주 계산에서 모든 용기를 완료하면 계산 결과도 함께 기록됩니다.",
            "Complete all vessel checks in the calculator to include the seeding results."
          )}
        </p>
        <div className="tool-actions">
          <button className="primary" onClick={addPassage}>
            {t(`계대 기록 추가 (P${next})`, `Add passage record (P${next})`)}
          </button>
          <button
            disabled={!d.passages.length}
            onClick={() =>
              download(
                csv(
                  passageCsvRows(d.passages, [
                    t("계대 번호", "Passage"),
                    t("일시", "Date and time"),
                    t("배지", "Medium"),
                    t("항생제", "Antibiotics"),
                    t("배양 조건", "Culture conditions"),
                    t("메모", "Notes"),
                    t("분주 세포 농도 (cells/mL)", "Seeding density (cells/mL)"),
                    t(
                      "분주 (용기: 원액 + 배지)",
                      "Seeding (vessel: stock + medium)"
                    ),
                  ])
                ),
                exportName("csv", "passages"),
                "text/csv"
              )
            }
          >
            {t("기록 CSV 내보내기", "Export records as CSV")}
          </button>
        </div>
        <ErrorMessage message={passageError} />
        {latest != null && d.maxPassages != null && latest >= d.maxPassages && (
          <p className="tool-error">
            {t("계대 한도에 도달했습니다.", "Passage limit reached.")}
          </p>
        )}
        {!passages.length && (
          <EmptyState title={t("계대 기록이 없습니다", "No passage records yet")}>
            <p>
              {t(
                "계대할 때마다 기록을 추가하면 번호가 하나씩 올라갑니다. 지난 계대는 일시를 지정해 추가할 수 있습니다.",
                "Add a record at each passage and the number goes up by one. Give a date and time to add a past passage."
              )}
            </p>
          </EmptyState>
        )}
        {passages.map((p) => (
          <details className="tool-panel" key={p.id}>
            <summary>
              P{p.number} · {new Date(p.at).toLocaleString(t("ko-KR", "en-US"))}
            </summary>
            {editing?.id === p.id ? (
              <form
                className="tool-cells-edit"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveEdit();
                }}
              >
                <div className="tool-grid">
                  <Field
                    type="text"
                    label={t("계대 번호", "Passage number")}
                    value={editing.number}
                    onChange={(number) => setEditing({ ...editing, number })}
                  />
                  <Field
                    type="datetime-local"
                    label={t("계대 일시", "Passage date and time")}
                    value={editing.at}
                    onChange={(at) => setEditing({ ...editing, at })}
                  />
                  <Field
                    type="text"
                    label={t("배지", "Medium")}
                    value={editing.medium}
                    onChange={(medium) => setEditing({ ...editing, medium })}
                  />
                  <Field
                    type="text"
                    label={t("항생제", "Antibiotics")}
                    value={editing.antibiotics}
                    onChange={(antibiotics) =>
                      setEditing({ ...editing, antibiotics })
                    }
                  />
                  <Field
                    type="text"
                    label={t("배양 조건", "Culture conditions")}
                    value={editing.conditions}
                    onChange={(conditions) =>
                      setEditing({ ...editing, conditions })
                    }
                  />
                  <Field
                    type="text"
                    label={t("계대 메모", "Passage notes")}
                    value={editing.notes}
                    onChange={(notes) => setEditing({ ...editing, notes })}
                  />
                </div>
                <ErrorMessage message={editError} />
                <div className="tool-actions">
                  <button type="submit" className="primary">
                    {t("기록 저장", "Save record")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(null);
                      setEditError("");
                    }}
                  >
                    {t("취소", "Cancel")}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <p>
                  {[p.medium, p.antibiotics, p.conditions]
                    .filter((text) => text?.trim())
                    .join(" · ")}
                </p>
                <p>{p.notes}</p>
                <div className="tool-actions">
                  <button
                    onClick={() => {
                      setEditError("");
                      setEditing({
                        id: p.id,
                        number: String(p.number),
                        at: Number.isFinite(+new Date(p.at))
                          ? localInput(new Date(p.at))
                          : "",
                        medium: p.medium ?? "",
                        antibiotics: p.antibiotics ?? "",
                        conditions: p.conditions ?? "",
                        notes: p.notes ?? "",
                      });
                    }}
                  >
                    <Pencil size={16} aria-hidden="true" />
                    {t("수정", "Edit")}
                  </button>
                  <button onClick={() => removePassage(p)}>
                    <Trash2 size={16} aria-hidden="true" />
                    {t("삭제", "Delete")}
                  </button>
                </div>
              </>
            )}
            {p.snapshot != null && (
              <details>
                <summary>
                  {t("저장된 분주 계산 보기", "View saved seeding calculation")}
                </summary>
                <SeedingSnapshot snapshot={p.snapshot} />
              </details>
            )}
          </details>
        ))}
      </Panel>
      <details className="culture-section">
        <summary>{t("세포주 설정", "Cell line profile")}</summary>
        <Panel title={t("세포주 설정", "Cell line profile")}>
          <div className="tool-grid">
            <Field
              type="text"
              label={t("세포주 이름", "Cell line name")}
              value={d.name}
              onChange={(name) => set({ ...d, name })}
            />
            <Select
              label={t("배양 방식", "Culture type")}
              value={d.profile.kind}
              onChange={(kind) =>
                set({
                  ...d,
                  profile: {
                    ...d.profile,
                    kind: kind as StoredProfile["kind"],
                  },
                  vessels: d.vessels.map((v) => ({ ...v, mode: "split" })),
                  checked: [],
                })
              }
              options={[
                ["adherent", t("부착", "Adherent")],
                ["suspension", t("부유", "Suspension")],
              ]}
            />
            <StoredNumberField
              label={t("배가 시간 (h)", "Doubling time (h)")}
              value={d.profile.doublingHours}
              onChange={(doublingHours) => profile({ doublingHours })}
            />
            <StoredNumberField
              label={
                adherent
                  ? "100% confluence (cells/cm²)"
                  : t("최대 밀도 (cells/mL)", "Maximum density (cells/mL)")
              }
              value={adherent ? d.profile.density : d.profile.maxDensity}
              onChange={(value) =>
                profile(adherent ? { density: value } : { maxDensity: value })
              }
            />
            <StoredNumberField
              label={t("계대 한도 (계대 번호)", "Passage limit (passage number)")}
              value={d.maxPassages}
              onChange={(maxPassages) => set({ ...d, maxPassages })}
            />
          </div>
          <Field
            type="text"
            label={t("세포주 메모", "Cell line notes")}
            value={d.notes}
            onChange={(notes) => set({ ...d, notes })}
          />
        </Panel>
      </details>
      <details
        className="culture-section"
        ref={seedingRef}
        open={seedingOpen || offered}
        onToggle={(event) => setSeedingOpen(event.currentTarget.open)}
      >
        <summary>{t("분주 계산", "Seeding calculator")}</summary>
        <Panel title={t("분주 준비", "Seeding preparation")}>
          <HandoffBanner
            accepts={["cell-density"]}
            onApply={(offer) => {
              const perMl = densityPerMl(offer.value, offer.unit);
              // A unit this cannot read is not taken at a guessed scale.
              if (perMl == null) return setUnreadUnit(offer.unit || "?");
              setUnreadUnit("");
              set((old) => ({ ...old, concentration: perMl, checked: [] }));
            }}
          />
          {unreadUnit && (
            <p className="tool-error" role="alert">
              {t(
                `가져온 값의 단위(${unreadUnit})를 cells/mL로 바꿀 수 없어 적용하지 않았습니다.`,
                `The value was not applied: its unit (${unreadUnit}) cannot be read as cells/mL.`
              )}
            </p>
          )}
          <div className="tool-grid">
            <StoredNumberField
              label={t(
                "생존 세포 농도 (cells/mL)",
                "Viable cell concentration (cells/mL)"
              )}
              value={d.concentration}
              onChange={(concentration) =>
                set({ ...d, concentration, checked: [] })
              }
            />
            <StoredNumberField
              label={t("보유 부피 (mL)", "Available stock (mL)")}
              value={d.available}
              onChange={(available) => set({ ...d, available, checked: [] })}
            />
          </div>
          {d.vessels.map((v) => {
            const preset = vesselPresetOf(v.preset, v.area);
            return (
              <div className="tool-panel" key={v.id}>
                <div className="tool-grid">
                  <Select
                    label={t("용기 프리셋", "Vessel preset")}
                    value={preset?.id ?? CUSTOM}
                    onChange={(id) => {
                      const chosen = vesselPresets.find((row) => row.id === id);
                      vessel(
                        v.id,
                        chosen
                          ? {
                              preset: chosen.id,
                              name: presetVesselName(chosen),
                              area: chosen.area,
                              volume: presetVolume(chosen),
                            }
                          : { preset: CUSTOM }
                      );
                    }}
                    options={[
                      [CUSTOM, t("직접 입력", "Custom")] as const,
                      ...vesselPresets.map(
                        (row) => [row.id, presetLabel(row)] as const
                      ),
                    ]}
                  />
                  <Field
                    type="text"
                    label={t("용기", "Vessel")}
                    value={v.name}
                    onChange={(name) => vessel(v.id, { name })}
                  />
                  <StoredNumberField
                    label={t("용기 면적 (cm²)", "Vessel area (cm²)")}
                    value={v.area}
                    onChange={(area) => vessel(v.id, { area })}
                  />
                  <StoredNumberField
                    label={t(
                      "용기당 최종 부피 (mL)",
                      "Final volume per vessel (mL)"
                    )}
                    value={v.volume}
                    onChange={(volume) => vessel(v.id, { volume })}
                  />
                  <StoredNumberField
                    label={t("용기 개수", "Vessel count")}
                    value={v.count}
                    onChange={(count) => vessel(v.id, { count })}
                  />
                  <Select
                    label={t("목표 방식", "Target mode")}
                    value={v.mode}
                    onChange={(mode) =>
                      vessel(v.id, { mode: mode as StoredVessel["mode"] })
                    }
                    options={(
                      [
                        ["split", t("분할 비율 (1:N)", "Split ratio (1:N)")],
                        ["cells/mL", "cells/mL"],
                        ["cells/vessel", t("용기당 세포 수", "Cells per vessel")],
                        ["cells/cm2", "cells/cm²"],
                        ["confluence", "Confluence (%)"],
                      ] as const
                    ).filter(
                      ([mode]) =>
                        adherent || !["cells/cm2", "confluence"].includes(mode)
                    )}
                  />
                  <StoredNumberField
                    label={
                      v.mode === "split"
                        ? t("분할 비율 (1 : N)", "Split ratio (1 : N)")
                        : v.mode === "confluence"
                        ? t("목표 confluence (%)", "Target confluence (%)")
                        : t("목표값", "Target")
                    }
                    value={v.target}
                    onChange={(target) => vessel(v.id, { target })}
                  />
                </div>
                {preset && (
                  <p className="tool-muted tool-cells-note">
                    {t(
                      `${presetLabel(preset)} · 권장 배지 ${mediumRange(
                        preset
                      )} mL${preset.kind === "plate" ? " (웰당)" : ""}`,
                      `${presetLabel(preset)} · growth medium ${mediumRange(
                        preset
                      )} mL${preset.kind === "plate" ? " per well" : ""}`
                    )}
                    {preset.kind === "plate" &&
                      ` · ${t(
                        "용기 개수에는 분주할 웰 수를 입력하세요.",
                        "Enter the number of wells to seed as the vessel count."
                      )}`}
                  </p>
                )}
                <button onClick={() => removeVessel(v)}>
                  {t("용기 그룹 삭제", "Remove vessel group")}
                </button>
              </div>
            );
          })}
          <p className="tool-muted tool-cells-note">
            {t("용기 면적·배지 부피 출처", "Vessel areas and medium volumes from")}
            :{" "}
            <a href={VESSEL_SOURCE.url} target="_blank" rel="noopener noreferrer">
              {VESSEL_SOURCE.name}
            </a>
            {" · "}
            {t(
              "배지 부피가 범위로 제시된 용기는 상한값을 넣습니다. 제조사마다 조금씩 다르니 사용하는 용기에 맞게 고치세요.",
              "Where the table gives a range of medium volume, the top of the range is filled in. Makers differ slightly, so adjust the figures to your vessel."
            )}
          </p>
          <p className="tool-muted">
            {adherent
              ? t(
                  "Split: 보유 현탁액의 1/N을 용기당 배분합니다.",
                  "Split: 1/N of available suspension per vessel."
                )
              : t(
                  "Split: 용기당 최종 부피의 1/N을 원액으로 사용합니다.",
                  "Split: stock volume is 1/N of final volume per vessel."
                )}
          </p>
          <button
            onClick={() =>
              set({
                ...d,
                vessels: [
                  ...d.vessels,
                  {
                    id: crypto.randomUUID(),
                    name: "T-25",
                    area: 25,
                    volume: 5,
                    count: 1,
                    mode: "split",
                    target: 5,
                    preset: "t25",
                  },
                ],
                checked: [],
              })
            }
          >
            {t("용기 그룹 추가", "Add vessel group")}
          </button>
          <ErrorMessage message={result.error} />
          {result.incomplete && (
            <p className="tool-muted" role="status">
              {adherent
                ? t(
                    "세포 농도, 보유 부피, 용기별 값과 세포주 설정의 100% confluence 밀도를 모두 입력하면 계산합니다.",
                    "Enter the cell concentration, the available volume, every vessel field and the density at 100% confluence in the cell line profile to calculate."
                  )
                : t(
                    "세포 농도, 보유 부피, 용기별 값과 세포주 설정의 최대 밀도를 모두 입력하면 계산합니다.",
                    "Enter the cell concentration, the available volume, every vessel field and the maximum density in the cell line profile to calculate."
                  )}
            </p>
          )}
          {result.value && (
            <>
              <div className="tool-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t("용기", "Vessel")}</th>
                      <th>{t("용기당 세포 수", "Cells per vessel")}</th>
                      <th>
                        {t(
                          "원액 / 배지 (용기당 mL)",
                          "Stock / medium (mL per vessel)"
                        )}
                      </th>
                      <th>{t("예상 confluence", "Expected confluence")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.value.rows.map((v) => (
                      <tr key={v.id}>
                        <td>
                          {v.name} ×{v.count}
                        </td>
                        <td>{format(v.cells)}</td>
                        <td>
                          {format(v.stock)} / {format(v.medium)}
                        </td>
                        <td>
                          {v.confluence == null
                            ? "—"
                            : `${format(v.confluence)}%`}
                          <ErrorMessage message={v.warning} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Result>
                {t("전체 필요 원액", "Total stock")}:{" "}
                {format(result.value.stockTotal)} mL{"\n"}
                {t("전체 배지", "Total medium")}:{" "}
                {format(result.value.mediumTotal)} mL
              </Result>
              <ErrorMessage
                message={
                  result.value.insufficient
                    ? t("보유 원액이 부족합니다.", "Insufficient stock.")
                    : ""
                }
              />
              {result.value.rows.map((v) => (
                <label key={v.id}>
                  <input
                    type="checkbox"
                    checked={d.checked.includes(v.id)}
                    disabled={!result.value?.valid}
                    onChange={(e) =>
                      set({
                        ...d,
                        checked: e.target.checked
                          ? [...d.checked, v.id]
                          : d.checked.filter((id) => id !== v.id),
                      })
                    }
                  />
                  {v.name} ×{v.count} {t("분주 완료", "Dispensed")}
                </label>
              ))}
            </>
          )}
        </Panel>
      </details>
    </>
  );
}

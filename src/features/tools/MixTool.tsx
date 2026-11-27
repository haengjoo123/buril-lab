import { useContext } from "react";
import { X } from "lucide-react";
import {
  ToolContext,
  useToolData,
  useText,
  Panel,
  Field,
  Select,
  ErrorMessage,
  calculate,
  need,
  IncompleteInput,
  format,
  plainNumber,
  csv,
  download,
  CheckButton,
  CopyButton,
  StoredNumberField,
  EmptyState,
  HandoffBanner,
  useUndo,
  useExportName,
} from "./ui";
import ReagentLookup from "./ReagentLookup";
import { BarList, ChartFrame, Meter, SegmentedBar, type Part } from "./charts";
import {
  amountUnits,
  ratioUnits,
  recipeUnits,
  recipeVolumeUnits,
  microlitres,
  mixFactor,
  reactionVolumes,
  readableMass,
  readableVolume,
  recipeAmount,
  recipeLitres,
  recipeScale,
  scaled,
  stockVolume,
  tidy,
} from "./mix";

type MixRow = {
  id: string;
  name: string;
  /**
   * Per reaction (master mix) or for the reference volume (medium). For a row
   * entered by concentration it holds what the concentration works out to,
   * see `withAmounts`.
   */
  amount: number | null;
  unit: string;
  checked: boolean;
  /** Absent in documents saved before a row could be entered by concentration. */
  mode?: "amount" | "concentration";
  stock?: number | null;
  final?: number | null;
  concUnit?: string;
  /** g/mol, for a final concentration in M or mM. */
  mw?: number | null;
  /** Master mix: added to each tube on its own, not to the mix. */
  perTube?: boolean;
};
type Step = { id: string; text: string; checked: boolean };
type MixData = {
  count: number | null;
  excess: number | null;
  /** µL; null while no reaction volume is set, and then nothing is filled up. */
  reactionVolume: number | null;
  fillChecked: boolean;
  baseVolume: number | null;
  targetVolume: number | null;
  volumeUnit: string;
  /** null until edited: the default steps in the app's language are shown. */
  steps: Step[] | null;
  rows: MixRow[];
};
type Cell = string | number;
type Marks = { rows: string[]; steps: string[]; fill: boolean };

const byConcentration = (row: MixRow) => row.mode === "concentration";
const blank = (value: unknown) => value == null || value === "";
const molar = (unit: string) => unit === "M" || unit === "mM";
const concUnitOf = (row: MixRow, medium: boolean) =>
  row.concUnit ?? (medium ? "g/L" : "X");
/** A recipe row's own concentration fields; the volume comes from the settings. */
const concentrationInputs = (row: MixRow) => {
  const unit = concUnitOf(row, true);
  return {
    unit,
    final: need(row.final),
    mw: molar(unit) ? need(row.mw) : null,
    stock: unit === "X" ? need(row.stock) : null,
  };
};
const rowBlank = (row: MixRow, medium: boolean) => {
  if (!byConcentration(row)) return blank(row.amount);
  const unit = concUnitOf(row, medium);
  return (
    blank(row.final) ||
    ((!medium || unit === "X") && blank(row.stock)) ||
    (medium && molar(unit) && blank(row.mw))
  );
};
/**
 * Builds of the app from before rows could be entered by concentration read
 * only `amount` and `unit`. A concentration row therefore keeps there what it
 * works out to (per reaction, or for the reference volume), so those builds
 * show the same quantity. While it cannot be worked out the amount is left as
 * it was: switching a row to concentration and back does not lose what was
 * typed.
 */
function withAmounts(d: MixData, medium: boolean): MixData {
  return {
    ...d,
    rows: d.rows.map((row) => {
      if (!byConcentration(row)) return row;
      const derived = calculate(() => {
        if (!medium)
          return {
            amount: stockVolume(
              need(row.stock),
              need(row.final),
              need(d.reactionVolume)
            ),
            unit: "µL",
          };
        const inputs = concentrationInputs(row);
        const made = recipeAmount(
          inputs.unit,
          inputs.final,
          recipeLitres(need(d.baseVolume), d.volumeUnit),
          inputs
        );
        return made.kind === "mass"
          ? { amount: made.grams, unit: "g" }
          : { amount: made.microlitres / 1000, unit: "mL" };
      }).value;
      return derived && Number.isFinite(derived.amount)
        ? { ...row, amount: tidy(derived.amount), unit: derived.unit }
        : row;
    }),
  };
}
const marksOf = (d: MixData): Marks => ({
  rows: d.rows.filter((row) => row.checked).map((row) => row.id),
  steps: (Array.isArray(d.steps) ? d.steps : [])
    .filter((step) => step.checked)
    .map((step) => step.id),
  fill: !!d.fillChecked,
});
const withoutMarks = (d: MixData, steps: boolean): MixData => ({
  ...d,
  rows: d.rows.map((row) => (row.checked ? { ...row, checked: false } : row)),
  fillChecked: false,
  steps:
    steps && Array.isArray(d.steps)
      ? d.steps.map((step) => ({ ...step, checked: false }))
      : d.steps,
});
const withMarks = (d: MixData, marks: Marks): MixData => ({
  ...d,
  rows: d.rows.map((row) =>
    marks.rows.includes(row.id) ? { ...row, checked: true } : row
  ),
  fillChecked: marks.fill || !!d.fillChecked,
  steps: Array.isArray(d.steps)
    ? d.steps.map((step) =>
        marks.steps.includes(step.id) ? { ...step, checked: true } : step
      )
    : d.steps,
});
const volumeText = (volume: number | null | undefined) => {
  if (volume == null) return "—";
  const { value, unit } = readableVolume(volume);
  return `${format(value)} ${unit}`;
};
/** The table as tab-separated text, without the columns no row uses. */
const tabbed = (table: Cell[][]) => {
  const used = table[0].map((_, column) =>
    table.slice(1).some((row) => row[column] !== "")
  );
  return table
    .map((row) =>
      row
        .filter((_, column) => used[column])
        .map((cell) => {
          if (typeof cell === "number") return plainNumber(cell);
          const text = cell.replace(/\s+/g, " ").trim();
          // A pasted name must not run as a spreadsheet formula; `csv()`
          // guards its cells the same way.
          return /^[=+\-@]/.test(text) &&
            !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text)
            ? `'${text}`
            : text;
        })
        .join("\t")
    )
    .join("\n");
};

export default function MixTool({ medium = false }: { medium?: boolean }) {
  const t = useText(),
    ctx = useContext(ToolContext);
  const defaults: MixData = {
    count: 1,
    excess: 10,
    reactionVolume: null,
    fillChecked: false,
    baseVolume: 100,
    targetVolume: 100,
    volumeUnit: "mL",
    steps: null,
    rows: [
      {
        id: "1",
        name: "",
        amount: 1,
        unit: medium ? "g" : "µL",
        checked: false,
      },
    ],
  };
  const [d, set] = useToolData<MixData>(defaults);
  const [undoBar, offerUndo] = useUndo();
  const exportName = useExportName();
  const commit = (change: (old: MixData) => MixData) =>
    set((old) => withAmounts(change(old), medium));
  const volumeUnit = d.volumeUnit === "L" ? "L" : "mL";
  const totalLabel = t("전체량", "Total");
  const doneLabel = t("완료", "Done");

  // ---- What each row comes to. A row is worked out on its own, so one
  // unfinished row does not blank the others; a row that waits on the
  // settings shows a dash and leaves the message to the settings.
  const settings = calculate(() => {
    const count = need(d.count),
      excess = need(d.excess);
    return { count, excess, factor: mixFactor(count, excess) };
  });
  const reactionError =
    d.reactionVolume != null && !(d.reactionVolume > 0)
      ? "Enter positive finite values"
      : "";
  const entries = (medium ? [] : d.rows).map((row) =>
    calculate(() => {
      if (byConcentration(row)) {
        const stock = need(row.stock),
          final = need(row.final);
        if (reactionError) throw new IncompleteInput();
        const amount = stockVolume(stock, final, need(d.reactionVolume));
        return { amount, unit: "µL", volume: amount as number | null };
      }
      const amount = scaled(need(row.amount), 1);
      return { amount, unit: row.unit, volume: microlitres(amount, row.unit) };
    })
  );
  const reaction = calculate(() => {
    if (reactionError) throw new IncompleteInput();
    return reactionVolumes(
      entries.map((entry, index) => {
        if (!entry.value) throw new IncompleteInput();
        return {
          volume: entry.value.volume,
          perTube: !!d.rows[index].perTube,
        };
      }),
      d.reactionVolume
    );
  });
  // One reaction as parts of a whole, for the composition bar: every row
  // keeps its place (and so its colour) even while it has no volume.
  const reactionParts: Part[] = [
    ...(medium ? [] : d.rows).map((row, index) => ({
      label: row.name.trim() || `${t("성분", "Component")} ${index + 1}`,
      value: reaction.value ? entries[index]?.value?.volume ?? 0 : 0,
    })),
    ...(reaction.value?.fill
      ? [
          {
            label: t("물 또는 버퍼", "Water or buffer"),
            value: reaction.value.fill,
            slot: "other" as const,
          },
        ]
      : []),
  ];
  const factor = settings.value?.factor ?? null;
  const mixTotal =
    reaction.value && factor != null ? reaction.value.dispense * factor : null;
  const fillTotal =
    reaction.value?.fill != null && factor != null
      ? reaction.value.fill * factor
      : null;

  const target = calculate(() =>
    recipeLitres(need(d.targetVolume), volumeUnit)
  );
  const scale = calculate(() =>
    recipeScale(need(d.baseVolume), need(d.targetVolume))
  );
  const recipe = (medium ? d.rows : []).map((row) =>
    calculate(() => {
      if (byConcentration(row)) {
        const inputs = concentrationInputs(row);
        if (target.value == null) throw new IncompleteInput();
        const made = recipeAmount(
          inputs.unit,
          inputs.final,
          target.value,
          inputs
        );
        return made.kind === "mass"
          ? readableMass(made.grams)
          : readableVolume(made.microlitres);
      }
      const amount = scaled(need(row.amount), 1);
      if (scale.value == null) throw new IncompleteInput();
      return { value: scaled(amount, scale.value), unit: row.unit };
    })
  );

  const shown = d.rows.map((row, index) => {
    const conc = byConcentration(row);
    if (medium) {
      const result = recipe[index];
      return {
        label: totalLabel,
        value: result.value?.value ?? null,
        unit: result.value?.unit ?? (conc ? "" : row.unit),
        note: "",
        error: result.error,
      };
    }
    const entry = entries[index];
    const unit = entry.value?.unit ?? (conc ? "µL" : row.unit);
    const note =
      conc && entry.value && !row.perTube
        ? `${t("반응당", "Per reaction")} ${format(entry.value.amount)} µL`
        : "";
    if (row.perTube)
      return {
        label: t("튜브당", "Per tube"),
        value: entry.value?.amount ?? null,
        unit,
        note,
        error: entry.error,
      };
    if (!entry.value || !settings.value)
      return {
        label: totalLabel,
        value: null,
        unit,
        note,
        error: entry.error,
      };
    const total = scaled(
      entry.value.amount,
      settings.value.count,
      settings.value.excess
    );
    return conc
      ? { label: totalLabel, ...readableVolume(total), note, error: "" }
      : { label: totalLabel, value: total, unit, note, error: "" };
  });
  // Messages about the settings sit under the settings, the ones about the
  // composition under the rows: on a phone the two are a screen apart.
  const settingErrors = [
    ...new Set(
      medium ? [scale.error, target.error] : [settings.error, reactionError]
    ),
  ].filter(Boolean);
  const mixError = medium ? "" : reaction.error;
  const ready =
    d.rows.length > 0 &&
    settingErrors.length === 0 &&
    !mixError &&
    shown.every((row) => row.value != null) &&
    (medium || (reaction.value != null && factor != null));
  const settingHints: string[] = [];
  if (medium) {
    if (
      blank(d.targetVolume) ||
      (blank(d.baseVolume) && d.rows.some((row) => !byConcentration(row)))
    )
      settingHints.push(
        t(
          "기준 제조량과 목표 제조량을 입력하세요.",
          "Enter the reference and target volumes."
        )
      );
  } else {
    if (blank(d.count) || blank(d.excess))
      settingHints.push(
        t(
          "반응 수와 여유량을 입력하세요.",
          "Enter the number of reactions and the overage."
        )
      );
    if (d.reactionVolume == null && d.rows.some(byConcentration))
      settingHints.push(
        t(
          "농도로 입력한 성분은 반응 부피를 입력해야 계산됩니다.",
          "Components entered by concentration need a reaction volume."
        )
      );
  }
  const rowHint = d.rows.some((row) => rowBlank(row, medium))
    ? t(
        "빈칸을 채우면 그 성분의 양이 계산됩니다.",
        "Fill in the empty fields to calculate those components."
      )
    : "";

  // ---- Changes
  const change = (id: string, patch: Partial<MixRow>) =>
    commit((old) => ({
      ...old,
      rows: old.rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    }));
  /**
   * A setting every amount depends on. Rows already marked done confirmed
   * amounts that are no longer the ones shown, so the marks are cleared; undo
   * puts back both the setting and the marks.
   */
  const changeSettings = (patch: Partial<MixData>) => {
    const keys = Object.keys(patch) as (keyof MixData)[];
    if (keys.every((key) => patch[key] === d[key])) return;
    const marks = marksOf(d);
    const marked = marks.rows.length > 0 || marks.fill;
    const previous = Object.fromEntries(
      keys.map((key) => [key, d[key]])
    ) as Partial<MixData>;
    commit((old) => ({
      ...(marked ? withoutMarks(old, false) : old),
      ...patch,
    }));
    if (marked)
      offerUndo(
        t(
          "양이 바뀌어 완료 표시를 지웠습니다.",
          "The amounts changed, so the Done marks were cleared."
        ),
        () => commit((old) => withMarks({ ...old, ...previous }, marks))
      );
  };
  const remove = (row: MixRow, index: number) => {
    commit((old) => ({
      ...old,
      rows: old.rows.filter((item) => item.id !== row.id),
    }));
    offerUndo(t("성분을 삭제했습니다.", "Component removed."), () =>
      commit((old) =>
        old.rows.some((item) => item.id === row.id)
          ? old
          : {
              ...old,
              rows: [
                ...old.rows.slice(0, index),
                row,
                ...old.rows.slice(index),
              ],
            }
      )
    );
  };
  const marks = marksOf(d);
  const resetMarks = () => {
    commit((old) => withoutMarks(old, true));
    offerUndo(
      t("완료 표시를 모두 지웠습니다.", "All Done marks cleared."),
      () => commit((old) => withMarks(old, marks))
    );
  };

  // ---- Saved work of this tool, as a source of compositions
  const saved = (ctx?.documents ?? [])
    .filter(
      (doc) => doc.tool_id === ctx?.doc.tool_id && doc.id !== ctx?.doc.id
    )
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const load = (id: string) => {
    const source = saved.find((doc) => doc.id === id);
    if (!source) return;
    const data = { ...defaults, ...source.data } as MixData;
    const copied: Partial<MixData> = {
      ...(medium
        ? {
            baseVolume: data.baseVolume,
            targetVolume: data.targetVolume,
            volumeUnit: data.volumeUnit,
            steps: Array.isArray(data.steps)
              ? data.steps.map((step) => ({ ...step, checked: false }))
              : null,
          }
        : {
            count: data.count,
            excess: data.excess,
            reactionVolume: data.reactionVolume,
          }),
      // A copy starts a new preparation: nothing in it has been added yet.
      rows: (Array.isArray(data.rows) ? data.rows : []).map((row) => ({
        ...row,
        id: crypto.randomUUID(),
        checked: false,
      })),
      fillChecked: false,
    };
    const previous = Object.fromEntries(
      (Object.keys(copied) as (keyof MixData)[]).map((key) => [key, d[key]])
    ) as Partial<MixData>;
    commit((old) => ({ ...old, ...copied }));
    offerUndo(
      t(
        `"${source.title}"의 조성을 불러왔습니다.`,
        `Loaded the composition of "${source.title}".`
      ),
      () => commit((old) => ({ ...old, ...previous }))
    );
  };

  // ---- Preparation steps (medium / buffer)
  const defaultSteps = (): Step[] => [
    {
      id: "dissolve",
      text: t(
        "최종 부피의 약 80% 용매에 성분을 녹이세요.",
        "Dissolve the components in about 80% of the final volume."
      ),
      checked: false,
    },
    { id: "ph", text: t("pH를 맞추세요.", "Adjust the pH."), checked: false },
    {
      id: "volume",
      text: t("최종 부피까지 채우세요.", "Bring to the final volume."),
      checked: false,
    },
    {
      id: "sterilise",
      text: t("멸균하거나 여과하세요.", "Sterilise or filter."),
      checked: false,
    },
  ];
  const steps = Array.isArray(d.steps) ? d.steps : defaultSteps();
  // How far the preparation has got: components weighed plus steps done.
  const prepared =
    d.rows.filter((row) => row.checked).length +
    steps.filter((step) => step.checked).length;
  const changeSteps = (next: (steps: Step[]) => Step[]) =>
    commit((old) => ({
      ...old,
      steps: next(Array.isArray(old.steps) ? old.steps : defaultSteps()),
    }));
  const changeStep = (id: string, patch: Partial<Step>) =>
    changeSteps((list) =>
      list.map((step) => (step.id === id ? { ...step, ...patch } : step))
    );
  const removeStep = (step: Step, index: number) => {
    changeSteps((list) => list.filter((item) => item.id !== step.id));
    offerUndo(t("단계를 삭제했습니다.", "Step removed."), () =>
      changeSteps((list) =>
        list.some((item) => item.id === step.id)
          ? list
          : [...list.slice(0, index), step, ...list.slice(index)]
      )
    );
  };

  // ---- Export
  const yes = (on: boolean | undefined) =>
    on ? t("예", "Yes") : t("아니요", "No");
  const table = (): Cell[][] => {
    if (medium)
      return [
        [
          t("성분", "Component"),
          totalLabel,
          t("단위", "Unit"),
          t("기준량", "Reference amount"),
          t("기준량 단위", "Reference unit"),
          t("최종 농도", "Final concentration"),
          t("농도 단위", "Concentration unit"),
          t("분자량 (g/mol)", "MW (g/mol)"),
          t("원액 (X)", "Stock (X)"),
          doneLabel,
        ],
        ...d.rows.map((row, index): Cell[] => {
          const conc = byConcentration(row),
            unit = concUnitOf(row, true);
          return [
            row.name,
            shown[index].value ?? "",
            shown[index].unit,
            conc ? "" : row.amount ?? "",
            conc ? "" : row.unit,
            conc ? row.final ?? "" : "",
            conc ? unit : "",
            conc && molar(unit) ? row.mw ?? "" : "",
            conc && unit === "X" ? row.stock ?? "" : "",
            yes(row.checked),
          ];
        }),
      ];
    const whole = mixTotal == null ? null : readableVolume(mixTotal),
      dispensed = reaction.value
        ? readableVolume(reaction.value.dispense)
        : null,
      fill =
        reaction.value?.fill != null && fillTotal != null
          ? {
              total: readableVolume(fillTotal),
              each: readableVolume(reaction.value.fill),
            }
          : null;
    return [
      [
        t("성분", "Component"),
        totalLabel,
        t("단위", "Unit"),
        t("반응당", "Per reaction"),
        t("반응당 단위", "Per-reaction unit"),
        t("원액 농도", "Stock concentration"),
        t("최종 농도", "Final concentration"),
        t("농도 단위", "Concentration unit"),
        t("반응별 개별 첨가", "Add per tube"),
        doneLabel,
      ],
      ...d.rows.map((row, index): Cell[] => {
        const conc = byConcentration(row),
          entry = entries[index].value;
        return [
          row.name,
          row.perTube ? "" : shown[index].value ?? "",
          row.perTube ? "" : shown[index].unit,
          entry?.amount ?? "",
          entry?.unit ?? "",
          conc ? row.stock ?? "" : "",
          conc ? row.final ?? "" : "",
          conc ? concUnitOf(row, false) : "",
          yes(row.perTube),
          yes(row.checked),
        ];
      }),
      ...(fill
        ? [
            [
              t("물(또는 버퍼)로 채움", "Fill to volume"),
              fill.total.value,
              fill.total.unit,
              fill.each.value,
              fill.each.unit,
              "",
              "",
              "",
              yes(false),
              yes(d.fillChecked),
            ],
          ]
        : []),
      [
        t("마스터 믹스 합계", "Master mix total"),
        whole?.value ?? "",
        whole?.unit ?? "",
        dispensed?.value ?? "",
        dispensed?.unit ?? "",
        "",
        "",
        "",
        "",
        "",
      ],
    ];
  };

  return (
    <>
      <Panel>
        {!medium && (
          <HandoffBanner
            accepts={["count"]}
            onApply={(handoff) => changeSettings({ count: handoff.value })}
          />
        )}
        {saved.length > 0 && (
          <div className="tool-mix-x-load">
            <Select
              label={t(
                "저장한 작업에서 조성 불러오기",
                "Load composition from saved work"
              )}
              value=""
              onChange={load}
              options={[
                "",
                ...saved.map((doc) => [doc.id, doc.title] as const),
              ]}
            />
          </div>
        )}
        <div className="tool-grid">
          {medium ? (
            <>
              <StoredNumberField
                label={t("기준 제조량", "Reference volume")}
                value={d.baseVolume}
                onChange={(baseVolume) => changeSettings({ baseVolume })}
              />
              <StoredNumberField
                label={t("목표 제조량", "Target volume")}
                value={d.targetVolume}
                onChange={(targetVolume) => changeSettings({ targetVolume })}
              />
              <Select
                label={t("부피 단위", "Volume unit")}
                value={volumeUnit}
                onChange={(unit) => changeSettings({ volumeUnit: unit })}
                options={recipeVolumeUnits}
              />
            </>
          ) : (
            <>
              <StoredNumberField
                label={t("반응 수", "Reactions")}
                value={d.count}
                onChange={(count) => changeSettings({ count })}
              />
              <StoredNumberField
                label={t("여유량 (%)", "Overage (%)")}
                value={d.excess}
                onChange={(excess) => changeSettings({ excess })}
              />
              <StoredNumberField
                label={t("반응 부피 (µL, 선택)", "Reaction volume (µL, optional)")}
                value={d.reactionVolume}
                onChange={(reactionVolume) =>
                  changeSettings({ reactionVolume })
                }
              />
            </>
          )}
        </div>
        {settingErrors.map((message) => (
          <ErrorMessage key={message} message={message} />
        ))}
        {settingHints.map((hint) => (
          <p className="tool-muted" role="status" key={hint}>
            {hint}
          </p>
        ))}
        {d.rows.length === 0 ? (
          <EmptyState title={t("성분이 없습니다", "No components yet")}>
            <p>
              {t(
                "성분을 추가해 조성을 만드세요.",
                "Add a component to build the composition."
              )}
            </p>
          </EmptyState>
        ) : (
          <div className="tool-mix-x-rows">
            {d.rows.map((row, index) => {
              const conc = byConcentration(row),
                concUnit = concUnitOf(row, medium),
                result = shown[index];
              return (
                <div
                  className={`tool-mix-x-row ${row.checked ? "done" : ""}`}
                  role="group"
                  aria-label={
                    row.name.trim() ||
                    `${t("성분", "Component")} ${index + 1}`
                  }
                  key={row.id}
                >
                  <Field
                    type="text"
                    label={t("성분명", "Component name")}
                    value={row.name}
                    onChange={(name) => change(row.id, { name })}
                  />
                  {!conc ? (
                    <div className="tool-mix-x-values">
                      <StoredNumberField
                        label={
                          medium
                            ? t("기준량", "Reference amount")
                            : t("반응당 양", "Per reaction")
                        }
                        value={row.amount}
                        onChange={(amount) => change(row.id, { amount })}
                      />
                      <Select
                        label={t("단위", "Unit")}
                        value={row.unit}
                        onChange={(unit) => change(row.id, { unit })}
                        options={amountUnits}
                      />
                    </div>
                  ) : medium ? (
                    <div
                      className={`tool-mix-x-values ${
                        molar(concUnit) || concUnit === "X" ? "extra" : ""
                      }`}
                    >
                      <StoredNumberField
                        label={t("최종 농도", "Final concentration")}
                        value={row.final}
                        onChange={(final) => change(row.id, { final })}
                      />
                      <Select
                        label={t("단위", "Unit")}
                        value={concUnit}
                        onChange={(unit) => change(row.id, { concUnit: unit })}
                        options={recipeUnits}
                      />
                      {molar(concUnit) && (
                        <StoredNumberField
                          label={t("분자량 (g/mol)", "MW (g/mol)")}
                          value={row.mw}
                          onChange={(mw) => change(row.id, { mw })}
                        />
                      )}
                      {concUnit === "X" && (
                        <StoredNumberField
                          label={t("원액 (X)", "Stock (X)")}
                          value={row.stock}
                          onChange={(stock) => change(row.id, { stock })}
                        />
                      )}
                    </div>
                  ) : (
                    <div className="tool-mix-x-values ratio">
                      <StoredNumberField
                        label={t("원액 농도", "Stock")}
                        value={row.stock}
                        onChange={(stock) => change(row.id, { stock })}
                      />
                      <StoredNumberField
                        label={t("최종 농도", "Final")}
                        value={row.final}
                        onChange={(final) => change(row.id, { final })}
                      />
                      <Select
                        label={t("단위", "Unit")}
                        value={concUnit}
                        onChange={(unit) => change(row.id, { concUnit: unit })}
                        options={ratioUnits}
                      />
                    </div>
                  )}
                  <div className="tool-mix-total">
                    <span>{result.label}</span>
                    <output>
                      {[format(result.value), result.unit]
                        .filter(Boolean)
                        .join(" ")}
                    </output>
                    {result.note && (
                      <small className="tool-mix-x-note">{result.note}</small>
                    )}
                  </div>
                  <div className="tool-mix-x-actions">
                    <CheckButton
                      checked={row.checked}
                      onChange={(checked) => change(row.id, { checked })}
                    >
                      {doneLabel}
                    </CheckButton>
                    <button
                      className="tool-mix-x-remove"
                      aria-label={`${t("성분 삭제", "Remove component")} ${
                        index + 1
                      }`}
                      onClick={() => remove(row, index)}
                    >
                      <X size={18} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="tool-mix-x-options">
                    <CheckButton
                      checked={conc}
                      onChange={(on) =>
                        change(
                          row.id,
                          on
                            ? { mode: "concentration", concUnit }
                            : { mode: "amount" }
                        )
                      }
                    >
                      {medium
                        ? t("최종 농도로 입력", "By final concentration")
                        : t("농도로 입력", "By concentration")}
                    </CheckButton>
                    {!medium && (
                      <CheckButton
                        checked={!!row.perTube}
                        onChange={(perTube) => change(row.id, { perTube })}
                      >
                        {t("반응별 개별 첨가", "Add per tube")}
                      </CheckButton>
                    )}
                    {medium && conc && molar(concUnit) && (
                      <ReagentLookup
                        onApply={(reagent) =>
                          commit((old) => ({
                            ...old,
                            rows: old.rows.map((item) =>
                              item.id === row.id
                                ? {
                                    ...item,
                                    mw: reagent.molecularWeight,
                                    name: item.name.trim()
                                      ? item.name
                                      : reagent.name,
                                  }
                                : item
                            ),
                          }))
                        }
                      />
                    )}
                  </div>
                  <ErrorMessage message={result.error} />
                </div>
              );
            })}
            {!medium && d.reactionVolume != null && !reactionError && (
              <div
                className={`tool-mix-x-row tool-mix-x-fill ${
                  d.fillChecked ? "done" : ""
                }`}
                role="group"
                aria-label={t("물(또는 버퍼)로 채움", "Fill to volume")}
              >
                <div className="tool-mix-x-fill-name">
                  <strong>{t("물(또는 버퍼)로 채움", "Fill to volume")}</strong>
                  <span className="tool-muted">
                    {t(
                      "반응 부피에서 성분 부피를 뺀 양입니다.",
                      "Water or buffer: the reaction volume minus the components."
                    )}
                  </span>
                </div>
                <div className="tool-mix-total">
                  <span>{totalLabel}</span>
                  <output>{volumeText(fillTotal)}</output>
                  <small className="tool-mix-x-note">
                    {t("반응당", "Per reaction")}{" "}
                    {volumeText(reaction.value?.fill)}
                  </small>
                </div>
                <div className="tool-mix-x-actions">
                  <CheckButton
                    checked={!!d.fillChecked}
                    onChange={(fillChecked) =>
                      commit((old) => ({ ...old, fillChecked }))
                    }
                  >
                    {doneLabel}
                  </CheckButton>
                </div>
              </div>
            )}
          </div>
        )}
        {!medium && d.rows.length > 0 && (
          <>
            <dl className="tool-mix-x-summary">
              <div>
                <dt>{t("반응당 합계", "Total per reaction")}</dt>
                <dd>{volumeText(reaction.value?.perReaction)}</dd>
              </div>
              <div>
                <dt>{t("마스터 믹스 전체", "Master mix total")}</dt>
                <dd>{volumeText(mixTotal)}</dd>
              </div>
              <div>
                <dt>{t("튜브당 분주량", "Dispense per tube")}</dt>
                <dd>{volumeText(reaction.value?.dispense)}</dd>
              </div>
              {!!reaction.value?.perTube && (
                <div>
                  <dt>{t("튜브별 개별 첨가", "Added per tube")}</dt>
                  <dd>{volumeText(reaction.value.perTube)}</dd>
                </div>
              )}
            </dl>
            {/* What one reaction is made of. Blank or mass-only rows have no
                volume to draw; the fill is the neutral block. */}
            {reaction.value && reaction.value.perReaction > 0 && (
              <ChartFrame
                title={t("반응 한 번의 구성", "What one reaction is made of")}
                note={volumeText(reaction.value.perReaction)}
                table={{
                  headers: [t("성분", "Component"), t("반응당", "Per reaction")],
                  rows: reactionParts.map((part) => [
                    part.label,
                    volumeText(part.value),
                  ]),
                }}
              >
                {reactionParts.length <= 7 ? (
                  <SegmentedBar
                    label={t(
                      "반응 한 번의 성분별 부피",
                      "Volume of each component in one reaction"
                    )}
                    text={volumeText}
                    parts={reactionParts}
                  />
                ) : (
                  // More components than colours that can be told apart.
                  <BarList
                    label={t(
                      "반응 한 번의 성분별 부피",
                      "Volume of each component in one reaction"
                    )}
                    text={volumeText}
                    rows={reactionParts.map((part) => ({
                      label: part.label,
                      value: part.value,
                      muted: part.slot === "other",
                    }))}
                  />
                )}
              </ChartFrame>
            )}
            {entries.some((entry) => entry.value?.volume === null) && (
              <p className="tool-muted">
                {t(
                  "g·mg·µg 성분은 부피 합계에 넣지 않습니다.",
                  "Components in g, mg or µg are not counted in the volumes."
                )}
              </p>
            )}
          </>
        )}
        <ErrorMessage message={mixError} />
        {rowHint && (
          <p className="tool-muted" role="status">
            {rowHint}
          </p>
        )}
        <div className="tool-actions">
          <button
            onClick={() =>
              commit((old) => ({
                ...old,
                rows: [
                  ...old.rows,
                  {
                    id: crypto.randomUUID(),
                    name: "",
                    amount: null,
                    unit: medium ? "g" : "µL",
                    checked: false,
                  },
                ],
              }))
            }
          >
            {t("성분 추가", "Add component")}
          </button>
          <button
            disabled={
              marks.rows.length === 0 && marks.steps.length === 0 && !marks.fill
            }
            onClick={resetMarks}
          >
            {t("완료 표시 모두 지우기", "Reset all checks")}
          </button>
          <button
            disabled={!ready}
            onClick={() =>
              void download(csv(table()), exportName("csv"), "text/csv")
            }
          >
            CSV
          </button>
          {ready && (
            <CopyButton text={() => tabbed(table())}>
              {t("표 복사", "Copy table")}
            </CopyButton>
          )}
        </div>
      </Panel>
      {medium && (
        <Panel title={t("제조 단계", "Preparation steps")}>
          {d.rows.length + steps.length > 0 && (
            <ChartFrame title={t("제조 진행", "Preparation progress")}>
              <Meter
                label={t("완료한 성분과 단계", "Components and steps done")}
                value={prepared}
                max={d.rows.length + steps.length}
                text={`${prepared} / ${d.rows.length + steps.length}`}
                tone={
                  prepared === d.rows.length + steps.length ? "good" : "accent"
                }
              />
            </ChartFrame>
          )}
          <ol className="tool-mix-x-steps">
            {steps.map((step, index) => (
              <li key={step.id} className={step.checked ? "done" : ""}>
                <CheckButton
                  checked={step.checked}
                  onChange={(checked) => changeStep(step.id, { checked })}
                >
                  <span className="sr-only">
                    {t(`단계 ${index + 1} 완료`, `Step ${index + 1} done`)}
                  </span>
                </CheckButton>
                <textarea
                  rows={2}
                  aria-label={t(`단계 ${index + 1}`, `Step ${index + 1}`)}
                  value={step.text}
                  onChange={(event) =>
                    changeStep(step.id, { text: event.target.value })
                  }
                />
                <button
                  className="tool-mix-x-remove"
                  aria-label={t(
                    `단계 ${index + 1} 삭제`,
                    `Remove step ${index + 1}`
                  )}
                  onClick={() => removeStep(step, index)}
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ol>
          {target.value != null && d.targetVolume != null && (
            <p className="tool-muted">
              {t("목표 제조량의 80%", "80% of the target volume")}:{" "}
              {format(tidy(d.targetVolume * 0.8))} {volumeUnit}
            </p>
          )}
          <div className="tool-actions">
            <button
              onClick={() =>
                changeSteps((list) => [
                  ...list,
                  { id: crypto.randomUUID(), text: "", checked: false },
                ])
              }
            >
              {t("단계 추가", "Add step")}
            </button>
          </div>
        </Panel>
      )}
      {undoBar && <div className="tool-mix-x-undo">{undoBar}</div>}
    </>
  );
}

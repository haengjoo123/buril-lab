import {
  useToolData,
  useText,
  Panel,
  Field,
  Select,
  ErrorMessage,
  calculate,
  format,
  csv,
  download,
  CheckButton,
} from "./ui";
import { mixAmounts } from "./labMath";
type MixRow = {
  id: string;
  name: string;
  amount: number;
  unit: string;
  checked: boolean;
};
export default function MixTool({ medium = false }: { medium?: boolean }) {
  const t = useText();
  const [d, set] = useToolData({
    count: 1,
    excess: 10,
    baseVolume: 100,
    targetVolume: 100,
    rows: [
      {
        id: "1",
        name: "",
        amount: 1,
        unit: medium ? "g" : "µL",
        checked: false,
      },
    ] as MixRow[],
  });
  const scale = medium ? d.targetVolume / d.baseVolume : d.count,
    excess = medium ? 0 : d.excess;
  // Settings that apply to every row are checked once. Each row is then
  // totalled on its own, so one unfinished row does not blank the others.
  const settings = calculate(() => {
    if (!medium && !Number.isInteger(d.count))
      throw Error("Reaction count must be an integer");
    return mixAmounts([], scale, excess);
  });
  const totals = d.rows.map((row) =>
    settings.value
      ? calculate(() => mixAmounts([row], scale, excess)[0].total)
      : { value: null, error: settings.error }
  );
  const error =
    settings.error || totals.find((total) => total.error)?.error || "";
  const change = (id: string, patch: Partial<MixRow>) =>
    set({
      ...d,
      rows: d.rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    });
  return (
    <>
      <Panel>
        <div className="tool-grid">
          {medium ? (
            <>
              <Field
                label={t("기준 제조량 (mL)", "Reference volume (mL)")}
                value={d.baseVolume}
                onChange={(v) => set({ ...d, baseVolume: Number(v) })}
              />
              <Field
                label={t("목표 제조량 (mL)", "Target volume (mL)")}
                value={d.targetVolume}
                onChange={(v) => set({ ...d, targetVolume: Number(v) })}
              />
            </>
          ) : (
            <>
              <Field
                label={t("반응 수", "Reactions")}
                step="1"
                min={1}
                value={d.count}
                onChange={(v) => set({ ...d, count: Number(v) })}
              />
              <Field
                label={t("여유량 (%)", "Overage (%)")}
                value={d.excess}
                onChange={(v) => set({ ...d, excess: Number(v) })}
              />
            </>
          )}
        </div>
        <div className="tool-mix-rows">
          {d.rows.map((row, index) => (
            <div
              className={`tool-mix-row ${row.checked ? "done" : ""}`}
              key={row.id}
            >
              <Field
                type="text"
                label={t("성분명", "Component name")}
                value={row.name}
                onChange={(name) => change(row.id, { name })}
              />
              <Field
                label={
                  medium
                    ? t("기준량", "Reference amount")
                    : t("반응당 양", "Per reaction")
                }
                min={0}
                value={row.amount}
                onChange={(value) => change(row.id, { amount: Number(value) })}
              />
              <Select
                label={t("단위", "Unit")}
                value={row.unit}
                onChange={(unit) => change(row.id, { unit })}
                options={["g", "mg", "µg", "mL", "µL"]}
              />
              <div className="tool-mix-total">
                <span>{t("전체량", "Total")}</span>
                <output>
                  {format(totals[index].value)} {row.unit}
                </output>
              </div>
              <div className="tool-mix-actions">
                {medium && (
                  <CheckButton
                    checked={row.checked}
                    onChange={(checked) => change(row.id, { checked })}
                  >
                    {t("완료", "Done")}
                  </CheckButton>
                )}
                <button
                  aria-label={`${t("성분 삭제", "Remove component")} ${
                    index + 1
                  }`}
                  onClick={() =>
                    set({
                      ...d,
                      rows: d.rows.filter((item) => item.id !== row.id),
                    })
                  }
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
        <ErrorMessage message={error} />
        <div className="tool-actions">
          <button
            onClick={() =>
              set({
                ...d,
                rows: [
                  ...d.rows,
                  {
                    id: crypto.randomUUID(),
                    name: "",
                    amount: 0,
                    unit: medium ? "g" : "µL",
                    checked: false,
                  },
                ],
              })
            }
          >
            {t("성분 추가", "Add component")}
          </button>
          <button
            disabled={!!error || d.rows.length === 0}
            onClick={() =>
              download(
                csv([
                  [
                    t("성분", "Component"),
                    t("전체량", "Total"),
                    t("단위", "Unit"),
                  ],
                  ...d.rows.map((row, index) => [
                    row.name,
                    totals[index].value ?? "",
                    row.unit,
                  ]),
                ]),
                medium ? "medium-buffer.csv" : "master-mix.csv",
                "text/csv"
              )
            }
          >
            CSV
          </button>
        </div>
      </Panel>
    </>
  );
}

import {
  useToolData,
  useText,
  Panel,
  Field,
  Select,
  Result,
  ErrorMessage,
  calculate,
  format,
  csv,
  download,
  CheckButton,
} from "./ui";
import { units, convertUnit } from "./units";
import { dilution, mixAmounts, cellCount } from "./labMath";
export function DilutionTool() {
  const t = useText();
  const [d, set] = useToolData({
    stock: "100",
    target: "10",
    volume: "10",
    stockUnit: "mM",
    targetUnit: "mM",
    volumeUnit: "mL",
    steps: "1",
    factor: "2",
  });
  const update = (k: keyof typeof d, v: string) => set({ ...d, [k]: v });
  const r = calculate(() =>
    dilution(
      Number(d.stock),
      convertUnit(Number(d.target), d.targetUnit, d.stockUnit),
      Number(d.volume),
      Number(d.steps),
      Number(d.factor)
    )
  );
  const concentrationUnits = Object.keys(units).filter((k) =>
    ["molar", "massConcentration"].includes(units[k].dimension)
  );
  return (
    <>
      <Panel>
        <div className="tool-quantity-grid">
          <div className="tool-quantity">
            <Field
              label={t("원액 농도", "Stock concentration")}
              value={d.stock}
              onChange={(v) => update("stock", v)}
            />
            <Select
              label={t("원액 단위", "Stock unit")}
              value={d.stockUnit}
              onChange={(stockUnit) =>
                set({
                  ...d,
                  stockUnit,
                  targetUnit:
                    units[stockUnit].dimension === units[d.targetUnit].dimension
                      ? d.targetUnit
                      : stockUnit,
                })
              }
              options={concentrationUnits}
            />
          </div>
          <div className="tool-quantity">
            <Field
              label={t("목표 농도", "Target concentration")}
              value={d.target}
              onChange={(v) => update("target", v)}
            />
            <Select
              label={t("목표 단위", "Target unit")}
              value={d.targetUnit}
              onChange={(v) => update("targetUnit", v)}
              options={concentrationUnits.filter(
                (key) => units[key].dimension === units[d.stockUnit].dimension
              )}
            />
          </div>
          <div className="tool-quantity">
            <Field
              label={t("최종 부피", "Final volume")}
              value={d.volume}
              onChange={(v) => update("volume", v)}
            />
            <Select
              label={t("부피 단위", "Volume unit")}
              value={d.volumeUnit}
              onChange={(v) => update("volumeUnit", v)}
              options={["L", "mL", "µL"]}
            />
          </div>
        </div>
        <details className="tool-guide">
          <summary>{t("연속 희석 설정", "Serial dilution settings")}</summary>
          <div className="tool-grid">
            <Field
              label={t("연속 희석 단계", "Serial steps")}
              value={d.steps}
              onChange={(v) => update("steps", v)}
            />
            <Field
              label={t("단계별 희석배수", "Dilution per step")}
              value={d.factor}
              onChange={(v) => update("factor", v)}
            />
          </div>
        </details>
        <ErrorMessage message={r.error} />
        {r.value && (
          <Result>
            {t("원액", "Stock")}: {format(r.value.stockVolume)} {d.volumeUnit}
            {"\n"}
            {t("희석액", "Diluent")}: {format(r.value.diluentVolume)}{" "}
            {d.volumeUnit}
            {"\n"}
            {t("희석배수", "Dilution factor")}: {format(r.value.factor)}
          </Result>
        )}
      </Panel>
      {r.value && Number(d.steps) > 1 && (
        <Panel title={t("연속 희석표", "Serial dilution")}>
          <p className="tool-muted">
            {t(
              "첫 단계는 위 목표 농도로 준비합니다. 이후 단계마다 이전 용액을 옮겨 희석합니다.",
              "Prepare step 1 at the target concentration. Transfer from the previous step for each following dilution."
            )}
          </p>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>{d.targetUnit}</th>
                <th>
                  {t("이전 용액", "Transfer")} ({d.volumeUnit})
                </th>
                <th>
                  {t("희석액", "Diluent")} ({d.volumeUnit})
                </th>
              </tr>
            </thead>
            <tbody>
              {r.value.series.map((row) => (
                <tr key={row.step}>
                  <td>{row.step}</td>
                  <td>
                    {format(
                      convertUnit(row.concentration, d.stockUnit, d.targetUnit)
                    )}
                  </td>
                  <td>
                    {row.step === 1
                      ? format(r.value!.stockVolume)
                      : format(row.transferVolume)}
                  </td>
                  <td>
                    {row.step === 1
                      ? format(r.value!.diluentVolume)
                      : format(row.diluentVolume)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </>
  );
}
export { default as MolarityTool } from "./MolarityTool";
export { default as UnitTool } from "./UnitTool";
type MixRow = {
  id: string;
  name: string;
  amount: number;
  unit: string;
  checked: boolean;
};
export function MixTool({ medium = false }: { medium?: boolean }) {
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
  const r = calculate(() => {
    if (!medium && !Number.isInteger(d.count))
      throw Error("Reaction count must be an integer");
    return mixAmounts(
      d.rows,
      medium ? d.targetVolume / d.baseVolume : d.count,
      medium ? 0 : d.excess
    );
  });
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
                  {format(r.value?.[index]?.total)} {row.unit}
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
        <ErrorMessage message={r.error} />
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
            disabled={!r.value}
            onClick={() =>
              download(
                csv([
                  [
                    t("성분", "Component"),
                    t("전체량", "Total"),
                    t("단위", "Unit"),
                  ],
                  ...r.value!.map((row) => [row.name, row.total, row.unit]),
                ]),
                "mix.csv",
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
export { default as CounterTool } from "./CounterTool";
export function CellCounterTool() {
  const t = useText();
  const [d, set] = useToolData({
    rows: [{ live: 0, dead: 0 }],
    factor: 2,
    volume: 0.0001,
  });
  const r = calculate(() =>
    cellCount(
      d.rows.map((r) => r.live),
      d.rows.map((r) => r.dead),
      d.factor,
      d.volume
    )
  );
  return (
    <Panel>
      <div className="tool-grid">
        <Field
          label={t("희석배수", "Dilution factor")}
          value={d.factor}
          onChange={(v) => set({ ...d, factor: Number(v) })}
        />
        <Field
          label={t("구획당 계수 부피 (mL)", "Counted volume per chamber (mL)")}
          value={d.volume}
          onChange={(v) => set({ ...d, volume: Number(v) })}
        />
      </div>
      {d.rows.map((row, i) => (
        <div className="tool-grid" key={i}>
          {(["live", "dead"] as const).map((k) => (
            <Field
              key={k}
              label={`${i + 1} · ${
                k === "live" ? t("생존", "Live") : t("사멸", "Dead")
              }`}
              value={row[k]}
              onChange={(v) =>
                set({
                  ...d,
                  rows: d.rows.map((r, j) =>
                    j === i ? { ...r, [k]: Number(v) } : r
                  ),
                })
              }
            />
          ))}
        </div>
      ))}
      <button
        onClick={() => set({ ...d, rows: [...d.rows, { live: 0, dead: 0 }] })}
      >
        {t("구획 추가", "Add chamber")}
      </button>
      <ErrorMessage message={r.error} />
      <Result>
        {format(r.value?.concentration)} cells/mL{"\n"}
        {t("생존율", "Viability")}: {format(r.value?.viability)}%
      </Result>
    </Panel>
  );
}

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
} from "./ui";
import { units, convertUnit } from "./units";
import { dilution } from "./labMath";
export default function DilutionTool() {
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
  // A cleared field is a value still to be entered, not a wrong one.
  const incomplete = [d.stock, d.target, d.volume].some(
    (value) => !String(value).trim()
  );
  const r = incomplete
    ? { value: null, error: "" }
    : calculate(() =>
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
        {incomplete && (
          <p className="tool-muted" role="status">
            {t(
              "원액 농도, 목표 농도, 최종 부피를 입력하면 계산됩니다.",
              "Enter the stock concentration, target concentration and final volume to calculate."
            )}
          </p>
        )}
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

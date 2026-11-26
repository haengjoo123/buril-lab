import { useState } from "react";
import {
  useToolData,
  useText,
  useExportName,
  Panel,
  Select,
  Result,
  ErrorMessage,
  NumberField,
  QuantityField,
  CopyButton,
  HandoffBanner,
  calculate,
  need,
  format,
  plainNumber,
  csv,
  download,
} from "./ui";
import ReagentLookup from "./ReagentLookup";
import {
  ChartFrame,
  ScaleLegend,
  SegmentedBar,
  TransferChain,
} from "./charts";
import { heatStep } from "./chartMath";
import { dilution } from "./labMath";
import {
  dilutionConcentrationUnits,
  dilutionSolves,
  dilutionVolumeUnits,
  foldUnit,
  targetUnitsFor,
  needsMolecularWeight,
  followStockUnit,
  convertConcentration,
  convertVolume,
  matchConcentrationUnit,
  solveDilution,
  pipettingAdvice,
  readableVolume,
  minimumPipetteVolume,
  type DilutionSolve,
} from "./dilution";

const empty = (value: unknown) => value == null || !String(value).trim();
/** A number inside a sentence or a copied table: as the screen shows it, without grouping. */
const plain = (value: number) => plainNumber(value, 7);

export default function DilutionTool() {
  const t = useText(),
    exportName = useExportName();
  const [d, set] = useToolData({
    stock: "100",
    target: "10",
    volume: "10",
    stockUnit: "mM",
    targetUnit: "mM",
    volumeUnit: "mL",
    steps: "1",
    factor: "2",
    // Added after the first release. Work saved before then opens with these
    // defaults, which give the result it always gave.
    solve: "stockVolume" as DilutionSolve,
    targetMode: "concentration" as "concentration" | "fold",
    fold: "10",
    stockVolume: "1",
    /** Empty follows the final volume's unit, as the result always did. */
    stockVolumeUnit: "",
    mw: "",
    /**
     * Concentrations are strengths ("10X"). A flag rather than a value of
     * `stockUnit`: builds from before it look that unit up in the unit table,
     * and with the flag they still show the same volumes.
     */
    strength: false,
  });
  // A received unit this tool does not have: the number was applied alone.
  const [unknownUnit, setUnknownUnit] = useState("");
  const solve = dilutionSolves.includes(d.solve) ? d.solve : "stockVolume";
  // "1 : N" stands in for the target concentration, so it exists only where
  // the target is an input.
  const byFold = solve !== "target" && d.targetMode === "fold";
  const stockUnit = d.strength ? foldUnit : d.stockUnit,
    targetUnits = targetUnitsFor(stockUnit),
    targetUnit = targetUnits.includes(d.targetUnit) ? d.targetUnit : stockUnit,
    stockVolumeUnit = d.stockVolumeUnit || d.volumeUnit,
    // Without a target unit the diluted concentration is in the stock's unit.
    shownTargetUnit = byFold ? stockUnit : targetUnit;
  const needsMw = !byFold && needsMolecularWeight(stockUnit, targetUnit);
  const withStockUnit = (old: typeof d, unit: string) =>
    unit === foldUnit
      ? { ...old, strength: true }
      : {
          ...old,
          strength: false,
          stockUnit: unit,
          targetUnit: followStockUnit(old.stockUnit, unit, old.targetUnit),
        };
  const solveLabels: Record<DilutionSolve, string> = {
    stockVolume: t("원액 부피", "Stock volume"),
    target: t("최종 농도", "Final concentration"),
    volume: t("최종 부피", "Final volume"),
  };
  // What the calculation reads in this mode, by the name the hint uses.
  const missing = (
    [
      [!byFold, t("원액 농도", "stock concentration"), d.stock],
      [
        solve !== "target" && !byFold,
        t("목표 농도", "target concentration"),
        d.target,
      ],
      [byFold, t("희석배수", "dilution fold"), d.fold],
      [solve !== "stockVolume", t("원액 부피", "stock volume"), d.stockVolume],
      [solve !== "volume", t("최종 부피", "final volume"), d.volume],
      [needsMw, t("분자량", "molecular weight"), d.mw],
    ] as const
  )
    .filter(([used, , value]) => used && empty(value))
    .map(([, name]) => name);
  const main = calculate(() => {
    const mw = needsMw ? need(d.mw) : undefined;
    const solved = solveDilution(solve, {
      stock: byFold && empty(d.stock) ? undefined : need(d.stock),
      target:
        solve === "target" || byFold
          ? undefined
          : convertConcentration(need(d.target), targetUnit, stockUnit, mw),
      fold: byFold ? need(d.fold) : undefined,
      stockVolume:
        solve === "stockVolume"
          ? undefined
          : convertVolume(need(d.stockVolume), stockVolumeUnit, d.volumeUnit),
      volume: solve === "volume" ? undefined : need(d.volume),
    });
    // Concentrations are worked out in the stock's unit and shown in the
    // target's. Without a stock concentration there is none to show.
    const shown = (concentration: number) =>
      solved.relative
        ? null
        : convertConcentration(concentration, stockUnit, shownTargetUnit, mw);
    const stockVolumeLitres = convertVolume(
        solved.stockVolume,
        d.volumeUnit,
        "L"
      ),
      advice = pipettingAdvice(
        stockVolumeLitres,
        convertVolume(solved.volume, d.volumeUnit, "L")
      );
    return {
      ...solved,
      shown,
      shownStockVolume: convertVolume(
        solved.stockVolume,
        d.volumeUnit,
        stockVolumeUnit
      ),
      shownTarget: shown(solved.target),
      stockVolumeMicrolitres: convertVolume(stockVolumeLitres, "L", "µL"),
      advice,
      intermediate:
        advice?.kind === "intermediate"
          ? shown(solved.stock / advice.fold)
          : null,
    };
  });
  const r = main.value;
  // The table is worked out apart from the single dilution, so a wrong step
  // count does not take the result above away.
  const serial =
    r && !empty(d.steps)
      ? calculate(() => {
          const steps = need(d.steps);
          if (steps === 1) return null;
          const plan = dilution(
            r.stock,
            r.target,
            r.volume,
            steps,
            need(d.factor)
          );
          return {
            ...plan,
            rows: plan.series.map((row): (string | number)[] => [
              row.step,
              r.shown(row.concentration) ??
                `1 : ${plain(r.stock / row.concentration)}`,
              row.transferVolume,
              row.diluentVolume,
              row.remainingVolume,
            ]),
          };
        })
      : null;
  const plan = serial?.value ?? null;
  // A tube's tint in the transfer diagram: its concentration's place between
  // the last tube and the stock. Each step divides by the same factor, so the
  // scale is logarithmic.
  const tintOf = (concentration: number) =>
    r && plan
      ? heatStep(
          Math.log10(concentration),
          Math.log10(plan.series[plan.series.length - 1].concentration),
          Math.log10(r.stock)
        )
      : null;
  const tableHeader = [
    "#",
    r?.relative ? t("희석배수", "Dilution") : shownTargetUnit,
    `${t("옮길 양", "Transfer")} (${d.volumeUnit})`,
    `${t("희석액", "Diluent")} (${d.volumeUnit})`,
    `${t("남는 양", "Left in tube")} (${d.volumeUnit})`,
  ];
  const tableExport = (): (string | number)[][] =>
    plan
      ? [
          tableHeader,
          ...plan.rows,
          [
            `${t("희석액 합계", "Total diluent")} (${d.volumeUnit})`,
            plan.totalDiluent,
          ],
          [
            `${t("1단계 원액", "Stock for step 1")} (${d.volumeUnit})`,
            plan.stockVolume,
          ],
        ]
      : [];
  let sentence = "";
  if (r) {
    const stockPart = `${plain(r.shownStockVolume)} ${stockVolumeUnit}`,
      diluentPart = `${plain(r.diluentVolume)} ${d.volumeUnit}`,
      result = `${plain(r.volume)} ${d.volumeUnit} (${
        r.shownTarget == null
          ? `1 : ${plain(r.fold)}`
          : `${plain(r.shownTarget)} ${shownTargetUnit}`
      })`;
    sentence = t(
      `원액 ${stockPart} + 희석액 ${diluentPart} → ${result}`,
      `${stockPart} stock + ${diluentPart} diluent → ${result}`
    );
  }
  const readable = (litres: number) => {
    const volume = readableVolume(litres);
    return `${format(volume.value)} ${volume.unit}`;
  };
  const minimum = `${format(
    convertVolume(minimumPipetteVolume, "L", "µL")
  )} µL`;
  const advice = r?.advice ?? null;
  let adviceText = "";
  if (advice?.kind === "larger-volume") {
    const least = readable(advice.minimumVolume);
    adviceText = t(
      `최종 부피를 ${least} 이상으로 늘리면 원액을 ${minimum} 이상 취할 수 있습니다.`,
      `Increase the final volume to at least ${least} to take ${minimum} of stock or more.`
    );
  } else if (advice) {
    const fold = format(advice.fold),
      take = readable(advice.takeVolume),
      diluent = readable(advice.diluentVolume),
      transfer = readable(advice.transferVolume),
      rest = readable(advice.finalDiluentVolume),
      strength =
        r?.intermediate == null
          ? ""
          : `${format(r.intermediate)} ${shownTargetUnit}`;
    // How the intermediate is made: in one step, or ten-fold at a time.
    const made = t(
      advice.steps === 1
        ? `먼저 원액 ${take}에 희석액 ${diluent}를 넣어`
        : `먼저 10배 희석(앞 용액 ${take} + 희석액 ${diluent})을 ${advice.steps}번 반복해`,
      advice.steps === 1
        ? `${take} stock + ${diluent} diluent`
        : `repeat a 10-fold dilution (${take} of the previous solution + ${diluent} diluent) ${advice.steps} times`
    );
    adviceText = t(
      `${made} ${fold}배 중간 희석액${
        strength && `(${strength})`
      }을 만들고, 그 ${transfer}에 희석액 ${rest}를 더하세요.`,
      `First make a ${fold}-fold intermediate dilution${
        strength && ` (${strength})`
      }: ${made}. Then add ${transfer} of it to ${rest} diluent.`
    );
  }
  // The unit of whichever quantity is the result.
  const resultUnit =
    solve === "stockVolume"
      ? stockVolumeUnit
      : solve === "target"
      ? targetUnit
      : d.volumeUnit;
  const changeVolumeUnit = (volumeUnit: string) =>
    set({
      ...d,
      volumeUnit,
      // A typed stock volume that was following this unit keeps its own.
      ...(solve !== "stockVolume" && !d.stockVolumeUnit
        ? { stockVolumeUnit: d.volumeUnit }
        : {}),
    });
  // X is the only choice beside an X stock, and is never stored as a unit.
  const changeTargetUnit = (unit: string) => {
    if (unit !== foldUnit) set({ ...d, targetUnit: unit });
  };
  const changeResultUnit = (unit: string) =>
    solve === "stockVolume"
      ? set({ ...d, stockVolumeUnit: unit })
      : solve === "target"
      ? changeTargetUnit(unit)
      : changeVolumeUnit(unit);
  return (
    <>
      <Panel>
        <HandoffBanner
          accepts={["concentration", "molecular-weight"]}
          onApply={(offer) => {
            if (offer.kind === "molecular-weight") {
              const grams =
                offer.unit.trim().toLowerCase() === "kda"
                  ? offer.value * 1000
                  : offer.value;
              set((old) => ({ ...old, mw: plainNumber(grams) }));
              return;
            }
            const unit = matchConcentrationUnit(offer.unit);
            set((old) => ({
              ...(unit ? withStockUnit(old, unit) : old),
              stock: plainNumber(offer.value),
            }));
            setUnknownUnit(unit ? "" : offer.unit.trim() || "—");
          }}
        />
        {unknownUnit && (
          <p className="tool-dilution-warning" role="status">
            {t(
              `가져온 값의 단위(${unknownUnit})는 이 도구에 없어 숫자만 넣었습니다. 원액 단위를 확인하세요.`,
              `The received unit (${unknownUnit}) is not available here, so only the number was applied. Check the stock unit.`
            )}
          </p>
        )}
        <fieldset className="tool-molarity-targets tool-dilution-choice">
          <legend>{t("계산할 값", "Solve for")}</legend>
          <div>
            {dilutionSolves.map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={solve === key}
                onClick={() => set({ ...d, solve: key })}
              >
                {solveLabels[key]}
              </button>
            ))}
          </div>
        </fieldset>
        {solve !== "target" && (
          <fieldset className="tool-molarity-targets tool-dilution-choice">
            <legend>{t("목표 지정 방식", "Target given as")}</legend>
            <div>
              {(
                [
                  ["concentration", t("농도", "Concentration")],
                  ["fold", t("희석배수 (1 : N)", "Fold (1 : N)")],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={byFold === (key === "fold")}
                  onClick={() => set({ ...d, targetMode: key })}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        <div className="tool-quantity-grid tool-dilution-inputs">
          <QuantityField
            label={
              byFold
                ? t("원액 농도 (선택)", "Stock concentration (optional)")
                : t("원액 농도", "Stock concentration")
            }
            value={d.stock}
            onChange={(stock) => {
              set({ ...d, stock });
              setUnknownUnit("");
            }}
            unit={stockUnit}
            units={dilutionConcentrationUnits}
            unitLabel={t("원액 단위", "Stock unit")}
            onUnit={(unit) => {
              set(withStockUnit(d, unit));
              setUnknownUnit("");
            }}
          />
          {solve !== "stockVolume" && (
            <QuantityField
              label={t("원액 부피", "Stock volume")}
              value={d.stockVolume}
              onChange={(stockVolume) => set({ ...d, stockVolume })}
              unit={stockVolumeUnit}
              units={dilutionVolumeUnits}
              unitLabel={t("원액 부피 단위", "Stock volume unit")}
              onUnit={(unit) => set({ ...d, stockVolumeUnit: unit })}
            />
          )}
          {solve !== "target" &&
            (byFold ? (
              <div className="tool-dilution-fold">
                <NumberField
                  label={t("희석배수 N (1 : N)", "Dilution fold N (1 : N)")}
                  value={d.fold}
                  onChange={(fold) => set({ ...d, fold })}
                />
                <p className="tool-muted">
                  {t(
                    "1 : 10은 원액 1에 희석액 9를 더해 전체가 10이 되는 10배 희석입니다.",
                    "1 : 10 is 1 part stock plus 9 parts diluent, 10 parts in total."
                  )}
                </p>
              </div>
            ) : (
              <QuantityField
                label={t("목표 농도", "Target concentration")}
                value={d.target}
                onChange={(target) => set({ ...d, target })}
                unit={targetUnit}
                units={targetUnits}
                unitLabel={t("목표 단위", "Target unit")}
                onUnit={changeTargetUnit}
              />
            ))}
          {solve !== "volume" && (
            <QuantityField
              label={t("최종 부피", "Final volume")}
              value={d.volume}
              onChange={(volume) => set({ ...d, volume })}
              unit={d.volumeUnit}
              units={dilutionVolumeUnits}
              unitLabel={t("최종 부피 단위", "Final volume unit")}
              onUnit={changeVolumeUnit}
            />
          )}
        </div>
        {(needsMw || !empty(d.mw)) && (
          <div className="tool-dilution-mw">
            <NumberField
              label={t("분자량 (g/mol)", "Molecular weight (g/mol)")}
              value={d.mw}
              onChange={(mw) => set({ ...d, mw })}
            />
            <p className="tool-muted">
              {needsMw
                ? t(
                    "몰농도와 질량농도 단위를 함께 쓰려면 분자량이 필요합니다.",
                    "A molecular weight is needed to combine molar and mass concentration units."
                  )
                : t(
                    "원액과 목표 단위가 몰농도와 질량농도로 서로 다를 때만 사용합니다.",
                    "Used only when one of the stock and target units is molar and the other is mass per volume."
                  )}
            </p>
            <ReagentLookup
              onApply={(reagent) =>
                set((old) => ({
                  ...old,
                  mw: plainNumber(reagent.molecularWeight),
                }))
              }
            />
          </div>
        )}
        <ErrorMessage message={main.error} />
        {main.incomplete && (
          <p className="tool-muted" role="status">
            {missing.length
              ? t(
                  `${missing.join(", ")} 값을 입력하면 계산됩니다.`,
                  `Enter the ${
                    missing.length > 1
                      ? `${missing.slice(0, -1).join(", ")} and ${missing.at(
                          -1
                        )}`
                      : missing[0]
                  } to calculate.`
                )
              : t(
                  "비어 있는 값을 입력하면 계산됩니다.",
                  "Fill in the empty fields to calculate."
                )}
          </p>
        )}
        <div className="tool-dilution-result">
          {r && (
            <Result>
              <strong>
                {solveLabels[solve]}:{" "}
                {format(
                  solve === "stockVolume"
                    ? r.shownStockVolume
                    : solve === "target"
                    ? r.shownTarget
                    : r.volume
                )}{" "}
                {resultUnit}
              </strong>
              {"\n"}
              {t("희석액", "Diluent")}: {format(r.diluentVolume)} {d.volumeUnit}
              {"\n"}
              {t("희석배수", "Dilution factor")}: {format(r.fold)}
              {byFold && r.shownTarget != null && (
                <>
                  {"\n"}
                  {t("최종 농도", "Final concentration")}:{" "}
                  {format(r.shownTarget)} {shownTargetUnit}
                </>
              )}
            </Result>
          )}
          <div className="tool-result-unit">
            <Select
              label={t("결과 단위", "Result unit")}
              value={resultUnit}
              onChange={changeResultUnit}
              options={solve === "target" ? targetUnits : dilutionVolumeUnits}
            />
          </div>
        </div>
        {r && (
          <ChartFrame
            title={t("최종 부피의 구성", "What the final volume is made of")}
            note={`${format(r.volume)} ${d.volumeUnit}`}
            table={{
              headers: [
                t("구성", "Part"),
                `${t("부피", "Volume")} (${d.volumeUnit})`,
              ],
              rows: [
                [t("원액", "Stock"), format(r.stockVolume)],
                [t("희석액", "Diluent"), format(r.diluentVolume)],
              ],
            }}
          >
            <SegmentedBar
              label={t(
                "최종 부피에서 원액과 희석액이 차지하는 부피",
                "Stock and diluent volumes in the final volume"
              )}
              text={(value) => `${format(value)} ${d.volumeUnit}`}
              parts={[
                { label: t("원액", "Stock"), value: r.stockVolume },
                {
                  label: t("희석액", "Diluent"),
                  value: r.diluentVolume,
                  slot: "other",
                },
              ]}
            />
          </ChartFrame>
        )}
        {r && (
          <div className="tool-dilution-sentence">
            <p>{sentence}</p>
            <CopyButton
              text={sentence}
              label={t("제조 방법 복사", "Copy instruction")}
            />
          </div>
        )}
        {r && advice && (
          <p className="tool-dilution-warning" role="status">
            {t(
              `취할 원액이 ${format(
                r.stockVolumeMicrolitres
              )} µL로 ${minimum}보다 적어 정확히 분주하기 어렵습니다.`,
              `The stock volume to take is ${format(
                r.stockVolumeMicrolitres
              )} µL, below ${minimum}, which is hard to pipette accurately.`
            )}{" "}
            {adviceText}
          </p>
        )}
        <details className="tool-guide">
          <summary>{t("연속 희석 설정", "Serial dilution settings")}</summary>
          <div className="tool-grid">
            <NumberField
              label={t("연속 희석 단계", "Serial steps")}
              value={d.steps}
              onChange={(steps) => set({ ...d, steps })}
            />
            <NumberField
              label={t("단계별 희석배수", "Dilution per step")}
              value={d.factor}
              onChange={(factor) => set({ ...d, factor })}
            />
          </div>
        </details>
        <ErrorMessage message={serial?.error ?? ""} />
        {serial?.incomplete && (
          <p className="tool-muted">
            {t(
              "단계별 희석배수를 입력하면 연속 희석표가 만들어집니다.",
              "Enter the dilution per step to build the serial dilution table."
            )}
          </p>
        )}
      </Panel>
      {plan && (
        <Panel title={t("연속 희석표", "Serial dilution")}>
          <p className="tool-muted">
            {t(
              "1단계는 위 결과대로 원액에서 만들고, 이후 단계는 바로 앞 단계 용액을 옮겨 희석합니다. 남는 양은 다음 단계로 옮긴 뒤 튜브에 남는 부피입니다.",
              "Make step 1 from the stock as calculated above, then transfer from the step before for each following dilution. Left in tube is the volume remaining after the next transfer is taken."
            )}
          </p>
          {/* Which tube feeds which: drawn for a row a bench rack can hold;
              a longer series is read from the table. */}
          {r && plan.series.length <= 12 && (
            <ChartFrame title={t("옮기는 순서", "Order of transfers")}>
              <TransferChain
                label={t(
                  "원액에서 마지막 튜브까지 옮기는 순서",
                  "Transfers from the stock to the last tube"
                )}
                source={{
                  title: t("원액", "Stock"),
                  value:
                    r.shown(r.stock) == null
                      ? undefined
                      : `${format(r.shown(r.stock))} ${shownTargetUnit}`,
                  step: tintOf(r.stock),
                }}
                steps={plan.series.map((row) => {
                  const value =
                      r.shown(row.concentration) == null
                        ? `1 : ${plain(r.stock / row.concentration)}`
                        : `${format(
                            r.shown(row.concentration)
                          )} ${shownTargetUnit}`,
                    moved = `${format(row.transferVolume)} ${d.volumeUnit}`,
                    added = `${format(row.diluentVolume)} ${d.volumeUnit}`;
                  return {
                    title: String(row.step),
                    value,
                    moved,
                    added: `+ ${added}`,
                    step: tintOf(row.concentration),
                    description: t(
                      `${row.step}단계: ${
                        row.step === 1 ? "원액" : `${row.step - 1}단계`
                      }에서 ${moved}를 옮기고 희석액 ${added}를 더해 ${value}`,
                      `Step ${row.step}: carry ${moved} from ${
                        row.step === 1 ? "the stock" : `step ${row.step - 1}`
                      }, add ${added} of diluent, giving ${value}`
                    ),
                  };
                })}
              />
              <ScaleLegend
                title={t("농도", "Concentration")}
                min={t("낮음", "Low")}
                max={t("높음", "High")}
              />
            </ChartFrame>
          )}
          <div className="tool-table-wrap">
            <table>
              <thead>
                <tr>
                  {tableHeader.map((heading) => (
                    <th key={heading} scope="col">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((row) => (
                  <tr key={row[0]}>
                    {row.map((cell, index) => (
                      <td key={tableHeader[index]}>
                        {typeof cell === "number" && index > 0
                          ? format(cell)
                          : cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="tool-dilution-totals">
            {t("희석액 합계", "Total diluent")}:{" "}
            <strong>
              {format(plan.totalDiluent)} {d.volumeUnit}
            </strong>
            {" · "}
            {t("1단계에 필요한 원액", "Stock for step 1")}:{" "}
            <strong>
              {format(plan.stockVolume)} {d.volumeUnit}
            </strong>
          </p>
          <div className="tool-actions">
            <button
              onClick={() =>
                download(csv(tableExport()), exportName("csv"), "text/csv")
              }
            >
              CSV
            </button>
            <CopyButton
              text={() =>
                tableExport()
                  .map((row) =>
                    row
                      .map((cell) =>
                        typeof cell === "number" ? plainNumber(cell) : cell
                      )
                      .join("\t")
                  )
                  .join("\n")
              }
            >
              {t("표 복사", "Copy table")}
            </CopyButton>
          </div>
        </Panel>
      )}
    </>
  );
}

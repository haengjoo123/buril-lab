import { useContext, useId } from "react";
import { X } from "lucide-react";
import ReagentLookup, { type Reagent } from "./ReagentLookup";
import { parseNumber } from "./format";
import {
  fromMolarityBase,
  molarityTargets,
  molarityUnits,
  molecularWeightText,
  pureMass,
  solveMolarity,
  storeMolecularWeight,
  toMolarityBase,
  type MolarityBasis,
  type MolarityTarget,
} from "./molarity";
import {
  ToolContext,
  useToolData,
  useText,
  ErrorMessage,
  CopyButton,
  HandoffBanner,
  calculate,
  need,
  format,
  plainNumber,
} from "./ui";

/** A number inside a sentence: as the screen shows it, without grouping. */
const plain = (value: number) => plainNumber(value, 7);

export default function MolarityTool() {
  const t = useText(),
    id = useId(),
    ctx = useContext(ToolContext);
  const [d, set] = useToolData({
    basis: "mass" as MolarityBasis,
    solve: "concentration" as MolarityTarget,
    mass: "1",
    massUnit: "g",
    mw: "58.44",
    volume: "1",
    volumeUnit: "L",
    concentration: "1",
    concentrationUnit: "M",
    amount: "1",
    amountUnit: "mmol",
    massConcentration: "1",
    massConcentrationUnit: "mg/mL",
    reagent: null as Reagent | null,
    // Added after the first release; work saved before then opens with these.
    // `mw` itself stays in g/mol whatever the unit (see storeMolecularWeight).
    mwUnit: "g/mol",
    mwTyped: "",
    purity: "100",
  });
  const basis = d.basis in molarityTargets ? d.basis : "mass";
  const target = molarityTargets[basis].includes(d.solve)
    ? d.solve
    : "concentration";
  const labels: Record<MolarityTarget, string> = {
    concentration: t("몰농도", "Molarity"),
    mass: t("질량", "Mass"),
    volume: t("최종 부피", "Final volume"),
    mw: t("분자량", "Molecular weight"),
    amount: t("몰수", "Amount"),
    massConcentration: t("질량농도", "Mass concentration"),
  };
  const purityLabel = t("순도", "Purity");
  const unitOf = (key: MolarityTarget) => {
    const unit = d[`${key}Unit`];
    return molarityUnits[key].includes(unit) ? unit : molarityUnits[key][0];
  };
  const mwText = molecularWeightText(d.mw, unitOf("mw"), d.mwTyped);
  // The text in each field, in that field's unit.
  const valueOf = (key: MolarityTarget) => (key === "mw" ? mwText : d[key]);
  const required = molarityTargets[basis].filter((key) => key !== target);
  // Purity belongs to a weighed mass, so only the mass basis asks for it.
  const weighed = basis === "mass";
  const missing = [
    ...required.filter((key) => !valueOf(key).trim()).map((key) => labels[key]),
    ...(weighed && !d.purity.trim() ? [purityLabel] : []),
  ];
  const result = calculate(() => {
    // Each quantity of this basis in the unit on screen (the inputs as they
    // were typed, the result as calculated) and in the engine's base unit.
    const quantity = {} as Record<MolarityTarget, number>,
      values = {} as Record<MolarityTarget, number>;
    for (const key of required) {
      quantity[key] = need(valueOf(key));
      values[key] = toMolarityBase(key, quantity[key], unitOf(key));
    }
    const purity = weighed ? need(d.purity) : 100;
    const base = solveMolarity(basis, target, values, purity);
    const shown = fromMolarityBase(target, base, unitOf(target));
    quantity[target] = shown;
    return {
      base,
      shown,
      purity,
      quantity,
      pure: weighed && purity !== 100 ? pureMass(quantity.mass, purity) : null,
    };
  });
  const r = result.value;
  const list = (names: string[]) =>
    names.length > 1
      ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
      : names.join("");
  const corrected = weighed && (parseNumber(d.purity) ?? 100) !== 100;
  const purityTerm = t("순도", "purity");
  const formula =
    basis === "amount"
      ? target === "amount"
        ? "n = C × V"
        : target === "volume"
        ? "V = n / C"
        : "C = n / V"
      : basis === "massConcentration"
      ? target === "massConcentration"
        ? "ρ = C × MW"
        : target === "mw"
        ? "MW = ρ / C"
        : "C = ρ / MW"
      : corrected
      ? target === "mass"
        ? `m = C × MW × V / ${purityTerm}`
        : target === "volume"
        ? `V = m × ${purityTerm} / (C × MW)`
        : target === "mw"
        ? `MW = m × ${purityTerm} / (C × V)`
        : `C = m × ${purityTerm} / (MW × V)`
      : target === "mass"
      ? "m = C × MW × V"
      : target === "volume"
      ? "V = m / (C × MW)"
      : target === "mw"
      ? "MW = m / (C × V)"
      : "C = m / (MW × V)";
  // A unit change keeps the number that was typed; the result follows.
  const changeUnit = (key: MolarityTarget, unit: string) =>
    set({
      ...d,
      [`${key}Unit`]: unit,
      // The same number is another weight now, not the linked reagent's.
      ...(key === "mw"
        ? { ...storeMolecularWeight(mwText, unit), reagent: null }
        : {}),
    });
  const withUnit = (key: MolarityTarget) =>
    r ? `${plain(r.quantity[key])} ${unitOf(key)}` : "";
  const name = d.reagent?.name ?? "";
  // How to make the solution, for the bases that describe making one.
  let sentence = "";
  if (r && weighed && r.quantity.mass > 0) {
    const impure = r.purity !== 100;
    const what = [
      impure ? `순도 ${plain(r.purity)}%` : "",
      name || (impure ? "시약" : ""),
    ]
      .filter(Boolean)
      .join(" ");
    sentence = t(
      `${what && `${what} `}${withUnit("mass")}을 달아 최종 부피 ${withUnit(
        "volume"
      )}가 되도록 녹입니다. (${withUnit("concentration")})`,
      `Weigh ${withUnit("mass")}${name && ` of ${name}`}${
        impure ? ` (${plain(r.purity)}% purity)` : ""
      } and dissolve to a final volume of ${withUnit("volume")} (${withUnit(
        "concentration"
      )}).`
    );
  } else if (r && basis === "amount" && r.quantity.amount > 0)
    sentence = t(
      `${withUnit("amount")}을 최종 부피 ${withUnit(
        "volume"
      )}가 되도록 녹입니다. (${withUnit("concentration")})`,
      `Dissolve ${withUnit("amount")} to a final volume of ${withUnit(
        "volume"
      )} (${withUnit("concentration")}).`
    );
  // Every basis has a molar concentration, typed or calculated.
  const molar = r ? r.quantity.concentration : null;

  return (
    <div className="tool-molarity">
      <HandoffBanner
        accepts={["molecular-weight"]}
        onApply={(offer) => {
          const kilodaltons = offer.unit.trim().toLowerCase() === "kda",
            mwUnit = kilodaltons ? "kDa" : "g/mol";
          set((old) => {
            // The weight is an input from here on, on a basis that uses one.
            const nextBasis = old.basis === "amount" ? "mass" : old.basis;
            return {
              ...old,
              basis: nextBasis,
              solve:
                old.solve === "mw" ||
                !molarityTargets[nextBasis]?.includes(old.solve)
                  ? "concentration"
                  : old.solve,
              ...storeMolecularWeight(plainNumber(offer.value), mwUnit),
              mwUnit,
              reagent: {
                name: offer.label,
                molecularWeight: kilodaltons ? offer.value * 1000 : offer.value,
              },
            };
          });
        }}
      />
      <div
        className="tool-molarity-bases"
        role="group"
        aria-label={t("계산 기준", "Calculation basis")}
      >
        {(
          [
            ["mass", t("질량으로", "From mass")],
            ["amount", t("몰수로", "From moles")],
            ["massConcentration", t("질량농도로", "From concentration")],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            aria-pressed={basis === key}
            onClick={() =>
              set({
                ...d,
                basis: key,
                solve: molarityTargets[key].includes(target)
                  ? target
                  : "concentration",
              })
            }
          >
            {label}
          </button>
        ))}
      </div>
      <div className="tool-molarity-layout">
        <section className="tool-molarity-inputs">
          <fieldset className="tool-molarity-targets">
            <legend>{t("계산할 값", "Solve for")}</legend>
            <div>
              {molarityTargets[basis].map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={target === key}
                  onClick={() => set({ ...d, solve: key })}
                >
                  {labels[key]}
                </button>
              ))}
            </div>
          </fieldset>
          <p className="tool-molarity-formula">{formula}</p>
          <div className="tool-molarity-fields">
            {required.map((key) => (
              <div className="tool-molarity-quantity" key={key}>
                <label htmlFor={`${id}-${key}`}>
                  <span>{labels[key]}</span>
                </label>
                <div className="tool-molarity-control">
                  <input
                    id={`${id}-${key}`}
                    className="tool-molarity-number"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    aria-invalid={
                      valueOf(key).trim() !== "" &&
                      parseNumber(valueOf(key)) == null
                    }
                    value={valueOf(key)}
                    onChange={(event) =>
                      set({
                        ...d,
                        ...(key === "mw"
                          ? {
                              ...storeMolecularWeight(
                                event.target.value,
                                unitOf("mw")
                              ),
                              reagent: null,
                            }
                          : { [key]: event.target.value }),
                      })
                    }
                  />
                  <select
                    aria-label={`${labels[key]} ${t("단위", "unit")}`}
                    value={unitOf(key)}
                    onChange={(event) => changeUnit(key, event.target.value)}
                  >
                    {molarityUnits[key].map((unit) => (
                      <option key={unit}>{unit}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
            {weighed && (
              <div className="tool-molarity-quantity">
                <label htmlFor={`${id}-purity`}>
                  <span>{purityLabel}</span>
                </label>
                <div className="tool-molarity-control">
                  <input
                    id={`${id}-purity`}
                    className="tool-molarity-number"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    aria-invalid={
                      d.purity.trim() !== "" && parseNumber(d.purity) == null
                    }
                    value={d.purity}
                    onChange={(event) =>
                      set({ ...d, purity: event.target.value })
                    }
                  />
                  <span className="tool-molarity-fixed-unit">%</span>
                </div>
              </div>
            )}
          </div>
          {basis !== "massConcentration" && (
            <p className="tool-muted tool-molarity-volume-note">
              {t(
                "부피는 용매 첨가량이 아닌 최종 용액 부피입니다.",
                "Use the final solution volume after dissolving the solute."
              )}
            </p>
          )}
          {weighed && (
            <p className="tool-muted tool-molarity-volume-note">
              {t(
                "수화물은 라벨에 인쇄된 화학식량(FW)을 분자량으로 입력하면 결정수가 반영됩니다.",
                "For a hydrate, enter the formula weight (FW) printed on the label as the molecular weight; it includes the water."
              )}
            </p>
          )}
          {basis !== "amount" && target !== "mw" && (
            <ReagentLookup
              onApply={(reagent) =>
                set((old) => ({
                  ...old,
                  mw: plainNumber(reagent.molecularWeight),
                  mwUnit: "g/mol",
                  mwTyped: "",
                  reagent,
                }))
              }
            />
          )}
          {d.reagent && basis !== "amount" && target !== "mw" && (
            <div className="tool-molarity-selected">
              <div>
                <strong>{d.reagent.name}</strong>
                <span>
                  {[d.reagent.molecularFormula, d.reagent.casNumber]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              <button
                aria-label={t("시약 연결 해제", "Unlink reagent")}
                onClick={() => set({ ...d, reagent: null })}
              >
                <X size={16} />
              </button>
            </div>
          )}
        </section>
        <section
          className="tool-molarity-result"
          aria-label={t("계산 결과", "Calculation result")}
        >
          <div className="tool-molarity-result-heading tool-molarity-heading">
            <h2>{labels[target]}</h2>
            {r && (
              <CopyButton
                text={`${plainNumber(r.shown)} ${unitOf(target)}`}
                label={t("결과 복사", "Copy result")}
              />
            )}
          </div>
          <div className="tool-molarity-answer">
            <output aria-label={t("계산 결과", "Calculation result")}>
              {r ? format(r.shown) : "—"}
            </output>
            <select
              aria-label={t("결과 단위", "Result unit")}
              value={unitOf(target)}
              onChange={(event) => changeUnit(target, event.target.value)}
            >
              {molarityUnits[target].map((unit) => (
                <option key={unit}>{unit}</option>
              ))}
            </select>
          </div>
          <ErrorMessage message={result.error} />
          {result.incomplete && (
            <p className="tool-muted" role="status">
              {t(
                `${missing.join(", ")} 값을 입력하면 바로 계산됩니다.`,
                `Enter the ${list(
                  missing.map((label) => label.toLowerCase())
                )} to calculate instantly.`
              )}
            </p>
          )}
          {r?.pure != null && (
            <p className="tool-muted tool-molarity-note">
              {t(
                `순도 ${format(r.purity)}% 반영 · 순수 용질 ${format(
                  r.pure
                )} ${unitOf("mass")}`,
                `Corrected for ${format(
                  r.purity
                )}% purity · pure solute ${format(r.pure)} ${unitOf("mass")}`
              )}
            </p>
          )}
          {r && (
            <dl className="tool-molarity-equivalents">
              {molarityUnits[target]
                .filter((unit) => unit !== unitOf(target))
                .map((unit) => (
                  <div key={unit}>
                    <dt>{unit}</dt>
                    <dd>{format(fromMolarityBase(target, r.base, unit))}</dd>
                  </div>
                ))}
            </dl>
          )}
          {sentence && (
            <div className="tool-molarity-sentence">
              <p>{sentence}</p>
              <CopyButton
                text={sentence}
                label={t("제조 방법 복사", "Copy instruction")}
              />
            </div>
          )}
          {ctx?.sendTo && molar != null && molar > 0 && (
            <div className="tool-actions">
              <button
                onClick={() =>
                  ctx.sendTo?.("dilution", {
                    kind: "concentration",
                    value: Number(plainNumber(molar)),
                    unit: unitOf("concentration"),
                    label: name || labels.concentration,
                    source: "molarity",
                  })
                }
              >
                {t("이 용액을 희석", "Dilute this solution")}
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

import { useId, useRef, useState } from "react";
import { Check, ChevronDown, Copy, Search, X } from "lucide-react";
import { searchChemical } from "../../services/searchService";
import type { Chemical } from "../../types";
import { convertUnit } from "./units";
import {
  molarityBaseUnits,
  molarityTargets,
  molarityUnits,
  solveMolarity,
  type MolarityBasis,
  type MolarityTarget,
} from "./molarity";
import { useToolData, useText, ErrorMessage, calculate, format } from "./ui";

type Reagent = Pick<Chemical, "name" | "casNumber" | "molecularFormula"> & {
  molecularWeight: number;
};
export default function MolarityTool() {
  const t = useText();
  const id = useId();
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
    query: "",
    reagent: null as Reagent | null,
    recentReagents: [] as Reagent[],
  });
  const [found, setFound] = useState<Reagent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [copyError, setCopyError] = useState("");
  const request = useRef(0);
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
  const valueOf = (key: MolarityTarget) => d[key];
  const unitOf = (key: MolarityTarget) =>
    key === "mw" ? "g/mol" : d[`${key}Unit`];
  const required = molarityTargets[basis].filter((key) => key !== target);
  const missing = required.some((key) => !valueOf(key).trim());
  const result = calculate(() => {
    if (missing) return undefined;
    const values = Object.fromEntries(
      molarityTargets[basis].map((key) => [
        key,
        key === target
          ? 0
          : key === "mw"
          ? Number(d.mw)
          : convertUnit(
              Number(valueOf(key)),
              unitOf(key),
              molarityBaseUnits[key]
            ),
      ])
    ) as Record<MolarityTarget, number>;
    const base = solveMolarity(basis, target, values);
    return target === "mw"
      ? base
      : convertUnit(base, molarityBaseUnits[target], unitOf(target));
  });
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
      : target === "mass"
      ? "m = C × MW × V"
      : target === "volume"
      ? "V = m / (C × MW)"
      : target === "mw"
      ? "MW = m / (C × V)"
      : "C = m / (MW × V)";
  const applyReagent = (reagent: Reagent) => {
    set((old) => ({
      ...old,
      mw: String(reagent.molecularWeight),
      reagent,
      recentReagents: [
        reagent,
        ...old.recentReagents.filter(
          (r) => r.casNumber !== reagent.casNumber || r.name !== reagent.name
        ),
      ].slice(0, 8),
    }));
    setFound(null);
    setError("");
    setCopied("");
  };
  const lookup = async () => {
    const current = ++request.current;
    setBusy(true);
    setError("");
    setFound(null);
    try {
      const chemical = await searchChemical(d.query);
      if (current !== request.current) return;
      if (
        chemical?.molecularWeight &&
        Number.isFinite(chemical.molecularWeight) &&
        chemical.molecularWeight > 0
      ) {
        setFound({
          name: chemical.name,
          casNumber: chemical.casNumber,
          molecularFormula: chemical.molecularFormula,
          molecularWeight: chemical.molecularWeight,
        });
      } else
        setError(
          t(
            "분자량을 찾지 못했습니다. 시약 라벨의 값을 직접 입력하세요.",
            "Molecular weight unavailable. Enter the value on the reagent label."
          )
        );
    } catch {
      if (current === request.current)
        setError(
          t(
            "시약을 검색하지 못했습니다. 연결을 확인하거나 분자량을 직접 입력하세요.",
            "Reagent search failed. Check your connection or enter molecular weight manually."
          )
        );
    } finally {
      if (current === request.current) setBusy(false);
    }
  };
  const changeUnit = (key: MolarityTarget, unit: string) => {
    if (key === "mw") return;
    const value = valueOf(key),
      previousUnit = unitOf(key);
    const converted = value.trim()
      ? calculate(() => convertUnit(Number(value), previousUnit, unit)).value
      : undefined;
    set((old) => ({
      ...old,
      [`${key}Unit`]: unit,
      ...(converted != null
        ? { [key]: String(Number(converted.toPrecision(12))) }
        : {}),
    }));
    setCopied("");
  };
  const resultText =
    result.value != null ? `${format(result.value)} ${unitOf(target)}` : "";

  return (
    <div className="tool-molarity">
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
            onClick={() => {
              set({
                ...d,
                basis: key,
                solve: molarityTargets[key].includes(target)
                  ? target
                  : "concentration",
              });
              setCopied("");
            }}
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
                  onClick={() => {
                    set({ ...d, solve: key });
                    setCopied("");
                  }}
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
                    type="number"
                    step="any"
                    min="0"
                    inputMode="decimal"
                    aria-label={labels[key]}
                    value={valueOf(key)}
                    onChange={(event) => {
                      set({
                        ...d,
                        [key]: event.target.value,
                        ...(key === "mw" ? { reagent: null } : {}),
                      });
                      setCopied("");
                    }}
                  />
                  {key === "mw" ? (
                    <span className="tool-molarity-fixed-unit">g/mol</span>
                  ) : (
                    <select
                      aria-label={`${labels[key]} ${t("단위", "unit")}`}
                      value={unitOf(key)}
                      onChange={(event) => changeUnit(key, event.target.value)}
                    >
                      {molarityUnits[key].map((unit) => (
                        <option key={unit}>{unit}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            ))}
          </div>
          {basis !== "massConcentration" && (
            <p className="tool-muted tool-molarity-volume-note">
              {t(
                "부피는 용매 첨가량이 아닌 최종 용액 부피입니다.",
                "Use the final solution volume after dissolving the solute."
              )}
            </p>
          )}
          {basis !== "amount" && target !== "mw" && (
            <details className="tool-molarity-lookup">
              <summary>
                <Search size={17} />
                <span>
                  {t("시약에서 분자량 찾기", "Find reagent molecular weight")}
                </span>
                <ChevronDown size={16} />
              </summary>
              <div className="tool-molarity-lookup-body">
                <form
                  className="tool-molarity-search"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void lookup();
                  }}
                >
                  <input
                    type="search"
                    aria-label={t("시약 검색", "Search reagent")}
                    placeholder={t("시약명·화학식·CAS", "Name, formula or CAS")}
                    value={d.query}
                    onChange={(event) => {
                      request.current++;
                      setBusy(false);
                      setFound(null);
                      setError("");
                      set({ ...d, query: event.target.value });
                    }}
                  />
                  <button type="submit" disabled={busy || !d.query.trim()}>
                    {busy ? t("검색 중…", "Searching…") : t("검색", "Search")}
                  </button>
                </form>
                <ErrorMessage message={error} />
                {found && (
                  <div className="tool-molarity-found">
                    <strong>{found.name}</strong>
                    <span>
                      {[found.molecularFormula, found.casNumber]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <div>
                      <b>{format(found.molecularWeight)} g/mol</b>
                      <button onClick={() => applyReagent(found)}>
                        {t("이 분자량 적용", "Use this molecular weight")}
                      </button>
                    </div>
                  </div>
                )}
                {d.recentReagents.length > 0 && (
                  <div className="tool-molarity-recents">
                    <p className="tool-muted">
                      {t("최근 사용한 시약", "Recent reagents")}
                    </p>
                    {d.recentReagents.map((reagent, i) => (
                      <button
                        key={`${reagent.casNumber}-${i}`}
                        onClick={() => applyReagent(reagent)}
                      >
                        <span>{reagent.name}</span>
                        <span>{format(reagent.molecularWeight)} g/mol</span>
                      </button>
                    ))}
                  </div>
                )}
                <p className="tool-muted">
                  {t(
                    "시약의 수화물·염 형태와 라벨 분자량을 확인한 뒤 적용하세요.",
                    "Check the hydrate or salt form and molecular weight on your reagent label."
                  )}
                </p>
              </div>
            </details>
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
          <div className="tool-molarity-result-heading">
            <h2>{labels[target]}</h2>
            <button
              disabled={!resultText}
              aria-label={t("결과 복사", "Copy result")}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(resultText);
                  setCopied(resultText);
                  setCopyError("");
                } catch {
                  setCopyError(
                    t(
                      "복사하지 못했습니다. 결과를 선택해 복사하세요.",
                      "Could not copy. Select the result to copy it."
                    )
                  );
                }
              }}
            >
              {copied === resultText && resultText ? (
                <Check size={18} />
              ) : (
                <Copy size={18} />
              )}
            </button>
          </div>
          <div className="tool-molarity-answer">
            <output aria-label={t("계산 결과", "Calculation result")}>
              {result.value != null ? format(result.value) : "—"}
            </output>
            {target === "mw" ? (
              <span>g/mol</span>
            ) : (
              <select
                aria-label={t("결과 단위", "Result unit")}
                value={unitOf(target)}
                onChange={(event) => changeUnit(target, event.target.value)}
              >
                {molarityUnits[target].map((unit) => (
                  <option key={unit}>{unit}</option>
                ))}
              </select>
            )}
          </div>
          <ErrorMessage message={result.error} />
          <ErrorMessage message={copyError} />
          {missing && (
            <p className="tool-muted">
              {t(
                "입력값을 채우면 바로 계산됩니다.",
                "Fill in the inputs to calculate instantly."
              )}
            </p>
          )}
          {copied === resultText && resultText && (
            <p role="status" className="tool-muted">
              {t("결과를 복사했습니다.", "Result copied.")}
            </p>
          )}
          {result.value != null && target !== "mw" && (
            <dl className="tool-molarity-equivalents">
              {molarityUnits[target]
                .filter((unit) => unit !== unitOf(target))
                .map((unit) => (
                  <div key={unit}>
                    <dt>{unit}</dt>
                    <dd>
                      {format(convertUnit(result.value!, unitOf(target), unit))}
                    </dd>
                  </div>
                ))}
            </dl>
          )}
        </section>
      </div>
    </div>
  );
}

import { useEffect, useEffectEvent, useRef } from "react";
import { ArrowDownUp } from "lucide-react";
import {
  units,
  unitCategories,
  conversionNeeds,
  convertAll,
  convertUnit,
  convertCentrifuge,
} from "./units";
import ReagentLookup from "./ReagentLookup";
import {
  NumberField,
  Select,
  ErrorMessage,
  CopyButton,
  HandoffBanner,
  calculate,
  format,
  need,
  plainNumber,
  useText,
  useToolData,
} from "./ui";

/** A conversion that was looked at; a tap brings it back. */
type Recent = { value: string; from: string; to: string; category: string };
const RECENT_LIMIT = 5;
/** How long a conversion stays on screen before it counts as looked at. */
const SETTLE_MS = 1500;
const defaults = {
  value: "1",
  from: "mL",
  to: "µL",
  mw: "",
  density: "",
  radius: "",
  category: "",
  recent: [] as Recent[],
};
type Data = typeof defaults;

const categoryOf = (d: Pick<Data, "category" | "from">) =>
  unitCategories.find((row) => row.id === d.category) ??
  unitCategories.find((row) => row.units.includes(d.from)) ??
  unitCategories[0];
/** RCF is picked as "RCF (× g)" and written "× g" after a number. */
const afterNumber = (unit: string) => (unit === "RCF" ? "× g" : unit);
const inPicker = (unit: string): string | readonly [string, string] =>
  unit === "RCF" ? ["RCF", "RCF (× g)"] : unit;
const sameConversion = (a: Recent | undefined, b: Recent) =>
  !!a &&
  a.value === b.value &&
  a.from === b.from &&
  a.to === b.to &&
  a.category === b.category;
/** Recent conversions as stored; anything this version cannot show is dropped. */
function readRecent(stored: unknown): Recent[] {
  return (Array.isArray(stored) ? stored : []).filter((row): row is Recent => {
    if (!row || typeof row.value !== "string") return false;
    const list = unitCategories.find((c) => c.id === row.category)?.units;
    return !!list && list.includes(row.from) && list.includes(row.to);
  });
}
function convert(d: Data) {
  const value = need(d.value);
  if (categoryOf(d).id === "centrifuge")
    return convertCentrifuge(value, d.from as "RPM" | "RCF", need(d.radius));
  const needs = conversionNeeds(d.from, d.to);
  return convertUnit(
    value,
    d.from,
    d.to,
    needs.mw ? need(d.mw) : undefined,
    needs.density ? need(d.density) : undefined
  );
}
/**
 * The recent list with this conversion moved to the front, or null when there
 * is nothing to change: no result yet, or it is already the newest.
 */
function recentWith(d: Data): Recent[] | null {
  if (calculate(() => convert(d)).value == null) return null;
  const recent = readRecent(d.recent);
  const entry = {
    value: d.value.trim(),
    from: d.from,
    to: d.to,
    category: categoryOf(d).id,
  };
  return sameConversion(recent[0], entry)
    ? null
    : [entry, ...recent.filter((row) => !sameConversion(row, entry))].slice(
        0,
        RECENT_LIMIT
      );
}

export default function UnitTool() {
  const t = useText();
  const [d, set] = useToolData(defaults);
  const category = categoryOf(d),
    centrifugal = category.id === "centrifuge";
  const needs = centrifugal
    ? { mw: false, density: false }
    : conversionNeeds(d.from, d.to);
  const result = calculate(() => convert(d));
  const recent = readRecent(d.recent);
  // The fields still empty, as the hint names them.
  const missing = [
    !d.value.trim() && t("변환할 값", "a value"),
    centrifugal &&
      !d.radius.trim() &&
      t("로터 반지름 (cm)", "the rotor radius (cm)"),
    needs.mw &&
      !d.mw.trim() &&
      t("분자량 (g/mol)", "the molecular weight (g/mol)"),
    needs.density &&
      !d.density.trim() &&
      t("용액 밀도 (g/mL)", "the solution density (g/mL)"),
  ].filter((name): name is string => !!name);
  // The same value in the type's other units. A molecular weight or density
  // counts only while its field is on screen: one left over from another
  // substance must not slip into a conversion that does not show it.
  const others = centrifugal
    ? []
    : category.units.filter((unit) => unit !== d.from && unit !== d.to);
  const glance =
    result.value == null
      ? []
      : calculate(() =>
          convertAll(
            need(d.value),
            d.from,
            others,
            needs.mw ? need(d.mw) : undefined,
            needs.density ? need(d.density) : undefined
          )
        ).value ?? [];
  const fromLabel = afterNumber(d.from),
    toLabel = afterNumber(d.to);
  const change = (patch: Partial<Data>) =>
    set((old) => ({ ...old, ...patch }));

  // A conversion joins the recent list once it has stayed on screen for a
  // moment, so typing "1", "12", "125" files one conversion, not three. The
  // one already showing when the tool opens is not a new conversion until
  // something else has been converted.
  const shown =
    result.value == null
      ? ""
      : [category.id, d.from, d.to, d.value.trim()].join(" ");
  const opened = useRef(shown);
  const fileRecent = useEffectEvent(() => {
    if (recentWith(d))
      set((old) => ({ ...old, recent: recentWith(old) ?? old.recent }));
  });
  useEffect(() => {
    if (!shown || shown === opened.current) return;
    opened.current = "";
    const timer = setTimeout(() => fileRecent(), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [shown]);

  const applyMolecularWeight = (weight: number) =>
    set((old) => {
      const next = { ...old, mw: plainNumber(weight) };
      const concentration = categoryOf(old).id === "concentration";
      if (concentration && conversionNeeds(old.from, old.to).mw) return next;
      // A molecular weight only matters between molar and mass concentration,
      // so a received one opens that conversion. The typed number stays.
      const from = concentration ? old.from : "M";
      return {
        ...next,
        category: "concentration",
        from,
        to: units[from]?.dimension === "molar" ? "mg/mL" : "M",
      };
    });
  return (
    <div className="tool-unit-layout">
      <div
        className="tool-choice-grid"
        role="group"
        aria-label={t("변환 종류", "Conversion type")}
      >
        {unitCategories.map((row) => (
          <button
            key={row.id}
            aria-pressed={row.id === category.id}
            onClick={() =>
              change({ category: row.id, from: row.units[0], to: row.units[1] })
            }
          >
            {t(row.ko, row.en)}
          </button>
        ))}
      </div>
      <section className="tool-unit-conversion">
        <HandoffBanner
          accepts={["molecular-weight"]}
          onApply={(offer) => applyMolecularWeight(offer.value)}
        />
        {centrifugal && (
          <>
            <NumberField
              label={t("로터 반지름 (cm)", "Rotor radius (cm)")}
              value={d.radius}
              onChange={(radius) => change({ radius })}
            />
            <p className="tool-muted">
              {t(
                "회전축에서 시료 위치까지의 거리를 입력하세요. 장비 설명서의 반지름을 사용하세요.",
                "Enter the distance from the rotation axis to the sample. Use the radius specified for your rotor."
              )}
            </p>
          </>
        )}
        <div className="tool-unit-input">
          <NumberField
            label={t("변환할 값", "Value to convert")}
            value={d.value}
            negative={category.id === "temperature"}
            onChange={(value) => change({ value })}
          />
          <Select
            label={t("원래 단위", "From")}
            value={d.from}
            options={category.units.map(inPicker)}
            onChange={(from) =>
              change({
                from,
                ...(centrifugal ? { to: from === "RPM" ? "RCF" : "RPM" } : {}),
              })
            }
          />
        </div>
        <div className="tool-unit-swap">
          <button
            aria-label={t("값과 단위 교환", "Swap value and units")}
            onClick={() =>
              change({
                from: d.to,
                to: d.from,
                value:
                  result.value == null ? d.value : plainNumber(result.value),
              })
            }
          >
            <ArrowDownUp size={18} aria-hidden="true" />
            {t("교환", "Swap")}
          </button>
        </div>
        <Select
          label={t("변환할 단위", "To")}
          value={d.to}
          options={category.units.map(inPicker)}
          onChange={(to) =>
            change({
              to,
              ...(centrifugal ? { from: to === "RPM" ? "RCF" : "RPM" } : {}),
            })
          }
        />
        {(needs.mw || needs.density) && (
          <div className="tool-unit-context">
            <p>
              {t(
                "이 변환에 필요한 물질 정보를 입력하세요.",
                "Enter the substance properties required for this conversion."
              )}
            </p>
            <div className="tool-grid">
              {needs.mw && (
                <NumberField
                  label={t("분자량 (g/mol)", "Molecular weight (g/mol)")}
                  value={d.mw}
                  onChange={(mw) => change({ mw })}
                />
              )}
              {needs.density && (
                <NumberField
                  label={t("용액 밀도 (g/mL)", "Solution density (g/mL)")}
                  value={d.density}
                  onChange={(density) => change({ density })}
                />
              )}
            </div>
          </div>
        )}
        {needs.mw && (
          <ReagentLookup
            onApply={(reagent) =>
              change({ mw: plainNumber(reagent.molecularWeight) })
            }
          />
        )}
        <ErrorMessage message={result.error} />
        <div className="tool-unit-result">
          <span>{t("변환 결과", "Converted value")}</span>
          {result.value != null ? (
            <>
              <div className="tool-unit-x-answer">
                <output>
                  {format(result.value)} <small>{toLabel}</small>
                </output>
                <CopyButton
                  label={t("결과 복사", "Copy result")}
                  text={`${plainNumber(result.value)} ${toLabel}`}
                />
              </div>
              <p>
                {d.value} {fromLabel} = {format(result.value)} {toLabel}
              </p>
            </>
          ) : result.incomplete ? (
            <p className="tool-unit-x-hint" role="status">
              {t(
                `${missing.join(", ")} 입력이 필요합니다.`,
                `Enter ${missing.join(" and ")} to convert.`
              )}
            </p>
          ) : (
            <div className="tool-unit-x-answer">
              <output>—</output>
            </div>
          )}
        </div>
        {glance.length > 0 && (
          <section className="tool-unit-x-all">
            <h2>{t("다른 단위로", "In other units")}</h2>
            <dl>
              {glance.map((row) => (
                <div key={row.unit}>
                  <dt>{row.unit}</dt>
                  <dd>{format(row.value)}</dd>
                </div>
              ))}
            </dl>
            {glance.length < others.length && (
              <p className="tool-muted">
                {t(
                  "분자량이나 밀도가 필요한 단위는 생략했습니다.",
                  "Units that need a molecular weight or density are left out."
                )}
              </p>
            )}
          </section>
        )}
        {recent.length > 0 && (
          <section className="tool-unit-x-recent">
            <h2>{t("최근 변환", "Recent conversions")}</h2>
            <div
              role="group"
              aria-label={t("최근 변환", "Recent conversions")}
            >
              {recent.map((row) => (
                <button
                  key={`${row.category} ${row.from} ${row.to} ${row.value}`}
                  onClick={() =>
                    set((old) => {
                      const next = { ...old, ...row };
                      return { ...next, recent: recentWith(next) ?? old.recent };
                    })
                  }
                >
                  {row.value} {afterNumber(row.from)} → {afterNumber(row.to)}
                </button>
              ))}
            </div>
          </section>
        )}
        {centrifugal && (
          <details className="tool-guide">
            <summary>{t("계산식과 반지름 기준", "Formula and radius")}</summary>
            <p>RCF (× g) = 1.118 × 10⁻⁵ × r(cm) × RPM²</p>
            <a
              href="https://www.thermofisher.com/us/en/home/life-science/lab-equipment/lab-equipment-learning-center/centrifuges/centrifuge-best-practices.html"
              target="_blank"
              rel="noreferrer"
            >
              Thermo Fisher Scientific
            </a>
          </details>
        )}
      </section>
    </div>
  );
}

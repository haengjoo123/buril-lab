import { useState } from "react";
import { ArrowDownUp, Check, Copy } from "lucide-react";
import { units, convertUnit, convertCentrifuge } from "./units";
import {
  Field,
  Select,
  ErrorMessage,
  calculate,
  format,
  useText,
  useToolData,
} from "./ui";
const categories = [
  { id: "volume", ko: "부피", en: "Volume", units: ["mL", "µL", "L", "nL"] },
  { id: "mass", ko: "질량", en: "Mass", units: ["g", "mg", "µg", "ng", "kg"] },
  {
    id: "concentration",
    ko: "농도",
    en: "Concentration",
    units: [
      "M",
      "mM",
      "µM",
      "nM",
      "g/L",
      "mg/mL",
      "µg/mL",
      "% w/v",
      "% w/w",
      "ppm w/w",
      "ppb w/w",
    ],
  },
  {
    id: "temperature",
    ko: "온도",
    en: "Temperature",
    units: ["°C", "°F", "K"],
  },
  { id: "centrifuge", ko: "RPM / RCF", en: "RPM / RCF", units: ["RPM", "RCF"] },
  { id: "length", ko: "길이", en: "Length", units: ["m", "cm", "mm", "µm"] },
  { id: "area", ko: "면적", en: "Area", units: ["m²", "cm²", "mm²", "µm²"] },
  { id: "time", ko: "시간", en: "Time", units: ["s", "min", "h", "day"] },
  { id: "amount", ko: "물질량", en: "Amount", units: ["mol", "mmol", "µmol"] },
  {
    id: "volumeFraction",
    ko: "부피 비율",
    en: "Volume fraction",
    units: ["% v/v", "ppm v/v"],
  },
];
export default function UnitTool() {
  const t = useText(),
    [copied, setCopied] = useState(false),
    [copyError, setCopyError] = useState("");
  const [d, set] = useToolData({
    value: "1",
    from: "mL",
    to: "µL",
    mw: "",
    density: "",
    radius: "",
    category: "",
  });
  const category =
    categories.find((row) => row.id === d.category) ??
    categories.find((row) => row.units.includes(d.from)) ??
    categories[0];
  const centrifugal = category.id === "centrifuge",
    a = units[d.from]?.dimension,
    b = units[d.to]?.dimension;
  const needsMw = !centrifugal && a !== b && (a === "molar" || b === "molar"),
    needsDensity =
      !centrifugal && a !== b && (a === "massFraction" || b === "massFraction");
  const missing =
    (needsMw && !d.mw) ||
    (needsDensity && !d.density) ||
    (centrifugal && !d.radius);
  const result = calculate(() => {
    if (!d.value.trim() || missing) return null;
    return centrifugal
      ? convertCentrifuge(
          Number(d.value),
          d.from as "RPM" | "RCF",
          Number(d.radius)
        )
      : convertUnit(
          Number(d.value),
          d.from,
          d.to,
          Number(d.mw),
          Number(d.density)
        );
  });
  const toLabel = centrifugal && d.to === "RCF" ? "× g" : d.to;
  const changeCategory = (id: string) => {
    const next = categories.find((row) => row.id === id)!;
    set({ ...d, category: id, from: next.units[0], to: next.units[1] });
    setCopied(false);
  };
  return (
    <div className="tool-unit-layout">
      <div
        className="tool-choice-grid"
        role="group"
        aria-label={t("변환 종류", "Conversion type")}
      >
        {categories.map((row) => (
          <button
            key={row.id}
            aria-pressed={row.id === category.id}
            onClick={() => changeCategory(row.id)}
          >
            {t(row.ko, row.en)}
          </button>
        ))}
      </div>
      <section className="tool-unit-conversion">
        {centrifugal && (
          <>
            <Field
              label={t("로터 반지름 (cm)", "Rotor radius (cm)")}
              value={d.radius}
              min={0}
              onChange={(radius) => set({ ...d, radius })}
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
          <Field
            label={t("변환할 값", "Value to convert")}
            value={d.value}
            onChange={(value) => {
              set({ ...d, value });
              setCopied(false);
            }}
          />
          <Select
            label={t("원래 단위", "From")}
            value={d.from}
            options={category.units}
            onChange={(from) => {
              set({
                ...d,
                from,
                ...(centrifugal ? { to: from === "RPM" ? "RCF" : "RPM" } : {}),
              });
              setCopied(false);
            }}
          />
        </div>
        <div className="tool-unit-swap">
          <button
            aria-label={t("값과 단위 교환", "Swap value and units")}
            onClick={() => {
              set({
                ...d,
                from: d.to,
                to: d.from,
                value: result.value == null ? d.value : String(result.value),
              });
              setCopied(false);
            }}
          >
            <ArrowDownUp size={18} />
            {t("교환", "Swap")}
          </button>
        </div>
        <Select
          label={t("변환할 단위", "To")}
          value={d.to}
          options={category.units}
          onChange={(to) => {
            set({
              ...d,
              to,
              ...(centrifugal ? { from: to === "RPM" ? "RCF" : "RPM" } : {}),
            });
            setCopied(false);
          }}
        />
        {(needsMw || needsDensity) && (
          <div className="tool-unit-context">
            <p>
              {t(
                "이 변환에 필요한 물질 정보를 입력하세요.",
                "Enter the substance properties required for this conversion."
              )}
            </p>
            <div className="tool-grid">
              {needsMw && (
                <Field
                  label={t("분자량 (g/mol)", "Molecular weight (g/mol)")}
                  min={0}
                  value={d.mw}
                  onChange={(mw) => set({ ...d, mw })}
                />
              )}
              {needsDensity && (
                <Field
                  label={t("용액 밀도 (g/mL)", "Solution density (g/mL)")}
                  min={0}
                  value={d.density}
                  onChange={(density) => set({ ...d, density })}
                />
              )}
            </div>
          </div>
        )}
        <ErrorMessage message={result.error || copyError} />
        <div className="tool-unit-result">
          <span>{t("변환 결과", "Converted value")}</span>
          <div>
            <output>
              {format(result.value)} <small>{toLabel}</small>
            </output>
            <button
              aria-label={t("결과 복사", "Copy result")}
              disabled={result.value == null}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    `${result.value} ${toLabel}`
                  );
                  setCopied(true);
                  setCopyError("");
                } catch {
                  setCopyError(
                    t(
                      "복사하지 못했습니다. 결과를 선택해 복사하세요.",
                      "Could not copy. Select and copy the result."
                    )
                  );
                }
              }}
            >
              {copied ? <Check size={19} /> : <Copy size={19} />}
            </button>
          </div>
          {result.value != null && (
            <p>
              {d.value} {d.from === "RCF" ? "× g" : d.from} ={" "}
              {format(result.value)} {toLabel}
            </p>
          )}
        </div>
        {centrifugal && (
          <details className="tool-guide">
            <summary>{t("계산식과 반지름 기준", "Formula and radius")}</summary>
            <p>RCF = 1.118 × 10⁻⁵ × r(cm) × RPM²</p>
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

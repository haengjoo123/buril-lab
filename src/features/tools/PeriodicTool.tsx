import { useRef, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, X } from "lucide-react";
import periodic from "./data/periodic-table.json";
import { elementNamesKo, elementLabels } from "./elementNames";
import { Field, Select, useText } from "./ui";
const families: Record<string, [string, string]> = {
  "Alkali metal": ["알칼리 금속", "#fecaca"],
  "Alkaline earth metal": ["알칼리 토금속", "#fed7aa"],
  "Transition metal": ["전이 금속", "#fde68a"],
  "Post-transition metal": ["전이후 금속", "#bbf7d0"],
  Metalloid: ["준금속", "#a7f3d0"],
  Nonmetal: ["비금속", "#bfdbfe"],
  Halogen: ["할로젠", "#a5f3fc"],
  "Noble gas": ["비활성 기체", "#ddd6fe"],
  Lanthanide: ["란타넘족", "#fbcfe8"],
  Actinide: ["악티늄족", "#e9d5ff"],
};
const position = (n: number) => {
  if (n === 1) return [1, 1];
  if (n === 2) return [18, 1];
  if (n <= 10) return [n < 5 ? n - 2 : n + 8, 2];
  if (n <= 18) return [n < 13 ? n - 10 : n, 3];
  if (n <= 36) return [n - 18, 4];
  if (n <= 54) return [n - 36, 5];
  if (n <= 56) return [n - 54, 6];
  if (n <= 71) return [n - 54, 9];
  if (n <= 86) return [n - 68, 6];
  if (n <= 88) return [n - 86, 7];
  if (n <= 103) return [n - 86, 10];
  return [n - 100, 7];
};
export default function PeriodicTool() {
  const t = useText(),
    [query, setQuery] = useState(""),
    [family, setFamily] = useState("all"),
    [selected, setSelected] = useState(0),
    [zoom, setZoom] = useState(false),
    detail = useRef<HTMLElement>(null);
  const elements = periodic.Table.Row.map((row) => row.Cell),
    chosen = elements[selected - 1];
  const matches = (c: string[]) => {
    const q = query.trim().toLowerCase();
    return (
      (family === "all" || c[15] === family) &&
      (!q || /^\d+$/.test(q)
        ? !q || Number(c[0]) === Number(q)
        : `${c[1]} ${c[2]} ${elementNamesKo[Number(c[0]) - 1]}`
            .toLowerCase()
            .includes(q))
    );
  };
  const choose = (n: number) => {
    setSelected(n);
    requestAnimationFrame(() =>
      detail.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
    );
  };
  const valuesKo: Record<string, string> = {
    Gas: "기체",
    Solid: "고체",
    Liquid: "액체",
    Unknown: "미상",
    Ancient: "고대부터 알려짐",
    ...Object.fromEntries(
      Object.entries(families).map(([key, value]) => [key, value[0]])
    ),
  };
  return (
    <section>
      <div className="tool-library-filters">
        <Field
          type="search"
          label={t(
            "이름·기호·원자번호 검색",
            "Search name, symbol or atomic number"
          )}
          value={query}
          onChange={setQuery}
        />
        <Select
          label={t("원소 분류", "Element family")}
          value={family}
          onChange={setFamily}
          options={[
            ["all", t("전체", "All")],
            ...Object.entries(families).map(
              ([key, value]) => [key, t(value[0], key)] as const
            ),
          ]}
        />
        <button
          className="tool-icon-button"
          aria-label={t(zoom ? "축소" : "확대", zoom ? "Zoom out" : "Zoom in")}
          onClick={() => setZoom(!zoom)}
        >
          {zoom ? <ZoomOut size={20} /> : <ZoomIn size={20} />}
        </button>
      </div>
      <div className="tool-periodic-scroll">
        <div
          className={`tool-periodic ${zoom ? "expanded" : ""}`}
          aria-label={t("주기율표", "Periodic table")}
        >
          {elements.map((c) => {
            const [col, row] = position(Number(c[0])),
              match = matches(c);
            return (
              <button
                key={c[0]}
                className={`tool-element ${match ? "" : "dimmed"}`}
                style={
                  {
                    gridColumn: col,
                    gridRow: row,
                    "--element-color": families[c[15]]?.[1] ?? "#e2e8f0",
                  } as CSSProperties
                }
                aria-label={`${c[0]} ${t(
                  elementNamesKo[Number(c[0]) - 1],
                  c[2]
                )} ${c[1]}`}
                aria-pressed={selected === Number(c[0])}
                title={`${t(elementNamesKo[Number(c[0]) - 1], c[2])} · ${c[3]}`}
                onClick={() => choose(Number(c[0]))}
              >
                <small>{c[0]}</small>
                <strong>{c[1]}</strong>
                {zoom && (
                  <span>{t(elementNamesKo[Number(c[0]) - 1], c[2])}</span>
                )}
              </button>
            );
          })}
          <span
            className="tool-element-gap"
            style={{ gridColumn: 3, gridRow: 6 }}
          >
            57–71
          </span>
          <span
            className="tool-element-gap"
            style={{ gridColumn: 3, gridRow: 7 }}
          >
            89–103
          </span>
        </div>
      </div>
      {query && (
        <p className="tool-muted">
          {elements.filter(matches).length} {t("개 원소", "elements")}
        </p>
      )}
      {chosen ? (
        <section ref={detail} className="tool-element-detail">
          <div className="tool-counter-heading">
            <span className="tool-element-symbol">
              {chosen[0]}
              <strong>{chosen[1]}</strong>
            </span>
            <h2>
              {t(elementNamesKo[selected - 1], chosen[2])}
              <small>
                {t(families[chosen[15]]?.[0] ?? chosen[15], chosen[15])}
              </small>
            </h2>
            <button
              className="tool-icon-button"
              aria-label={t("원소 정보 닫기", "Close element details")}
              onClick={() => setSelected(0)}
            >
              <X size={20} />
            </button>
          </div>
          <div className="tool-actions">
            <button
              disabled={selected === 1}
              aria-label={t("이전 원소", "Previous element")}
              onClick={() => setSelected((n) => n - 1)}
            >
              <ChevronLeft size={17} />
              {selected > 1 ? elements[selected - 2][1] : ""}
            </button>
            <button
              disabled={selected === 118}
              aria-label={t("다음 원소", "Next element")}
              onClick={() => setSelected((n) => n + 1)}
            >
              {selected < 118 ? elements[selected][1] : ""}
              <ChevronRight size={17} />
            </button>
          </div>
          <dl className="tool-property-list">
            {periodic.Table.Columns.Column.map(
              (label, index) =>
                ![0, 1, 2, 4, 15].includes(index) && (
                  <div key={label}>
                    <dt>
                      {t(
                        elementLabels[label] ?? label,
                        label.replace(/([a-z])([A-Z])/g, "$1 $2")
                      )}
                    </dt>
                    <dd>
                      {t(
                        valuesKo[chosen[index]] ?? chosen[index],
                        chosen[index]
                      ) || "—"}
                    </dd>
                  </div>
                )
            )}
          </dl>
          <a
            href={`https://pubchem.ncbi.nlm.nih.gov/element/${selected}`}
            target="_blank"
            rel="noreferrer"
          >
            {t("PubChem에서 자세히", "More on PubChem")}
          </a>
        </section>
      ) : (
        <p className="tool-muted">
          {t(
            "원소를 선택하면 물성과 전자 배치를 볼 수 있습니다. 표는 좌우로 이동할 수 있습니다.",
            "Select an element for properties and electron configuration. Scroll horizontally to explore the table."
          )}
        </p>
      )}
      <p className="tool-muted">
        <a
          href="https://pubchem.ncbi.nlm.nih.gov/periodic-table/"
          target="_blank"
          rel="noreferrer"
        >
          PubChem · 2026-11-09
        </a>
      </p>
    </section>
  );
}

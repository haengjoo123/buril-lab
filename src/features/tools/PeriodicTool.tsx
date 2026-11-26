import {
  useContext,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, X } from "lucide-react";
import periodic from "./data/periodic-table.json";
import {
  elementNamesKo,
  elementLabels,
  elementUnits,
  elementScales,
  elementPosition,
  elementGroup,
  elementPeriod,
  stepElement,
  type ElementStep,
} from "./elementNames";
import { checkFormula } from "./formula";
import { heatStep } from "./chartMath";
import { ScaleLegend } from "./charts";
import {
  CopyButton,
  ErrorMessage,
  Field,
  Select,
  ToolContext,
  format,
  plainNumber,
  useText,
} from "./ui";
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
const columns = periodic.Table.Columns.Column,
  elements = periodic.Table.Row.map((row) => row.Cell);
/** The table as drawn: the seven periods, then the two rows set apart below. */
const tableRows = [1, 2, 3, 4, 5, 6, 7, 9, 10].map((row) =>
  elements
    .map((cell) => ({ cell, n: Number(cell[0]) }))
    .filter(({ n }) => elementPosition(n)[1] === row)
    .sort((a, b) => elementPosition(a.n)[0] - elementPosition(b.n)[0])
);
const moves: readonly string[] = [
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
];
/** An English label from a PubChem column name, with its unit. */
const english = (label: string) =>
  label.replace(/([a-z])([A-Z])/g, "$1 $2") +
  (elementUnits[label] ? ` (${elementUnits[label]})` : "");

/** Molecular weight of a typed formula, with each element's share of it. */
function FormulaWeight() {
  const t = useText(),
    ctx = useContext(ToolContext),
    [text, setText] = useState("");
  const { weight, error, near } = checkFormula(text);
  return (
    <section className="tool-lib-x-formula">
      <label className="tool-field">
        <span>{t("화학식 → 분자량", "Formula → molecular weight")}</span>
        <input
          type="text"
          value={text}
          placeholder="C6H12O6"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={!!error}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <ErrorMessage message={error} />
      {error && near && (
        <p className="tool-muted">
          {t("확인할 부분", "Check")}: <code>{near}</code>
        </p>
      )}
      {weight ? (
        <>
          <div className="tool-lib-x-weight">
            <output className="tool-result">
              {format(weight.rounded)} g/mol
            </output>
            <CopyButton
              text={plainNumber(weight.rounded)}
              label={t("분자량 복사", "Copy molecular weight")}
            />
            {ctx?.sendTo && (
              <button
                className="primary"
                onClick={() =>
                  ctx.sendTo?.("molarity", {
                    kind: "molecular-weight",
                    value: weight.rounded,
                    unit: "g/mol",
                    label: text.trim(),
                    source: "periodic-table",
                  })
                }
              >
                {t("몰농도로 보내기", "Send to Molarity")}
              </button>
            )}
          </div>
          <div className="tool-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("원소", "Element")}</th>
                  <th>{t("개수", "Atoms")}</th>
                  <th>{t("질량 기여 (g/mol)", "Mass (g/mol)")}</th>
                  <th>{t("질량 백분율 (%)", "Mass percent (%)")}</th>
                </tr>
              </thead>
              <tbody>
                {weight.parts.map((part) => (
                  <tr key={part.symbol}>
                    <th scope="row">
                      {part.symbol}{" "}
                      <small>
                        {t(
                          elementNamesKo[part.number - 1],
                          elements[part.number - 1][2]
                        )}
                      </small>
                    </th>
                    <td>{format(part.count)}</td>
                    <td>{format(part.mass)}</td>
                    <td>{part.percent.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="tool-muted">
            {t(
              "원자량은 주기율표에 실린 값(PubChem)입니다. 분자량은 쓰인 원자량 가운데 소수 자릿수가 가장 적은 값에 맞춰 반올림합니다.",
              "Atomic weights are those of the periodic table here (PubChem). The weight is rounded to the fewest decimal places among the atomic weights used."
            )}
          </p>
        </>
      ) : (
        <p className="tool-muted">
          {t(
            "원소 기호는 대소문자를 구분합니다(Co는 코발트, CO는 일산화탄소). 괄호는 겹쳐 쓸 수 있고 수화물은 · . * 로 잇습니다. 예: Ca(OH)2, K4[Fe(CN)6], CuSO4·5H2O",
            "Symbols are case-sensitive (Co is cobalt, CO is carbon monoxide). Brackets may be nested and a hydrate is joined with · . or *. Examples: Ca(OH)2, K4[Fe(CN)6], CuSO4·5H2O"
          )}
        </p>
      )}
    </section>
  );
}

/** The table itself: search, family filter, cell colour, grid and element detail. */
function ElementTable() {
  const t = useText(),
    [query, setQuery] = useState(""),
    [family, setFamily] = useState("all"),
    [selected, setSelected] = useState(0),
    [zoom, setZoom] = useState(false),
    // "family" colours cells by class; a column name shades them by its value.
    [tone, setTone] = useState("family"),
    // The cell that is in the tab order; the arrow keys move it.
    [cursor, setCursor] = useState(1),
    grid = useRef<HTMLDivElement>(null),
    detail = useRef<HTMLElement>(null);
  const chosen = elements[selected - 1];
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
  const caption = (label: string) =>
    t(elementLabels[label] ?? label, english(label));
  const familyName = (c: string[]) => t(families[c[15]]?.[0] ?? c[15], c[15]);
  /** "17족 3주기"; the rows set apart have a period and no group. */
  const place = (n: number) => {
    const group = elementGroup(n),
      period = elementPeriod(n);
    return group
      ? t(`${group}족 ${period}주기`, `group ${group}, period ${period}`)
      : t(`${period}주기`, `period ${period}`);
  };
  const choose = (n: number) => {
    setSelected(n);
    setCursor(n);
    requestAnimationFrame(() =>
      detail.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" })
    );
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const from = Number((event.target as HTMLElement).dataset.z);
    if (!from || !moves.includes(event.key)) return;
    event.preventDefault();
    const to = stepElement(from, event.key as ElementStep);
    setCursor(to);
    grid.current?.querySelector<HTMLElement>(`[data-z="${to}"]`)?.focus();
  };
  // Shading by a property: its values, and the range the scale covers.
  const scale = tone === "family" ? -1 : columns.indexOf(tone),
    reading = (c: string[]) =>
      scale < 0 || c[scale] === "" ? NaN : Number(c[scale]),
    readings = elements.map(reading).filter(Number.isFinite),
    low = Math.min(...readings),
    high = Math.max(...readings);
  // Previous and next stay within the elements the search and family leave.
  const listed = elements.filter(matches).map((c) => Number(c[0])),
    previous = listed.filter((n) => n < selected).pop() ?? 0,
    next = listed.find((n) => n > selected) ?? 0;
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
    <>
      <div className="tool-library-filters tool-lib-x-filters">
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
        <Select
          label={t("칸 색", "Cell colour")}
          value={tone}
          onChange={setTone}
          options={[
            ["family", t("원소 분류", "Element family")],
            ...elementScales.map((label) => [label, caption(label)] as const),
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
      {scale >= 0 && (
        <div className="tool-lib-x-tone">
          <ScaleLegend
            title={caption(tone)}
            min={format(low)}
            max={format(high)}
          />
          <p className="tool-muted">
            {t(
              `값이 없는 원소 ${
                elements.length - readings.length
              }개는 비워 둡니다. 값은 칸에 초점을 주거나 원소를 선택하면 볼 수 있습니다.`,
              `${
                elements.length - readings.length
              } elements without a value are left blank. Focus a cell or select the element to read its value.`
            )}
          </p>
        </div>
      )}
      <div className="tool-periodic-scroll">
        <div
          ref={grid}
          role="grid"
          className={`tool-periodic tool-lib-x-grid ${zoom ? "expanded" : ""}`}
          aria-label={t("주기율표", "Periodic table")}
          onKeyDown={onKeyDown}
        >
          <div role="row" className="tool-lib-x-row">
            <span
              role="columnheader"
              className="tool-lib-x-axis"
              style={{ gridColumn: 1, gridRow: 1 }}
              aria-label={t("주기", "Period")}
            />
            {Array.from({ length: 18 }, (_, index) => (
              <span
                key={index}
                role="columnheader"
                className="tool-lib-x-axis"
                style={{ gridColumn: index + 2, gridRow: 1 }}
                aria-label={t(`${index + 1}족`, `Group ${index + 1}`)}
              >
                {index + 1}
              </span>
            ))}
          </div>
          {tableRows.map((cells) => {
            const row = elementPosition(cells[0].n)[1],
              period = elementPeriod(cells[0].n);
            return (
              <div role="row" className="tool-lib-x-row" key={row}>
                <span
                  role="rowheader"
                  className="tool-lib-x-axis"
                  style={{ gridColumn: 1, gridRow: row + 1 }}
                  aria-label={
                    row > 7
                      ? `${t(`${period}주기`, `Period ${period}`)} ${familyName(
                          cells[0].cell
                        )}`
                      : t(`${period}주기`, `Period ${period}`)
                  }
                >
                  {period}
                </span>
                {cells.map(({ cell: c, n }) => {
                  const col = elementPosition(n)[0],
                    name = t(elementNamesKo[n - 1], c[2]),
                    value = reading(c),
                    step = scale < 0 ? null : heatStep(value, low, high),
                    // What the shade stands for, in words.
                    figure =
                      scale < 0
                        ? ""
                        : `${caption(tone)}: ${
                            Number.isFinite(value)
                              ? c[scale]
                              : t("값 없음", "no value")
                          }`;
                  return (
                    <button
                      key={n}
                      role="gridcell"
                      data-z={n}
                      tabIndex={cursor === n ? 0 : -1}
                      className={`tool-element tool-lib-x-cell ${
                        matches(c) ? "" : "dimmed"
                      } ${
                        step != null
                          ? `tool-chart-heat-${step}`
                          : scale >= 0
                          ? "tool-lib-x-blank"
                          : ""
                      }`}
                      style={
                        {
                          gridColumn: col + 1,
                          gridRow: row + 1,
                          "--element-color": families[c[15]]?.[1] ?? "#e2e8f0",
                        } as CSSProperties
                      }
                      aria-colindex={col + 1}
                      aria-label={`${n} ${name} ${c[1]}, ${familyName(
                        c
                      )}, ${place(n)}${figure && `, ${figure}`}`}
                      aria-selected={selected === n}
                      title={`${name} · ${
                        figure ||
                        `${t("원자량", "atomic mass")} ${c[3]} · ${place(n)}`
                      }`}
                      onClick={() => choose(n)}
                      onFocus={() => setCursor(n)}
                    >
                      <small>{n}</small>
                      <strong>{c[1]}</strong>
                      {zoom && <span>{name}</span>}
                      {zoom && scale >= 0 && Number.isFinite(value) && (
                        <span>{format(value)}</span>
                      )}
                    </button>
                  );
                })}
                {(row === 6 || row === 7) && (
                  <span
                    role="gridcell"
                    className="tool-element-gap"
                    style={{ gridColumn: 4, gridRow: row + 1 }}
                    aria-colindex={4}
                  >
                    {row === 6 ? "57–71" : "89–103"}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <p className="tool-muted">
        {t(
          "위쪽 숫자는 족, 왼쪽 숫자는 주기입니다. 방향키로 칸을 옮기고 Enter로 선택합니다.",
          "Numbers along the top are groups and those on the left periods. Move between cells with the arrow keys and select with Enter."
        )}
      </p>
      {(query || family !== "all") && (
        <p className="tool-muted" role="status">
          {listed.length} {t("개 원소", listed.length === 1 ? "element" : "elements")}
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
              <small>{familyName(chosen)}</small>
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
              disabled={!previous}
              aria-label={t("이전 원소", "Previous element")}
              onClick={() => {
                setSelected(previous);
                setCursor(previous);
              }}
            >
              <ChevronLeft size={17} />
              {previous ? elements[previous - 1][1] : ""}
            </button>
            <button
              disabled={!next}
              aria-label={t("다음 원소", "Next element")}
              onClick={() => {
                setSelected(next);
                setCursor(next);
              }}
            >
              {next ? elements[next - 1][1] : ""}
              <ChevronRight size={17} />
            </button>
            {(query || family !== "all") && (
              <span className="tool-muted">
                {t(
                  "검색·분류에 맞는 원소 안에서 이동합니다.",
                  "Moves within the elements that match the search and family."
                )}
              </span>
            )}
          </div>
          <dl className="tool-property-list">
            <div>
              <dt>{t("족", "Group")}</dt>
              <dd>
                {elementGroup(selected) ??
                  t(
                    "번호 없음 (표 아래에 따로 둔 줄)",
                    "None (row set apart below the table)"
                  )}
              </dd>
            </div>
            <div>
              <dt>{t("주기", "Period")}</dt>
              <dd>{elementPeriod(selected)}</dd>
            </div>
            {columns.map(
              (label, index) =>
                ![0, 1, 2, 4, 15].includes(index) && (
                  <div key={label}>
                    {/* The Korean labels carry the unit; the English ones are
                        built from the column name and have it added. */}
                    <dt>{caption(label)}</dt>
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
    </>
  );
}

export default function PeriodicTool() {
  const t = useText(),
    [view, setView] = useState("table");
  return (
    <section>
      <div
        className="tool-actions tool-lib-x-switch"
        role="group"
        aria-label={t("주기율표 보기", "Periodic table view")}
      >
        <button
          aria-pressed={view === "table"}
          onClick={() => setView("table")}
        >
          {t("주기율표", "Periodic table")}
        </button>
        <button
          aria-pressed={view === "weight"}
          onClick={() => setView("weight")}
        >
          {t("분자량 계산", "Molecular weight")}
        </button>
      </div>
      {/* Both stay mounted, so a formula or a selection survives the switch. */}
      <div hidden={view !== "table"}>
        <ElementTable />
      </div>
      <div hidden={view !== "weight"}>
        <FormulaWeight />
      </div>
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

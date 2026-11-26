import { useState, type ReactNode } from "react";
import {
  Link,
  useInRouterContext,
  useLocation,
  useSearchParams,
} from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import {
  aminoAcids,
  aminoSources,
  codonsFor,
  libraryVersion,
} from "./library";
import properties from "./data/amino-properties.json";
import { BarList, ChartFrame } from "./charts";
import { Field, Select, useText } from "./ui";
const families = [
  ["basic", "염기성 곁사슬", "Basic side chains"],
  ["acidic", "산성 곁사슬", "Acidic side chains"],
  ["polar", "극성 곁사슬", "Polar side chains"],
  ["nonpolar", "비극성 곁사슬", "Nonpolar side chains"],
  ["aromatic", "방향족 곁사슬", "Aromatic side chains"],
];
const property = (name: string) => properties.find((row) => row.name === name)!;
/** The properties the 20 amino acids can be compared by, and how each reads. */
const measures = {
  residueMass: {
    ko: "잔기 질량 (g/mol)",
    en: "Residue mass (g/mol)",
    noteKo: "펩타이드 사슬 안에서의 평균 질량: 유리 분자량 − H₂O",
    noteEn: "Average mass within a peptide chain: free weight − H₂O",
    // Four places, as the source lists them.
    text: (value: number) => value.toFixed(4),
  },
  pI: {
    ko: "등전점 (pI)",
    en: "Isoelectric point (pI)",
    noteKo: "유리 아미노산의 알짜 전하가 0이 되는 pH",
    noteEn: "pH at which the free amino acid has no net charge",
    text: (value: number) => value.toFixed(2),
  },
  hydropathy: {
    ko: "소수성 지수",
    en: "Hydropathy index",
    noteKo: "Kyte–Doolittle 척도: 양수는 소수성, 음수는 친수성",
    noteEn: "Kyte–Doolittle scale: positive is hydrophobic, negative hydrophilic",
    text: (value: number) => value.toFixed(1),
  },
} as const;
type Measure = keyof typeof measures;

/**
 * The 20 amino acids as bars for one property. With `selected`, that row is
 * named as the chosen one and the others recede; otherwise `shown` limits the
 * rows to the amino acids the list is filtered to.
 */
function PropertyChart({
  selected,
  shown,
}: {
  selected?: string;
  shown?: readonly string[];
}) {
  const t = useText(),
    [measure, setMeasure] = useState<Measure>("residueMass"),
    [order, setOrder] = useState("value");
  const meta = measures[measure];
  const rows = aminoAcids
    .filter((a) => !shown || shown.includes(a[0]))
    .map((a) => ({
      code: a[0],
      three: a[1],
      name: t(a[3], a[2]),
      value: property(a[2])[measure],
    }))
    .sort((a, b) =>
      order === "value"
        ? b.value - a.value
        : a.name.localeCompare(b.name, t("ko", "en"))
    );
  const title = t(meta.ko, meta.en);
  return (
    <section className="tool-lib-x-chart">
      <div className="tool-lib-x-chart-controls">
        <Select
          label={t("비교할 성질", "Property to compare")}
          value={measure}
          onChange={(value) => setMeasure(value as Measure)}
          options={(Object.keys(measures) as Measure[]).map(
            (key) => [key, t(measures[key].ko, measures[key].en)] as const
          )}
        />
        <Select
          label={t("정렬", "Sort")}
          value={order}
          onChange={setOrder}
          options={[
            ["value", t("값이 큰 순", "Largest first")],
            ["name", t("이름순", "By name")],
          ]}
        />
      </div>
      <ChartFrame
        title={title}
        note={t(meta.noteKo, meta.noteEn)}
        table={{
          headers: [t("아미노산", "Amino acid"), t("약어", "Code"), title],
          rows: rows.map((row) => [
            row.name,
            `${row.three} · ${row.code}`,
            meta.text(row.value),
          ]),
        }}
      >
        <BarList
          label={title}
          text={meta.text}
          rows={rows.map((row) => ({
            // The chosen row says so in words; colour alone does not carry it.
            label:
              row.code === selected
                ? `${row.name} (${row.code}) · ${t("선택", "selected")}`
                : `${row.name} (${row.code})`,
            value: row.value,
            muted: !!selected && row.code !== selected,
          }))}
        />
      </ChartFrame>
    </section>
  );
}

function Source({ source }: { source: { label: string; url: string } }) {
  return (
    <a href={source.url} target="_blank" rel="noreferrer">
      {source.label}
    </a>
  );
}

function AminoScreen({
  selected,
  onSelect,
  codonLink,
}: {
  /** One-letter code of the amino acid shown in detail, or "" for the list. */
  selected: string;
  onSelect: (code: string) => void;
  /** A link that opens the codon tool on this amino acid; absent outside the shell. */
  codonLink?: (three: string, children: ReactNode) => ReactNode;
}) {
  const t = useText(),
    [query, setQuery] = useState(""),
    [family, setFamily] = useState("all"),
    [view, setView] = useState("cards");
  const chosen = aminoAcids.find((a) => a[0] === selected),
    info = chosen && property(chosen[2]);
  // Names, codes and the side-chain class in both languages ("염기성" as well
  // as "basic").
  const matchesQuery = (a: (typeof aminoAcids)[number]) =>
    `${a.join(" ")} ${families.find((row) => row[0] === a[4])?.join(" ") ?? ""}`
      .toLowerCase()
      .includes(query.trim().toLowerCase());
  const listed = aminoAcids.filter(
    (a) => (family === "all" || a[4] === family) && matchesQuery(a)
  );
  const pKa = (value: number | null) => (value == null ? "—" : value.toFixed(2));
  return (
    <section>
      {chosen && info ? (
        <section className="tool-amino-detail">
          <button className="tool-button-inline" onClick={() => onSelect("")}>
            <ArrowLeft size={17} />
            {t("목록으로", "Back to list")}
          </button>
          <h2>
            {t(chosen[3], chosen[2])}{" "}
            <small>
              {chosen[1]} · {chosen[0]}
            </small>
          </h2>
          <svg
            className="tool-amino-detail-structure tool-lib-x-structure"
            viewBox={info.viewBox}
            role="img"
            aria-label={`${t(chosen[3], chosen[2])} ${t(
              "구조식",
              "structure"
            )}`}
          >
            <image href={info.image} width="300" height="300" />
          </svg>
          <dl className="tool-property-list">
            <div>
              <dt>{t("분자식", "Molecular formula")}</dt>
              <dd>{info.formula}</dd>
            </div>
            <div>
              <dt>
                {t("유리 아미노산 분자량", "Free amino acid molecular weight")}
              </dt>
              <dd>{info.mw} g/mol</dd>
            </div>
            <div>
              <dt>
                {t("잔기 질량 (평균, −H₂O)", "Residue mass (average, −H₂O)")}
              </dt>
              <dd>{measures.residueMass.text(info.residueMass)} g/mol</dd>
            </div>
            <div>
              <dt>pKa (α-COOH)</dt>
              <dd>{pKa(info.pKaCarboxyl)}</dd>
            </div>
            <div>
              <dt>pKa (α-NH₃⁺)</dt>
              <dd>{pKa(info.pKaAmino)}</dd>
            </div>
            <div>
              <dt>{t("pKa (곁사슬)", "pKa (side chain)")}</dt>
              <dd>
                {info.pKaSideChain == null
                  ? t("이온화하는 곁사슬 없음", "No ionizable side chain")
                  : pKa(info.pKaSideChain)}
              </dd>
            </div>
            <div>
              <dt>{t("등전점 (pI)", "Isoelectric point (pI)")}</dt>
              <dd>{pKa(info.pI)}</dd>
            </div>
            <div>
              <dt>
                {t(
                  "소수성 지수 (Kyte–Doolittle)",
                  "Hydropathy index (Kyte–Doolittle)"
                )}
              </dt>
              <dd>{info.hydropathy.toFixed(1)}</dd>
            </div>
            <div>
              <dt>{t("구조 표기", "Structure notation")}</dt>
              <dd className="tool-smiles">{info.smiles}</dd>
            </div>
          </dl>
          <p className="tool-muted tool-lib-x-sources">
            {t("출처", "Sources")}: pKa · pI —{" "}
            <Source source={aminoSources.ionization} />;{" "}
            {t("잔기 질량", "residue mass")} —{" "}
            <Source source={aminoSources.residueMass} />;{" "}
            {t("소수성 지수", "hydropathy index")} —{" "}
            <Source source={aminoSources.hydropathy} />;{" "}
            {t("분자식 · 분자량 · 구조", "formula, weight and structure")} —{" "}
            <a
              href={`https://pubchem.ncbi.nlm.nih.gov/compound/${info.cid}`}
              target="_blank"
              rel="noreferrer"
            >
              PubChem CID {info.cid}
            </a>
          </p>
          <section className="tool-lib-x-codons">
            <h3>{t("코돈 (표준 유전암호)", "Codons (standard genetic code)")}</h3>
            <ul>
              {codonsFor(chosen[0]).map((codon) => (
                <li key={codon}>
                  <code>{codon}</code>
                  {codon === "AUG" && <em>{t("시작", "Start")}</em>}
                </li>
              ))}
            </ul>
            <p className="tool-muted">
              {t(
                "mRNA 표기입니다. DNA 서열에서는 U 대신 T로 읽습니다.",
                "Written as mRNA. In a DNA sequence read T for U."
              )}
            </p>
            {codonLink?.(chosen[1], t("코돈 도구에서 보기", "Open in the codon tool"))}
          </section>
          <PropertyChart selected={chosen[0]} />
        </section>
      ) : (
        <>
          <div className="tool-library-filters">
            <Field
              label={t("이름·약어 검색", "Search name or code")}
              type="search"
              value={query}
              onChange={setQuery}
            />
            <Select
              label={t("곁사슬 분류", "Side-chain class")}
              value={family}
              onChange={setFamily}
              options={[
                ["all", t("전체", "All")],
                ...families.map((row) => [row[0], t(row[1], row[2])] as const),
              ]}
            />
          </div>
          <div
            className="tool-actions tool-lib-x-switch"
            role="group"
            aria-label={t("아미노산 보기", "Amino acid view")}
          >
            <button
              aria-pressed={view === "cards"}
              onClick={() => setView("cards")}
            >
              {t("구조식 카드", "Structure cards")}
            </button>
            <button
              aria-pressed={view === "compare"}
              onClick={() => setView("compare")}
            >
              {t("성질 비교", "Compare properties")}
            </button>
          </div>
          {!listed.length ? (
            <p className="tool-empty">
              {t("검색 결과가 없습니다.", "No matching amino acids.")}
            </p>
          ) : view === "compare" ? (
            <PropertyChart shown={listed.map((a) => a[0])} />
          ) : (
            families
              .filter((row) => family === "all" || family === row[0])
              .map(([id, ko, en]) => {
                const list = listed.filter((a) => a[4] === id);
                return list.length ? (
                  <section className="tool-amino-group" key={id}>
                    <h2>{t(ko, en)}</h2>
                    <div className="tool-amino-grid">
                      {list.map((a) => {
                        const data = property(a[2]);
                        return (
                          <button
                            className="tool-amino-card"
                            key={a[0]}
                            onClick={() => onSelect(a[0])}
                          >
                            <div>
                              <strong>{t(a[3], a[2])}</strong>
                              <span>
                                {a[1]} · {a[0]}
                              </span>
                            </div>
                            <svg
                              className="tool-amino-structure tool-lib-x-structure"
                              viewBox={data.viewBox}
                              role="img"
                              aria-label={`${t(a[3], a[2])} ${t(
                                "구조식",
                                "structure"
                              )}`}
                            >
                              <image
                                href={data.image}
                                width="300"
                                height="300"
                              />
                            </svg>
                            <p>
                              {data.formula}
                              <span>{data.mw} g/mol</span>
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ) : null;
              })
          )}
        </>
      )}
      <details className="tool-guide">
        <summary>
          {t("자료와 구조식 기준", "Data and structure conventions")}
        </summary>
        <p>
          {t(
            "표준 아미노산 20종의 유리 분자 자료입니다. 구조식은 글리신을 제외하고 L형이며, 용액의 pH에 따른 실제 이온화 상태를 나타내지는 않습니다. 펩타이드 잔기 질량은 유리 분자량에서 물 한 분자를 뺀 값입니다.",
            "Reference data for the 20 standard free amino acids. Structures are L forms except achiral glycine; drawings do not specify ionization at a solution pH. A peptide residue mass is the free molecular weight less one water."
          )}
        </p>
        <p>
          {t(
            "pKa와 pI는 유리 아미노산의 값을 출처 표에 실린 그대로 옮긴 것입니다. 단백질 안에서 곁사슬의 pKa는 주변 환경에 따라 달라집니다.",
            "pKa and pI are values for the free amino acid, as printed in the source table. Within a protein a side chain's pKa shifts with its surroundings."
          )}
        </p>
        <ul className="tool-lib-x-source-list">
          <li>
            {t("분자식 · 분자량 · 구조", "Formula, weight and structure")}:{" "}
            <a
              href="https://pubchem.ncbi.nlm.nih.gov/"
              target="_blank"
              rel="noreferrer"
            >
              PubChem · {libraryVersion}
            </a>
          </li>
          <li>
            pKa · pI: <Source source={aminoSources.ionization} /> ·{" "}
            {aminoSources.ionization.checked}
          </li>
          <li>
            {t("잔기 질량", "Residue mass")}:{" "}
            <Source source={aminoSources.residueMass} /> ·{" "}
            {aminoSources.residueMass.checked}
          </li>
          <li>
            {t("소수성 지수", "Hydropathy index")}:{" "}
            <Source source={aminoSources.hydropathy} /> ·{" "}
            {aminoSources.hydropathy.checked}
          </li>
        </ul>
      </details>
    </section>
  );
}

/**
 * Inside the shell the amino acid on show lives in the address (`?aa=K`): the
 * codon tool can link straight to it, and coming back from another tool
 * returns to it. The entry is replaced rather than added, so Back still leaves
 * the tool as it did.
 */
function AddressedAmino() {
  const [params, setParams] = useSearchParams(),
    location = useLocation();
  const asked = (params.get("aa") ?? "").toUpperCase();
  return (
    <AminoScreen
      selected={aminoAcids.some((a) => a[0] === asked) ? asked : ""}
      onSelect={(code) => {
        const next = new URLSearchParams(params);
        if (code) next.set("aa", code);
        else next.delete("aa");
        setParams(next, { replace: true, state: location.state });
      }}
      codonLink={(three, children) => (
        <Link
          className="tool-button tool-lib-x-link"
          to={`/app/tools/codons?q=${three}`}
          state={location.state}
        >
          {children}
        </Link>
      )}
    />
  );
}
function StandaloneAmino() {
  const [selected, setSelected] = useState("");
  return <AminoScreen selected={selected} onSelect={setSelected} />;
}
export default function AminoTool() {
  // Rendered on its own (a test, a preview) there is no address to keep the
  // selection in, and the screen keeps it itself.
  return useInRouterContext() ? <AddressedAmino /> : <StandaloneAmino />;
}

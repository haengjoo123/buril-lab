import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { aminoAcids, libraryVersion } from "./library";
import properties from "./data/amino-properties.json";
import { Field, Select, useText } from "./ui";
const families = [
  ["basic", "염기성 곁사슬", "Basic side chains"],
  ["acidic", "산성 곁사슬", "Acidic side chains"],
  ["polar", "극성 곁사슬", "Polar side chains"],
  ["nonpolar", "비극성 곁사슬", "Nonpolar side chains"],
  ["aromatic", "방향족 곁사슬", "Aromatic side chains"],
];
export default function AminoTool() {
  const t = useText(),
    [query, setQuery] = useState(""),
    [family, setFamily] = useState("all"),
    [selected, setSelected] = useState("");
  const chosen = aminoAcids.find((a) => a[0] === selected),
    info = chosen && properties.find((row) => row.name === chosen[2]);
  return (
    <section>
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
      {chosen && info ? (
        <section className="tool-amino-detail">
          <button
            className="tool-button-inline"
            onClick={() => setSelected("")}
          >
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
            className="tool-amino-detail-structure"
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
              <dt>{t("구조 표기", "Structure notation")}</dt>
              <dd className="tool-smiles">{info.smiles}</dd>
            </div>
          </dl>
          <a
            href={`https://pubchem.ncbi.nlm.nih.gov/compound/${info.cid}`}
            target="_blank"
            rel="noreferrer"
          >
            PubChem CID {info.cid}
          </a>
        </section>
      ) : (
        families
          .filter((row) => family === "all" || family === row[0])
          .map(([id, ko, en]) => {
            const list = aminoAcids.filter(
              (a) =>
                a[4] === id &&
                a.join(" ").toLowerCase().includes(query.trim().toLowerCase())
            );
            return list.length ? (
              <section className="tool-amino-group" key={id}>
                <h2>{t(ko, en)}</h2>
                <div className="tool-amino-grid">
                  {list.map((a) => {
                    const data = properties.find((row) => row.name === a[2])!;
                    return (
                      <button
                        className="tool-amino-card"
                        key={a[0]}
                        onClick={() => setSelected(a[0])}
                      >
                        <div>
                          <strong>{t(a[3], a[2])}</strong>
                          <span>
                            {a[1]} · {a[0]}
                          </span>
                        </div>
                        <svg
                          className="tool-amino-structure"
                          viewBox={data.viewBox}
                          role="img"
                          aria-label={`${t(a[3], a[2])} ${t(
                            "구조식",
                            "structure"
                          )}`}
                        >
                          <image href={data.image} width="300" height="300" />
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
      {!chosen &&
        !aminoAcids.some(
          (a) =>
            (family === "all" || a[4] === family) &&
            a.join(" ").toLowerCase().includes(query.trim().toLowerCase())
        ) && (
          <p className="tool-empty">
            {t("검색 결과가 없습니다.", "No matching amino acids.")}
          </p>
        )}
      <details className="tool-guide">
        <summary>
          {t("자료와 구조식 기준", "Data and structure conventions")}
        </summary>
        <p>
          {t(
            "표준 아미노산 20종의 유리 분자 자료입니다. 구조식은 글리신을 제외하고 L형이며, 용액의 pH에 따른 실제 이온화 상태를 나타내지는 않습니다. 펩타이드 잔기 질량과 유리 분자량은 다릅니다.",
            "Reference data for the 20 standard free amino acids. Structures are L forms except achiral glycine; drawings do not specify ionization at a solution pH. Peptide residue masses differ from free amino acid molecular weights."
          )}
        </p>
        <a
          href="https://pubchem.ncbi.nlm.nih.gov/"
          target="_blank"
          rel="noreferrer"
        >
          PubChem · {libraryVersion}
        </a>
      </details>
    </section>
  );
}

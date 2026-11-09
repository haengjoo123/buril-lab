import { useState } from "react";
import CodonWheel from "./CodonWheel";
import {
  aminoAcids,
  codons,
  geneticCodeSource,
  libraryVersion,
} from "./library";
import { Field, useText } from "./ui";
export default function CodonTool() {
  const t = useText(),
    [query, setQuery] = useState(""),
    [view, setView] = useState("table"),
    [dna, setDna] = useState(false),
    [zoom, setZoom] = useState(false);
  const normalized = query.trim().toUpperCase().replaceAll("T", "U");
  const matches = codons.filter(
    (c) =>
      `${c.codon} ${c.amino} ${
        aminoAcids.find((a) => a[0] === c.amino)?.join(" ") ?? t("종결", "Stop")
      }`
        .toLowerCase()
        .includes(query.toLowerCase().trim()) || c.codon.startsWith(normalized)
  );
  const name = (amino: string) => {
    const a = aminoAcids.find((row) => row[0] === amino);
    return a ? t(a[3], a[2]) : t("종결", "Stop");
  };
  const show = (codon: string) => (dna ? codon.replaceAll("U", "T") : codon);
  const row = (c: (typeof codons)[number]) => (
    <button
      key={c.codon}
      className={`tool-codon-entry ${
        c.amino === "*" ? "stop" : c.codon === "AUG" ? "start" : ""
      }`}
      aria-pressed={normalized === c.codon}
      onClick={() => setQuery(show(c.codon))}
    >
      <strong>{show(c.codon)}</strong>
      <span>
        {name(c.amino)} <small>{c.amino}</small>
      </span>
      {c.codon === "AUG" && <em>{t("시작", "Start")}</em>}
    </button>
  );
  return (
    <section>
      <div className="tool-library-filters">
        <Field
          type="search"
          label={t("코돈·아미노산 검색", "Search codon or amino acid")}
          value={query}
          onChange={setQuery}
        />
      </div>
      <div className="tool-codon-controls">
        <div
          className="tool-actions"
          role="group"
          aria-label={t("코돈 보기", "Codon view")}
        >
          <button
            aria-pressed={view === "table"}
            onClick={() => setView("table")}
          >
            {t("코돈 표", "Codon table")}
          </button>
          <button
            aria-pressed={view === "wheel"}
            onClick={() => setView("wheel")}
          >
            {t("코돈 휠", "Codon wheel")}
          </button>
        </div>
        <div
          className="tool-actions"
          role="group"
          aria-label={t("염기 표기", "Base notation")}
        >
          <button aria-pressed={!dna} onClick={() => setDna(false)}>
            RNA
          </button>
          <button aria-pressed={dna} onClick={() => setDna(true)}>
            DNA
          </button>
        </div>
      </div>
      <p className="tool-codon-reading">
        5′ → 3′{" "}
        <span>
          {view === "wheel"
            ? t("중심에서 바깥쪽으로", "Read from center outward")
            : t("첫째 → 둘째 → 셋째 염기", "First → second → third base")}
        </span>
      </p>
      {query && (
        <div className="tool-codon-results">
          <div className="tool-actions">
            <strong>
              {matches.length}{" "}
              {t("개 코돈", matches.length === 1 ? "codon" : "codons")}
            </strong>
            <button onClick={() => setQuery("")}>
              {t("검색 지우기", "Clear search")}
            </button>
          </div>
          {matches.length ? (
            <div className="tool-codon-match-grid">{matches.map(row)}</div>
          ) : (
            <p>{t("검색 결과가 없습니다.", "No matching codons.")}</p>
          )}
        </div>
      )}
      {view === "wheel" ? (
        <>
          <button onClick={() => setZoom(!zoom)} aria-pressed={zoom}>
            {t(
              zoom ? "크기 맞추기" : "크게 보기",
              zoom ? "Fit to screen" : "Enlarge"
            )}
          </button>
          <div className="tool-wheel-scroll">
            <div style={{ minWidth: zoom ? 680 : undefined }}>
              <CodonWheel
                onSelect={(value) => setQuery(show(value))}
                selected={normalized}
                dna={dna}
              />
            </div>
          </div>
        </>
      ) : (
        !query && (
          <div className="tool-table-wrap">
            <table className="tool-codon-table">
              <caption>
                {t(
                  "행은 첫째 염기, 열은 둘째 염기입니다.",
                  "Rows: first base. Columns: second base."
                )}
              </caption>
              <thead>
                <tr>
                  <th>5′</th>
                  {[..."UCAG"].map((base) => (
                    <th key={base}>{show(base)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[..."UCAG"].map((first) => (
                  <tr key={first}>
                    <th scope="row">{show(first)}</th>
                    {[..."UCAG"].map((second) => (
                      <td key={second}>
                        {codons
                          .filter((c) => c.codon.startsWith(first + second))
                          .map(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
      <p className="tool-codon-legend">
        <span className="start">
          {t("시작", "Start")} {dna ? "ATG" : "AUG"}
        </span>
        <span className="stop">
          {t("종결", "Stop")} {dna ? "TAA · TAG · TGA" : "UAA · UAG · UGA"}
        </span>
      </p>
      <details className="tool-guide">
        <summary>
          {t("유전암호 기준과 출처", "Genetic code and source")}
        </summary>
        <p>
          {t(
            "표준 유전암호(표 1)입니다. 시작 코돈 표시는 대표적인 AUG를 가리킵니다. 실제 번역 시작과 미토콘드리아 등 대체 암호는 생물과 맥락에 따라 다릅니다.",
            "Standard genetic code (table 1). AUG marks the canonical start codon. Initiation context and alternative codes, including mitochondrial codes, differ between organisms."
          )}
        </p>
        <a href={geneticCodeSource} target="_blank" rel="noreferrer">
          NCBI Standard Code 1 · {libraryVersion}
        </a>
      </details>
    </section>
  );
}

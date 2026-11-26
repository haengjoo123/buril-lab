import { useId, useState, type ReactNode } from "react";
import {
  Link,
  useInRouterContext,
  useLocation,
  useNavigate,
} from "react-router-dom";
import CodonWheel from "./CodonWheel";
import {
  aminoAcids,
  codons,
  geneticCodeSource,
  libraryVersion,
  searchCodons,
  type Codon,
} from "./library";
import { translateSequence, type ReadingFrame } from "./translate";
import { CheckButton, CopyButton, Field, useText } from "./ui";

/** Translation of a pasted sequence in the three reading frames of each strand. */
function Translator() {
  const t = useText(),
    [text, setText] = useState(""),
    [both, setBoth] = useState(false);
  const read = translateSequence(text);
  const frames = (list: ReadingFrame[], sign: string) =>
    list.map(({ frame, protein, trailing }) => (
      <div className="tool-lib-x-frame" key={sign + frame}>
        <div>
          <strong>
            {sign}
            {frame}
          </strong>
          <span>
            {protein.length} {t("코돈", protein.length === 1 ? "codon" : "codons")}
            {trailing > 0 &&
              ` · ${t(
                `남는 염기 ${trailing}개`,
                `${trailing} ${trailing === 1 ? "base" : "bases"} left over`
              )}`}
          </span>
          <CopyButton
            text={protein}
            disabled={!protein}
            label={t(
              `읽기틀 ${sign}${frame} 번역 복사`,
              `Copy frame ${sign}${frame} translation`
            )}
          />
        </div>
        <output className="tool-lib-x-sequence">{protein || "—"}</output>
      </div>
    ));
  return (
    <section className="tool-lib-x-translate">
      <label className="tool-field">
        <span>{t("DNA 또는 RNA 서열 (5′→3′)", "DNA or RNA sequence (5′→3′)")}</span>
        <textarea
          rows={4}
          className="tool-lib-x-sequence"
          spellCheck={false}
          autoCapitalize="characters"
          autoComplete="off"
          placeholder="ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <p className="tool-muted">
        {t(
          "공백·숫자·5′/3′ 표시와 FASTA 제목 줄(>)은 무시합니다. 표준 유전암호(표 1)로 번역하며 종결 코돈은 *, A·C·G·T/U가 아닌 염기가 든 코돈은 X로 표시합니다.",
          "Spaces, digits, 5′/3′ marks and FASTA header lines (>) are ignored. Translation uses the standard genetic code (table 1): * is a stop codon and X a codon with a base other than A, C, G or T/U."
        )}
      </p>
      {read.sequence ? (
        <>
          <p className="tool-muted" role="status">
            {read.rna ? "RNA" : "DNA"} · {read.sequence.length} nt
            {read.unknown > 0 &&
              ` · ${t(
                `A·C·G·${read.rna ? "U" : "T"}가 아닌 글자 ${read.unknown}개`,
                `${read.unknown} ${
                  read.unknown === 1 ? "letter" : "letters"
                } other than A, C, G and ${read.rna ? "U" : "T"}`
              )}`}
          </p>
          <h3>{t("번역 · 읽기틀 +1, +2, +3", "Translation · frames +1, +2, +3")}</h3>
          {frames(read.forward, "+")}
          <h3>{t("역상보 가닥 (5′→3′)", "Reverse complement (5′→3′)")}</h3>
          <div className="tool-lib-x-frame">
            <div>
              <span>
                {read.sequence.length} nt
                {read.unknown > 0 &&
                  ` · ${t(
                    "읽을 수 없는 염기는 N으로 표시",
                    "bases that cannot be read are written N"
                  )}`}
              </span>
              <CopyButton
                text={read.reverse}
                label={t("역상보 서열 복사", "Copy reverse complement")}
              />
            </div>
            <output className="tool-lib-x-sequence">{read.reverse}</output>
          </div>
          <CheckButton checked={both} onChange={setBoth}>
            {t(
              "역상보 가닥의 읽기틀(−1, −2, −3)도 번역",
              "Also translate the reverse-complement frames (−1, −2, −3)"
            )}
          </CheckButton>
          {both && frames(read.backward, "−")}
        </>
      ) : (
        <p className="tool-muted" role="status">
          {t(
            "서열을 붙여 넣으면 세 읽기틀의 번역과 역상보 가닥을 보여 줍니다.",
            "Paste a sequence to see its translation in three reading frames and its reverse complement."
          )}
        </p>
      )}
    </section>
  );
}

function CodonScreen({
  seed = "",
  aminoLink,
}: {
  /** The search to open with, from a link in another tool. */
  seed?: string;
  /**
   * A link that opens the amino acid tool on one amino acid; absent outside
   * the shell. It is given the current search so the address can keep it.
   */
  aminoLink?: (code: string, query: string, children: ReactNode) => ReactNode;
}) {
  const t = useText(),
    hint = useId(),
    [query, setQuery] = useState(seed),
    [applied, setApplied] = useState(seed),
    [view, setView] = useState("table"),
    [dna, setDna] = useState(false),
    [zoom, setZoom] = useState(false);
  // Another link to this tool, followed while it is open, starts a new search.
  if (applied !== seed) {
    setApplied(seed);
    setQuery(seed);
  }
  const normalized = query.trim().toUpperCase().replaceAll("T", "U");
  const found = searchCodons(query),
    matches = [...found.exact, ...found.partial];
  const name = (amino: string) => {
    const a = aminoAcids.find((row) => row[0] === amino);
    return a ? t(a[3], a[2]) : t("종결", "Stop");
  };
  const show = (codon: string) => (dna ? codon.replaceAll("U", "T") : codon);
  const row = (c: Codon) => (
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
  // The amino acids the search names outright; a wide pattern names too many
  // to offer each one a link.
  const named = aminoAcids.filter((a) =>
    found.exact.some((c) => c.amino === a[0])
  );
  const translating = view === "translate";
  return (
    <section>
      {!translating && (
        <div className="tool-library-filters">
          <Field
            type="search"
            label={t("코돈·아미노산 검색", "Search codon or amino acid")}
            value={query}
            onChange={setQuery}
          />
        </div>
      )}
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
          <button
            aria-pressed={translating}
            onClick={() => setView("translate")}
          >
            {t("서열 번역", "Translate")}
          </button>
        </div>
        {!translating && (
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
        )}
      </div>
      {translating ? (
        <Translator />
      ) : (
        <>
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
              {found.exact.length > 0 && (
                <>
                  <h3 className="tool-lib-x-match">
                    {t("정확히 일치", "Exact match")} · {found.exact.length}
                  </h3>
                  <div className="tool-codon-match-grid">
                    {found.exact.map(row)}
                  </div>
                  {aminoLink && named.length > 0 && named.length <= 4 && (
                    <div className="tool-actions">
                      {named.map((a) =>
                        aminoLink(
                          a[0],
                          query,
                          t(
                            `${a[3]} (${a[1]}) 아미노산 정보`,
                            `${a[2]} (${a[1]}) amino acid details`
                          )
                        )
                      )}
                    </div>
                  )}
                </>
              )}
              {found.partial.length > 0 && (
                <>
                  <h3 className="tool-lib-x-match">
                    {t("부분 일치", "Partial match")} · {found.partial.length}
                  </h3>
                  <div className="tool-codon-match-grid">
                    {found.partial.map(row)}
                  </div>
                </>
              )}
              {!matches.length && (
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
              <p id={hint} className="tool-muted tool-lib-x-keys">
                {t(
                  "키보드: ← → 같은 고리에서 이동, ↑ 안쪽 고리, ↓ 바깥쪽 고리, Enter 선택",
                  "Keyboard: ← → move around a ring, ↑ inner ring, ↓ outer ring, Enter selects"
                )}
              </p>
              <div className="tool-wheel-scroll">
                <div style={{ minWidth: zoom ? 680 : undefined }}>
                  <CodonWheel
                    // An inner sector stands for every codon that begins with
                    // its bases: N for the positions it leaves open.
                    onSelect={(bases) => setQuery(show(bases.padEnd(3, "N")))}
                    selected={
                      /^[ACGU]{1,3}N{0,2}$/.test(normalized) &&
                      normalized.length === 3
                        ? normalized.replace(/N+$/, "")
                        : ""
                    }
                    highlight={
                      query.trim()
                        ? (found.exact.length
                            ? found.exact
                            : found.partial
                          ).map((c) => c.codon)
                        : null
                    }
                    dna={dna}
                    describedBy={hint}
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
        </>
      )}
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

/**
 * Inside the shell a link from the amino acid tool opens this one on a search
 * (`?q=Lys`). The search itself stays in the screen while it is typed; it is
 * written to the address only on the way out to the amino acid tool, so that
 * Back returns to the same results.
 */
function AddressedCodon() {
  const location = useLocation(),
    navigate = useNavigate();
  return (
    <CodonScreen
      seed={new URLSearchParams(location.search).get("q") ?? ""}
      aminoLink={(code, query, children) => (
        <Link
          key={code}
          className="tool-button tool-lib-x-link"
          to={`/app/tools/amino-acids?aa=${code}`}
          state={location.state}
          onClick={() => {
            const kept = new URLSearchParams(location.search);
            if (query.trim()) kept.set("q", query.trim());
            else kept.delete("q");
            navigate(
              { pathname: location.pathname, search: kept.toString() },
              { replace: true, state: location.state }
            );
          }}
        >
          {children}
        </Link>
      )}
    />
  );
}
export default function CodonTool() {
  // Rendered on its own (a test, a preview) there is no address to read.
  return useInRouterContext() ? <AddressedCodon /> : <CodonScreen />;
}

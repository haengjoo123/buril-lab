import { useContext } from "react";
import {
  ToolContext,
  useText,
  useToolData,
  Panel,
  NumberField,
  CheckButton,
  CopyButton,
  ErrorMessage,
  calculate,
  need,
  format,
  plainNumber,
} from "./ui";
import {
  cleanSequence,
  duplexThermodynamics,
  gcPercent,
  invalidBases,
  longestRun,
  meltingTemperature,
  oligoMolecularWeight,
  resuspensionVolume,
  reverseComplement,
  wallaceTemperature,
} from "./oligo";
import { ChartFrame } from "./charts";

/**
 * The sequence as a strip of bases with G and C filled, so a GC-rich stretch
 * or 3′ end shows at a glance. The last five bases (the 3′ end that the
 * polymerase extends from) are underlined.
 */
function BaseStrip({ sequence }: { sequence: string }) {
  const t = useText();
  const gc = [...sequence].filter((b) => b === "G" || b === "C").length;
  return (
    <ChartFrame
      title={t("염기 배열", "Base composition along the sequence")}
      note={t(
        "G/C는 채운 칸, 밑줄은 3′ 말단 5염기",
        "G/C are the filled cells; the underline marks the last 5 bases (3′)"
      )}
      legend={[
        { label: `G/C ${gc}`, slot: 1 },
        { label: `A/T ${sequence.length - gc}`, slot: "other" },
      ]}
    >
      <div
        className="tool-primer-strip"
        role="img"
        aria-label={t(
          `5′에서 3′ 방향 ${sequence.length}염기 중 G/C ${gc}개`,
          `${sequence.length} bases 5′ to 3′, ${gc} of them G/C`
        )}
      >
        <span aria-hidden="true">5′</span>
        {[...sequence].map((base, index) => (
          <i
            key={index}
            aria-hidden="true"
            data-gc={base === "G" || base === "C" ? "" : undefined}
            data-end={index >= sequence.length - 5 ? "" : undefined}
          >
            {base}
          </i>
        ))}
        <span aria-hidden="true">3′</span>
      </div>
    </ChartFrame>
  );
}

export default function PrimerTool() {
  const t = useText(),
    ctx = useContext(ToolContext);
  const [d, set] = useToolData({
    sequence: "",
    oligoNm: "250",
    sodiumMm: "50",
    phosphate: false,
    amountNmol: "",
    stockUm: "100",
  });
  const sequence = cleanSequence(d.sequence),
    invalid = invalidBases(sequence);
  const facts = calculate(() => {
    if (!sequence) need("");
    if (invalid.length) throw Error("Sequence may contain only A, C, G and T");
    return {
      length: sequence.length,
      gc: gcPercent(sequence),
      weight: oligoMolecularWeight(sequence, d.phosphate),
      wallace: wallaceTemperature(sequence),
      selfComplementary:
        sequence.length > 1 && duplexThermodynamics(sequence).selfComplementary,
      run: longestRun(sequence),
      endGc: [...sequence.slice(-5)].filter((b) => b === "G" || b === "C")
        .length,
      reverse: reverseComplement(sequence),
    };
  });
  const tm = calculate(() => {
    if (!facts.value) need("");
    return meltingTemperature(
      sequence,
      need(d.oligoNm) * 1e-9,
      need(d.sodiumMm) * 1e-3
    );
  });
  const stock = calculate(() => {
    const nmol = need(d.amountNmol),
      um = need(d.stockUm);
    return {
      volume: resuspensionVolume(nmol, um),
      micrograms: facts.value ? (nmol * facts.value.weight) / 1000 : null,
      um,
    };
  });
  const f = facts.value;
  const summary = () =>
    f
      ? [
          `5′-${sequence}-3′`,
          `${t("길이", "Length")}: ${f.length} nt`,
          `GC: ${f.gc.toFixed(1)}%`,
          tm.value != null
            ? `Tm: ${plainNumber(tm.value, 4)} °C (${t(
                "최근접 이웃",
                "nearest neighbour"
              )}, ${d.oligoNm} nM, Na⁺ ${d.sodiumMm} mM)`
            : "",
          `${t("분자량", "Molecular weight")}: ${plainNumber(f.weight, 7)} g/mol`,
        ]
          .filter(Boolean)
          .join("\n")
      : "";
  return (
    <>
      <Panel>
        <label className="tool-field">
          <span>{t("서열 (5′→3′)", "Sequence (5′→3′)")}</span>
          <textarea
            rows={3}
            className="tool-primer-sequence"
            spellCheck={false}
            autoCapitalize="characters"
            autoComplete="off"
            placeholder="GTAAAACGACGGCCAGT"
            value={d.sequence}
            onChange={(event) => set({ ...d, sequence: event.target.value })}
          />
        </label>
        <p className="tool-muted">
          {t(
            "공백·숫자·5′/3′ 표시는 무시하고 U는 T로 읽습니다. A, C, G, T만 계산합니다.",
            "Spaces, digits and 5′/3′ marks are ignored and U is read as T. Only A, C, G and T are calculated."
          )}
        </p>
        <div className="tool-grid">
          <NumberField
            label={t("올리고 농도 (nM)", "Oligo concentration (nM)")}
            value={d.oligoNm}
            onChange={(oligoNm) => set({ ...d, oligoNm })}
          />
          <NumberField
            label={t("Na⁺ 농도 (mM)", "Na⁺ concentration (mM)")}
            value={d.sodiumMm}
            onChange={(sodiumMm) => set({ ...d, sodiumMm })}
          />
        </div>
        <CheckButton
          checked={d.phosphate}
          onChange={(phosphate) => set({ ...d, phosphate })}
        >
          {t("5′ 인산화 올리고", "5′-phosphorylated oligo")}
        </CheckButton>
        <ErrorMessage message={facts.error || tm.error} />
        {facts.incomplete && (
          <p className="tool-muted" role="status">
            {t(
              "서열을 입력하면 길이, GC 함량, Tm, 분자량을 계산합니다.",
              "Enter a sequence to calculate length, GC content, Tm and molecular weight."
            )}
          </p>
        )}
      </Panel>
      {f && (
        <Panel title={t("결과", "Result")}>
          <BaseStrip sequence={sequence} />
          <dl className="tool-property-list">
            <div>
              <dt>{t("길이", "Length")}</dt>
              <dd>{f.length} nt</dd>
            </div>
            <div>
              <dt>{t("GC 함량", "GC content")}</dt>
              <dd>{f.gc.toFixed(1)}%</dd>
            </div>
            <div>
              <dt>{t("Tm (최근접 이웃)", "Tm (nearest neighbour)")}</dt>
              <dd>
                {tm.value != null ? `${plainNumber(tm.value, 3)} °C` : "—"}
              </dd>
            </div>
            <div>
              <dt>{t("Tm (2 + 4 규칙)", "Tm (2 + 4 rule)")}</dt>
              <dd>{f.wallace} °C</dd>
            </div>
            <div>
              <dt>{t("분자량", "Molecular weight")}</dt>
              <dd>{format(f.weight)} g/mol</dd>
            </div>
            <div>
              <dt>{t("3′ 말단 5염기 중 G/C", "G/C in the last 5 bases (3′)")}</dt>
              <dd>{f.endGc}</dd>
            </div>
            <div>
              <dt>{t("같은 염기 최대 연속", "Longest single-base run")}</dt>
              <dd>{f.run}</dd>
            </div>
          </dl>
          {f.selfComplementary && (
            <p className="tool-muted" role="status">
              {t(
                "자기 상보 서열입니다(역상보가 자신과 같음). Tm은 자기 상보 식으로 계산했습니다.",
                "Self-complementary (its reverse complement is itself). Tm uses the self-complementary form."
              )}
            </p>
          )}
          <label className="tool-field">
            <span>{t("역상보 서열 (5′→3′)", "Reverse complement (5′→3′)")}</span>
            <output className="tool-primer-sequence">{f.reverse}</output>
          </label>
          <div className="tool-actions">
            <CopyButton text={f.reverse}>
              {t("역상보 복사", "Copy reverse complement")}
            </CopyButton>
            <CopyButton text={summary}>{t("결과 복사", "Copy result")}</CopyButton>
          </div>
          <details className="tool-guide">
            <summary>{t("계산 기준", "How this is calculated")}</summary>
            <p>
              {t(
                "Tm은 SantaLucia(1998)의 최근접 이웃 매개변수와 Na⁺ 보정을 쓴 값으로, 상보 가닥과 완전히 결합한다고 가정합니다. 중합효소 제조사 계산기는 Mg²⁺·dNTP 보정을 더해 몇 °C 다를 수 있으니 annealing 온도는 사용하는 효소의 안내를 따르세요. 2 + 4 규칙은 14 nt 이하의 짧은 올리고에만 어림값으로 쓰입니다.",
                "Tm uses the nearest-neighbour parameters and Na⁺ correction of SantaLucia (1998) and assumes a perfect complement. Polymerase vendors' calculators add Mg²⁺/dNTP corrections and can differ by several °C, so follow your enzyme's guidance for annealing. The 2 + 4 rule is a rough figure for oligos of 14 nt or fewer."
              )}
            </p>
            <p>
              {t(
                "분자량은 염기별 잔기 질량(A 313.2, T 304.2, C 289.2, G 329.2; Thermo Fisher)에 5′-OH 합성 올리고의 말단 보정(−61.96)을 더한 값입니다.",
                "Molecular weight sums residue masses (A 313.2, T 304.2, C 289.2, G 329.2; Thermo Fisher) with the end correction for a 5′-OH synthetic oligo (−61.96)."
              )}
            </p>
          </details>
        </Panel>
      )}
      <Panel title={t("원액 만들기", "Make a stock")}>
        <div className="tool-grid">
          <NumberField
            label={t("받은 양 (nmol)", "Amount received (nmol)")}
            value={d.amountNmol}
            onChange={(amountNmol) => set({ ...d, amountNmol })}
          />
          <NumberField
            label={t("원액 농도 (µM)", "Stock concentration (µM)")}
            value={d.stockUm}
            onChange={(stockUm) => set({ ...d, stockUm })}
          />
        </div>
        <ErrorMessage message={stock.error} />
        {stock.incomplete && (
          <p className="tool-muted" role="status">
            {t(
              "튜브 라벨의 nmol 값을 입력하면 넣을 부피를 계산합니다.",
              "Enter the nmol printed on the tube to get the volume to add."
            )}
          </p>
        )}
        {stock.value && (
          <>
            <output className="tool-result">
              {t("넣을 부피", "Volume to add")}: {format(stock.value.volume)} µL
              {stock.value.micrograms != null &&
                `\n${t("올리고 질량", "Oligo mass")}: ${format(
                  stock.value.micrograms
                )} µg`}
            </output>
            <div className="tool-actions">
              <CopyButton
                text={`${plainNumber(stock.value.volume, 6)} µL → ${
                  d.stockUm
                } µM (${d.amountNmol} nmol)`}
              >
                {t("복사", "Copy")}
              </CopyButton>
              {ctx?.sendTo && (
                <button
                  onClick={() =>
                    ctx.sendTo?.("dilution", {
                      kind: "concentration",
                      value: stock.value!.um,
                      unit: "µM",
                      label: t("올리고 원액", "Oligo stock"),
                      source: "primer",
                    })
                  }
                >
                  {t("이 원액을 희석", "Dilute this stock")}
                </button>
              )}
            </div>
          </>
        )}
      </Panel>
    </>
  );
}

import {
  useText,
  useToolData,
  Panel,
  NumberField,
  Select,
  CopyButton,
  ErrorMessage,
  calculate,
  need,
  format,
  plainNumber,
} from "./ui";
import {
  A260_FACTOR,
  concentrationFromA260,
  copyNumber,
  ligationInsertMass,
  nanograms,
  picomoles,
  purityRatio,
  type NucleicAcid,
} from "./nucleic";
import { BarList, ChartFrame, Meter } from "./charts";

type Mode = "absorbance" | "moles" | "ligation";

export default function NucleicAcidTool() {
  const t = useText();
  const [d, set] = useToolData({
    mode: "absorbance" as Mode,
    kind: "dsDNA" as NucleicAcid,
    a260: "",
    a280: "",
    factor: "50",
    dilution: "1",
    path: "1",
    volume: "",
    length: "",
    amount: "",
    amountUnit: "ng",
    vectorLength: "",
    vectorMass: "50",
    insertLength: "",
    ratio: "3",
    insertConcentration: "",
  });
  const kinds = [
    ["dsDNA", "dsDNA"],
    ["ssDNA", "ssDNA"],
    ["RNA", "RNA"],
  ] as const;
  const hint = (ko: string, en: string) => (
    <p className="tool-muted" role="status">
      {t(ko, en)}
    </p>
  );
  const absorbance = calculate(() => {
    const concentration = concentrationFromA260(
      need(d.a260),
      need(d.factor),
      need(d.dilution),
      need(d.path)
    );
    return {
      concentration,
      ratio: d.a280.trim() ? purityRatio(need(d.a260), need(d.a280)) : null,
      // µg/mL × µL / 1000 = µg
      yield: d.volume.trim() ? (concentration * need(d.volume)) / 1000 : null,
    };
  });
  const moles = calculate(() => {
    const length = need(d.length),
      amount = need(d.amount);
    if (d.amountUnit === "pmol")
      return {
        pmol: amount,
        ng: nanograms(d.kind, length, amount),
        copies: amount * 1e-12 * 6.02214076e23,
      };
    const ng = d.amountUnit === "µg" ? amount * 1000 : amount;
    return {
      pmol: picomoles(d.kind, length, ng),
      ng,
      copies: copyNumber(d.kind, length, ng),
    };
  });
  const ligation = calculate(() => {
    const insert = ligationInsertMass(
      need(d.vectorLength),
      need(d.vectorMass),
      need(d.insertLength),
      need(d.ratio)
    );
    return {
      insert,
      vectorPmol: picomoles("dsDNA", need(d.vectorLength), need(d.vectorMass)),
      // ng ÷ (ng/µL) = µL
      volume: d.insertConcentration.trim()
        ? insert / need(d.insertConcentration)
        : null,
    };
  });
  return (
    <>
      <div
        className="tool-choice-grid"
        role="group"
        aria-label={t("계산 종류", "Calculation")}
      >
        {(
          [
            ["absorbance", t("흡광도 → 농도", "Absorbance → concentration")],
            ["moles", t("질량 ↔ 몰", "Mass ↔ moles")],
            ["ligation", t("라이게이션", "Ligation")],
          ] as const
        ).map(([mode, label]) => (
          <button
            key={mode}
            aria-pressed={d.mode === mode}
            onClick={() => set({ ...d, mode })}
          >
            {label}
          </button>
        ))}
      </div>
      {d.mode === "absorbance" && (
        <Panel>
          <div className="tool-grid">
            <Select
              label={t("핵산 종류", "Nucleic acid")}
              value={d.kind}
              options={kinds}
              onChange={(kind) =>
                set({
                  ...d,
                  kind: kind as NucleicAcid,
                  factor: String(A260_FACTOR[kind as NucleicAcid]),
                })
              }
            />
            <NumberField
              label={t(
                "환산 계수 (µg/mL per A260)",
                "Conversion factor (µg/mL per A260)"
              )}
              value={d.factor}
              onChange={(factor) => set({ ...d, factor })}
            />
            <NumberField
              label="A260"
              value={d.a260}
              onChange={(a260) => set({ ...d, a260 })}
            />
            <NumberField
              label={t("A280 (선택)", "A280 (optional)")}
              value={d.a280}
              onChange={(a280) => set({ ...d, a280 })}
            />
            <NumberField
              label={t("희석배수", "Dilution factor")}
              value={d.dilution}
              onChange={(dilution) => set({ ...d, dilution })}
            />
            <NumberField
              label={t("광로 길이 (cm)", "Path length (cm)")}
              value={d.path}
              onChange={(path) => set({ ...d, path })}
            />
            <NumberField
              label={t("시료 부피 (µL, 선택)", "Sample volume (µL, optional)")}
              value={d.volume}
              onChange={(volume) => set({ ...d, volume })}
            />
          </div>
          <ErrorMessage message={absorbance.error} />
          {absorbance.incomplete &&
            hint(
              "A260 값을 입력하면 농도를 계산합니다.",
              "Enter the A260 reading to calculate the concentration."
            )}
          {absorbance.value && (
            <>
              <output className="tool-result">
                {t("농도", "Concentration")}:{" "}
                {format(absorbance.value.concentration)} ng/µL
                {absorbance.value.ratio != null &&
                  `\nA260/A280: ${plainNumber(absorbance.value.ratio, 3)}`}
                {absorbance.value.yield != null &&
                  `\n${t("총량", "Total")}: ${format(absorbance.value.yield)} µg`}
              </output>
              {absorbance.value.ratio != null && (
                <ChartFrame
                  title={t("순도 비율", "Purity ratio")}
                  note={t(
                    "눈금: 1.8 (순수한 DNA), 2.0 (순수한 RNA)",
                    "Marks: 1.8 (pure DNA), 2.0 (pure RNA)"
                  )}
                >
                  <Meter
                    label="A260/A280"
                    value={absorbance.value.ratio}
                    min={1}
                    max={2.4}
                    marks={[1.8, 2.0]}
                    text={plainNumber(absorbance.value.ratio, 3)}
                  />
                </ChartFrame>
              )}
              <div className="tool-actions">
                <CopyButton
                  text={`${plainNumber(absorbance.value.concentration, 6)} ng/µL${
                    absorbance.value.ratio != null
                      ? `, A260/A280 ${plainNumber(absorbance.value.ratio, 3)}`
                      : ""
                  }`}
                >
                  {t("결과 복사", "Copy result")}
                </CopyButton>
              </div>
            </>
          )}
          <details className="tool-guide">
            <summary>{t("계산 기준", "How this is calculated")}</summary>
            <p>
              {t(
                "농도 = A260 × 환산 계수 × 희석배수 ÷ 광로 길이. 계수는 dsDNA 50, RNA 40이 널리 쓰이고, ssDNA는 자료에 따라 33 또는 37을 씁니다(Thermo Fisher 표는 37). 필요하면 계수를 직접 바꾸세요.",
                "Concentration = A260 × factor × dilution ÷ path length. Factors of 50 (dsDNA) and 40 (RNA) are standard; for ssDNA sources use 33 or 37 (Thermo Fisher lists 37). Change the factor if your protocol specifies one."
              )}
            </p>
            <p>
              {t(
                "A260/A280은 순수한 DNA에서 약 1.8, 순수한 RNA에서 약 2.0으로 봅니다. 이보다 낮으면 단백질이나 페놀 등이 섞였을 수 있습니다.",
                "A260/A280 is taken as about 1.8 for pure DNA and about 2.0 for pure RNA; lower values suggest protein, phenol or similar contaminants."
              )}
            </p>
          </details>
        </Panel>
      )}
      {d.mode === "moles" && (
        <Panel>
          <div className="tool-grid">
            <Select
              label={t("핵산 종류", "Nucleic acid")}
              value={d.kind}
              options={kinds}
              onChange={(kind) => set({ ...d, kind: kind as NucleicAcid })}
            />
            <NumberField
              label={
                d.kind === "dsDNA"
                  ? t("길이 (bp)", "Length (bp)")
                  : t("길이 (nt)", "Length (nt)")
              }
              value={d.length}
              onChange={(length) => set({ ...d, length })}
            />
            <NumberField
              label={t("양", "Amount")}
              value={d.amount}
              onChange={(amount) => set({ ...d, amount })}
            />
            <Select
              label={t("양의 단위", "Amount unit")}
              value={d.amountUnit}
              options={["ng", "µg", "pmol"]}
              onChange={(amountUnit) => set({ ...d, amountUnit })}
            />
          </div>
          <ErrorMessage message={moles.error} />
          {moles.incomplete &&
            hint(
              "길이와 양을 입력하면 질량과 몰수를 서로 환산합니다.",
              "Enter the length and an amount to convert between mass and moles."
            )}
          {moles.value && (
            <>
              <output className="tool-result">
                {format(moles.value.ng)} ng = {format(moles.value.pmol)} pmol
                {"\n"}
                {t("분자 수", "Molecules")}:{" "}
                {moles.value.copies.toExponential(3)}
              </output>
              <div className="tool-actions">
                <CopyButton
                  text={`${plainNumber(moles.value.ng, 6)} ng = ${plainNumber(
                    moles.value.pmol,
                    6
                  )} pmol (${d.kind}, ${d.length} ${
                    d.kind === "dsDNA" ? "bp" : "nt"
                  })`}
                >
                  {t("결과 복사", "Copy result")}
                </CopyButton>
              </div>
            </>
          )}
          <p className="tool-muted">
            {t(
              "평균 염기 조성을 가정한 분자량입니다(Thermo Fisher): dsDNA = bp × 607.4 + 157.9, ssDNA = nt × 303.7 + 79.0, RNA = nt × 320.5 + 159.0.",
              "Uses average-composition weights (Thermo Fisher): dsDNA = bp × 607.4 + 157.9, ssDNA = nt × 303.7 + 79.0, RNA = nt × 320.5 + 159.0."
            )}
          </p>
        </Panel>
      )}
      {d.mode === "ligation" && (
        <Panel>
          <div className="tool-grid">
            <NumberField
              label={t("벡터 길이 (bp)", "Vector length (bp)")}
              value={d.vectorLength}
              onChange={(vectorLength) => set({ ...d, vectorLength })}
            />
            <NumberField
              label={t("벡터 양 (ng)", "Vector mass (ng)")}
              value={d.vectorMass}
              onChange={(vectorMass) => set({ ...d, vectorMass })}
            />
            <NumberField
              label={t("인서트 길이 (bp)", "Insert length (bp)")}
              value={d.insertLength}
              onChange={(insertLength) => set({ ...d, insertLength })}
            />
            <NumberField
              label={t(
                "인서트 : 벡터 몰비 (N : 1)",
                "Insert : vector molar ratio (N : 1)"
              )}
              value={d.ratio}
              onChange={(ratio) => set({ ...d, ratio })}
            />
            <NumberField
              label={t(
                "인서트 농도 (ng/µL, 선택)",
                "Insert concentration (ng/µL, optional)"
              )}
              value={d.insertConcentration}
              onChange={(insertConcentration) =>
                set({ ...d, insertConcentration })
              }
            />
          </div>
          <ErrorMessage message={ligation.error} />
          {ligation.incomplete &&
            hint(
              "벡터와 인서트의 길이를 입력하면 필요한 인서트 양을 계산합니다.",
              "Enter the vector and insert lengths to get the insert mass needed."
            )}
          {ligation.value && (
            <>
              <output className="tool-result">
                {t("필요한 인서트", "Insert needed")}:{" "}
                {format(ligation.value.insert)} ng
                {ligation.value.volume != null &&
                  ` = ${format(ligation.value.volume)} µL`}
                {"\n"}
                {t("벡터", "Vector")}: {format(ligation.value.vectorPmol)} pmol
              </output>
              <ChartFrame
                title={t("몰수 비교", "Moles compared")}
                note={t(
                  `인서트 : 벡터 = ${d.ratio} : 1`,
                  `Insert : vector = ${d.ratio} : 1`
                )}
                table={{
                  headers: [t("조각", "Fragment"), "pmol", "ng"],
                  rows: [
                    [
                      t("벡터", "Vector"),
                      ligation.value.vectorPmol,
                      need(d.vectorMass),
                    ],
                    [
                      t("인서트", "Insert"),
                      ligation.value.vectorPmol * need(d.ratio),
                      ligation.value.insert,
                    ],
                  ],
                }}
              >
                <BarList
                  label={t("벡터와 인서트의 몰수", "Moles of vector and insert")}
                  text={(value) => `${format(value)} pmol`}
                  rows={[
                    {
                      label: t("벡터", "Vector"),
                      value: ligation.value.vectorPmol,
                      muted: true,
                    },
                    {
                      label: t("인서트", "Insert"),
                      value: ligation.value.vectorPmol * need(d.ratio),
                    },
                  ]}
                />
              </ChartFrame>
              <div className="tool-actions">
                <CopyButton
                  text={`${t("인서트", "Insert")} ${plainNumber(
                    ligation.value.insert,
                    5
                  )} ng${
                    ligation.value.volume != null
                      ? ` (${plainNumber(ligation.value.volume, 4)} µL)`
                      : ""
                  }, ${d.ratio}:1`}
                >
                  {t("결과 복사", "Copy result")}
                </CopyButton>
              </div>
            </>
          )}
          <p className="tool-muted">
            {t(
              "벡터의 몰수에 몰비를 곱해 인서트 질량으로 환산합니다. 길이 비례 어림식(벡터 ng × 인서트 길이 ÷ 벡터 길이 × 몰비)과 거의 같은 값입니다.",
              "The vector's moles times the ratio, converted back to insert mass. It is nearly the same as the length-ratio shortcut (vector ng × insert length ÷ vector length × ratio)."
            )}
          </p>
        </Panel>
      )}
    </>
  );
}

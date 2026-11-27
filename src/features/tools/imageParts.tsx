/**
 * Panels of the image editor (ImageTool.tsx) that only read what it worked
 * out: the gel's band sizes with their chart, and the measurement statistics.
 */
import { CheckButton, ErrorMessage, Select, format, useText } from "./ui";
import { BarList, ChartFrame, Plot, type Slot } from "./charts";
import { logTicks } from "./chartMath";
import { summarize } from "./geometry";
import {
  estimateSize,
  roundEstimate,
  type GelBand,
  type GelReading,
} from "./gel";

const sizeUnits = ["bp", "kb", "nt", "kDa"];
// Ladders take the palette slots around the orange one, which marks the
// estimated bands whichever ladder they were read against.
const ladderSlots: Slot[] = [1, 3, 5, 6, 4];
const ESTIMATE_SLOT: Slot = 2;

export function GelSizes({
  reading,
  unit,
  onUnit,
  labels,
  onLabels,
}: {
  reading: GelReading;
  unit: string;
  onUnit: (unit: string) => void;
  /** Whether estimated sizes are drawn beside the bands on the image. */
  labels: boolean;
  onLabels: (labels: boolean) => void;
}) {
  const t = useText();
  const laneName = (id: string) =>
    reading.lanes.find((lane) => lane.id === id)?.name ?? "";
  // Numbered from the left once there is more than one, with the lane named
  // when all of a ladder's bands sit in one.
  const ladderName = (index: number) => {
    const lanes = new Set(reading.ladders[index].map((band) => band.lane)),
      lane = lanes.size === 1 ? laneName([...lanes][0]) : "",
      name =
        reading.ladders.length > 1
          ? t(`래더 ${index + 1}`, `Ladder ${index + 1}`)
          : t("래더", "Ladder");
    return lane ? t(`${name} (레인 ${lane})`, `${name} (lane ${lane})`) : name;
  };
  // Each ladder is checked on its own, so a problem shows before any sample
  // band has been marked.
  const checks = reading.ladders.map((ladder) =>
    estimateSize(
      ladder.map((band) => ({ position: band.position, size: band.known ?? 0 })),
      ladder[0].position
    )
  );
  const samples = reading.bands.filter((band) => band.known === null),
    estimated = samples.filter((band) => band.estimate?.ok),
    usable = reading.ladders
      .map((ladder, index) => ({ ladder, index }))
      .filter(({ index }) => checks[index].ok);
  const position = (band: GelBand) => Math.round(band.position * 10) / 10;
  // Round sizes (100, 200, 500 …) on the log axis, covering every plotted
  // band; without any the plot falls back to its own ticks.
  const plotted = [
      ...usable.flatMap(({ ladder }) => ladder.map((band) => band.known ?? NaN)),
      ...estimated.map((band) =>
        band.estimate?.ok ? band.estimate.size : NaN
      ),
    ].filter((size) => size > 0),
    sizeTicks = plotted.length
      ? logTicks(Math.min(...plotted), Math.max(...plotted)).map(Math.log10)
      : undefined;
  return (
    <>
      <div className="tool-grid">
        <Select
          label={t("밴드 크기 단위", "Band size unit")}
          value={unit}
          onChange={onUnit}
          options={sizeUnits.includes(unit) ? sizeUnits : [...sizeUnits, unit]}
        />
        <CheckButton checked={labels} onChange={onLabels}>
          {t("이미지에 추정 크기 표시", "Show estimated sizes on the image")}
        </CheckButton>
      </div>
      {!reading.ladders.length && (
        <p className="tool-muted" role="status">
          {t(
            "래더를 불러오거나, 래더 밴드를 선택해 알려진 크기를 입력하세요. 크기가 있는 밴드가 2개 이상이면 나머지 밴드의 크기를 추정합니다.",
            "Load a ladder, or select a ladder band and enter its known size. With two or more sized bands, the size of every other band is estimated."
          )}
        </p>
      )}
      {checks.map((check, index) =>
        check.ok ? null : check.reason === "few" ? (
          <p className="tool-muted" role="status" key={index}>
            {t(
              `${ladderName(index)}: 크기가 있는 밴드가 2개 이상 필요합니다.`,
              `${ladderName(index)}: at least two bands with a size are needed.`
            )}
          </p>
        ) : (
          <ErrorMessage
            key={index}
            message={
              check.reason === "overlap"
                ? t(
                    `${ladderName(index)}: 크기가 다른 래더 밴드가 같은 위치에 있어 추정할 수 없습니다. 밴드를 실제 위치로 옮기세요.`,
                    `${ladderName(index)}: ladder bands of different size sit at the same position, so nothing can be estimated. Move each band onto its place.`
                  )
                : t(
                    `${ladderName(index)}: 래더 밴드의 순서가 크기와 맞지 않아 추정할 수 없습니다. 밴드의 위치와 크기를 확인하세요.`,
                    `${ladderName(index)}: the order of the ladder bands does not follow their sizes, so nothing can be estimated. Check each band's position and size.`
                  )
            }
          />
        )
      )}
      {usable.length > 0 && !samples.length && (
        <p className="tool-muted" role="status">
          {t(
            "밴드 도구로 시료 밴드를 표시하면 래더를 기준으로 크기를 추정합니다.",
            "Mark sample bands with the Band tool to estimate their sizes from the ladder."
          )}
        </p>
      )}
      {estimated.length > 0 && (
        <>
          <ChartFrame
            title={t("이동 거리와 크기", "Migration distance and size")}
            note={t(
              "이웃한 래더 밴드 사이를 log 크기로 직선 보간한 추정값입니다.",
              "Estimates follow a straight line in log size between neighbouring ladder bands."
            )}
            legend={[
              ...usable.map(({ index }, order) => ({
                label: ladderName(index),
                slot: ladderSlots[order % ladderSlots.length],
                shape: "line" as const,
              })),
              {
                label: t("추정한 밴드", "Estimated bands"),
                slot: ESTIMATE_SLOT,
                shape: "dot" as const,
              },
            ]}
            table={{
              headers: [
                t("구분", "Type"),
                t("이름", "Name"),
                t("이동 거리 (px)", "Migration distance (px)"),
                `${t("크기", "Size")} (${unit})`,
                t("비고", "Note"),
              ],
              rows: [
                ...usable.flatMap(({ ladder, index }) =>
                  ladder.map((band) => [
                    ladderName(index),
                    band.name,
                    position(band),
                    format(band.known),
                    "",
                  ])
                ),
                ...estimated.map((band) => [
                  t("추정", "Estimated"),
                  band.name,
                  position(band),
                  band.estimate?.ok
                    ? `≈ ${format(
                        roundEstimate(
                          band.estimate.size,
                          band.estimate.extrapolated
                        )
                      )}`
                    : "",
                  band.estimate?.ok && band.estimate.extrapolated
                    ? t("외삽", "Extrapolated")
                    : "",
                ]),
              ],
            }}
          >
            <Plot
              label={t(
                "래더 밴드와 추정한 밴드의 이동 거리 대 크기",
                "Size against migration distance for ladder bands and estimated bands"
              )}
              xTitle={t(
                "이동 거리 (px, 이미지 위쪽 기준)",
                "Migration distance (px from the top of the image)"
              )}
              yTitle={t(`크기 (${unit}, log)`, `Size (${unit}, log)`)}
              xText={(value) => format(Math.round(value))}
              // The axis is log10(size); ticks and read-outs show the size.
              yText={(value) => format(Number((10 ** value).toPrecision(3)))}
              yTicks={sizeTicks}
              series={usable.map(({ ladder, index }, order) => ({
                name: ladderName(index),
                slot: ladderSlots[order % ladderSlots.length],
                mark: "both" as const,
                points: ladder.map((band) => ({
                  x: band.position,
                  y: Math.log10(band.known ?? NaN),
                })),
              }))}
              marks={estimated.map((band) => ({
                x: band.position,
                y: band.estimate?.ok ? Math.log10(band.estimate.size) : NaN,
                slot: ESTIMATE_SLOT,
                // Names are dropped when they would pile up; the table has them.
                label:
                  estimated.length > 8
                    ? ""
                    : `${
                        band.name.length > 14
                          ? `${band.name.slice(0, 13)}…`
                          : band.name
                      }${
                        band.estimate?.ok && band.estimate.extrapolated
                          ? ` (${t("외삽", "extrapolated")})`
                          : ""
                      }`,
              }))}
            />
          </ChartFrame>
          {estimated.some(
            (band) => band.estimate?.ok && band.estimate.extrapolated
          ) && (
            <p className="tool-muted">
              {t(
                "래더 범위 밖의 밴드는 가장 가까운 두 래더 밴드를 연장한 값(외삽)이라 오차가 큽니다. 참고용으로만 쓰세요.",
                "A band outside the ladder is read by extending the nearest two ladder bands (extrapolation) and can be far off. Treat it as a rough guide."
              )}
            </p>
          )}
        </>
      )}
    </>
  );
}

export type MeasureGroup = {
  key: string;
  /** What is measured: "Line length". */
  label: string;
  /** A value of this kind with its unit. */
  text: (value: number) => string;
  values: { name: string; value: number }[];
  /** Also give the sum (counted points). */
  total?: boolean;
};
// Statistics are quoted to four significant figures: the marks they come from
// are placed by hand.
const brief = (value: number) => Number(value.toPrecision(4));

/**
 * Count, mean and sample standard deviation for each kind of measurement, and
 * a bar per value once a kind has three or more, to show how they spread.
 */
export function MeasureStats({ groups }: { groups: MeasureGroup[] }) {
  const t = useText();
  const rows = groups
    .map((group) => ({
      group,
      summary: summarize(group.values.map((entry) => entry.value)),
    }))
    .filter(
      (row): row is typeof row & { summary: NonNullable<typeof row.summary> } =>
        !!row.summary
    );
  if (!rows.length) return null;
  return (
    <div className="tool-image-x-stats">
      <h3>{t("측정 통계", "Measurement statistics")}</h3>
      <div className="tool-table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("종류", "Kind")}</th>
              <th>{t("개수", "Count")}</th>
              <th>{t("평균", "Mean")}</th>
              <th>{t("표준편차 (n−1)", "SD (n−1)")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ group, summary }) => (
              <tr key={group.key}>
                <td>{group.label}</td>
                <td>{summary.n}</td>
                <td>
                  {group.text(brief(summary.mean))}
                  {group.total &&
                    ` · ${t("합계", "Total")} ${group.text(
                      group.values.reduce((sum, entry) => sum + entry.value, 0)
                    )}`}
                </td>
                <td>
                  {summary.sd === null ? "—" : group.text(brief(summary.sd))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.some(({ summary }) => summary.sd === null) && (
        <p className="tool-muted">
          {t(
            "표준편차는 같은 종류의 측정이 2개 이상일 때 계산합니다.",
            "The standard deviation needs two or more measurements of the same kind."
          )}
        </p>
      )}
      {rows
        .filter(({ summary }) => summary.n >= 3)
        .map(({ group, summary }) => (
          <ChartFrame
            key={group.key}
            title={group.label}
            note={`${t("평균", "Mean")} ${group.text(brief(summary.mean))} · ${t(
              "표준편차",
              "SD"
            )} ${summary.sd === null ? "—" : group.text(brief(summary.sd))} · n = ${
              summary.n
            }`}
            table={{
              headers: [t("이름", "Name"), group.label],
              rows: group.values.map((entry) => [
                entry.name,
                group.text(entry.value),
              ]),
            }}
          >
            <BarList
              label={t(
                `${group.label} 측정값`,
                `${group.label} of each measurement`
              )}
              rows={group.values.map((entry) => ({
                label: entry.name,
                value: entry.value,
                figure: group.text(entry.value),
              }))}
            />
          </ChartFrame>
        ))}
    </div>
  );
}

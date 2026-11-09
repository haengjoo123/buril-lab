import { useContext } from "react";
import {
  seeding,
  growthHours,
  type CultureProfile,
  type Vessel,
} from "./labMath";
import { DeviceToggle, clockText, useNow } from "./TimeTools";
import { setDeviceEnabled } from "./notifications";
import { enableNotifications } from "./notifications";
import { useState } from "react";
import {
  ToolContext,
  useText,
  useToolData,
  Panel,
  Field,
  Select,
  Result,
  ErrorMessage,
  calculate,
  format,
} from "./ui";
type Passage = {
  id: string;
  number: number;
  at: string;
  medium: string;
  antibiotics: string;
  conditions: string;
  notes: string;
  snapshot: unknown;
};
export default function CultureTool() {
  const [permissionError, setPermissionError] = useState("");
  const t = useText(),
    ctx = useContext(ToolContext)!,
    now = useNow();
  const [d, set] = useToolData({
    name: "",
    profile: {
      kind: "adherent",
      doublingHours: 24,
      density: 100000,
      maxDensity: 1000000,
    } as CultureProfile,
    maxPassages: 30,
    notes: "",
    concentration: 1000000,
    available: 10,
    vessels: [
      {
        id: "t25",
        name: "T25",
        area: 25,
        volume: 5,
        count: 1,
        mode: "split",
        target: 5,
      },
    ] as Vessel[],
    checked: [] as string[],
    start: 30,
    target: 80,
    timer: null as null | { id: string; end: number },
    passages: [] as Passage[],
    medium: "",
    antibiotics: "",
    conditions: "",
    passageNotes: "",
  });
  const result = calculate(() =>
      seeding(d.profile, d.concentration, d.available, d.vessels)
    ),
    hours = calculate(() =>
      growthHours(d.start, d.target, d.profile.doublingHours)
    );
  const profile = (patch: Partial<CultureProfile>) =>
    set({ ...d, profile: { ...d.profile, ...patch } });
  const vessel = (id: string, patch: Partial<Vessel>) =>
    set({
      ...d,
      checked: [],
      vessels: d.vessels.map((v) => (v.id === id ? { ...v, ...patch } : v)),
    });
  return (
    <>
      <p className="culture-identity">
        <strong>{d.name || t("세포주 이름 미설정", "Unnamed cell line")}</strong>
        <span className="tool-muted">
          {t("최근 계대", "Latest passage")}: {d.passages.length ? `P${Math.max(...d.passages.map((p) => p.number))}` : "—"}
        </span>
      </p>
      <div className="culture-overview" aria-label={t("배양 현황", "Culture overview")}>
        <div>
          <span>{d.profile.kind === "adherent" ? t("현재 confluence", "Current confluence") : t("현재 농도", "Current density")}</span>
          <strong>{format(d.start)}{d.profile.kind === "adherent" ? "%" : ""}</strong>
          {d.profile.kind === "suspension" && <span>cells/mL</span>}
        </div>
        <div>
          <span>{t("계대 목표", "Passage target")}</span>
          <strong>{format(d.target)}{d.profile.kind === "adherent" ? "%" : ""}</strong>
          {d.profile.kind === "suspension" && <span>cells/mL</span>}
        </div>
        <div><span>{t("예상 소요 시간", "Estimated time")}</span><strong>{hours.value && d.start <= (d.profile.kind === "adherent" ? 100 : d.profile.maxDensity) && d.target <= (d.profile.kind === "adherent" ? 100 : d.profile.maxDensity) ? `${Number(hours.value.toFixed(1))} h` : "—"}</strong></div>
      </div>
      <Panel
        title={t("성장 예측과 다음 계대", "Growth estimate and next passage")}
      >
        <p className="tool-muted">
          {t(
            "모델 예상치입니다. 실제 증식 측정값과 다를 수 있습니다.",
            "Model estimate; actual growth may differ."
          )}
        </p>
        <div className="tool-grid">
          <Field
            label={
              d.profile.kind === "adherent"
                ? t("현재 confluence (%)", "Current confluence (%)")
                : "Current cells/mL"
            }
            value={d.start}
            onChange={(v) => set({ ...d, start: Number(v) })}
          />
          <Field
            label={
              d.profile.kind === "adherent"
                ? t("목표 confluence (%)", "Target confluence (%)")
                : "Target cells/mL"
            }
            value={d.target}
            onChange={(v) => set({ ...d, target: Number(v) })}
          />
        </div>
        <Field
          label={t("배가 시간 (h)", "Doubling time (h)")}
          value={d.profile.doublingHours}
          onChange={(v) => profile({ doublingHours: Number(v) })}
        />
        <ErrorMessage message={hours.error} />
        {d.profile.kind === "adherent" && (d.start > 100 || d.target > 100) && (
          <p className="tool-error">{t("Confluence는 100%를 넘을 수 없습니다.", "Confluence cannot exceed 100%.")}</p>
        )}
        <Result>{t("목표까지 예상 시간", "Estimated time to target")}: {hours.value && (d.profile.kind !== "adherent" || (d.start <= 100 && d.target <= 100)) ? `${format(hours.value)} h` : "—"}</Result>
        {hours.value && d.profile.doublingHours > 0 && (d.profile.kind === "adherent" || d.profile.maxDensity > 0) && <svg
          viewBox="0 0 500 160"
          className="tool-plot"
          role="img"
          aria-label={t("예상 성장 곡선", "Estimated growth curve")}
        >
          <polyline
            fill="none"
            stroke="#2563eb"
            strokeWidth="2"
            points={Array.from({ length: 100 }, (_, i) => {
              const cap =
                  d.profile.kind === "adherent" ? 100 : d.profile.maxDensity,
                y = Math.min(
                  cap,
                  d.start *
                    2 **
                      (((i / 99) * (hours.value ?? 48)) /
                        d.profile.doublingHours)
                );
              return `${i * 5},${150 - (140 * y) / cap}`;
            }).join(" ")}
          />
        </svg>}
        <button
          disabled={
            !hours.value ||
            d.start > (d.profile.kind === "adherent" ? 100 : d.profile.maxDensity) ||
            d.target >
              (d.profile.kind === "adherent" ? 100 : d.profile.maxDensity)
          }
          onClick={async () => {
            try {
              await enableNotifications();
              setPermissionError("");
            } catch (e) {
              setPermissionError(String(e));
            }
            if (d.timer) setDeviceEnabled(ctx.repo.owner, d.timer.id, false);
            const id = crypto.randomUUID();
            set({
              ...d,
              timer: { id, end: Date.now() + hours.value! * 3600000 },
            });
            setDeviceEnabled(ctx.repo.owner, id, true);
          }}
        >
          {t("예상 시점 타이머 시작", "Start target timer")}
        </button>
        <ErrorMessage message={permissionError} />
        {d.timer && (
          <>
            <div className="tool-clock">
              {clockText(Math.max(0, d.timer.end - now))}
            </div>
            <p>{new Date(d.timer.end).toLocaleString(t("ko-KR", "en-US"))}</p>
            <DeviceToggle id={d.timer.id} />
            <button
              onClick={() => {
                setDeviceEnabled(ctx.repo.owner, d.timer!.id, false);
                set({ ...d, timer: null });
              }}
            >
              {t("타이머 취소", "Cancel timer")}
            </button>
          </>
        )}
      </Panel>
      <Panel title={t("계대 기록", "Passage history")}>
        <div className="tool-grid">
          <Field
            type="text"
            label={t("배지", "Medium")}
            value={d.medium}
            onChange={(medium) => set({ ...d, medium })}
          />
          <Field
            type="text"
            label={t("항생제", "Antibiotics")}
            value={d.antibiotics}
            onChange={(antibiotics) => set({ ...d, antibiotics })}
          />
          <Field
            type="text"
            label={t("배양 조건", "Culture conditions")}
            value={d.conditions}
            onChange={(conditions) => set({ ...d, conditions })}
          />
          <Field
            type="text"
            label={t("계대 메모", "Passage notes")}
            value={d.passageNotes}
            onChange={(passageNotes) => set({ ...d, passageNotes })}
          />
        </div>
        <p className="tool-muted">{t("분주 계산에서 모든 용기를 완료하면 계산 결과도 함께 기록됩니다.", "Complete all vessel checks in the calculator to include the seeding results.")}</p>
        <button
          className="primary"
          onClick={() =>
            set({
              ...d,
              passages: [
                ...d.passages,
                {
                  id: crypto.randomUUID(),
                  number: d.passages.length ? Math.max(...d.passages.map((p) => p.number)) + 1 : 0,
                  at: new Date().toISOString(),
                  medium: d.medium,
                  antibiotics: d.antibiotics,
                  conditions: d.conditions,
                  notes: d.passageNotes,
                  snapshot: result.value?.valid && d.vessels.length > 0 && d.checked.length === d.vessels.length ? {
                    profile: d.profile,
                    concentration: d.concentration,
                    available: d.available,
                    vessels: d.vessels,
                    result: result.value,
                  } : null,
                },
              ],
              checked: [],
            })
          }
        >
          {t("계대 기록 추가", "Add passage record")}
        </button>
        {d.passages.length >= d.maxPassages && (
          <p className="tool-error">
            {t("계대 한도에 도달했습니다.", "Passage limit reached.")}
          </p>
        )}
        {[...d.passages].reverse().map((p) => (
          <details className="tool-panel" key={p.id}>
            <summary>
              P{p.number} · {new Date(p.at).toLocaleString(t("ko-KR", "en-US"))}
            </summary>
            <p>
              {p.medium} · {p.antibiotics} · {p.conditions}
            </p>
            <p>{p.notes}</p>
            {p.snapshot != null && (
              <details>
                <summary>{t("저장된 분주 계산 보기", "View saved seeding calculation")}</summary>
                <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12 }}>
                  {JSON.stringify(p.snapshot, null, 2)}
                </pre>
              </details>
            )}
          </details>
        ))}
      </Panel>
<details className="culture-section"><summary>{t("세포주 설정", "Cell line profile")}</summary>
      <Panel title={t("세포주 설정", "Cell line profile")}>
        <div className="tool-grid">
          <Field
            type="text"
            label={t("세포주 이름", "Cell line name")}
            value={d.name}
            onChange={(name) => set({ ...d, name })}
          />
          <Select
            label={t("배양 방식", "Culture type")}
            value={d.profile.kind}
            onChange={(kind) =>
              set({
                ...d,
                profile: { ...d.profile, kind: kind as CultureProfile["kind"] },
                vessels: d.vessels.map((v) => ({ ...v, mode: "split" })),
                checked: [],
              })
            }
            options={[
              ["adherent", t("부착", "Adherent")],
              ["suspension", t("부유", "Suspension")],
            ]}
          />
          <Field
            label={t("배가 시간 (h)", "Doubling time (h)")}
            value={d.profile.doublingHours}
            onChange={(v) => profile({ doublingHours: Number(v) })}
          />
          <Field
            label={
              d.profile.kind === "adherent"
                ? "100% confluence (cells/cm²)"
                : t("최대 밀도 (cells/mL)", "Maximum density (cells/mL)")
            }
            value={
              d.profile.kind === "adherent"
                ? d.profile.density
                : d.profile.maxDensity
            }
            onChange={(v) =>
              profile(
                d.profile.kind === "adherent"
                  ? { density: Number(v) }
                  : { maxDensity: Number(v) }
              )
            }
          />
          <Field
            label={t("계대 한도", "Passage limit")}
            value={d.maxPassages}
            onChange={(v) => set({ ...d, maxPassages: Number(v) })}
          />
        </div>
        <Field
          type="text"
          label={t("세포주 메모", "Cell line notes")}
          value={d.notes}
          onChange={(notes) => set({ ...d, notes })}
        />
      </Panel>
</details>
<details className="culture-section"><summary>{t("분주 계산", "Seeding calculator")}</summary>
      <Panel title={t("분주 준비", "Seeding preparation")}>
        <div className="tool-grid">
          <Field
            label={t(
              "생존 세포 농도 (cells/mL)",
              "Viable cell concentration (cells/mL)"
            )}
            value={d.concentration}
            onChange={(v) =>
              set({ ...d, concentration: Number(v), checked: [] })
            }
          />
          <Field
            label={t("보유 부피 (mL)", "Available stock (mL)")}
            value={d.available}
            onChange={(v) => set({ ...d, available: Number(v), checked: [] })}
          />
        </div>
        {d.vessels.map((v) => (
          <div className="tool-panel" key={v.id}>
            <div className="tool-grid">
              <Field
                type="text"
                label={t("용기", "Vessel")}
                value={v.name}
                onChange={(name) => vessel(v.id, { name })}
              />
              <Field
                label={t("용기 면적 (cm²)", "Vessel area (cm²)")}
                value={v.area}
                onChange={(value) => vessel(v.id, { area: Number(value) })}
              />
              <Field
                label={t(
                  "용기당 최종 부피 (mL)",
                  "Final volume per vessel (mL)"
                )}
                value={v.volume}
                onChange={(value) => vessel(v.id, { volume: Number(value) })}
              />
              <Field
                label={t("용기 개수", "Vessel count")}
                value={v.count}
                onChange={(value) => vessel(v.id, { count: Number(value) })}
              />
              <Select
                label={t("목표 방식", "Target mode")}
                value={v.mode}
                onChange={(mode) =>
                  vessel(v.id, { mode: mode as Vessel["mode"] })
                }
                options={
                  d.profile.kind === "adherent"
                    ? [
                        "split",
                        "cells/mL",
                        "cells/vessel",
                        "cells/cm2",
                        "confluence",
                      ]
                    : ["split", "cells/mL", "cells/vessel"]
                }
              />
              <Field
                label={
                  v.mode === "split"
                    ? "1 : N"
                    : v.mode === "confluence"
                    ? "Confluence %"
                    : t("목표값", "Target")
                }
                value={v.target}
                onChange={(value) => vessel(v.id, { target: Number(value) })}
              />
            </div>
            <button
              onClick={() =>
                set({
                  ...d,
                  vessels: d.vessels.filter((row) => row.id !== v.id),
                  checked: [],
                })
              }
            >
              {t("용기 그룹 삭제", "Remove vessel group")}
            </button>
          </div>
        ))}
        <p className="tool-muted">
          {d.profile.kind === "adherent"
            ? t(
                "Split: 보유 현탁액의 1/N을 용기당 배분합니다.",
                "Split: 1/N of available suspension per vessel."
              )
            : t(
                "Split: 용기당 최종 부피의 1/N을 원액으로 사용합니다.",
                "Split: stock volume is 1/N of final volume per vessel."
              )}
        </p>
        <button
          onClick={() =>
            set({
              ...d,
              vessels: [
                ...d.vessels,
                {
                  id: crypto.randomUUID(),
                  name: "T25",
                  area: 25,
                  volume: 5,
                  count: 1,
                  mode: "split",
                  target: 5,
                },
              ],
              checked: [],
            })
          }
        >
          {t("용기 그룹 추가", "Add vessel group")}
        </button>
        <ErrorMessage message={result.error} />
        {result.value && (
          <>
            <div className="tool-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("용기", "Vessel")}</th>
                    <th>cells/vessel</th>
                    <th>
                      {t(
                        "원액 / 배지 (용기당 mL)",
                        "Stock / medium (mL per vessel)"
                      )}
                    </th>
                    <th>Confluence</th>
                  </tr>
                </thead>
                <tbody>
                  {result.value.rows.map((v) => (
                    <tr key={v.id}>
                      <td>
                        {v.name} ×{v.count}
                      </td>
                      <td>{format(v.cells)}</td>
                      <td>
                        {format(v.stock)} / {format(v.medium)}
                      </td>
                      <td>
                        {format(v.confluence)}%
                        <ErrorMessage message={v.warning} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Result>
              {t("전체 필요 원액", "Total stock")}:{" "}
              {format(result.value.stockTotal)} mL{"\n"}
              {t("전체 배지", "Total medium")}:{" "}
              {format(result.value.mediumTotal)} mL
            </Result>
            <ErrorMessage
              message={
                result.value.insufficient
                  ? t("보유 원액이 부족합니다.", "Insufficient stock.")
                  : ""
              }
            />
            {result.value.rows.map((v) => (
              <label key={v.id}>
                <input
                  type="checkbox"
                  checked={d.checked.includes(v.id)}
                  disabled={!result.value?.valid}
                  onChange={(e) =>
                    set({
                      ...d,
                      checked: e.target.checked
                        ? [...d.checked, v.id]
                        : d.checked.filter((id) => id !== v.id),
                    })
                  }
                />
                {v.name} ×{v.count} {t("분주 완료", "Dispensed")}
              </label>
            ))}
          </>
        )}
      </Panel>
</details>
    </>
  );
}

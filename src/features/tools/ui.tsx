/* eslint-disable react-refresh/only-export-components -- Shared tool form primitives and their typed document context. */
import { createContext, useContext, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ToolDocument } from "./registry";
import type { ToolRepository } from "./repository";
import { exportBlobPartAsFile } from "../../utils/fileExport";
import { Check } from "lucide-react";
export const ToolContext = createContext<{
  doc: ToolDocument;
  repo: ToolRepository;
  documents: ToolDocument[];
} | null>(null);
export function useText() {
  const { i18n } = useTranslation();
  return (ko: string, en: string) => (i18n.language.startsWith("ko") ? ko : en);
}
export function useToolData<T extends object>(
  defaults: T
): [T, (next: T | ((old: T) => T)) => void] {
  const ctx = useContext(ToolContext);
  if (!ctx) throw Error("Tool context missing");
  const data = { ...defaults, ...ctx.doc.data } as T;
  return [
    data,
    (next) => {
      const current =
        ctx.repo.items.find((i) => i.doc.id === ctx.doc.id)?.doc.data ??
        ctx.doc.data;
      void ctx.repo.update(ctx.doc.id, {
        data: (typeof next === "function"
          ? next({ ...defaults, ...current } as T)
          : next) as Record<string, unknown>,
      });
    },
  ];
}
export function Field({
  label,
  value,
  onChange,
  type = "number",
  step = "any",
  min,
  disabled = false,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  step?: string;
  min?: number;
  disabled?: boolean;
}) {
  if (type === "color")
    return (
      <ColorField label={label} value={String(value)} onChange={onChange} />
    );
  return (
    <label className="tool-field">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        disabled={disabled}
        step={type === "number" ? step : undefined}
        min={min}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
export const toolColors = [
  "#bfdbfe",
  "#ddd6fe",
  "#bbf7d0",
  "#fde68a",
  "#fecaca",
  "#a5f3fc",
  "#fed7aa",
  "#fbcfe8",
];
export function ColorField({
  label,
  value,
  onChange,
  colors = toolColors,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  colors?: string[];
}) {
  const t = useText();
  return (
    <fieldset className="tool-color-field">
      <legend>{label}</legend>
      <div className="tool-color-options">
        {colors.map((color) => (
          <button
            type="button"
            key={color}
            className="tool-color-swatch"
            style={{ background: color }}
            aria-label={`${label} ${color}`}
            aria-pressed={value.toLowerCase() === color}
            onClick={() => onChange(color)}
          >
            {value.toLowerCase() === color && (
              <Check size={17} strokeWidth={2.5} />
            )}
          </button>
        ))}
        <label
          className="tool-custom-color"
          title={t("사용자 지정 색상", "Custom color")}
        >
          <input
            type="color"
            aria-label={t("사용자 지정 색상", "Custom color")}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
          <span style={{ background: value }} />
          <span>{t("직접 선택", "Custom")}</span>
        </label>
      </div>
    </fieldset>
  );
}
export function CheckButton({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      className={`tool-check-button ${checked ? "checked" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="tool-check-icon">
        {checked && <Check size={15} strokeWidth={3} />}
      </span>
      {children}
    </button>
  );
}
export function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  options: readonly (string | readonly [string, string])[];
}) {
  const t = useText();
  const captions: Record<string, string> = {
    linear: "선형",
    origin: "원점 고정 선형",
    exponential: "지수",
    hill: "증가형 Hill",
    none: "반복 없음",
    daily: "매일",
    weekly: "매주",
    monthly: "매월",
    table: "표",
    wheel: "휠",
    split: "분할 비율 (1:N)",
    confluence: "Confluence (%)",
  };
  return (
    <label className="tool-field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) =>
          typeof o === "string" ? (
            <option key={o} value={o}>
              {o ? t(captions[o] ?? o, o) : t("선택하세요", "Select")}
            </option>
          ) : (
            <option key={o[0]} value={o[0]}>
              {o[1]}
            </option>
          )
        )}
      </select>
    </label>
  );
}
export function Panel({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <section className="tool-panel">
      {title && <h2>{title}</h2>}
      {children}
    </section>
  );
}
export function Result({ children }: { children: ReactNode }) {
  return <output className="tool-result">{children}</output>;
}
const errorTranslations: Record<string, string> = {
  "Incomplete or invalid equation":
    "수식이 불완전하거나 문법이 올바르지 않습니다.",
  "Expression too long": "수식은 2000자 이내로 입력하세요.",
  "Division by zero": "0으로 나눌 수 없습니다.",
  "Outside function domain": "함수의 정의역을 벗어났습니다.",
  "Tangent undefined": "이 각도에서 탄젠트가 정의되지 않습니다.",
  "Result is not finite": "계산 결과가 유한한 수가 아닙니다.",
  "Enter positive finite values": "0보다 큰 유한한 값을 입력하세요.",
  "Target exceeds stock concentration": "목표 농도가 원액 농도보다 높습니다.",
  "Invalid unit or value": "단위 또는 값을 확인하세요.",
  "Incompatible dimensions": "서로 변환할 수 없는 단위입니다.",
  "Molecular weight required": "양수 분자량을 입력하세요.",
  "Density (g/mL) required": "양수 밀도(g/mL)를 입력하세요.",
  "Below absolute zero": "절대영도보다 낮은 온도입니다.",
  "Invalid counts": "세포 수는 0 이상의 정수로 입력하세요.",
  "Invalid amount": "조성과 수량을 확인하세요.",
  "Reaction count must be an integer": "반응 수는 1 이상의 정수로 입력하세요.",
  "Concentration must be positive": "농도는 0보다 커야 합니다.",
  "Invalid concentration or volume": "농도와 부피를 확인하세요.",
  "Vessel count must be an integer": "용기 수는 정수여야 합니다.",
  "Area targets require adherent cells":
    "면적 기준 목표는 부착세포에서 사용하세요.",
  "Steps: 1–100": "희석 단계는 1~100 사이의 정수로 입력하세요.",
  "Serial dilution factor must exceed 1": "연속 희석배수는 1보다 커야 합니다.",
  "Invalid event dates": "일정의 시작·종료 시각을 확인하세요.",
  "Singular standards": "표준값으로 적합 계수를 계산할 수 없습니다.",
  "Non-finite fit": "적합 결과가 유한한 수가 아닙니다.",
  "Invalid mass": "질량은 0 이상의 수로 입력하세요.",
  "Invalid standard row":
    "유효하지 않은 표준값이 있습니다. 수정하거나 명시적으로 제외하세요.",
  "Duplicate x values: combine replicates first":
    "중복 X값이 있습니다. 반복 측정의 평균을 사용하세요.",
  "At least 2 distinct standards required":
    "서로 다른 X값의 표준이 최소 2개 필요합니다.",
  "Hill requires at least 5 distinct positive x values":
    "Hill은 서로 다른 양수 X값이 최소 5개 필요합니다.",
  "Exponential requires y > 0; explicitly exclude invalid rows":
    "지수 모델은 Y > 0이어야 합니다. 오류 행은 명시적으로 제외하세요.",
  "Hill requires x > 0": "Hill은 X > 0이어야 합니다.",
  "Flat standards cannot identify this calibration":
    "일정한 Y값으로는 검량선을 결정할 수 없습니다.",
  "Hill fit did not converge":
    "Hill 적합이 수렴하지 않았습니다. 표준값과 범위를 확인하세요.",
  "Standards do not describe an increasing Hill curve":
    "증가형 Hill에 맞는 표준값이 아닙니다. 표준값과 모델을 확인하세요.",
  "Unidentifiable Hill fit": "Hill 매개변수를 결정할 수 없습니다.",
  "Target must exceed starting density":
    "목표 밀도는 현재 밀도보다 높아야 합니다.",
  "Negative medium volume": "필요 원액이 최종 배양 부피를 초과합니다.",
  "Above 100% confluence": "예상 confluence가 100%를 초과합니다.",
  "Above maximum density": "예상 밀도가 최대 밀도를 초과합니다.",
  "Notification permission denied": "알림 권한이 허용되지 않았습니다.",
  "Enable exact alarms in system settings":
    "시스템 설정에서 정확한 알람을 허용하세요.",
  "Local storage failed": "기기 저장에 실패했습니다. 저장 공간을 확인하세요.",
  "Unsupported recurrence rule":
    "지원하지 않는 반복 규칙입니다. 일·주·월 반복과 종료일을 지원합니다.",
  "Unsupported timezone or all-day ICS format":
    "이 ICS 시간대 또는 종일 일정 형식을 지원하지 않습니다.",
  "Unsupported ICS timezone": "이 시간대의 ICS 내보내기를 지원하지 않습니다.",
  "Only UTC date-time ICS values are supported":
    "ICS는 UTC 날짜·시각 형식을 지원합니다.",
  "Exactly two columns required": "X와 Y, 두 열을 입력하세요.",
  "PNG/JPEG, maximum 20 MB": "PNG/JPEG, 최대 20 MB 이미지를 선택하세요.",
  "Maximum 40 megapixels": "최대 4000만 화소 이미지를 선택하세요.",
};
export function ErrorMessage({ message }: { message: string }) {
  const t = useText();
  const raw = message.replace(/^Error: /, "");
  const translated =
    errorTranslations[raw] ??
    (raw.startsWith("Enter ") ? `${raw.slice(6)} 값을 입력하세요.` : raw);
  return message ? (
    <p role="alert" className="tool-error">
      {t(translated, raw)}
    </p>
  ) : null;
}
export const format = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n)
    ? "—"
    : new Intl.NumberFormat(undefined, { maximumSignificantDigits: 7 }).format(
        n
      );
export function calculate<T>(fn: () => T): { value: T | null; error: string } {
  try {
    const value = fn();
    if (typeof value === "number" && !Number.isFinite(value))
      throw Error("Result is not finite");
    return { value, error: "" };
  } catch (e) {
    return { value: null, error: e instanceof Error ? e.message : String(e) };
  }
}
export async function download(
  text: BlobPart,
  name: string,
  type = "text/plain"
) {
  await exportBlobPartAsFile(text, { fileName: name, mimeType: type });
}
export const csv = (rows: (string | number)[][]) =>
  "\uFEFF" +
  rows
    .map((row) =>
      row
        .map((value) => {
          let cell = String(value);
          if (
            typeof value === "string" &&
            /^[=+\-@]/.test(cell.trimStart()) &&
            !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(cell.trim())
          )
            cell = "'" + cell;
          return `"${cell.replaceAll('"', '""')}"`;
        })
        .join(",")
    )
    .join("\r\n");
export async function report({
  title,
  lines = [],
  svg,
  headers,
  rows,
  name,
}: {
  title: string;
  lines?: string[];
  svg?: SVGSVGElement | null;
  headers: string[];
  rows: (string | number)[][];
  name: string;
}) {
  const element = document.createElement("section");
  element.style.cssText =
    "width:720px;padding:20px;color:#172238;background:#fff;font:14px/1.55 Arial,sans-serif";
  const heading = document.createElement("h1");
  heading.textContent = title;
  heading.style.cssText = "font-size:24px;margin:0 0 16px";
  element.append(heading);
  for (const line of lines) {
    const p = document.createElement("p");
    p.textContent = line;
    p.style.cssText = "margin:5px 0;color:#475569";
    element.append(p);
  }
  if (svg) {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone
      .querySelectorAll("[data-handle]")
      .forEach((handle) => handle.remove());
    clone.style.color = "#172238";
    const view = svg.viewBox.baseVal,
      width = view.width || svg.clientWidth || 700,
      height = view.height || svg.clientHeight || 350;
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    const source = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(clone)], {
        type: "image/svg+xml",
      })
    );
    try {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = document.createElement("canvas"),
        scale = Math.min(2, 2000 / Math.max(width, height));
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const output = document.createElement("img");
      output.src = canvas.toDataURL("image/png");
      output.style.cssText =
        "display:block;width:100%;height:auto;margin:20px 0;max-height:620px;object-fit:contain";
      element.append(output);
    } finally {
      URL.revokeObjectURL(source);
    }
  }
  const table = document.createElement("table");
  table.style.cssText =
    "width:100%;border-collapse:collapse;margin-top:20px;font-size:13px";
  for (const [index, row] of [headers, ...rows].entries()) {
    const tr = document.createElement("tr");
    tr.style.breakInside = "avoid";
    for (const cell of row) {
      const td = document.createElement(index === 0 ? "th" : "td");
      td.textContent = String(cell);
      td.style.cssText =
        "text-align:left;padding:9px 8px;border-bottom:1px solid #cbd5e1;overflow-wrap:anywhere";
      if (index === 0) td.style.background = "#f1f5f9";
      tr.append(td);
    }
    table.append(tr);
  }
  element.append(table);
  const { default: html2pdf } = await import("html2pdf.js");
  const blob = (await html2pdf()
    .set({
      filename: name,
      margin: 8,
      html2canvas: { scale: 2, backgroundColor: "#ffffff" },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
    })
    .from(element)
    .outputPdf("blob")) as Blob;
  await download(blob, name, "application/pdf");
}

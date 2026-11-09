import { useRef, useState } from "react";
import {
  useText,
  useToolData,
  Panel,
  Field,
  Select,
  download,
  csv,
  ColorField,
} from "./ui";
type Well = {
  sample: string;
  condition: string;
  replicate: string;
  color: string;
};
export default function PlateTool() {
  const t = useText();
  const [d, set] = useToolData({
    size: "96",
    wells: {} as Record<string, Well>,
  });
  const [selected, setSelected] = useState<string[]>([]),
    [sample, setSample] = useState(""),
    [condition, setCondition] = useState(""),
    [replicate, setReplicate] = useState(""),
    [color, setColor] = useState("#bfdbfe");
  const [error, setError] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const dimensions: Record<string, [number, number]> = {
    "6": [2, 3],
    "12": [3, 4],
    "24": [4, 6],
    "48": [6, 8],
    "96": [8, 12],
    "384": [16, 24],
  };
  const [rows, cols] = dimensions[d.size];
  const names = Array.from(
    { length: rows * cols },
    (_, i) =>
      `${String.fromCharCode(65 + Math.floor(i / cols))}${(i % cols) + 1}`
  );
  const exportImage = async () => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = cols * 100 + 80;
      canvas.height = rows * 90 + 80;
      const c = canvas.getContext("2d")!;
      c.fillStyle = "white";
      c.fillRect(0, 0, canvas.width, canvas.height);
      names.forEach((name, i) => {
        const w = d.wells[name],
          x = 80 + (i % cols) * 100,
          y = 80 + Math.floor(i / cols) * 90;
        c.fillStyle = w?.color ?? "#f1f5f9";
        c.beginPath();
        c.arc(x, y, 35, 0, 2 * Math.PI);
        c.fill();
        c.fillStyle = "#0f172a";
        c.textAlign = "center";
        c.font = "13px sans-serif";
        c.fillText(name, x, y - 6);
        c.fillText(w?.sample ?? "", x, y + 12);
        c.font = "10px sans-serif";
        c.fillText(
          [w?.condition, w?.replicate].filter(Boolean).join(" · "),
          x,
          y + 26
        );
      });
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r));
      if (blob) await download(blob, "plate.png", "image/png");
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <>
      <Panel>
        <Select
          label={t("플레이트 크기", "Plate size")}
          value={d.size}
          onChange={(size) => {
            set({ ...d, size });
            setSelected([]);
          }}
          options={["6", "12", "24", "48", "96", "384"]}
        />
        <div className="tool-actions">
          <button onClick={() => setSelected(names)}>
            {t("전체 선택", "Select all")}
          </button>
          <button onClick={() => setSelected([])}>
            {t("선택 해제", "Clear selection")}
          </button>
          <span>
            {selected.length} {t("개 선택", "selected")}
          </span>
        </div>
        <div className="tool-grid">
          <Field
            type="text"
            label={t("시료", "Sample")}
            value={sample}
            onChange={setSample}
          />
          <Field
            type="text"
            label={t("조건", "Condition")}
            value={condition}
            onChange={setCondition}
          />
          <Field
            type="text"
            label={t("반복", "Replicate")}
            value={replicate}
            onChange={setReplicate}
          />
          <ColorField
            label={t("색상", "Color")}
            value={color}
            onChange={setColor}
          />
        </div>
        <div className="tool-actions">
          <button
            className="primary"
            disabled={!selected.length}
            onClick={() =>
              set({
                ...d,
                wells: {
                  ...d.wells,
                  ...Object.fromEntries(
                    selected.map((n) => [
                      n,
                      { sample, condition, replicate, color },
                    ])
                  ),
                },
              })
            }
          >
            {t("선택 well에 적용", "Apply to selected wells")}
          </button>
          <button
            onClick={() =>
              set({
                ...d,
                wells: Object.fromEntries(
                  Object.entries(d.wells).filter(([n]) => !selected.includes(n))
                ),
              })
            }
          >
            {t("선택 well 비우기", "Clear selected wells")}
          </button>
        </div>
      </Panel>
      <Panel>
        <div
          ref={ref}
          className="tool-plate"
          style={{
            gridTemplateColumns: `repeat(${cols},minmax(44px,1fr))`,
            maxWidth: cols * 78,
            marginInline: "auto",
          }}
        >
          {names.map((name) => (
            <button
              key={name}
              aria-pressed={selected.includes(name)}
              aria-label={`${name} ${d.wells[name]?.sample ?? ""}`}
              style={{
                background:
                  d.wells[name]?.color ?? "var(--tool-well-bg,#f1f5f9)",
                color: d.wells[name] ? "#0f172a" : "var(--tool-fg,#0f172a)",
                outline: selected.includes(name)
                  ? "3px solid #2563eb"
                  : undefined,
              }}
              onClick={() =>
                setSelected(
                  selected.includes(name)
                    ? selected.filter((n) => n !== name)
                    : [...selected, name]
                )
              }
            >
              {name}
              <br />
              {d.wells[name]?.sample}
            </button>
          ))}
        </div>
      </Panel>
      <p role="alert">{error}</p>
      <div className="tool-actions">
        <button
          onClick={() =>
            download(
              csv([
                ["Well", "Sample", "Condition", "Replicate", "Color"],
                ...names.map((n) => [
                  n,
                  d.wells[n]?.sample ?? "",
                  d.wells[n]?.condition ?? "",
                  d.wells[n]?.replicate ?? "",
                  d.wells[n]?.color ?? "",
                ]),
              ]),
              "plate.csv",
              "text/csv"
            )
          }
        >
          CSV
        </button>
        <button onClick={exportImage}>PNG</button>
      </div>
    </>
  );
}

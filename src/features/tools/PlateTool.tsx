import { Fragment, useRef, useState } from "react";
import { Copy, ClipboardPaste } from "lucide-react";
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
const emptyWell: Well = { sample: "", condition: "", replicate: "", color: "#bfdbfe" };
function wellTextColor(color: string) {
  const rgb = /^#[0-9a-f]{6}$/i.test(color) ? color.slice(1).match(/../g)!.map((v) => parseInt(v, 16) / 255) : [1, 1, 1];
  const [r, g, b] = rgb.map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? "#000000" : "#ffffff";
}
export default function PlateTool() {
  const t = useText();
  const [d, set] = useToolData({
    size: "96",
    wells: {} as Record<string, Well>,
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [multi, setMulti] = useState(false);
  const [draft, setDraft] = useState<Well>({ ...emptyWell });
  const [copied, setCopied] = useState<Well | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const editorRef = useRef<HTMLDivElement>(null);
  const loadSelection = (next: string[]) => {
    setSelected(next);
    setDraft({ ...(d.wells[next[0]] ?? emptyWell) });
    setMessage("");
  };
  const apply = (value: Well) => {
    if (!selected.length) return;
    set((current) => ({ ...current, wells: { ...current.wells,
      ...Object.fromEntries(selected.map((name) => [name, { ...value }])) } }));
    setMessage(t(`${selected.length}개 웰에 적용했습니다.`, `Applied to ${selected.length} wells.`));
  };
  const mixed = selected.length > 1 && selected.some((name) => {
    const first = d.wells[selected[0]] ?? emptyWell;
    const well = d.wells[name] ?? emptyWell;
    return (Object.keys(emptyWell) as (keyof Well)[]).some((key) => well[key] !== first[key]);
  });
  const dimensions: Record<string, [number, number]> = {
    "6": [2, 3],
    "12": [3, 4],
    "24": [4, 6],
    "48": [6, 8],
    "96": [8, 12],
    "384": [16, 24],
  };
  const [rows, cols] = dimensions[d.size] ?? dimensions["96"];
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
      c.fillStyle = "#475569";
      c.font = "bold 16px sans-serif";
      c.textAlign = "center";
      for (let col = 0; col < cols; col++) c.fillText(String(col + 1), 80 + col * 100, 28);
      for (let row = 0; row < rows; row++) c.fillText(String.fromCharCode(65 + row), 25, 85 + row * 90);
      names.forEach((name, i) => {
        const w = d.wells[name],
          x = 80 + (i % cols) * 100,
          y = 80 + Math.floor(i / cols) * 90;
        c.fillStyle = w?.color ?? "#f1f5f9";
        c.beginPath();
        c.arc(x, y, 35, 0, 2 * Math.PI);
        c.fill();
        c.fillStyle = wellTextColor(w?.color ?? "#f1f5f9");
        c.textAlign = "center";
        c.font = "13px sans-serif";
        c.fillText(name, x, y - 6);
        c.fillText(w?.sample ?? "", x, y + 12, 64);
        c.font = "10px sans-serif";
        c.fillText(
          [w?.condition, w?.replicate].filter(Boolean).join(" · "),
          x,
          y + 26,
          60
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
        <div className="plate-controls">
          <Select label={t("플레이트 크기", "Plate size")} value={d.size}
            onChange={(size) => { set({ ...d, size }); loadSelection([]); }}
            options={["6", "12", "24", "48", "96", "384"]} />
          <button role="switch" aria-checked={multi} onClick={() => {
            setMulti(!multi);
            if (multi && selected.length > 1) loadSelection([selected[0]]);
          }}>{t("다중 선택", "Multi-select")} · {multi ? t("켜짐", "On") : t("꺼짐", "Off")}</button>
        </div>
        <div className="tool-actions">
          <button onClick={() => { setMulti(true); loadSelection(names); }}>{t("전체 선택", "Select all")}</button>
          <button disabled={!selected.length} onClick={() => loadSelection([])}>{t("선택 해제", "Clear selection")}</button>
          <span className="tool-muted">{selected.length} {t("개 선택", "selected")}</span>
        </div>
        <p className="tool-muted">{t("웰을 눌러 편집하세요. 행·열 번호를 누르면 한 줄을 선택합니다.", "Select a well to edit. Select a row or column header to select a whole line.")}</p>
        <div className="plate-scroll" tabIndex={0} role="region" aria-label={t("플레이트 배치", "Plate layout")}>
          <div className="tool-plate plate-labelled" style={{ gridTemplateColumns: `32px repeat(${cols}, minmax(44px, 1fr))`, minWidth: cols * 50 + 40, maxWidth: cols * 78 + 40, marginInline: "auto" }}>
            <span aria-hidden="true" />
            {Array.from({length: cols}, (_, i) => <button className="plate-axis" key={i}
              aria-label={t(`${i + 1}열 선택`, `Select column ${i + 1}`)}
              onClick={() => { setMulti(true); loadSelection(names.filter((_, index) => index % cols === i)); }}>{i + 1}</button>)}
            {Array.from({length: rows}, (_, row) => <Fragment key={row}>
              <button className="plate-axis" aria-label={t(`${String.fromCharCode(65 + row)}행 선택`, `Select row ${String.fromCharCode(65 + row)}`)}
                onClick={() => { setMulti(true); loadSelection(names.slice(row * cols, (row + 1) * cols)); }}>{String.fromCharCode(65 + row)}</button>
              {names.slice(row * cols, (row + 1) * cols).map((name) => {
                const well = d.wells[name];
                return <button key={name} aria-pressed={selected.includes(name)}
                  aria-label={[name, well?.sample, well?.condition, well?.replicate].filter(Boolean).join(" · ")}
                  title={[name, well?.sample, well?.condition, well?.replicate].filter(Boolean).join(" · ")}
                  style={{ background: well?.color ?? "var(--tool-well-bg,#f1f5f9)", color: well ? wellTextColor(well.color) : "var(--tool-fg,#0f172a)" }}
                  onClick={() => loadSelection(multi ? selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name] : [name])}>
                  <span className="plate-well-id">{name}</span><span className="plate-well-label">{well?.sample || "—"}</span>
                </button>;
              })}
            </Fragment>)}
          </div>
        </div>
      </Panel>
      <div ref={editorRef} tabIndex={-1} className="plate-editor">
      <Panel>
        <div className="plate-editor-heading">
          <h2>{selected.length === 1 ? selected[0] : t("선택한 웰 편집", "Edit selected wells")}</h2>
          {selected.length > 0 && (          <div className="plate-editor-clipboard">
            <button aria-label={t("내용 복사", "Copy content")} title={t("내용 복사", "Copy content")} disabled={selected.length !== 1} onClick={() => { setCopied({ ...draft }); setMessage(t("편집 중인 웰 내용을 복사했습니다.", "Copied the current well draft.")); }}><Copy size={18} aria-hidden="true" /></button>
            <button aria-label={t("붙여넣기", "Paste")} title={t("붙여넣기", "Paste")} disabled={!copied} onClick={() => { if (copied) { setDraft({ ...copied }); setMessage(t("붙여넣었습니다. 적용 버튼을 눌러 저장하세요.", "Pasted. Apply to save.")); } }}><ClipboardPaste size={18} aria-hidden="true" /></button>
          </div>
)}
        </div>
        {!selected.length ? <p className="tool-muted">{t("위 플레이트에서 편집할 웰을 선택하세요.", "Select a well on the plate above to edit.")}</p> : <>
          {selected.length > 1 && <p className="plate-selection">{selected.join(", ")}</p>}
          {mixed && <p className="tool-muted">{t("서로 다른 내용이 선택되었습니다. 첫 번째 웰의 내용을 표시하며, 적용하면 선택한 모든 웰의 내용과 색상이 바뀝니다.", "Selected wells have different values. Showing the first well; applying replaces all fields and colors in the selection.")}</p>}
          <div className="plate-editor-fields">
            <Field type="text" label={t("시료", "Sample")} value={draft.sample} onChange={(sample) => setDraft({ ...draft, sample })} />
            <Field type="text" label={t("조건 / 농도", "Condition / concentration")} value={draft.condition} onChange={(condition) => setDraft({ ...draft, condition })} />
            <Field type="text" label={t("반복", "Replicate")} value={draft.replicate} onChange={(replicate) => setDraft({ ...draft, replicate })} />
            <ColorField label={t("색상", "Color")} value={draft.color} onChange={(color) => setDraft({ ...draft, color })} />
          </div>
          <div className="tool-actions">
            <button className="primary" onClick={() => apply(draft)}>{t("선택 웰에 적용", "Apply to selected wells")}</button>
            <button onClick={() => { set((current) => ({ ...current, wells: Object.fromEntries(Object.entries(current.wells).filter(([name]) => !selected.includes(name))) })); setDraft({ ...emptyWell }); setMessage(t("선택한 웰을 비웠습니다.", "Selected wells cleared.")); }}>{t("선택 웰 비우기", "Clear selected wells")}</button>
          </div>
        </>}
        <p className="plate-editor-status" role="status">{message}</p>
      </Panel>
      </div>
      <Panel title={t("웰 목록", "Well list")}>
        {names.some((name) => d.wells[name]) ? <div className="tool-table-wrap"><table>
          <thead><tr><th>{t("웰", "Well")}</th><th>{t("시료", "Sample")}</th><th>{t("조건 / 농도", "Condition / concentration")}</th><th>{t("반복", "Replicate")}</th></tr></thead>
          <tbody>{names.filter((name) => d.wells[name]).map((name) => <tr key={name} className={selected.includes(name) ? "plate-selected-row" : undefined}>
            <td><button className="plate-list-well" aria-label={t(`${name} 편집`, `Edit ${name}`)} aria-pressed={selected.includes(name)} onClick={() => { setMulti(false); loadSelection([name]); editorRef.current?.scrollIntoView({ block: "start" }); editorRef.current?.focus({ preventScroll: true }); }}><span className="plate-color-dot" style={{background: d.wells[name].color}} />{name}</button></td>
            <td>{d.wells[name].sample || "—"}</td><td>{d.wells[name].condition || "—"}</td><td>{d.wells[name].replicate || "—"}</td>
          </tr>)}</tbody>
        </table></div> : <p className="tool-muted">{t("웰에 내용을 적용하면 이곳에 표시됩니다.", "Apply labels to wells to see them here.")}</p>}
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

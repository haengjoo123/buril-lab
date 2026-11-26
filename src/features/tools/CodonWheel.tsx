import { useRef, useState, type KeyboardEvent } from "react";
import { aminoAcids, codons } from "./library";
import { useText } from "./ui";
const polar = (r: number, a: number) =>
  `${300 + r * Math.cos(a)},${300 + r * Math.sin(a)}`;
const sector = (inner: number, outer: number, start: number, end: number) =>
  `M${polar(inner, start)} L${polar(
    outer,
    start
  )} A${outer},${outer} 0 0 1 ${polar(outer, end)} L${polar(
    inner,
    end
  )} A${inner},${inner} 0 0 0 ${polar(inner, start)} Z`;
/** Sectors per ring, from the centre: first base, first two, whole codon. */
const RINGS = [4, 16, 64];
// Light fills; the dark theme replaces them by tone in tools.css.
const FILLS: Record<string, string> = {
  U: "#bfdbfe",
  C: "#fde68a",
  A: "#fecdd3",
  G: "#bbf7d0",
  start: "#bbf7d0",
  stop: "#fecaca",
};
function geometry(ring: number, index: number) {
  const count = RINGS[ring],
    start = (index / count) * 2 * Math.PI - Math.PI / 2,
    end = ((index + 1) / count) * 2 * Math.PI - Math.PI / 2,
    inner = ring * 75 + 35;
  return { start, end, inner, outer: inner + 75 };
}
/**
 * The genetic code as a wheel read from the centre outward. One sector is in
 * the tab order; the arrow keys move from it (left and right around a ring,
 * up toward the centre, down toward the rim) and Enter or Space chooses it.
 */
export default function CodonWheel({
  onSelect,
  selected = "",
  highlight = null,
  dna = false,
  describedBy,
}: {
  /** Called with the bases of the chosen sector: "A", "AU" or "AUG". */
  onSelect: (bases: string) => void;
  /** The sector that is chosen, by its bases. */
  selected?: string;
  /** Codons that stay at full strength while the rest recede; null for all. */
  highlight?: readonly string[] | null;
  dna?: boolean;
  /** Id of the text that explains the keys. */
  describedBy?: string;
}) {
  const t = useText(),
    root = useRef<SVGSVGElement>(null),
    // The sector the keyboard is on: [ring, index].
    [cursor, setCursor] = useState<[number, number]>([0, 0]),
    [focused, setFocused] = useState(false);
  const show = (text: string) => (dna ? text.replaceAll("U", "T") : text);
  const move = (ring: number, index: number) => {
    setCursor([ring, index]);
    root.current
      ?.querySelector<SVGGElement>(`[data-sector="${ring}:${index}"]`)
      ?.focus();
  };
  const onKey = (event: KeyboardEvent, ring: number, index: number) => {
    const count = RINGS[ring];
    const target: [number, number] | null =
      event.key === "ArrowRight"
        ? [ring, (index + 1) % count]
        : event.key === "ArrowLeft"
        ? [ring, (index + count - 1) % count]
        : event.key === "ArrowDown"
        ? ring < 2
          ? [ring + 1, index * 4]
          : [ring, index]
        : event.key === "ArrowUp"
        ? ring > 0
          ? [ring - 1, Math.floor(index / 4)]
          : [ring, index]
        : event.key === "Home"
        ? [ring, 0]
        : event.key === "End"
        ? [ring, count - 1]
        : null;
    if (target) {
      event.preventDefault();
      move(...target);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(codons[index * (64 / count)].codon.slice(0, ring + 1));
    }
  };
  const outline = geometry(...cursor);
  return (
    <svg
      ref={root}
      viewBox="0 0 600 600"
      className="tool-codon-wheel tool-lib-x-wheel"
      role="group"
      aria-label={t(
        "코돈 휠 · 중심에서 바깥쪽으로",
        "Codon wheel · read from center outward"
      )}
      aria-describedby={describedBy}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      {RINGS.flatMap((count, ring) =>
        Array.from({ length: count }, (_, i) => {
          const { start, end, inner, outer } = geometry(ring, i),
            mid = (start + end) / 2,
            r = (inner + outer) / 2,
            codon = codons[i * (64 / count)],
            prefix = codon.codon.slice(0, ring + 1),
            amino = aminoAcids.find((a) => a[0] === codon.amino),
            text =
              ring === 2
                ? `${codon.codon[2]} · ${codon.amino}`
                : codon.codon[ring],
            tone =
              ring === 2 && codon.amino === "*"
                ? "stop"
                : ring === 2 && codon.codon === "AUG"
                ? "start"
                : codon.codon[ring],
            lit =
              !highlight || highlight.some((item) => item.startsWith(prefix));
          return (
            <g
              key={`${ring}:${i}`}
              data-sector={`${ring}:${i}`}
              role="button"
              tabIndex={cursor[0] === ring && cursor[1] === i ? 0 : -1}
              aria-label={
                ring < 2
                  ? t(
                      `${show(prefix)}로 시작하는 코돈`,
                      `Codons starting with ${show(prefix)}`
                    )
                  : codon.amino === "*"
                  ? `${show(prefix)} ${t("종결 코돈", "stop codon")}`
                  : `${show(prefix)} ${
                      amino ? t(amino[3], amino[2]) : codon.amino
                    } (${amino?.[1] ?? codon.amino})${
                      prefix === "AUG"
                        ? `, ${t("시작 코돈", "start codon")}`
                        : ""
                    }`
              }
              aria-pressed={selected === prefix}
              onClick={() => {
                setCursor([ring, i]);
                onSelect(prefix);
              }}
              onFocus={() => setCursor([ring, i])}
              onKeyDown={(event) => onKey(event, ring, i)}
            >
              <path
                className="tool-lib-x-sector"
                data-tone={tone}
                d={sector(inner, outer, start, end)}
                fill={FILLS[tone]}
                stroke="#94a3b8"
                strokeWidth=".5"
                opacity={lit ? 1 : 0.35}
              />
              <text
                className="tool-lib-x-sector-text"
                x={300 + r * Math.cos(mid)}
                y={300 + r * Math.sin(mid)}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={ring === 2 ? 10 : 18}
                fontWeight={selected === prefix ? 700 : undefined}
                fill="#0f172a"
                opacity={lit ? 1 : 0.6}
                transform={
                  ring === 2
                    ? `rotate(${(mid * 180) / Math.PI + 90} ${
                        300 + r * Math.cos(mid)
                      } ${300 + r * Math.sin(mid)})`
                    : undefined
                }
              >
                {show(text)}
              </text>
            </g>
          );
        })
      )}
      {/* Drawn last so that neighbouring sectors cannot paint over it. */}
      {focused && (
        <path
          className="tool-lib-x-wheel-focus"
          d={sector(outline.inner, outline.outer, outline.start, outline.end)}
          fill="none"
          stroke="#1d4ed8"
          strokeWidth="3"
          pointerEvents="none"
        />
      )}
      <text
        x="300"
        y="300"
        textAnchor="middle"
        fill="currentColor"
        fontSize="12"
      >
        5′
      </text>
    </svg>
  );
}

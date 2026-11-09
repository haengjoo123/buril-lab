import { codons } from "./library";
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
export default function CodonWheel({
  onSelect,
  selected = "",
  dna = false,
}: {
  onSelect: (codon: string) => void;
  selected?: string;
  dna?: boolean;
}) {
  const t = useText();
  return (
    <svg
      viewBox="0 0 600 600"
      className="tool-codon-wheel"
      role="group"
      aria-label={t(
        "코돈 휠 · 중심에서 바깥쪽으로",
        "Codon wheel · read from center outward"
      )}
    >
      {[4, 16, 64].flatMap((count, ring) =>
        Array.from({ length: count }, (_, i) => {
          const start = (i / count) * 2 * Math.PI - Math.PI / 2,
            end = ((i + 1) / count) * 2 * Math.PI - Math.PI / 2,
            mid = (start + end) / 2,
            inner = ring * 75 + 35,
            outer = inner + 75,
            r = (inner + outer) / 2,
            codon = codons[ring === 0 ? i * 16 : ring === 1 ? i * 4 : i],
            prefix = codon.codon.slice(0, ring + 1),
            text =
              ring === 0
                ? codon.codon[0]
                : ring === 1
                ? codon.codon[1]
                : `${codon.codon[2]} · ${codon.amino}`,
            fill =
              ring === 2 && codon.amino === "*"
                ? "#fecaca"
                : ring === 2 && codon.codon === "AUG"
                ? "#bbf7d0"
                : (
                    {
                      U: "#bfdbfe",
                      C: "#fde68a",
                      A: "#fecdd3",
                      G: "#bbf7d0",
                    } as Record<string, string>
                  )[codon.codon[ring]];
          return (
            <g
              key={`${ring}:${i}`}
              role="button"
              tabIndex={0}
              aria-label={dna ? prefix.replaceAll("U", "T") : prefix}
              aria-pressed={selected === prefix}
              onClick={() => onSelect(prefix)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(prefix);
                }
              }}
            >
              <path
                d={sector(inner, outer, start, end)}
                fill={fill}
                stroke="#94a3b8"
                strokeWidth=".5"
                opacity={
                  !selected ||
                  prefix.startsWith(selected) ||
                  selected.startsWith(prefix)
                    ? 1
                    : 0.35
                }
              />
              <text
                x={300 + r * Math.cos(mid)}
                y={300 + r * Math.sin(mid)}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={ring === 2 ? 10 : 18}
                fill="#0f172a"
                transform={
                  ring === 2
                    ? `rotate(${(mid * 180) / Math.PI + 90} ${
                        300 + r * Math.cos(mid)
                      } ${300 + r * Math.sin(mid)})`
                    : undefined
                }
              >
                {dna ? text.replaceAll("U", "T") : text}
              </text>
            </g>
          );
        })
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

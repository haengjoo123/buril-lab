import { useContext, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { searchChemical } from "../../services/searchService";
import { ToolContext, useText, ErrorMessage, format } from "./ui";
import { updatePreferences } from "./preferences";

export type Reagent = {
  name: string;
  casNumber?: string;
  molecularFormula?: string;
  molecularWeight: number;
};
const RECENT_LIMIT = 8;
const sameReagent = (a: Reagent, b: Reagent) =>
  a.casNumber === b.casNumber && a.name === b.name;

/**
 * Finds a reagent's molecular weight through the app's chemical search and
 * hands it to the tool. The reagents used recently are kept with the account,
 * so a weight looked up in one tool is one tap away in the others. It reads
 * the chemical search only; the lab's inventory is not involved.
 */
export default function ReagentLookup({
  onApply,
}: {
  onApply: (reagent: Reagent) => void;
}) {
  const t = useText(),
    ctx = useContext(ToolContext);
  const [query, setQuery] = useState(""),
    [found, setFound] = useState<Reagent | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  // A newer search or an edited query makes an answer still in flight stale.
  const request = useRef(0);
  const stored = ctx?.repo.items.find(
    (row) => row.doc.data._preferences === true
  )?.doc.data.reagents;
  const recent = (Array.isArray(stored) ? stored : []).filter(
    (entry): entry is Reagent =>
      !!entry &&
      typeof entry.name === "string" &&
      typeof entry.molecularWeight === "number"
  );
  const apply = (reagent: Reagent) => {
    onApply(reagent);
    setFound(null);
    setError("");
    if (ctx)
      void updatePreferences(ctx.repo, {
        reagents: [
          reagent,
          ...recent.filter((entry) => !sameReagent(entry, reagent)),
        ].slice(0, RECENT_LIMIT),
      }).catch(() => {
        /* The recent list is a convenience; the weight is already applied. */
      });
  };
  const lookup = async () => {
    const current = ++request.current;
    setBusy(true);
    setError("");
    setFound(null);
    try {
      const chemical = await searchChemical(query);
      if (current !== request.current) return;
      if (
        chemical?.molecularWeight &&
        Number.isFinite(chemical.molecularWeight) &&
        chemical.molecularWeight > 0
      )
        setFound({
          name: chemical.name,
          casNumber: chemical.casNumber,
          molecularFormula: chemical.molecularFormula,
          molecularWeight: chemical.molecularWeight,
        });
      else
        setError(
          t(
            "분자량을 찾지 못했습니다. 시약 라벨의 값을 직접 입력하세요.",
            "Molecular weight unavailable. Enter the value on the reagent label."
          )
        );
    } catch {
      if (current === request.current)
        setError(
          t(
            "시약을 검색하지 못했습니다. 연결을 확인하거나 분자량을 직접 입력하세요.",
            "Reagent search failed. Check your connection or enter molecular weight manually."
          )
        );
    } finally {
      if (current === request.current) setBusy(false);
    }
  };
  return (
    <details className="tool-molarity-lookup">
      <summary>
        <Search size={17} />
        <span>{t("시약에서 분자량 찾기", "Find reagent molecular weight")}</span>
        <ChevronDown size={16} />
      </summary>
      <div className="tool-molarity-lookup-body">
        <form
          className="tool-molarity-search"
          onSubmit={(event) => {
            event.preventDefault();
            void lookup();
          }}
        >
          <input
            type="search"
            aria-label={t("시약 검색", "Search reagent")}
            placeholder={t("시약명·화학식·CAS", "Name, formula or CAS")}
            value={query}
            onChange={(event) => {
              request.current++;
              setBusy(false);
              setFound(null);
              setError("");
              setQuery(event.target.value);
            }}
          />
          <button type="submit" disabled={busy || !query.trim()}>
            {busy ? t("검색 중…", "Searching…") : t("검색", "Search")}
          </button>
        </form>
        <ErrorMessage message={error} />
        {found && (
          <div className="tool-molarity-found">
            <strong>{found.name}</strong>
            <span>
              {[found.molecularFormula, found.casNumber]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <div>
              <b>{format(found.molecularWeight)} g/mol</b>
              <button onClick={() => apply(found)}>
                {t("이 분자량 적용", "Use this molecular weight")}
              </button>
            </div>
          </div>
        )}
        {recent.length > 0 && (
          <div className="tool-molarity-recents">
            <p className="tool-muted">
              {t("최근 사용한 시약", "Recent reagents")}
            </p>
            {recent.map((reagent, index) => (
              <button
                key={`${reagent.casNumber}-${index}`}
                onClick={() => apply(reagent)}
              >
                <span>{reagent.name}</span>
                <span>{format(reagent.molecularWeight)} g/mol</span>
              </button>
            ))}
          </div>
        )}
        <p className="tool-muted">
          {t(
            "시약의 수화물·염 형태와 라벨 분자량을 확인한 뒤 적용하세요.",
            "Check the hydrate or salt form and molecular weight on your reagent label."
          )}
        </p>
      </div>
    </details>
  );
}

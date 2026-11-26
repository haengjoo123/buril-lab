import { useRef } from "react";
import { Link } from "react-router-dom";
import {
  BookOpen,
  Calculator,
  FlaskConical,
  Search,
  SearchX,
  Star,
} from "lucide-react";
import { tools, type Tool, type ToolCategory } from "./registry";
import { toolIcons } from "./toolIcons";
import { searchTools, type RecentTool } from "./catalog";
import { useText } from "./ui";

const categories = [
  ["Lab", "실험", FlaskConical],
  ["General", "일반", Calculator],
  ["Library", "라이브러리", BookOpen],
] as const;
const PANEL_ID = "tool-catalog-panel";

/**
 * The tool list. Search text and the favorites filter are owned by the
 * workspace so they are still there when the user comes back from a tool.
 */
export default function ToolCatalog({
  category,
  onCategory,
  query,
  onQuery,
  favoritesOnly,
  onFavoritesOnly,
  favorites,
  recent,
  onToggleFavorite,
  returnTo,
}: {
  category: ToolCategory;
  onCategory: (category: ToolCategory) => void;
  query: string;
  onQuery: (query: string) => void;
  favoritesOnly: boolean;
  onFavoritesOnly: (on: boolean) => void;
  favorites: readonly string[];
  recent: readonly RecentTool[];
  onToggleFavorite: (id: string) => void;
  /** Where the back button of an opened tool should return to. */
  returnTo: string;
}) {
  const t = useText();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const searching = query.trim() !== "";
  const listed = (
    searching
      ? searchTools(query, tools)
      : tools.filter((tool) => favoritesOnly || tool.category === category)
  ).filter((tool) => !favoritesOnly || favorites.includes(tool.id));
  const byId = (id: string) => tools.find((tool) => tool.id === id);
  const pinned = favorites.map(byId).filter((tool): tool is Tool => !!tool);
  const recentTools = recent
    .map((entry) => byId(entry.id))
    .filter((tool): tool is Tool => !!tool)
    .slice(0, 5);
  const name = (tool: Tool) => t(tool.ko, tool.en);
  const open = (tool: Tool) => ({
    to: `/app/tools/${tool.id}`,
    state: { toolsCatalogReturn: returnTo },
  });
  const chips = (title: string, list: Tool[]) =>
    list.length > 0 && (
      <section className="tool-quick" aria-label={title}>
        <h2>{title}</h2>
        <div className="tool-quick-list">
          {list.map((tool) => {
            const Icon = toolIcons[tool.id];
            return (
              <Link className="tool-quick-chip" key={tool.id} {...open(tool)}>
                <Icon size={16} aria-hidden="true" />
                {name(tool)}
              </Link>
            );
          })}
        </div>
      </section>
    );
  return (
    <>
      <div
        role="tablist"
        aria-label={t("도구 분류", "Tool categories")}
        className="tool-tabs"
        onKeyDown={(event) => {
          // Arrow keys move between tabs; Tab itself reaches only the open one.
          const index = categories.findIndex(([id]) => id === category);
          const next =
            event.key === "ArrowRight"
              ? (index + 1) % categories.length
              : event.key === "ArrowLeft"
              ? (index + categories.length - 1) % categories.length
              : event.key === "Home"
              ? 0
              : event.key === "End"
              ? categories.length - 1
              : -1;
          if (next < 0) return;
          event.preventDefault();
          onCategory(categories[next][0]);
          tabs.current[next]?.focus();
        }}
      >
        {categories.map(([id, ko, Icon], index) => (
          <button
            key={id}
            ref={(element) => {
              tabs.current[index] = element;
            }}
            role="tab"
            aria-selected={category === id}
            aria-controls={PANEL_ID}
            tabIndex={category === id ? 0 : -1}
            onClick={() => onCategory(id)}
          >
            <Icon size={17} aria-hidden="true" />
            <span>{t(ko, id)}</span>
          </button>
        ))}
      </div>
      <div className="tool-search-row">
        <label className="tool-search">
          <Search size={19} aria-hidden="true" />
          <input
            type="search"
            enterKeyHint="search"
            aria-label={t("도구 검색", "Search tools")}
            placeholder={t(
              "도구 검색 (예: 원심, C1V1, PCR)",
              "Search tools (e.g. RCF, C1V1, PCR)"
            )}
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </label>
        <button
          className={`tool-favorite-filter ${favoritesOnly ? "active" : ""}`}
          aria-pressed={favoritesOnly}
          aria-label={t("즐겨찾기만 보기", "Show favorites")}
          onClick={() => onFavoritesOnly(!favoritesOnly)}
        >
          <Star size={20} fill={favoritesOnly ? "currentColor" : "none"} />
          <span>{t("즐겨찾기", "Favorites")}</span>
        </button>
      </div>
      <div className="tool-catalog-body" id={PANEL_ID} role="tabpanel">
        {/* With a search or the favorites filter on, the list below is the answer; shortcuts would only repeat it. */}
        {!searching && !favoritesOnly && (
          <>
            {chips(t("즐겨찾기", "Favorites"), pinned)}
            {chips(t("최근 사용", "Recently used"), recentTools)}
          </>
        )}
        {(searching || favoritesOnly) && (
          <p className="sr-only" role="status">
            {t(`도구 ${listed.length}개`, `${listed.length} tools`)}
          </p>
        )}
        {listed.length === 0 ? (
          <div className="tool-empty-state">
            {searching ? (
              <SearchX size={28} aria-hidden="true" />
            ) : (
              <Star size={28} aria-hidden="true" />
            )}
            <strong>
              {searching
                ? t("맞는 도구가 없습니다", "No matching tools")
                : t("즐겨찾기한 도구가 없습니다", "No favorite tools yet")}
            </strong>
            <p>
              {searching
                ? t(
                    "다른 이름이나 약어로 검색해 보세요. 예: 희석, RCF, 표준곡선",
                    "Try another name or abbreviation, such as dilution, RCF or standard curve."
                  )
                : t(
                    "도구 카드의 별을 누르면 여기에 모입니다.",
                    "Tap the star on a tool card to keep it here."
                  )}
            </p>
            {searching ? (
              <button onClick={() => onQuery("")}>
                {t("검색 지우기", "Clear search")}
              </button>
            ) : (
              <button onClick={() => onFavoritesOnly(false)}>
                {t("모든 도구 보기", "Show all tools")}
              </button>
            )}
          </div>
        ) : (
          <div className="tool-catalog">
            {listed.map((tool) => {
              const Icon = toolIcons[tool.id],
                favorite = favorites.includes(tool.id);
              return (
                <article className="tool-card" key={tool.id}>
                  <span className="tool-card-icon" aria-hidden="true">
                    <Icon size={20} />
                  </span>
                  <Link {...open(tool)}>{name(tool)}</Link>
                  <button
                    aria-label={`${t("즐겨찾기", "Favorite")} ${name(tool)}`}
                    aria-pressed={favorite}
                    onClick={() => onToggleFavorite(tool.id)}
                  >
                    <Star size={16} fill={favorite ? "currentColor" : "none"} />
                  </button>
                  <p>{t(tool.descKo, tool.descEn)}</p>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

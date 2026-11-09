import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import { ToolContext } from "./ui";
import { tools, type ToolDocument } from "./registry";
import type { ToolRepository } from "./repository";
import Equation from "./EquationTool";
import Calibration from "./CalibrationTool";
import Culture from "./CultureTool";
import ImageEditor from "./ImageTool";
import Calendar from "./CalendarTool";
import Plate from "./PlateTool";
import {
  DilutionTool,
  MolarityTool,
  MixTool,
  UnitTool,
  CounterTool,
  CellCounterTool,
} from "./CalculationTools";
import { AminoTool, CodonTool, PeriodicTool, LadderTool } from "./LibraryTools";
import {
  TimerTool,
  AlarmTool,
  NotesTool,
  elapsedTime,
  remainingTime,
  nextAlarm,
  type Clock,
} from "./TimeTools";
import { codons, aminoAcids } from "./library";
import { elementNamesKo } from "./elementNames";
const locale = vi.hoisted(() => ({ language: "ko" }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: locale, t: (s: string) => s }),
}));
vi.mock("../../services/supabaseClient", () => ({ supabase: {} }));
vi.mock("../../locales/i18n", () => ({
  default: { language: "ko", t: (s: string) => s },
}));
describe("tool screen coverage", () => {
  const screens = [
    <DilutionTool />,
    <MolarityTool />,
    <MixTool />,
    <MixTool medium />,
    <Plate />,
    <ImageEditor gel />,
    <ImageEditor />,
    <Culture />,
    <CellCounterTool />,
    <TimerTool />,
    <TimerTool stopwatch />,
    <AlarmTool />,
    <CounterTool />,
    <Equation calculator />,
    <UnitTool />,
    <Equation />,
    <Calibration />,
    <NotesTool />,
    <Calendar />,
    <AminoTool />,
    <CodonTool />,
    <LadderTool />,
    <PeriodicTool />,
  ];
  it.each(
    ["ko", "en"].flatMap((language) =>
      tools.map((tool, i) => [tool[0], i, language] as const)
    )
  )("renders functional controls for %s (%s, %s)", (id, i, language) => {
    locale.language = language;
    const doc: ToolDocument = {
      id: "doc",
      owner_id: "owner",
      tool_id: id,
      title: "Test",
      data:
        id === "timer" || id === "stopwatch"
          ? {
              clocks: [
                {
                  id: "1",
                  name: "Test clock",
                  color: "#2563eb",
                  duration: 60000,
                  remaining: 60000,
                  end: null,
                  running: false,
                  elapsed: 0,
                  started: null,
                },
              ],
            }
          : id === "alarm"
          ? {
              alarms: [
                {
                  id: "1",
                  name: "Test alarm",
                  at: "2026-12-01T10:00:00.000Z",
                  weekdays: [],
                  active: true,
                },
              ],
            }
          : {},
      schema_version: 1,
      engine_version: "1",
      revision: 0,
      updated_at: "",
    };
    const repo = {
      owner: "owner",
      items: [{ doc }],
      update: vi.fn(),
    } as unknown as ToolRepository;
    const html = renderToStaticMarkup(
      <ToolContext.Provider value={{ doc, repo, documents: [] }}>
        {screens[i]}
      </ToolContext.Provider>
    );
    expect(html.length).toBeGreaterThan(200);
    expect(html).toMatch(/button|input|select/);
    expect(html).not.toContain("NaN");
    if (language === "en") expect(html).not.toMatch(/[가-힣]/);
  });
  it("has complete standard reference sets", () => {
    expect(codons).toHaveLength(64);
    expect(new Set(codons.map((c) => c.codon)).size).toBe(64);
    expect(codons.find((c) => c.codon === "AUG")?.amino).toBe("M");
    expect(aminoAcids).toHaveLength(20);
    expect(elementNamesKo).toHaveLength(118);
  });
  it("restores elapsed clocks from timestamps rather than interval ticks", () => {
    const c: Clock = {
      id: "1",
      name: "Timer",
      color: "#000",
      duration: 60000,
      remaining: 60000,
      end: 65000,
      running: true,
      elapsed: 1000,
      started: 5000,
    };
    expect(remainingTime(c, 35000)).toBe(30000);
    expect(remainingTime(c, 100000)).toBe(0);
    expect(elapsedTime(c, 35000)).toBe(31000);
  });
  it("reschedules weekday alarms after the current occurrence", () => {
    const at = new Date(2026, 10, 9, 10, 0);
    const a = {
      id: "1",
      name: "Alarm",
      at: at.toISOString(),
      weekdays: [1],
      active: true,
    };
    expect(nextAlarm(a, +at - 1)).toBe(+at);
    expect(nextAlarm(a, +at + 1)).toBe(+new Date(2026, 10, 16, 10, 0));
  });
});

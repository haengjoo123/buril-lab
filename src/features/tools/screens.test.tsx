import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import { ToolContext, ErrorMessage, csv, calculate, need } from "./ui";
import { tools, type ToolDocument, type ToolId } from "./registry";
import type { ToolRepository } from "./repository";
import Equation from "./EquationTool";
import CalculatorTool from "./CalculatorTool";
import Calibration from "./CalibrationTool";
import Culture from "./CultureTool";
import ImageEditor from "./ImageTool";
import Calendar from "./CalendarTool";
import Plate from "./PlateTool";
import DilutionTool from "./DilutionTool";
import MolarityTool from "./MolarityTool";
import MixTool from "./MixTool";
import UnitTool from "./UnitTool";
import CounterTool from "./CounterTool";
import CellCounterTool from "./CellCounterTool";
import AminoTool from "./AminoTool";
import CodonTool from "./CodonTool";
import PeriodicTool from "./PeriodicTool";
import LadderTool from "./LadderTool";
import TimerTool from "./TimerTool";
import AlarmTool from "./AlarmTool";
import NotesTool from "./NotesTool";
import {
  elapsedTime,
  remainingTime,
  toggleClock,
  nextAlarm,
  type Clock,
} from "./clock";
import PrimerTool from "./PrimerTool";
import NucleicAcidTool from "./NucleicAcidTool";
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
  // Keyed by tool id, so adding or reordering tools in the registry cannot
  // silently pair a tool with another tool's screen.
  const screens: Record<ToolId, ReactElement> = {
    dilution: <DilutionTool />,
    molarity: <MolarityTool />,
    "master-mix": <MixTool />,
    "medium-buffer": <MixTool medium />,
    "plate-labelling": <Plate />,
    "gel-blot": <ImageEditor gel />,
    "image-measurer": <ImageEditor />,
    "cell-culture": <Culture />,
    "cell-counter": <CellCounterTool />,
    primer: <PrimerTool />,
    "nucleic-acid": <NucleicAcidTool />,
    timer: <TimerTool />,
    stopwatch: <TimerTool stopwatch />,
    alarm: <AlarmTool />,
    counter: <CounterTool />,
    calculator: <CalculatorTool />,
    "unit-converter": <UnitTool />,
    "custom-equation": <Equation />,
    "calibration-curve": <Calibration />,
    notes: <NotesTool />,
    calendar: <Calendar />,
    "amino-acids": <AminoTool />,
    codons: <CodonTool />,
    ladders: <LadderTool />,
    "periodic-table": <PeriodicTool />,
  };
  it.each(
    ["ko", "en"].flatMap((language) =>
      tools.map((tool) => [tool.id, language] as const)
    )
  )("renders functional controls for %s (%s)", (id, language) => {
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
        {screens[id]}
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
  it("treats an empty required field as incomplete rather than an error", () => {
    const sum = (a: string, b: string) => calculate(() => need(a) + need(b));
    expect(sum("1", "2")).toEqual({ value: 3, error: "", incomplete: false });
    expect(sum("1", " ")).toEqual({ value: null, error: "", incomplete: true });
    expect(sum("1", "x")).toEqual({
      value: null,
      error: "Invalid number",
      incomplete: false,
    });
    // Zero is a value that was entered.
    expect(sum("0", "0").value).toBe(0);
  });
  it("writes numeric CSV cells without floating-point residue", () => {
    expect(csv([["Total", 4.35 * 100, "µL"]])).toBe(
      '﻿"Total","435","µL"'
    );
  });
  it("translates every message instead of gluing Korean onto English words", () => {
    locale.language = "ko";
    const shown = (message: string) =>
      renderToStaticMarkup(<ErrorMessage message={message} />);
    expect(shown("Error: Enter a positive rotor radius")).toContain(
      "로터 반지름"
    );
    expect(shown("Enter a non-negative speed or force")).not.toContain("speed");
    expect(shown("Enter non-negative values")).toContain("0 이상의 값");
    // An equation variable is the one case that is composed.
    expect(shown("Enter rate_1")).toContain("rate_1 값을 입력하세요.");
    expect(shown("Enter 농도")).toContain("농도 값을 입력하세요.");
    // An untranslated sentence is shown as written, not half-translated.
    expect(shown("Enter the missing thing")).toContain(
      ">Enter the missing thing<"
    );
  });
  it("restarts a finished countdown from its full duration, not the paused remainder", () => {
    const idle: Clock = {
      id: "1",
      name: "Timer",
      color: "#000",
      duration: 300000,
      remaining: 300000,
      end: null,
      running: false,
      elapsed: 0,
      started: null,
    };
    const press = (clock: Clock, at: number, stopwatch = false): Clock => ({
      ...clock,
      ...toggleClock(clock, at, stopwatch),
    });
    const paused = press(press(idle, 0), 180000);
    expect(paused.running).toBe(false);
    expect(paused.remaining).toBe(120000);
    const resumed = press(paused, 200000);
    expect(resumed.end).toBe(320000);
    // It ran out at 320 s; the button now reads "Restart".
    const restarted = press(resumed, 400000);
    expect(restarted.running).toBe(true);
    expect(restarted.end).toBe(700000);
    expect(restarted.remaining).toBe(300000);
    // A stopwatch has no duration to run out of: the same press pauses it.
    const watch = press(
      press({ ...idle, duration: 0, remaining: 0 }, 1000, true),
      6000,
      true
    );
    expect(watch.running).toBe(false);
    expect(watch.elapsed).toBe(5000);
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

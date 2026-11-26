import { lazy } from "react";
import type { ToolId } from "./registry";

// One chunk per tool: opening the timer does not download the note editor.
const Dilution = lazy(() => import("./DilutionTool")),
  Molarity = lazy(() => import("./MolarityTool")),
  Mix = lazy(() => import("./MixTool")),
  Plate = lazy(() => import("./PlateTool")),
  ImageEditor = lazy(() => import("./ImageTool")),
  Culture = lazy(() => import("./CultureTool")),
  CellCounter = lazy(() => import("./CellCounterTool")),
  Timer = lazy(() => import("./TimerTool")),
  Alarm = lazy(() => import("./AlarmTool")),
  Counter = lazy(() => import("./CounterTool")),
  Calculator = lazy(() => import("./CalculatorTool")),
  Unit = lazy(() => import("./UnitTool")),
  Equation = lazy(() => import("./EquationTool")),
  Calibration = lazy(() => import("./CalibrationTool")),
  Notes = lazy(() => import("./NotesTool")),
  Calendar = lazy(() => import("./CalendarTool")),
  Amino = lazy(() => import("./AminoTool")),
  Codon = lazy(() => import("./CodonTool")),
  Ladder = lazy(() => import("./LadderTool")),
  Periodic = lazy(() => import("./PeriodicTool"));

export default function ToolScreen({ id }: { id: ToolId }) {
  switch (id) {
    case "dilution":
      return <Dilution />;
    case "molarity":
      return <Molarity />;
    case "master-mix":
      return <Mix />;
    case "medium-buffer":
      return <Mix medium />;
    case "plate-labelling":
      return <Plate />;
    case "gel-blot":
      return <ImageEditor gel />;
    case "image-measurer":
      return <ImageEditor />;
    case "cell-culture":
      return <Culture />;
    case "cell-counter":
      return <CellCounter />;
    case "timer":
      return <Timer />;
    case "stopwatch":
      return <Timer stopwatch />;
    case "alarm":
      return <Alarm />;
    case "counter":
      return <Counter />;
    case "calculator":
      return <Calculator />;
    case "unit-converter":
      return <Unit />;
    case "custom-equation":
      return <Equation />;
    case "calibration-curve":
      return <Calibration />;
    case "notes":
      return <Notes />;
    case "calendar":
      return <Calendar />;
    case "amino-acids":
      return <Amino />;
    case "codons":
      return <Codon />;
    case "ladders":
      return <Ladder />;
    case "periodic-table":
      return <Periodic />;
  }
}

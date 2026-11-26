import { useRef, useState } from "react";
import {
  CalculationError,
  evaluateExpression,
  insertIntoExpression,
  parseExpression,
} from "./expression";
import { parseNumber } from "./format";
import {
  useToolData,
  useText,
  Panel,
  Select,
  Result,
  ErrorMessage,
  CopyButton,
  NumberField,
  calculate,
  format,
  plainNumber,
} from "./ui";
import { ChartFrame, Plot } from "./charts";
interface Data {
  expression: string;
  values: Record<string, string>;
  locked: Record<string, boolean>;
  /** What − and + change a variable by; 1 where nothing is set. */
  steps: Record<string, string>;
  /** A description or unit shown next to a variable's name. */
  labels: Record<string, string>;
  round: string;
  angle: "RAD" | "DEG";
  notes: string;
}
const keypad = [
  "(",
  ")",
  "^",
  "/",
  "*",
  "-",
  "+",
  "%",
  "sqrt(",
  "sin(",
  "cos(",
  "tan(",
  "ln(",
  "log10(",
  "exp(",
  "pi",
  "e",
  "7",
  "8",
  "9",
  "4",
  "5",
  "6",
  "1",
  "2",
  "3",
  "0",
  ".",
];
/** A variable's own entry. Names are user text, so "constructor" must not find Object's. */
function own<T>(record: Record<string, T> | undefined, name: string) {
  return record && Object.hasOwn(record, name) ? record[name] : undefined;
}
export default function EquationTool() {
  const t = useText();
  const [d, set] = useToolData<Data>({
    expression: "",
    values: {},
    locked: {},
    steps: {},
    labels: {},
    round: "",
    angle: "RAD",
    notes: "",
  });
  const inputRef = useRef<HTMLInputElement>(null);
  // The caret starts after a saved equation, so the first key continues it.
  const cursor = useRef({
    start: d.expression.length,
    end: d.expression.length,
  });
  const [showKeys, setShowKeys] = useState(false);
  // Which variable the "result by variable" plot sweeps. A view setting, not
  // part of the saved equation.
  const [swept, setSwept] = useState("");
  const parsed = calculate(() => parseExpression(d.expression));
  // While the equation is mid-edit and does not parse, the variables of its
  // last valid form stay available.
  const names = parsed.value?.variables ?? Object.keys(d.values);
  const valueOf = (name: string) => String(own(d.values, name) ?? "");
  const evaluation = (() => {
    const none = { result: null, error: "", missing: "" };
    if (!d.expression.trim()) return none;
    try {
      const numbers: Record<string, number> = {};
      for (const name of names) {
        const text = valueOf(name);
        // An empty variable is left out, and the engine asks for it by name.
        if (!text.trim()) continue;
        const value = parseNumber(text);
        if (value == null) throw Error("Invalid number");
        numbers[name] = value;
      }
      return {
        ...none,
        result: evaluateExpression(d.expression, numbers, d.angle),
      };
    } catch (error) {
      if (error instanceof CalculationError && error.code === "missing")
        return { ...none, missing: error.variable ?? "" };
      return {
        ...none,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  })();
  const result = evaluation.result;
  // Fixed decimals when a count is set; otherwise seven significant digits.
  const places = parseNumber(String(d.round ?? ""));
  const fixed =
    result && places != null
      ? result.result.toFixed(Math.max(0, Math.min(12, Math.trunc(places))))
      : null;
  const shown = result ? fixed ?? format(result.result) : "—";
  const expression = (value: string) => {
    const next = calculate(() => parseExpression(value)).value?.variables;
    // Values, locks, labels and steps follow the variables: one that is no
    // longer in the equation is dropped. An equation that does not parse yet
    // changes nothing.
    const kept = <T,>(record: Record<string, T>) =>
      next
        ? Object.fromEntries(
            next.flatMap((name) => {
              const entry = own(record, name);
              return entry === undefined ? [] : [[name, entry] as const];
            })
          )
        : record;
    set((old) => ({
      ...old,
      expression: value,
      values: next
        ? Object.fromEntries(
            next.map((name) => [name, own(old.values, name) ?? ""])
          )
        : old.values,
      locked: next
        ? Object.fromEntries(
            next.map((name) => [name, own(old.locked, name) ?? false])
          )
        : old.locked,
      labels: kept(old.labels),
      steps: kept(old.steps),
    }));
  };
  const write = (value: string, caret: number) => {
    expression(value);
    cursor.current = { start: caret, end: caret };
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(caret, caret);
    });
  };
  const insert = (text: string) => {
    const next = insertIntoExpression(
      d.expression,
      cursor.current.start,
      cursor.current.end,
      text
    );
    write(next.expression, next.caret);
  };
  /** The step − and + use: 1 when blank, null when it is not a positive number. */
  const stepOf = (name: string) => {
    const text = String(own(d.steps, name) ?? "");
    if (!text.trim()) return 1;
    const step = parseNumber(text);
    return step != null && step > 0 ? step : null;
  };
  const nudge = (name: string, direction: 1 | -1) => {
    const step = stepOf(name);
    if (step == null) return;
    set((old) => ({
      ...old,
      values: {
        ...old.values,
        // Written without floating-point residue: 0.1 + 0.2 is 0.3.
        [name]: plainNumber(
          (parseNumber(String(own(old.values, name) ?? "")) ?? 0) +
            direction * step
        ),
      },
    }));
  };
  // How the result moves when one variable changes and the rest stay put:
  // ten of that variable's − / + steps to either side of its present value.
  const sweep = (() => {
    const variables = parsed.value?.variables ?? [];
    if (!result || !variables.length) return null;
    const name = variables.includes(swept) ? swept : variables[0],
      at = parseNumber(valueOf(name)),
      step = stepOf(name) ?? 1;
    if (at == null) return null;
    const numbers: Record<string, number> = {};
    for (const other of variables)
      numbers[other] = parseNumber(valueOf(other)) ?? NaN;
    const points = Array.from({ length: 41 }, (_, index) => {
      // Half steps, written without floating-point residue.
      const x = Number(plainNumber(at + ((index - 20) * step) / 2));
      try {
        const y = evaluateExpression(
          d.expression,
          { ...numbers, [name]: x },
          d.angle
        ).result;
        return { x, y: Number.isFinite(y) ? y : NaN };
      } catch {
        // Outside the equation's domain (a square root of a negative, a
        // division by zero): a gap in the line, not an error.
        return { x, y: NaN };
      }
    });
    if (points.filter((point) => Number.isFinite(point.y)).length < 2)
      return null;
    return { name, variables, at, points };
  })();
  return (
    <>
      <Panel>
        <label className="tool-field">
          <span>{t("수식", "Equation")}</span>
          <input
            ref={inputRef}
            inputMode={showKeys ? "none" : "text"}
            autoComplete="off"
            onSelect={(e) => {
              cursor.current = {
                start: e.currentTarget.selectionStart ?? d.expression.length,
                end: e.currentTarget.selectionEnd ?? d.expression.length,
              };
            }}
            aria-label={t("수식", "Equation")}
            value={d.expression}
            placeholder="a * b + c"
            onChange={(e) => expression(e.target.value)}
          />
        </label>
        <button aria-expanded={showKeys} onClick={() => setShowKeys(!showKeys)}>
          {t("수학 키패드", "Math keypad")}
        </button>
        {showKeys && (
          <>
            {names.length > 0 && (
              <div
                className="tool-eq-x-keys"
                role="group"
                aria-label={t("변수 넣기", "Insert a variable")}
              >
                {names.map((name) => (
                  <button key={name} onClick={() => insert(name)}>
                    {name}
                  </button>
                ))}
              </div>
            )}
            <div className="tool-keypad">
              {keypad.map((k) => (
                <button key={k} onClick={() => insert(k)}>
                  {k}
                </button>
              ))}
              <button
                aria-label={t("한 글자 지우기", "Backspace")}
                onClick={() => {
                  // Deletes at the caret (or the selection), like the keys insert.
                  const { start, end } = cursor.current,
                    from = start === end ? Math.max(0, start - 1) : start;
                  write(
                    d.expression.slice(0, from) + d.expression.slice(end),
                    from
                  );
                }}
              >
                ⌫
              </button>
            </div>
            <p className="tool-muted">
              {t(
                "새 변수 이름은 키패드를 닫고 입력하세요.",
                "Close the keypad to type a new variable name."
              )}
            </p>
          </>
        )}
        <div className="tool-grid">
          <Select
            label={t("각도", "Angle")}
            value={d.angle}
            onChange={(angle) =>
              set((old) => ({ ...old, angle: angle as Data["angle"] }))
            }
            options={["RAD", "DEG"]}
          />
          <NumberField
            label={t(
              "표시 소수 자릿수 (비우면 자동)",
              "Decimal places (blank: automatic)"
            )}
            value={String(d.round ?? "")}
            onChange={(round) => set((old) => ({ ...old, round }))}
          />
        </div>
      </Panel>
      <div className="tool-equation-layout">
        <Panel title={t("변수", "Variables")}>
          <div className="tool-actions">
            <button
              onClick={() =>
                set((old) => ({
                  ...old,
                  values: Object.fromEntries(
                    Object.entries(old.values).map(([name, value]) => [
                      name,
                      own(old.locked, name) ? value : "",
                    ])
                  ),
                }))
              }
            >
              {t("잠금 외 초기화", "Reset unlocked")}
            </button>
          </div>
          {parsed.value?.variables.map((name) => {
            const locked = !!own(d.locked, name),
              caption = String(own(d.labels, name) ?? "").trim(),
              step = stepOf(name);
            return (
              <div
                className="tool-eq-x-variable"
                role="group"
                aria-label={name}
                key={name}
              >
                <div className="tool-grid">
                  <NumberField
                    label={caption ? `${name} · ${caption}` : name}
                    negative
                    disabled={locked}
                    value={valueOf(name)}
                    onChange={(value) =>
                      set((old) => ({
                        ...old,
                        values: { ...old.values, [name]: value },
                      }))
                    }
                  />
                  <div className="tool-actions">
                    <button
                      disabled={locked || step == null}
                      aria-label={`${name} −`}
                      onClick={() => nudge(name, -1)}
                    >
                      −
                    </button>
                    <button
                      disabled={locked || step == null}
                      aria-label={`${name} +`}
                      onClick={() => nudge(name, 1)}
                    >
                      +
                    </button>
                    <label>
                      <input
                        type="checkbox"
                        checked={locked}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          set((old) => ({
                            ...old,
                            locked: { ...old.locked, [name]: checked },
                          }));
                        }}
                      />
                      {t("잠금", "Lock")}
                    </label>
                  </div>
                </div>
                <details className="tool-eq-x-options">
                  <summary>{t("설명·증감 단위", "Label and step")}</summary>
                  <div className="tool-grid">
                    <label className="tool-field">
                      <span>{t("설명 또는 단위", "Description or unit")}</span>
                      <input
                        type="text"
                        autoComplete="off"
                        maxLength={60}
                        value={String(own(d.labels, name) ?? "")}
                        onChange={(e) => {
                          const label = e.target.value;
                          set((old) => ({
                            ...old,
                            labels: { ...old.labels, [name]: label },
                          }));
                        }}
                      />
                    </label>
                    <NumberField
                      label={t("−/+ 증감 단위", "Step for − and +")}
                      placeholder="1"
                      value={String(own(d.steps, name) ?? "")}
                      onChange={(value) =>
                        set((old) => ({
                          ...old,
                          steps: { ...old.steps, [name]: value },
                        }))
                      }
                    />
                  </div>
                  {step == null && (
                    // Not an alert: "0.5" passes through "0" while it is typed.
                    <p className="tool-muted">
                      {t(
                        "증감 단위는 0보다 큰 수로 입력하세요.",
                        "Enter a step greater than zero."
                      )}
                    </p>
                  )}
                </details>
              </div>
            );
          })}
        </Panel>
        <Panel title={t("결과", "Result")}>
          <ErrorMessage message={evaluation.error} />
          {evaluation.missing && (
            // Composed here rather than by ErrorMessage, which only knows
            // names written in ASCII.
            <p role="alert" className="tool-error">
              {t(
                `${evaluation.missing} 값을 입력하세요.`,
                `Enter ${evaluation.missing}`
              )}
            </p>
          )}
          <Result>{shown}</Result>
          {result && (
            <p className="tool-muted">
              {result.substituted} = {shown}
            </p>
          )}
          {result && (
            <div className="tool-actions">
              <CopyButton
                text={`${result.substituted} = ${
                  fixed ?? plainNumber(result.result)
                }`}
              >
                {t("결과 복사", "Copy result")}
              </CopyButton>
            </div>
          )}
          {result && sweep && (
            <>
              {sweep.variables.length > 1 && (
                <Select
                  label={t("그래프로 볼 변수", "Variable to plot")}
                  value={sweep.name}
                  onChange={setSwept}
                  options={sweep.variables}
                />
              )}
              <ChartFrame
                title={t(
                  `${sweep.name}에 따른 결과`,
                  `Result as ${sweep.name} changes`
                )}
                note={t(
                  "다른 변수는 그대로 두고, 증감 단위의 10배 범위를 그립니다.",
                  "Other variables stay put; the range is ten − / + steps either way."
                )}
                table={{
                  headers: [sweep.name, t("결과", "Result")],
                  // Whole steps only: the half steps are there for the curve.
                  rows: sweep.points
                    .filter((_, index) => index % 2 === 0)
                    .map((point) => [
                      format(point.x),
                      Number.isFinite(point.y) ? format(point.y) : "—",
                    ]),
                }}
              >
                <Plot
                  label={t(
                    `${sweep.name} 값에 따른 수식 결과`,
                    `The equation's result across values of ${sweep.name}`
                  )}
                  xTitle={sweep.name}
                  yTitle={t("결과", "Result")}
                  series={[
                    { name: t("결과", "Result"), points: sweep.points },
                  ]}
                  marks={[
                    {
                      x: sweep.at,
                      y: result.result,
                      label: `${t("현재", "Now")} ${shown}`,
                    },
                  ]}
                />
              </ChartFrame>
            </>
          )}
        </Panel>
      </div>
      <Panel>
        <label className="tool-field">
          <span>
            {t(
              "메모 (단위 · 출처 · 가정)",
              "Notes (units, sources, assumptions)"
            )}
          </span>
          <textarea
            value={d.notes}
            onChange={(e) => {
              const notes = e.target.value;
              set((old) => ({ ...old, notes }));
            }}
          />
        </label>
      </Panel>
    </>
  );
}

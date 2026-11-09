import { useState, useRef } from "react";
import { evaluateExpression, parseExpression } from "./expression";
import CalculatorTool from "./CalculatorTool";
import {
  useToolData,
  useText,
  Panel,
  Field,
  Select,
  Result,
  ErrorMessage,
  calculate,
  format,
} from "./ui";
interface Data {
  expression: string;
  values: Record<string, string>;
  locked: Record<string, boolean>;
  round: string;
  angle: "RAD" | "DEG";
  notes: string;
  history: string[];
}
function EquationEditor({ calculator = false }: { calculator?: boolean }) {
  const t = useText();
  const inputRef = useRef<HTMLInputElement>(null);
  const cursor = useRef({ start: 0, end: 0 });
  const [d, set] = useToolData<Data>({
    expression: "",
    values: {},
    locked: {},
    round: "",
    angle: "RAD",
    notes: "",
    history: [],
  });
  const [copy, setCopy] = useState(false),
    [showKeys, setShowKeys] = useState(false);
  const parsed = calculate(() => parseExpression(d.expression)),
    evaluation = calculate(() =>
      evaluateExpression(d.expression, d.values, d.angle)
    );
  const error = !d.expression ? "" : evaluation.error;
  const result = evaluation.value;
  const shown = result
    ? d.round !== ""
      ? result.result.toFixed(Math.max(0, Math.min(12, Number(d.round))))
      : format(result.result)
    : "—";
  const expression = (value: string) => {
    const p = calculate(() => parseExpression(value));
    set({
      ...d,
      expression: value,
      values: p.value
        ? Object.fromEntries(
            p.value.variables.map((n) => [n, d.values[n] ?? ""])
          )
        : d.values,
      locked: p.value
        ? Object.fromEntries(
            p.value.variables.map((name) => [name, d.locked[name] ?? false])
          )
        : d.locked,
    });
  };
  const insert = (value: string) => {
    const { start, end } = cursor.current,
      next = d.expression.slice(0, start) + value + d.expression.slice(end);
    expression(next);
    cursor.current = { start: start + value.length, end: start + value.length };
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(
        cursor.current.start,
        cursor.current.end
      );
    });
  };
  return (
    <>
      <Panel>
        <label className="tool-field">
          <span>{t("수식", "Equation")}</span>
          <input
            ref={inputRef}
            inputMode={showKeys ? "none" : "text"}
            onSelect={(e) => {
              cursor.current = {
                start: e.currentTarget.selectionStart ?? d.expression.length,
                end: e.currentTarget.selectionEnd ?? d.expression.length,
              };
            }}
            aria-label={t("수식", "Equation")}
            value={d.expression}
            placeholder={calculator ? "sqrt(9) + 2^3" : "a * b + c"}
            onChange={(e) => expression(e.target.value)}
          />
        </label>
        <button aria-expanded={showKeys} onClick={() => setShowKeys(!showKeys)}>
          {t("수학 키패드", "Math keypad")}
        </button>
        {showKeys && (
          <div className="tool-keypad">
            {[
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
            ].map((k) => (
              <button key={k} onClick={() => insert(k)}>
                {k}
              </button>
            ))}
            <button onClick={() => expression(d.expression.slice(0, -1))}>
              ⌫
            </button>
          </div>
        )}
        <div className="tool-grid">
          <Select
            label={t("각도", "Angle")}
            value={d.angle}
            onChange={(angle) => set({ ...d, angle: angle as Data["angle"] })}
            options={["RAD", "DEG"]}
          />
          <Field
            label={t(
              "표시 소수 자릿수 (비우면 자동)",
              "Decimal places (blank: automatic)"
            )}
            value={d.round}
            onChange={(round) => set({ ...d, round })}
          />
        </div>
      </Panel>
      <div className="tool-equation-layout">
        {!calculator && (
          <Panel title={t("변수", "Variables")}>
            <div className="tool-actions">
              <button
                onClick={() =>
                  set({
                    ...d,
                    values: Object.fromEntries(
                      Object.entries(d.values).map(([k, v]) => [
                        k,
                        d.locked[k] ? v : "",
                      ])
                    ),
                  })
                }
              >
                {t("잠금 외 초기화", "Reset unlocked")}
              </button>
            </div>
            {parsed.value?.variables.map((name) => (
              <div className="tool-grid" key={name}>
                <Field
                  label={name}
                  disabled={!!d.locked[name]}
                  value={d.values[name] ?? ""}
                  onChange={(v) =>
                    set({ ...d, values: { ...d.values, [name]: v } })
                  }
                />
                <div className="tool-actions">
                  <button
                    disabled={d.locked[name]}
                    aria-label={`${name} −`}
                    onClick={() =>
                      set({
                        ...d,
                        values: {
                          ...d.values,
                          [name]: String(Number(d.values[name] || 0) - 1),
                        },
                      })
                    }
                  >
                    −
                  </button>
                  <button
                    disabled={d.locked[name]}
                    aria-label={`${name} +`}
                    onClick={() =>
                      set({
                        ...d,
                        values: {
                          ...d.values,
                          [name]: String(Number(d.values[name] || 0) + 1),
                        },
                      })
                    }
                  >
                    +
                  </button>
                  <label>
                    <input
                      type="checkbox"
                      checked={!!d.locked[name]}
                      onChange={(e) =>
                        set({
                          ...d,
                          locked: { ...d.locked, [name]: e.target.checked },
                        })
                      }
                    />
                    {t("잠금", "Lock")}
                  </label>
                </div>
              </div>
            ))}
          </Panel>
        )}
        <Panel title={t("결과", "Result")}>
          <ErrorMessage message={error} />
          <Result>{shown}</Result>
          {result && (
            <p className="tool-muted">
              {result.substituted} = {shown}
            </p>
          )}
          <div className="tool-actions">
            <button
              disabled={!result}
              onClick={async () => {
                await navigator.clipboard.writeText(
                  `${result?.substituted} = ${shown}`
                );
                setCopy(true);
              }}
            >
              {copy ? t("복사됨", "Copied") : t("결과 복사", "Copy result")}
            </button>
            {calculator && (
              <button
                disabled={!result}
                onClick={() =>
                  set({
                    ...d,
                    history: [`${d.expression} = ${shown}`, ...d.history].slice(
                      0,
                      100
                    ),
                  })
                }
              >
                {t("내역 저장", "Save to history")}
              </button>
            )}
          </div>
        </Panel>
      </div>
      {calculator ? (
        <Panel title={t("계산 내역", "History")}>
          {d.history.map((h, i) => (
            <p key={i}>{h}</p>
          ))}
        </Panel>
      ) : (
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
              onChange={(e) => set({ ...d, notes: e.target.value })}
            />
          </label>
        </Panel>
      )}
    </>
  );
}
export default function EquationTool({
  calculator = false,
}: {
  calculator?: boolean;
}) {
  return calculator ? <CalculatorTool /> : <EquationEditor />;
}

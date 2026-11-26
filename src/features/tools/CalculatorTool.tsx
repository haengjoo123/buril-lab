import { useRef, useState } from "react";
import { Delete } from "lucide-react";
import {
  CalculationError,
  evaluateExpression,
  insertIntoExpression,
} from "./expression";
import {
  useText,
  useToolData,
  useUndo,
  ErrorMessage,
  CopyButton,
  calculate,
  format,
  plainNumber,
} from "./ui";

// "(" and ")" are on the main keypad. `log` is the base-10 logarithm in the
// engine (the same as `log10`), so its key says so.
const scientificKeys = [
  "sqrt(",
  "sin(",
  "cos(",
  "tan(",
  "ln(",
  "log(",
  "exp(",
  "abs(",
  "pi",
  "e",
  "^",
];
const mainKeys = [
  "AC",
  "(",
  ")",
  "⌫",
  "7",
  "8",
  "9",
  "÷",
  "4",
  "5",
  "6",
  "×",
  "1",
  "2",
  "3",
  "−",
  "0",
  ".",
  "%",
  "+",
];
const lines = (stored: unknown): string[] =>
  Array.isArray(stored)
    ? stored.filter((line) => typeof line === "string")
    : [];
export default function CalculatorTool() {
  const t = useText(),
    [d, set] = useToolData({
      expression: "",
      angle: "RAD" as "RAD" | "DEG",
      history: [] as string[],
      /** The last answer "=" produced, as plain text, for the ANS key. */
      ans: "",
      /** Whether the scientific keys are shown. */
      scientific: false,
    }),
    [historyOpen, setHistoryOpen] = useState(false),
    [undoBar, offerUndo] = useUndo();
  // The caret starts after an expression kept from last time, so the first
  // key press continues it instead of landing in front of it.
  const input = useRef<HTMLInputElement>(null),
    cursor = useRef({ start: d.expression.length, end: d.expression.length });
  const history = lines(d.history);
  // History saved before the answer was stored still has it after " = ".
  const ans = d.ans || history[0]?.split(" = ")[1] || "";
  const result = calculate(() => {
      if (!d.expression.trim()) return null;
      try {
        return evaluateExpression(d.expression, {}, d.angle, {
          percent: "of-left",
        });
      } catch (error) {
        // Letters that are neither a function nor a constant: the calculator
        // has no variables to ask for.
        if (error instanceof CalculationError && error.code === "missing")
          throw new CalculationError("syntax", "Incomplete or invalid equation");
        throw error;
      }
    }),
    shown = result.value ? format(result.value.result) : "0";
  const write = (expression: string, caret: number) => {
    set((old) => ({ ...old, expression }));
    cursor.current = { start: caret, end: caret };
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(caret, caret);
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
  const clear = () => {
    set((old) => ({ ...old, expression: "" }));
    cursor.current = { start: 0, end: 0 };
  };
  const equals = () => {
    if (!result.value) return;
    // The answer becomes the next expression, so it is written without
    // floating-point residue (0.1 + 0.2 continues from 0.3).
    const answer = plainNumber(result.value.result),
      entry = `${d.expression} = ${answer}`;
    set((old) => ({
      ...old,
      expression: answer,
      ans: answer,
      // Synced with the account, so kept short. "=" on a bare answer adds
      // nothing new.
      history:
        d.expression.trim() === answer
          ? old.history
          : [entry, ...lines(old.history)].slice(0, 30),
    }));
    cursor.current = { start: answer.length, end: answer.length };
  };
  const insertAnswer = () => {
    const { start, end } = cursor.current;
    // Next to a digit or a name the answer goes in brackets and multiplies,
    // as on a pocket calculator: "5" then ANS is 5(0.3), not 50.3. A negative
    // answer is bracketed too, so "2^" then ANS reads 2^(-5).
    const touching =
      /[\p{L}\p{Nd}_.]$/u.test(d.expression.slice(0, start)) ||
      /^[\p{L}\p{Nd}_.]/u.test(d.expression.slice(end));
    insert(touching || ans.startsWith("-") ? `(${ans})` : ans);
  };
  const clearHistory = () => {
    const before = history;
    set((old) => ({ ...old, history: [] }));
    offerUndo(t("계산 내역을 지웠습니다.", "History cleared."), () =>
      set((old) => ({ ...old, history: before }))
    );
  };
  return (
    <section className="tool-calculator">
      <div className="tool-calculator-mode">
        <button
          aria-pressed={!!d.scientific}
          onClick={() => set((old) => ({ ...old, scientific: !old.scientific }))}
        >
          {t("과학 함수", "Scientific")}
        </button>
        <div
          role="group"
          aria-label={t("삼각함수 각도", "Trigonometric angle")}
        >
          <button
            aria-pressed={d.angle === "RAD"}
            onClick={() => set((old) => ({ ...old, angle: "RAD" }))}
          >
            RAD
          </button>
          <button
            aria-pressed={d.angle === "DEG"}
            onClick={() => set((old) => ({ ...old, angle: "DEG" }))}
          >
            DEG
          </button>
        </div>
      </div>
      <label className="tool-field">
        <span>{t("계산식", "Expression")}</span>
        <input
          ref={input}
          // Every keypad press refocuses this field to place the caret; without
          // this a phone would raise its own keyboard over the keypad each
          // time. It only hides the on-screen keyboard: a hardware keyboard
          // still types here, with Enter for "=" and Escape for "AC".
          inputMode="none"
          autoComplete="off"
          aria-label={t("계산식", "Expression")}
          className="tool-calculator-input"
          value={d.expression}
          placeholder="0"
          onSelect={(event) => {
            cursor.current = {
              start: event.currentTarget.selectionStart ?? 0,
              end: event.currentTarget.selectionEnd ?? 0,
            };
          }}
          onChange={(event) => {
            const expression = event.target.value;
            set((old) => ({ ...old, expression }));
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              equals();
            } else if (event.key === "Escape" && d.expression) {
              event.preventDefault();
              clear();
            }
          }}
        />
      </label>
      <div className="tool-calculator-output tool-calc-x-output">
        <output>{shown}</output>
        {result.value ? (
          <CopyButton
            label={t("결과 복사", "Copy result")}
            text={plainNumber(result.value.result)}
          />
        ) : (
          // Keeps the number where it is while there is nothing to copy.
          <span className="tool-calc-x-nocopy" aria-hidden="true" />
        )}
      </div>
      <ErrorMessage message={result.error} />
      {d.scientific && (
        <div className="tool-calculator-functions">
          {scientificKeys.map((key) => (
            <button
              key={key}
              aria-label={
                key === "log("
                  ? t("상용로그 (밑 10)", "Logarithm, base 10")
                  : key === "abs("
                  ? t("절댓값", "Absolute value")
                  : undefined
              }
              onClick={() => insert(key)}
            >
              {key === "log("
                ? "log₁₀"
                : key === "pi"
                ? "π"
                : key.endsWith("(")
                ? key.slice(0, -1)
                : key}
            </button>
          ))}
        </div>
      )}
      <div className="tool-calculator-keys">
        {mainKeys.map((key) => (
          <button
            key={key}
            aria-label={
              key === "⌫"
                ? t("한 글자 지우기", "Backspace")
                : key === "AC"
                ? t("모두 지우기", "Clear all")
                : key
            }
            className={["÷", "×", "−", "+"].includes(key) ? "operator" : ""}
            onClick={() => {
              if (key === "AC") clear();
              else if (key === "⌫") {
                const { start, end } = cursor.current,
                  pos = start === end ? Math.max(0, start - 1) : start;
                write(d.expression.slice(0, pos) + d.expression.slice(end), pos);
              } else
                insert(
                  ({ "÷": "/", "×": "*", "−": "-" } as Record<string, string>)[
                    key
                  ] ?? key
                );
            }}
          >
            {key === "⌫" ? <Delete size={21} aria-hidden="true" /> : key}
          </button>
        ))}
        <button
          aria-label={t("이전 답 넣기", "Insert previous answer")}
          disabled={!ans}
          onClick={insertAnswer}
        >
          ANS
        </button>
        <button
          className="primary tool-calc-x-equals"
          onClick={equals}
          disabled={!result.value}
        >
          =
        </button>
      </div>
      {history.length > 0 && (
        <details
          className="tool-guide"
          open={historyOpen}
          onToggle={(event) => setHistoryOpen(event.currentTarget.open)}
        >
          <summary>
            {t("계산 내역", "History")} ({history.length})
          </summary>
          <div className="tool-actions">
            <button onClick={clearHistory}>
              {t("내역 지우기", "Clear history")}
            </button>
          </div>
          {history.map((line, index) => (
            <div className="tool-history-row tool-calc-x-history" key={index}>
              <button
                onClick={() => {
                  const expression = line.split(" = ")[0];
                  set((old) => ({ ...old, expression }));
                  cursor.current = {
                    start: expression.length,
                    end: expression.length,
                  };
                }}
              >
                {line}
              </button>
              <CopyButton
                label={t("내역 복사", "Copy history entry")}
                text={line}
              />
            </div>
          ))}
        </details>
      )}
      {undoBar}
    </section>
  );
}

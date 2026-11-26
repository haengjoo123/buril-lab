import { useRef, useState } from "react";
import { Copy, Delete } from "lucide-react";
import { evaluateExpression } from "./expression";
import {
  useText,
  useToolData,
  ErrorMessage,
  calculate,
  copyText,
  format,
  plainNumber,
} from "./ui";
export default function CalculatorTool() {
  const t = useText(),
    [d, set] = useToolData({
      expression: "",
      angle: "RAD" as "RAD" | "DEG",
      history: [] as string[],
    }),
    [scientific, setScientific] = useState(false),
    [copyError, setCopyError] = useState("");
  const input = useRef<HTMLInputElement>(null),
    cursor = useRef({ start: 0, end: 0 });
  const result = calculate(() =>
      d.expression ? evaluateExpression(d.expression, {}, d.angle) : null
    ),
    shown = result.value ? format(result.value.result) : "0";
  const insert = (text: string) => {
    const { start, end } = cursor.current,
      next = d.expression.slice(0, start) + text + d.expression.slice(end);
    set({ ...d, expression: next });
    cursor.current = { start: start + text.length, end: start + text.length };
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(
        cursor.current.start,
        cursor.current.end
      );
    });
  };
  const equals = () => {
    if (!result.value) return;
    // The answer becomes the next expression, so it is written without
    // floating-point residue (0.1 + 0.2 continues from 0.3).
    const answer = plainNumber(result.value.result);
    set({
      ...d,
      expression: answer,
      // Synced with the account, so kept short.
      history: [`${d.expression} = ${answer}`, ...d.history].slice(0, 30),
    });
    cursor.current = { start: answer.length, end: answer.length };
  };
  const copyFailed = () =>
    setCopyError(
      t(
        "복사할 수 없습니다. 결과를 선택해 복사하세요.",
        "Could not copy. Select the result to copy it."
      )
    );
  return (
    <section className="tool-calculator">
      <div className="tool-calculator-mode">
        <button
          aria-pressed={scientific}
          onClick={() => setScientific(!scientific)}
        >
          {t("과학 함수", "Scientific")}
        </button>
        <div
          role="group"
          aria-label={t("삼각함수 각도", "Trigonometric angle")}
        >
          <button
            aria-pressed={d.angle === "RAD"}
            onClick={() => set({ ...d, angle: "RAD" })}
          >
            RAD
          </button>
          <button
            aria-pressed={d.angle === "DEG"}
            onClick={() => set({ ...d, angle: "DEG" })}
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
          // time. A hardware keyboard still types here.
          inputMode="none"
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
          onChange={(event) => set({ ...d, expression: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              equals();
            }
          }}
        />
      </label>
      <div className="tool-calculator-output">
        <output>{shown}</output>
        <button
          aria-label={t("결과 복사", "Copy result")}
          disabled={!result.value}
          onClick={async () => {
            if (await copyText(plainNumber(result.value!.result)))
              setCopyError("");
            else copyFailed();
          }}
        >
          <Copy size={18} />
        </button>
      </div>
      <ErrorMessage message={result.error || copyError} />
      {scientific && (
        <div className="tool-calculator-functions">
          {[
            "sqrt(",
            "sin(",
            "cos(",
            "tan(",
            "ln(",
            "log10(",
            "exp(",
            "pi",
            "e",
            "^",
            "(",
            ")",
          ].map((key) => (
            <button key={key} onClick={() => insert(key)}>
              {key.endsWith("(") ? key.slice(0, -1) : key === "pi" ? "π" : key}
            </button>
          ))}
        </div>
      )}
      <div className="tool-calculator-keys">
        {[
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
        ].map((key) => (
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
              if (key === "AC") {
                set({ ...d, expression: "" });
                cursor.current = { start: 0, end: 0 };
              } else if (key === "⌫") {
                const { start, end } = cursor.current,
                  pos = start === end ? Math.max(0, start - 1) : start;
                set({
                  ...d,
                  expression:
                    d.expression.slice(0, pos) + d.expression.slice(end),
                });
                cursor.current = { start: pos, end: pos };
              } else
                insert(
                  ({ "÷": "/", "×": "*", "−": "-" } as Record<string, string>)[
                    key
                  ] ?? key
                );
            }}
          >
            {key === "⌫" ? <Delete size={21} /> : key}
          </button>
        ))}
        <button
          className="primary tool-calculator-equals"
          onClick={equals}
          disabled={!result.value}
        >
          =
        </button>
      </div>
      {d.history.length > 0 && (
        <details className="tool-guide">
          <summary>
            {t("계산 내역", "History")} ({d.history.length})
          </summary>
          {d.history.map((line, index) => (
            <div className="tool-history-row" key={index}>
              <button
                onClick={() => {
                  const expression = line.split(" = ")[0];
                  set({ ...d, expression });
                  cursor.current = {
                    start: expression.length,
                    end: expression.length,
                  };
                }}
              >
                {line}
              </button>
              <button
                aria-label={t("내역 복사", "Copy history entry")}
                onClick={async () => {
                  if (await copyText(line)) setCopyError("");
                  else copyFailed();
                }}
              >
                <Copy size={16} />
              </button>
            </div>
          ))}
        </details>
      )}
    </section>
  );
}

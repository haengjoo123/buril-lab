// Deliberately small arithmetic grammar. No eval, property access, or executable code.
export class CalculationError extends Error {
  code: "syntax" | "missing" | "division" | "domain" | "finite";
  /** For `missing`: the variable that has no value yet. */
  variable?: string;
  constructor(
    code: "syntax" | "missing" | "division" | "domain" | "finite",
    message: string,
    variable?: string
  ) {
    super(message);
    this.code = code;
    this.variable = variable;
  }
}
type Node =
  | { kind: "number"; value: number }
  | { kind: "variable"; name: string }
  | { kind: "unary"; op: string; value: Node }
  | { kind: "binary"; op: string; left: Node; right: Node }
  | { kind: "percent"; value: Node }
  | { kind: "call"; name: string; value: Node };
const functions = new Set([
  "sqrt",
  "sin",
  "cos",
  "tan",
  "ln",
  "log",
  "log10",
  "exp",
  "abs",
]);
const constants: Record<string, number> = { pi: Math.PI, e: Math.E };
// A name is a letter of any script or "_", then letters, combining marks,
// digits or "_". π is never part of a name: it is always the constant, so
// "2πr" reads as 2 × π × r.
const NAME = String.raw`(?!π)[\p{L}_](?:(?!π)[\p{L}\p{M}\p{Nd}_])*`;
// A number takes its exponent with it, so "2e3" is 2000 and never 2 × e3.
const TOKEN = new RegExp(
  String.raw`(?:\d*\.\d+|\d+\.?\d*)(?:[eE][+-]?\d+)?|${NAME}|\S`,
  "gu"
);
const IS_NAME = new RegExp(`^(?:${NAME})$`, "u");
const symbols = new Map([
  ["π", "pi"],
  ["×", "*"],
  ["÷", "/"],
  ["−", "-"],
]);
const isNumber = (token: string | undefined) =>
  token !== undefined && /^\d|^\.\d/.test(token);
/** Tokens with their place in the input, so a variable can be replaced there. */
function tokenize(input: string) {
  return [...input.matchAll(TOKEN)].map((match) => ({
    text: symbols.get(match[0]) ?? match[0],
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}
export function parseExpression(input: string): {
  node: Node;
  variables: string[];
} {
  if (input.length > 2000)
    throw new CalculationError("syntax", "Expression too long");
  const tokens = tokenize(input).map((token) => token.text);
  let pos = 0,
    depth = 0;
  const variables = new Set<string>();
  const fail = (): never => {
    throw new CalculationError("syntax", "Incomplete or invalid equation");
  };
  function primary(): Node {
    if (++depth > 100) fail();
    const t = tokens[pos++];
    let node: Node;
    if (t === undefined) return fail();
    if (t === "(") {
      node = add();
      if (tokens[pos++] !== ")") fail();
      // Parentheses close a percentage off from what stands before them:
      // 100-(10%) is 100 − 0.1 even where 100-10% is 90.
      if (node.kind === "percent")
        node = { kind: "unary", op: "+", value: node };
    } else if (isNumber(t)) node = { kind: "number", value: Number(t) };
    else if (IS_NAME.test(t)) {
      if (Object.hasOwn(constants, t))
        node = { kind: "number", value: constants[t] };
      else if (functions.has(t)) {
        if (tokens[pos++] !== "(") fail();
        const value = add();
        if (tokens[pos++] !== ")") fail();
        node = { kind: "call", name: t, value };
      } else {
        // A name directly before "(" is a mistyped function ("sqr(4)"), not a
        // variable times a bracket.
        if (tokens[pos] === "(") fail();
        variables.add(t);
        node = { kind: "variable", name: t };
      }
    } else return fail();
    while (tokens[pos] === "%") {
      pos++;
      node = { kind: "percent", value: node };
    }
    depth--;
    return node;
  }
  function power(): Node {
    const left = primary();
    return tokens[pos] === "^"
      ? (pos++, { kind: "binary", op: "^", left, right: unary() })
      : left;
  }
  function unary(): Node {
    const op = tokens[pos];
    return op === "+" || op === "-"
      ? (pos++, { kind: "unary", op, value: unary() })
      : power();
  }
  // "2pi", "2(3)", "(1+2)(3+4)", "3sqrt(4)", "2x": a factor written straight
  // after another multiplies it. A number does so only after a closing
  // parenthesis, so "2 3" stays a mistake instead of becoming 6.
  const startsFactor = () => {
    const t = tokens[pos];
    return (
      t !== undefined &&
      (t === "(" ||
        IS_NAME.test(t) ||
        (isNumber(t) && tokens[pos - 1] === ")"))
    );
  };
  function mul(): Node {
    let node = unary();
    for (;;) {
      if (tokens[pos] === "*" || tokens[pos] === "/") {
        const op = tokens[pos++];
        node = { kind: "binary", op, left: node, right: unary() };
      } else if (startsFactor())
        // Same rank as a written "*", left to right: 1/2x is (1/2) × x. The
        // factor cannot start with a sign: "2 -3" is a subtraction.
        node = { kind: "binary", op: "*", left: node, right: power() };
      else return node;
    }
  }
  function add(): Node {
    let node = mul();
    while (tokens[pos] === "+" || tokens[pos] === "-") {
      const op = tokens[pos++];
      node = { kind: "binary", op, left: node, right: mul() };
    }
    return node;
  }
  const node = add();
  if (pos !== tokens.length) fail();
  return { node, variables: [...variables] };
}
export interface EvaluateOptions {
  /**
   * What "%" means. `fraction` (default): always a hundredth, so 50+10% is
   * 50.1 — saved equations rely on this. `of-left`: as on a pocket calculator,
   * a percentage added to or subtracted from a value is a share of that value
   * (50+10% = 55, 50-10% = 45); elsewhere it is still a hundredth
   * (200*10% = 20, 200/10% = 2000, 25% = 0.25).
   */
  percent?: "fraction" | "of-left";
}
export function evaluateExpression(
  input: string,
  values: Record<string, number | string | null | undefined> = {},
  angle: "RAD" | "DEG" = "RAD",
  options: EvaluateOptions = {}
) {
  const { node, variables } = parseExpression(input);
  const ofLeft = options.percent === "of-left";
  function visit(n: Node): number {
    let v: number;
    if (n.kind === "number") v = n.value;
    else if (n.kind === "variable") {
      const raw = Object.hasOwn(values, n.name) ? values[n.name] : undefined;
      if (raw == null || raw === "")
        throw new CalculationError("missing", `Enter ${n.name}`, n.name);
      v = Number(raw);
    } else if (n.kind === "unary") {
      v = visit(n.value) * (n.op === "-" ? -1 : 1);
    } else if (n.kind === "percent") {
      v = visit(n.value) / 100;
    } else if (n.kind === "binary") {
      const a = visit(n.left);
      if (
        ofLeft &&
        n.right.kind === "percent" &&
        (n.op === "+" || n.op === "-")
      ) {
        const share = (a * visit(n.right.value)) / 100;
        v = n.op === "+" ? a + share : a - share;
      } else {
        const b = visit(n.right);
        if (n.op === "/" && b === 0)
          throw new CalculationError("division", "Division by zero");
        v =
          n.op === "+"
            ? a + b
            : n.op === "-"
            ? a - b
            : n.op === "*"
            ? a * b
            : n.op === "/"
            ? a / b
            : a ** b;
      }
    } else {
      const x = visit(n.value),
        a = angle === "DEG" ? (x * Math.PI) / 180 : x;
      if (
        (n.name === "sqrt" && x < 0) ||
        (["ln", "log", "log10"].includes(n.name) && x <= 0)
      )
        throw new CalculationError("domain", "Outside function domain");
      if (n.name === "tan" && Math.abs(Math.cos(a)) < 1e-14)
        throw new CalculationError("domain", "Tangent undefined");
      v =
        n.name === "sqrt"
          ? Math.sqrt(x)
          : n.name === "sin"
          ? Math.sin(a)
          : n.name === "cos"
          ? Math.cos(a)
          : n.name === "tan"
          ? Math.tan(a)
          : n.name === "ln"
          ? Math.log(x)
          : n.name === "exp"
          ? Math.exp(x)
          : n.name === "abs"
          ? Math.abs(x)
          : // "log" and "log10" are both the base-10 logarithm.
            Math.log10(x);
    }
    if (!Number.isFinite(v))
      throw new CalculationError("finite", "Result is not finite");
    return v;
  }
  const result = visit(node);
  // Whole tokens are replaced, so the "e3" inside "2e3" is never mistaken for
  // a variable of that name.
  const names = new Set(variables);
  let substituted = "",
    from = 0;
  for (const token of tokenize(input)) {
    if (!names.has(token.text)) continue;
    substituted += `${input.slice(from, token.start)}(${values[token.text]})`;
    from = token.end;
  }
  substituted += input.slice(from);
  return { result, variables, substituted };
}
/**
 * Puts `text` into an expression at the caret, replacing the selection, and
 * says where the caret goes next. A name, function or constant gets a space
 * where it would otherwise run into its neighbour: "a" then the key for "b"
 * is "a b" (a × b) rather than a new name "ab", and "2" then "e" is "2 e"
 * rather than the start of "2e3".
 */
export function insertIntoExpression(
  expression: string,
  start: number,
  end: number,
  text: string
) {
  const before = expression.slice(0, start),
    after = expression.slice(end);
  // Digits and operators go in as they are: "1" then "5" is 15.
  const word = /^[\p{L}_]/u.test(text);
  const lead = word && /[\p{L}\p{M}\p{Nd}_.]$/u.test(before) ? " " : "";
  const trail =
    word &&
    /[\p{L}\p{M}\p{Nd}_]$/u.test(text) &&
    /^[\p{L}\p{M}\p{Nd}_]/u.test(after)
      ? " "
      : "";
  const inserted = lead + text + trail;
  return {
    expression: before + inserted + after,
    caret: before.length + inserted.length,
  };
}

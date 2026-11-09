// Deliberately small arithmetic grammar. No eval, property access, or executable code.
export class CalculationError extends Error {
  code: "syntax" | "missing" | "division" | "domain" | "finite";
  constructor(
    code: "syntax" | "missing" | "division" | "domain" | "finite",
    message: string
  ) {
    super(message);
    this.code = code;
  }
}
type Node =
  | { kind: "number"; value: number }
  | { kind: "variable"; name: string }
  | { kind: "unary"; op: string; value: Node }
  | { kind: "binary"; op: string; left: Node; right: Node }
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
export function parseExpression(input: string): {
  node: Node;
  variables: string[];
} {
  if (input.length > 2000)
    throw new CalculationError("syntax", "Expression too long");
  const source = input
    .replaceAll("π", "pi")
    .replaceAll("×", "*")
    .replaceAll("÷", "/")
    .replaceAll("−", "-");
  const tokens =
    source.match(
      /(?:\d*\.\d+|\d+\.?\d*)(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*|[()+\-*/^%]|\S/g
    ) ?? [];
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
    if (!t) return fail();
    if (t === "(") {
      node = add();
      if (tokens[pos++] !== ")") fail();
    } else if (/^\d|^\.\d/.test(t)) node = { kind: "number", value: Number(t) };
    else if (/^[A-Za-z_]\w*$/.test(t)) {
      if (t in constants) node = { kind: "number", value: constants[t] };
      else if (functions.has(t)) {
        if (tokens[pos++] !== "(") fail();
        const value = add();
        if (tokens[pos++] !== ")") fail();
        node = { kind: "call", name: t, value };
      } else {
        if (tokens[pos] === "(") fail();
        variables.add(t);
        node = { kind: "variable", name: t };
      }
    } else return fail();
    while (tokens[pos] === "%") {
      pos++;
      node = {
        kind: "binary",
        op: "/",
        left: node,
        right: { kind: "number", value: 100 },
      };
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
  function mul(): Node {
    let node = unary();
    while (tokens[pos] === "*" || tokens[pos] === "/") {
      const op = tokens[pos++];
      node = { kind: "binary", op, left: node, right: unary() };
    }
    return node;
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
export function evaluateExpression(
  input: string,
  values: Record<string, number | string | null | undefined> = {},
  angle: "RAD" | "DEG" = "RAD"
) {
  const { node, variables } = parseExpression(input);
  function visit(n: Node): number {
    let v: number;
    if (n.kind === "number") v = n.value;
    else if (n.kind === "variable") {
      const raw = values[n.name];
      if (raw == null || raw === "")
        throw new CalculationError("missing", `Enter ${n.name}`);
      v = Number(raw);
    } else if (n.kind === "unary") {
      v = visit(n.value) * (n.op === "-" ? -1 : 1);
    } else if (n.kind === "binary") {
      const a = visit(n.left),
        b = visit(n.right);
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
          : Math.log10(x);
    }
    if (!Number.isFinite(v))
      throw new CalculationError("finite", "Result is not finite");
    return v;
  }
  const result = visit(node);
  const substituted = input.replace(/[A-Za-z_]\w*/g, (name) =>
    variables.includes(name) ? `(${values[name]})` : name
  );
  return { result, variables, substituted };
}

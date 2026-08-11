/* Interactive Formulas for Obsidian — generated from TypeScript source. */
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => InteractiveFormulasPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian2 = require("obsidian");

// src/formula-blocks.ts
function findFormulaBlocks(text) {
  const matches = [];
  const lines = splitLines(text);
  for (let index = 0; index < lines.length; index += 1) {
    const markerLine = lines[index];
    if (markerLine.content.trim() !== "fff") continue;
    const sourceLines = [];
    let nextIndex = index + 1;
    while (nextIndex < lines.length && lines[nextIndex].content.trim().length > 0) {
      sourceLines.push(lines[nextIndex]);
      nextIndex += 1;
    }
    if (sourceLines.length === 0) continue;
    const sourceFrom = sourceLines[0].from;
    const lastSourceLine = sourceLines[sourceLines.length - 1];
    matches.push({
      from: markerLine.from,
      to: lastSourceLine.contentTo,
      sourceFrom,
      source: text.slice(sourceFrom, lastSourceLine.contentTo)
    });
    index = nextIndex - 1;
  }
  return matches;
}
function selectionTouchesBlock(selection, block) {
  return selection.from <= block.to && selection.to >= block.from;
}
function splitLines(text) {
  var _a;
  const lines = [];
  const pattern = /([^\r\n]*)(?:\r\n|\n|\r|$)/g;
  for (const match of text.matchAll(pattern)) {
    if (match.index === void 0) continue;
    if (match.index === text.length && match[0].length === 0) break;
    const content = (_a = match[1]) != null ? _a : "";
    lines.push({
      from: match.index,
      contentTo: match.index + content.length,
      content
    });
  }
  return lines;
}

// src/live-preview.ts
var import_state = require("@codemirror/state");
var import_view = require("@codemirror/view");

// src/renderer.ts
var import_obsidian = require("obsidian");

// src/parser.ts
var FUNCTION_ALIASES = {
  sqrt: "sqrt",
  sin: "sin",
  cos: "cos",
  tan: "tan",
  tg: "tan",
  cot: "cot",
  ctg: "cot",
  ln: "ln",
  log: "log",
  abs: "abs"
};
var RANGE_PATTERN = /^([a-zA-Z])\s*(?::|=)?\s*(-?(?:\d+(?:[.,]\d*)?|[.,]\d+))\s*-\s*(-?(?:\d+(?:[.,]\d*)?|[.,]\d+))(?:\s*(?:\/|;)\s*((?:\d+(?:[.,]\d*)?|[.,]\d+)))?\s*$/;
var FormulaSyntaxError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "FormulaSyntaxError";
  }
};
function parseFormulaBlock(source) {
  const lines = source.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith("#"));
  if (lines.length === 0) {
    throw new FormulaSyntaxError("\u0412 \u0431\u043B\u043E\u043A\u0435 \u043E\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u0435\u0442 \u0444\u043E\u0440\u043C\u0443\u043B\u0430.");
  }
  const sourceExpression = lines[0];
  const expression = parseExpression(sourceExpression);
  const variables = [...collectVariables(expression)].sort();
  const ranges = /* @__PURE__ */ new Map();
  for (const line of lines.slice(1)) {
    const range = parseRangeLine(line);
    if (!range) {
      throw new FormulaSyntaxError(
        `\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0440\u0430\u0437\u043E\u0431\u0440\u0430\u0442\u044C \u0434\u0438\u0430\u043F\u0430\u0437\u043E\u043D \xAB${line}\xBB. \u0418\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0439 \u0437\u0430\u043F\u0438\u0441\u044C d: 1-10.`
      );
    }
    ranges.set(range.name, range);
  }
  const missingRanges = variables.filter((name) => !ranges.has(name));
  if (missingRanges.length > 0) {
    throw new FormulaSyntaxError(
      `\u041D\u0435 \u0437\u0430\u0434\u0430\u043D\u044B \u0434\u0438\u0430\u043F\u0430\u0437\u043E\u043D\u044B \u0434\u043B\u044F \u043F\u0435\u0440\u0435\u043C\u0435\u043D\u043D\u044B\u0445: ${missingRanges.join(", ")}.`
    );
  }
  return {
    sourceExpression,
    expression,
    variables,
    ranges
  };
}
function parseExpression(source) {
  const tokens = insertImplicitMultiplication(tokenize(source));
  const parser = new ExpressionParser(tokens);
  return parser.parse();
}
function expressionToLatex(node) {
  return latexFor(node, 0);
}
function normalizeFormulaSignature(source) {
  return source.toLowerCase().replaceAll("\u03C0", "p").replaceAll("pi", "p").replaceAll("\xB2", "^2").replaceAll("\xB3", "^3").replace(/[×·*\s]/g, "").replace(/^\((.+)\)$/, "$1");
}
function formatNumber(value, maximumFractionDigits = 4) {
  if (!Number.isFinite(value)) {
    return Number.isNaN(value) ? "\u043D\u0435 \u043E\u043F\u0440\u0435\u0434\u0435\u043B\u0435\u043D\u043E" : value > 0 ? "\u221E" : "\u2212\u221E";
  }
  const normalized = Math.abs(value) < 1e-12 ? 0 : value;
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits,
    useGrouping: false
  }).format(normalized);
}
function tokenize(source) {
  const normalized = source.trim().replaceAll("\u03C0", "pi").replaceAll("\u2212", "-").replaceAll("\u2013", "-").replaceAll("\u2014", "-").replaceAll("\xD7", "*").replaceAll("\xB7", "*").replaceAll("\xB2", "^2").replaceAll("\xB3", "^3").replace(/(?<=\d),(?=\d)/g, ".");
  const tokens = [];
  let index = 0;
  while (index < normalized.length) {
    const character = normalized[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (/\d|\./.test(character)) {
      const start = index;
      let dots = 0;
      while (index < normalized.length && /[\d.]/.test(normalized[index])) {
        if (normalized[index] === ".") dots += 1;
        index += 1;
      }
      const raw = normalized.slice(start, index);
      const value = Number(raw);
      if (dots > 1 || !Number.isFinite(value)) {
        throw new FormulaSyntaxError(`\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u043E\u0435 \u0447\u0438\u0441\u043B\u043E \xAB${raw}\xBB.`);
      }
      tokens.push({ type: "number", text: raw, value });
      continue;
    }
    if (/[a-zA-Z]/.test(character)) {
      const start = index;
      while (index < normalized.length && /[a-zA-Z]/.test(normalized[index])) {
        index += 1;
      }
      const word = normalized.slice(start, index).toLowerCase();
      if (word === "pi") {
        tokens.push({ type: "constant", text: "pi" });
      } else if (word in FUNCTION_ALIASES) {
        tokens.push({
          type: "function",
          text: FUNCTION_ALIASES[word]
        });
      } else {
        for (const letter of word) {
          if (letter === "p") {
            tokens.push({ type: "constant", text: "pi" });
          } else if (letter === "e") {
            tokens.push({ type: "constant", text: "e" });
          } else {
            tokens.push({ type: "variable", text: letter });
          }
        }
      }
      continue;
    }
    if ("+-*/^".includes(character)) {
      tokens.push({ type: "operator", text: character });
      index += 1;
      continue;
    }
    if (character === "(") {
      tokens.push({ type: "left-parenthesis", text: character });
      index += 1;
      continue;
    }
    if (character === ")") {
      tokens.push({ type: "right-parenthesis", text: character });
      index += 1;
      continue;
    }
    if (character === "\u221A") {
      tokens.push({ type: "function", text: "sqrt" });
      index += 1;
      continue;
    }
    throw new FormulaSyntaxError(`\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u044B\u0439 \u0441\u0438\u043C\u0432\u043E\u043B \xAB${character}\xBB.`);
  }
  tokens.push({ type: "end", text: "" });
  return tokens;
}
function insertImplicitMultiplication(tokens) {
  const result = [];
  for (const token of tokens) {
    const previous = result[result.length - 1];
    if (previous && previous.type !== "end" && token.type !== "end" && canEndValue(previous) && canStartValue(token) && !(previous.type === "function" && token.type === "left-parenthesis")) {
      result.push({ type: "operator", text: "*" });
    }
    result.push(token);
  }
  return result;
}
function canEndValue(token) {
  return token.type === "number" || token.type === "variable" || token.type === "constant" || token.type === "right-parenthesis";
}
function canStartValue(token) {
  return token.type === "number" || token.type === "variable" || token.type === "constant" || token.type === "function" || token.type === "left-parenthesis";
}
var ExpressionParser = class {
  constructor(tokens) {
    this.tokens = tokens;
    this.position = 0;
  }
  parse() {
    const expression = this.parseAddition();
    const token = this.peek();
    if (token.type !== "end") {
      throw new FormulaSyntaxError(`\u041B\u0438\u0448\u043D\u0438\u0439 \u0444\u0440\u0430\u0433\u043C\u0435\u043D\u0442 \xAB${token.text}\xBB.`);
    }
    return expression;
  }
  parseAddition() {
    let left = this.parseMultiplication();
    while (this.matchesOperator("+") || this.matchesOperator("-")) {
      const operator = this.consume().text;
      const right = this.parseMultiplication();
      left = { kind: "binary", operator, left, right };
    }
    return left;
  }
  parseMultiplication() {
    let left = this.parseUnary();
    while (this.matchesOperator("*") || this.matchesOperator("/")) {
      const operator = this.consume().text;
      const right = this.parseUnary();
      left = { kind: "binary", operator, left, right };
    }
    return left;
  }
  parseUnary() {
    if (this.matchesOperator("+") || this.matchesOperator("-")) {
      const operator = this.consume().text;
      return {
        kind: "unary",
        operator,
        operand: this.parseUnary()
      };
    }
    return this.parsePower();
  }
  parsePower() {
    const left = this.parsePrimary();
    if (this.matchesOperator("^")) {
      this.consume();
      return {
        kind: "binary",
        operator: "^",
        left,
        right: this.parseUnary()
      };
    }
    return left;
  }
  parsePrimary() {
    var _a;
    const token = this.consume();
    if (token.type === "number") {
      return { kind: "number", value: (_a = token.value) != null ? _a : 0 };
    }
    if (token.type === "variable") {
      return { kind: "variable", name: token.text };
    }
    if (token.type === "constant") {
      return {
        kind: "constant",
        name: token.text
      };
    }
    if (token.type === "function") {
      this.expect("left-parenthesis", "(");
      const argument = this.parseAddition();
      this.expect("right-parenthesis", ")");
      return {
        kind: "call",
        name: token.text,
        argument
      };
    }
    if (token.type === "left-parenthesis") {
      const expression = this.parseAddition();
      this.expect("right-parenthesis", ")");
      return expression;
    }
    throw new FormulaSyntaxError(
      token.type === "end" ? "\u0424\u043E\u0440\u043C\u0443\u043B\u0430 \u043D\u0435\u043E\u0436\u0438\u0434\u0430\u043D\u043D\u043E \u0437\u0430\u043A\u043E\u043D\u0447\u0438\u043B\u0430\u0441\u044C." : `\u041E\u0436\u0438\u0434\u0430\u043B\u043E\u0441\u044C \u0447\u0438\u0441\u043B\u043E, \u043F\u0435\u0440\u0435\u043C\u0435\u043D\u043D\u0430\u044F \u0438\u043B\u0438 \u0441\u043A\u043E\u0431\u043A\u0430, \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u043E \xAB${token.text}\xBB.`
    );
  }
  expect(type, text) {
    const token = this.consume();
    if (token.type !== type) {
      throw new FormulaSyntaxError(`\u041E\u0436\u0438\u0434\u0430\u043B\u0441\u044F \u0441\u0438\u043C\u0432\u043E\u043B \xAB${text}\xBB.`);
    }
  }
  matchesOperator(operator) {
    const token = this.peek();
    return token.type === "operator" && token.text === operator;
  }
  peek() {
    var _a;
    return (_a = this.tokens[this.position]) != null ? _a : { type: "end", text: "" };
  }
  consume() {
    const token = this.peek();
    this.position += 1;
    return token;
  }
};
function collectVariables(node, target = /* @__PURE__ */ new Set()) {
  switch (node.kind) {
    case "variable":
      target.add(node.name);
      break;
    case "unary":
      collectVariables(node.operand, target);
      break;
    case "binary":
      collectVariables(node.left, target);
      collectVariables(node.right, target);
      break;
    case "call":
      collectVariables(node.argument, target);
      break;
    case "number":
    case "constant":
      break;
  }
  return target;
}
function parseRangeLine(line) {
  const match = line.match(RANGE_PATTERN);
  if (!match) return null;
  const name = match[1].toLowerCase();
  let min = parseLocalizedNumber(match[2]);
  let max = parseLocalizedNumber(match[3]);
  if (min === max) {
    throw new FormulaSyntaxError(
      `\u0414\u0438\u0430\u043F\u0430\u0437\u043E\u043D ${name} \u0434\u043E\u043B\u0436\u0435\u043D \u0441\u043E\u0434\u0435\u0440\u0436\u0430\u0442\u044C \u0440\u0430\u0437\u043D\u044B\u0435 \u0433\u0440\u0430\u043D\u0438\u0446\u044B.`
    );
  }
  if (min > max) {
    [min, max] = [max, min];
  }
  const requestedStep = match[4] ? parseLocalizedNumber(match[4]) : void 0;
  const step = requestedStep && requestedStep > 0 ? requestedStep : chooseStep(max - min);
  const initial = snapToStep((min + max) / 2, min, step);
  return { name, min, max, step, initial };
}
function parseLocalizedNumber(raw) {
  return Number(raw.replace(",", "."));
}
function chooseStep(span) {
  const rawStep = span / 100;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
}
function snapToStep(value, min, step) {
  const snapped = min + Math.round((value - min) / step) * step;
  return Number(snapped.toFixed(12));
}
function latexFor(node, parentPrecedence) {
  const precedence = nodePrecedence(node);
  let result;
  switch (node.kind) {
    case "number":
      result = formatNumber(node.value, 8).replace(",", "{,}");
      break;
    case "variable":
      result = node.name;
      break;
    case "constant":
      result = node.name === "pi" ? "\\pi" : "e";
      break;
    case "unary":
      result = `${node.operator}${latexFor(node.operand, precedence)}`;
      break;
    case "binary":
      if (node.operator === "/") {
        result = `\\frac{${latexFor(node.left, 0)}}{${latexFor(
          node.right,
          0
        )}}`;
      } else if (node.operator === "^") {
        result = `${latexFor(node.left, precedence)}^{${latexFor(
          node.right,
          0
        )}}`;
      } else {
        const operator = node.operator === "*" ? "\\," : node.operator === "-" ? "-" : "+";
        result = `${latexFor(node.left, precedence)}${operator}${latexFor(
          node.right,
          precedence + (node.operator === "-" ? 1 : 0)
        )}`;
      }
      break;
    case "call": {
      const argument = latexFor(node.argument, 0);
      if (node.name === "sqrt") {
        result = `\\sqrt{${argument}}`;
      } else if (node.name === "abs") {
        result = `\\left|${argument}\\right|`;
      } else {
        const functionName = node.name === "tan" ? "operatorname{tg}" : node.name === "cot" ? "operatorname{ctg}" : node.name;
        result = `\\${functionName}\\left(${argument}\\right)`;
      }
      break;
    }
  }
  return precedence < parentPrecedence ? `\\left(${result}\\right)` : result;
}
function nodePrecedence(node) {
  if (node.kind === "binary") {
    if (node.operator === "+" || node.operator === "-") return 1;
    if (node.operator === "*" || node.operator === "/") return 2;
    return 4;
  }
  if (node.kind === "unary") return 3;
  return 5;
}

// src/visualizations.ts
var SVG_NAMESPACE = "http://www.w3.org/2000/svg";
function findFormulaPresentation(source) {
  const signature = normalizeFormulaSignature(source);
  if (signature === "pdh") {
    return {
      kind: "cylinder-lateral-diameter",
      title: "\u041F\u043B\u043E\u0449\u0430\u0434\u044C \u0431\u043E\u043A\u043E\u0432\u043E\u0439 \u043F\u043E\u0432\u0435\u0440\u0445\u043D\u043E\u0441\u0442\u0438 \u0446\u0438\u043B\u0438\u043D\u0434\u0440\u0430",
      resultSymbolLatex: "S_{\\text{\u0431\u043E\u043A}}"
    };
  }
  if (signature === "2prh") {
    return {
      kind: "cylinder-lateral-radius",
      title: "\u041F\u043B\u043E\u0449\u0430\u0434\u044C \u0431\u043E\u043A\u043E\u0432\u043E\u0439 \u043F\u043E\u0432\u0435\u0440\u0445\u043D\u043E\u0441\u0442\u0438 \u0446\u0438\u043B\u0438\u043D\u0434\u0440\u0430",
      resultSymbolLatex: "S_{\\text{\u0431\u043E\u043A}}"
    };
  }
  if (signature === "pr^2") {
    return {
      kind: "circle-area",
      title: "\u041F\u043B\u043E\u0449\u0430\u0434\u044C \u043A\u0440\u0443\u0433\u0430",
      resultSymbolLatex: "S"
    };
  }
  if (signature === "2pr") {
    return {
      kind: "circle-circumference",
      title: "\u0414\u043B\u0438\u043D\u0430 \u043E\u043A\u0440\u0443\u0436\u043D\u043E\u0441\u0442\u0438",
      resultSymbolLatex: "L"
    };
  }
  if (signature === "4pr^2") {
    return {
      kind: "sphere-area",
      title: "\u041F\u043B\u043E\u0449\u0430\u0434\u044C \u043F\u043E\u0432\u0435\u0440\u0445\u043D\u043E\u0441\u0442\u0438 \u0448\u0430\u0440\u0430",
      resultSymbolLatex: "S"
    };
  }
  if (signature === "4/3pr^3" || signature === "(4/3)pr^3" || signature === "4pr^3/3") {
    return {
      kind: "sphere-volume",
      title: "\u041E\u0431\u044A\u0451\u043C \u0448\u0430\u0440\u0430",
      resultSymbolLatex: "V"
    };
  }
  if (signature === "sqrt(a^2+b^2)" || signature === "sqrt(b^2+a^2)") {
    return {
      kind: "pythagorean",
      title: "\u0422\u0435\u043E\u0440\u0435\u043C\u0430 \u041F\u0438\u0444\u0430\u0433\u043E\u0440\u0430",
      resultSymbolLatex: "c"
    };
  }
  if (signature === "a^2+b^2" || signature === "b^2+a^2") {
    return {
      kind: "pythagorean-squared",
      title: "\u0422\u0435\u043E\u0440\u0435\u043C\u0430 \u041F\u0438\u0444\u0430\u0433\u043E\u0440\u0430",
      resultSymbolLatex: "c^{2}"
    };
  }
  return {
    kind: null,
    title: "\u0417\u043D\u0430\u0447\u0435\u043D\u0438\u0435 \u0432\u044B\u0440\u0430\u0436\u0435\u043D\u0438\u044F",
    resultSymbolLatex: null
  };
}
function renderVisualization(kind, container, values, ranges, interaction) {
  container.replaceChildren();
  switch (kind) {
    case "cylinder-lateral-diameter":
      renderCylinder(container, values, ranges, false, interaction);
      break;
    case "cylinder-lateral-radius":
      renderCylinder(container, values, ranges, true, interaction);
      break;
    case "circle-area":
    case "circle-circumference":
      renderCircle(container, values, ranges);
      break;
    case "sphere-area":
    case "sphere-volume":
      renderSphere(container, values, ranges);
      break;
    case "pythagorean":
    case "pythagorean-squared":
      renderPythagoreanTriangle(container, values, ranges);
      break;
  }
}
function renderCylinder(container, values, ranges, usesRadius, interaction) {
  var _a, _b;
  const document = container.ownerDocument;
  const grid = document.createElement("div");
  grid.className = "ifm-visual-grid";
  container.appendChild(grid);
  const cylinderPanel = createVisualPanel(grid);
  const cylinderSvg = createSvg(
    cylinderPanel,
    "\u0426\u0438\u043B\u0438\u043D\u0434\u0440 \u0441 \u043E\u0431\u043E\u0437\u043D\u0430\u0447\u0435\u043D\u043D\u044B\u043C\u0438 \u0440\u0430\u0437\u043C\u0435\u0440\u0430\u043C\u0438"
  );
  const widthVariable = usesRadius ? "r" : "d";
  const widthValue = (_a = values[widthVariable]) != null ? _a : 1;
  const heightValue = (_b = values.h) != null ? _b : 1;
  const diameterValue = usesRadius ? widthValue * 2 : widthValue;
  const {
    width: cylinderWidth,
    height: cylinderHeight
  } = scalePhysicalDimensions(
    diameterValue,
    heightValue,
    ranges.get(widthVariable),
    ranges.get("h"),
    220,
    165,
    usesRadius ? 2 : 1
  );
  const centerX = 135;
  const centerY = 117.5;
  const topY = centerY - cylinderHeight / 2;
  const left = centerX - cylinderWidth / 2;
  const right = centerX + cylinderWidth / 2;
  const bottomY = topY + cylinderHeight;
  const capYRadius = Math.max(3, Math.min(18, cylinderWidth * 0.12));
  const top = appendSvg(cylinderSvg, "ellipse", "ifm-shape-visible ifm-cylinder-region", {
    cx: centerX,
    cy: topY,
    rx: cylinderWidth / 2,
    ry: capYRadius
  });
  appendSvg(cylinderSvg, "line", "ifm-shape-visible", {
    x1: left,
    y1: topY,
    x2: left,
    y2: bottomY
  });
  appendSvg(cylinderSvg, "line", "ifm-shape-visible", {
    x1: right,
    y1: topY,
    x2: right,
    y2: bottomY
  });
  appendSvg(cylinderSvg, "path", "ifm-shape-hidden", {
    d: `M ${left} ${bottomY} A ${cylinderWidth / 2} ${capYRadius} 0 0 1 ${right} ${bottomY}`
  });
  appendSvg(cylinderSvg, "path", "ifm-shape-visible", {
    d: `M ${left} ${bottomY} A ${cylinderWidth / 2} ${capYRadius} 0 0 0 ${right} ${bottomY}`
  });
  if ((interaction == null ? void 0 : interaction.onInspect) && interaction.onInspectEnd) {
    const baseFormula = usesRadius ? "S_{\\text{\u043E\u0441\u043D}}=\\pi r^{2}" : "S_{\\text{\u043E\u0441\u043D}}=\\frac{\\pi d^{2}}{4}";
    const lateralFormula = usesRadius ? "S_{\\text{\u0431\u043E\u043A}}=2\\pi rh" : "S_{\\text{\u0431\u043E\u043A}}=\\pi dh";
    bindInspection(top, baseFormula, interaction);
    const side = appendSvg(cylinderSvg, "rect", "ifm-cylinder-hit ifm-cylinder-side-hit", {
      x: left,
      y: topY + capYRadius * 0.55,
      width: cylinderWidth,
      height: Math.max(3, cylinderHeight - capYRadius * 0.55)
    });
    bindInspection(side, lateralFormula, interaction);
    const bottom = appendSvg(cylinderSvg, "ellipse", "ifm-cylinder-hit ifm-cylinder-base-hit", {
      cx: centerX,
      cy: bottomY,
      rx: cylinderWidth / 2,
      ry: capYRadius
    });
    bindInspection(bottom, baseFormula, interaction);
  }
}
function bindInspection(region, latex, interaction) {
  region.addEventListener("pointerenter", () => {
    var _a;
    (_a = interaction.onInspect) == null ? void 0 : _a.call(interaction, latex, region);
  });
  region.addEventListener("pointerleave", () => {
    var _a;
    (_a = interaction.onInspectEnd) == null ? void 0 : _a.call(interaction);
  });
}
function renderCircle(container, values, ranges) {
  var _a;
  const panel = createVisualPanel(container);
  const svg = createSvg(panel, "\u041A\u0440\u0443\u0433 \u0441 \u043E\u0431\u043E\u0437\u043D\u0430\u0447\u0435\u043D\u043D\u044B\u043C \u0440\u0430\u0434\u0438\u0443\u0441\u043E\u043C");
  const radiusValue = (_a = values.r) != null ? _a : 1;
  const radius = scaleMagnitude(radiusValue, ranges.get("r"), 98);
  const centerX = 135;
  const centerY = 112;
  appendSvg(svg, "circle", "ifm-shape-visible", {
    cx: centerX,
    cy: centerY,
    r: radius
  });
}
function renderSphere(container, values, ranges) {
  var _a;
  const panel = createVisualPanel(container);
  const svg = createSvg(panel, "\u041A\u0430\u0440\u043A\u0430\u0441 \u0448\u0430\u0440\u0430 \u0441 \u0432\u0438\u0434\u0438\u043C\u044B\u043C\u0438 \u0438 \u043D\u0435\u0432\u0438\u0434\u0438\u043C\u044B\u043C\u0438 \u043B\u0438\u043D\u0438\u044F\u043C\u0438");
  const radiusValue = (_a = values.r) != null ? _a : 1;
  const radius = scaleMagnitude(radiusValue, ranges.get("r"), 98);
  const centerX = 135;
  const centerY = 112;
  const equatorYRadius = radius * 0.28;
  const meridianXRadius = radius * 0.32;
  appendSvg(svg, "circle", "ifm-shape-visible", {
    cx: centerX,
    cy: centerY,
    r: radius
  });
  appendSvg(svg, "path", "ifm-shape-hidden", {
    d: `M ${centerX - radius} ${centerY} A ${radius} ${equatorYRadius} 0 0 1 ${centerX + radius} ${centerY}`
  });
  appendSvg(svg, "path", "ifm-shape-visible", {
    d: `M ${centerX - radius} ${centerY} A ${radius} ${equatorYRadius} 0 0 0 ${centerX + radius} ${centerY}`
  });
  appendSvg(svg, "path", "ifm-shape-hidden", {
    d: `M ${centerX} ${centerY - radius} A ${meridianXRadius} ${radius} 0 0 1 ${centerX} ${centerY + radius}`
  });
  appendSvg(svg, "path", "ifm-shape-visible", {
    d: `M ${centerX} ${centerY - radius} A ${meridianXRadius} ${radius} 0 0 0 ${centerX} ${centerY + radius}`
  });
}
function renderPythagoreanTriangle(container, values, ranges) {
  var _a, _b;
  const panel = createVisualPanel(container);
  const svg = createSvg(panel, "\u041F\u0440\u044F\u043C\u043E\u0443\u0433\u043E\u043B\u044C\u043D\u044B\u0439 \u0442\u0440\u0435\u0443\u0433\u043E\u043B\u044C\u043D\u0438\u043A \u0441 \u043A\u0430\u0442\u0435\u0442\u0430\u043C\u0438 a \u0438 b");
  const aValue = (_a = values.a) != null ? _a : 1;
  const bValue = (_b = values.b) != null ? _b : 1;
  const { width, height } = scalePhysicalDimensions(
    aValue,
    bValue,
    ranges.get("a"),
    ranges.get("b"),
    210,
    170
  );
  const left = (270 - width) / 2;
  const bottom = (235 + height) / 2;
  const top = bottom - height;
  const right = left + width;
  appendSvg(svg, "path", "ifm-shape-visible", {
    d: `M ${left} ${bottom} L ${right} ${bottom} L ${left} ${top} Z`
  });
}
function createVisualPanel(parent) {
  const document = parent.ownerDocument;
  const panel = document.createElement("section");
  panel.className = "ifm-visual-panel";
  parent.appendChild(panel);
  return panel;
}
function createSvg(parent, accessibleLabel) {
  const svg = parent.ownerDocument.createElementNS(
    SVG_NAMESPACE,
    "svg"
  );
  svg.setAttribute("viewBox", "0 0 270 235");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", accessibleLabel);
  svg.classList.add("ifm-svg");
  parent.appendChild(svg);
  return svg;
}
function appendSvg(parent, tag, className, attributes) {
  const element = parent.ownerDocument.createElementNS(SVG_NAMESPACE, tag);
  element.setAttribute("class", className);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, String(value));
  }
  parent.appendChild(element);
  return element;
}
function scalePhysicalDimensions(widthValue, heightValue, widthRange, heightRange, maximumWidth, maximumHeight, widthRangeMultiplier = 1, minimumVisiblePixels = 3) {
  const widthMagnitude = finiteMagnitude(widthValue);
  const heightMagnitude = finiteMagnitude(heightValue);
  const maximumWidthMagnitude = rangeMagnitude(
    widthRange,
    widthMagnitude / Math.max(widthRangeMultiplier, Number.EPSILON)
  ) * widthRangeMultiplier;
  const maximumHeightMagnitude = rangeMagnitude(
    heightRange,
    heightMagnitude
  );
  const widthScale = maximumWidthMagnitude > 0 ? maximumWidth / maximumWidthMagnitude : Number.POSITIVE_INFINITY;
  const heightScale = maximumHeightMagnitude > 0 ? maximumHeight / maximumHeightMagnitude : Number.POSITIVE_INFINITY;
  const sharedScale = Math.min(widthScale, heightScale);
  const safeScale = Number.isFinite(sharedScale) ? sharedScale : 1;
  return {
    width: Math.min(
      maximumWidth,
      Math.max(minimumVisiblePixels, widthMagnitude * safeScale)
    ),
    height: Math.min(
      maximumHeight,
      Math.max(minimumVisiblePixels, heightMagnitude * safeScale)
    )
  };
}
function rangeMagnitude(range, fallback) {
  if (!range) return finiteMagnitude(fallback);
  return Math.max(finiteMagnitude(range.min), finiteMagnitude(range.max));
}
function scaleMagnitude(value, range, maximumPixels, minimumVisiblePixels = 3) {
  const magnitude = finiteMagnitude(value);
  if (!range) {
    return maximumPixels;
  }
  const maximumMagnitude = Math.max(
    finiteMagnitude(range.min),
    finiteMagnitude(range.max)
  );
  if (maximumMagnitude === 0) {
    return minimumVisiblePixels;
  }
  return Math.max(
    minimumVisiblePixels,
    Math.min(maximumPixels, magnitude / maximumMagnitude * maximumPixels)
  );
}
function finiteMagnitude(value) {
  return Number.isFinite(value) ? Math.abs(value) : 0;
}

// src/renderer.ts
var FormulaRenderer = class {
  constructor(source, container) {
    this.source = source;
    this.container = container;
    this.abortController = new AbortController();
    this.parsed = null;
    this.presentation = null;
    this.values = {};
    this.visualElement = null;
    this.formulaElement = null;
    this.defaultFormulaLatex = "";
    this.dimmedElements = [];
    this.valueOutputs = /* @__PURE__ */ new Map();
  }
  mount() {
    this.container.replaceChildren();
    this.container.classList.add("ifm-host");
    try {
      this.parsed = parseFormulaBlock(this.source);
      this.presentation = findFormulaPresentation(
        this.parsed.sourceExpression
      );
      this.values = Object.fromEntries(
        this.parsed.variables.map((name) => {
          var _a, _b, _c;
          return [
            name,
            (_c = (_b = (_a = this.parsed) == null ? void 0 : _a.ranges.get(name)) == null ? void 0 : _b.initial) != null ? _c : 0
          ];
        })
      );
      this.renderInterface();
      this.update();
    } catch (error) {
      this.renderError(error);
    }
  }
  destroy() {
    this.endInspection();
    this.abortController.abort();
    this.valueOutputs.clear();
    this.container.replaceChildren();
    this.container.classList.remove("ifm-host");
  }
  renderInterface() {
    if (!this.parsed || !this.presentation) return;
    const document = this.container.ownerDocument;
    const root = document.createElement("section");
    root.className = "ifm-root";
    root.setAttribute("aria-label", this.presentation.title);
    this.container.appendChild(root);
    const expressionLatex = expressionToLatex(this.parsed.expression);
    const formulaLatex = this.presentation.resultSymbolLatex ? `${this.presentation.resultSymbolLatex}=${expressionLatex}` : expressionLatex;
    this.defaultFormulaLatex = formulaLatex;
    this.formulaElement = (0, import_obsidian.renderMath)(formulaLatex, true);
    this.formulaElement.classList.add("ifm-formula");
    root.appendChild(this.formulaElement);
    if (this.presentation.kind) {
      this.visualElement = document.createElement("div");
      this.visualElement.className = "ifm-visual";
      root.appendChild(this.visualElement);
    }
    if (this.parsed.variables.length > 0) {
      const controls = document.createElement("div");
      controls.className = "ifm-controls";
      controls.setAttribute("aria-label", "\u041F\u0435\u0440\u0435\u043C\u0435\u043D\u043D\u044B\u0435 \u0444\u043E\u0440\u043C\u0443\u043B\u044B");
      root.appendChild(controls);
      for (const name of this.parsed.variables) {
        const range = this.parsed.ranges.get(name);
        if (!range) continue;
        const control = document.createElement("label");
        control.className = "ifm-control";
        const variable = document.createElement("span");
        variable.className = "ifm-variable";
        variable.textContent = name;
        variable.setAttribute("aria-hidden", "true");
        const input = document.createElement("input");
        input.className = "ifm-slider";
        input.type = "range";
        input.min = String(range.min);
        input.max = String(range.max);
        input.step = String(range.step);
        input.value = String(range.initial);
        input.setAttribute(
          "aria-label",
          `${name}: ${range.min}\u2013${range.max}`
        );
        input.addEventListener(
          "input",
          () => {
            this.values[name] = Number(input.value);
            this.update();
          },
          { signal: this.abortController.signal }
        );
        const output = document.createElement("output");
        output.className = "ifm-value";
        output.value = formatNumber(range.initial);
        output.textContent = output.value;
        this.valueOutputs.set(name, output);
        control.append(variable, input, output);
        controls.appendChild(control);
      }
    }
  }
  update() {
    var _a;
    if (!this.parsed || !this.presentation) return;
    for (const [name, output] of this.valueOutputs) {
      output.value = formatNumber((_a = this.values[name]) != null ? _a : 0);
      output.textContent = output.value;
    }
    if (this.presentation.kind && this.visualElement) {
      renderVisualization(
        this.presentation.kind,
        this.visualElement,
        this.values,
        this.parsed.ranges,
        {
          onInspect: (latex, region) => this.beginInspection(latex, region),
          onInspectEnd: () => this.endInspection()
        }
      );
    }
  }
  beginInspection(latex, region) {
    this.endInspection();
    this.replaceFormula(latex);
    region.classList.add("ifm-cylinder-region-active");
    this.container.classList.add("ifm-inspecting");
    let current = this.container;
    while (current && current !== current.ownerDocument.body) {
      const parent = current.parentElement;
      if (!parent) break;
      for (const sibling of Array.from(parent.children)) {
        if (sibling !== current && sibling instanceof HTMLElement) {
          sibling.classList.add("ifm-inspection-dimmed");
          this.dimmedElements.push(sibling);
        }
      }
      current = parent;
    }
  }
  endInspection() {
    this.replaceFormula(this.defaultFormulaLatex);
    this.container.classList.remove("ifm-inspecting");
    this.container.querySelectorAll(".ifm-cylinder-region-active").forEach((element) => element.classList.remove("ifm-cylinder-region-active"));
    for (const element of this.dimmedElements) {
      element.classList.remove("ifm-inspection-dimmed");
    }
    this.dimmedElements = [];
  }
  replaceFormula(latex) {
    if (!this.formulaElement || !latex) return;
    const replacement = (0, import_obsidian.renderMath)(latex, true);
    replacement.classList.add("ifm-formula");
    this.formulaElement.replaceWith(replacement);
    this.formulaElement = replacement;
  }
  renderError(error) {
    const document = this.container.ownerDocument;
    const element = document.createElement("div");
    element.className = "ifm-error";
    if (error instanceof FormulaSyntaxError || error instanceof Error) {
      element.textContent = error.message;
    } else {
      element.textContent = "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0442\u043E\u0431\u0440\u0430\u0437\u0438\u0442\u044C \u0444\u043E\u0440\u043C\u0443\u043B\u0443.";
    }
    this.container.appendChild(element);
  }
};

// src/live-preview.ts
function createFormulaLivePreviewExtension() {
  const formulaDecorations = import_state.StateField.define({
    create(state) {
      return buildDecorations(state);
    },
    update(decorations, transaction) {
      if (transaction.docChanged || transaction.selection !== void 0) {
        return buildDecorations(transaction.state);
      }
      return decorations;
    },
    provide: (field) => import_view.EditorView.decorations.from(field)
  });
  return formulaDecorations;
}
var FormulaWidget = class extends import_view.WidgetType {
  constructor(source, sourceFrom) {
    super();
    this.source = source;
    this.sourceFrom = sourceFrom;
    this.renderer = null;
  }
  eq(other) {
    return other.source === this.source && other.sourceFrom === this.sourceFrom;
  }
  toDOM(view) {
    const document = view.dom.ownerDocument;
    const wrapper = document.createElement("div");
    wrapper.className = "ifm-live-widget";
    wrapper.addEventListener("click", (event) => {
      if (event.target instanceof HTMLInputElement) return;
      view.dispatch({
        selection: { anchor: this.sourceFrom },
        scrollIntoView: true
      });
      view.focus();
    });
    const rendered = document.createElement("div");
    wrapper.appendChild(rendered);
    this.renderer = new FormulaRenderer(this.source, rendered);
    this.renderer.mount();
    return wrapper;
  }
  destroy() {
    var _a;
    (_a = this.renderer) == null ? void 0 : _a.destroy();
    this.renderer = null;
  }
  ignoreEvent() {
    return true;
  }
};
function buildDecorations(state) {
  const text = state.doc.toString();
  const blocks = findFormulaBlocks(text);
  const ranges = [];
  for (const block of blocks) {
    const isBeingEdited = state.selection.ranges.some(
      (selection) => selectionTouchesBlock(selection, block)
    );
    if (isBeingEdited) continue;
    for (const line of getBlockLines(state, block)) {
      ranges.push(
        import_view.Decoration.line({
          attributes: {
            class: "ifm-source-line-hidden",
            "aria-hidden": "true"
          }
        }).range(line.from)
      );
    }
    ranges.push(
      import_view.Decoration.widget({
        widget: new FormulaWidget(block.source, block.sourceFrom),
        block: true,
        side: 1
      }).range(block.to)
    );
  }
  return import_view.Decoration.set(ranges, true);
}
function getBlockLines(state, block) {
  const document = state.doc;
  const lastPosition = Math.max(block.from, block.to - 1);
  const firstLine = document.lineAt(block.from).number;
  const lastLine = document.lineAt(lastPosition).number;
  const lines = [];
  for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber += 1) {
    lines.push({ from: document.line(lineNumber).from });
  }
  return lines;
}

// src/main.ts
var InteractiveFormulasPlugin = class extends import_obsidian2.Plugin {
  async onload() {
    this.registerMarkdownPostProcessor((element, context) => {
      renderFormulaParagraphs(element, context);
    });
    this.registerEditorExtension(createFormulaLivePreviewExtension());
  }
};
function renderFormulaParagraphs(element, context) {
  const section = context.getSectionInfo(element);
  if (!section) return;
  const blocks = findFormulaBlocks(section.text);
  if (blocks.length === 0) return;
  const paragraphs = [
    ...element.matches("p") ? [element] : [],
    ...Array.from(element.querySelectorAll("p"))
  ];
  const usedParagraphs = /* @__PURE__ */ new Set();
  for (const block of blocks) {
    const blockText = section.text.slice(block.from, block.to);
    const paragraph = paragraphs.find(
      (candidate) => {
        var _a;
        return !usedParagraphs.has(candidate) && normalizeRenderedText((_a = candidate.textContent) != null ? _a : "") === normalizeRenderedText(blockText);
      }
    );
    if (!paragraph) continue;
    usedParagraphs.add(paragraph);
    const host = paragraph.ownerDocument.createElement("div");
    paragraph.replaceWith(host);
    context.addChild(new FormulaRenderChild(host, block.source));
  }
}
function normalizeRenderedText(text) {
  return text.replace(/\s+/g, " ").trim();
}
var FormulaRenderChild = class extends import_obsidian2.MarkdownRenderChild {
  constructor(container, source) {
    super(container);
    this.source = source;
    this.renderer = null;
  }
  onload() {
    this.renderer = new FormulaRenderer(this.source, this.containerEl);
    this.renderer.mount();
  }
  onunload() {
    var _a;
    (_a = this.renderer) == null ? void 0 : _a.destroy();
    this.renderer = null;
  }
};

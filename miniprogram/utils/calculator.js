/**
 * 计算器表达式求值。解析器（jsep）由外部注入，便于在不同宿主中复用。
 * 语义与桌面版 app.js 的 calculator 实现保持一致：整数字面量走 BigInt，浮点走 Number，
 * 位运算仅接受精确整数，除法向下取整、取模结果符号跟随除数。
 */

let parser = null;

function useParser(nextParser) {
  parser = nextParser;
  // 桌面版在初始化时注册 "//" 作为整除运算符；jsep 默认不认识它。
  parser.addBinaryOp("//", 10);
  return parser;
}

/** 把 0x/0b/0o 前缀字面量和数字分隔符归一成十进制，交给解析器。 */
function normalizeExpression(expression) {
  let normalized = String(expression || "").trim();
  const replacePrefixedInteger = (pattern) => {
    normalized = normalized.replace(pattern, (_match, prefix, literal) => {
      try {
        return `${prefix}${BigInt(literal.replace(/_/g, "")).toString(10)}`;
      } catch (_error) {
        throw new Error(`无效整数：${literal}`);
      }
    });
  };
  replacePrefixedInteger(/(^|[^A-Za-z0-9_$])(0[xX][0-9a-fA-F](?:_?[0-9a-fA-F])*)/g);
  replacePrefixedInteger(/(^|[^A-Za-z0-9_$])(0[bB][01](?:_?[01])*)/g);
  replacePrefixedInteger(/(^|[^A-Za-z0-9_$])(0[oO][0-7](?:_?[0-7])*)/g);
  while (/(\d)_(?=\d)/.test(normalized)) normalized = normalized.replace(/(\d)_(?=\d)/g, "$1");
  return normalized;
}

function validateResult(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("结果超出可表示范围");
    return value;
  }
  if (typeof value !== "bigint") throw new Error("表达式结果不是数值");
  const magnitude = value < 0n ? -value : value;
  if (magnitude.toString(2).length > 65536) throw new Error("整数结果过大");
  return value;
}

function calculatorNumber(value) {
  if (typeof value === "number") return value;
  const converted = Number(value);
  if (!Number.isFinite(converted)) throw new Error("数值过大，无法转换为浮点数");
  return converted;
}

function calculatorInteger(value) {
  if (typeof value === "bigint") return value;
  if (!Number.isSafeInteger(value)) throw new Error("位运算仅支持精确整数");
  return BigInt(value);
}

function floorDivide(left, right) {
  if (typeof left !== "bigint" || typeof right !== "bigint") {
    const divisor = calculatorNumber(right);
    if (divisor === 0) throw new Error("除数不能为 0");
    return Math.floor(calculatorNumber(left) / divisor);
  }
  if (right === 0n) throw new Error("除数不能为 0");
  let quotient = left / right;
  const remainder = left % right;
  if (remainder !== 0n && remainder > 0n !== right > 0n) quotient -= 1n;
  return quotient;
}

function modulo(left, right) {
  if (typeof left !== "bigint" || typeof right !== "bigint") {
    const dividend = calculatorNumber(left);
    const divisor = calculatorNumber(right);
    if (divisor === 0) throw new Error("除数不能为 0");
    let remainder = dividend % divisor;
    if (remainder !== 0 && remainder > 0 !== divisor > 0) remainder += divisor;
    return remainder;
  }
  if (right === 0n) throw new Error("除数不能为 0");
  let remainder = left % right;
  if (remainder !== 0n && remainder > 0n !== right > 0n) remainder += right;
  return remainder;
}

function evaluateBinary(operator, left, right) {
  const bothIntegers = typeof left === "bigint" && typeof right === "bigint";
  if (operator === "+") return bothIntegers ? left + right : calculatorNumber(left) + calculatorNumber(right);
  if (operator === "-") return bothIntegers ? left - right : calculatorNumber(left) - calculatorNumber(right);
  if (operator === "*") return bothIntegers ? left * right : calculatorNumber(left) * calculatorNumber(right);
  if (operator === "/") {
    const divisor = calculatorNumber(right);
    if (divisor === 0) throw new Error("除数不能为 0");
    return calculatorNumber(left) / divisor;
  }
  if (operator === "//") return floorDivide(left, right);
  if (operator === "%") return modulo(left, right);
  if (operator === "**") {
    if (bothIntegers && right >= 0n) {
      if (right > 10000n) throw new Error("指数过大");
      return left ** right;
    }
    return calculatorNumber(left) ** calculatorNumber(right);
  }
  if (["<<", ">>", "&", "|", "^"].includes(operator)) {
    const integerLeft = calculatorInteger(left);
    const integerRight = calculatorInteger(right);
    if (["<<", ">>"].includes(operator) && (integerRight < 0n || integerRight > 65536n)) {
      throw new Error("移位位数必须在 0 到 65536 之间");
    }
    if (operator === "<<") return integerLeft << integerRight;
    if (operator === ">>") return integerLeft >> integerRight;
    if (operator === "&") return integerLeft & integerRight;
    if (operator === "|") return integerLeft | integerRight;
    return integerLeft ^ integerRight;
  }
  throw new Error(`不支持运算符 ${operator}`);
}

function evaluateNode(node, lastResult) {
  if (node.type === "Literal") {
    if (typeof node.value !== "number") throw new Error("仅支持数字字面量");
    if (/^\d+$/.test(node.raw || "")) return BigInt(node.raw);
    return validateResult(node.value);
  }
  if (node.type === "Identifier") {
    if (!["ans", "_"].includes(node.name)) throw new Error(`未知名称 ${node.name}`);
    if (lastResult === null || lastResult === undefined) throw new Error("还没有上一条计算结果");
    return lastResult;
  }
  if (node.type === "UnaryExpression") {
    const value = evaluateNode(node.argument, lastResult);
    if (node.operator === "+") return value;
    if (node.operator === "-") return validateResult(-value);
    if (node.operator === "~") return validateResult(~calculatorInteger(value));
    throw new Error(`不支持一元运算符 ${node.operator}`);
  }
  if (node.type === "BinaryExpression") {
    const value = evaluateBinary(
      node.operator,
      evaluateNode(node.left, lastResult),
      evaluateNode(node.right, lastResult),
    );
    return validateResult(value);
  }
  throw new Error("仅支持数字、括号和算术或位运算符");
}

function calculate(expression, lastResult = null) {
  if (!parser) throw new Error("计算器解析器未加载");
  const normalized = normalizeExpression(expression);
  if (!normalized) throw new Error("请输入表达式");
  return evaluateNode(parser(normalized), lastResult);
}

function formatResult(value) {
  return typeof value === "bigint" ? value.toString(10) : String(value);
}

function formatHexResult(value) {
  const negative = value < 0;
  const magnitude = negative ? -value : value;
  return `${negative ? "-" : ""}0x${magnitude.toString(16).toUpperCase()}`;
}

module.exports = {
  calculate,
  evaluateBinary,
  evaluateNode,
  formatHexResult,
  formatResult,
  normalizeExpression,
  useParser,
};

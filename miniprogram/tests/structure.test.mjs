/**
 * 小程序工程静态校验。无法运行微信开发者工具，因此用 Node 兜底检查：
 *   1. 所有 JSON 配置可解析
 *   2. app.json 声明的页面都存在对应文件
 *   3. 每个页面模块能被加载（require 路径正确、Page() 调用成功）
 *   4. WXML 中绑定的事件处理函数在页面配置中真实存在
 *   5. WXML 中引用的顶层数据字段在页面 data 中真实存在
 * 运行：node miniprogram/tests/structure.test.mjs
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "..");

/* ---------- 1. JSON 配置 ---------- */

const jsonFiles = ["app.json", "theme.json", "sitemap.json", "project.config.json"];
const appConfig = JSON.parse(readFileSync(resolve(root, "app.json"), "utf8"));
const themeConfig = JSON.parse(readFileSync(resolve(root, "theme.json"), "utf8"));
for (const file of jsonFiles) {
  JSON.parse(readFileSync(resolve(root, file), "utf8"));
}
assert.ok(Array.isArray(themeConfig.light) === false && typeof themeConfig.light === "object");
assert.ok(typeof themeConfig.dark === "object", "theme.json 必须同时定义 light 与 dark");
assert.equal(appConfig.darkmode, true, "启用 darkmode 才能让导航栏与 tabBar 跟随系统主题");
assert.equal(appConfig.themeLocation, "theme.json");
console.log(`config: ${jsonFiles.length} 个 JSON 文件可解析`);

/* ---------- 2. 页面文件齐全 ---------- */

const pagePaths = appConfig.pages;
assert.ok(pagePaths.length >= 4, "应至少声明工具、芯片、搜索、设置四个页面");
for (const pagePath of pagePaths) {
  for (const extension of ["js", "wxml", "json"]) {
    const file = resolve(root, `${pagePath}.${extension}`);
    assert.ok(existsSync(file), `缺少页面文件 ${pagePath}.${extension}`);
  }
}
for (const item of appConfig.tabBar.list) {
  assert.ok(pagePaths.includes(item.pagePath), `tabBar 引用了未声明的页面 ${item.pagePath}`);
}
// tabBar 与 app.json 中引用的 @变量 必须在 theme.json 的两种主题下都定义
const referenced = new Set();
for (const value of [...Object.values(appConfig.window), ...Object.values(appConfig.tabBar)]) {
  if (typeof value === "string" && value.startsWith("@")) referenced.add(value.slice(1));
}
for (const name of referenced) {
  assert.ok(themeConfig.light[name] !== undefined, `theme.json light 缺少变量 ${name}`);
  assert.ok(themeConfig.dark[name] !== undefined, `theme.json dark 缺少变量 ${name}`);
}
console.log(`pages: ${pagePaths.length} 个页面文件齐全，theme.json 变量 ${referenced.size} 个均成对定义`);

/* ---------- 3~5. 逐页校验 ---------- */

const RESERVED = new Set([
  "true", "false", "null", "undefined", "item", "index", "track", "cell",
  "length", "string", "number",
]);

function extractHandlers(wxml) {
  const handlers = new Set();
  for (const match of wxml.matchAll(/\b(?:bind|catch|capture-bind|capture-catch)[:]?([a-z]+)\s*=\s*"([^"{}]+)"/g)) {
    handlers.add(match[2].trim());
  }
  return handlers;
}

function extractDataKeys(wxml) {
  const keys = new Set();
  for (const match of wxml.matchAll(/\{\{([^}]*)\}\}/g)) {
    // 去掉属性访问（item.hex 的 hex 不是顶层字段）和字符串字面量
    const expression = match[1].replace(/\.[A-Za-z_$][\w$]*/g, " ").replace(/'[^']*'|"[^"]*"/g, " ");
    for (const identifier of expression.match(/[A-Za-z_$][\w$]*/g) || []) {
      if (!RESERVED.has(identifier)) keys.add(identifier);
    }
  }
  return keys;
}

for (const pagePath of pagePaths) {
  const jsPath = resolve(root, `${pagePath}.js`);
  const wxmlPath = resolve(root, `${pagePath}.wxml`);

  let captured = null;
  const previousPage = global.Page;
  global.Page = (config) => {
    captured = config;
  };
  delete require.cache[jsPath];
  require(jsPath);
  global.Page = previousPage;

  assert.ok(captured, `${pagePath}.js 没有调用 Page()`);
  const methods = new Set(Object.keys(captured));
  const dataKeys = new Set(Object.keys(captured.data || {}));

  const wxml = readFileSync(wxmlPath, "utf8");
  const handlers = extractHandlers(wxml);
  for (const handler of handlers) {
    assert.ok(methods.has(handler), `${pagePath}.wxml 绑定了未定义的处理函数 ${handler}`);
  }
  const usedKeys = extractDataKeys(wxml);
  const unknown = [...usedKeys].filter((key) => !dataKeys.has(key));
  assert.deepEqual(unknown, [], `${pagePath}.wxml 引用了 data 中不存在的字段：${unknown.join("、")}`);

  console.log(
    `page ${pagePath}: ${handlers.size} 个处理函数、${usedKeys.size} 个数据字段均已定义`,
  );
}

/* ---------- 兜底：目录里不应有遗漏的页面 ---------- */

const declared = new Set(pagePaths.map((item) => item.replace(/^pages\//, "").replace(/\/index$/, "")));
for (const entry of readdirSync(resolve(root, "pages"))) {
  assert.ok(declared.has(entry), `pages/${entry} 未在 app.json 中声明`);
}

console.log("\nminiprogram structure tests passed");

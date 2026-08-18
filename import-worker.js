(function () {
  self.window = self;
  if (typeof self.parseRegisterYaml !== "function") {
    importScripts("yaml-lite.js", "yaml-validator.js", "translation-validator.js");
  }

  function errorMessage(error) {
    return error?.message || String(error);
  }

  function translationValidationError(report) {
    const shown = report.errors.slice(0, 12).map((message) => `错误：${message}`);
    if (report.errors.length > shown.length) shown.push(`另有 ${report.errors.length - shown.length} 项未显示`);
    return new Error(`翻译 YAML 规范校验未通过（${report.errors.length} 个错误）\n${shown.join("\n")}`);
  }

  async function readFileText(file) {
    if (typeof FileReaderSync === "function") return new FileReaderSync().readAsText(file, "utf-8");
    return file.text();
  }

  async function validateTranslation(item, source) {
    if (source.text) {
      await self.assertRegisterTranslationYaml(item.text, item.data, source.text, source.data);
      return;
    }
    const report = self.validateRegisterTranslationYaml(item.data, source.data, {
      sourceSha256: source.sourceSha256,
    });
    if (!report.valid) throw translationValidationError(report);
  }

  async function parseBatch(message) {
    const failures = [];
    const parsed = [];
    for (const entry of message.files || []) {
      const fileName = entry.fileName || entry.file?.name || entry.sourceName || "registers.yaml";
      try {
        const text = typeof entry.text === "string" ? entry.text : await readFileText(entry.file);
        parsed.push({
          fileName,
          sourceName: entry.sourceName || fileName,
          text,
          data: self.parseRegisterYaml(text),
        });
      } catch (error) {
        failures.push(`${fileName}: ${errorMessage(error)}`);
      }
    }

    const sourceItems = parsed.filter((item) => !self.isRegisterTranslationDocument(item.data));
    const translationItems = parsed.filter((item) => self.isRegisterTranslationDocument(item.data));
    const sourceContexts = new Map();
    for (const source of message.existingSources || []) {
      if (source.sourceSha256 && source.data) sourceContexts.set(source.sourceSha256, source);
    }

    const sources = [];
    for (const item of sourceItems) {
      try {
        self.assertRegisterYaml(item.text, item.data);
        item.sourceSha256 = await self.sha256RegisterYaml(item.text);
        sources.push(item);
        sourceContexts.set(item.sourceSha256, item);
      } catch (error) {
        failures.push(`${item.fileName}: ${errorMessage(error)}`);
      }
    }

    const translations = [];
    for (const item of translationItems) {
      try {
        const sourceSha256 = String(item.data.source_sha256 || "");
        const source = sourceContexts.get(sourceSha256);
        if (!source) {
          throw new Error("找不到与 source_sha256 匹配的英文源 YAML；请先导入对应英文寄存器文件");
        }
        await validateTranslation(item, source);
        item.sourceSha256 = sourceSha256;
        translations.push(item);
      } catch (error) {
        failures.push(`${item.fileName}: ${errorMessage(error)}`);
      }
    }
    return { sources, translations, failures };
  }

  self.onmessage = async (event) => {
    const message = event.data || {};
    if (message.type !== "parse-import") return;
    try {
      self.postMessage({
        type: "import-results",
        requestId: message.requestId,
        result: await parseBatch(message),
      });
    } catch (error) {
      self.postMessage({
        type: "import-error",
        requestId: message.requestId,
        error: errorMessage(error),
      });
    }
  };
})();

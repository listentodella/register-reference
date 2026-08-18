use serde_yaml::{Mapping, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

use crate::validation;

const FORMAT: &str = "register-reference-translation";
const DATA_ROOTS: [&str; 4] = ["architecture", "controllers", "sensors", "soc"];

#[derive(Debug)]
pub(crate) struct TranslationSummary {
    pub source_file: String,
    pub source_sha256: String,
    pub source_locale: String,
    pub locale: String,
    pub status: String,
    pub coverage: String,
    pub method: String,
    pub translator: String,
    pub updated: String,
}

struct TranslationValidator {
    errors: Vec<String>,
    translated_text_count: usize,
}

impl TranslationValidator {
    fn new() -> Self {
        Self {
            errors: Vec::new(),
            translated_text_count: 0,
        }
    }

    fn error(&mut self, path: &str, message: impl AsRef<str>) {
        self.errors.push(format!("{path}: {}", message.as_ref()));
    }

    fn finish(self) -> Result<(), String> {
        if self.errors.is_empty() {
            return Ok(());
        }
        const MAX_DETAILS: usize = 12;
        let count = self.errors.len();
        let mut details = self
            .errors
            .into_iter()
            .take(MAX_DETAILS)
            .map(|message| format!("错误：{message}"))
            .collect::<Vec<_>>();
        if count > details.len() {
            details.push(format!("另有 {} 项未显示", count - details.len()));
        }
        Err(format!(
            "翻译 YAML 规范校验未通过（{count} 个错误）\n{}",
            details.join("\n")
        ))
    }

    fn allowed_keys(&mut self, value: &Mapping, allowed: &[&str], path: &str) {
        for key in value.keys().filter_map(Value::as_str) {
            if !allowed.contains(&key) {
                self.error(&format!("{path}.{key}"), "未知字段");
            }
        }
    }

    fn translated_text(&mut self, item: &Mapping, key: &str, source: Option<&Value>, path: &str) {
        let Some(value) = get(item, key) else {
            return;
        };
        if nonempty_text(value).is_none() {
            self.error(&format!("{path}.{key}"), "必须是非空译文");
            return;
        }
        if source.and_then(nonempty_text).is_none() {
            self.error(&format!("{path}.{key}"), "英文源中没有可翻译的对应文本");
            return;
        }
        self.translated_text_count += 1;
    }

    fn translated_title(&mut self, item: &Mapping, path: &str) {
        let Some(value) = get(item, "title") else {
            return;
        };
        if nonempty_text(value).is_some() {
            self.translated_text_count += 1;
        } else {
            self.error(&format!("{path}.title"), "必须是非空译文");
        }
    }
}

fn key(name: &str) -> Value {
    Value::String(name.to_owned())
}

fn get<'a>(mapping: &'a Mapping, name: &str) -> Option<&'a Value> {
    mapping.get(key(name))
}

fn nonempty_text(value: &Value) -> Option<&str> {
    value
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty())
}

fn required_text(
    validator: &mut TranslationValidator,
    mapping: &Mapping,
    name: &str,
    path: &str,
) -> Option<String> {
    match get(mapping, name).and_then(nonempty_text) {
        Some(value) => Some(value.to_owned()),
        None => {
            validator.error(&format!("{path}.{name}"), "必须是非空字符串");
            None
        }
    }
}

fn mapping<'a>(
    validator: &mut TranslationValidator,
    value: Option<&'a Value>,
    path: &str,
) -> Option<&'a Mapping> {
    match value.and_then(Value::as_mapping) {
        Some(value) => Some(value),
        None => {
            validator.error(path, "必须是 mapping/object");
            None
        }
    }
}

fn sequence<'a>(
    validator: &mut TranslationValidator,
    value: Option<&'a Value>,
    path: &str,
) -> Option<&'a Vec<Value>> {
    match value.and_then(Value::as_sequence) {
        Some(value) => Some(value),
        None => {
            validator.error(path, "必须是 list/array");
            None
        }
    }
}

fn valid_locale(value: &str) -> bool {
    let parts = value.split('-').collect::<Vec<_>>();
    if parts.is_empty()
        || !(2..=3).contains(&parts[0].len())
        || !parts[0].chars().all(|c| c.is_ascii_lowercase())
    {
        return false;
    }
    let mut index = 1;
    if parts.get(index).is_some_and(|part| {
        part.len() == 4
            && part.chars().next().is_some_and(|c| c.is_ascii_uppercase())
            && part.chars().skip(1).all(|c| c.is_ascii_lowercase())
    }) {
        index += 1;
    }
    if parts.get(index).is_some_and(|part| {
        (part.len() == 2 && part.chars().all(|c| c.is_ascii_uppercase()))
            || (part.len() == 3 && part.chars().all(|c| c.is_ascii_digit()))
    }) {
        index += 1;
    }
    index == parts.len()
}

#[cfg(test)]
mod tests {
    use super::valid_locale;

    #[test]
    fn accepts_supported_canonical_language_tags() {
        for locale in ["en", "zh-CN", "zh-Hans", "zh-Hans-CN", "es-419"] {
            assert!(valid_locale(locale), "expected {locale} to be valid");
        }
    }

    #[test]
    fn rejects_malformed_or_reordered_language_tags() {
        for locale in ["", "EN", "zh-cn", "zh-CN-Hans", "zh-CN-US", "english"] {
            assert!(!valid_locale(locale), "expected {locale} to be invalid");
        }
    }
}

fn valid_date(value: &str) -> bool {
    let parts = value
        .split('-')
        .map(str::parse::<u32>)
        .collect::<Result<Vec<_>, _>>();
    let Ok([year, month, day]) = parts.as_deref() else {
        return false;
    };
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let max_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    (1..=max_day).contains(day)
}

fn numeric_selector(value: &Value) -> Option<String> {
    if let Some(number) = value.as_i64() {
        return Some(number.to_string());
    }
    if let Some(number) = value.as_u64() {
        return Some(number.to_string());
    }
    let text = value.as_str()?.trim();
    let (negative, unsigned) = text
        .strip_prefix('-')
        .map_or((false, text), |rest| (true, rest));
    let parsed = if let Some(hex) = unsigned
        .strip_prefix("0x")
        .or_else(|| unsigned.strip_prefix("0X"))
    {
        u128::from_str_radix(hex, 16).ok()
    } else if let Some(binary) = unsigned
        .strip_prefix("0b")
        .or_else(|| unsigned.strip_prefix("0B"))
    {
        u128::from_str_radix(binary, 2).ok()
    } else if unsigned.chars().all(|c| c.is_ascii_digit()) {
        unsigned.parse::<u128>().ok()
    } else {
        None
    }?;
    Some(if negative {
        format!("-{parsed}")
    } else {
        parsed.to_string()
    })
}

fn selector_key(value: &Value) -> String {
    numeric_selector(value).map_or_else(
        || format!("text:{}", value.as_str().unwrap_or_default().trim()),
        |number| format!("number:{number}"),
    )
}

fn source_values(value: Option<&Value>) -> Vec<Mapping> {
    if let Some(items) = value.and_then(Value::as_sequence) {
        return items
            .iter()
            .filter_map(Value::as_mapping)
            .cloned()
            .collect();
    }
    if let Some(items) = value.and_then(Value::as_mapping) {
        return items
            .iter()
            .map(|(value, description)| {
                let mut item = Mapping::new();
                item.insert(key("value"), value.clone());
                item.insert(key("desc"), description.clone());
                item
            })
            .collect();
    }
    Vec::new()
}

fn condition_matches(candidate: &Mapping, item: &Mapping) -> bool {
    let Some(selector) = get(item, "source_condition").and_then(nonempty_text) else {
        return true;
    };
    get(candidate, "condition").and_then(nonempty_text) == Some(selector)
}

fn validate_value_translations(
    validator: &mut TranslationValidator,
    items_value: Option<&Value>,
    source_value: Option<&Value>,
    path: &str,
) {
    let Some(items) = sequence(validator, items_value, path) else {
        return;
    };
    let available = source_values(source_value);
    let mut seen = HashSet::new();
    for (index, item_value) in items.iter().enumerate() {
        let item_path = format!("{path}[{index}]");
        let before = validator.translated_text_count;
        let Some(item) = mapping(validator, Some(item_value), &item_path) else {
            continue;
        };
        validator.allowed_keys(
            item,
            &["value", "source_condition", "desc", "condition"],
            &item_path,
        );
        let Some(value) = get(item, "value") else {
            validator.error(&format!("{item_path}.value"), "缺少选择器");
            continue;
        };
        if get(item, "source_condition").is_some_and(|value| nonempty_text(value).is_none()) {
            validator.error(
                &format!("{item_path}.source_condition"),
                "必须是非空英文条件",
            );
        }
        let selector = format!(
            "{}@{}",
            selector_key(value),
            get(item, "source_condition")
                .and_then(nonempty_text)
                .unwrap_or_default()
        );
        if !seen.insert(selector) {
            validator.error(&item_path, "枚举选择器重复");
        }
        let candidates = available
            .iter()
            .filter(|candidate| {
                get(candidate, "value")
                    .is_some_and(|source| selector_key(source) == selector_key(value))
                    && condition_matches(candidate, item)
            })
            .collect::<Vec<_>>();
        if candidates.len() != 1 {
            validator.error(
                &item_path,
                if candidates.is_empty() {
                    "英文源中不存在该枚举选择器"
                } else {
                    "枚举选择器不唯一，请添加 source_condition"
                },
            );
            continue;
        }
        validator.translated_text(item, "desc", get(candidates[0], "desc"), &item_path);
        validator.translated_text(
            item,
            "condition",
            get(candidates[0], "condition"),
            &item_path,
        );
        if validator.translated_text_count == before {
            validator.error(&item_path, "没有包含任何译文");
        }
    }
}

fn validate_field_translations(
    validator: &mut TranslationValidator,
    items_value: Option<&Value>,
    source_register: &Mapping,
    path: &str,
) {
    let Some(items) = sequence(validator, items_value, path) else {
        return;
    };
    let fields = get(source_register, "fields")
        .and_then(Value::as_sequence)
        .map_or(&[][..], Vec::as_slice);
    let mut seen = HashSet::new();
    for (index, item_value) in items.iter().enumerate() {
        let item_path = format!("{path}[{index}]");
        let before = validator.translated_text_count;
        let Some(item) = mapping(validator, Some(item_value), &item_path) else {
            continue;
        };
        validator.allowed_keys(
            item,
            &[
                "name",
                "bits",
                "source_condition",
                "desc",
                "condition",
                "reset_info",
                "values",
            ],
            &item_path,
        );
        let Some(name) = required_text(validator, item, "name", &item_path) else {
            continue;
        };
        let Some(bits) = required_text(validator, item, "bits", &item_path) else {
            continue;
        };
        let source_condition = get(item, "source_condition")
            .and_then(nonempty_text)
            .unwrap_or_default();
        if get(item, "source_condition").is_some() && source_condition.is_empty() {
            validator.error(
                &format!("{item_path}.source_condition"),
                "必须是非空英文条件",
            );
        }
        if !seen.insert(format!("{name}@{bits}@{source_condition}")) {
            validator.error(&item_path, "位域选择器重复");
        }
        let candidates = fields
            .iter()
            .filter_map(Value::as_mapping)
            .filter(|field| {
                get(field, "name").and_then(nonempty_text) == Some(name.as_str())
                    && get(field, "bits").and_then(nonempty_text) == Some(bits.as_str())
                    && condition_matches(field, item)
            })
            .collect::<Vec<_>>();
        if candidates.len() != 1 {
            validator.error(
                &item_path,
                if candidates.is_empty() {
                    "英文源中不存在该位域选择器"
                } else {
                    "位域选择器不唯一，请添加 source_condition"
                },
            );
            continue;
        }
        let source = candidates[0];
        validator.translated_text(item, "desc", get(source, "desc"), &item_path);
        validator.translated_text(item, "condition", get(source, "condition"), &item_path);
        validator.translated_text(item, "reset_info", get(source, "reset_info"), &item_path);
        if get(item, "values").is_some() {
            validate_value_translations(
                validator,
                get(item, "values"),
                get(source, "values"),
                &format!("{item_path}.values"),
            );
        }
        if validator.translated_text_count == before {
            validator.error(&item_path, "没有包含任何译文");
        }
    }
}

fn validate_register_translations(
    validator: &mut TranslationValidator,
    items_value: Option<&Value>,
    source_page: &Mapping,
    path: &str,
) {
    let Some(items) = sequence(validator, items_value, path) else {
        return;
    };
    let registers = get(source_page, "registers")
        .and_then(Value::as_sequence)
        .map_or(&[][..], Vec::as_slice);
    let mut seen = HashSet::new();
    for (index, item_value) in items.iter().enumerate() {
        let item_path = format!("{path}[{index}]");
        let before = validator.translated_text_count;
        let Some(item) = mapping(validator, Some(item_value), &item_path) else {
            continue;
        };
        validator.allowed_keys(
            item,
            &[
                "name",
                "desc",
                "condition",
                "alias_note",
                "no_dump_reason",
                "fields",
            ],
            &item_path,
        );
        let Some(name) = required_text(validator, item, "name", &item_path) else {
            continue;
        };
        if !seen.insert(name.clone()) {
            validator.error(&item_path, "寄存器选择器重复");
        }
        let candidates = registers
            .iter()
            .filter_map(Value::as_mapping)
            .filter(|register| get(register, "name").and_then(nonempty_text) == Some(name.as_str()))
            .collect::<Vec<_>>();
        if candidates.len() != 1 {
            validator.error(
                &item_path,
                if candidates.is_empty() {
                    "英文源页面中不存在该寄存器"
                } else {
                    "英文源页面中的寄存器名不唯一"
                },
            );
            continue;
        }
        let source = candidates[0];
        for key in ["desc", "condition", "alias_note", "no_dump_reason"] {
            validator.translated_text(item, key, get(source, key), &item_path);
        }
        if get(item, "fields").is_some() {
            validate_field_translations(
                validator,
                get(item, "fields"),
                source,
                &format!("{item_path}.fields"),
            );
        }
        if validator.translated_text_count == before {
            validator.error(&item_path, "没有包含任何译文");
        }
    }
}

pub(crate) fn sha256_hex(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}

pub(crate) fn is_translation_document(document: &Value) -> bool {
    document
        .as_mapping()
        .and_then(|root| get(root, "format"))
        .and_then(Value::as_str)
        == Some(FORMAT)
}

pub(crate) fn validate_translation_yaml(
    text: &str,
    document: &Value,
    source_text: &str,
    source: &Value,
) -> Result<TranslationSummary, String> {
    validation::validate_browser_yaml_subset(text)?;
    let mut validator = TranslationValidator::new();
    let Some(root) = mapping(&mut validator, Some(document), "file") else {
        return Err(validator.finish().unwrap_err());
    };
    let Some(source_root) = mapping(&mut validator, Some(source), "source") else {
        return Err(validator.finish().unwrap_err());
    };
    validator.allowed_keys(
        root,
        &[
            "translation_schema_version",
            "format",
            "source_locale",
            "locale",
            "source_file",
            "source_sha256",
            "metadata",
            "translations",
        ],
        "file",
    );
    if get(root, "translation_schema_version").and_then(Value::as_u64) != Some(1) {
        validator.error("file.translation_schema_version", "必须为 1");
    }
    if get(root, "format").and_then(Value::as_str) != Some(FORMAT) {
        validator.error("file.format", format!("必须为 {FORMAT}"));
    }
    let source_locale =
        required_text(&mut validator, root, "source_locale", "file").unwrap_or_default();
    let locale = required_text(&mut validator, root, "locale", "file").unwrap_or_default();
    let source_file =
        required_text(&mut validator, root, "source_file", "file").unwrap_or_default();
    let source_sha256 =
        required_text(&mut validator, root, "source_sha256", "file").unwrap_or_default();
    if !source_locale.is_empty() && !valid_locale(&source_locale) {
        validator.error("file.source_locale", "必须是规范语言标签，例如 en");
    }
    if !locale.is_empty() && !valid_locale(&locale) {
        validator.error("file.locale", "必须是规范语言标签，例如 zh-CN");
    }
    if source_locale == locale && !locale.is_empty() {
        validator.error("file.locale", "必须与 source_locale 不同");
    }
    let source_root_name = source_file.split('/').next().unwrap_or_default();
    if !DATA_ROOTS.contains(&source_root_name)
        || source_file.contains("..")
        || source_file.starts_with('/')
    {
        validator.error(
            "file.source_file",
            "必须指向 architecture、controllers、sensors 或 soc 下的寄存器 YAML",
        );
    }
    if source_sha256.len() != 64
        || !source_sha256
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    {
        validator.error("file.source_sha256", "必须是 64 位小写 SHA-256");
    }
    if source_sha256 != sha256_hex(source_text) {
        validator.error("file.source_sha256", "与英文源文件不匹配；请复核并更新译文");
    }

    let mut status = String::new();
    let mut coverage = String::new();
    let mut method = String::new();
    let mut translator_name = String::new();
    let mut updated = String::new();
    if let Some(metadata) = mapping(&mut validator, get(root, "metadata"), "file.metadata") {
        validator.allowed_keys(
            metadata,
            &[
                "status",
                "coverage",
                "method",
                "translator",
                "updated",
                "reviewer",
                "reviewed_at",
                "notes",
            ],
            "file.metadata",
        );
        status =
            required_text(&mut validator, metadata, "status", "file.metadata").unwrap_or_default();
        coverage = required_text(&mut validator, metadata, "coverage", "file.metadata")
            .unwrap_or_default();
        method =
            required_text(&mut validator, metadata, "method", "file.metadata").unwrap_or_default();
        translator_name = required_text(&mut validator, metadata, "translator", "file.metadata")
            .unwrap_or_default();
        updated =
            required_text(&mut validator, metadata, "updated", "file.metadata").unwrap_or_default();
        if !["draft", "reviewed"].contains(&status.as_str()) {
            validator.error("file.metadata.status", "必须为 draft 或 reviewed");
        }
        if !["partial", "complete"].contains(&coverage.as_str()) {
            validator.error("file.metadata.coverage", "必须为 partial 或 complete");
        }
        if !["ai", "human", "ai-assisted"].contains(&method.as_str()) {
            validator.error("file.metadata.method", "必须为 ai、human 或 ai-assisted");
        }
        if !updated.is_empty() && !valid_date(&updated) {
            validator.error("file.metadata.updated", "必须是有效 YYYY-MM-DD 日期");
        }
        if get(metadata, "notes").is_some_and(|value| nonempty_text(value).is_none()) {
            validator.error("file.metadata.notes", "存在时必须是非空字符串");
        }
        if status == "reviewed" {
            required_text(&mut validator, metadata, "reviewer", "file.metadata");
            if let Some(reviewed_at) =
                required_text(&mut validator, metadata, "reviewed_at", "file.metadata")
            {
                if !valid_date(&reviewed_at) {
                    validator.error("file.metadata.reviewed_at", "必须是有效 YYYY-MM-DD 日期");
                }
            }
        }
    }

    if let Some(translations) = mapping(
        &mut validator,
        get(root, "translations"),
        "file.translations",
    ) {
        validator.allowed_keys(
            translations,
            &["sensor", "family", "who_am_i", "pages"],
            "file.translations",
        );
        validator.translated_text(
            translations,
            "sensor",
            get(source_root, "sensor"),
            "file.translations",
        );
        validator.translated_text(
            translations,
            "family",
            get(source_root, "family"),
            "file.translations",
        );
        if let Some(who) = get(translations, "who_am_i") {
            if let Some(who) = mapping(&mut validator, Some(who), "file.translations.who_am_i") {
                validator.allowed_keys(who, &["values"], "file.translations.who_am_i");
                if get(who, "values").is_some() {
                    let source_values = get(source_root, "who_am_i")
                        .and_then(Value::as_mapping)
                        .and_then(|mapping| get(mapping, "values"));
                    validate_value_translations(
                        &mut validator,
                        get(who, "values"),
                        source_values,
                        "file.translations.who_am_i.values",
                    );
                }
            }
        }
        if let Some(page_items) = get(translations, "pages") {
            if let Some(page_items) =
                sequence(&mut validator, Some(page_items), "file.translations.pages")
            {
                let source_pages = get(source_root, "pages").and_then(Value::as_mapping);
                let mut seen = HashSet::new();
                for (index, page_value) in page_items.iter().enumerate() {
                    let page_path = format!("file.translations.pages[{index}]");
                    let before = validator.translated_text_count;
                    let Some(page) = mapping(&mut validator, Some(page_value), &page_path) else {
                        continue;
                    };
                    validator.allowed_keys(
                        page,
                        &["name", "title", "access", "desc", "registers"],
                        &page_path,
                    );
                    let Some(name) = required_text(&mut validator, page, "name", &page_path) else {
                        continue;
                    };
                    if !seen.insert(name.clone()) {
                        validator.error(&page_path, "页面选择器重复");
                    }
                    let Some(source_page) = source_pages
                        .and_then(|pages| pages.get(key(&name)))
                        .and_then(Value::as_mapping)
                    else {
                        validator.error(&page_path, "英文源中不存在该页面");
                        continue;
                    };
                    validator.translated_title(page, &page_path);
                    validator.translated_text(
                        page,
                        "access",
                        get(source_page, "access"),
                        &page_path,
                    );
                    validator.translated_text(page, "desc", get(source_page, "desc"), &page_path);
                    if get(page, "registers").is_some() {
                        validate_register_translations(
                            &mut validator,
                            get(page, "registers"),
                            source_page,
                            &format!("{page_path}.registers"),
                        );
                    }
                    if validator.translated_text_count == before {
                        validator.error(&page_path, "没有包含任何译文");
                    }
                }
            }
        }
    }
    if validator.translated_text_count == 0 {
        validator.error("file.translations", "至少需要一条面向用户的译文");
    }
    validator.finish()?;

    Ok(TranslationSummary {
        source_file,
        source_sha256,
        source_locale,
        locale,
        status,
        coverage,
        method,
        translator: translator_name,
        updated,
    })
}

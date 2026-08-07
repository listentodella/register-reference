use serde_yaml::{Mapping, Value};
use std::collections::{HashMap, HashSet};

const TOP_KEYS: &[&str] = &[
    "schema_version",
    "sensor",
    "vendor",
    "family",
    "device_type",
    "who_am_i",
    "pages",
];
const WHO_KEYS: &[&str] = &["reg", "values"];
const WHO_VALUE_KEYS: &[&str] = &["value", "desc"];
const PAGE_KEYS: &[&str] = &[
    "page_id",
    "address_unit_bits",
    "access",
    "desc",
    "registers",
];
const REGISTER_KEYS: &[&str] = &[
    "addr",
    "name",
    "access",
    "width",
    "bit_width",
    "address_span",
    "byte_order",
    "reset",
    "desc",
    "fields",
    "multi_byte",
    "read_clear",
    "no_dump",
    "no_dump_reason",
    "alias_note",
    "roles",
    "event",
    "target",
    "action_hint",
    "ignore_by_default",
];
const FIELD_KEYS: &[&str] = &[
    "name",
    "bits",
    "access",
    "reset",
    "desc",
    "values",
    "roles",
    "event",
    "target",
    "action_hint",
    "ignore_by_default",
];

#[derive(Default)]
struct Validator {
    errors: Vec<String>,
    warnings: Vec<String>,
}

impl Validator {
    fn error(&mut self, location: &str, message: impl AsRef<str>) {
        self.errors
            .push(format!("{location}: {}", message.as_ref()));
    }

    fn warn(&mut self, location: &str, message: impl AsRef<str>) {
        self.warnings
            .push(format!("{location}: {}", message.as_ref()));
    }

    fn finish(self) -> Result<(), String> {
        if self.errors.is_empty() && self.warnings.is_empty() {
            return Ok(());
        }

        const MAX_DETAILS: usize = 12;
        let error_count = self.errors.len();
        let warning_count = self.warnings.len();
        let mut details = self
            .errors
            .into_iter()
            .map(|message| format!("错误：{message}"))
            .chain(
                self.warnings
                    .into_iter()
                    .map(|message| format!("规范警告：{message}")),
            )
            .take(MAX_DETAILS)
            .collect::<Vec<_>>();
        let omitted = error_count + warning_count - details.len();
        if omitted > 0 {
            details.push(format!("另有 {omitted} 项未显示"));
        }
        Err(format!(
            "YAML 规范校验未通过（{error_count} 个错误，{warning_count} 个警告）\n{}",
            details.join("\n")
        ))
    }
}

fn key(name: &str) -> Value {
    Value::String(name.to_owned())
}

fn get<'a>(mapping: &'a Mapping, name: &str) -> Option<&'a Value> {
    mapping.get(key(name))
}

fn as_nonnegative_integer(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_i64().and_then(|number| number.try_into().ok()))
}

fn require_mapping<'a>(
    validator: &mut Validator,
    value: Option<&'a Value>,
    location: &str,
) -> Option<&'a Mapping> {
    match value.and_then(Value::as_mapping) {
        Some(mapping) => Some(mapping),
        None => {
            validator.error(location, "必须是 mapping/object");
            None
        }
    }
}

fn require_sequence<'a>(
    validator: &mut Validator,
    value: Option<&'a Value>,
    location: &str,
) -> Option<&'a Vec<Value>> {
    match value.and_then(Value::as_sequence) {
        Some(items) => Some(items),
        None => {
            validator.error(location, "必须是 list/array");
            None
        }
    }
}

fn require_string(validator: &mut Validator, value: Option<&Value>, location: &str) -> bool {
    if value
        .and_then(Value::as_str)
        .is_some_and(|text| !text.trim().is_empty())
    {
        true
    } else {
        validator.error(location, "必须是非空字符串");
        false
    }
}

fn warn_unknown_keys(
    validator: &mut Validator,
    mapping: &Mapping,
    allowed: &[&str],
    location: &str,
) {
    for item_key in mapping.keys() {
        let Some(item_key) = item_key.as_str() else {
            validator.warn(
                location,
                format!("未知字段 {item_key:?}，请确认不是拼写错误"),
            );
            continue;
        };
        if !allowed.contains(&item_key) {
            validator.warn(
                location,
                format!("未知字段 {item_key:?}，请确认不是拼写错误"),
            );
        }
    }
}

fn parse_integer(value: &Value) -> Option<i128> {
    if let Some(number) = value.as_i64() {
        return Some(i128::from(number));
    }
    if let Some(number) = value.as_u64() {
        return Some(i128::from(number));
    }
    let text = value.as_str()?.trim();
    let (negative, digits) = text
        .strip_prefix('-')
        .map_or((false, text), |digits| (true, digits));
    let (radix, digits) = if let Some(digits) = digits.strip_prefix("0x") {
        (16, digits)
    } else if let Some(digits) = digits.strip_prefix("0X") {
        (16, digits)
    } else if let Some(digits) = digits.strip_prefix("0b") {
        (2, digits)
    } else if let Some(digits) = digits.strip_prefix("0B") {
        (2, digits)
    } else {
        (10, digits)
    };
    let number = i128::from_str_radix(digits, radix).ok()?;
    Some(if negative { -number } else { number })
}

fn fits_unsigned(value: u64, bit_width: u64) -> bool {
    bit_width >= 64 || value < (1_u64 << bit_width)
}

fn validate_enum_value(
    validator: &mut Validator,
    value: &Value,
    bit_width: u64,
    location: &str,
) -> Option<i128> {
    let Some(parsed) = parse_integer(value) else {
        validator.error(location, "枚举值必须是整数或带 0x/0b 前缀的数字字符串");
        return None;
    };
    if parsed < 0 || (bit_width < 127 && parsed >= (1_i128 << bit_width)) {
        validator.error(
            location,
            format!("枚举值 {value:?} 超出 {bit_width} bit 范围"),
        );
    }
    Some(parsed)
}

fn validate_values(validator: &mut Validator, value: &Value, bit_width: u64, location: &str) {
    if let Some(mapping) = value.as_mapping() {
        for (enum_value, desc) in mapping {
            let value_location = format!("{location}.{enum_value:?}");
            validate_enum_value(validator, enum_value, bit_width, &value_location);
            require_string(validator, Some(desc), &value_location);
        }
        return;
    }

    let Some(items) = require_sequence(validator, Some(value), location) else {
        return;
    };
    let mut seen = HashSet::new();
    for (index, item) in items.iter().enumerate() {
        let item_location = format!("{location}[{index}]");
        let Some(item) = require_mapping(validator, Some(item), &item_location) else {
            continue;
        };
        match get(item, "value") {
            Some(value) => {
                if let Some(parsed) = validate_enum_value(
                    validator,
                    value,
                    bit_width,
                    &format!("{item_location}.value"),
                ) {
                    if !seen.insert(parsed) {
                        validator.warn(&item_location, format!("枚举值 {value:?} 重复"));
                    }
                }
            }
            None => validator.error(&item_location, "缺少 value"),
        }
        if get(item, "desc").is_some() {
            require_string(
                validator,
                get(item, "desc"),
                &format!("{item_location}.desc"),
            );
        } else if get(item, "name").is_some() {
            require_string(
                validator,
                get(item, "name"),
                &format!("{item_location}.name"),
            );
        } else {
            validator.error(&item_location, "缺少 desc 或 name");
        }
    }
}

fn parse_bit_range(value: &str) -> Option<(u64, u64)> {
    let mut parts = value.trim().split(':');
    let hi = parts.next()?.parse::<u64>().ok()?;
    let lo = parts
        .next()
        .map_or(Some(hi), |part| part.parse::<u64>().ok())?;
    if parts.next().is_some() {
        return None;
    }
    Some((hi, lo))
}

fn validate_field(
    validator: &mut Validator,
    value: &Value,
    register_bit_width: u64,
    location: &str,
) -> Option<(u64, u64, Option<u64>)> {
    let field = require_mapping(validator, Some(value), location)?;
    warn_unknown_keys(validator, field, FIELD_KEYS, location);
    require_string(validator, get(field, "name"), &format!("{location}.name"));
    require_string(validator, get(field, "desc"), &format!("{location}.desc"));

    let bits_location = format!("{location}.bits");
    let Some(bits) = get(field, "bits").and_then(Value::as_str) else {
        validator.error(&bits_location, "必须是带引号的字符串，例如 \"7:0\"");
        return None;
    };
    let Some((hi, lo)) = parse_bit_range(bits) else {
        validator.error(&bits_location, "格式必须是 hi:lo 或单个 bit");
        return None;
    };
    if hi < lo {
        validator.error(&bits_location, "最高位 hi 不能小于最低位 lo");
        return None;
    }
    if hi >= register_bit_width {
        validator.error(
            &bits_location,
            format!("bit {hi} 超出寄存器有效位宽 {register_bit_width}"),
        );
        return None;
    }

    if get(field, "access").is_some() {
        require_string(
            validator,
            get(field, "access"),
            &format!("{location}.access"),
        );
    }
    let field_width = hi - lo + 1;
    let reset = get(field, "reset").and_then(as_nonnegative_integer);
    if get(field, "reset").is_some()
        && (reset.is_none() || !fits_unsigned(reset.unwrap_or_default(), field_width))
    {
        validator.error(
            &format!("{location}.reset"),
            format!("必须是 {field_width} bit 范围内的非负整数"),
        );
    }
    if let Some(values) = get(field, "values") {
        validate_values(
            validator,
            values,
            field_width,
            &format!("{location}.values"),
        );
    }
    Some((hi, lo, reset))
}

#[derive(Clone)]
struct RegisterInfo {
    start: u64,
    end: u64,
    has_alias_note: bool,
    location: String,
}

fn validate_register(
    validator: &mut Validator,
    value: &Value,
    page_name: &str,
    index: usize,
) -> Option<(RegisterInfo, String)> {
    let location = format!("pages.{page_name}.registers[{index}]");
    let register = require_mapping(validator, Some(value), &location)?;
    warn_unknown_keys(validator, register, REGISTER_KEYS, &location);

    let address = get(register, "addr").and_then(as_nonnegative_integer);
    if address.is_none() {
        validator.error(&format!("{location}.addr"), "必须是非负整数");
    }
    let name = get(register, "name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    require_string(
        validator,
        get(register, "name"),
        &format!("{location}.name"),
    );
    if require_string(
        validator,
        get(register, "access"),
        &format!("{location}.access"),
    ) {
        let access = get(register, "access").and_then(Value::as_str).unwrap();
        if !matches!(access, "RO" | "RW" | "WO") {
            validator.warn(
                &format!("{location}.access"),
                format!("非常用访问属性 {access:?}，建议使用 RO/RW/WO"),
            );
        }
    }
    require_string(
        validator,
        get(register, "desc"),
        &format!("{location}.desc"),
    );

    let width = get(register, "width").and_then(as_nonnegative_integer);
    let width = match width {
        Some(width) if width >= 1 => width,
        _ => {
            validator.error(&format!("{location}.width"), "必须是正整数字节数");
            1
        }
    };
    let bit_width = match get(register, "bit_width") {
        Some(value) => match as_nonnegative_integer(value) {
            Some(bit_width) if bit_width >= 1 => bit_width,
            _ => {
                validator.error(&format!("{location}.bit_width"), "必须是正整数");
                width.saturating_mul(8)
            }
        },
        None => width.saturating_mul(8),
    };
    if bit_width > width.saturating_mul(8) {
        validator.error(
            &format!("{location}.bit_width"),
            format!(
                "不能超过 width={width} 对应的 {} bit",
                width.saturating_mul(8)
            ),
        );
    }
    let address_span = match get(register, "address_span") {
        Some(value) => match as_nonnegative_integer(value) {
            Some(span) if span >= 1 => span,
            _ => {
                validator.error(&format!("{location}.address_span"), "必须是正整数");
                width
            }
        },
        None => width,
    };

    if let Some(byte_order) = get(register, "byte_order") {
        if !matches!(byte_order.as_str(), Some("little" | "big")) {
            validator.error(&format!("{location}.byte_order"), "必须是 little 或 big");
        }
    }
    let register_reset = get(register, "reset").and_then(as_nonnegative_integer);
    if let Some(reset) = get(register, "reset") {
        if register_reset.is_none() || !fits_unsigned(register_reset.unwrap_or_default(), bit_width)
        {
            validator.error(
                &format!("{location}.reset"),
                format!("必须是 {bit_width} bit 范围内的非负整数"),
            );
        } else if reset.is_string() {
            validator.error(&format!("{location}.reset"), "必须是整数，不能使用字符串");
        }
    }

    if let Some(fields_value) = get(register, "fields") {
        if let Some(fields) =
            require_sequence(validator, Some(fields_value), &format!("{location}.fields"))
        {
            let mut ranges: Vec<(u64, u64, String)> = Vec::new();
            let mut names = HashSet::new();
            let mut reset_mask = 0_u64;
            let mut reset_value = 0_u64;
            for (field_index, field_value) in fields.iter().enumerate() {
                let field_location = format!("{location}.fields[{field_index}]");
                let field_name = field_value
                    .as_mapping()
                    .and_then(|field| get(field, "name"))
                    .and_then(Value::as_str);
                if let Some(field_name) = field_name {
                    if !names.insert(field_name.to_owned()) {
                        validator.warn(
                            &field_location,
                            format!("位域名 {field_name:?} 在同一寄存器内重复"),
                        );
                    }
                }
                if let Some((hi, lo, field_reset)) =
                    validate_field(validator, field_value, bit_width, &field_location)
                {
                    for (other_hi, other_lo, other_location) in &ranges {
                        if lo.max(*other_lo) <= hi.min(*other_hi) {
                            validator
                                .warn(&field_location, format!("位域与 {other_location} 重叠"));
                        }
                    }
                    ranges.push((hi, lo, field_location));
                    if let Some(field_reset) = field_reset.filter(|_| hi < 64) {
                        let field_width = hi - lo + 1;
                        let mask = if field_width == 64 {
                            u64::MAX
                        } else {
                            ((1_u64 << field_width) - 1) << lo
                        };
                        reset_mask |= mask;
                        reset_value = (reset_value & !mask) | (field_reset << lo);
                    }
                }
            }
            if let Some(register_reset) = register_reset {
                let mismatched = (register_reset ^ reset_value) & reset_mask;
                if mismatched != 0 {
                    validator.error(
                        &format!("{location}.reset"),
                        format!("与位域复位值不一致，差异位掩码为 {mismatched:#x}"),
                    );
                }
            }
        }
    }

    let start = address?;
    let Some(end) = start.checked_add(address_span - 1) else {
        validator.error(&format!("{location}.address_span"), "地址范围溢出");
        return None;
    };
    Some((
        RegisterInfo {
            start,
            end,
            has_alias_note: get(register, "alias_note").is_some(),
            location,
        },
        name,
    ))
}

fn validate_who_am_i(validator: &mut Validator, value: &Value) -> Option<u64> {
    let who = require_mapping(validator, Some(value), "who_am_i")?;
    warn_unknown_keys(validator, who, WHO_KEYS, "who_am_i");
    let register = match get(who, "reg") {
        Some(Value::Null) => None,
        Some(value) => match as_nonnegative_integer(value) {
            Some(register) => Some(register),
            None => {
                validator.error("who_am_i.reg", "必须是非负整数或 null");
                None
            }
        },
        None => {
            validator.error("who_am_i.reg", "缺少 reg；未知时应填写 null");
            None
        }
    };
    if let Some(values) = require_sequence(validator, get(who, "values"), "who_am_i.values") {
        let mut seen = HashSet::new();
        for (index, value) in values.iter().enumerate() {
            let location = format!("who_am_i.values[{index}]");
            let Some(value) = require_mapping(validator, Some(value), &location) else {
                continue;
            };
            warn_unknown_keys(validator, value, WHO_VALUE_KEYS, &location);
            match get(value, "value").and_then(as_nonnegative_integer) {
                Some(enum_value) => {
                    if !seen.insert(enum_value) {
                        validator.warn(&location, format!("WHO_AM_I 值 {enum_value:#x} 重复"));
                    }
                }
                None => validator.error(&format!("{location}.value"), "必须是非负整数"),
            }
            require_string(validator, get(value, "desc"), &format!("{location}.desc"));
        }
    }
    register
}

fn strip_comment(line: &str) -> String {
    let mut quote = None;
    let mut escaped = false;
    for (index, character) in line.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if quote == Some('"') && character == '\\' {
            escaped = true;
            continue;
        }
        if matches!(character, '\'' | '"') && quote.is_none() {
            quote = Some(character);
            continue;
        }
        if quote == Some(character) {
            quote = None;
            continue;
        }
        if character == '#' && quote.is_none() {
            return line[..index].trim_end().to_owned();
        }
    }
    line.trim_end().to_owned()
}

fn find_top_level_colon(text: &str) -> Option<usize> {
    let mut quote = None;
    let mut escaped = false;
    let mut depth = 0_i32;
    for (index, character) in text.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if quote == Some('"') && character == '\\' {
            escaped = true;
            continue;
        }
        if matches!(character, '\'' | '"') && quote.is_none() {
            quote = Some(character);
            continue;
        }
        if quote == Some(character) {
            quote = None;
            continue;
        }
        if quote.is_none() {
            match character {
                '[' | '{' => depth += 1,
                ']' | '}' => depth -= 1,
                ':' if depth == 0 => return Some(index),
                _ => {}
            }
        }
    }
    None
}

fn validate_browser_subset(validator: &mut Validator, text: &str) {
    if text.contains('\t') {
        validator.error("file", "包含 Tab；浏览器解析器只接受空格缩进");
    }

    let mut scopes: HashMap<usize, HashSet<String>> = HashMap::new();
    for (line_index, raw_line) in text.lines().enumerate() {
        let line_number = line_index + 1;
        let clean = strip_comment(raw_line);
        let trimmed = clean.trim();
        if trimmed.is_empty() {
            continue;
        }
        if matches!(trimmed, "---" | "...") || trimmed.starts_with('%') {
            validator.error(
                "file",
                format!("第 {line_number} 行使用了浏览器解析器不支持的文档标记或 directive"),
            );
        }
        if trimmed.starts_with("? ") {
            validator.error(
                "file",
                format!("第 {line_number} 行使用了浏览器解析器不支持的复杂 key"),
            );
        }

        let indent = clean.len() - clean.trim_start_matches(' ').len();
        scopes.retain(|scope_indent, _| *scope_indent <= indent);
        let (pair_text, scope_indent, starts_sequence) =
            if let Some(rest) = trimmed.strip_prefix("- ") {
                scopes.retain(|scope_indent, _| *scope_indent <= indent);
                (rest.trim(), indent + 2, true)
            } else {
                (trimmed, indent, false)
            };
        let Some(colon) = find_top_level_colon(pair_text) else {
            let scalar = pair_text.trim();
            if scalar.starts_with(['&', '*', '!']) || scalar.starts_with('{') {
                validator.error(
                    "file",
                    format!("第 {line_number} 行使用了浏览器解析器不支持的 YAML 语法"),
                );
            }
            continue;
        };
        let item_key = pair_text[..colon].trim();
        let scalar = pair_text[colon + 1..].trim();
        if item_key.starts_with(['\'', '"']) {
            validator.error(
                "file",
                format!("第 {line_number} 行使用了浏览器解析器不支持的引号 key"),
            );
        }
        let unsupported_block = scalar.starts_with('|') || scalar.starts_with('>');
        let unsupported_reference = scalar.starts_with(['&', '*', '!']);
        if unsupported_block || unsupported_reference || scalar.starts_with('{') {
            validator.error(
                "file",
                format!("第 {line_number} 行使用了浏览器解析器不支持的 YAML 语法"),
            );
        }

        if starts_sequence {
            scopes.remove(&scope_indent);
        }
        let keys = scopes.entry(scope_indent).or_default();
        if !keys.insert(item_key.to_owned()) {
            validator.error(
                "file",
                format!("第 {line_number} 行存在重复字段 {item_key:?}"),
            );
        }
    }
}

pub(crate) fn validate_register_yaml(text: &str, document: &Value) -> Result<(), String> {
    let mut validator = Validator::default();
    validate_browser_subset(&mut validator, text);

    let Some(root) = require_mapping(&mut validator, Some(document), "root") else {
        return validator.finish();
    };
    warn_unknown_keys(&mut validator, root, TOP_KEYS, "root");
    if let Some(schema_version) = get(root, "schema_version") {
        if as_nonnegative_integer(schema_version).is_none_or(|version| version < 1) {
            validator.error("schema_version", "必须是正整数");
        }
    }
    require_string(&mut validator, get(root, "sensor"), "sensor");
    for metadata_key in ["vendor", "family", "device_type"] {
        if get(root, metadata_key).is_some() {
            require_string(&mut validator, get(root, metadata_key), metadata_key);
        }
    }

    let who_register = match get(root, "who_am_i") {
        Some(value) => validate_who_am_i(&mut validator, value),
        None => {
            validator.warn(
                "root",
                "缺少 who_am_i；未知时也应显式写 reg: null 和 values: []",
            );
            None
        }
    };

    let Some(pages) = require_mapping(&mut validator, get(root, "pages"), "pages") else {
        return validator.finish();
    };
    if pages.is_empty() {
        validator.error("pages", "至少需要一个页面");
        return validator.finish();
    }

    let mut page_ids = HashMap::new();
    let mut register_ranges = Vec::new();
    for (page_name_value, page_value) in pages {
        let page_name = page_name_value.as_str().unwrap_or_default();
        if page_name.trim().is_empty() {
            validator.error("pages", "页面名必须是非空字符串");
        }
        let page_location = format!("pages.{page_name}");
        let Some(page) = require_mapping(&mut validator, Some(page_value), &page_location) else {
            continue;
        };
        warn_unknown_keys(&mut validator, page, PAGE_KEYS, &page_location);
        match get(page, "page_id").and_then(as_nonnegative_integer) {
            Some(page_id) => {
                if let Some(previous_page) = page_ids.insert(page_id, page_name.to_owned()) {
                    validator.warn(
                        &format!("{page_location}.page_id"),
                        format!("与页面 {previous_page:?} 使用相同 page_id"),
                    );
                }
            }
            None => validator.error(&format!("{page_location}.page_id"), "必须是非负整数"),
        }
        require_string(
            &mut validator,
            get(page, "access"),
            &format!("{page_location}.access"),
        );
        require_string(
            &mut validator,
            get(page, "desc"),
            &format!("{page_location}.desc"),
        );
        if let Some(address_unit_bits) = get(page, "address_unit_bits") {
            if as_nonnegative_integer(address_unit_bits).is_none_or(|value| value < 1) {
                validator.error(
                    &format!("{page_location}.address_unit_bits"),
                    "必须是正整数",
                );
            }
        }

        let Some(registers) = require_sequence(
            &mut validator,
            get(page, "registers"),
            &format!("{page_location}.registers"),
        ) else {
            continue;
        };
        let mut page_registers: Vec<RegisterInfo> = Vec::new();
        let mut names = HashSet::new();
        let mut previous_address = None;
        for (index, register) in registers.iter().enumerate() {
            let Some((register, name)) =
                validate_register(&mut validator, register, page_name, index)
            else {
                continue;
            };
            if !name.is_empty() && !names.insert(name.clone()) {
                validator.warn(
                    &register.location,
                    format!("寄存器名 {name:?} 在页面内重复"),
                );
            }
            let overlaps = page_registers
                .iter()
                .any(|other| register.start.max(other.start) <= register.end.min(other.end));
            if previous_address.is_some_and(|previous| register.start < previous) && !overlaps {
                validator.warn(&register.location, "地址小于前一条目；建议按地址递增排列");
            }
            previous_address = Some(register.start);
            for other in &page_registers {
                if register.start.max(other.start) <= register.end.min(other.end)
                    && !register.has_alias_note
                    && !other.has_alias_note
                {
                    validator.warn(
                        &register.location,
                        format!("地址范围与 {} 重叠但双方都没有 alias_note", other.location),
                    );
                }
            }
            register_ranges.push((register.start, register.end));
            page_registers.push(register);
        }
    }

    if let Some(who_register) = who_register {
        if !register_ranges
            .iter()
            .any(|(start, end)| *start <= who_register && who_register <= *end)
        {
            validator.warn("who_am_i.reg", "没有匹配到任何页面中的寄存器地址");
        }
    }
    validator.finish()
}

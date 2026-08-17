use serde_yaml::{Mapping, Value};
use std::collections::{HashMap, HashSet};

const TOP_KEYS: &[&str] = &[
    "schema_version",
    "sensor",
    "vendor",
    "family",
    "device_type",
    "register_space",
    "source",
    "who_am_i",
    "pages",
];
const REGISTER_SPACE_KEYS: &[&str] = &["kind", "architecture", "profile"];
const SOURCE_KEYS: &[&str] = &[
    "title", "version", "revision", "document", "url", "license", "notice",
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
    "encoding",
    "accessors",
    "execution_state",
    "condition",
    "groups",
    "aliases",
    "variables",
    "source_ref",
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
    "condition",
    "reserved",
    "reset_info",
    "access_rules",
    "variable_length",
];
const ENCODING_KEYS: &[&str] = &[
    "scheme", "op0", "op1", "crn", "crm", "crd", "op2", "coproc", "opc1", "opc2", "r", "m", "m1",
    "reg", "selector",
];
const ACCESSOR_KEYS: &[&str] = &["name", "kind", "instruction", "condition", "encoding"];
const VARIABLE_KEYS: &[&str] = &["name", "min", "max", "values"];
const ACCESS_RULE_KEYS: &[&str] = &["access", "condition"];
const ENUM_VALUE_KEYS: &[&str] = &["value", "desc", "name", "condition"];
const SYSTEM_ENCODING_SCHEMES: &[&str] = &[
    "aarch64_sysreg",
    "aarch64_special",
    "aarch32_cp15",
    "aarch32_coproc",
    "aarch32_special",
    "aarch32_vfp",
    "m_profile_special",
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

fn parse_integer(value: &Value) -> Option<(bool, u128)> {
    if let Some(number) = value.as_i64() {
        return Some((number.is_negative(), u128::from(number.unsigned_abs())));
    }
    if let Some(number) = value.as_u64() {
        return Some((false, u128::from(number)));
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
    let number = u128::from_str_radix(digits, radix).ok()?;
    Some((negative, number))
}

fn parse_unsigned_integer(value: &Value) -> Option<u128> {
    parse_integer(value).and_then(|(negative, number)| (!negative).then_some(number))
}

fn fits_unsigned(value: u128, bit_width: u64) -> bool {
    bit_width >= 128 || value < (1_u128 << bit_width)
}

fn validate_enum_value(
    validator: &mut Validator,
    value: &Value,
    bit_width: u64,
    location: &str,
) -> Option<String> {
    if let Some((negative, parsed)) = parse_integer(value) {
        if negative || !fits_unsigned(parsed, bit_width) {
            validator.error(
                location,
                format!("枚举值 {value:?} 超出 {bit_width} bit 范围"),
            );
        }
        return Some(format!("exact:{}{parsed}", if negative { "-" } else { "" }));
    }
    if let Some(text) = value.as_str().map(str::trim) {
        if let Some(pattern) = text
            .strip_prefix("0b")
            .or_else(|| text.strip_prefix("0B"))
            .filter(|pattern| {
                pattern
                    .chars()
                    .all(|character| matches!(character, '0' | '1' | 'x' | 'X'))
                    && pattern
                        .chars()
                        .any(|character| matches!(character, 'x' | 'X'))
            })
        {
            if pattern.len() as u64 > bit_width {
                validator.error(
                    location,
                    format!("枚举模式 {value:?} 超出 {bit_width} bit 范围"),
                );
            }
            return Some(format!("pattern:{}", pattern.to_ascii_lowercase()));
        }
        if let Some((from, to)) = text.split_once("..") {
            let from_value = parse_unsigned_integer(&Value::String(from.trim().to_owned()));
            let to_value = parse_unsigned_integer(&Value::String(to.trim().to_owned()));
            if let (Some(from_value), Some(to_value)) = (from_value, to_value) {
                if from_value <= to_value {
                    if !fits_unsigned(to_value, bit_width) {
                        validator.error(
                            location,
                            format!("枚举值 {value:?} 超出 {bit_width} bit 范围"),
                        );
                    }
                    return Some(format!("range:{from_value}:{to_value}"));
                }
            }
            validator.error(location, "枚举区间必须是由 .. 连接的递增非负整数");
            return None;
        }
    }
    validator.error(
        location,
        "枚举值必须是整数、数字字符串、二进制通配模式或数值区间",
    );
    None
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
        warn_unknown_keys(validator, item, ENUM_VALUE_KEYS, &item_location);
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
        if get(item, "condition").is_some() {
            require_string(
                validator,
                get(item, "condition"),
                &format!("{item_location}.condition"),
            );
        }
    }
}

fn parse_bit_ranges(
    validator: &mut Validator,
    value: Option<&Value>,
    register_bit_width: u64,
    location: &str,
) -> Option<Vec<(u64, u64)>> {
    let Some(value) = value.and_then(Value::as_str) else {
        validator.error(
            location,
            "必须是带引号的字符串，例如 \"7:0\" 或 \"87:80,47:5\"",
        );
        return None;
    };
    let mut ranges = Vec::new();
    for token in value.split(',') {
        let mut parts = token.trim().split(':');
        let Some(hi) = parts.next().and_then(|part| part.parse::<u64>().ok()) else {
            validator.error(
                location,
                "格式必须是 hi:lo、单个 bit，或由逗号分隔的多个范围",
            );
            return None;
        };
        let Some(lo) = parts
            .next()
            .map_or(Some(hi), |part| part.parse::<u64>().ok())
        else {
            validator.error(
                location,
                "格式必须是 hi:lo、单个 bit，或由逗号分隔的多个范围",
            );
            return None;
        };
        if parts.next().is_some() {
            validator.error(
                location,
                "格式必须是 hi:lo、单个 bit，或由逗号分隔的多个范围",
            );
            return None;
        }
        if hi < lo {
            validator.error(location, "最高位 hi 不能小于最低位 lo");
            return None;
        }
        if hi >= register_bit_width {
            validator.error(
                location,
                format!("bit {hi} 超出寄存器有效位宽 {register_bit_width}"),
            );
            return None;
        }
        if ranges
            .iter()
            .any(|(other_hi, other_lo)| lo.max(*other_lo) <= hi.min(*other_hi))
        {
            validator.error(location, "同一位域的多个 bit 范围不能互相重叠");
            return None;
        }
        ranges.push((hi, lo));
    }
    (!ranges.is_empty()).then_some(ranges)
}

fn validate_encoding(validator: &mut Validator, value: Option<&Value>, location: &str) {
    let Some(encoding) = require_mapping(validator, value, location) else {
        return;
    };
    warn_unknown_keys(validator, encoding, ENCODING_KEYS, location);
    if get(encoding, "scheme")
        .and_then(Value::as_str)
        .is_none_or(|scheme| !SYSTEM_ENCODING_SCHEMES.contains(&scheme))
    {
        validator.error(
            &format!("{location}.scheme"),
            format!("必须是 {} 之一", SYSTEM_ENCODING_SCHEMES.join("、")),
        );
    }
    let mut field_count = 0;
    for (field_key, field_value) in encoding {
        if field_key.as_str() == Some("scheme") {
            continue;
        }
        field_count += 1;
        let valid_integer = as_nonnegative_integer(field_value).is_some();
        let valid_expression = field_value
            .as_str()
            .is_some_and(|text| !text.trim().is_empty());
        if !valid_integer && !valid_expression {
            validator.error(
                &format!("{location}.{}", field_key.as_str().unwrap_or("?")),
                "必须是非负整数或非空编码表达式",
            );
        }
    }
    if field_count == 0 {
        validator.error(location, "至少需要一个编码字段");
    }
}

fn validate_accessors(validator: &mut Validator, value: Option<&Value>, location: &str) {
    let Some(accessors) = require_sequence(validator, value, location) else {
        return;
    };
    if accessors.is_empty() {
        validator.error(location, "至少需要一个访问方式");
    }
    for (index, item) in accessors.iter().enumerate() {
        let item_location = format!("{location}[{index}]");
        let Some(accessor) = require_mapping(validator, Some(item), &item_location) else {
            continue;
        };
        warn_unknown_keys(validator, accessor, ACCESSOR_KEYS, &item_location);
        require_string(
            validator,
            get(accessor, "name"),
            &format!("{item_location}.name"),
        );
        if require_string(
            validator,
            get(accessor, "kind"),
            &format!("{item_location}.kind"),
        ) && !matches!(
            get(accessor, "kind").and_then(Value::as_str),
            Some("read" | "write" | "implicit")
        ) {
            validator.error(
                &format!("{item_location}.kind"),
                "必须是 read、write 或 implicit",
            );
        }
        require_string(
            validator,
            get(accessor, "instruction"),
            &format!("{item_location}.instruction"),
        );
        if get(accessor, "condition").is_some() {
            require_string(
                validator,
                get(accessor, "condition"),
                &format!("{item_location}.condition"),
            );
        }
        validate_encoding(
            validator,
            get(accessor, "encoding"),
            &format!("{item_location}.encoding"),
        );
    }
}

fn validate_variables(validator: &mut Validator, value: &Value, location: &str) {
    let Some(variables) = require_sequence(validator, Some(value), location) else {
        return;
    };
    for (index, item) in variables.iter().enumerate() {
        let item_location = format!("{location}[{index}]");
        let Some(variable) = require_mapping(validator, Some(item), &item_location) else {
            continue;
        };
        warn_unknown_keys(validator, variable, VARIABLE_KEYS, &item_location);
        require_string(
            validator,
            get(variable, "name"),
            &format!("{item_location}.name"),
        );
        for bound in ["min", "max"] {
            if get(variable, bound)
                .is_some_and(|item| item.as_i64().is_none() && item.as_u64().is_none())
            {
                validator.error(&format!("{item_location}.{bound}"), "必须是整数");
            }
        }
        if let Some(values) = get(variable, "values") {
            if let Some(values) =
                require_sequence(validator, Some(values), &format!("{item_location}.values"))
            {
                for (value_index, item) in values.iter().enumerate() {
                    let valid = item.as_i64().is_some()
                        || item.as_u64().is_some()
                        || item.as_str().is_some_and(|text| !text.trim().is_empty());
                    if !valid {
                        validator.error(
                            &format!("{item_location}.values[{value_index}]"),
                            "必须是整数或非空字符串",
                        );
                    }
                }
            }
        }
    }
}

fn validate_access_rules(validator: &mut Validator, value: &Value, location: &str) {
    let Some(rules) = require_sequence(validator, Some(value), location) else {
        return;
    };
    for (index, item) in rules.iter().enumerate() {
        let item_location = format!("{location}[{index}]");
        let Some(rule) = require_mapping(validator, Some(item), &item_location) else {
            continue;
        };
        warn_unknown_keys(validator, rule, ACCESS_RULE_KEYS, &item_location);
        require_string(
            validator,
            get(rule, "access"),
            &format!("{item_location}.access"),
        );
        if get(rule, "condition").is_some() {
            require_string(
                validator,
                get(rule, "condition"),
                &format!("{item_location}.condition"),
            );
        }
    }
}

struct FieldInfo {
    ranges: Vec<(u64, u64)>,
    reset: Option<u128>,
    condition: String,
}

fn validate_field(
    validator: &mut Validator,
    value: &Value,
    register_bit_width: u64,
    location: &str,
) -> Option<FieldInfo> {
    let field = require_mapping(validator, Some(value), location)?;
    warn_unknown_keys(validator, field, FIELD_KEYS, location);
    require_string(validator, get(field, "name"), &format!("{location}.name"));
    require_string(validator, get(field, "desc"), &format!("{location}.desc"));

    let bits_location = format!("{location}.bits");
    let ranges = parse_bit_ranges(
        validator,
        get(field, "bits"),
        register_bit_width,
        &bits_location,
    )?;

    if get(field, "access").is_some() {
        require_string(
            validator,
            get(field, "access"),
            &format!("{location}.access"),
        );
    }
    if get(field, "condition").is_some() {
        require_string(
            validator,
            get(field, "condition"),
            &format!("{location}.condition"),
        );
    }
    if get(field, "reserved").is_some() {
        require_string(
            validator,
            get(field, "reserved"),
            &format!("{location}.reserved"),
        );
    }
    if get(field, "reset_info").is_some() {
        require_string(
            validator,
            get(field, "reset_info"),
            &format!("{location}.reset_info"),
        );
    }
    if get(field, "variable_length").is_some_and(|value| !value.is_bool()) {
        validator.error(&format!("{location}.variable_length"), "必须是布尔值");
    }
    if let Some(access_rules) = get(field, "access_rules") {
        validate_access_rules(validator, access_rules, &format!("{location}.access_rules"));
    }
    let field_width: u64 = ranges.iter().map(|(hi, lo)| hi - lo + 1).sum();
    let reset = get(field, "reset").and_then(parse_unsigned_integer);
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
    Some(FieldInfo {
        ranges,
        reset,
        condition: get(field, "condition")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_owned(),
    })
}

#[derive(Clone)]
struct RegisterInfo {
    start: u64,
    end: u64,
    has_alias_note: bool,
    location: String,
}

struct FieldInfoWithLocation {
    ranges: Vec<(u64, u64)>,
    condition: String,
    location: String,
}

fn validate_register(
    validator: &mut Validator,
    value: &Value,
    page_name: &str,
    index: usize,
    is_system: bool,
    allows_system_mmio: bool,
) -> Option<(RegisterInfo, String)> {
    let location = format!("pages.{page_name}.registers[{index}]");
    let register = require_mapping(validator, Some(value), &location)?;
    warn_unknown_keys(validator, register, REGISTER_KEYS, &location);

    let address = get(register, "addr").and_then(as_nonnegative_integer);
    let is_system_mmio = is_system && allows_system_mmio && address.is_some();
    if is_system {
        if get(register, "addr").is_some() && !allows_system_mmio {
            validator.error(
                &format!("{location}.addr"),
                "A-profile arm_system 寄存器不能使用 MMIO 地址",
            );
        }
        if get(register, "addr").is_some() && allows_system_mmio && !is_system_mmio {
            validator.error(
                &format!("{location}.addr"),
                "M-profile MMIO 地址必须是非负整数",
            );
        }
        if !is_system_mmio {
            validate_encoding(
                validator,
                get(register, "encoding"),
                &format!("{location}.encoding"),
            );
            validate_accessors(
                validator,
                get(register, "accessors"),
                &format!("{location}.accessors"),
            );
        }
        if get(register, "execution_state").is_some() {
            require_string(
                validator,
                get(register, "execution_state"),
                &format!("{location}.execution_state"),
            );
        }
        if get(register, "condition").is_some() {
            require_string(
                validator,
                get(register, "condition"),
                &format!("{location}.condition"),
            );
        }
        for list_key in ["groups", "aliases"] {
            if let Some(values) = get(register, list_key) {
                if let Some(values) =
                    require_sequence(validator, Some(values), &format!("{location}.{list_key}"))
                {
                    for (value_index, item) in values.iter().enumerate() {
                        require_string(
                            validator,
                            Some(item),
                            &format!("{location}.{list_key}[{value_index}]"),
                        );
                    }
                }
            }
        }
        if let Some(variables) = get(register, "variables") {
            validate_variables(validator, variables, &format!("{location}.variables"));
        }
        if get(register, "source_ref").is_some() {
            require_string(
                validator,
                get(register, "source_ref"),
                &format!("{location}.source_ref"),
            );
        }
    } else if address.is_none() {
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
    if is_system && !is_system_mmio && get(register, "address_span").is_some() {
        validator.error(
            &format!("{location}.address_span"),
            "非 MMIO arm_system 寄存器不能声明地址跨度",
        );
    }

    if is_system && !is_system_mmio && get(register, "byte_order").is_some() {
        validator.error(
            &format!("{location}.byte_order"),
            "非 MMIO arm_system 寄存器不能声明字节序",
        );
    }
    if let Some(byte_order) = get(register, "byte_order") {
        if !matches!(byte_order.as_str(), Some("little" | "big")) {
            validator.error(&format!("{location}.byte_order"), "必须是 little 或 big");
        }
    }
    let register_reset = get(register, "reset").and_then(parse_unsigned_integer);
    if get(register, "reset").is_some()
        && (register_reset.is_none()
            || !fits_unsigned(register_reset.unwrap_or_default(), bit_width))
    {
        validator.error(
            &format!("{location}.reset"),
            format!("必须是 {bit_width} bit 范围内的非负整数"),
        );
    }

    if let Some(fields_value) = get(register, "fields") {
        if let Some(fields) =
            require_sequence(validator, Some(fields_value), &format!("{location}.fields"))
        {
            let mut ranges: Vec<FieldInfoWithLocation> = Vec::new();
            let mut names = HashSet::new();
            let mut reset_mask = 0_u128;
            let mut reset_value = 0_u128;
            for (field_index, field_value) in fields.iter().enumerate() {
                let field_location = format!("{location}.fields[{field_index}]");
                let field_name = field_value
                    .as_mapping()
                    .and_then(|field| get(field, "name"))
                    .and_then(Value::as_str);
                let is_reserved = field_value
                    .as_mapping()
                    .is_some_and(|field| get(field, "reserved").is_some());
                if let Some(field_name) = field_name
                    .filter(|name| !is_reserved && !name.to_ascii_uppercase().starts_with("RES"))
                {
                    let condition = field_value
                        .as_mapping()
                        .and_then(|field| get(field, "condition"))
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .trim();
                    let name_key = format!("{field_name}\0{condition}");
                    if !names.insert(name_key) {
                        validator.warn(
                            &field_location,
                            format!("位域名 {field_name:?} 在相同条件下重复"),
                        );
                    }
                }
                if let Some(field_info) =
                    validate_field(validator, field_value, bit_width, &field_location)
                {
                    for other in &ranges {
                        let overlaps = field_info.ranges.iter().any(|(hi, lo)| {
                            other
                                .ranges
                                .iter()
                                .any(|(other_hi, other_lo)| *lo.max(other_lo) <= *hi.min(other_hi))
                        });
                        if overlaps && field_info.condition.is_empty() && other.condition.is_empty()
                        {
                            validator
                                .warn(&field_location, format!("位域与 {} 重叠", other.location));
                        }
                    }
                    ranges.push(FieldInfoWithLocation {
                        ranges: field_info.ranges.clone(),
                        condition: field_info.condition.clone(),
                        location: field_location,
                    });
                    if let Some(field_reset) = field_info.reset {
                        let mut remaining = field_reset;
                        for (hi, lo) in field_info.ranges.iter().rev() {
                            let field_width = hi - lo + 1;
                            if *lo >= 128 || field_width > 128 - *lo {
                                remaining = 0;
                                continue;
                            }
                            let value_mask = if field_width == 128 {
                                u128::MAX
                            } else {
                                (1_u128 << field_width) - 1
                            };
                            let mask = value_mask << lo;
                            reset_mask |= mask;
                            reset_value = (reset_value & !mask) | ((remaining & value_mask) << lo);
                            remaining = if field_width == 128 {
                                0
                            } else {
                                remaining >> field_width
                            };
                        }
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

    if is_system {
        return Some((
            RegisterInfo {
                start: 0,
                end: 0,
                has_alias_note: get(register, "alias_note").is_some(),
                location,
            },
            name,
        ));
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

    let mut register_space_kind = "mmio";
    if let Some(register_space) = get(root, "register_space") {
        if let Some(register_space) =
            require_mapping(&mut validator, Some(register_space), "register_space")
        {
            warn_unknown_keys(
                &mut validator,
                register_space,
                REGISTER_SPACE_KEYS,
                "register_space",
            );
            if require_string(
                &mut validator,
                get(register_space, "kind"),
                "register_space.kind",
            ) {
                match get(register_space, "kind").and_then(Value::as_str) {
                    Some("mmio") => register_space_kind = "mmio",
                    Some("arm_system") => register_space_kind = "arm_system",
                    _ => validator.error("register_space.kind", "必须是 mmio 或 arm_system"),
                }
            }
            for key in ["architecture", "profile"] {
                if get(register_space, key).is_some() {
                    require_string(
                        &mut validator,
                        get(register_space, key),
                        &format!("register_space.{key}"),
                    );
                }
            }
        }
    }
    let is_system = register_space_kind == "arm_system";
    let allows_system_mmio = is_system
        && get(root, "register_space")
            .and_then(Value::as_mapping)
            .and_then(|space| get(space, "profile"))
            .and_then(Value::as_str)
            == Some("M");
    if is_system
        && get(root, "schema_version")
            .and_then(as_nonnegative_integer)
            .is_none_or(|version| version < 2)
    {
        validator.error(
            "schema_version",
            "arm_system 需要 schema_version: 2 或更高版本",
        );
    }
    if let Some(source) = get(root, "source") {
        if let Some(source) = require_mapping(&mut validator, Some(source), "source") {
            warn_unknown_keys(&mut validator, source, SOURCE_KEYS, "source");
            for (key, value) in source {
                require_string(
                    &mut validator,
                    Some(value),
                    &format!("source.{}", key.as_str().unwrap_or("?")),
                );
            }
        }
    } else if is_system {
        validator.error("source", "arm_system 数据必须记录官方来源和版本");
    }

    let who_register = match get(root, "who_am_i") {
        Some(_value) if is_system => {
            validator.error("who_am_i", "arm_system 数据不使用 MMIO WHO_AM_I");
            None
        }
        Some(value) => validate_who_am_i(&mut validator, value),
        None if is_system => None,
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
        if is_system && get(page, "page_id").is_some() {
            validator.error(
                &format!("{page_location}.page_id"),
                "arm_system 分类页不能使用 MMIO page_id",
            );
        } else if is_system {
            // System-register pages are named categories, not address pages.
        } else {
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
            let Some((register, name)) = validate_register(
                &mut validator,
                register,
                page_name,
                index,
                is_system,
                allows_system_mmio,
            ) else {
                continue;
            };
            if !name.is_empty() && !names.insert(name.clone()) {
                validator.warn(
                    &register.location,
                    format!("寄存器名 {name:?} 在页面内重复"),
                );
            }
            if is_system {
                continue;
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

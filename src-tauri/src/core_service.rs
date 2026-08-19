//! Read-only domain DTOs shared by the desktop commands and future frontends.
//!
//! This module deliberately accepts parsed YAML values instead of exposing
//! SQLite rows. It is the boundary that a CLI or a future MCP adapter can
//! reuse without gaining write access to the database.

use serde::Serialize;
use serde_yaml::{Mapping, Value};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SourceMetadata {
    pub source_name: String,
    pub source_path: Option<String>,
    pub source_sha256: String,
    pub source_title: String,
    pub source_version: String,
    pub source_document: String,
    pub imported_at: String,
    pub updated_at: String,
    pub translation_locales: Vec<String>,
    pub translation_present: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChipDetails {
    pub sensor: String,
    pub vendor: String,
    pub family: String,
    pub device_type: String,
    pub pages: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EnumDetails {
    pub value: String,
    pub name: String,
    pub description: String,
    pub condition: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AccessRuleDetails {
    pub access: String,
    pub condition: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AccessorDetails {
    pub name: String,
    pub kind: String,
    pub instruction: String,
    pub condition: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FieldDetails {
    pub name: String,
    pub bits: String,
    pub access: String,
    pub reset: String,
    pub reset_info: String,
    pub reserved: String,
    pub description: String,
    pub condition: String,
    pub inferred: bool,
    pub access_rules: Vec<AccessRuleDetails>,
    pub enums: Vec<EnumDetails>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DecodedField {
    pub name: String,
    pub bits: String,
    pub value_hex: String,
    pub value_dec: String,
    pub enum_description: String,
    pub enum_status: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DecodedRegisterValue {
    pub bit_width: u16,
    pub value_hex: String,
    pub value_bin: String,
    pub clipped: bool,
    pub fields: Vec<DecodedField>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RegisterDetails {
    pub page_name: String,
    pub register_index: usize,
    pub name: String,
    pub locator: String,
    pub access: String,
    pub bit_width: u16,
    pub reset: String,
    pub description: String,
    pub condition: String,
    pub execution_state: String,
    pub alias_note: String,
    pub no_dump_reason: String,
    pub aliases: Vec<String>,
    pub accessors: Vec<AccessorDetails>,
    pub fields: Vec<FieldDetails>,
}

#[cfg(any(feature = "mcp", test))]
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RegisterStructureComparison {
    pub equal: bool,
    pub changed_properties: Vec<String>,
    pub added_fields: Vec<String>,
    pub removed_fields: Vec<String>,
    pub modified_fields: Vec<String>,
    pub added_enums: Vec<String>,
    pub removed_enums: Vec<String>,
    pub modified_enums: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RegisterComparison {
    pub added_registers: Vec<String>,
    pub removed_registers: Vec<String>,
    pub modified_registers: Vec<String>,
    pub added_fields: Vec<String>,
    pub removed_fields: Vec<String>,
    pub modified_fields: Vec<String>,
    pub added_enums: Vec<String>,
    pub removed_enums: Vec<String>,
    pub modified_enums: Vec<String>,
}

fn key(name: &str) -> Value {
    Value::String(name.to_owned())
}

fn get<'a>(mapping: &'a Mapping, name: &str) -> Option<&'a Value> {
    mapping.get(key(name))
}

fn text(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(value)) => value.clone(),
        Some(Value::Number(value)) => value.to_string(),
        Some(Value::Bool(value)) => value.to_string(),
        _ => String::new(),
    }
}

fn sequence(value: Option<&Value>) -> &[Value] {
    value
        .and_then(Value::as_sequence)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

fn string_list(value: Option<&Value>) -> Vec<String> {
    sequence(value)
        .iter()
        .map(|item| text(Some(item)))
        .filter(|item| !item.is_empty())
        .collect()
}

fn mapping(value: Option<&Value>) -> Option<&Mapping> {
    value.and_then(Value::as_mapping)
}

fn locator(register: &Mapping) -> String {
    if let Some(addr) = get(register, "addr") {
        let value = text(Some(addr));
        if let Ok(number) = value.parse::<u128>() {
            return format!("0x{number:X}");
        }
        return value;
    }
    let Some(encoding) = mapping(get(register, "encoding")) else {
        return String::new();
    };
    if let Some(address) = get(encoding, "address") {
        let value = text(Some(address));
        if let Some(number) = parse_numeric(&value) {
            return format!("CSR 0x{number:X}");
        }
    }
    let mut parts = Vec::new();
    for (name, value) in encoding {
        let name = text(Some(name));
        if name != "scheme" {
            parts.push(format!("{name}={}", text(Some(value))));
        }
    }
    parts.join(", ")
}

fn bit_width(register: &Mapping) -> u16 {
    text(get(register, "bit_width"))
        .parse::<u16>()
        .ok()
        .or_else(|| {
            text(get(register, "width"))
                .parse::<u16>()
                .ok()
                .map(|bytes| bytes.saturating_mul(8))
        })
        .unwrap_or(8)
        .max(1)
}

fn enum_details(value: Option<&Value>) -> Vec<EnumDetails> {
    match value {
        Some(Value::Mapping(values)) => values
            .iter()
            .map(|(value, description)| EnumDetails {
                value: text(Some(value)),
                name: String::new(),
                description: text(Some(description)),
                condition: String::new(),
            })
            .collect(),
        Some(Value::Sequence(values)) => values
            .iter()
            .filter_map(Value::as_mapping)
            .map(|item| EnumDetails {
                value: text(get(item, "value")),
                name: text(get(item, "name")),
                description: text(get(item, "desc")),
                condition: text(get(item, "condition")),
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn parse_numeric(value: &str) -> Option<u128> {
    let value = value.trim().replace('_', "");
    if let Some((_, encoded)) = value.split_once('\'') {
        let mut chars = encoded.chars();
        let radix = match chars.next()?.to_ascii_lowercase() {
            'b' => 2,
            'o' => 8,
            'd' => 10,
            'h' => 16,
            _ => return None,
        };
        let digits = chars.as_str();
        if digits
            .chars()
            .any(|digit| matches!(digit, 'x' | 'X' | 'z' | 'Z' | '?'))
        {
            return None;
        }
        return u128::from_str_radix(digits, radix).ok();
    }
    if let Some(value) = value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
    {
        u128::from_str_radix(value, 16).ok()
    } else if let Some(value) = value
        .strip_prefix("0b")
        .or_else(|| value.strip_prefix("0B"))
    {
        u128::from_str_radix(value, 2).ok()
    } else {
        value.parse::<u128>().ok()
    }
}

fn field_details(field: &Mapping) -> FieldDetails {
    let inferred = matches!(get(field, "inferred"), Some(Value::Bool(true)))
        || text(get(field, "provenance")).eq_ignore_ascii_case("inferred");
    FieldDetails {
        name: text(get(field, "name")),
        bits: text(get(field, "bits")),
        access: text(get(field, "access")),
        reset: text(get(field, "reset")),
        reset_info: text(get(field, "reset_info")),
        reserved: text(get(field, "reserved")),
        description: text(get(field, "desc")),
        condition: text(get(field, "condition")),
        inferred,
        access_rules: sequence(get(field, "access_rules"))
            .iter()
            .filter_map(Value::as_mapping)
            .map(|rule| AccessRuleDetails {
                access: text(get(rule, "access")),
                condition: text(get(rule, "condition")),
            })
            .collect(),
        enums: enum_details(get(field, "values")),
    }
}

pub(crate) fn get_chip(document: &Value) -> Option<ChipDetails> {
    let root = document.as_mapping()?;
    let pages = mapping(get(root, "pages"))?;
    Some(ChipDetails {
        sensor: text(get(root, "sensor")),
        vendor: text(get(root, "vendor")),
        family: text(get(root, "family")),
        device_type: text(get(root, "device_type")),
        pages: pages.keys().map(|name| text(Some(name))).collect(),
    })
}

pub(crate) fn get_register(
    document: &Value,
    page_name: &str,
    register_index: usize,
) -> Option<RegisterDetails> {
    let pages = mapping(document.as_mapping()?.get(key("pages")))?;
    let page = mapping(pages.get(key(page_name)))?;
    let register = sequence(get(page, "registers"))
        .get(register_index)?
        .as_mapping()?;
    Some(RegisterDetails {
        page_name: page_name.to_owned(),
        register_index,
        name: text(get(register, "name")),
        locator: locator(register),
        access: text(get(register, "access")),
        bit_width: bit_width(register),
        reset: text(get(register, "reset")),
        description: text(get(register, "desc")),
        condition: text(get(register, "condition")),
        execution_state: text(get(register, "execution_state")),
        alias_note: text(get(register, "alias_note")),
        no_dump_reason: text(get(register, "no_dump_reason")),
        aliases: string_list(get(register, "aliases")),
        accessors: sequence(get(register, "accessors"))
            .iter()
            .filter_map(Value::as_mapping)
            .map(|accessor| AccessorDetails {
                name: text(get(accessor, "name")),
                kind: text(get(accessor, "kind")),
                instruction: text(get(accessor, "instruction")),
                condition: text(get(accessor, "condition")),
            })
            .collect(),
        fields: sequence(get(register, "fields"))
            .iter()
            .filter_map(Value::as_mapping)
            .map(field_details)
            .collect(),
    })
}

pub(crate) fn get_field<'a>(
    register: &'a RegisterDetails,
    field_name: &str,
    bits: Option<&str>,
) -> Option<&'a FieldDetails> {
    register.fields.iter().find(|field| {
        field.name == field_name && bits.is_none_or(|expected| field.bits == expected)
    })
}

fn canonical_value(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| format!("{value:?}"))
}

fn register_identity(page_name: &str, register: &Mapping, register_index: usize) -> String {
    let name = text(get(register, "name"));
    let name = if name.is_empty() {
        format!("#{register_index}")
    } else {
        name
    };
    let locator = locator(register);
    let locator = if locator.is_empty() {
        format!("index:{register_index}")
    } else {
        locator
    };
    format!("{page_name}/{name}@{locator}")
}

fn register_map(document: Option<&Value>) -> BTreeMap<String, (String, Vec<(String, String)>)> {
    let mut result = BTreeMap::new();
    let Some(root) = document.and_then(Value::as_mapping) else {
        return result;
    };
    let Some(pages) = mapping(root.get(key("pages"))) else {
        return result;
    };
    for (page_key, page_value) in pages {
        let page_name = text(Some(page_key));
        let Some(page) = page_value.as_mapping() else {
            continue;
        };
        for (register_index, register) in sequence(get(page, "registers")).iter().enumerate() {
            let Some(register_map) = register.as_mapping() else {
                continue;
            };
            let identity = register_identity(&page_name, register_map, register_index);
            let fields = sequence(get(register_map, "fields"))
                .iter()
                .filter_map(Value::as_mapping)
                .map(|field| {
                    let field_name = text(get(field, "name"));
                    let field_key = format!("{identity}/{field_name}/{}", text(get(field, "bits")));
                    (field_key, canonical_value(&Value::Mapping(field.clone())))
                })
                .collect();
            result.insert(identity, (canonical_value(register), fields));
        }
    }
    result
}

fn enum_map(document: Option<&Value>) -> BTreeMap<String, String> {
    let mut result = BTreeMap::new();
    let Some(root) = document.and_then(Value::as_mapping) else {
        return result;
    };
    let Some(pages) = mapping(root.get(key("pages"))) else {
        return result;
    };
    for (page_key, page_value) in pages {
        let page_name = text(Some(page_key));
        let Some(page) = page_value.as_mapping() else {
            continue;
        };
        for (register_index, register) in sequence(get(page, "registers")).iter().enumerate() {
            let Some(register) = register.as_mapping() else {
                continue;
            };
            let register_identity = register_identity(&page_name, register, register_index);
            for field in sequence(get(register, "fields")) {
                let Some(field) = field.as_mapping() else {
                    continue;
                };
                let field_name = text(get(field, "name"));
                for (index, item) in enum_details(get(field, "values")).into_iter().enumerate() {
                    let key = format!("{register_identity}/{field_name}/{index}");
                    result.insert(
                        key,
                        serde_json::json!({
                            "value": item.value,
                            "name": item.name,
                            "description": item.description,
                            "condition": item.condition,
                        })
                        .to_string(),
                    );
                }
            }
        }
    }
    result
}

pub(crate) fn compare_registers(before: Option<&Value>, after: &Value) -> RegisterComparison {
    let old = register_map(before);
    let new = register_map(Some(after));
    let old_keys = old.keys().collect::<BTreeSet<_>>();
    let new_keys = new.keys().collect::<BTreeSet<_>>();
    let mut result = RegisterComparison::default();
    for key in new_keys.difference(&old_keys) {
        result.added_registers.push((*key).clone());
    }
    for key in old_keys.difference(&new_keys) {
        result.removed_registers.push((*key).clone());
    }
    for key in old_keys.intersection(&new_keys) {
        if old[*key].0 != new[*key].0 {
            result.modified_registers.push((*key).clone());
        }
        let old_fields = old[*key].1.iter().cloned().collect::<BTreeMap<_, _>>();
        let new_fields = new[*key].1.iter().cloned().collect::<BTreeMap<_, _>>();
        for field in new_fields
            .keys()
            .filter(|item| !old_fields.contains_key(*item))
        {
            result.added_fields.push((*field).clone());
        }
        for field in old_fields
            .keys()
            .filter(|item| !new_fields.contains_key(*item))
        {
            result.removed_fields.push((*field).clone());
        }
        for field in old_fields
            .keys()
            .filter(|item| new_fields.contains_key(*item))
        {
            if old_fields[field] != new_fields[field] {
                result.modified_fields.push((*field).clone());
            }
        }
    }
    let old_enums = enum_map(before);
    let new_enums = enum_map(Some(after));
    let old_keys = old_enums.keys().collect::<BTreeSet<_>>();
    let new_keys = new_enums.keys().collect::<BTreeSet<_>>();
    for key in new_keys.difference(&old_keys) {
        result.added_enums.push((*key).clone());
    }
    for key in old_keys.difference(&new_keys) {
        result.removed_enums.push((*key).clone());
    }
    for key in old_keys.intersection(&new_keys) {
        if old_enums[*key] != new_enums[*key] {
            result.modified_enums.push((*key).clone());
        }
    }
    result
}

#[cfg(any(feature = "mcp", test))]
fn detail_field_map(register: &RegisterDetails) -> BTreeMap<String, String> {
    register
        .fields
        .iter()
        .enumerate()
        .map(|(index, field)| {
            let name = if field.name.is_empty() {
                format!("#{index}")
            } else {
                field.name.clone()
            };
            (
                format!("{name}/{}", field.bits),
                serde_json::to_string(field).unwrap_or_default(),
            )
        })
        .collect()
}

#[cfg(any(feature = "mcp", test))]
fn detail_enum_map(register: &RegisterDetails) -> BTreeMap<String, String> {
    let mut result = BTreeMap::new();
    for (field_index, field) in register.fields.iter().enumerate() {
        let field_name = if field.name.is_empty() {
            format!("#{field_index}")
        } else {
            field.name.clone()
        };
        for (enum_index, item) in field.enums.iter().enumerate() {
            let identity = if item.value.is_empty() && item.name.is_empty() {
                format!("#{enum_index}")
            } else {
                format!("{}@{}", item.value, item.name)
            };
            result.insert(
                format!("{field_name}/{}/{identity}", field.bits),
                serde_json::to_string(item).unwrap_or_default(),
            );
        }
    }
    result
}

#[cfg(any(feature = "mcp", test))]
pub(crate) fn compare_register_details(
    left: &RegisterDetails,
    right: &RegisterDetails,
) -> RegisterStructureComparison {
    let mut result = RegisterStructureComparison::default();
    let properties = [
        ("name", left.name == right.name),
        ("locator", left.locator == right.locator),
        ("access", left.access == right.access),
        ("bitWidth", left.bit_width == right.bit_width),
        ("reset", left.reset == right.reset),
        ("description", left.description == right.description),
        ("condition", left.condition == right.condition),
        (
            "executionState",
            left.execution_state == right.execution_state,
        ),
        ("aliasNote", left.alias_note == right.alias_note),
        ("noDumpReason", left.no_dump_reason == right.no_dump_reason),
        ("aliases", left.aliases == right.aliases),
        (
            "accessors",
            serde_json::to_string(&left.accessors).ok()
                == serde_json::to_string(&right.accessors).ok(),
        ),
    ];
    result.changed_properties.extend(
        properties
            .into_iter()
            .filter_map(|(name, equal)| (!equal).then_some(name.to_owned())),
    );

    let left_fields = detail_field_map(left);
    let right_fields = detail_field_map(right);
    for key in right_fields.keys() {
        if !left_fields.contains_key(key) {
            result.added_fields.push(key.clone());
        } else if left_fields[key] != right_fields[key] {
            result.modified_fields.push(key.clone());
        }
    }
    for key in left_fields.keys() {
        if !right_fields.contains_key(key) {
            result.removed_fields.push(key.clone());
        }
    }

    let left_enums = detail_enum_map(left);
    let right_enums = detail_enum_map(right);
    for key in right_enums.keys() {
        if !left_enums.contains_key(key) {
            result.added_enums.push(key.clone());
        } else if left_enums[key] != right_enums[key] {
            result.modified_enums.push(key.clone());
        }
    }
    for key in left_enums.keys() {
        if !right_enums.contains_key(key) {
            result.removed_enums.push(key.clone());
        }
    }
    result.equal = result.changed_properties.is_empty()
        && result.added_fields.is_empty()
        && result.removed_fields.is_empty()
        && result.modified_fields.is_empty()
        && result.added_enums.is_empty()
        && result.removed_enums.is_empty()
        && result.modified_enums.is_empty();
    result
}

pub(crate) fn decode_register_value(
    value: u128,
    bit_width: u16,
    fields: &[FieldDetails],
) -> DecodedRegisterValue {
    let register_mask = if bit_width >= 128 {
        u128::MAX
    } else {
        (1_u128 << bit_width) - 1
    };
    let clipped = value > register_mask;
    let value = value & register_mask;
    let decoded_fields = fields
        .iter()
        .map(|field| {
            let ranges = parse_bit_ranges(&field.bits).unwrap_or_else(|| vec![(0, 0)]);
            let field_value = ranges.iter().fold(0_u128, |result, (high, low)| {
                let width = high.saturating_sub(*low).saturating_add(1);
                let mask = width_mask(width);
                (result << width.min(127)) | ((value >> low) & mask)
            });
            let matched_enum = field
                .enums
                .iter()
                .find(|item| parse_numeric(&item.value) == Some(field_value));
            let enum_description = matched_enum
                .map(|item| {
                    if item.description.is_empty() {
                        item.name.clone()
                    } else {
                        item.description.clone()
                    }
                })
                .unwrap_or_default();
            DecodedField {
                name: field.name.clone(),
                bits: field.bits.clone(),
                value_hex: format!("0x{field_value:X}"),
                value_dec: field_value.to_string(),
                enum_description,
                enum_status: if field.enums.is_empty() {
                    "not_defined"
                } else if matched_enum.is_some() {
                    "matched"
                } else {
                    "unknown_value"
                }
                .to_owned(),
            }
        })
        .collect();
    let hex_digits = usize::from(bit_width).div_ceil(4).max(1);
    let binary_digits = usize::from(bit_width).max(1);
    DecodedRegisterValue {
        bit_width,
        value_hex: format!("0x{value:0hex_digits$X}"),
        value_bin: format!("{value:0binary_digits$b}"),
        clipped,
        fields: decoded_fields,
    }
}

fn width_mask(width: u32) -> u128 {
    if width >= 128 {
        u128::MAX
    } else {
        (1_u128 << width) - 1
    }
}

fn parse_bit_ranges(value: &str) -> Option<Vec<(u32, u32)>> {
    value
        .split(',')
        .map(|range| {
            let mut parts = range.trim().split(':');
            let high: u32 = parts.next()?.trim().parse().ok()?;
            let low: u32 = parts.next().unwrap_or(range).trim().parse().ok()?;
            (high < 128 && low < 128).then_some((high.max(low), high.min(low)))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_register_field_and_enum_changes() {
        let before: Value = serde_yaml::from_str(
            "pages:\n  P:\n    registers:\n      - name: R\n        fields:\n          - name: F\n            bits: '1:0'\n            values:\n              - value: 0\n                desc: idle\n",
        )
        .unwrap();
        let after: Value = serde_yaml::from_str(
            "pages:\n  P:\n    registers:\n      - name: R\n        fields:\n          - name: F\n            bits: '1:0'\n            values:\n              - value: 0\n                desc: running\n          - name: G\n            bits: '2'\n",
        )
        .unwrap();
        let diff = compare_registers(Some(&before), &after);
        assert_eq!(diff.added_fields, vec!["P/R@index:0/G/2"]);
        assert_eq!(diff.modified_registers, vec!["P/R@index:0"]);
        assert_eq!(diff.modified_enums, vec!["P/R@index:0/F/0"]);
    }

    #[test]
    fn decodes_fields_and_hex_enum_values() {
        let document: Value = serde_yaml::from_str(
            "pages:\n  P:\n    registers:\n      - name: R\n        access: RW\n        bit_width: 8\n        fields:\n          - name: MODE\n            bits: '3:2'\n            values:\n              - value: '0x2'\n                name: active\n                desc: active mode\n          - name: READY\n            bits: '0'\n",
        )
        .unwrap();
        let register = get_register(&document, "P", 0).unwrap();
        let decoded = decode_register_value(0b1001, register.bit_width, &register.fields);
        assert_eq!(decoded.value_hex, "0x09");
        assert_eq!(decoded.value_bin, "00001001");
        assert!(!decoded.clipped);
        assert_eq!(decoded.fields[0].value_hex, "0x2");
        assert_eq!(decoded.fields[0].value_dec, "2");
        assert_eq!(decoded.fields[0].enum_description, "active mode");
        assert_eq!(decoded.fields[0].enum_status, "matched");
        assert_eq!(decoded.fields[1].value_dec, "1");
        assert_eq!(decoded.fields[1].enum_status, "not_defined");
        assert_eq!(
            get_field(&register, "MODE", Some("3:2")).unwrap().access,
            ""
        );
        assert_eq!(get_chip(&document).unwrap().pages, vec!["P"]);
    }

    #[test]
    fn decodes_non_contiguous_fields_and_reports_clipping() {
        let fields = vec![FieldDetails {
            name: "SPLIT".to_owned(),
            bits: "7:4,1:0".to_owned(),
            access: "RO".to_owned(),
            reset: String::new(),
            reset_info: String::new(),
            reserved: String::new(),
            description: String::new(),
            condition: String::new(),
            inferred: false,
            access_rules: Vec::new(),
            enums: vec![EnumDetails {
                value: "6'h2B".to_owned(),
                name: "combined".to_owned(),
                description: "combined field".to_owned(),
                condition: String::new(),
            }],
        }];
        let decoded = decode_register_value(0x1AB, 8, &fields);
        assert_eq!(decoded.value_hex, "0xAB");
        assert_eq!(decoded.value_bin, "10101011");
        assert!(decoded.clipped);
        assert_eq!(decoded.fields[0].value_hex, "0x2B");
        assert_eq!(decoded.fields[0].enum_description, "combined field");
    }

    #[test]
    fn compares_identical_documents_without_structure_changes() {
        let document: Value = serde_yaml::from_str(
            "pages:\n  P:\n    registers:\n      - name: R\n        fields:\n          - name: F\n            bits: '1:0'\n",
        )
        .unwrap();
        assert_eq!(
            compare_registers(Some(&document), &document),
            RegisterComparison::default()
        );
    }

    #[test]
    fn compares_duplicate_register_names_by_locator() {
        let before: Value = serde_yaml::from_str(
            "pages:\n  P:\n    registers:\n      - { addr: 1, name: R, desc: first }\n      - { addr: 2, name: R, desc: second }\n",
        )
        .unwrap();
        let after: Value = serde_yaml::from_str(
            "pages:\n  P:\n    registers:\n      - { addr: 1, name: R, desc: changed }\n      - { addr: 2, name: R, desc: second }\n",
        )
        .unwrap();
        let diff = compare_registers(Some(&before), &after);
        assert_eq!(diff.modified_registers, vec!["P/R@0x1"]);
        assert!(diff.added_registers.is_empty());
        assert!(diff.removed_registers.is_empty());
    }

    #[test]
    fn compares_two_register_structures() {
        let left_document: Value = serde_yaml::from_str(
            "pages:\n  P:\n    registers:\n      - name: LEFT\n        access: RO\n        bit_width: 8\n        fields:\n          - name: MODE\n            bits: '1:0'\n            values:\n              - { value: 0, desc: idle }\n",
        )
        .unwrap();
        let right_document: Value = serde_yaml::from_str(
            "pages:\n  P:\n    registers:\n      - name: RIGHT\n        access: RW\n        bit_width: 8\n        fields:\n          - name: MODE\n            bits: '1:0'\n            values:\n              - { value: 0, desc: active }\n          - name: ENABLE\n            bits: '2'\n",
        )
        .unwrap();
        let left = get_register(&left_document, "P", 0).unwrap();
        let right = get_register(&right_document, "P", 0).unwrap();
        let comparison = compare_register_details(&left, &right);
        assert!(!comparison.equal);
        assert_eq!(comparison.changed_properties, vec!["name", "access"]);
        assert_eq!(comparison.added_fields, vec!["ENABLE/2"]);
        assert_eq!(comparison.modified_fields, vec!["MODE/1:0"]);
        assert_eq!(comparison.modified_enums, vec!["MODE/1:0/0@"]);
    }
}

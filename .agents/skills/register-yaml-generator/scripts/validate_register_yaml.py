#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError:
    print("ERROR: 缺少 PyYAML，请安装后重试：python3 -m pip install PyYAML", file=sys.stderr)
    raise SystemExit(2)


BIT_RANGE_RE = re.compile(r"^(\d+)(?::(\d+))?$")
KNOWN_ACCESS = {"RO", "RW", "WO"}
TOP_KEYS = {"schema_version", "sensor", "vendor", "family", "device_type", "who_am_i", "pages"}
WHO_KEYS = {"reg", "values"}
WHO_VALUE_KEYS = {"value", "desc"}
PAGE_KEYS = {"page_id", "address_unit_bits", "access", "desc", "registers"}
REGISTER_KEYS = {
    "addr", "name", "access", "width", "bit_width", "address_span", "byte_order",
    "reset", "desc", "fields", "multi_byte",
    "read_clear", "no_dump", "no_dump_reason", "alias_note", "roles",
    "event", "target", "action_hint", "ignore_by_default",
}
FIELD_KEYS = {
    "name", "bits", "access", "reset", "desc", "values", "roles", "event", "target",
    "action_hint", "ignore_by_default",
}


class UniqueKeyLoader(yaml.SafeLoader):
    pass


def construct_unique_mapping(loader: UniqueKeyLoader, node: yaml.MappingNode, deep: bool = False) -> dict[Any, Any]:
    mapping: dict[Any, Any] = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        try:
            duplicate = key in mapping
        except TypeError as exc:
            raise yaml.constructor.ConstructorError(
                "while constructing a mapping",
                node.start_mark,
                "found an unhashable key",
                key_node.start_mark,
            ) from exc
        if duplicate:
            raise yaml.constructor.ConstructorError(
                "while constructing a mapping",
                node.start_mark,
                f"found duplicate key {key!r}",
                key_node.start_mark,
            )
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


UniqueKeyLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,
    construct_unique_mapping,
)


@dataclass
class Report:
    path: Path
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    pages: int = 0
    registers: int = 0
    fields: int = 0

    def error(self, location: str, message: str) -> None:
        self.errors.append(f"{location}: {message}")

    def warn(self, location: str, message: str) -> None:
        self.warnings.append(f"{location}: {message}")


def is_integer(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def require_mapping(report: Report, value: Any, location: str) -> dict[Any, Any] | None:
    if not isinstance(value, dict):
        report.error(location, "必须是 mapping/object")
        return None
    return value


def require_list(report: Report, value: Any, location: str) -> list[Any] | None:
    if not isinstance(value, list):
        report.error(location, "必须是 list/array")
        return None
    return value


def require_string(report: Report, value: Any, location: str) -> bool:
    if not isinstance(value, str) or not value.strip():
        report.error(location, "必须是非空字符串")
        return False
    return True


def warn_unknown_keys(report: Report, value: dict[Any, Any], allowed: set[str], location: str) -> None:
    for key in value:
        if not isinstance(key, str) or key not in allowed:
            report.warn(location, f"未知字段 {key!r}，请确认不是拼写错误")


def parse_enum_value(value: Any) -> int | None:
    if is_integer(value):
        return value
    if isinstance(value, str):
        try:
            return int(value, 0)
        except ValueError:
            return None
    return None


def validate_enum_value(report: Report, value: Any, bit_width: int, location: str) -> None:
    parsed = parse_enum_value(value)
    if parsed is None:
        report.error(location, "枚举值必须是整数或带 0x/0b 前缀的数字字符串")
    elif parsed < 0 or parsed >= (1 << bit_width):
        report.error(location, f"枚举值 {value!r} 超出 {bit_width} bit 范围")


def validate_values(report: Report, values: Any, bit_width: int, location: str) -> None:
    if isinstance(values, dict):
        for key, desc in values.items():
            validate_enum_value(report, key, bit_width, f"{location}.{key}")
            require_string(report, desc, f"{location}.{key}")
        return

    items = require_list(report, values, location)
    if items is None:
        return
    seen: set[int] = set()
    for index, item in enumerate(items):
        item_location = f"{location}[{index}]"
        item_map = require_mapping(report, item, item_location)
        if item_map is None:
            continue
        if "value" not in item_map:
            report.error(item_location, "缺少 value")
        else:
            validate_enum_value(report, item_map["value"], bit_width, f"{item_location}.value")
            parsed = parse_enum_value(item_map["value"])
            if parsed is not None and parsed in seen:
                report.warn(item_location, f"枚举值 {item_map['value']!r} 重复")
            if parsed is not None:
                seen.add(parsed)
        if "desc" in item_map:
            require_string(report, item_map["desc"], f"{item_location}.desc")
        elif "name" in item_map:
            require_string(report, item_map["name"], f"{item_location}.name")
        else:
            report.error(item_location, "缺少 desc 或 name")


def validate_field(report: Report, item: Any, reg_bit_width: int, location: str) -> tuple[int, int] | None:
    field_map = require_mapping(report, item, location)
    if field_map is None:
        return None
    warn_unknown_keys(report, field_map, FIELD_KEYS, location)
    require_string(report, field_map.get("name"), f"{location}.name")
    require_string(report, field_map.get("desc"), f"{location}.desc")

    bits = field_map.get("bits")
    if not isinstance(bits, str):
        report.error(f"{location}.bits", "必须是带引号的字符串，例如 \"7:0\"")
        return None
    match = BIT_RANGE_RE.fullmatch(bits.strip())
    if not match:
        report.error(f"{location}.bits", "格式必须是 hi:lo 或单个 bit")
        return None
    hi = int(match.group(1))
    lo = int(match.group(2) if match.group(2) is not None else match.group(1))
    if hi < lo:
        report.error(f"{location}.bits", "最高位 hi 不能小于最低位 lo")
        return None
    if hi >= reg_bit_width:
        report.error(f"{location}.bits", f"bit {hi} 超出寄存器有效位宽 {reg_bit_width}")
        return None

    if "access" in field_map:
        require_string(report, field_map["access"], f"{location}.access")
    if "reset" in field_map:
        reset = field_map["reset"]
        field_width = hi - lo + 1
        if not is_integer(reset) or reset < 0 or reset >= (1 << field_width):
            report.error(f"{location}.reset", f"必须是 {field_width} bit 范围内的非负整数")

    if "values" in field_map:
        validate_values(report, field_map["values"], hi - lo + 1, f"{location}.values")
    return hi, lo


def validate_register(report: Report, item: Any, page_name: str, index: int) -> dict[str, Any] | None:
    location = f"pages.{page_name}.registers[{index}]"
    reg = require_mapping(report, item, location)
    if reg is None:
        return None
    warn_unknown_keys(report, reg, REGISTER_KEYS, location)

    addr = reg.get("addr")
    if not is_integer(addr) or addr < 0:
        report.error(f"{location}.addr", "必须是非负整数")
    require_string(report, reg.get("name"), f"{location}.name")
    access_ok = require_string(report, reg.get("access"), f"{location}.access")
    if access_ok and reg["access"] not in KNOWN_ACCESS:
        report.warn(f"{location}.access", f"非常用访问属性 {reg['access']!r}，建议使用 RO/RW/WO")
    require_string(report, reg.get("desc"), f"{location}.desc")

    width = reg.get("width")
    if not is_integer(width) or width < 1:
        report.error(f"{location}.width", "必须是正整数字节数")
        width = 1
    bit_width = reg.get("bit_width", width * 8)
    if not is_integer(bit_width) or bit_width < 1:
        report.error(f"{location}.bit_width", "必须是正整数")
        bit_width = width * 8
    elif bit_width > width * 8:
        report.error(f"{location}.bit_width", f"不能超过 width={width} 对应的 {width * 8} bit")

    address_span = reg.get("address_span", width)
    if not is_integer(address_span) or address_span < 1:
        report.error(f"{location}.address_span", "必须是正整数")

    if "byte_order" in reg and reg["byte_order"] not in {"little", "big"}:
        report.error(f"{location}.byte_order", "必须是 little 或 big")
    if "reset" in reg:
        reset = reg["reset"]
        if not is_integer(reset) or reset < 0 or reset >= (1 << bit_width):
            report.error(f"{location}.reset", f"必须是 {bit_width} bit 范围内的非负整数")

    fields = reg.get("fields")
    if fields is not None:
        field_items = require_list(report, fields, f"{location}.fields")
        if field_items is not None:
            ranges: list[tuple[int, int, str]] = []
            names: set[str] = set()
            reset_mask = 0
            reset_value = 0
            for field_index, field_item in enumerate(field_items):
                field_location = f"{location}.fields[{field_index}]"
                bit_range = validate_field(report, field_item, bit_width, field_location)
                report.fields += 1
                if isinstance(field_item, dict) and isinstance(field_item.get("name"), str):
                    field_name = field_item["name"]
                    if field_name in names:
                        report.warn(field_location, f"位域名 {field_name!r} 在同一寄存器内重复")
                    names.add(field_name)
                if bit_range is not None:
                    hi, lo = bit_range
                    for other_hi, other_lo, other_location in ranges:
                        if max(lo, other_lo) <= min(hi, other_hi):
                            report.warn(field_location, f"位域与 {other_location} 重叠")
                    ranges.append((hi, lo, field_location))
                    field_reset = field_item.get("reset") if isinstance(field_item, dict) else None
                    if is_integer(field_reset):
                        field_mask = ((1 << (hi - lo + 1)) - 1) << lo
                        reset_mask |= field_mask
                        reset_value = (reset_value & ~field_mask) | (field_reset << lo)

            register_reset = reg.get("reset")
            if is_integer(register_reset) and reset_mask:
                mismatched = (register_reset ^ reset_value) & reset_mask
                if mismatched:
                    report.error(
                        f"{location}.reset",
                        f"与位域复位值不一致，差异位掩码为 {mismatched:#x}",
                    )

    report.registers += 1
    return reg


def validate_who_am_i(report: Report, value: Any) -> int | None:
    location = "who_am_i"
    who = require_mapping(report, value, location)
    if who is None:
        return None
    warn_unknown_keys(report, who, WHO_KEYS, location)
    if "reg" not in who:
        report.error("who_am_i.reg", "缺少 reg；未知时应填写 null")
    reg = who.get("reg")
    if reg is not None and (not is_integer(reg) or reg < 0):
        report.error("who_am_i.reg", "必须是非负整数或 null")
        reg = None
    values = require_list(report, who.get("values"), "who_am_i.values")
    if values is not None:
        seen: set[int] = set()
        for index, item in enumerate(values):
            item_location = f"who_am_i.values[{index}]"
            item_map = require_mapping(report, item, item_location)
            if item_map is None:
                continue
            warn_unknown_keys(report, item_map, WHO_VALUE_KEYS, item_location)
            if "value" not in item_map or not is_integer(item_map.get("value")):
                report.error(f"{item_location}.value", "必须是整数")
            else:
                enum_value = item_map["value"]
                if enum_value < 0:
                    report.error(f"{item_location}.value", "不能为负数")
                if enum_value in seen:
                    report.warn(item_location, f"WHO_AM_I 值 {enum_value:#x} 重复")
                seen.add(enum_value)
            require_string(report, item_map.get("desc"), f"{item_location}.desc")
    return reg


def validate_document(path: Path) -> Report:
    report = Report(path=path)
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        report.error("file", f"无法按 UTF-8 读取：{exc}")
        return report
    if "\t" in text:
        report.error("file", "包含 Tab；浏览器解析器只接受空格缩进")

    try:
        data = yaml.load(text, Loader=UniqueKeyLoader)
    except yaml.YAMLError as exc:
        report.error("file", f"YAML 解析失败：{exc}")
        return report

    root = require_mapping(report, data, "root")
    if root is None:
        return report
    warn_unknown_keys(report, root, TOP_KEYS, "root")
    if "schema_version" in root and (not is_integer(root["schema_version"]) or root["schema_version"] < 1):
        report.error("schema_version", "必须是正整数")
    require_string(report, root.get("sensor"), "sensor")
    for metadata_key in ("vendor", "family", "device_type"):
        if metadata_key in root:
            require_string(report, root[metadata_key], metadata_key)

    if "who_am_i" not in root:
        report.warn("root", "缺少 who_am_i；未知时也建议显式写 reg: null 和 values: []")
        who_reg = None
    else:
        who_reg = validate_who_am_i(report, root["who_am_i"])

    pages = require_mapping(report, root.get("pages"), "pages")
    if pages is None:
        return report
    if not pages:
        report.error("pages", "至少需要一个页面")
        return report

    page_ids: dict[int, str] = {}
    all_addresses: set[int] = set()
    for page_name, page_value in pages.items():
        page_location = f"pages.{page_name}"
        if not isinstance(page_name, str) or not page_name.strip():
            report.error("pages", "页面名必须是非空字符串")
        page = require_mapping(report, page_value, page_location)
        if page is None:
            continue
        report.pages += 1
        warn_unknown_keys(report, page, PAGE_KEYS, page_location)
        page_id = page.get("page_id")
        if not is_integer(page_id) or page_id < 0:
            report.error(f"{page_location}.page_id", "必须是非负整数")
        elif page_id in page_ids:
            report.warn(f"{page_location}.page_id", f"与页面 {page_ids[page_id]!r} 使用相同 page_id")
        else:
            page_ids[page_id] = str(page_name)
        require_string(report, page.get("access"), f"{page_location}.access")
        require_string(report, page.get("desc"), f"{page_location}.desc")
        if "address_unit_bits" in page and (
            not is_integer(page["address_unit_bits"]) or page["address_unit_bits"] < 1
        ):
            report.error(f"{page_location}.address_unit_bits", "必须是正整数")

        registers = require_list(report, page.get("registers"), f"{page_location}.registers")
        if registers is None:
            continue
        intervals: list[tuple[int, int, dict[str, Any], str]] = []
        names: set[str] = set()
        previous_addr = -1
        for index, register_item in enumerate(registers):
            reg = validate_register(report, register_item, str(page_name), index)
            if reg is None:
                continue
            location = f"{page_location}.registers[{index}]"
            addr = reg.get("addr")
            width = reg.get("width")
            address_span = reg.get("address_span", width)
            name = reg.get("name")
            if isinstance(name, str):
                if name in names:
                    report.warn(location, f"寄存器名 {name!r} 在页面内重复")
                names.add(name)
            if (
                not is_integer(addr) or addr < 0
                or not is_integer(width) or width < 1
                or not is_integer(address_span) or address_span < 1
            ):
                continue
            all_addresses.update(range(addr, addr + address_span))
            end = addr + address_span - 1
            overlaps_existing = any(
                max(addr, other_start) <= min(end, other_end)
                for other_start, other_end, _, _ in intervals
            )
            if addr < previous_addr and not overlaps_existing:
                report.warn(location, "地址小于前一条目；建议按地址递增排列")
            previous_addr = addr
            for other_start, other_end, other_reg, other_location in intervals:
                if max(addr, other_start) <= min(end, other_end):
                    if not reg.get("alias_note") and not other_reg.get("alias_note"):
                        report.warn(location, f"地址范围与 {other_location} 重叠但双方都没有 alias_note")
            intervals.append((addr, end, reg, location))

    if who_reg is not None and who_reg not in all_addresses:
        report.warn("who_am_i.reg", "没有匹配到任何页面中的寄存器地址")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="校验寄存器速查工具使用的芯片 YAML")
    parser.add_argument("paths", nargs="+", type=Path, help="一个或多个 YAML 文件")
    parser.add_argument("--strict", action="store_true", help="将警告也视为失败")
    args = parser.parse_args()

    failed = False
    for path in args.paths:
        report = validate_document(path)
        for message in report.errors:
            print(f"ERROR {path}: {message}")
        for message in report.warnings:
            print(f"WARN  {path}: {message}")
        if report.errors:
            failed = True
            print(f"FAIL  {path}: {len(report.errors)} error(s), {len(report.warnings)} warning(s)")
        else:
            print(
                f"OK    {path}: {report.pages} page(s), {report.registers} register(s), "
                f"{report.fields} field(s), {len(report.warnings)} warning(s)"
            )
        if args.strict and report.warnings:
            failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

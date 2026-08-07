from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pdfplumber


DETAIL_START = "USB3OTG_GSBUSCFG0"
DETAIL_LAST_PAGE = 45
SIZE_BYTES = {"B": 1, "HW": 2, "W": 4, "DW": 8}
HEADING_RE = re.compile(r"USB3OTG_[A-Za-z0-9_]+")
BITS_RE = re.compile(r"^(\d+)(?::(\d+))?$")


@dataclass
class Summary:
    name: str
    offset: int
    width: int
    reset: int
    desc: str


def compact(value: str | None) -> str:
    return re.sub(r"\s+", "", value or "")


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    text = value.replace("\u2019", "'").replace("\u2018", "'")
    text = text.replace("\u201c", '"').replace("\u201d", '"')
    text = re.sub(r"(?<=\w)-\n(?=\w)", "", text)
    return "\n".join(line.strip() for line in text.splitlines() if line.strip())


def normalize_access(value: str | None) -> str:
    text = compact(value).upper()
    if text in {"R/WSC", "RWSC"}:
        return "RW_SC"
    if text in {"R/W", "RW"}:
        return "RW"
    if text in {"R/W1C", "RW1C"}:
        return "RW_1C"
    if text in {"R/W1S", "RW1S"}:
        return "RW_1S"
    if text in {"RO", "R"}:
        return "RO"
    if text in {"WO", "W"}:
        return "WO"
    return text.replace("/", "_") or "RO"


def parse_hex(value: str | None, location: str) -> int:
    text = compact(value)
    if not re.fullmatch(r"0[xX][0-9a-fA-F]+", text):
        raise ValueError(f"{location}: unsupported numeric value {value!r}")
    return int(text, 16)


def normalize_field_name(raw: str, bits: str) -> str:
    if raw.strip().lower() == "reserved":
        return f"reserved_{bits.replace(':', '_')}"
    value = re.sub(r"[^0-9A-Za-z]+", "_", raw).strip("_")
    return value or f"field_{bits.replace(':', '_')}"


def extract_summaries(pdf: pdfplumber.PDF) -> list[Summary]:
    rows: list[dict[str, str]] = []
    for page_index in (3, 4, 5):
        for table in pdf.pages[page_index].extract_tables():
            if not table or table[0][:2] != ["Name", "Offset"]:
                continue
            for row in table[1:]:
                name, offset, size, reset, desc = (row + [None] * 5)[:5]
                if offset is None and name and rows:
                    rows[-1]["name"] += compact(name)
                    continue
                if offset:
                    rows.append(
                        {
                            "name": compact(name),
                            "offset": compact(offset),
                            "size": compact(size),
                            "reset": compact(reset),
                            "desc": " ".join((desc or "").split()),
                        }
                    )

    summaries = []
    for row in rows:
        if row["size"] not in SIZE_BYTES:
            raise ValueError(f"{row['name']}: unknown size {row['size']!r}")
        summaries.append(
            Summary(
                name=row["name"],
                offset=parse_hex(row["offset"], f"{row['name']}.offset"),
                width=SIZE_BYTES[row["size"]],
                reset=parse_hex(row["reset"], f"{row['name']}.reset"),
                desc=row["desc"],
            )
        )
    return summaries


def extract_detail_rows(pdf: pdfplumber.PDF) -> tuple[list[str], dict[str, list[list[str | None]]]]:
    started = False
    current: str | None = None
    order: list[str] = []
    rows: dict[str, list[list[str | None]]] = {}

    for page_index in range(5, min(DETAIL_LAST_PAGE, len(pdf.pages))):
        page = pdf.pages[page_index]
        events: list[tuple[float, int, Any]] = []
        for word in page.extract_words():
            if word["x0"] < 100 and HEADING_RE.fullmatch(word["text"]):
                events.append((word["top"], 0, word["text"]))
        for table in page.find_tables():
            data = table.extract()
            if data and data[0] and data[0][0] == "Bit":
                events.append((table.bbox[1], 1, data[1:]))

        for _, kind, value in sorted(events, key=lambda event: (event[0], event[1])):
            if kind == 0:
                if value == DETAIL_START:
                    started = True
                if started:
                    current = value
                    if current not in rows:
                        order.append(current)
                        rows[current] = []
            elif started and current:
                rows[current].extend(value)
    return order, rows


def parse_field(row: list[str | None], register_name: str, bit_width: int) -> dict[str, Any]:
    bits, access, reset, description = (row + [None] * 4)[:4]
    bits_text = compact(bits)
    match = BITS_RE.fullmatch(bits_text)
    if not match:
        raise ValueError(f"{register_name}: invalid bits {bits!r}")
    hi = int(match.group(1))
    lo = int(match.group(2) if match.group(2) is not None else match.group(1))
    if hi < lo or hi >= bit_width:
        raise ValueError(f"{register_name}: out-of-range bits {bits_text}")

    full_description = clean_text(description)
    description_lines = full_description.splitlines()
    raw_name = description_lines[0] if description_lines else "reserved"
    detail = "\n".join(description_lines[1:]).strip()
    if not detail:
        detail = "Reserved." if raw_name.lower() == "reserved" else raw_name

    return {
        "name": normalize_field_name(raw_name, bits_text),
        "bits": f"{hi}:{lo}",
        "access": normalize_access(access),
        "reset": parse_hex(reset, f"{register_name}.{raw_name}.reset"),
        "desc": detail,
    }


def derive_register_access(fields: list[dict[str, Any]]) -> str:
    accesses = {field["access"] for field in fields}
    if any(access.startswith("RW") for access in accesses):
        return "RW"
    if "WO" in accesses:
        return "WO"
    return "RO"


def verify_register(summary: Summary, fields: list[dict[str, Any]]) -> None:
    bit_width = summary.width * 8
    expected_mask = (1 << bit_width) - 1
    covered_mask = 0
    composed_reset = 0

    for field in fields:
        hi, lo = (int(part) for part in field["bits"].split(":"))
        width = hi - lo + 1
        mask = ((1 << width) - 1) << lo
        if covered_mask & mask:
            raise ValueError(f"{summary.name}.{field['name']}: overlapping bit range {field['bits']}")
        covered_mask |= mask
        composed_reset |= field["reset"] << lo

    if covered_mask != expected_mask:
        missing = expected_mask & ~covered_mask
        raise ValueError(f"{summary.name}: detail table does not cover bit mask {missing:#x}")
    if composed_reset != summary.reset:
        raise ValueError(
            f"{summary.name}: field reset {composed_reset:#x} does not match "
            f"summary reset {summary.reset:#x}"
        )


def build_document(pdf_path: Path) -> dict[str, Any]:
    with pdfplumber.open(pdf_path) as pdf:
        summaries = extract_summaries(pdf)
        detail_order, detail_rows = extract_detail_rows(pdf)

    summary_by_name = {summary.name: summary for summary in summaries}
    missing_summary = set(detail_order) - set(summary_by_name)
    missing_detail = set(summary_by_name) - set(detail_order)
    if missing_summary or missing_detail:
        raise ValueError(
            f"summary/detail mismatch: missing summary={sorted(missing_summary)}, "
            f"missing detail={sorted(missing_detail)}"
        )

    registers = []
    field_count = 0
    for name in detail_order:
        summary = summary_by_name[name]
        fields = [parse_field(row, name, summary.width * 8) for row in detail_rows[name]]
        verify_register(summary, fields)
        field_count += len(fields)
        registers.append(
            {
                "addr": summary.offset,
                "name": name,
                "access": derive_register_access(fields),
                "width": summary.width,
                "bit_width": summary.width * 8,
                "address_span": summary.width,
                "byte_order": "little",
                "reset": summary.reset,
                "desc": summary.desc,
                "fields": fields,
            }
        )

    return {
        "schema_version": 1,
        "sensor": "RK3588_DWC3",
        "vendor": "Rockchip / Synopsys",
        "family": "DesignWare USB 3 Dual-Role Device Controller",
        "device_type": "usb_controller",
        "who_am_i": {
            "reg": 0xC120,
            "values": [
                {
                    "value": summary_by_name["USB3OTG_GSNPSID"].reset,
                    "desc": "RK3588 TRM 中 USB3OTG_GSNPSID 的复位值",
                }
            ],
        },
        "pages": {
            "MMIO": {
                "page_id": 0,
                "address_unit_bits": 8,
                "access": "32-bit MMIO",
                "desc": (
                    "RK3588 TRM-Part2 Chapter 13 USB3 Controller 寄存器；"
                    "DWC3 核内部偏移，USB3OTG_0/1/2 的 SoC 基地址见 TRM 13.4.1。"
                ),
                "registers": registers,
            }
        },
        "_stats": {"registers": len(registers), "fields": field_count},
    }


def quote(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def hex_value(value: int, bits: int) -> str:
    digits = max(1, (bits + 3) // 4)
    return f"0x{value:0{digits}X}"


def serialize(document: dict[str, Any]) -> str:
    page = document["pages"]["MMIO"]
    lines = [
        "# Source: RK3588 TRM-Part2, Chapter 13 USB3 Controller",
        "# Register facts are extracted only from the Rockchip TRM tables.",
        f"schema_version: {document['schema_version']}",
        f"sensor: {document['sensor']}",
        f"vendor: {quote(document['vendor'])}",
        f"family: {quote(document['family'])}",
        f"device_type: {document['device_type']}",
        "who_am_i:",
        f"  reg: {hex_value(document['who_am_i']['reg'], 16)}",
        "  values:",
    ]
    for item in document["who_am_i"]["values"]:
        lines.extend(
            [
                f"    - value: {hex_value(item['value'], 32)}",
                f"      desc: {quote(item['desc'])}",
            ]
        )
    lines.extend(
        [
            "",
            "pages:",
            "  MMIO:",
            f"    page_id: {hex_value(page['page_id'], 8)}",
            f"    address_unit_bits: {page['address_unit_bits']}",
            f"    access: {quote(page['access'])}",
            f"    desc: {quote(page['desc'])}",
            "    registers:",
        ]
    )

    for register in page["registers"]:
        lines.extend(
            [
                f"      - addr: {hex_value(register['addr'], 16)}",
                f"        name: {register['name']}",
                f"        access: {register['access']}",
                f"        width: {register['width']}",
                f"        bit_width: {register['bit_width']}",
                f"        address_span: {register['address_span']}",
                f"        byte_order: {register['byte_order']}",
                f"        reset: {hex_value(register['reset'], register['bit_width'])}",
                f"        desc: {quote(register['desc'])}",
                "        fields:",
            ]
        )
        for field in register["fields"]:
            hi, lo = (int(part) for part in field["bits"].split(":"))
            lines.extend(
                [
                    f"          - name: {field['name']}",
                    f"            bits: {quote(field['bits'])}",
                    f"            access: {field['access']}",
                    f"            reset: {hex_value(field['reset'], hi - lo + 1)}",
                    f"            desc: {quote(field['desc'])}",
                ]
            )
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract RK3588 DWC3 registers from the Zotero TRM PDF")
    parser.add_argument("pdf", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    document = build_document(args.pdf)
    args.output.write_text(serialize(document), encoding="utf-8")
    stats = document["_stats"]
    print(f"wrote {args.output} ({stats['registers']} registers, {stats['fields']} fields)")


if __name__ == "__main__":
    main()

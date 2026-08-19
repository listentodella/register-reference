# Read-only register core

The desktop backend exposes register data through domain DTOs instead of SQLite rows. Tauri
commands adapt the same read-only service boundary used by the current UI and available to a
future local CLI or MCP adapter:

- `search_registers(query, current_chip_id, limit, recent_chip_ids)` searches the derived index.
- `get_chip(chip_id)` returns chip identity and page names.
- `get_register_details(chip_id, page_name, register_index)` returns one register, its fields,
  enum definitions, source metadata, and separately stored user notes.
- `get_field(chip_id, page_name, register_index, field_name, bits)` returns one exact field.
- `decode_register_value(chip_id, page_name, register_index, value)` returns the masked HEX and
  binary value plus decoded fields and exact enum explanations.
- `get_source_metadata(chip_id)` returns source file, version, SHA-256, import timestamps, and
  translation availability.
- `compare_registers(before, after)` returns added, removed, and modified registers, fields, and
  enum definitions without writing either document.

`core_service.rs` owns YAML-to-domain extraction, field decoding, and structural register
comparison. Import preview uses the same comparison function before opening the existing
transactional import path. A canceled preview only removes its in-memory token and never writes
to the database.

The module is read-only by design. It does not expose database identifiers beyond stable chip
IDs, start a server, listen on a socket, or upload source files and queries.

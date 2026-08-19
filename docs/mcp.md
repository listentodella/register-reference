# Read-only MCP server

`register-reference-mcp` exposes the local register library to MCP clients through a dedicated
stdio process. It uses the official Rust MCP SDK (`rmcp`) and the same register decoding and search
domain code as the desktop application. It does not start an HTTP/SSE listener or make network
requests.

## Build

Rust 1.88 or newer is required by the MCP SDK. From the repository root:

```bash
cargo build \
  --manifest-path src-tauri/Cargo.toml \
  --release \
  --locked \
  --features mcp \
  --bin register-reference-mcp
```

The output is:

- macOS/Linux: `src-tauri/target/release/register-reference-mcp`
- Windows: `src-tauri/target/release/register-reference-mcp.exe`

The MCP feature is optional. A normal Tauri build does not compile the MCP server into the desktop
application.

## Database selection

An explicit database path is recommended:

```bash
src-tauri/target/release/register-reference-mcp \
  --db "/absolute/path/register-library.sqlite3"
```

Without `--db`, the server resolves the same application-data location used by the Tauri app:

- macOS: `~/Library/Application Support/com.leo.registerreference/register-library.sqlite3`
- Windows: `%APPDATA%\com.leo.registerreference\register-library.sqlite3`
- Linux: `${XDG_DATA_HOME:-$HOME/.local/share}/com.leo.registerreference/register-library.sqlite3`

The resolved path is printed to stderr when the server starts. `--db` is the only way to override
it. Tool arguments never accept paths and cannot read arbitrary files.

The process speaks MCP on stdout and therefore appears to wait silently when launched in a shell.
Diagnostics go to stderr. Use `--help` or `--version` outside an MCP session for command-line help.

## Client configuration

Use an absolute executable path. A generic MCP client configuration is:

```json
{
  "mcpServers": {
    "register-reference": {
      "command": "/absolute/path/register-reference-mcp",
      "args": [
        "--db",
        "/absolute/path/register-library.sqlite3"
      ]
    }
  }
}
```

On Windows, use the `.exe` path and escape backslashes in JSON, or use forward slashes.

## Tools

All tools are marked read-only:

- `get_chip_catalog`: lists chip, vendor, family, category, source, hidden state, and translation
  status.
- `search_registers`: searches registers, fields, enums, addresses, system encodings, and
  descriptions with the desktop ranking and `chip:`, `type:`, `access:`, `addr:`, and `bits:`
  filters. `limit` must be 1 through 50.
- `get_register`: returns the complete register domain DTO, source metadata, fields, accessors,
  conditions, and enums.
- `get_field`: returns one exact field and its enum/condition metadata.
- `decode_register_value`: decodes decimal, `0x` hexadecimal, or `0b` binary values up to 128-bit.
  Values wider than the selected register are masked with `clipped: true`; values beyond 128-bit
  are rejected.
- `compare_registers`: compares two imported register structures and reports changed properties,
  fields, and enums.
- `get_source_metadata`: returns source file/path, version, SHA-256, import timestamps, and
  translation status.

Chip names and register names can be duplicated. A tool returns structured candidates instead of
silently choosing the first item. Supply `sourceSha256` for a duplicate chip and
`registerLocator` or `registerIndex` for a duplicate register. Search results contain these stable
selectors.

## Privacy and read-only boundary

- SQLite is opened with `SQLITE_OPEN_READ_ONLY` and `PRAGMA query_only=ON` on every call.
- Startup validates the existing schema but never creates a database, runs migrations, imports
  YAML, rebuilds indexes, or opens a write transaction.
- No tool imports, deletes, enables, categorizes, translates, or changes notes.
- Responses omit internal SQLite chip IDs, SQL, and ranking scores.
- User-note text is excluded from `search_registers` by default and is never included by
  `get_register`. It is returned only when a caller explicitly sets `includeNotes: true` on a
  search call.
- Source metadata can contain a source path already stored by the desktop application. No tool can
  use that path to read the source file.
- Queries and results remain local. There is no telemetry or network transport in this binary.

The automated stdio test hashes the fixture database before and after initialize, tool calls, and
EOF shutdown. It also verifies that stdout contains only valid MCP JSON messages and that the
private note fixture is absent from default search/register responses.

## Troubleshooting

`database_not_found`
: Open the desktop app and import at least one YAML, or pass the exact database with `--db`.

`database_incompatible`
: Open the database once with the current desktop application. The MCP server intentionally does
  not migrate old schemas.

`search_index_not_ready`
: Use the desktop application's search-index rebuild flow, then retry. The MCP server will not
  repair or update the index.

`ambiguous_chip`, `ambiguous_register`, or `ambiguous_field`
: Use the candidates in the structured error and retry with `sourceSha256`, `registerLocator`,
  `registerIndex`, or `bits`.

No protocol response appears
: Confirm the client launches the binary with stdio pipes. Human-readable startup text is sent to
  stderr, not stdout.

## Packaging status

This iteration produces a tested independent binary. It is not yet copied into the portable Tauri
packages. Tauri sidecars need target-triple file naming, macOS code signing/notarization, Windows
signing, AppImage placement, release checksums, and cross-platform CI artifacts. Those changes are
intentionally deferred so the existing portable application pipeline remains unchanged.

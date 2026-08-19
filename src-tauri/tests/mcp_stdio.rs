#![cfg(feature = "mcp")]

use rmcp::{
    model::{CallToolRequestParams, CallToolResult, JsonObject},
    transport::{ConfigureCommandExt, TokioChildProcess},
    ServiceExt,
};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};

const SOURCE_HASH_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SOURCE_HASH_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const PRIVATE_NOTE: &str = "PRIVATE_NOTE_BODY_42";
static FIXTURE_COUNTER: AtomicU64 = AtomicU64::new(1);

fn fixture_path(label: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "register-reference-mcp-{label}-{}-{}.sqlite3",
        std::process::id(),
        FIXTURE_COUNTER.fetch_add(1, Ordering::Relaxed)
    ))
}

fn fixture_yaml(sensor: &str) -> String {
    format!(
        r#"schema_version: 2
sensor: "{sensor}"
vendor: "Fixture Vendor"
family: "Fixture Family"
device_type: "test"
source:
  title: "MCP protocol fixture"
  version: "1.0"
  document: "fixture.yaml"
pages:
  Main:
    access: "MMIO"
    desc: "Protocol fixture"
    registers:
      - addr: 0x10
        name: "CTRL"
        access: "RW"
        width: 2
        bit_width: 16
        reset: 0
        desc: "Primary control register"
        fields:
          - name: "MODE"
            bits: "15:8"
            access: "RW"
            values:
              - value: "0x1"
                name: "run"
                desc: "Run mode"
          - name: "SPLIT"
            bits: "7:4,1:0"
            access: "RO"
            desc: "Non-contiguous field"
      - addr: 0x12
        name: "CTRL"
        access: "RO"
        width: 2
        bit_width: 16
        desc: "Duplicate name for ambiguity testing"
  Wide:
    access: "system"
    desc: "Wide register"
    registers:
      - name: "WIDE"
        access: "RW"
        width: 16
        bit_width: 128
        encoding:
          scheme: "fixture"
          selector: "WIDE"
        fields:
          - name: "FULL"
            bits: "127:0"
            values:
              - value: "128'hFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"
                desc: "All bits set"
"#
    )
}

fn create_schema(path: &PathBuf) -> Connection {
    let connection = Connection::open(path).unwrap();
    connection
        .execute_batch(
            "CREATE TABLE chips (
                id TEXT PRIMARY KEY,
                sensor TEXT NOT NULL,
                vendor TEXT NOT NULL,
                family TEXT NOT NULL,
                device_type TEXT NOT NULL,
                category TEXT NOT NULL,
                enabled INTEGER NOT NULL,
                source_kind TEXT NOT NULL,
                source_name TEXT NOT NULL,
                source_path TEXT,
                source_sha256 TEXT NOT NULL,
                yaml_text TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
             );
             CREATE TABLE translations (source_sha256 TEXT NOT NULL, locale TEXT NOT NULL);
             CREATE TABLE register_notes (chip_id TEXT, content TEXT);
             CREATE TABLE app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE search_documents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                doc_key TEXT NOT NULL UNIQUE,
                chip_id TEXT NOT NULL,
                chip_name TEXT NOT NULL,
                category TEXT NOT NULL,
                enabled INTEGER NOT NULL,
                kind TEXT NOT NULL,
                page_name TEXT NOT NULL,
                register_index INTEGER,
                register_name TEXT NOT NULL,
                register_locator TEXT NOT NULL,
                field_name TEXT NOT NULL,
                field_bits TEXT NOT NULL,
                access TEXT NOT NULL,
                title TEXT NOT NULL,
                aliases TEXT NOT NULL,
                source_text TEXT NOT NULL,
                translated_text TEXT NOT NULL
             );
             CREATE VIRTUAL TABLE search_fts USING fts5(
                title, aliases, source_text, translated_text,
                content='search_documents', content_rowid='id', tokenize='trigram'
             );
             CREATE TRIGGER search_documents_ai AFTER INSERT ON search_documents BEGIN
                INSERT INTO search_fts(rowid, title, aliases, source_text, translated_text)
                VALUES (new.id, new.title, new.aliases, new.source_text, new.translated_text);
             END;",
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO app_metadata VALUES ('search_schema_version', '2')",
            [],
        )
        .unwrap();
    connection
}

fn create_fixture(path: &PathBuf) {
    let connection = create_schema(path);
    let yaml_a = fixture_yaml("MCP_TEST");
    let yaml_b = fixture_yaml("MCP_TEST").replace("Primary control", "Alternate control");
    connection
        .execute(
            "INSERT INTO chips VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 'imported', ?7, NULL, ?8, ?9, '2026-08-19 10:00:00', '2026-08-19 10:00:00')",
            params!["internal:a", "MCP_TEST", "Fixture Vendor", "Fixture Family", "test", "Tests", "fixture-a.yaml", SOURCE_HASH_A, yaml_a],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO chips VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 'linked', ?7, NULL, ?8, ?9, '2026-08-19 11:00:00', '2026-08-19 11:00:00')",
            params!["internal:b", "MCP_TEST", "Fixture Vendor", "Fixture Family", "test", "Hidden Tests", "fixture-b.yaml", SOURCE_HASH_B, yaml_b],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO translations VALUES (?1, 'zh-CN')",
            [SOURCE_HASH_A],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO register_notes VALUES ('internal:a', ?1)",
            [PRIVATE_NOTE],
        )
        .unwrap();
    let documents = [
        (
            "reg:a:0",
            "internal:a",
            "register",
            "Main",
            Some(0),
            "CTRL",
            "0x10",
            "",
            "",
            "RW",
            "CTRL",
            "",
            "Primary control register",
            "主控制寄存器",
        ),
        (
            "field:a:0",
            "internal:a",
            "field",
            "Main",
            Some(0),
            "CTRL",
            "0x10",
            "MODE",
            "15:8",
            "RW",
            "MODE",
            "15:8",
            "Run mode selector",
            "运行模式",
        ),
        (
            "enum:a:0",
            "internal:a",
            "enum",
            "Main",
            Some(0),
            "CTRL",
            "0x10",
            "MODE",
            "15:8",
            "RW",
            "run",
            "0x1",
            "Run mode",
            "运行",
        ),
        (
            "note:a:0",
            "internal:a",
            "note",
            "Main",
            None,
            "CTRL",
            "note-key",
            "",
            "",
            "",
            "CTRL",
            "warning",
            PRIVATE_NOTE,
            "",
        ),
        (
            "reg:b:0",
            "internal:b",
            "register",
            "Main",
            Some(0),
            "CTRL",
            "0x10",
            "",
            "",
            "RW",
            "CTRL",
            "",
            "Alternate control register",
            "",
        ),
    ];
    for (
        doc_key,
        chip_id,
        kind,
        page,
        index,
        register,
        locator,
        field,
        bits,
        access,
        title,
        aliases,
        source,
        translated,
    ) in documents
    {
        let (chip_name, category) = if chip_id == "internal:a" {
            ("MCP_TEST", "Tests")
        } else {
            ("MCP_TEST", "Hidden Tests")
        };
        connection
            .execute(
                "INSERT INTO search_documents (
                    doc_key, chip_id, chip_name, category, enabled, kind, page_name,
                    register_index, register_name, register_locator, field_name, field_bits,
                    access, title, aliases, source_text, translated_text
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
                params![doc_key, chip_id, chip_name, category, i64::from(chip_id == "internal:a"), kind, page, index, register, locator, field, bits, access, title, aliases, source, translated],
            )
            .unwrap();
    }
    connection.execute_batch("VACUUM;").unwrap();
}

fn file_hash(path: &PathBuf) -> String {
    format!("{:x}", Sha256::digest(fs::read(path).unwrap()))
}

fn object(value: Value) -> JsonObject {
    value.as_object().unwrap().clone()
}

fn structured(result: &CallToolResult) -> &Value {
    result
        .structured_content
        .as_ref()
        .expect("tool response must contain structuredContent")
}

async fn call(
    client: &rmcp::service::RunningService<rmcp::RoleClient, ()>,
    tool: &'static str,
    arguments: Value,
) -> CallToolResult {
    client
        .call_tool(CallToolRequestParams::new(tool).with_arguments(object(arguments)))
        .await
        .unwrap()
}

fn register_args(hash: &str, index: usize) -> Value {
    json!({
        "chip": "MCP_TEST",
        "sourceSha256": hash,
        "page": "Main",
        "registerName": "CTRL",
        "registerIndex": index
    })
}

#[tokio::test]
async fn mcp_stdio_exposes_read_only_tools_without_leaking_notes() {
    let database = fixture_path("sdk");
    create_fixture(&database);
    let hash_before = file_hash(&database);
    let executable = env!("CARGO_BIN_EXE_register-reference-mcp");
    let transport = TokioChildProcess::new(tokio::process::Command::new(executable).configure(
        |command| {
            command.arg("--db").arg(&database);
        },
    ))
    .unwrap();
    let client = ().serve(transport).await.unwrap();

    let tools = client.list_all_tools().await.unwrap();
    let mut names = tools
        .iter()
        .map(|tool| tool.name.as_ref())
        .collect::<Vec<_>>();
    names.sort_unstable();
    assert_eq!(
        names,
        vec![
            "compare_registers",
            "decode_register_value",
            "get_chip_catalog",
            "get_field",
            "get_register",
            "get_source_metadata",
            "search_registers",
        ]
    );
    assert!(tools.iter().all(|tool| {
        tool.annotations
            .as_ref()
            .and_then(|annotations| annotations.read_only_hint)
            == Some(true)
    }));

    let catalog = call(&client, "get_chip_catalog", json!({})).await;
    assert_eq!(structured(&catalog).as_array().unwrap().len(), 2);
    assert!(!structured(&catalog).to_string().contains("internal:"));

    let ambiguous_chip = call(
        &client,
        "get_register",
        json!({ "chip": "MCP_TEST", "page": "Main", "registerName": "CTRL" }),
    )
    .await;
    assert_eq!(ambiguous_chip.is_error, Some(true));
    assert_eq!(structured(&ambiguous_chip)["code"], "ambiguous_chip");
    assert!(!structured(&ambiguous_chip)
        .to_string()
        .contains("internal:"));

    let ambiguous_register = call(
        &client,
        "get_register",
        json!({
            "chip": "MCP_TEST",
            "sourceSha256": SOURCE_HASH_A,
            "page": "Main",
            "registerName": "CTRL"
        }),
    )
    .await;
    assert_eq!(ambiguous_register.is_error, Some(true));
    assert_eq!(
        structured(&ambiguous_register)["code"],
        "ambiguous_register"
    );
    assert_eq!(
        structured(&ambiguous_register)["details"]["candidates"]
            .as_array()
            .unwrap()
            .len(),
        2
    );

    let search = call(
        &client,
        "search_registers",
        json!({ "query": "CTRL", "limit": 10 }),
    )
    .await;
    assert_eq!(structured(&search)["status"], "ok");
    assert!(!structured(&search).to_string().contains("internal:"));
    assert!(!structured(&search).to_string().contains("score"));

    let no_results = call(
        &client,
        "search_registers",
        json!({ "query": "NO_SUCH_REGISTER_987654321" }),
    )
    .await;
    assert_eq!(structured(&no_results)["status"], "no_results");

    let invalid_filter = call(&client, "search_registers", json!({ "query": "type:" })).await;
    assert_eq!(structured(&invalid_filter)["status"], "invalid_query");
    assert!(!structured(&invalid_filter)["issues"]
        .as_array()
        .unwrap()
        .is_empty());

    let private_search = call(
        &client,
        "search_registers",
        json!({ "query": PRIVATE_NOTE }),
    )
    .await;
    assert_eq!(structured(&private_search)["notesIncluded"], false);
    assert!(!structured(&private_search)
        .to_string()
        .contains(PRIVATE_NOTE));

    let explicit_private_search = call(
        &client,
        "search_registers",
        json!({ "query": PRIVATE_NOTE, "includeNotes": true }),
    )
    .await;
    assert_eq!(structured(&explicit_private_search)["notesIncluded"], true);
    assert!(structured(&explicit_private_search)
        .to_string()
        .contains(PRIVATE_NOTE));

    let register = call(&client, "get_register", register_args(SOURCE_HASH_A, 0)).await;
    assert_eq!(structured(&register)["register"]["name"], "CTRL");
    assert!(!structured(&register).to_string().contains(PRIVATE_NOTE));

    let field = call(
        &client,
        "get_field",
        json!({
            "chip": "MCP_TEST",
            "sourceSha256": SOURCE_HASH_A,
            "page": "Main",
            "registerIndex": 0,
            "fieldName": "MODE",
            "bits": "15:8"
        }),
    )
    .await;
    assert_eq!(structured(&field)["field"]["enums"][0]["value"], "0x1");

    let decoded = call(
        &client,
        "decode_register_value",
        json!({
            "chip": "MCP_TEST",
            "sourceSha256": SOURCE_HASH_A,
            "page": "Main",
            "registerIndex": 0,
            "value": "0x0203"
        }),
    )
    .await;
    assert_eq!(
        structured(&decoded)["decoded"]["fields"][0]["enumStatus"],
        "unknown_value"
    );
    assert_eq!(
        structured(&decoded)["decoded"]["fields"][1]["valueHex"],
        "0x3"
    );

    let clipped = call(
        &client,
        "decode_register_value",
        json!({
            "chip": "MCP_TEST",
            "sourceSha256": SOURCE_HASH_A,
            "page": "Main",
            "registerIndex": 0,
            "value": "0x10000"
        }),
    )
    .await;
    assert_eq!(structured(&clipped)["decoded"]["clipped"], true);
    assert_eq!(structured(&clipped)["decoded"]["valueHex"], "0x0000");

    let wide = call(
        &client,
        "decode_register_value",
        json!({
            "chip": "MCP_TEST",
            "sourceSha256": SOURCE_HASH_A,
            "page": "Wide",
            "registerName": "WIDE",
            "value": "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"
        }),
    )
    .await;
    assert_eq!(structured(&wide)["decoded"]["bitWidth"], 128);
    assert_eq!(
        structured(&wide)["decoded"]["fields"][0]["enumStatus"],
        "matched"
    );

    let comparison = call(
        &client,
        "compare_registers",
        json!({
            "left": register_args(SOURCE_HASH_A, 0),
            "right": register_args(SOURCE_HASH_A, 1)
        }),
    )
    .await;
    assert_eq!(structured(&comparison)["comparison"]["equal"], false);

    let source = call(
        &client,
        "get_source_metadata",
        json!({ "chip": "MCP_TEST", "sourceSha256": SOURCE_HASH_A }),
    )
    .await;
    assert_eq!(structured(&source)["translationPresent"], true);

    let invalid = call(
        &client,
        "decode_register_value",
        json!({
            "chip": "MCP_TEST",
            "sourceSha256": SOURCE_HASH_A,
            "page": "Main",
            "registerIndex": 0,
            "value": "-1"
        }),
    )
    .await;
    assert_eq!(invalid.is_error, Some(true));
    assert_eq!(structured(&invalid)["code"], "invalid_value");

    let beyond_u128 = call(
        &client,
        "decode_register_value",
        json!({
            "chip": "MCP_TEST",
            "sourceSha256": SOURCE_HASH_A,
            "page": "Wide",
            "registerName": "WIDE",
            "value": "0x100000000000000000000000000000000"
        }),
    )
    .await;
    assert_eq!(beyond_u128.is_error, Some(true));
    assert_eq!(structured(&beyond_u128)["code"], "invalid_value");

    client.cancel().await.unwrap();
    assert_eq!(file_hash(&database), hash_before);
    let _ = fs::remove_file(database);
}

#[tokio::test]
async fn mcp_stdio_handles_an_empty_library_without_writing() {
    let database = fixture_path("empty");
    let connection = create_schema(&database);
    drop(connection);
    let hash_before = file_hash(&database);
    let executable = env!("CARGO_BIN_EXE_register-reference-mcp");
    let transport = TokioChildProcess::new(tokio::process::Command::new(executable).configure(
        |command| {
            command.arg("--db").arg(&database);
        },
    ))
    .unwrap();
    let client = ().serve(transport).await.unwrap();
    let catalog = call(&client, "get_chip_catalog", json!({})).await;
    assert_eq!(structured(&catalog), &json!([]));
    let search = call(&client, "search_registers", json!({ "query": "CTRL" })).await;
    assert_eq!(structured(&search)["status"], "no_results");
    client.cancel().await.unwrap();
    assert_eq!(file_hash(&database), hash_before);
    let _ = fs::remove_file(database);
}

#[test]
fn startup_reports_missing_and_incompatible_databases() {
    let executable = env!("CARGO_BIN_EXE_register-reference-mcp");
    let missing = fixture_path("missing");
    let output = Command::new(executable)
        .arg("--db")
        .arg(&missing)
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(String::from_utf8(output.stderr)
        .unwrap()
        .contains("数据库不存在"));

    let incompatible = fixture_path("incompatible");
    Connection::open(&incompatible)
        .unwrap()
        .execute("CREATE TABLE unrelated (id INTEGER)", [])
        .unwrap();
    let output = Command::new(executable)
        .arg("--db")
        .arg(&incompatible)
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(String::from_utf8(output.stderr)
        .unwrap()
        .contains("数据库缺少 chips 表"));
    let _ = fs::remove_file(incompatible);
}

#[test]
fn raw_stdio_emits_only_json_protocol_lines_and_stops_on_eof() {
    let database = fixture_path("raw");
    create_fixture(&database);
    let hash_before = file_hash(&database);
    let executable = env!("CARGO_BIN_EXE_register-reference-mcp");
    let mut child = Command::new(executable)
        .arg("--db")
        .arg(&database)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    {
        let stdin = child.stdin.as_mut().unwrap();
        writeln!(
            stdin,
            "{}",
            json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-06-18",
                    "capabilities": {},
                    "clientInfo": { "name": "raw-smoke", "version": "1" }
                }
            })
        )
        .unwrap();
        writeln!(
            stdin,
            "{}",
            json!({
                "jsonrpc": "2.0",
                "method": "notifications/initialized",
                "params": {}
            })
        )
        .unwrap();
        writeln!(
            stdin,
            "{}",
            json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/list",
                "params": {}
            })
        )
        .unwrap();
    }
    drop(child.stdin.take());
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success());
    let stdout = String::from_utf8(output.stdout).unwrap();
    let lines = stdout
        .lines()
        .filter(|line| !line.trim().is_empty())
        .collect::<Vec<_>>();
    assert!(
        lines.len() >= 2,
        "expected initialize and tools/list responses: {stdout}"
    );
    for line in lines {
        let message: Value = serde_json::from_str(line)
            .unwrap_or_else(|error| panic!("stdout contained non-protocol text {line:?}: {error}"));
        assert_eq!(message["jsonrpc"], "2.0");
    }
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("read-only stdio server"));
    assert_eq!(file_hash(&database), hash_before);
    let _ = fs::remove_file(database);
}

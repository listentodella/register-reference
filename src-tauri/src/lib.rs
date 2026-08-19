use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};
use walkdir::WalkDir;

mod core_service;
mod search;
mod translation;
mod validation;

#[derive(Clone)]
struct DatabasePath(PathBuf);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChipRecord {
    id: String,
    sensor: String,
    vendor: String,
    family: String,
    device_type: String,
    category: String,
    enabled: bool,
    builtin: bool,
    source_kind: String,
    source_name: String,
    source_path: Option<String>,
    source_sha256: String,
    created_at: String,
    updated_at: String,
    yaml_text: String,
    notes: Vec<RegisterNote>,
    attachments: Vec<ChipAttachment>,
    translations: Vec<TranslationRecord>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChipSummary {
    id: String,
    sensor: String,
    vendor: String,
    family: String,
    device_type: String,
    category: String,
    enabled: bool,
    builtin: bool,
    source_kind: String,
    source_name: String,
    source_path: Option<String>,
    source_sha256: String,
    created_at: String,
    updated_at: String,
    notes: Vec<RegisterNote>,
    attachments: Vec<ChipAttachment>,
    translations: Vec<TranslationSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChipDocument {
    chip_data: JsonValue,
    translations: Vec<JsonValue>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RegisterDetailsResponse {
    chip_id: String,
    register: core_service::RegisterDetails,
    source: core_service::SourceMetadata,
    notes: Vec<RegisterNote>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TranslationRecord {
    id: i64,
    source_sha256: String,
    source_file: String,
    source_locale: String,
    locale: String,
    status: String,
    coverage: String,
    method: String,
    translator: String,
    updated: String,
    source_path: Option<String>,
    yaml_text: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TranslationSummary {
    id: i64,
    source_sha256: String,
    source_file: String,
    source_locale: String,
    locale: String,
    status: String,
    coverage: String,
    method: String,
    translator: String,
    updated: String,
    source_path: Option<String>,
    translated_sensor: String,
    translated_family: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RegisterNote {
    id: i64,
    chip_id: String,
    page_name: String,
    register_addr: Option<i64>,
    register_key: String,
    register_name: String,
    kind: String,
    content: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegisterNoteInput {
    note_id: Option<i64>,
    chip_id: String,
    page_name: String,
    register_addr: Option<i64>,
    #[serde(default)]
    register_key: String,
    register_name: String,
    kind: String,
    content: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChipAttachment {
    id: i64,
    chip_id: String,
    file_name: String,
    file_path: String,
    size_bytes: Option<i64>,
    exists: bool,
    created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentImportReport {
    attachments: Vec<ChipAttachment>,
    added: usize,
    canceled: bool,
    failures: Vec<String>,
}

#[derive(Default)]
struct ChipMetadata {
    sensor: String,
    vendor: String,
    family: String,
    device_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportReport {
    imported: usize,
    translations: usize,
    skipped: usize,
    failures: Vec<String>,
    folder: Option<String>,
    canceled: bool,
    changed_chip_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportPreviewReport {
    preview_id: String,
    files: Vec<ImportPreviewFile>,
    failures: Vec<String>,
    folder: Option<String>,
    canceled: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportPreviewFile {
    source_name: String,
    kind: String,
    sensor: String,
    status: String,
    source_hash_changed: bool,
    translation_missing: bool,
    changes: core_service::RegisterComparison,
    #[serde(skip)]
    source_sha256: String,
}

#[derive(Clone)]
struct PendingImportBatch {
    parsed: Vec<ParsedImportFile>,
    category: Option<String>,
    linked: bool,
    operation: String,
    folder: Option<String>,
    fingerprints: Vec<(PathBuf, FileFingerprint)>,
    failures: Vec<String>,
    skipped: usize,
}

#[derive(Default)]
struct PendingImports {
    batches: Mutex<HashMap<String, PendingImportBatch>>,
    counter: AtomicU64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OperationProgress {
    operation: String,
    stage: String,
    current: usize,
    total: usize,
    source_name: String,
}

fn open_database(path: &DatabasePath) -> Result<Connection, String> {
    let connection =
        Connection::open(&path.0).map_err(|error| format!("无法打开芯片库：{error}"))?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| format!("无法设置芯片库等待时间：{error}"))?;
    connection
        .execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|error| format!("无法配置芯片库连接：{error}"))?;
    Ok(connection)
}

fn column_exists(connection: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let query = format!("PRAGMA table_info({table})");
    let columns = connection
        .prepare(&query)
        .and_then(|mut statement| {
            statement
                .query_map([], |row| row.get::<_, String>(1))?
                .collect::<Result<Vec<_>, _>>()
        })
        .map_err(|error| format!("无法检查 {table} 表结构：{error}"))?;
    Ok(columns.iter().any(|candidate| candidate == column))
}

fn add_column_if_missing(
    connection: &Connection,
    table: &str,
    column: &str,
    declaration: &str,
) -> Result<(), String> {
    if column_exists(connection, table, column)? {
        return Ok(());
    }
    connection
        .execute(
            &format!("ALTER TABLE {table} ADD COLUMN {column} {declaration}"),
            [],
        )
        .map_err(|error| format!("无法升级 {table}.{column}：{error}"))?;
    Ok(())
}

fn remove_legacy_builtin_chips(connection: &mut Connection) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| format!("无法开始清理内置芯片事务：{error}"))?;
    let legacy = {
        let mut statement = transaction
            .prepare("SELECT id, source_sha256 FROM chips WHERE builtin = 1")
            .map_err(|error| format!("无法读取旧内置芯片：{error}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|error| format!("无法查询旧内置芯片：{error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("无法读取旧内置芯片：{error}"))?;
        rows
    };
    for (chip_id, _) in &legacy {
        transaction
            .execute("DELETE FROM register_notes WHERE chip_id = ?1", [chip_id])
            .map_err(|error| format!("无法清理内置芯片备注：{error}"))?;
        transaction
            .execute("DELETE FROM chip_attachments WHERE chip_id = ?1", [chip_id])
            .map_err(|error| format!("无法清理内置芯片附件关联：{error}"))?;
        transaction
            .execute("DELETE FROM search_documents WHERE chip_id = ?1", [chip_id])
            .map_err(|error| format!("无法清理内置芯片搜索索引：{error}"))?;
        transaction
            .execute("DELETE FROM chips WHERE id = ?1", [chip_id])
            .map_err(|error| format!("无法清理内置芯片：{error}"))?;
    }
    for (_, source_sha256) in legacy {
        transaction
            .execute(
                "DELETE FROM translations
                 WHERE source_sha256 = ?1
                   AND NOT EXISTS (SELECT 1 FROM chips WHERE source_sha256 = ?1)",
                [source_sha256],
            )
            .map_err(|error| format!("无法清理内置芯片孤立译文：{error}"))?;
    }
    transaction
        .commit()
        .map_err(|error| format!("无法提交内置芯片清理：{error}"))
}

fn initialize_database(path: &DatabasePath) -> Result<(), String> {
    if let Some(parent) = path.0.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建数据目录：{error}"))?;
    }
    let mut connection = open_database(path)?;
    connection
        .execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;")
        .map_err(|error| format!("无法启用芯片库并发模式：{error}"))?;
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS chips (
                id TEXT PRIMARY KEY,
                sensor TEXT NOT NULL,
                vendor TEXT NOT NULL DEFAULT '',
                family TEXT NOT NULL DEFAULT '',
                device_type TEXT NOT NULL DEFAULT '',
                category TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                builtin INTEGER NOT NULL DEFAULT 0,
                source_kind TEXT NOT NULL,
                source_name TEXT NOT NULL,
                source_path TEXT,
                source_sha256 TEXT NOT NULL DEFAULT '',
                source_size INTEGER,
                source_mtime_ns INTEGER,
                translated_sensor TEXT NOT NULL DEFAULT '',
                translated_family TEXT NOT NULL DEFAULT '',
                yaml_text TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS register_notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chip_id TEXT NOT NULL,
                page_name TEXT NOT NULL,
                register_addr INTEGER NOT NULL,
                register_key TEXT NOT NULL DEFAULT '',
                register_name TEXT NOT NULL,
                kind TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_register_notes_chip
                ON register_notes(chip_id, page_name, register_addr, register_name);
            CREATE TABLE IF NOT EXISTS chip_attachments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chip_id TEXT NOT NULL,
                file_name TEXT NOT NULL,
                file_path TEXT NOT NULL,
                size_bytes INTEGER,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(chip_id, file_path)
            );
            CREATE INDEX IF NOT EXISTS idx_chip_attachments_chip
                ON chip_attachments(chip_id, created_at DESC);
            CREATE TABLE IF NOT EXISTS linked_libraries (
                folder_path TEXT PRIMARY KEY,
                category TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );",
        )
        .map_err(|error| format!("无法初始化芯片库：{error}"))?;

    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS translations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_sha256 TEXT NOT NULL,
                source_file TEXT NOT NULL,
                source_locale TEXT NOT NULL,
                locale TEXT NOT NULL,
                status TEXT NOT NULL,
                coverage TEXT NOT NULL,
                method TEXT NOT NULL,
                translator TEXT NOT NULL,
                updated TEXT NOT NULL,
                source_path TEXT,
                source_size INTEGER,
                source_mtime_ns INTEGER,
                yaml_text TEXT NOT NULL,
                source_key TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(source_key, locale)
            );
            CREATE INDEX IF NOT EXISTS idx_translations_source
                ON translations(source_sha256, locale);",
        )
        .map_err(|error| format!("无法初始化翻译库：{error}"))?;

    add_column_if_missing(
        &connection,
        "chips",
        "source_sha256",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    add_column_if_missing(&connection, "chips", "source_size", "INTEGER")?;
    add_column_if_missing(&connection, "chips", "source_mtime_ns", "INTEGER")?;
    add_column_if_missing(&connection, "translations", "source_size", "INTEGER")?;
    add_column_if_missing(&connection, "translations", "source_mtime_ns", "INTEGER")?;
    add_column_if_missing(
        &connection,
        "translations",
        "translated_sensor",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    add_column_if_missing(
        &connection,
        "translations",
        "translated_family",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    connection
        .execute(
            "CREATE INDEX IF NOT EXISTS idx_chips_source_sha256 ON chips(source_sha256)",
            [],
        )
        .map_err(|error| format!("无法创建源文件哈希索引：{error}"))?;
    search::initialize_schema(&connection)?;

    let has_register_key = column_exists(&connection, "register_notes", "register_key")?;
    if !has_register_key {
        connection
            .execute(
                "ALTER TABLE register_notes ADD COLUMN register_key TEXT NOT NULL DEFAULT ''",
                [],
            )
            .map_err(|error| format!("无法升级备注表结构：{error}"))?;
    }
    connection
        .execute(
            "CREATE INDEX IF NOT EXISTS idx_register_notes_key ON register_notes(chip_id, page_name, register_key)",
            [],
        )
        .map_err(|error| format!("无法创建备注编码索引：{error}"))?;
    remove_legacy_builtin_chips(&mut connection)?;
    let stale_hashes = connection
        .prepare("SELECT id, yaml_text FROM chips WHERE source_sha256 = ''")
        .and_then(|mut statement| {
            statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })?
                .collect::<Result<Vec<_>, _>>()
        })
        .map_err(|error| format!("无法读取待升级芯片哈希：{error}"))?;
    for (id, yaml_text) in stale_hashes {
        connection
            .execute(
                "UPDATE chips SET source_sha256 = ?1, source_size = COALESCE(source_size, ?2) WHERE id = ?3",
                params![translation::sha256_hex(&yaml_text), yaml_text.len() as i64, id],
            )
            .map_err(|error| format!("无法升级芯片哈希：{error}"))?;
    }
    Ok(())
}

fn yaml_string(root: &serde_yaml::Mapping, key: &str) -> String {
    root.get(serde_yaml::Value::String(key.to_owned()))
        .and_then(serde_yaml::Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_owned()
}

fn translation_root_string(document: &serde_yaml::Value, name: &str) -> String {
    document
        .as_mapping()
        .and_then(|root| root.get(serde_yaml::Value::String("translations".to_owned())))
        .and_then(serde_yaml::Value::as_mapping)
        .and_then(|translations| translations.get(serde_yaml::Value::String(name.to_owned())))
        .and_then(serde_yaml::Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_owned()
}

#[cfg(test)]
fn parse_metadata(yaml_text: &str) -> Result<ChipMetadata, String> {
    let document: serde_yaml::Value =
        serde_yaml::from_str(yaml_text).map_err(|error| format!("YAML 解析失败：{error}"))?;
    parse_metadata_document(yaml_text, &document)
}

fn parse_metadata_document(
    yaml_text: &str,
    document: &serde_yaml::Value,
) -> Result<ChipMetadata, String> {
    validation::validate_register_yaml(yaml_text, document)?;
    let root = document
        .as_mapping()
        .ok_or_else(|| "YAML 顶层必须是 mapping/object".to_owned())?;
    let pages = root
        .get(serde_yaml::Value::String("pages".to_owned()))
        .and_then(serde_yaml::Value::as_mapping)
        .ok_or_else(|| "YAML 缺少 pages mapping".to_owned())?;
    if pages.is_empty() {
        return Err("YAML 的 pages 不能为空".to_owned());
    }

    let metadata = ChipMetadata {
        sensor: yaml_string(root, "sensor"),
        vendor: yaml_string(root, "vendor"),
        family: yaml_string(root, "family"),
        device_type: yaml_string(root, "device_type"),
    };
    if metadata.sensor.is_empty() {
        return Err("YAML 缺少 sensor".to_owned());
    }
    Ok(metadata)
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct FileFingerprint {
    size: Option<i64>,
    mtime_ns: Option<i64>,
}

fn file_fingerprint(path: &Path) -> FileFingerprint {
    let Ok(metadata) = fs::metadata(path) else {
        return FileFingerprint::default();
    };
    let size = i64::try_from(metadata.len()).ok();
    let mtime_ns = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .and_then(|duration| i64::try_from(duration.as_nanos()).ok());
    FileFingerprint { size, mtime_ns }
}

fn default_category(metadata: &ChipMetadata) -> String {
    if metadata.device_type == "architecture_registers" {
        "架构寄存器".to_owned()
    } else if metadata.device_type == "usb_controller" {
        "接口控制器".to_owned()
    } else {
        "传感器".to_owned()
    }
}

fn normalized_category(category: Option<&str>, metadata: &ChipMetadata) -> String {
    category
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| default_category(metadata))
}

fn stable_hash(value: &str) -> u64 {
    value
        .as_bytes()
        .iter()
        .fold(0xcbf29ce484222325_u64, |hash, byte| {
            (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
        })
}

fn upsert_imported_chip(
    connection: &Connection,
    yaml_text: &str,
    source_name: &str,
    source_path: Option<&Path>,
    category: Option<&str>,
) -> Result<String, String> {
    let document: serde_yaml::Value =
        serde_yaml::from_str(yaml_text).map_err(|error| format!("YAML 解析失败：{error}"))?;
    upsert_imported_chip_document(
        connection,
        yaml_text,
        &document,
        source_name,
        source_path,
        category,
        source_path
            .map(file_fingerprint)
            .unwrap_or(FileFingerprint {
                size: Some(yaml_text.len() as i64),
                mtime_ns: None,
            }),
    )
}

fn upsert_imported_chip_document(
    connection: &Connection,
    yaml_text: &str,
    document: &serde_yaml::Value,
    source_name: &str,
    source_path: Option<&Path>,
    category: Option<&str>,
    fingerprint: FileFingerprint,
) -> Result<String, String> {
    let metadata = parse_metadata_document(yaml_text, document)?;
    let source_key = source_path
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|| format!("{}:{}", source_name, metadata.sensor));
    let source_kind = if source_path.is_some() {
        "linked"
    } else {
        "imported"
    };
    let id = format!("{source_kind}:{:016x}", stable_hash(&source_key));
    let category = normalized_category(category, &metadata);
    let path_text = source_path.map(|path| path.to_string_lossy().into_owned());
    let source_sha256 = translation::sha256_hex(yaml_text);

    connection
        .execute(
            "INSERT INTO chips (
                id, sensor, vendor, family, device_type, category, enabled, builtin,
                source_kind, source_name, source_path, source_sha256, source_size,
                source_mtime_ns, yaml_text
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 0, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
             ON CONFLICT(id) DO UPDATE SET
                sensor = excluded.sensor,
                vendor = excluded.vendor,
                family = excluded.family,
                device_type = excluded.device_type,
                source_kind = excluded.source_kind,
                source_name = excluded.source_name,
                source_path = excluded.source_path,
                source_sha256 = excluded.source_sha256,
                source_size = excluded.source_size,
                source_mtime_ns = excluded.source_mtime_ns,
                yaml_text = excluded.yaml_text,
                updated_at = CURRENT_TIMESTAMP",
            params![
                id,
                metadata.sensor,
                metadata.vendor,
                metadata.family,
                metadata.device_type,
                category,
                source_kind,
                source_name,
                path_text,
                source_sha256,
                fingerprint.size.or(Some(yaml_text.len() as i64)),
                fingerprint.mtime_ns,
                yaml_text
            ],
        )
        .map_err(|error| format!("无法保存 {source_name}：{error}"))?;
    Ok(id)
}

fn matching_source_yaml(connection: &Connection, source_sha256: &str) -> Result<String, String> {
    connection
        .query_row(
            "SELECT yaml_text FROM chips WHERE source_sha256 = ?1 LIMIT 1",
            [source_sha256],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("无法读取英文源 YAML：{error}"))?
        .ok_or_else(|| {
            "找不到与 source_sha256 匹配的英文源 YAML；请先导入对应英文寄存器文件".to_owned()
        })
}

#[cfg(test)]
fn refresh_linked_chips(connection: &Connection) {
    let linked: Vec<(String, String, String)> = connection
        .prepare("SELECT id, source_path, category FROM chips WHERE source_kind = 'linked'")
        .and_then(|mut statement| {
            statement
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
                .collect()
        })
        .unwrap_or_default();
    for (id, source_path, category) in linked {
        let path = PathBuf::from(source_path);
        let Ok(yaml_text) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(document) = serde_yaml::from_str::<serde_yaml::Value>(&yaml_text) else {
            continue;
        };
        if let Ok(updated_id) = upsert_imported_chip_document(
            connection,
            &yaml_text,
            &document,
            path.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("registers.yaml"),
            Some(&path),
            Some(&category),
            file_fingerprint(&path),
        ) {
            let _ = rebuild_chip_search_index(connection, &updated_id);
        } else {
            let _ = id;
        }
    }
}

fn upsert_translation(
    connection: &Connection,
    yaml_text: &str,
    source_name: &str,
    source_path: Option<&Path>,
) -> Result<Vec<String>, String> {
    let document: serde_yaml::Value =
        serde_yaml::from_str(yaml_text).map_err(|error| format!("翻译 YAML 解析失败：{error}"))?;
    upsert_translation_document(
        connection,
        yaml_text,
        &document,
        source_name,
        source_path,
        source_path
            .map(file_fingerprint)
            .unwrap_or(FileFingerprint {
                size: Some(yaml_text.len() as i64),
                mtime_ns: None,
            }),
    )
}

fn upsert_translation_document(
    connection: &Connection,
    yaml_text: &str,
    document: &serde_yaml::Value,
    source_name: &str,
    source_path: Option<&Path>,
    fingerprint: FileFingerprint,
) -> Result<Vec<String>, String> {
    if !translation::is_translation_document(document) {
        return Err("不是 register-reference-translation 翻译 sidecar".to_owned());
    }
    let source_sha256 = document
        .as_mapping()
        .and_then(|root| root.get(serde_yaml::Value::String("source_sha256".to_owned())))
        .and_then(serde_yaml::Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_owned();
    let source_text = matching_source_yaml(connection, &source_sha256)?;
    let source_document: serde_yaml::Value = serde_yaml::from_str(&source_text)
        .map_err(|error| format!("英文源 YAML 解析失败：{error}"))?;
    let summary = translation::validate_translation_yaml(
        yaml_text,
        document,
        &source_text,
        &source_document,
    )?;
    let source_path_text = source_path.map(|path| path.to_string_lossy().into_owned());
    let translated_sensor = translation_root_string(document, "sensor");
    let translated_family = translation_root_string(document, "family");
    let source_key = source_path_text
        .clone()
        .unwrap_or_else(|| format!("imported:{}", summary.source_file));
    let mut affected_source_hashes = connection
        .prepare(
            "SELECT DISTINCT source_sha256 FROM translations
             WHERE source_key = ?1 OR (source_sha256 = ?2 AND locale = ?3)",
        )
        .and_then(|mut statement| {
            statement
                .query_map(
                    params![source_key, summary.source_sha256, summary.locale],
                    |row| row.get::<_, String>(0),
                )?
                .collect::<Result<Vec<_>, _>>()
        })
        .map_err(|error| format!("无法读取待替换译文：{error}"))?;
    if source_path_text.is_some() {
        connection
            .execute(
                "DELETE FROM translations WHERE source_key = ?1 AND locale <> ?2",
                params![source_key, summary.locale],
            )
            .map_err(|error| format!("无法更新关联译文语言：{error}"))?;
    }
    connection
        .execute(
            "DELETE FROM translations
             WHERE source_sha256 = ?1 AND locale = ?2 AND source_key <> ?3",
            params![summary.source_sha256, summary.locale, source_key],
        )
        .map_err(|error| format!("无法替换同语言旧译文：{error}"))?;
    connection
        .execute(
            "INSERT INTO translations (
                source_sha256, source_file, source_locale, locale, status, coverage, method,
                translator, updated, source_path, source_size, source_mtime_ns,
                translated_sensor, translated_family, yaml_text, source_key
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
             ON CONFLICT(source_key, locale) DO UPDATE SET
                source_sha256 = excluded.source_sha256,
                source_file = excluded.source_file,
                source_locale = excluded.source_locale,
                status = excluded.status,
                coverage = excluded.coverage,
                method = excluded.method,
                translator = excluded.translator,
                updated = excluded.updated,
                source_path = excluded.source_path,
                source_size = excluded.source_size,
                source_mtime_ns = excluded.source_mtime_ns,
                translated_sensor = excluded.translated_sensor,
                translated_family = excluded.translated_family,
                yaml_text = excluded.yaml_text,
                updated_at = CURRENT_TIMESTAMP",
            params![
                summary.source_sha256,
                summary.source_file,
                summary.source_locale,
                summary.locale,
                summary.status,
                summary.coverage,
                summary.method,
                summary.translator,
                summary.updated,
                source_path_text,
                fingerprint.size.or(Some(yaml_text.len() as i64)),
                fingerprint.mtime_ns,
                translated_sensor,
                translated_family,
                yaml_text,
                source_key,
            ],
        )
        .map_err(|error| format!("无法保存译文 {source_name}：{error}"))?;
    affected_source_hashes.push(summary.source_sha256);
    affected_source_hashes.sort();
    affected_source_hashes.dedup();
    Ok(affected_source_hashes)
}

fn query_chips(connection: &Connection) -> Result<Vec<ChipRecord>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, sensor, vendor, family, device_type, category, enabled, builtin,
                    source_kind, source_name, source_path, source_sha256, created_at, updated_at, yaml_text
             FROM chips
             ORDER BY category COLLATE NOCASE, sensor COLLATE NOCASE",
        )
        .map_err(|error| format!("无法读取芯片库：{error}"))?;
    let mut records = statement
        .query_map([], |row| {
            Ok(ChipRecord {
                id: row.get(0)?,
                sensor: row.get(1)?,
                vendor: row.get(2)?,
                family: row.get(3)?,
                device_type: row.get(4)?,
                category: row.get(5)?,
                enabled: row.get::<_, i64>(6)? != 0,
                builtin: row.get::<_, i64>(7)? != 0,
                source_kind: row.get(8)?,
                source_name: row.get(9)?,
                source_path: row.get(10)?,
                source_sha256: row.get(11)?,
                created_at: row.get(12)?,
                updated_at: row.get(13)?,
                yaml_text: row.get(14)?,
                notes: Vec::new(),
                attachments: Vec::new(),
                translations: Vec::new(),
            })
        })
        .map_err(|error| format!("无法查询芯片库：{error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("无法读取芯片记录：{error}"))?;
    drop(statement);

    let mut notes_by_chip: HashMap<String, Vec<RegisterNote>> = HashMap::new();
    for note in query_register_notes(connection, None)? {
        notes_by_chip
            .entry(note.chip_id.clone())
            .or_default()
            .push(note);
    }
    for record in &mut records {
        record.notes = notes_by_chip.remove(&record.id).unwrap_or_default();
    }
    let mut attachments_by_chip: HashMap<String, Vec<ChipAttachment>> = HashMap::new();
    for attachment in query_chip_attachments(connection, None)? {
        attachments_by_chip
            .entry(attachment.chip_id.clone())
            .or_default()
            .push(attachment);
    }
    for record in &mut records {
        record.attachments = attachments_by_chip.remove(&record.id).unwrap_or_default();
    }
    let translations = query_translations(connection)?;
    let mut translations_by_sha: HashMap<String, Vec<TranslationRecord>> = HashMap::new();
    for item in translations {
        translations_by_sha
            .entry(item.source_sha256.clone())
            .or_default()
            .push(item);
    }
    for record in &mut records {
        record.translations = translations_by_sha
            .get(&record.source_sha256)
            .cloned()
            .unwrap_or_default();
    }
    Ok(records)
}

fn query_translations(connection: &Connection) -> Result<Vec<TranslationRecord>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, source_sha256, source_file, source_locale, locale, status, coverage,
                    method, translator, updated, source_path, yaml_text
             FROM translations
             ORDER BY locale COLLATE NOCASE, source_file COLLATE NOCASE, id DESC",
        )
        .map_err(|error| format!("无法读取翻译库：{error}"))?;
    let records = statement
        .query_map([], |row| {
            Ok(TranslationRecord {
                id: row.get(0)?,
                source_sha256: row.get(1)?,
                source_file: row.get(2)?,
                source_locale: row.get(3)?,
                locale: row.get(4)?,
                status: row.get(5)?,
                coverage: row.get(6)?,
                method: row.get(7)?,
                translator: row.get(8)?,
                updated: row.get(9)?,
                source_path: row.get(10)?,
                yaml_text: row.get(11)?,
            })
        })
        .map_err(|error| format!("无法查询翻译库：{error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("无法读取翻译记录：{error}"))?;
    Ok(records)
}

fn query_translation_summaries(connection: &Connection) -> Result<Vec<TranslationSummary>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, source_sha256, source_file, source_locale, locale, status, coverage,
                    method, translator, updated, source_path, translated_sensor, translated_family
             FROM translations
             ORDER BY locale COLLATE NOCASE, source_file COLLATE NOCASE, id DESC",
        )
        .map_err(|error| format!("无法读取翻译摘要：{error}"))?;
    let records = statement
        .query_map([], |row| {
            Ok(TranslationSummary {
                id: row.get(0)?,
                source_sha256: row.get(1)?,
                source_file: row.get(2)?,
                source_locale: row.get(3)?,
                locale: row.get(4)?,
                status: row.get(5)?,
                coverage: row.get(6)?,
                method: row.get(7)?,
                translator: row.get(8)?,
                updated: row.get(9)?,
                source_path: row.get(10)?,
                translated_sensor: row.get(11)?,
                translated_family: row.get(12)?,
            })
        })
        .map_err(|error| format!("无法查询翻译摘要：{error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("无法读取翻译摘要：{error}"))?;
    Ok(records)
}

fn query_chip_summaries(connection: &Connection) -> Result<Vec<ChipSummary>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, sensor, vendor, family, device_type, category, enabled, builtin,
                    source_kind, source_name, source_path, source_sha256, created_at, updated_at
             FROM chips
             ORDER BY category COLLATE NOCASE, sensor COLLATE NOCASE",
        )
        .map_err(|error| format!("无法读取芯片摘要：{error}"))?;
    let mut records = statement
        .query_map([], |row| {
            Ok(ChipSummary {
                id: row.get(0)?,
                sensor: row.get(1)?,
                vendor: row.get(2)?,
                family: row.get(3)?,
                device_type: row.get(4)?,
                category: row.get(5)?,
                enabled: row.get::<_, i64>(6)? != 0,
                builtin: row.get::<_, i64>(7)? != 0,
                source_kind: row.get(8)?,
                source_name: row.get(9)?,
                source_path: row.get(10)?,
                source_sha256: row.get(11)?,
                created_at: row.get(12)?,
                updated_at: row.get(13)?,
                notes: Vec::new(),
                attachments: Vec::new(),
                translations: Vec::new(),
            })
        })
        .map_err(|error| format!("无法查询芯片摘要：{error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("无法读取芯片摘要：{error}"))?;
    drop(statement);

    let mut notes_by_chip: HashMap<String, Vec<RegisterNote>> = HashMap::new();
    for note in query_register_notes(connection, None)? {
        notes_by_chip
            .entry(note.chip_id.clone())
            .or_default()
            .push(note);
    }
    let mut attachments_by_chip: HashMap<String, Vec<ChipAttachment>> = HashMap::new();
    for attachment in query_chip_attachments(connection, None)? {
        attachments_by_chip
            .entry(attachment.chip_id.clone())
            .or_default()
            .push(attachment);
    }
    let mut translations_by_sha: HashMap<String, Vec<TranslationSummary>> = HashMap::new();
    for translation in query_translation_summaries(connection)? {
        translations_by_sha
            .entry(translation.source_sha256.clone())
            .or_default()
            .push(translation);
    }
    for record in &mut records {
        record.notes = notes_by_chip.remove(&record.id).unwrap_or_default();
        record.attachments = attachments_by_chip.remove(&record.id).unwrap_or_default();
        record.translations = translations_by_sha
            .get(&record.source_sha256)
            .cloned()
            .unwrap_or_default();
    }
    Ok(records)
}

fn load_chip_document_from_database(
    connection: &Connection,
    chip_id: &str,
) -> Result<ChipDocument, String> {
    let (yaml_text, source_sha256) = connection
        .query_row(
            "SELECT yaml_text, source_sha256 FROM chips WHERE id = ?1",
            [chip_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|error| format!("无法读取芯片正文：{error}"))?
        .ok_or_else(|| "没有找到该芯片".to_owned())?;
    let yaml = serde_yaml::from_str::<serde_yaml::Value>(&yaml_text)
        .map_err(|error| format!("芯片 YAML 解析失败：{error}"))?;
    let chip_data = yaml_to_json(yaml)?;
    let mut statement = connection
        .prepare(
            "SELECT yaml_text FROM translations WHERE source_sha256 = ?1 ORDER BY locale, id DESC",
        )
        .map_err(|error| format!("无法读取芯片译文：{error}"))?;
    let translation_texts = statement
        .query_map([source_sha256], |row| row.get::<_, String>(0))
        .map_err(|error| format!("无法查询芯片译文：{error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("无法读取芯片译文：{error}"))?;
    let translations = translation_texts
        .into_iter()
        .map(|text| {
            serde_yaml::from_str::<serde_yaml::Value>(&text)
                .map_err(|error| format!("翻译 YAML 解析失败：{error}"))
                .and_then(yaml_to_json)
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ChipDocument {
        chip_data,
        translations,
    })
}

fn yaml_metadata_text(root: Option<&serde_yaml::Mapping>, name: &str) -> String {
    root.and_then(|mapping| mapping.get(serde_yaml::Value::String(name.to_owned())))
        .map(|value| match value {
            serde_yaml::Value::String(value) => value.clone(),
            _ => serde_yaml::to_string(value)
                .unwrap_or_default()
                .trim()
                .to_owned(),
        })
        .unwrap_or_default()
}

fn chip_source_from_database(
    connection: &Connection,
    chip_id: &str,
) -> Result<(serde_yaml::Value, core_service::SourceMetadata), String> {
    let (yaml_text, source_sha256, source_name, source_path, created_at, updated_at) = connection
        .query_row(
            "SELECT yaml_text, source_sha256, source_name, source_path, created_at, updated_at
             FROM chips WHERE id = ?1",
            [chip_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("无法读取芯片来源：{error}"))?
        .ok_or_else(|| "没有找到该芯片".to_owned())?;
    let source: serde_yaml::Value =
        serde_yaml::from_str(&yaml_text).map_err(|error| format!("芯片 YAML 解析失败：{error}"))?;
    let source_root = source
        .as_mapping()
        .and_then(|root| root.get(serde_yaml::Value::String("source".to_owned())))
        .and_then(serde_yaml::Value::as_mapping);
    let translation_locales = connection
        .prepare(
            "SELECT DISTINCT locale FROM translations WHERE source_sha256 = ?1 ORDER BY locale",
        )
        .and_then(|mut statement| {
            statement
                .query_map([source_sha256.as_str()], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()
        })
        .map_err(|error| format!("无法读取译文来源：{error}"))?;
    let source_version = {
        let version = yaml_metadata_text(source_root, "version");
        if version.is_empty() {
            yaml_metadata_text(source_root, "revision")
        } else {
            version
        }
    };
    let source_title = yaml_metadata_text(source_root, "title");
    let source_document = yaml_metadata_text(source_root, "document");
    Ok((
        source,
        core_service::SourceMetadata {
            source_name,
            source_path,
            source_sha256,
            source_title,
            source_version,
            source_document,
            imported_at: created_at,
            updated_at,
            translation_present: !translation_locales.is_empty(),
            translation_locales,
        },
    ))
}

fn register_details_from_database(
    connection: &Connection,
    chip_id: &str,
    page_name: &str,
    register_index: usize,
) -> Result<RegisterDetailsResponse, String> {
    let (source, source_metadata) = chip_source_from_database(connection, chip_id)?;
    let register = core_service::get_register(&source, page_name, register_index)
        .ok_or_else(|| "没有找到该寄存器".to_owned())?;
    let notes = query_register_notes(connection, Some(chip_id))?
        .into_iter()
        .filter(|note| note.page_name == page_name && note.register_name == register.name)
        .collect();
    Ok(RegisterDetailsResponse {
        chip_id: chip_id.to_owned(),
        register,
        source: source_metadata,
        notes,
    })
}

fn search_chip_context(
    connection: &Connection,
    chip_id: &str,
) -> Result<search::SearchChipContext, String> {
    connection
        .query_row(
            "SELECT id, sensor, vendor, family, category, enabled FROM chips WHERE id = ?1",
            [chip_id],
            |row| {
                Ok(search::SearchChipContext {
                    id: row.get(0)?,
                    sensor: row.get(1)?,
                    vendor: row.get(2)?,
                    family: row.get(3)?,
                    category: row.get(4)?,
                    enabled: row.get::<_, i64>(5)? != 0,
                })
            },
        )
        .map_err(|error| format!("无法读取搜索芯片信息：{error}"))
}

fn search_notes(connection: &Connection, chip_id: &str) -> Result<Vec<search::SearchNote>, String> {
    Ok(query_register_notes(connection, Some(chip_id))?
        .into_iter()
        .map(|note| search::SearchNote {
            id: note.id,
            page_name: note.page_name,
            register_name: note.register_name,
            register_key: note.register_key,
            content: note.content,
            kind: note.kind,
        })
        .collect())
}

fn rebuild_chip_search_index(connection: &Connection, chip_id: &str) -> Result<(), String> {
    let yaml_text = connection
        .query_row(
            "SELECT yaml_text FROM chips WHERE id = ?1",
            [chip_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(|error| format!("无法读取搜索源文件：{error}"))?;
    let source = serde_yaml::from_str::<serde_yaml::Value>(&yaml_text)
        .map_err(|error| format!("搜索源 YAML 解析失败：{error}"))?;
    replace_chip_search_index_with_source(connection, chip_id, &source)
}

fn replace_chip_search_index_with_source(
    connection: &Connection,
    chip_id: &str,
    source: &serde_yaml::Value,
) -> Result<(), String> {
    let chip = search_chip_context(connection, chip_id)?;
    let source_sha256 = connection
        .query_row(
            "SELECT source_sha256 FROM chips WHERE id = ?1",
            [chip_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(|error| format!("无法读取搜索源哈希：{error}"))?;
    let mut statement = connection
        .prepare(
            "SELECT yaml_text FROM translations WHERE source_sha256 = ?1 ORDER BY locale, id DESC",
        )
        .map_err(|error| format!("无法读取搜索译文：{error}"))?;
    let translation_texts = statement
        .query_map([source_sha256], |row| row.get::<_, String>(0))
        .map_err(|error| format!("无法查询搜索译文：{error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("无法读取搜索译文：{error}"))?;
    let translations = translation_texts
        .into_iter()
        .map(|text| {
            serde_yaml::from_str::<serde_yaml::Value>(&text)
                .map_err(|error| format!("搜索译文解析失败：{error}"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let translation_refs = translations.iter().collect::<Vec<_>>();
    search::replace_chip_documents(
        connection,
        &chip,
        source,
        &translation_refs,
        &search_notes(connection, chip_id)?,
    )
}

fn rebuild_note_search_index(connection: &Connection, chip_id: &str) -> Result<(), String> {
    let chip = search_chip_context(connection, chip_id)?;
    search::replace_note_documents(connection, &chip, &search_notes(connection, chip_id)?)
}

fn query_chip_attachments(
    connection: &Connection,
    chip_id: Option<&str>,
) -> Result<Vec<ChipAttachment>, String> {
    let query = if chip_id.is_some() {
        "SELECT id, chip_id, file_name, file_path, size_bytes, created_at
         FROM chip_attachments
         WHERE chip_id = ?1
         ORDER BY created_at DESC, id DESC"
    } else {
        "SELECT id, chip_id, file_name, file_path, size_bytes, created_at
         FROM chip_attachments
         ORDER BY created_at DESC, id DESC"
    };
    let mut statement = connection
        .prepare(query)
        .map_err(|error| format!("无法读取芯片附件：{error}"))?;
    let map_row = |row: &rusqlite::Row<'_>| {
        let file_path: String = row.get(3)?;
        Ok(ChipAttachment {
            id: row.get(0)?,
            chip_id: row.get(1)?,
            file_name: row.get(2)?,
            exists: Path::new(&file_path).is_file(),
            file_path,
            size_bytes: row.get(4)?,
            created_at: row.get(5)?,
        })
    };
    let attachments = match chip_id {
        Some(chip_id) => statement
            .query_map(params![chip_id], map_row)
            .map_err(|error| format!("无法查询芯片附件：{error}"))?
            .collect::<Result<Vec<_>, _>>(),
        None => statement
            .query_map([], map_row)
            .map_err(|error| format!("无法查询芯片附件：{error}"))?
            .collect::<Result<Vec<_>, _>>(),
    }
    .map_err(|error| format!("无法读取芯片附件：{error}"))?;
    Ok(attachments)
}

fn query_register_notes(
    connection: &Connection,
    chip_id: Option<&str>,
) -> Result<Vec<RegisterNote>, String> {
    let query = if chip_id.is_some() {
        "SELECT id, chip_id, page_name, register_addr, register_key, register_name, kind, content,
                created_at, updated_at
         FROM register_notes
         WHERE chip_id = ?1
         ORDER BY updated_at DESC, id DESC"
    } else {
        "SELECT id, chip_id, page_name, register_addr, register_key, register_name, kind, content,
                created_at, updated_at
         FROM register_notes
         ORDER BY updated_at DESC, id DESC"
    };
    let mut statement = connection
        .prepare(query)
        .map_err(|error| format!("无法读取寄存器备注：{error}"))?;
    let map_row = |row: &rusqlite::Row<'_>| {
        Ok(RegisterNote {
            id: row.get(0)?,
            chip_id: row.get(1)?,
            page_name: row.get(2)?,
            register_addr: row
                .get::<_, i64>(3)
                .map(|value| (value >= 0).then_some(value))?,
            register_key: row.get(4)?,
            register_name: row.get(5)?,
            kind: row.get(6)?,
            content: row.get(7)?,
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
        })
    };
    let notes = match chip_id {
        Some(chip_id) => statement
            .query_map(params![chip_id], map_row)
            .map_err(|error| format!("无法查询寄存器备注：{error}"))?
            .collect::<Result<Vec<_>, _>>(),
        None => statement
            .query_map([], map_row)
            .map_err(|error| format!("无法查询寄存器备注：{error}"))?
            .collect::<Result<Vec<_>, _>>(),
    }
    .map_err(|error| format!("无法读取寄存器备注：{error}"))?;
    Ok(notes)
}

fn yaml_identity_scalar(value: &serde_yaml::Value) -> Option<String> {
    value
        .as_str()
        .map(str::to_owned)
        .or_else(|| value.as_i64().map(|value| value.to_string()))
        .or_else(|| value.as_u64().map(|value| value.to_string()))
}

fn yaml_register_identity(register: &serde_yaml::Mapping) -> Option<String> {
    let name = register
        .get(serde_yaml::Value::String("name".to_owned()))
        .and_then(serde_yaml::Value::as_str)?;
    if let Some(encoding) = register
        .get(serde_yaml::Value::String("encoding".to_owned()))
        .and_then(serde_yaml::Value::as_mapping)
    {
        let scheme = encoding
            .get(serde_yaml::Value::String("scheme".to_owned()))
            .and_then(serde_yaml::Value::as_str)
            .unwrap_or("architecture_system");
        if scheme == "riscv_csr" {
            let address = encoding
                .get(serde_yaml::Value::String("address".to_owned()))
                .and_then(yaml_identity_scalar)
                .unwrap_or_else(|| "?".to_owned());
            return Some(format!("riscv_csr:address={address}:{name}"));
        }
        let values = [
            "op0", "op1", "crn", "crm", "crd", "op2", "coproc", "opc1", "opc2", "r", "m", "m1",
            "reg", "selector",
        ]
        .into_iter()
        .filter_map(|key| {
            encoding
                .get(serde_yaml::Value::String(key.to_owned()))
                .and_then(yaml_identity_scalar)
                .map(|value| format!("{key}={value}"))
        })
        .collect::<Vec<_>>()
        .join(":");
        return Some(format!("{scheme}:{values}:{name}"));
    }
    let address = register
        .get(serde_yaml::Value::String("addr".to_owned()))
        .and_then(|value| {
            value
                .as_i64()
                .or_else(|| value.as_u64().and_then(|number| number.try_into().ok()))
        })?;
    Some(format!("mmio:{address}:{name}"))
}

fn yaml_contains_register(
    yaml_text: &str,
    page_name: &str,
    register_addr: Option<i64>,
    register_key: &str,
    register_name: &str,
) -> bool {
    let Ok(document) = serde_yaml::from_str::<serde_yaml::Value>(yaml_text) else {
        return false;
    };
    document
        .as_mapping()
        .and_then(|root| root.get(serde_yaml::Value::String("pages".to_owned())))
        .and_then(serde_yaml::Value::as_mapping)
        .and_then(|pages| pages.get(serde_yaml::Value::String(page_name.to_owned())))
        .and_then(serde_yaml::Value::as_mapping)
        .and_then(|page| page.get(serde_yaml::Value::String("registers".to_owned())))
        .and_then(serde_yaml::Value::as_sequence)
        .is_some_and(|registers| {
            registers.iter().any(|register| {
                let Some(register) = register.as_mapping() else {
                    return false;
                };
                let address = register
                    .get(serde_yaml::Value::String("addr".to_owned()))
                    .and_then(|value| {
                        value
                            .as_i64()
                            .or_else(|| value.as_u64().and_then(|number| number.try_into().ok()))
                    });
                let name = register
                    .get(serde_yaml::Value::String("name".to_owned()))
                    .and_then(serde_yaml::Value::as_str);
                let address_matches =
                    register_addr.is_none_or(|expected| address == Some(expected));
                let key_matches = register_key.is_empty()
                    || yaml_register_identity(register).as_deref() == Some(register_key);
                address_matches && key_matches && name == Some(register_name)
            })
        })
}

fn upsert_register_note(
    connection: &Connection,
    input: &RegisterNoteInput,
) -> Result<Vec<RegisterNote>, String> {
    let chip_id = input.chip_id.trim();
    let page_name = input.page_name.trim();
    let register_name = input.register_name.trim();
    let register_key = input.register_key.trim();
    let kind = input.kind.trim();
    let content = input.content.trim();
    if chip_id.is_empty() || page_name.is_empty() || register_name.is_empty() {
        return Err("备注缺少芯片、页面或寄存器定位信息".to_owned());
    }
    if input.register_addr.is_some_and(|address| address < 0) {
        return Err("寄存器地址不能为负数".to_owned());
    }
    if input.register_addr.is_none() && register_key.is_empty() {
        return Err("系统寄存器备注缺少稳定编码定位信息".to_owned());
    }
    if !matches!(kind, "note" | "warning" | "todo") {
        return Err("备注类型必须是 note、warning 或 todo".to_owned());
    }
    if content.is_empty() {
        return Err("备注内容不能为空".to_owned());
    }
    if content.chars().count() > 4000 {
        return Err("备注内容不能超过 4000 个字符".to_owned());
    }
    let yaml_text = connection
        .query_row(
            "SELECT yaml_text FROM chips WHERE id = ?1",
            params![chip_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("无法确认备注所属芯片：{error}"))?;
    let Some(yaml_text) = yaml_text else {
        return Err("备注所属芯片不存在".to_owned());
    };
    if !yaml_contains_register(
        &yaml_text,
        page_name,
        input.register_addr,
        register_key,
        register_name,
    ) {
        return Err("目标寄存器不存在；芯片 YAML 可能已经更新".to_owned());
    }

    if let Some(note_id) = input.note_id {
        let changed = connection
            .execute(
                "UPDATE register_notes SET
                    page_name = ?1,
                    register_addr = ?2,
                    register_key = ?3,
                    register_name = ?4,
                    kind = ?5,
                    content = ?6,
                    updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?7 AND chip_id = ?8",
                params![
                    page_name,
                    input.register_addr.unwrap_or(-1),
                    register_key,
                    register_name,
                    kind,
                    content,
                    note_id,
                    chip_id
                ],
            )
            .map_err(|error| format!("无法更新寄存器备注：{error}"))?;
        if changed == 0 {
            return Err("没有找到要更新的备注".to_owned());
        }
    } else {
        connection
            .execute(
                "INSERT INTO register_notes (
                    chip_id, page_name, register_addr, register_key, register_name, kind, content
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    chip_id,
                    page_name,
                    input.register_addr.unwrap_or(-1),
                    register_key,
                    register_name,
                    kind,
                    content
                ],
            )
            .map_err(|error| format!("无法保存寄存器备注：{error}"))?;
    }
    query_register_notes(connection, Some(chip_id))
}

fn remove_register_note(
    connection: &Connection,
    chip_id: &str,
    note_id: i64,
) -> Result<Vec<RegisterNote>, String> {
    connection
        .execute(
            "DELETE FROM register_notes WHERE id = ?1 AND chip_id = ?2",
            params![note_id, chip_id],
        )
        .map_err(|error| format!("无法删除寄存器备注：{error}"))?;
    query_register_notes(connection, Some(chip_id))
}

fn add_attachment_paths(
    connection: &Connection,
    chip_id: &str,
    paths: &[PathBuf],
) -> Result<(Vec<ChipAttachment>, usize, Vec<String>), String> {
    let chip_id = chip_id.trim();
    let chip_exists = connection
        .query_row(
            "SELECT 1 FROM chips WHERE id = ?1",
            params![chip_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(|error| format!("无法确认附件所属芯片：{error}"))?
        .is_some();
    if !chip_exists {
        return Err("附件所属芯片不存在".to_owned());
    }

    let mut added = 0;
    let mut failures = Vec::new();
    for selected_path in paths {
        let canonical = match fs::canonicalize(selected_path) {
            Ok(path) => path,
            Err(error) => {
                failures.push(format!("{}：无法读取（{error}）", selected_path.display()));
                continue;
            }
        };
        let metadata = match fs::metadata(&canonical) {
            Ok(metadata) if metadata.is_file() => metadata,
            Ok(_) => {
                failures.push(format!("{}：不是普通文件", canonical.display()));
                continue;
            }
            Err(error) => {
                failures.push(format!("{}：无法读取（{error}）", canonical.display()));
                continue;
            }
        };
        let file_name = canonical
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "附件".to_owned());
        let file_path = canonical.to_string_lossy().into_owned();
        let size_bytes = i64::try_from(metadata.len()).ok();
        added += connection
            .execute(
                "INSERT OR IGNORE INTO chip_attachments (
                    chip_id, file_name, file_path, size_bytes
                 ) VALUES (?1, ?2, ?3, ?4)",
                params![chip_id, file_name, file_path, size_bytes],
            )
            .map_err(|error| format!("无法保存附件关联：{error}"))?;
    }
    Ok((
        query_chip_attachments(connection, Some(chip_id))?,
        added,
        failures,
    ))
}

fn remove_chip_attachment(
    connection: &Connection,
    chip_id: &str,
    attachment_id: i64,
) -> Result<Vec<ChipAttachment>, String> {
    connection
        .execute(
            "DELETE FROM chip_attachments WHERE id = ?1 AND chip_id = ?2",
            params![attachment_id, chip_id],
        )
        .map_err(|error| format!("无法移除附件关联：{error}"))?;
    query_chip_attachments(connection, Some(chip_id))
}

fn stored_attachment_path(
    connection: &Connection,
    chip_id: &str,
    attachment_id: i64,
) -> Result<PathBuf, String> {
    let path = connection
        .query_row(
            "SELECT file_path FROM chip_attachments WHERE id = ?1 AND chip_id = ?2",
            params![attachment_id, chip_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("无法读取附件路径：{error}"))?
        .ok_or_else(|| "没有找到该附件".to_owned())?;
    let path = PathBuf::from(path);
    if !path.is_file() {
        return Err("附件文件不存在或已经移动".to_owned());
    }
    Ok(path)
}

fn launch_path(path: &Path, reveal: bool) -> Result<(), tauri_plugin_opener::Error> {
    if reveal {
        tauri_plugin_opener::reveal_item_in_dir(path)
    } else {
        tauri_plugin_opener::open_path(path, None::<&str>)
    }
}

#[derive(Clone)]
struct ParsedImportFile {
    path: PathBuf,
    source_name: String,
    yaml_text: String,
    document: serde_yaml::Value,
    fingerprint: FileFingerprint,
}

fn emit_progress(
    app: &AppHandle,
    operation: &str,
    stage: &str,
    current: usize,
    total: usize,
    source_name: &str,
) {
    let _ = app.emit(
        "library-operation-progress",
        OperationProgress {
            operation: operation.to_owned(),
            stage: stage.to_owned(),
            current,
            total,
            source_name: source_name.to_owned(),
        },
    );
}

fn linked_path_unchanged(
    connection: &Connection,
    path: &Path,
    fingerprint: FileFingerprint,
) -> bool {
    let path_text = path.to_string_lossy();
    let source_match = connection
        .query_row(
            "SELECT 1 FROM chips
             WHERE source_path = ?1 AND source_size IS ?2 AND source_mtime_ns IS ?3",
            params![path_text.as_ref(), fingerprint.size, fingerprint.mtime_ns],
            |_| Ok(()),
        )
        .optional()
        .ok()
        .flatten()
        .is_some();
    if source_match {
        return true;
    }
    connection
        .query_row(
            "SELECT 1 FROM translations
             WHERE source_path = ?1 AND source_size IS ?2 AND source_mtime_ns IS ?3",
            params![path_text.as_ref(), fingerprint.size, fingerprint.mtime_ns],
            |_| Ok(()),
        )
        .optional()
        .ok()
        .flatten()
        .is_some()
}

fn yaml_paths_in_folder(folder: &Path) -> Vec<PathBuf> {
    let mut paths = WalkDir::new(folder)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .map(|entry| entry.into_path())
        .filter(|path| {
            matches!(
                path.extension()
                    .and_then(|value| value.to_str())
                    .unwrap_or_default()
                    .to_ascii_lowercase()
                    .as_str(),
                "yaml" | "yml"
            )
        })
        .collect::<Vec<_>>();
    paths.sort();
    paths
}

fn chip_ids_for_source_hash(
    connection: &Connection,
    source_sha256: &str,
) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare("SELECT id FROM chips WHERE source_sha256 = ?1")
        .map_err(|error| format!("无法定位译文所属芯片：{error}"))?;
    let chip_ids = statement
        .query_map([source_sha256], |row| row.get::<_, String>(0))
        .map_err(|error| format!("无法查询译文所属芯片：{error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("无法读取译文所属芯片：{error}"))?;
    Ok(chip_ids)
}

#[allow(clippy::too_many_arguments)]
fn import_parsed_files(
    mut connection: Connection,
    app: &AppHandle,
    parsed: Vec<ParsedImportFile>,
    category: Option<&str>,
    linked: bool,
    operation: &str,
    folder: Option<String>,
    mut failures: Vec<String>,
    skipped: usize,
) -> Result<ImportReport, String> {
    let (source_files, translation_files): (Vec<_>, Vec<_>) = parsed
        .into_iter()
        .partition(|item| !translation::is_translation_document(&item.document));
    let transaction = connection
        .transaction()
        .map_err(|error| format!("无法开始导入事务：{error}"))?;
    if linked {
        if let Some(folder_path) = folder.as_deref() {
            transaction
                .execute(
                    "INSERT INTO linked_libraries(folder_path, category) VALUES (?1, ?2)
                     ON CONFLICT(folder_path) DO UPDATE SET
                        category = COALESCE(excluded.category, linked_libraries.category),
                        updated_at = CURRENT_TIMESTAMP",
                    params![folder_path, category],
                )
                .map_err(|error| format!("无法保存关联目录：{error}"))?;
        }
    }
    let mut imported = 0;
    let mut translated = 0;
    let mut changed_ids = HashSet::new();
    let mut parsed_sources = HashMap::new();
    let work_total = source_files.len() + translation_files.len();
    let mut current = 0;

    for item in source_files {
        current += 1;
        emit_progress(
            app,
            operation,
            "validating",
            current,
            work_total,
            &item.source_name,
        );
        let source_path = linked.then_some(item.path.as_path());
        match upsert_imported_chip_document(
            &transaction,
            &item.yaml_text,
            &item.document,
            &item.source_name,
            source_path,
            category,
            item.fingerprint,
        ) {
            Ok(chip_id) => {
                imported += 1;
                changed_ids.insert(chip_id.clone());
                parsed_sources.insert(chip_id, item.document);
            }
            Err(error) => failures.push(format!("{}: {error}", item.path.display())),
        }
    }
    for item in translation_files {
        current += 1;
        emit_progress(
            app,
            operation,
            "validating",
            current,
            work_total,
            &item.source_name,
        );
        let source_path = linked.then_some(item.path.as_path());
        match upsert_translation_document(
            &transaction,
            &item.yaml_text,
            &item.document,
            &item.source_name,
            source_path,
            item.fingerprint,
        ) {
            Ok(affected_source_hashes) => {
                translated += 1;
                for source_sha256 in affected_source_hashes {
                    for chip_id in chip_ids_for_source_hash(&transaction, &source_sha256)? {
                        changed_ids.insert(chip_id);
                    }
                }
            }
            Err(error) => failures.push(format!("{}: {error}", item.path.display())),
        }
    }
    let mut changed_chip_ids = changed_ids.into_iter().collect::<Vec<_>>();
    changed_chip_ids.sort();
    for (index, chip_id) in changed_chip_ids.iter().enumerate() {
        emit_progress(
            app,
            operation,
            "indexing",
            index + 1,
            changed_chip_ids.len(),
            chip_id,
        );
        if let Some(source) = parsed_sources.get(chip_id) {
            replace_chip_search_index_with_source(&transaction, chip_id, source)
        } else {
            rebuild_chip_search_index(&transaction, chip_id)
        }
        .map_err(|error| format!("{chip_id}: 搜索索引更新失败：{error}"))?;
    }
    transaction
        .commit()
        .map_err(|error| format!("无法提交导入事务：{error}"))?;
    emit_progress(app, operation, "complete", work_total, work_total, "");
    Ok(ImportReport {
        imported,
        translations: translated,
        skipped,
        failures,
        folder,
        canceled: false,
        changed_chip_ids,
    })
}

fn import_paths(
    database: &DatabasePath,
    app: &AppHandle,
    paths: Vec<PathBuf>,
    category: Option<&str>,
    linked: bool,
    operation: &str,
    folder: Option<String>,
) -> Result<ImportReport, String> {
    let connection = open_database(database)?;
    let total = paths.len();
    let mut failures = Vec::new();
    let mut skipped = 0;
    let mut parsed = Vec::new();
    for (index, path) in paths.into_iter().enumerate() {
        let source_name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "registers.yaml".to_owned());
        emit_progress(app, operation, "reading", index + 1, total, &source_name);
        let fingerprint = file_fingerprint(&path);
        if linked && linked_path_unchanged(&connection, &path, fingerprint) {
            skipped += 1;
            continue;
        }
        let yaml_text = match fs::read_to_string(&path) {
            Ok(text) => text,
            Err(error) => {
                failures.push(format!("{}: 读取失败：{error}", path.display()));
                continue;
            }
        };
        let document = match serde_yaml::from_str::<serde_yaml::Value>(&yaml_text) {
            Ok(document) => document,
            Err(error) => {
                failures.push(format!("{}: YAML 解析失败：{error}", path.display()));
                continue;
            }
        };
        parsed.push(ParsedImportFile {
            path,
            source_name,
            yaml_text,
            document,
            fingerprint,
        });
    }

    import_parsed_files(
        connection, app, parsed, category, linked, operation, folder, failures, skipped,
    )
}

fn import_preview_for_paths(
    database: &DatabasePath,
    paths: &[PathBuf],
    category: Option<&str>,
    linked: bool,
    operation: &str,
    folder: Option<String>,
) -> Result<(ImportPreviewReport, PendingImportBatch), String> {
    let connection = open_database(database)?;
    let mut failures = Vec::new();
    let mut files = Vec::new();
    let mut fingerprints = Vec::new();
    let mut parsed = Vec::new();
    let mut unchanged_paths = HashSet::new();
    let mut rejected_paths = HashSet::new();
    for path in paths {
        let source_name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "registers.yaml".to_owned());
        let fingerprint = file_fingerprint(path);
        fingerprints.push((path.clone(), fingerprint));
        let yaml_text = match fs::read_to_string(path) {
            Ok(text) => text,
            Err(error) => {
                failures.push(format!("{}: 读取失败：{error}", path.display()));
                continue;
            }
        };
        let document = match serde_yaml::from_str::<serde_yaml::Value>(&yaml_text) {
            Ok(document) => document,
            Err(error) => {
                failures.push(format!("{}: YAML 解析失败：{error}", path.display()));
                continue;
            }
        };
        parsed.push(ParsedImportFile {
            path: path.clone(),
            source_name,
            yaml_text,
            document,
            fingerprint,
        });
    }

    let mut source_contexts = HashMap::new();
    for item in parsed
        .iter()
        .filter(|item| !translation::is_translation_document(&item.document))
    {
        let metadata = match parse_metadata_document(&item.yaml_text, &item.document) {
            Ok(metadata) => metadata,
            Err(error) => {
                failures.push(format!("{}: {error}", item.path.display()));
                rejected_paths.insert(item.path.clone());
                files.push(ImportPreviewFile {
                    source_name: item.source_name.clone(),
                    kind: "source".to_owned(),
                    sensor: translation_root_string(&item.document, "sensor"),
                    status: "rejected".to_owned(),
                    source_hash_changed: false,
                    translation_missing: true,
                    changes: core_service::RegisterComparison::default(),
                    source_sha256: String::new(),
                });
                continue;
            }
        };
        let source_key = if linked {
            item.path.to_string_lossy().into_owned()
        } else {
            format!("{}:{}", item.source_name, metadata.sensor)
        };
        let source_kind = if linked { "linked" } else { "imported" };
        let chip_id = format!("{source_kind}:{:016x}", stable_hash(&source_key));
        let previous = connection
            .query_row(
                "SELECT yaml_text, source_sha256 FROM chips WHERE id = ?1",
                [chip_id.as_str()],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(|error| format!("无法读取旧芯片结构：{error}"))?;
        let source_sha256 = translation::sha256_hex(&item.yaml_text);
        let changes = if let Some((old_text, _)) = previous.as_ref() {
            let old = serde_yaml::from_str::<serde_yaml::Value>(old_text)
                .map_err(|error| format!("旧芯片 YAML 解析失败：{error}"))?;
            core_service::compare_registers(Some(&old), &item.document)
        } else {
            core_service::compare_registers(None, &item.document)
        };
        let status = if previous.is_none() {
            "new"
        } else if changes == core_service::RegisterComparison::default()
            && previous.as_ref().map(|item| item.1.as_str()) == Some(source_sha256.as_str())
        {
            "unchanged"
        } else {
            "update"
        };
        if status == "unchanged" {
            unchanged_paths.insert(item.path.clone());
        }
        source_contexts.insert(
            source_sha256.clone(),
            (item.yaml_text.clone(), item.document.clone()),
        );
        files.push(ImportPreviewFile {
            source_name: item.source_name.clone(),
            kind: "source".to_owned(),
            sensor: metadata.sensor,
            status: status.to_owned(),
            source_hash_changed: previous
                .as_ref()
                .map(|item| item.1.as_str() != source_sha256)
                .unwrap_or(true),
            translation_missing: true,
            changes,
            source_sha256,
        });
    }

    let mut valid_translation_hashes = HashSet::new();
    for item in parsed
        .iter()
        .filter(|item| translation::is_translation_document(&item.document))
    {
        let source_sha256 = item
            .document
            .as_mapping()
            .and_then(|root| root.get(serde_yaml::Value::String("source_sha256".to_owned())))
            .and_then(serde_yaml::Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_owned();
        let stored_source = if source_contexts.contains_key(&source_sha256) {
            None
        } else {
            connection
                .query_row(
                    "SELECT yaml_text FROM chips WHERE source_sha256 = ?1 LIMIT 1",
                    [source_sha256.as_str()],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .map_err(|error| format!("无法检查译文来源：{error}"))?
        };
        let source = if let Some(source) = source_contexts.get(&source_sha256) {
            Some(source.clone())
        } else if let Some(source_text) = stored_source {
            let source_document = serde_yaml::from_str::<serde_yaml::Value>(&source_text)
                .map_err(|error| format!("英文源 YAML 解析失败：{error}"))?;
            Some((source_text, source_document))
        } else {
            None
        };
        let Some((source_text, source_document)) = source else {
            let error = "找不到与 source_sha256 匹配的英文源 YAML；请在同一批次选择或先导入对应英文寄存器文件";
            failures.push(format!("{}: {error}", item.path.display()));
            rejected_paths.insert(item.path.clone());
            files.push(ImportPreviewFile {
                source_name: item.source_name.clone(),
                kind: "translation".to_owned(),
                sensor: translation_root_string(&item.document, "sensor"),
                status: "rejected".to_owned(),
                source_hash_changed: false,
                translation_missing: true,
                changes: core_service::RegisterComparison::default(),
                source_sha256,
            });
            continue;
        };
        let summary = match translation::validate_translation_yaml(
            &item.yaml_text,
            &item.document,
            &source_text,
            &source_document,
        ) {
            Ok(summary) => summary,
            Err(error) => {
                failures.push(format!("{}: {error}", item.path.display()));
                rejected_paths.insert(item.path.clone());
                files.push(ImportPreviewFile {
                    source_name: item.source_name.clone(),
                    kind: "translation".to_owned(),
                    sensor: translation_root_string(&item.document, "sensor"),
                    status: "rejected".to_owned(),
                    source_hash_changed: false,
                    translation_missing: true,
                    changes: core_service::RegisterComparison::default(),
                    source_sha256,
                });
                continue;
            }
        };
        let source_key = if linked {
            item.path.to_string_lossy().into_owned()
        } else {
            format!("imported:{}", summary.source_file)
        };
        let previous = connection
            .query_row(
                "SELECT yaml_text, source_sha256 FROM translations
                 WHERE source_key = ?1 AND locale = ?2 LIMIT 1",
                params![source_key, summary.locale],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(|error| format!("无法读取旧译文：{error}"))?;
        let status = if previous
            .as_ref()
            .is_some_and(|previous| previous.0 == item.yaml_text)
        {
            "unchanged"
        } else if previous.is_some() {
            "update"
        } else {
            "new"
        };
        if status == "unchanged" {
            unchanged_paths.insert(item.path.clone());
        }
        valid_translation_hashes.insert(source_sha256.clone());
        files.push(ImportPreviewFile {
            source_name: item.source_name.clone(),
            kind: "translation".to_owned(),
            sensor: translation_root_string(&item.document, "sensor"),
            status: status.to_owned(),
            source_hash_changed: previous
                .as_ref()
                .is_some_and(|previous| previous.1 != source_sha256),
            translation_missing: false,
            changes: core_service::RegisterComparison::default(),
            source_sha256,
        });
    }
    for file in files.iter_mut().filter(|file| file.kind == "source") {
        if file.status == "rejected" {
            continue;
        }
        let stored_translation = connection
            .query_row(
                "SELECT 1 FROM translations WHERE source_sha256 = ?1 LIMIT 1",
                [file.source_sha256.as_str()],
                |_| Ok(()),
            )
            .optional()
            .map_err(|error| format!("无法检查芯片译文：{error}"))?
            .is_some();
        file.translation_missing =
            !stored_translation && !valid_translation_hashes.contains(&file.source_sha256);
    }
    let preview_id = format!("preview-{}", stable_hash(&format!("{:?}", paths)));
    let skipped = unchanged_paths.len();
    let parsed = parsed
        .into_iter()
        .filter(|item| {
            !unchanged_paths.contains(&item.path) && !rejected_paths.contains(&item.path)
        })
        .collect();
    let pending = PendingImportBatch {
        parsed,
        category: category.map(str::to_owned),
        linked,
        operation: operation.to_owned(),
        folder: folder.clone(),
        fingerprints,
        failures: failures.clone(),
        skipped,
    };
    Ok((
        ImportPreviewReport {
            preview_id,
            files,
            failures,
            folder,
            canceled: false,
        },
        pending,
    ))
}

#[tauri::command]
fn list_chips(database: State<'_, DatabasePath>) -> Result<Vec<ChipRecord>, String> {
    let connection = open_database(&database)?;
    query_chips(&connection)
}

#[tauri::command]
fn list_chip_summaries(database: State<'_, DatabasePath>) -> Result<Vec<ChipSummary>, String> {
    query_chip_summaries(&open_database(&database)?)
}

#[tauri::command]
fn load_chip_document(
    database: State<'_, DatabasePath>,
    chip_id: String,
) -> Result<ChipDocument, String> {
    load_chip_document_from_database(&open_database(&database)?, chip_id.trim())
}

#[tauri::command]
fn get_chip(
    database: State<'_, DatabasePath>,
    chip_id: String,
) -> Result<core_service::ChipDetails, String> {
    let (source, _) = chip_source_from_database(&open_database(&database)?, chip_id.trim())?;
    core_service::get_chip(&source).ok_or_else(|| "芯片 YAML 缺少有效页面".to_owned())
}

#[tauri::command]
fn get_source_metadata(
    database: State<'_, DatabasePath>,
    chip_id: String,
) -> Result<core_service::SourceMetadata, String> {
    chip_source_from_database(&open_database(&database)?, chip_id.trim())
        .map(|(_, metadata)| metadata)
}

#[tauri::command]
fn get_register_details(
    database: State<'_, DatabasePath>,
    chip_id: String,
    page_name: String,
    register_index: usize,
) -> Result<RegisterDetailsResponse, String> {
    register_details_from_database(
        &open_database(&database)?,
        chip_id.trim(),
        page_name.trim(),
        register_index,
    )
}

#[tauri::command]
fn get_field(
    database: State<'_, DatabasePath>,
    chip_id: String,
    page_name: String,
    register_index: usize,
    field_name: String,
    bits: Option<String>,
) -> Result<core_service::FieldDetails, String> {
    let details = register_details_from_database(
        &open_database(&database)?,
        chip_id.trim(),
        page_name.trim(),
        register_index,
    )?;
    core_service::get_field(&details.register, field_name.trim(), bits.as_deref())
        .cloned()
        .ok_or_else(|| "没有找到该位域".to_owned())
}

fn parse_register_value(value: &str) -> Result<u128, String> {
    let compact = value.trim().replace('_', "");
    if compact.is_empty() {
        return Err("寄存器测试值不能为空".to_owned());
    }
    let (digits, radix) = if let Some(value) = compact.strip_prefix("0x") {
        (value, 16)
    } else if let Some(value) = compact.strip_prefix("0X") {
        (value, 16)
    } else if let Some(value) = compact.strip_prefix("0b") {
        (value, 2)
    } else if let Some(value) = compact.strip_prefix("0B") {
        (value, 2)
    } else {
        (compact.as_str(), 10)
    };
    if digits.is_empty() {
        return Err("寄存器测试值缺少数字".to_owned());
    }
    u128::from_str_radix(digits, radix).map_err(|_| "寄存器测试值不是有效的无符号整数".to_owned())
}

#[tauri::command]
fn decode_register_value(
    database: State<'_, DatabasePath>,
    chip_id: String,
    page_name: String,
    register_index: usize,
    value: String,
) -> Result<core_service::DecodedRegisterValue, String> {
    let connection = open_database(&database)?;
    let details = register_details_from_database(
        &connection,
        chip_id.trim(),
        page_name.trim(),
        register_index,
    )?;
    let value = parse_register_value(&value)?;
    Ok(core_service::decode_register_value(
        value,
        details.register.bit_width,
        &details.register.fields,
    ))
}

#[tauri::command]
fn import_yaml(
    database: State<'_, DatabasePath>,
    source_name: String,
    yaml_text: String,
    category: Option<String>,
) -> Result<Vec<ChipSummary>, String> {
    let mut connection = open_database(&database)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("无法开始导入事务：{error}"))?;
    let chip_id = upsert_imported_chip(
        &transaction,
        &yaml_text,
        &source_name,
        None,
        category.as_deref(),
    )?;
    rebuild_chip_search_index(&transaction, &chip_id)?;
    transaction
        .commit()
        .map_err(|error| format!("无法提交导入事务：{error}"))?;
    query_chip_summaries(&connection)
}

#[tauri::command]
async fn import_yaml_files(
    app: AppHandle,
    database: State<'_, DatabasePath>,
    category: Option<String>,
) -> Result<ImportReport, String> {
    let Some(paths) = rfd::FileDialog::new()
        .add_filter("YAML", &["yaml", "yml"])
        .pick_files()
    else {
        return Ok(ImportReport {
            imported: 0,
            translations: 0,
            skipped: 0,
            failures: Vec::new(),
            folder: None,
            canceled: true,
            changed_chip_ids: Vec::new(),
        });
    };
    let database = database.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        import_paths(
            &database,
            &app,
            paths,
            category.as_deref(),
            false,
            "import",
            None,
        )
    })
    .await
    .map_err(|error| format!("导入任务异常结束：{error}"))?
}

#[tauri::command]
async fn preview_yaml_files(
    database: State<'_, DatabasePath>,
    pending_imports: State<'_, PendingImports>,
    category: Option<String>,
) -> Result<ImportPreviewReport, String> {
    let Some(paths) = rfd::FileDialog::new()
        .add_filter("YAML", &["yaml", "yml"])
        .pick_files()
    else {
        return Ok(ImportPreviewReport {
            preview_id: String::new(),
            files: Vec::new(),
            failures: Vec::new(),
            folder: None,
            canceled: true,
        });
    };
    let database = database.inner().clone();
    let category_for_preview = category.clone();
    let (mut report, batch) = tauri::async_runtime::spawn_blocking(move || {
        import_preview_for_paths(
            &database,
            &paths,
            category_for_preview.as_deref(),
            false,
            "import",
            None,
        )
    })
    .await
    .map_err(|error| format!("导入预览任务异常结束：{error}"))??;
    let sequence = pending_imports.counter.fetch_add(1, Ordering::Relaxed);
    report.preview_id = format!("{}-{sequence}", report.preview_id);
    pending_imports
        .batches
        .lock()
        .map_err(|_| "导入预览状态不可用".to_owned())?
        .insert(report.preview_id.clone(), batch);
    Ok(report)
}

#[tauri::command]
async fn import_yaml_directory(
    app: AppHandle,
    database: State<'_, DatabasePath>,
    category: Option<String>,
) -> Result<ImportReport, String> {
    let Some(folder) = rfd::FileDialog::new().pick_folder() else {
        return Ok(ImportReport {
            imported: 0,
            translations: 0,
            skipped: 0,
            failures: Vec::new(),
            folder: None,
            canceled: true,
            changed_chip_ids: Vec::new(),
        });
    };
    let database = database.inner().clone();
    let folder_label = folder.to_string_lossy().into_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let paths = yaml_paths_in_folder(&folder);
        import_paths(
            &database,
            &app,
            paths,
            category.as_deref(),
            true,
            "directory-import",
            Some(folder_label),
        )
    })
    .await
    .map_err(|error| format!("目录导入任务异常结束：{error}"))?
}

#[tauri::command]
async fn preview_yaml_directory(
    database: State<'_, DatabasePath>,
    pending_imports: State<'_, PendingImports>,
    category: Option<String>,
) -> Result<ImportPreviewReport, String> {
    let Some(folder) = rfd::FileDialog::new().pick_folder() else {
        return Ok(ImportPreviewReport {
            preview_id: String::new(),
            files: Vec::new(),
            failures: Vec::new(),
            folder: None,
            canceled: true,
        });
    };
    let folder_label = folder.to_string_lossy().into_owned();
    let paths = yaml_paths_in_folder(&folder);
    let database = database.inner().clone();
    let category_for_preview = category.clone();
    let folder_for_preview = folder_label.clone();
    let (mut report, batch) = tauri::async_runtime::spawn_blocking(move || {
        import_preview_for_paths(
            &database,
            &paths,
            category_for_preview.as_deref(),
            true,
            "directory-import",
            Some(folder_for_preview),
        )
    })
    .await
    .map_err(|error| format!("目录预览任务异常结束：{error}"))??;
    let sequence = pending_imports.counter.fetch_add(1, Ordering::Relaxed);
    report.preview_id = format!("{}-{sequence}", report.preview_id);
    pending_imports
        .batches
        .lock()
        .map_err(|_| "导入预览状态不可用".to_owned())?
        .insert(report.preview_id.clone(), batch);
    Ok(report)
}

#[tauri::command]
async fn confirm_yaml_import_preview(
    app: AppHandle,
    database: State<'_, DatabasePath>,
    pending_imports: State<'_, PendingImports>,
    preview_id: String,
) -> Result<ImportReport, String> {
    let batch = pending_imports
        .batches
        .lock()
        .map_err(|_| "导入预览状态不可用".to_owned())?
        .remove(preview_id.trim())
        .ok_or_else(|| "导入预览已过期，请重新选择文件".to_owned())?;
    if batch
        .fingerprints
        .iter()
        .any(|(path, fingerprint)| file_fingerprint(path) != *fingerprint)
    {
        return Err("文件在预览后发生变化，请重新预览后再导入".to_owned());
    }
    let database = database.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let connection = open_database(&database)?;
        import_parsed_files(
            connection,
            &app,
            batch.parsed,
            batch.category.as_deref(),
            batch.linked,
            &batch.operation,
            batch.folder,
            batch.failures,
            batch.skipped,
        )
    })
    .await
    .map_err(|error| format!("导入任务异常结束：{error}"))?
}

#[tauri::command]
fn cancel_yaml_import_preview(
    pending_imports: State<'_, PendingImports>,
    preview_id: String,
) -> Result<(), String> {
    pending_imports
        .batches
        .lock()
        .map_err(|_| "导入预览状态不可用".to_owned())?
        .remove(preview_id.trim());
    Ok(())
}

#[tauri::command]
fn import_translation(
    database: State<'_, DatabasePath>,
    source_name: String,
    yaml_text: String,
) -> Result<Vec<ChipSummary>, String> {
    let mut connection = open_database(&database)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("无法开始译文导入事务：{error}"))?;
    let affected_source_hashes = upsert_translation(&transaction, &yaml_text, &source_name, None)?;
    let mut changed_chip_ids = HashSet::new();
    for source_sha256 in affected_source_hashes {
        for chip_id in chip_ids_for_source_hash(&transaction, &source_sha256)? {
            changed_chip_ids.insert(chip_id);
        }
    }
    for chip_id in changed_chip_ids {
        rebuild_chip_search_index(&transaction, &chip_id)?;
    }
    transaction
        .commit()
        .map_err(|error| format!("无法提交译文导入事务：{error}"))?;
    query_chip_summaries(&connection)
}

#[tauri::command]
async fn refresh_linked_library(
    app: AppHandle,
    database: State<'_, DatabasePath>,
) -> Result<ImportReport, String> {
    let database = database.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let connection = open_database(&database)?;
        let mut statement = connection
            .prepare(
                "SELECT source_path FROM chips WHERE source_path IS NOT NULL
                 UNION SELECT source_path FROM translations WHERE source_path IS NOT NULL",
            )
            .map_err(|error| format!("无法读取关联文件：{error}"))?;
        let mut paths = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| format!("无法查询关联文件：{error}"))?
            .filter_map(Result::ok)
            .map(PathBuf::from)
            .collect::<Vec<_>>();
        drop(statement);
        let linked_folders = connection
            .prepare("SELECT folder_path FROM linked_libraries ORDER BY folder_path")
            .and_then(|mut statement| {
                statement
                    .query_map([], |row| row.get::<_, String>(0))?
                    .collect::<Result<Vec<_>, _>>()
            })
            .map_err(|error| format!("无法读取关联目录：{error}"))?;
        for folder in linked_folders {
            paths.extend(yaml_paths_in_folder(Path::new(&folder)));
        }
        paths.sort();
        paths.dedup();
        drop(connection);
        import_paths(&database, &app, paths, None, true, "refresh", None)
    })
    .await
    .map_err(|error| format!("关联库刷新任务异常结束：{error}"))?
}

#[tauri::command]
fn search_index_status(
    database: State<'_, DatabasePath>,
) -> Result<search::SearchIndexStatus, String> {
    search::index_status(&open_database(&database)?)
}

#[tauri::command]
async fn rebuild_search_index(
    app: AppHandle,
    database: State<'_, DatabasePath>,
) -> Result<search::SearchIndexStatus, String> {
    let database = database.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut connection = open_database(&database)?;
        let chip_ids = connection
            .prepare("SELECT id FROM chips ORDER BY category COLLATE NOCASE, sensor COLLATE NOCASE")
            .and_then(|mut statement| {
                statement
                    .query_map([], |row| row.get::<_, String>(0))?
                    .collect::<Result<Vec<_>, _>>()
            })
            .map_err(|error| format!("无法读取待索引芯片：{error}"))?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始索引事务：{error}"))?;
        search::mark_index_stale(&transaction)?;
        transaction
            .execute("DELETE FROM search_documents", [])
            .map_err(|error| format!("无法清空搜索索引：{error}"))?;
        for (index, chip_id) in chip_ids.iter().enumerate() {
            emit_progress(
                &app,
                "search-index",
                "indexing",
                index + 1,
                chip_ids.len(),
                chip_id,
            );
            rebuild_chip_search_index(&transaction, chip_id)?;
        }
        search::mark_index_ready(&transaction)?;
        transaction
            .commit()
            .map_err(|error| format!("无法提交搜索索引：{error}"))?;
        emit_progress(
            &app,
            "search-index",
            "complete",
            chip_ids.len(),
            chip_ids.len(),
            "",
        );
        search::index_status(&connection)
    })
    .await
    .map_err(|error| format!("搜索索引任务异常结束：{error}"))?
}

#[tauri::command]
fn search_registers(
    database: State<'_, DatabasePath>,
    query: String,
    current_chip_id: Option<String>,
    limit: Option<usize>,
    recent_chip_ids: Option<Vec<String>>,
) -> Result<search::SearchResponse, String> {
    search::search(
        &open_database(&database)?,
        &query,
        current_chip_id.as_deref(),
        limit.unwrap_or(100),
        recent_chip_ids.as_deref().unwrap_or_default(),
    )
}

#[tauri::command]
fn set_chip_enabled(
    database: State<'_, DatabasePath>,
    chip_id: String,
    enabled: bool,
) -> Result<(), String> {
    let mut connection = open_database(&database)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("无法开始显示状态事务：{error}"))?;
    update_chip_enabled(&transaction, &chip_id, enabled)?;
    transaction
        .commit()
        .map_err(|error| format!("无法提交显示状态：{error}"))
}

fn update_chip_enabled(
    connection: &Connection,
    chip_id: &str,
    enabled: bool,
) -> Result<(), String> {
    connection
        .execute(
            "UPDATE chips SET enabled = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
            params![i64::from(enabled), chip_id],
        )
        .map_err(|error| format!("无法更新启用状态：{error}"))?;
    search::update_chip_metadata(connection, chip_id, None, Some(enabled))?;
    Ok(())
}

#[tauri::command]
fn set_chip_category(
    database: State<'_, DatabasePath>,
    chip_id: String,
    category: String,
) -> Result<(), String> {
    let mut connection = open_database(&database)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("无法开始分类事务：{error}"))?;
    update_chip_category(&transaction, &chip_id, &category)?;
    transaction
        .commit()
        .map_err(|error| format!("无法提交芯片分类：{error}"))
}

fn update_chip_category(
    connection: &Connection,
    chip_id: &str,
    category: &str,
) -> Result<(), String> {
    let category = category.trim();
    if category.is_empty() {
        return Err("分类不能为空".to_owned());
    }
    connection
        .execute(
            "UPDATE chips SET category = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
            params![category, chip_id],
        )
        .map_err(|error| format!("无法更新分类：{error}"))?;
    search::update_chip_metadata(connection, chip_id, Some(category), None)?;
    Ok(())
}

#[tauri::command]
fn save_register_note(
    database: State<'_, DatabasePath>,
    input: RegisterNoteInput,
) -> Result<Vec<RegisterNote>, String> {
    let mut connection = open_database(&database)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("无法开始备注事务：{error}"))?;
    let chip_id = input.chip_id.trim().to_owned();
    let notes = upsert_register_note(&transaction, &input)?;
    rebuild_note_search_index(&transaction, &chip_id)?;
    transaction
        .commit()
        .map_err(|error| format!("无法提交寄存器备注：{error}"))?;
    Ok(notes)
}

#[tauri::command]
fn delete_register_note(
    database: State<'_, DatabasePath>,
    chip_id: String,
    note_id: i64,
) -> Result<Vec<RegisterNote>, String> {
    let mut connection = open_database(&database)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("无法开始备注删除事务：{error}"))?;
    let notes = remove_register_note(&transaction, &chip_id, note_id)?;
    rebuild_note_search_index(&transaction, &chip_id)?;
    transaction
        .commit()
        .map_err(|error| format!("无法提交备注删除：{error}"))?;
    Ok(notes)
}

#[tauri::command]
fn list_chip_attachments(
    database: State<'_, DatabasePath>,
    chip_id: String,
) -> Result<Vec<ChipAttachment>, String> {
    let connection = open_database(&database)?;
    query_chip_attachments(&connection, Some(&chip_id))
}

#[tauri::command]
fn add_chip_attachments(
    database: State<'_, DatabasePath>,
    chip_id: String,
) -> Result<AttachmentImportReport, String> {
    let connection = open_database(&database)?;
    let Some(paths) = rfd::FileDialog::new()
        .set_title("选择芯片附件")
        .pick_files()
    else {
        return Ok(AttachmentImportReport {
            attachments: query_chip_attachments(&connection, Some(&chip_id))?,
            added: 0,
            canceled: true,
            failures: Vec::new(),
        });
    };
    let (attachments, added, failures) = add_attachment_paths(&connection, &chip_id, &paths)?;
    Ok(AttachmentImportReport {
        attachments,
        added,
        canceled: false,
        failures,
    })
}

#[tauri::command]
fn delete_chip_attachment(
    database: State<'_, DatabasePath>,
    chip_id: String,
    attachment_id: i64,
) -> Result<Vec<ChipAttachment>, String> {
    let connection = open_database(&database)?;
    remove_chip_attachment(&connection, &chip_id, attachment_id)
}

#[tauri::command]
fn open_chip_attachment(
    database: State<'_, DatabasePath>,
    chip_id: String,
    attachment_id: i64,
) -> Result<(), String> {
    let connection = open_database(&database)?;
    let path = stored_attachment_path(&connection, &chip_id, attachment_id)?;
    launch_path(&path, false).map_err(|error| format!("无法打开附件：{error}"))
}

#[tauri::command]
fn reveal_chip_attachment(
    database: State<'_, DatabasePath>,
    chip_id: String,
    attachment_id: i64,
) -> Result<(), String> {
    let connection = open_database(&database)?;
    let path = stored_attachment_path(&connection, &chip_id, attachment_id)?;
    launch_path(&path, true).map_err(|error| format!("无法在文件管理器中显示附件：{error}"))
}

#[tauri::command]
fn delete_chip(database: State<'_, DatabasePath>, chip_id: String) -> Result<(), String> {
    let mut connection = open_database(&database)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("无法开始删除事务：{error}"))?;
    let exists = transaction
        .query_row(
            "SELECT 1 FROM chips WHERE id = ?1",
            params![chip_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(|error| format!("无法确认芯片状态：{error}"))?
        .is_some();
    if !exists {
        return Ok(());
    }
    transaction
        .execute(
            "DELETE FROM register_notes WHERE chip_id = ?1",
            params![chip_id],
        )
        .map_err(|error| format!("无法删除芯片备注：{error}"))?;
    transaction
        .execute(
            "DELETE FROM chip_attachments WHERE chip_id = ?1",
            params![chip_id],
        )
        .map_err(|error| format!("无法删除芯片附件：{error}"))?;
    transaction
        .execute(
            "DELETE FROM search_documents WHERE chip_id = ?1",
            params![chip_id],
        )
        .map_err(|error| format!("无法删除芯片搜索索引：{error}"))?;
    transaction
        .execute("DELETE FROM chips WHERE id = ?1", params![chip_id])
        .map_err(|error| format!("无法删除芯片：{error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("无法提交删除事务：{error}"))?;
    Ok(())
}

fn yaml_key_to_string(value: &serde_yaml::Value) -> Result<String, String> {
    match value {
        serde_yaml::Value::String(value) => Ok(value.clone()),
        serde_yaml::Value::Bool(value) => Ok(value.to_string()),
        serde_yaml::Value::Number(value) => Ok(value.to_string()),
        serde_yaml::Value::Null => Ok("null".to_owned()),
        _ => Err("YAML mapping 使用了不支持的复合 key".to_owned()),
    }
}

fn yaml_to_json(value: serde_yaml::Value) -> Result<JsonValue, String> {
    const JS_MAX_SAFE_INTEGER: u64 = (1_u64 << 53) - 1;

    match value {
        serde_yaml::Value::Null => Ok(JsonValue::Null),
        serde_yaml::Value::Bool(value) => Ok(JsonValue::Bool(value)),
        serde_yaml::Value::Number(value) => {
            if let Some(unsigned) = value.as_u64() {
                if unsigned > JS_MAX_SAFE_INTEGER {
                    return Ok(JsonValue::String(unsigned.to_string()));
                }
                return Ok(JsonValue::Number(unsigned.into()));
            }
            if let Some(signed) = value.as_i64() {
                if signed.unsigned_abs() > JS_MAX_SAFE_INTEGER {
                    return Ok(JsonValue::String(signed.to_string()));
                }
                return Ok(JsonValue::Number(signed.into()));
            }
            value
                .as_f64()
                .and_then(serde_json::Number::from_f64)
                .map(JsonValue::Number)
                .ok_or_else(|| "YAML 包含无法转换的数值".to_owned())
        }
        serde_yaml::Value::String(value) => Ok(JsonValue::String(value)),
        serde_yaml::Value::Sequence(values) => values
            .into_iter()
            .map(yaml_to_json)
            .collect::<Result<Vec<_>, _>>()
            .map(JsonValue::Array),
        serde_yaml::Value::Mapping(values) => {
            let mut object = serde_json::Map::new();
            for (key, value) in values {
                object.insert(yaml_key_to_string(&key)?, yaml_to_json(value)?);
            }
            Ok(JsonValue::Object(object))
        }
        serde_yaml::Value::Tagged(tagged) => yaml_to_json(tagged.value),
    }
}

fn build_standalone_html(records: &[ChipRecord], include_notes: bool) -> Result<String, String> {
    let mut chips = Vec::new();
    for record in records {
        let yaml: serde_yaml::Value = serde_yaml::from_str(&record.yaml_text)
            .map_err(|error| format!("{} 解析失败：{error}", record.source_name))?;
        let mut chip = yaml_to_json(yaml)?;
        let object = chip
            .as_object_mut()
            .ok_or_else(|| format!("{} 顶层不是对象", record.source_name))?;
        object.insert("_id".to_owned(), JsonValue::String(record.id.clone()));
        object.insert(
            "_source".to_owned(),
            JsonValue::String(record.source_name.clone()),
        );
        object.insert(
            "_sourceSha256".to_owned(),
            JsonValue::String(record.source_sha256.clone()),
        );
        object.insert(
            "_category".to_owned(),
            JsonValue::String(record.category.clone()),
        );
        if include_notes {
            object.insert(
                "_notes".to_owned(),
                serde_json::to_value(&record.notes)
                    .map_err(|error| format!("无法序列化寄存器备注：{error}"))?,
            );
        }
        let translation_values = record
            .translations
            .iter()
            .map(|translation| {
                serde_yaml::from_str::<serde_yaml::Value>(&translation.yaml_text)
                    .map_err(|error| format!("{} 翻译解析失败：{error}", translation.source_file))
                    .and_then(yaml_to_json)
            })
            .collect::<Result<Vec<_>, _>>()?;
        object.insert(
            "_translations".to_owned(),
            JsonValue::Array(translation_values),
        );
        chips.push(chip);
    }

    let chip_json =
        serde_json::to_string(&chips).map_err(|error| format!("无法序列化芯片数据：{error}"))?;
    let mut html = include_str!("../../index.html").to_owned();
    html = html.replace("<body>", "<body class=\"standalone\">");
    html = html.replace(
        "    <link rel=\"icon\" href=\"favicon.png\" type=\"image/png\">\n",
        "",
    );
    html = html.replace(
        "<link rel=\"stylesheet\" href=\"styles.css\">",
        &format!("<style>{}</style>", include_str!("../../styles.css")),
    );
    html = html.replace(
        "<script src=\"data/chips.data.js\"></script>",
        &format!("<script>window.REGISTER_CHIPS={chip_json};</script>"),
    );
    html = html.replace(
        "<script src=\"yaml-lite.js\"></script>",
        &format!("<script>{}</script>", include_str!("../../yaml-lite.js")),
    );
    html = html.replace(
        "<script src=\"yaml-validator.js\"></script>",
        &format!(
            "<script>{}</script>",
            include_str!("../../yaml-validator.js")
        ),
    );
    html = html.replace(
        "<script src=\"translation-validator.js\"></script>",
        &format!(
            "<script>{}</script>",
            include_str!("../../translation-validator.js")
        ),
    );
    html = html.replace(
        "<script src=\"search-worker-inline.js\"></script>",
        &format!(
            "<script>{}</script>",
            include_str!("../../search-worker-inline.js")
        ),
    );
    html = html.replace(
        "<script src=\"import-worker-inline.js\"></script>",
        &format!(
            "<script>{}</script>",
            include_str!("../../import-worker-inline.js")
        ),
    );
    html = html.replace(
        "<script src=\"vendor/lucide.min.js\"></script>",
        &format!(
            "<script>{}</script>",
            include_str!("../../vendor/lucide.min.js")
        ),
    );
    html = html.replace(
        "<script src=\"vendor/jsep.min.js\"></script>",
        &format!(
            "<script>{}</script>",
            include_str!("../../vendor/jsep.min.js")
        ),
    );
    html = html.replace(
        "<script src=\"app.js\"></script>",
        &format!(
            "<script>window.REGISTER_SEARCH_WORKER_SOURCE={};</script><script>{}</script>",
            serde_json::to_string(&format!(
                "{}\n{}",
                include_str!("../../vendor/fuse.min.js"),
                include_str!("../../search-worker.js")
            ))
            .map_err(|error| format!("无法嵌入搜索 Worker：{error}"))?,
            include_str!("../../app.js")
        ),
    );
    Ok(html)
}

#[tauri::command]
fn export_standalone_html(
    database: State<'_, DatabasePath>,
    chip_ids: Vec<String>,
    include_notes: bool,
) -> Result<Option<String>, String> {
    if chip_ids.is_empty() {
        return Err("请至少选择一个芯片".to_owned());
    }
    let connection = open_database(&database)?;
    let all_records = query_chips(&connection)?;
    let selected: Vec<_> = all_records
        .into_iter()
        .filter(|record| chip_ids.contains(&record.id))
        .collect();
    if selected.is_empty() {
        return Err("没有找到所选芯片".to_owned());
    }

    let Some(path) = rfd::FileDialog::new()
        .add_filter("HTML", &["html"])
        .set_file_name("register-reference.html")
        .save_file()
    else {
        return Ok(None);
    };
    fs::write(&path, build_standalone_html(&selected, include_notes)?)
        .map_err(|error| format!("无法写入 {}：{error}", path.display()))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data = app
                .path()
                .app_data_dir()
                .map_err(|error| format!("无法定位应用数据目录：{error}"))?;
            let database = DatabasePath(app_data.join("register-library.sqlite3"));
            initialize_database(&database)?;
            app.manage(database);
            app.manage(PendingImports::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_chips,
            list_chip_summaries,
            load_chip_document,
            get_chip,
            get_register_details,
            get_field,
            get_source_metadata,
            decode_register_value,
            import_yaml,
            import_yaml_files,
            preview_yaml_files,
            import_translation,
            import_yaml_directory,
            preview_yaml_directory,
            confirm_yaml_import_preview,
            cancel_yaml_import_preview,
            refresh_linked_library,
            search_index_status,
            rebuild_search_index,
            search_registers,
            set_chip_enabled,
            set_chip_category,
            save_register_note,
            delete_register_note,
            list_chip_attachments,
            add_chip_attachments,
            delete_chip_attachment,
            open_chip_attachment,
            reveal_chip_attachment,
            delete_chip,
            export_standalone_html
        ])
        .run(tauri::generate_context!())
        .expect("error while running register reference application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static DATABASE_COUNTER: AtomicU64 = AtomicU64::new(0);
    const TEST_CHIP_YAML: &str = include_str!("../../dwc3_rk3588.yaml");

    fn temporary_database() -> DatabasePath {
        let path = std::env::temp_dir().join(format!(
            "register-reference-{}-{}.sqlite3",
            std::process::id(),
            DATABASE_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_file(&path);
        DatabasePath(path)
    }

    fn import_test_chip(connection: &Connection) -> String {
        upsert_imported_chip(connection, TEST_CHIP_YAML, "dwc3_rk3588.yaml", None, None).unwrap()
    }

    #[test]
    fn starts_empty_and_removes_legacy_builtin_records() {
        let database = temporary_database();
        initialize_database(&database).unwrap();
        let connection = open_database(&database).unwrap();
        assert!(query_chips(&connection).unwrap().is_empty());
        let imported_id = import_test_chip(&connection);
        connection
            .execute(
                "INSERT INTO chips (
                    id, sensor, vendor, family, device_type, category, enabled, builtin,
                    source_kind, source_name, source_path, source_sha256, source_size,
                    source_mtime_ns, yaml_text
                 ) SELECT ?1, sensor, vendor, family, device_type, '内置', 1, 1,
                          'builtin', 'legacy.yaml', NULL, 'legacy-sha', source_size,
                          NULL, yaml_text
                   FROM chips WHERE id = ?2",
                params!["builtin:dwc3-rk3588", imported_id],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO register_notes (
                    chip_id, page_name, register_addr, register_key, register_name, kind, content
                 ) VALUES (?1, 'MMIO', 49408, 'legacy', 'USB3OTG_GSBUSCFG0', 'note', 'legacy note')",
                ["builtin:dwc3-rk3588"],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO chip_attachments (chip_id, file_name, file_path)
                 VALUES (?1, 'legacy.pdf', '/tmp/legacy.pdf')",
                ["builtin:dwc3-rk3588"],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO translations (
                    source_sha256, source_file, source_locale, locale, status, coverage,
                    method, translator, updated, yaml_text, source_key
                 ) VALUES ('legacy-sha', 'legacy.yaml', 'en', 'zh-CN', 'draft', 'partial',
                           'human', 'test', '2026-08-19', 'legacy translation', 'legacy')",
                [],
            )
            .unwrap();
        rebuild_chip_search_index(&connection, "builtin:dwc3-rk3588").unwrap();
        drop(connection);

        initialize_database(&database).unwrap();
        let connection = open_database(&database).unwrap();
        let records = query_chips(&connection).unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].id, imported_id);
        assert!(!records[0].builtin);
        for table in ["register_notes", "chip_attachments", "search_documents"] {
            let count = connection
                .query_row(
                    &format!("SELECT COUNT(*) FROM {table} WHERE chip_id = ?1"),
                    ["builtin:dwc3-rk3588"],
                    |row| row.get::<_, usize>(0),
                )
                .unwrap();
            assert_eq!(count, 0, "legacy rows remain in {table}");
        }
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM translations WHERE source_sha256 = 'legacy-sha'",
                    [],
                    |row| row.get::<_, usize>(0),
                )
                .unwrap(),
            0
        );
        let _ = fs::remove_file(database.0);
    }

    #[test]
    fn standalone_html_inlines_viewer_and_numeric_enum_keys() {
        let database = temporary_database();
        initialize_database(&database).unwrap();
        let connection = open_database(&database).unwrap();
        let chip_id = import_test_chip(&connection);
        upsert_register_note(
            &connection,
            &RegisterNoteInput {
                note_id: None,
                chip_id: chip_id.clone(),
                page_name: "MMIO".to_owned(),
                register_addr: Some(0xC100),
                register_key: "mmio:49408:USB3OTG_GSBUSCFG0".to_owned(),
                register_name: "USB3OTG_GSBUSCFG0".to_owned(),
                kind: "warning".to_owned(),
                content: "导出备注测试".to_owned(),
            },
        )
        .unwrap();
        let records = query_chips(&connection).unwrap();
        let selected: Vec<_> = records
            .into_iter()
            .filter(|record| record.id == chip_id)
            .collect();
        let html = build_standalone_html(&selected, true).unwrap();
        assert!(html.contains("window.REGISTER_CHIPS="));
        assert!(html.contains("class=\"standalone\""));
        assert!(html.contains("RK3588_DWC3"));
        assert!(!html.contains("src=\"app.js\""));
        assert!(!html.contains("src=\"search-worker-inline.js\""));
        assert!(!html.contains("src=\"import-worker-inline.js\""));
        assert!(html.contains("REGISTER_SEARCH_WORKER_SOURCE"));
        assert!(html.contains("REGISTER_IMPORT_WORKER_SOURCE"));
        assert!(!html.contains("href=\"styles.css\""));
        assert!(html.contains("导出备注测试"));
        assert!(!build_standalone_html(&selected, false)
            .unwrap()
            .contains("导出备注测试"));
        let _ = fs::remove_file(database.0);
    }

    #[test]
    fn validates_binds_and_exports_translation_sidecars() {
        let database = temporary_database();
        initialize_database(&database).unwrap();
        let connection = open_database(&database).unwrap();
        let chip_id = import_test_chip(&connection);
        let source_text = TEST_CHIP_YAML;
        let source_sha256 = translation::sha256_hex(source_text);
        let sidecar = format!(
            r#"translation_schema_version: 1
format: "register-reference-translation"
source_locale: "en"
locale: "zh-CN"
source_file: "controllers/usb/rockchip/rk3588-dwc3.yaml"
source_sha256: "{source_sha256}"
metadata:
  status: "draft"
  coverage: "partial"
  method: "human"
  translator: "test"
  updated: "2026-08-17"
translations:
  sensor: "RK3588 DWC3 中文测试"
"#
        );
        upsert_translation(&connection, &sidecar, "rk3588-dwc3.zh-CN.yaml", None).unwrap();
        let records = query_chips(&connection).unwrap();
        let record = records.iter().find(|record| record.id == chip_id).unwrap();
        assert_eq!(record.translations.len(), 1);
        assert_eq!(record.translations[0].locale, "zh-CN");
        assert!(build_standalone_html(std::slice::from_ref(record), false)
            .unwrap()
            .contains("RK3588 DWC3 中文测试"));

        let stale = sidecar.replace(&source_sha256, &"0".repeat(64));
        let error = upsert_translation(&connection, &stale, "stale.yaml", None).unwrap_err();
        assert!(error.contains("找不到与 source_sha256 匹配"));
        let structural = sidecar.replace(
            "  sensor: \"RK3588 DWC3 中文测试\"",
            "  sensor: \"RK3588 DWC3 中文测试\"\n  vendor: \"不允许覆盖结构字段\"",
        );
        let error =
            upsert_translation(&connection, &structural, "structural.yaml", None).unwrap_err();
        assert!(error.contains("file.translations.vendor"));
        let _ = fs::remove_file(database.0);
    }

    #[test]
    fn creates_updates_and_deletes_register_notes() {
        let database = temporary_database();
        initialize_database(&database).unwrap();
        let connection = open_database(&database).unwrap();
        let chip_id = import_test_chip(&connection);

        let notes = upsert_register_note(
            &connection,
            &RegisterNoteInput {
                note_id: None,
                chip_id: chip_id.clone(),
                page_name: "MMIO".to_owned(),
                register_addr: Some(0xC100),
                register_key: "mmio:49408:USB3OTG_GSBUSCFG0".to_owned(),
                register_name: "USB3OTG_GSBUSCFG0".to_owned(),
                kind: "note".to_owned(),
                content: "先设置量程".to_owned(),
            },
        )
        .unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].content, "先设置量程");

        let notes = upsert_register_note(
            &connection,
            &RegisterNoteInput {
                note_id: Some(notes[0].id),
                chip_id: chip_id.clone(),
                page_name: "MMIO".to_owned(),
                register_addr: Some(0xC100),
                register_key: "mmio:49408:USB3OTG_GSBUSCFG0".to_owned(),
                register_name: "USB3OTG_GSBUSCFG0".to_owned(),
                kind: "warning".to_owned(),
                content: "切换量程后等待数据稳定".to_owned(),
            },
        )
        .unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].kind, "warning");
        assert_eq!(notes[0].content, "切换量程后等待数据稳定");

        assert!(remove_register_note(&connection, &chip_id, notes[0].id)
            .unwrap()
            .is_empty());
        let _ = fs::remove_file(database.0);
    }

    #[test]
    fn stores_system_register_notes_by_encoding_identity() {
        let database = temporary_database();
        initialize_database(&database).unwrap();
        let connection = open_database(&database).unwrap();
        let yaml = r#"schema_version: 2
sensor: "ARM_TEST"
vendor: "Arm"
family: "A-profile"
device_type: "architecture_registers"
register_space:
  kind: "arm_system"
  architecture: "AArch64"
  profile: "A"
source:
  title: "Synthetic test"
  version: "test"
  document: "test"
  url: "https://example.invalid"
  license: "test only"
pages:
  Control:
    access: "MRS / MSR"
    desc: "Synthetic system-register category"
    registers:
      - name: "SCTLR_EL1"
        access: "RW"
        width: 8
        bit_width: 64
        desc: "Synthetic system register"
        encoding:
          scheme: "aarch64_sysreg"
          op0: 3
          op1: 0
          crn: 1
          crm: 0
          op2: 0
        accessors:
          - name: "SCTLR_EL1"
            kind: "read"
            instruction: "MRS <Xt>, SCTLR_EL1"
            encoding:
              scheme: "aarch64_sysreg"
              op0: 3
              op1: 0
              crn: 1
              crm: 0
              op2: 0
"#;
        let chip_id = upsert_imported_chip(&connection, yaml, "arm-test.yaml", None, None).unwrap();
        let register_key = "aarch64_sysreg:op0=3:op1=0:crn=1:crm=0:op2=0:SCTLR_EL1";
        let notes = upsert_register_note(
            &connection,
            &RegisterNoteInput {
                note_id: None,
                chip_id: chip_id.clone(),
                page_name: "Control".to_owned(),
                register_addr: None,
                register_key: register_key.to_owned(),
                register_name: "SCTLR_EL1".to_owned(),
                kind: "warning".to_owned(),
                content: "Check feature-dependent fields".to_owned(),
            },
        )
        .unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].register_addr, None);
        assert_eq!(notes[0].register_key, register_key);
        assert_eq!(
            default_category(&parse_metadata(yaml).unwrap()),
            "架构寄存器"
        );
        let _ = fs::remove_file(database.0);
    }

    #[test]
    fn stores_riscv_csr_notes_by_encoding_identity() {
        let database = temporary_database();
        initialize_database(&database).unwrap();
        let connection = open_database(&database).unwrap();
        let yaml = r#"schema_version: 2
sensor: "RISCV_TEST"
vendor: "RISC-V International"
family: "RISC-V Privileged ISA"
device_type: "architecture_registers"
register_space:
  kind: "riscv_system"
  architecture: "RV64"
  profile: "privileged"
source:
  title: "Synthetic test"
  version: "test"
  revision: "test"
  document: "test"
  url: "https://example.invalid"
  license: "test only"
pages:
  Machine:
    access: "CSR instruction encoding space"
    desc: "Synthetic RISC-V CSR category"
    registers:
      - name: "mstatus"
        access: "RW"
        width: 8
        bit_width: 64
        desc: "Synthetic machine status register"
        encoding:
          scheme: "riscv_csr"
          address: 0x300
        accessors:
          - name: "mstatus"
            kind: "read"
            instruction: "CSRRS rd, mstatus, x0"
            encoding:
              scheme: "riscv_csr"
              address: 0x300
"#;
        let chip_id =
            upsert_imported_chip(&connection, yaml, "riscv-test.yaml", None, None).unwrap();
        let register_key = "riscv_csr:address=768:mstatus";
        let notes = upsert_register_note(
            &connection,
            &RegisterNoteInput {
                note_id: None,
                chip_id: chip_id.clone(),
                page_name: "Machine".to_owned(),
                register_addr: None,
                register_key: register_key.to_owned(),
                register_name: "mstatus".to_owned(),
                kind: "note".to_owned(),
                content: "Check implementation-defined fields".to_owned(),
            },
        )
        .unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].register_addr, None);
        assert_eq!(notes[0].register_key, register_key);
        assert_eq!(
            default_category(&parse_metadata(yaml).unwrap()),
            "架构寄存器"
        );
        let invalid = yaml.replace("0x300", "0x1000");
        let error = upsert_imported_chip(&connection, &invalid, "riscv-invalid.yaml", None, None)
            .unwrap_err();
        assert!(error.contains("riscv_csr address"));
        let _ = fs::remove_file(database.0);
    }

    #[test]
    fn stores_aarch32_banked_register_notes_by_encoding_identity() {
        let database = temporary_database();
        initialize_database(&database).unwrap();
        let connection = open_database(&database).unwrap();
        let yaml = r#"schema_version: 2
sensor: "ARM_A32_TEST"
vendor: "Arm"
family: "A-profile"
device_type: "architecture_registers"
register_space:
  kind: "arm_system"
  architecture: "AArch32"
  profile: "A"
source:
  title: "Synthetic test"
  version: "test"
  document: "test"
  url: "https://example.invalid"
  license: "test only"
pages:
  Special:
    access: "MRS / MSR"
    desc: "Synthetic AArch32 system-register category"
    registers:
      - name: "ELR_hyp"
        access: "RW"
        width: 4
        bit_width: 32
        desc: "Synthetic banked register"
        encoding:
          scheme: "aarch32_special"
          r: 0
          m: 1
          m1: 14
        accessors:
          - name: "ELR_hyp"
            kind: "read"
            instruction: "MRS <Rd>, ELR_hyp"
            encoding:
              scheme: "aarch32_special"
              r: 0
              m: 1
              m1: 14
"#;
        let chip_id =
            upsert_imported_chip(&connection, yaml, "arm-a32-test.yaml", None, None).unwrap();
        let register_key = "aarch32_special:r=0:m=1:m1=14:ELR_hyp";
        let notes = upsert_register_note(
            &connection,
            &RegisterNoteInput {
                note_id: None,
                chip_id,
                page_name: "Special".to_owned(),
                register_addr: None,
                register_key: register_key.to_owned(),
                register_name: "ELR_hyp".to_owned(),
                kind: "note".to_owned(),
                content: "Banked register note".to_owned(),
            },
        )
        .unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].register_key, register_key);
        let _ = fs::remove_file(database.0);
    }

    #[test]
    fn imports_full_width_128_bit_reset_and_enum_values() {
        let database = temporary_database();
        initialize_database(&database).unwrap();
        let connection = open_database(&database).unwrap();
        let yaml = r#"schema_version: 2
sensor: "ARM_128_TEST"
vendor: "Arm"
family: "A-profile"
device_type: "architecture_registers"
register_space:
  kind: "arm_system"
  architecture: "AArch64"
  profile: "A"
source:
  title: "Synthetic test"
  version: "test"
  document: "test"
  url: "https://example.invalid"
  license: "test only"
pages:
  Wide:
    access: "MRRS / MSRR"
    desc: "Synthetic 128-bit category"
    registers:
      - name: "WIDE_EL1"
        access: "RW"
        width: 16
        bit_width: 128
        reset: "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"
        desc: "Synthetic 128-bit register"
        encoding:
          scheme: "aarch64_sysreg"
          op0: 3
          op1: 0
          crn: 1
          crm: 2
          op2: 3
        accessors:
          - name: "WIDE_EL1"
            kind: "read"
            instruction: "MRRS <Xt>, <Xt2>, WIDE_EL1"
            encoding:
              scheme: "aarch64_sysreg"
              op0: 3
              op1: 0
              crn: 1
              crm: 2
              op2: 3
        fields:
          - name: "FULL"
            bits: "127:0"
            reset: "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"
            desc: "Full-width value"
            values:
              - value: "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"
                desc: "All bits set"
"#;
        let chip_id =
            upsert_imported_chip(&connection, yaml, "arm-128-test.yaml", None, None).unwrap();
        assert!(query_chips(&connection)
            .unwrap()
            .iter()
            .any(|record| record.id == chip_id));
        let _ = fs::remove_file(database.0);
    }

    #[test]
    fn imports_m_profile_special_and_scs_mmio_registers_together() {
        let database = temporary_database();
        initialize_database(&database).unwrap();
        let connection = open_database(&database).unwrap();
        let yaml = r#"schema_version: 2
sensor: "ARM_M_TEST"
vendor: "Arm"
family: "Armv8-M Mainline"
device_type: "architecture_registers"
register_space:
  kind: "arm_system"
  architecture: "Armv8-M Mainline"
  profile: "M"
source:
  title: "Synthetic CMSIS test"
  version: "test"
  document: "core_cm33.h"
  url: "https://example.invalid"
  license: "Apache-2.0"
pages:
  Special Registers:
    access: "MRS / MSR"
    desc: "CPU special registers"
    registers:
      - name: "CONTROL"
        access: "RW"
        width: 4
        bit_width: 32
        desc: "Control register"
        encoding:
          scheme: "m_profile_special"
          selector: "CONTROL"
        accessors:
          - name: "__get_CONTROL"
            kind: "read"
            instruction: "MRS <value>, CONTROL"
            encoding:
              scheme: "m_profile_special"
              selector: "CONTROL"
  SCB:
    access: "Memory-mapped Core Peripheral"
    desc: "System Control Block"
    registers:
      - addr: 0xE000ED00
        name: "CPUID"
        access: "RO"
        width: 4
        desc: "CPUID"
"#;
        let chip_id =
            upsert_imported_chip(&connection, yaml, "arm-m-test.yaml", None, None).unwrap();
        let records = query_chips(&connection).unwrap();
        assert_eq!(
            records
                .iter()
                .find(|record| record.id == chip_id)
                .unwrap()
                .sensor,
            "ARM_M_TEST"
        );
        let _ = fs::remove_file(database.0);
    }

    #[test]
    fn manages_attachment_links_without_exporting_or_deleting_files() {
        let database = temporary_database();
        initialize_database(&database).unwrap();
        let connection = open_database(&database).unwrap();
        let chip_id = import_test_chip(&connection);
        let attachment_path = database.0.with_extension("reference-manual.pdf");
        fs::write(&attachment_path, b"local attachment content").unwrap();

        let (attachments, added, failures) = add_attachment_paths(
            &connection,
            &chip_id,
            std::slice::from_ref(&attachment_path),
        )
        .unwrap();
        assert_eq!(added, 1);
        assert!(failures.is_empty());
        assert_eq!(attachments.len(), 1);
        assert!(attachments[0].exists);
        assert!(attachments[0].file_name.ends_with(".reference-manual.pdf"));

        let (deduplicated, added, _) = add_attachment_paths(
            &connection,
            &chip_id,
            std::slice::from_ref(&attachment_path),
        )
        .unwrap();
        assert_eq!(added, 0);
        assert_eq!(deduplicated.len(), 1);

        let selected: Vec<_> = query_chips(&connection)
            .unwrap()
            .into_iter()
            .filter(|record| record.id == chip_id)
            .collect();
        let html = build_standalone_html(&selected, true).unwrap();
        assert!(!html.contains(&attachment_path.to_string_lossy().into_owned()));
        assert!(!html.contains(&attachments[0].file_name));

        assert!(
            remove_chip_attachment(&connection, &chip_id, attachments[0].id,)
                .unwrap()
                .is_empty()
        );
        assert!(attachment_path.exists());
        let _ = fs::remove_file(attachment_path);
        let _ = fs::remove_file(database.0);
    }

    #[test]
    fn imports_and_refreshes_linked_yaml_without_losing_category() {
        let database = temporary_database();
        initialize_database(&database).unwrap();
        let connection = open_database(&database).unwrap();
        let linked_path = database.0.with_extension("yaml");
        fs::write(&linked_path, include_str!("../../dwc3_rk3588.yaml")).unwrap();

        let id = upsert_imported_chip(
            &connection,
            include_str!("../../dwc3_rk3588.yaml"),
            "linked.yaml",
            Some(&linked_path),
            Some("实验分类"),
        )
        .unwrap();
        let updated_yaml = include_str!("../../dwc3_rk3588.yaml").replacen(
            "sensor: RK3588_DWC3",
            "sensor: RK3588_DWC3_TEST",
            1,
        );
        fs::write(&linked_path, updated_yaml).unwrap();
        refresh_linked_chips(&connection);

        let records = query_chips(&connection).unwrap();
        let linked = records.iter().find(|record| record.id == id).unwrap();
        assert_eq!(linked.sensor, "RK3588_DWC3_TEST");
        assert_eq!(linked.category, "实验分类");
        assert_eq!(linked.source_kind, "linked");
        assert!(!linked.builtin);
        let refreshed_search =
            search::search(&connection, "RK3588_DWC3_TEST", Some(&id), 100, &[]).unwrap();
        assert!(refreshed_search
            .results
            .iter()
            .any(|result| result.kind == "chip" && result.chip_id == id));
        drop(connection);
        let _ = fs::remove_file(linked_path);
        let _ = fs::remove_file(database.0);
    }

    #[test]
    fn builds_and_queries_register_field_search_index() {
        let database = temporary_database();
        initialize_database(&database).unwrap();
        let connection = open_database(&database).unwrap();
        let chip_id = upsert_imported_chip(
            &connection,
            include_str!("../../dwc3_rk3588.yaml"),
            "search.yaml",
            None,
            Some("搜索测试"),
        )
        .unwrap();
        rebuild_chip_search_index(&connection, &chip_id).unwrap();

        let register_results =
            search::search(&connection, "USB3OTG_GSBUSCFG0", Some(&chip_id), 100, &[]).unwrap();
        assert!(register_results.results.iter().any(|result| {
            result.kind == "register" && result.register_name == "USB3OTG_GSBUSCFG0"
        }));
        let field_results =
            search::search(&connection, "datbigend", Some(&chip_id), 100, &[]).unwrap();
        assert!(field_results
            .results
            .iter()
            .any(|result| { result.kind == "field" && result.field_name == "datbigend" }));
        let fuzzy_results =
            search::search(&connection, "GSBUSCFG", Some(&chip_id), 100, &[]).unwrap();
        assert!(fuzzy_results
            .results
            .iter()
            .any(|result| result.register_name == "USB3OTG_GSBUSCFG0"));
        let typo_results =
            search::search(&connection, "USB3OTG_GSBUSCF0", Some(&chip_id), 100, &[]).unwrap();
        assert!(typo_results
            .results
            .iter()
            .any(|result| result.register_name == "USB3OTG_GSBUSCFG0"));
        let address_results =
            search::search(&connection, "0xC100", Some(&chip_id), 100, &[]).unwrap();
        assert_eq!(
            address_results.results[0].register_name,
            "USB3OTG_GSBUSCFG0"
        );
        update_chip_enabled(&connection, &chip_id, false).unwrap();
        let hidden = search::search(&connection, "USB3OTG_GSBUSCFG0", None, 100, &[]).unwrap();
        assert!(hidden
            .results
            .iter()
            .any(|result| result.register_name == "USB3OTG_GSBUSCFG0" && !result.enabled));
        let _ = fs::remove_file(database.0);
    }

    #[test]
    fn incrementally_updates_translation_and_note_search_documents() {
        let database = temporary_database();
        initialize_database(&database).unwrap();
        let connection = open_database(&database).unwrap();
        let chip_id = import_test_chip(&connection);
        rebuild_chip_search_index(&connection, &chip_id).unwrap();
        let source_sha256 = translation::sha256_hex(TEST_CHIP_YAML);
        let sidecar = format!(
            r#"translation_schema_version: 1
format: "register-reference-translation"
source_locale: "en"
locale: "zh-CN"
source_file: "controllers/usb/rockchip/rk3588-dwc3.yaml"
source_sha256: "{source_sha256}"
metadata:
  status: "draft"
  coverage: "partial"
  method: "human"
  translator: "search test"
  updated: "2026-08-18"
translations:
  pages:
    - name: "MMIO"
      registers:
        - name: "USB3OTG_GSBUSCFG0"
          fields:
            - name: "datbigend"
              bits: "11:11"
              desc: "数据访问的大端模式开关"
"#
        );
        upsert_translation(&connection, &sidecar, "rk3588-dwc3.zh-CN.yaml", None).unwrap();
        rebuild_chip_search_index(&connection, &chip_id).unwrap();
        let translated = search::search(&connection, "大端模式", Some(&chip_id), 100, &[]).unwrap();
        assert!(translated.results.iter().any(|result| {
            result.kind == "field"
                && result.field_name == "datbigend"
                && result.match_language == "zh-CN"
        }));

        let notes = upsert_register_note(
            &connection,
            &RegisterNoteInput {
                note_id: None,
                chip_id: chip_id.to_owned(),
                page_name: "MMIO".to_owned(),
                register_addr: Some(0xC100),
                register_key: "mmio:49408:USB3OTG_GSBUSCFG0".to_owned(),
                register_name: "USB3OTG_GSBUSCFG0".to_owned(),
                kind: "warning".to_owned(),
                content: "切换前先等待总线空闲".to_owned(),
            },
        )
        .unwrap();
        rebuild_note_search_index(&connection, &chip_id).unwrap();
        assert!(
            search::search(&connection, "总线空闲", Some(&chip_id), 100, &[])
                .unwrap()
                .results
                .iter()
                .any(|result| result.kind == "note")
        );

        upsert_register_note(
            &connection,
            &RegisterNoteInput {
                note_id: Some(notes[0].id),
                chip_id: chip_id.to_owned(),
                page_name: "MMIO".to_owned(),
                register_addr: Some(0xC100),
                register_key: "mmio:49408:USB3OTG_GSBUSCFG0".to_owned(),
                register_name: "USB3OTG_GSBUSCFG0".to_owned(),
                kind: "warning".to_owned(),
                content: "切换前确认描述符队列为空".to_owned(),
            },
        )
        .unwrap();
        rebuild_note_search_index(&connection, &chip_id).unwrap();
        assert!(
            search::search(&connection, "总线空闲", Some(&chip_id), 100, &[])
                .unwrap()
                .results
                .is_empty()
        );
        assert!(
            search::search(&connection, "描述符队列", Some(&chip_id), 100, &[])
                .unwrap()
                .results
                .iter()
                .any(|result| result.kind == "note")
        );

        remove_register_note(&connection, &chip_id, notes[0].id).unwrap();
        rebuild_note_search_index(&connection, &chip_id).unwrap();
        assert!(
            search::search(&connection, "描述符队列", Some(&chip_id), 100, &[])
                .unwrap()
                .results
                .is_empty()
        );
        let _ = fs::remove_file(database.0);
    }

    #[test]
    fn previews_identical_import_without_writing_or_losing_notes() {
        let database = temporary_database();
        initialize_database(&database).unwrap();
        let connection = open_database(&database).unwrap();
        let chip_id = import_test_chip(&connection);
        let notes = upsert_register_note(
            &connection,
            &RegisterNoteInput {
                note_id: None,
                chip_id: chip_id.clone(),
                page_name: "MMIO".to_owned(),
                register_addr: Some(0xC100),
                register_key: "mmio:49408:USB3OTG_GSBUSCFG0".to_owned(),
                register_name: "USB3OTG_GSBUSCFG0".to_owned(),
                kind: "note".to_owned(),
                content: "preview must not change this note".to_owned(),
            },
        )
        .unwrap();
        drop(connection);

        let folder = std::env::temp_dir().join(format!(
            "register-reference-preview-{}-{}",
            std::process::id(),
            DATABASE_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&folder).unwrap();
        let source_path = folder.join("dwc3_rk3588.yaml");
        fs::write(&source_path, TEST_CHIP_YAML).unwrap();
        let (report, pending) = import_preview_for_paths(
            &database,
            std::slice::from_ref(&source_path),
            None,
            false,
            "test-preview",
            None,
        )
        .unwrap();
        assert!(report.failures.is_empty());
        assert_eq!(report.files.len(), 1);
        assert_eq!(report.files[0].status, "unchanged");
        assert_eq!(
            report.files[0].changes,
            core_service::RegisterComparison::default()
        );
        assert_eq!(pending.skipped, 1);
        assert!(pending.parsed.is_empty());
        assert!(pending.failures.is_empty());

        let connection = open_database(&database).unwrap();
        assert_eq!(query_chips(&connection).unwrap().len(), 1);
        let notes_after_preview = query_register_notes(&connection, Some(&chip_id)).unwrap();
        assert_eq!(notes_after_preview.len(), notes.len());
        assert_eq!(notes_after_preview[0].id, notes[0].id);
        assert_eq!(notes_after_preview[0].content, notes[0].content);
        drop(connection);
        let _ = fs::remove_dir_all(folder);
        let _ = fs::remove_file(database.0);
    }

    #[test]
    fn preview_accepts_a_source_and_its_translation_in_the_same_batch() {
        let database = temporary_database();
        initialize_database(&database).unwrap();
        let folder = std::env::temp_dir().join(format!(
            "register-reference-preview-batch-{}-{}",
            std::process::id(),
            DATABASE_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&folder).unwrap();
        let source_path = folder.join("dwc3_rk3588.yaml");
        let translation_path = folder.join("dwc3_rk3588.zh-CN.yaml");
        fs::write(&source_path, TEST_CHIP_YAML).unwrap();
        let source_sha256 = translation::sha256_hex(TEST_CHIP_YAML);
        let sidecar = format!(
            r#"translation_schema_version: 1
format: "register-reference-translation"
source_locale: "en"
locale: "zh-CN"
source_file: "controllers/usb/rockchip/rk3588-dwc3.yaml"
source_sha256: "{source_sha256}"
metadata:
  status: "draft"
  coverage: "partial"
  method: "human"
  translator: "preview test"
  updated: "2026-08-19"
translations:
  pages:
    - name: "MMIO"
      registers:
        - name: "USB3OTG_GSBUSCFG0"
          desc: "总线配置寄存器"
"#
        );
        fs::write(&translation_path, sidecar).unwrap();

        let (report, pending) = import_preview_for_paths(
            &database,
            &[source_path, translation_path],
            None,
            false,
            "test-preview",
            None,
        )
        .unwrap();
        assert!(report.failures.is_empty());
        assert_eq!(report.files.len(), 2);
        assert!(report.files.iter().all(|file| file.status == "new"));
        assert_eq!(pending.parsed.len(), 2);
        assert_eq!(pending.skipped, 0);
        assert!(pending.failures.is_empty());
        assert!(
            !report
                .files
                .iter()
                .find(|file| file.kind == "source")
                .unwrap()
                .translation_missing
        );
        assert!(query_chips(&open_database(&database).unwrap())
            .unwrap()
            .is_empty());

        let _ = fs::remove_dir_all(folder);
        let _ = fs::remove_file(database.0);
    }

    #[test]
    fn rejects_invalid_yaml_without_writing_it_to_the_library() {
        let database = temporary_database();
        initialize_database(&database).unwrap();
        let connection = open_database(&database).unwrap();
        let before = query_chips(&connection).unwrap().len();
        let invalid_yaml = r#"schema_version: 1
sensor: INVALID_TEST
who_am_i:
  reg: null
  values: []
pages:
  MAIN:
    page_id: 0
    access: "I2C"
    desc: "test"
    registers:
      - addr: 0x10
        name: CTRL
        access: RW
        width: 1
        reset: 0x01
        desc: "test"
        fields:
          - name: enable
            bits: "8:8"
            reset: 0x00
            desc: "out of range"
"#;

        let error = upsert_imported_chip(&connection, invalid_yaml, "invalid.yaml", None, None)
            .unwrap_err();

        assert!(error.contains("YAML 规范校验未通过"));
        assert!(error.contains("超出寄存器有效位宽"));
        assert_eq!(query_chips(&connection).unwrap().len(), before);
        drop(connection);

        let invalid_path = database.0.with_extension("invalid.yaml");
        fs::write(&invalid_path, invalid_yaml).unwrap();
        let (preview, pending) = import_preview_for_paths(
            &database,
            std::slice::from_ref(&invalid_path),
            None,
            false,
            "test-preview",
            None,
        )
        .unwrap();
        assert_eq!(preview.files.len(), 1);
        assert_eq!(preview.files[0].status, "rejected");
        assert_eq!(preview.failures.len(), 1);
        assert_eq!(pending.failures, preview.failures);
        assert!(pending.parsed.is_empty());
        assert_eq!(pending.skipped, 0);
        assert!(query_chips(&open_database(&database).unwrap())
            .unwrap()
            .is_empty());
        let _ = fs::remove_file(invalid_path);
        let _ = fs::remove_file(database.0);
    }

    #[test]
    #[ignore = "requires REGISTER_SEARCH_BENCH_DB and rebuilds a temporary copy"]
    fn benchmarks_real_search_library() {
        let source = std::env::var("REGISTER_SEARCH_BENCH_DB")
            .expect("REGISTER_SEARCH_BENCH_DB must point to a register library database");
        let database = temporary_database();
        fs::copy(&source, &database.0).unwrap();
        let baseline_bytes = fs::metadata(&database.0).unwrap().len();
        initialize_database(&database).unwrap();
        let mut connection = open_database(&database).unwrap();
        let chip_ids = query_chips(&connection)
            .unwrap()
            .into_iter()
            .map(|record| record.id)
            .collect::<Vec<_>>();
        let current_chip_id = chip_ids.first().map(String::as_str);

        let rebuild_started = std::time::Instant::now();
        let transaction = connection.transaction().unwrap();
        search::mark_index_stale(&transaction).unwrap();
        transaction
            .execute("DELETE FROM search_documents", [])
            .unwrap();
        for chip_id in &chip_ids {
            rebuild_chip_search_index(&transaction, chip_id).unwrap();
        }
        search::mark_index_ready(&transaction).unwrap();
        transaction.commit().unwrap();
        let rebuild_ms = rebuild_started.elapsed().as_millis();
        connection.execute_batch("VACUUM").unwrap();

        let document_count = connection
            .query_row("SELECT COUNT(*) FROM search_documents", [], |row| {
                row.get::<_, usize>(0)
            })
            .unwrap();
        let index_bytes = connection
            .query_row(
                "SELECT COALESCE(SUM(pgsize), 0) FROM dbstat
                 WHERE name = 'search_documents' OR name LIKE 'search_fts%'",
                [],
                |row| row.get::<_, u64>(0),
            )
            .unwrap();
        let database_bytes = fs::metadata(&database.0).unwrap().len();
        let queries = [
            "bus error address",
            "USB3OTG_GBUSERRADDRLO",
            "USB3OTG_GBUSERRADDRL0",
            "总线错误地址",
            "Global SoC Bus Configuration Register",
            "0xC118",
            "C118",
            "chip:m3 type:field access:rw overflow",
            "bits:31:28",
        ];
        for query in queries {
            let response = search::search(&connection, query, current_chip_id, 100, &[]).unwrap();
            assert!(
                !response.results.is_empty(),
                "representative query returned no results: {query}"
            );
        }

        let mut samples = Vec::new();
        let mut query_samples = vec![Vec::new(); queries.len()];
        for _ in 0..30 {
            for (query_index, query) in queries.iter().enumerate() {
                let started = std::time::Instant::now();
                search::search(&connection, query, current_chip_id, 100, &[]).unwrap();
                let elapsed = started.elapsed().as_micros();
                samples.push(elapsed);
                query_samples[query_index].push(elapsed);
            }
        }
        samples.sort_unstable();
        let p50_us = samples[samples.len() / 2];
        let p95_us = samples[(samples.len() * 95 / 100).min(samples.len() - 1)];
        println!(
            "search-benchmark baseline_bytes={baseline_bytes} database_bytes={database_bytes} index_bytes={index_bytes} chips={} documents={document_count} rebuild_ms={rebuild_ms} p50_us={p50_us} p95_us={p95_us}",
            chip_ids.len()
        );
        for (query, mut timings) in queries.into_iter().zip(query_samples) {
            timings.sort_unstable();
            let query_p50 = timings[timings.len() / 2];
            let query_p95 = timings[(timings.len() * 95 / 100).min(timings.len() - 1)];
            println!("search-query query={query:?} p50_us={query_p50} p95_us={query_p95}");
        }
        let _ = fs::remove_file(database.0);
    }
}

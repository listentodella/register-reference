use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{Manager, State};
use walkdir::WalkDir;

mod translation;
mod validation;

const BUILTIN_CHIPS: [(&str, &str, &str); 1] = [(
    "builtin:dwc3-rk3588",
    "dwc3_rk3588.yaml",
    include_str!("../../dwc3_rk3588.yaml"),
)];

#[derive(Clone)]
struct DatabasePath(PathBuf);

#[derive(Debug, Serialize)]
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
    yaml_text: String,
    notes: Vec<RegisterNote>,
    attachments: Vec<ChipAttachment>,
    translations: Vec<TranslationRecord>,
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
    failures: Vec<String>,
    folder: Option<String>,
}

fn open_database(path: &DatabasePath) -> Result<Connection, String> {
    Connection::open(&path.0).map_err(|error| format!("无法打开芯片库：{error}"))
}

fn initialize_database(path: &DatabasePath) -> Result<(), String> {
    if let Some(parent) = path.0.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建数据目录：{error}"))?;
    }
    let connection = open_database(path)?;
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
                ON chip_attachments(chip_id, created_at DESC);",
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

    let has_register_key = connection
        .prepare("PRAGMA table_info(register_notes)")
        .and_then(|mut statement| {
            statement
                .query_map([], |row| row.get::<_, String>(1))?
                .collect::<Result<Vec<_>, _>>()
        })
        .map_err(|error| format!("无法检查备注表结构：{error}"))?
        .iter()
        .any(|column| column == "register_key");
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

    for (id, source_name, yaml_text) in BUILTIN_CHIPS {
        let metadata = parse_metadata(yaml_text)?;
        let category = default_category(&metadata);
        connection
            .execute(
                "INSERT INTO chips (
                    id, sensor, vendor, family, device_type, category, enabled, builtin,
                    source_kind, source_name, source_path, yaml_text
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 1, 'builtin', ?7, NULL, ?8)
                 ON CONFLICT(id) DO UPDATE SET
                    sensor = excluded.sensor,
                    vendor = excluded.vendor,
                    family = excluded.family,
                    device_type = excluded.device_type,
                    builtin = 1,
                    source_kind = 'builtin',
                    source_name = excluded.source_name,
                    source_path = NULL,
                    yaml_text = excluded.yaml_text,
                    updated_at = CURRENT_TIMESTAMP",
                params![
                    id,
                    metadata.sensor,
                    metadata.vendor,
                    metadata.family,
                    metadata.device_type,
                    category,
                    source_name,
                    yaml_text
                ],
            )
            .map_err(|error| format!("无法写入内置芯片 {source_name}：{error}"))?;
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

fn parse_metadata(yaml_text: &str) -> Result<ChipMetadata, String> {
    let document: serde_yaml::Value =
        serde_yaml::from_str(yaml_text).map_err(|error| format!("YAML 解析失败：{error}"))?;
    validation::validate_register_yaml(yaml_text, &document)?;
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
    let metadata = parse_metadata(yaml_text)?;
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

    connection
        .execute(
            "INSERT INTO chips (
                id, sensor, vendor, family, device_type, category, enabled, builtin,
                source_kind, source_name, source_path, yaml_text
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 0, ?7, ?8, ?9, ?10)
             ON CONFLICT(id) DO UPDATE SET
                sensor = excluded.sensor,
                vendor = excluded.vendor,
                family = excluded.family,
                device_type = excluded.device_type,
                source_kind = excluded.source_kind,
                source_name = excluded.source_name,
                source_path = excluded.source_path,
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
                yaml_text
            ],
        )
        .map_err(|error| format!("无法保存 {source_name}：{error}"))?;
    Ok(id)
}

fn refresh_linked_chips(connection: &Connection) {
    let linked: Vec<(String, String, String)> = connection
        .prepare("SELECT id, source_path, category FROM chips WHERE source_kind = 'linked'")
        .and_then(|mut statement| {
            statement
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
                .collect()
        })
        .unwrap_or_default();

    for (_, source_path, category) in linked {
        let path = PathBuf::from(&source_path);
        let Ok(yaml_text) = fs::read_to_string(&path) else {
            continue;
        };
        let source_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("registers.yaml");
        let _ = upsert_imported_chip(
            connection,
            &yaml_text,
            source_name,
            Some(&path),
            Some(&category),
        );
    }
}

fn matching_source_yaml(connection: &Connection, source_sha256: &str) -> Result<String, String> {
    let mut statement = connection
        .prepare("SELECT yaml_text FROM chips")
        .map_err(|error| format!("无法读取英文源 YAML：{error}"))?;
    let yaml_texts = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("无法查询英文源 YAML：{error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("无法读取英文源 YAML：{error}"))?;
    yaml_texts
        .into_iter()
        .find(|text| translation::sha256_hex(text) == source_sha256)
        .ok_or_else(|| {
            "找不到与 source_sha256 匹配的英文源 YAML；请先导入对应英文寄存器文件".to_owned()
        })
}

fn upsert_translation(
    connection: &Connection,
    yaml_text: &str,
    source_name: &str,
    source_path: Option<&Path>,
) -> Result<(), String> {
    let document: serde_yaml::Value =
        serde_yaml::from_str(yaml_text).map_err(|error| format!("翻译 YAML 解析失败：{error}"))?;
    if !translation::is_translation_document(&document) {
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
        &document,
        &source_text,
        &source_document,
    )?;
    let source_path_text = source_path.map(|path| path.to_string_lossy().into_owned());
    let source_key = source_path_text
        .clone()
        .unwrap_or_else(|| format!("imported:{}", summary.source_file));
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
                translator, updated, source_path, yaml_text, source_key
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
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
                yaml_text,
                source_key,
            ],
        )
        .map_err(|error| format!("无法保存译文 {source_name}：{error}"))?;
    Ok(())
}

fn refresh_linked_translations(connection: &Connection) {
    let linked = connection
        .prepare("SELECT source_path FROM translations WHERE source_path IS NOT NULL")
        .and_then(|mut statement| {
            statement
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()
        })
        .unwrap_or_default();
    for source_path in linked {
        let path = PathBuf::from(&source_path);
        let Ok(yaml_text) = fs::read_to_string(&path) else {
            continue;
        };
        let source_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("translation.yaml");
        let _ = upsert_translation(connection, &yaml_text, source_name, Some(&path));
    }
}

fn query_chips(connection: &Connection) -> Result<Vec<ChipRecord>, String> {
    refresh_linked_translations(connection);
    let mut statement = connection
        .prepare(
            "SELECT id, sensor, vendor, family, device_type, category, enabled, builtin,
                    source_kind, source_name, source_path, yaml_text
             FROM chips
             ORDER BY category COLLATE NOCASE, sensor COLLATE NOCASE",
        )
        .map_err(|error| format!("无法读取芯片库：{error}"))?;
    let mut records = statement
        .query_map([], |row| {
            let yaml_text: String = row.get(11)?;
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
                source_sha256: translation::sha256_hex(&yaml_text),
                yaml_text,
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

#[tauri::command]
fn list_chips(database: State<'_, DatabasePath>) -> Result<Vec<ChipRecord>, String> {
    let connection = open_database(&database)?;
    refresh_linked_chips(&connection);
    query_chips(&connection)
}

#[tauri::command]
fn import_yaml(
    database: State<'_, DatabasePath>,
    source_name: String,
    yaml_text: String,
    category: Option<String>,
) -> Result<Vec<ChipRecord>, String> {
    let connection = open_database(&database)?;
    upsert_imported_chip(
        &connection,
        &yaml_text,
        &source_name,
        None,
        category.as_deref(),
    )?;
    query_chips(&connection)
}

#[tauri::command]
fn import_yaml_directory(
    database: State<'_, DatabasePath>,
    category: Option<String>,
) -> Result<ImportReport, String> {
    let Some(folder) = rfd::FileDialog::new().pick_folder() else {
        return Ok(ImportReport {
            imported: 0,
            translations: 0,
            failures: Vec::new(),
            folder: None,
        });
    };
    let connection = open_database(&database)?;
    let mut imported = 0;
    let mut translations = 0;
    let mut failures = Vec::new();

    let mut files = Vec::new();
    for entry in WalkDir::new(&folder)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
    {
        let path = entry.path();
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if !entry.file_type().is_file()
            || !matches!(extension.to_ascii_lowercase().as_str(), "yaml" | "yml")
        {
            continue;
        }
        let source_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("registers.yaml");
        match fs::read_to_string(path) {
            Ok(yaml_text) => files.push((path.to_owned(), source_name.to_owned(), yaml_text)),
            Err(error) => failures.push(format!("{}: 读取失败：{error}", path.display())),
        }
    }

    let mut source_files = Vec::new();
    let mut translation_files = Vec::new();
    for (path, source_name, yaml_text) in files {
        match serde_yaml::from_str::<serde_yaml::Value>(&yaml_text) {
            Ok(document) if translation::is_translation_document(&document) => {
                translation_files.push((path, source_name, yaml_text));
            }
            _ => source_files.push((path, source_name, yaml_text)),
        }
    }
    for (path, source_name, yaml_text) in source_files {
        match upsert_imported_chip(
            &connection,
            &yaml_text,
            &source_name,
            Some(&path),
            category.as_deref(),
        ) {
            Ok(_) => imported += 1,
            Err(error) => failures.push(format!("{}: {error}", path.display())),
        }
    }
    for (path, source_name, yaml_text) in translation_files {
        match upsert_translation(&connection, &yaml_text, &source_name, Some(&path)) {
            Ok(_) => translations += 1,
            Err(error) => failures.push(format!("{}: {error}", path.display())),
        }
    }

    Ok(ImportReport {
        imported,
        translations,
        failures,
        folder: Some(folder.to_string_lossy().into_owned()),
    })
}

#[tauri::command]
fn import_translation(
    database: State<'_, DatabasePath>,
    source_name: String,
    yaml_text: String,
) -> Result<Vec<ChipRecord>, String> {
    let connection = open_database(&database)?;
    upsert_translation(&connection, &yaml_text, &source_name, None)?;
    query_chips(&connection)
}

#[tauri::command]
fn set_chip_enabled(
    database: State<'_, DatabasePath>,
    chip_id: String,
    enabled: bool,
) -> Result<(), String> {
    let connection = open_database(&database)?;
    update_chip_enabled(&connection, &chip_id, enabled)
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
    Ok(())
}

#[tauri::command]
fn set_chip_category(
    database: State<'_, DatabasePath>,
    chip_id: String,
    category: String,
) -> Result<(), String> {
    let connection = open_database(&database)?;
    update_chip_category(&connection, &chip_id, &category)
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
    Ok(())
}

#[tauri::command]
fn save_register_note(
    database: State<'_, DatabasePath>,
    input: RegisterNoteInput,
) -> Result<Vec<RegisterNote>, String> {
    let connection = open_database(&database)?;
    upsert_register_note(&connection, &input)
}

#[tauri::command]
fn delete_register_note(
    database: State<'_, DatabasePath>,
    chip_id: String,
    note_id: i64,
) -> Result<Vec<RegisterNote>, String> {
    let connection = open_database(&database)?;
    remove_register_note(&connection, &chip_id, note_id)
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
    let removable = transaction
        .query_row(
            "SELECT 1 FROM chips WHERE id = ?1 AND builtin = 0",
            params![chip_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(|error| format!("无法确认芯片状态：{error}"))?
        .is_some();
    if !removable {
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
            "DELETE FROM chips WHERE id = ?1 AND builtin = 0",
            params![chip_id],
        )
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
        &format!("<script>{}</script>", include_str!("../../app.js")),
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_chips,
            import_yaml,
            import_translation,
            import_yaml_directory,
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

    fn temporary_database() -> DatabasePath {
        let path = std::env::temp_dir().join(format!(
            "register-reference-{}-{}.sqlite3",
            std::process::id(),
            DATABASE_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_file(&path);
        DatabasePath(path)
    }

    #[test]
    fn seeds_and_updates_library_without_overwriting_user_settings() {
        let database = temporary_database();
        initialize_database(&database).unwrap();
        let connection = open_database(&database).unwrap();
        let records = query_chips(&connection).unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records.iter().filter(|record| record.builtin).count(), 1);

        update_chip_category(&connection, "builtin:dwc3-rk3588", "自定义").unwrap();
        update_chip_enabled(&connection, "builtin:dwc3-rk3588", false).unwrap();
        drop(connection);
        initialize_database(&database).unwrap();
        let records = query_chips(&open_database(&database).unwrap()).unwrap();
        let dwc3 = records
            .iter()
            .find(|record| record.id == "builtin:dwc3-rk3588")
            .unwrap();
        assert_eq!(dwc3.category, "自定义");
        assert!(!dwc3.enabled);
        let _ = fs::remove_file(database.0);
    }

    #[test]
    fn standalone_html_inlines_viewer_and_numeric_enum_keys() {
        let database = temporary_database();
        initialize_database(&database).unwrap();
        let connection = open_database(&database).unwrap();
        upsert_register_note(
            &connection,
            &RegisterNoteInput {
                note_id: None,
                chip_id: "builtin:dwc3-rk3588".to_owned(),
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
            .filter(|record| record.id == "builtin:dwc3-rk3588")
            .collect();
        let html = build_standalone_html(&selected, true).unwrap();
        assert!(html.contains("window.REGISTER_CHIPS="));
        assert!(html.contains("class=\"standalone\""));
        assert!(html.contains("RK3588_DWC3"));
        assert!(!html.contains("src=\"app.js\""));
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
        let source_text = BUILTIN_CHIPS[0].2;
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
        let record = records
            .iter()
            .find(|record| record.id == "builtin:dwc3-rk3588")
            .unwrap();
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

        let notes = upsert_register_note(
            &connection,
            &RegisterNoteInput {
                note_id: None,
                chip_id: "builtin:dwc3-rk3588".to_owned(),
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
                chip_id: "builtin:dwc3-rk3588".to_owned(),
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

        assert!(
            remove_register_note(&connection, "builtin:dwc3-rk3588", notes[0].id)
                .unwrap()
                .is_empty()
        );
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
        let attachment_path = database.0.with_extension("reference-manual.pdf");
        fs::write(&attachment_path, b"local attachment content").unwrap();

        let (attachments, added, failures) = add_attachment_paths(
            &connection,
            "builtin:dwc3-rk3588",
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
            "builtin:dwc3-rk3588",
            std::slice::from_ref(&attachment_path),
        )
        .unwrap();
        assert_eq!(added, 0);
        assert_eq!(deduplicated.len(), 1);

        let selected: Vec<_> = query_chips(&connection)
            .unwrap()
            .into_iter()
            .filter(|record| record.id == "builtin:dwc3-rk3588")
            .collect();
        let html = build_standalone_html(&selected, true).unwrap();
        assert!(!html.contains(&attachment_path.to_string_lossy().into_owned()));
        assert!(!html.contains(&attachments[0].file_name));

        assert!(
            remove_chip_attachment(&connection, "builtin:dwc3-rk3588", attachments[0].id,)
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
        drop(connection);
        let _ = fs::remove_file(linked_path);
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
        let _ = fs::remove_file(database.0);
    }
}

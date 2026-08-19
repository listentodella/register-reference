use crate::{core_service, search};
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use serde_yaml::Value;
use std::collections::BTreeMap;
use std::fmt;
use std::path::{Path, PathBuf};
use std::time::Duration;

const REQUIRED_TABLES: &[(&str, &[&str])] = &[
    (
        "chips",
        &[
            "id",
            "sensor",
            "vendor",
            "family",
            "device_type",
            "category",
            "enabled",
            "source_kind",
            "source_name",
            "source_path",
            "source_sha256",
            "yaml_text",
            "created_at",
            "updated_at",
        ],
    ),
    ("translations", &["source_sha256", "locale"]),
    ("app_metadata", &["key", "value"]),
    (
        "search_documents",
        &[
            "chip_id",
            "kind",
            "register_index",
            "register_locator",
            "field_bits",
            "access",
            "source_text",
            "translated_text",
        ],
    ),
];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReadServiceError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<JsonValue>,
}

impl ReadServiceError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_owned(),
            message: message.into(),
            details: None,
        }
    }

    fn with_details(mut self, details: JsonValue) -> Self {
        self.details = Some(details);
        self
    }
}

impl fmt::Display for ReadServiceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for ReadServiceError {}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChipSelector {
    pub chip: String,
    #[serde(default)]
    pub source_sha256: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RegisterSelector {
    pub chip: String,
    #[serde(default)]
    pub source_sha256: Option<String>,
    pub page: String,
    #[serde(default)]
    pub register_name: Option<String>,
    #[serde(default)]
    pub register_locator: Option<String>,
    #[serde(default)]
    pub register_index: Option<usize>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChipCatalogEntry {
    pub chip: String,
    pub vendor: String,
    pub family: String,
    pub device_type: String,
    pub category: String,
    pub hidden: bool,
    pub source_kind: String,
    pub source_name: String,
    pub source_sha256: String,
    pub translation_present: bool,
    pub translation_locales: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RegisterCandidate {
    pub chip: String,
    pub source_sha256: String,
    pub page: String,
    pub register_name: String,
    pub register_locator: String,
    pub register_index: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RegisterLookup {
    pub chip: String,
    pub source_sha256: String,
    pub register: core_service::RegisterDetails,
    pub source: core_service::SourceMetadata,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FieldLookup {
    pub chip: String,
    pub source_sha256: String,
    pub register: RegisterCandidate,
    pub field: core_service::FieldDetails,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DecodeLookup {
    pub chip: String,
    pub source_sha256: String,
    pub register: RegisterCandidate,
    pub decoded: core_service::DecodedRegisterValue,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchLookupResult {
    pub entity_type: String,
    pub chip: String,
    pub source_sha256: String,
    pub category: String,
    pub hidden: bool,
    pub page: String,
    pub register_name: String,
    pub register_locator: String,
    pub register_index: Option<usize>,
    pub field_name: String,
    pub field_bits: String,
    pub title: String,
    pub snippet: String,
    pub match_kind: String,
    pub match_reason: String,
    pub match_language: String,
    pub section: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchLookupResponse {
    pub status: String,
    pub results: Vec<SearchLookupResult>,
    pub filters: Vec<search::SearchFilter>,
    pub issues: Vec<search::SearchIssue>,
    pub suggestion: String,
    pub notes_included: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RegisterComparisonLookup {
    pub left: RegisterCandidate,
    pub right: RegisterCandidate,
    pub comparison: core_service::RegisterStructureComparison,
}

#[derive(Clone, Debug)]
struct ChipRow {
    id: String,
    sensor: String,
    vendor: String,
    family: String,
    device_type: String,
    category: String,
    enabled: bool,
    source_kind: String,
    source_name: String,
    source_path: Option<String>,
    source_sha256: String,
    yaml_text: String,
    created_at: String,
    updated_at: String,
}

#[derive(Clone, Debug)]
struct ResolvedRegister {
    chip: ChipRow,
    register: core_service::RegisterDetails,
}

#[derive(Clone, Debug)]
pub(crate) struct ReadService {
    database_path: PathBuf,
}

impl ReadService {
    pub(crate) fn open(database_path: impl Into<PathBuf>) -> Result<Self, ReadServiceError> {
        let service = Self {
            database_path: database_path.into(),
        };
        if !service.database_path.is_file() {
            return Err(ReadServiceError::new(
                "database_not_found",
                format!(
                    "寄存器数据库不存在：{}；请先在桌面应用中导入芯片，或使用 --db 指定数据库",
                    service.database_path.display()
                ),
            ));
        }
        let connection = service.connect()?;
        service.validate_schema(&connection)?;
        Ok(service)
    }

    pub(crate) fn database_path(&self) -> &Path {
        &self.database_path
    }

    fn connect(&self) -> Result<Connection, ReadServiceError> {
        let connection = Connection::open_with_flags(
            &self.database_path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|error| {
            ReadServiceError::new(
                "database_open_failed",
                format!("无法只读打开寄存器数据库：{error}"),
            )
        })?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(|error| {
                ReadServiceError::new(
                    "database_open_failed",
                    format!("无法配置数据库读取等待时间：{error}"),
                )
            })?;
        connection
            .pragma_update(None, "query_only", true)
            .map_err(|error| {
                ReadServiceError::new(
                    "database_open_failed",
                    format!("无法启用 SQLite 只读保护：{error}"),
                )
            })?;
        Ok(connection)
    }

    fn validate_schema(&self, connection: &Connection) -> Result<(), ReadServiceError> {
        for (table, columns) in REQUIRED_TABLES {
            let exists = connection
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type IN ('table', 'view') AND name = ?1)",
                    [*table],
                    |row| row.get::<_, bool>(0),
                )
                .map_err(database_error)?;
            if !exists {
                return Err(ReadServiceError::new(
                    "database_incompatible",
                    format!("数据库缺少 {table} 表；请先使用当前版本桌面应用打开并升级数据库"),
                ));
            }
            let query = format!("PRAGMA table_info({table})");
            let present = connection
                .prepare(&query)
                .and_then(|mut statement| {
                    statement
                        .query_map([], |row| row.get::<_, String>(1))?
                        .collect::<Result<Vec<_>, _>>()
                })
                .map_err(database_error)?;
            let missing = columns
                .iter()
                .filter(|column| !present.iter().any(|candidate| candidate == **column))
                .copied()
                .collect::<Vec<_>>();
            if !missing.is_empty() {
                return Err(ReadServiceError::new(
                    "database_incompatible",
                    format!(
                        "数据库表 {table} 缺少字段 {}；请先使用当前版本桌面应用升级数据库",
                        missing.join(", ")
                    ),
                ));
            }
        }
        let search_version = connection
            .query_row(
                "SELECT value FROM app_metadata WHERE key = 'search_schema_version'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(database_error)?;
        if search_version
            .as_deref()
            .is_some_and(|version| version != search::SEARCH_SCHEMA_VERSION)
        {
            return Err(ReadServiceError::new(
                "database_incompatible",
                format!(
                    "搜索索引版本不兼容（数据库 {}，MCP {}）；请在桌面应用中重建索引",
                    search_version.unwrap_or_default(),
                    search::SEARCH_SCHEMA_VERSION
                ),
            ));
        }
        Ok(())
    }

    fn chip_rows(&self, connection: &Connection) -> Result<Vec<ChipRow>, ReadServiceError> {
        let mut statement = connection
            .prepare(
                "SELECT id, sensor, vendor, family, device_type, category, enabled, source_kind,
                        source_name, source_path, source_sha256, yaml_text, created_at, updated_at
                 FROM chips ORDER BY category COLLATE NOCASE, sensor COLLATE NOCASE, source_name COLLATE NOCASE",
            )
            .map_err(database_error)?;
        let rows = statement
            .query_map([], |row| {
                Ok(ChipRow {
                    id: row.get(0)?,
                    sensor: row.get(1)?,
                    vendor: row.get(2)?,
                    family: row.get(3)?,
                    device_type: row.get(4)?,
                    category: row.get(5)?,
                    enabled: row.get::<_, i64>(6)? != 0,
                    source_kind: row.get(7)?,
                    source_name: row.get(8)?,
                    source_path: row.get(9)?,
                    source_sha256: row.get(10)?,
                    yaml_text: row.get(11)?,
                    created_at: row.get(12)?,
                    updated_at: row.get(13)?,
                })
            })
            .map_err(database_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(database_error)?;
        Ok(rows)
    }

    fn translation_locales(
        &self,
        connection: &Connection,
        source_sha256: &str,
    ) -> Result<Vec<String>, ReadServiceError> {
        connection
            .prepare(
                "SELECT DISTINCT locale FROM translations WHERE source_sha256 = ?1 ORDER BY locale",
            )
            .and_then(|mut statement| {
                statement
                    .query_map([source_sha256], |row| row.get::<_, String>(0))?
                    .collect::<Result<Vec<_>, _>>()
            })
            .map_err(database_error)
    }

    pub(crate) fn chip_catalog(&self) -> Result<Vec<ChipCatalogEntry>, ReadServiceError> {
        let connection = self.connect()?;
        self.chip_rows(&connection)?
            .into_iter()
            .map(|chip| {
                let translation_locales =
                    self.translation_locales(&connection, &chip.source_sha256)?;
                Ok(ChipCatalogEntry {
                    chip: chip.sensor,
                    vendor: chip.vendor,
                    family: chip.family,
                    device_type: chip.device_type,
                    category: chip.category,
                    hidden: !chip.enabled,
                    source_kind: chip.source_kind,
                    source_name: chip.source_name,
                    source_sha256: chip.source_sha256,
                    translation_present: !translation_locales.is_empty(),
                    translation_locales,
                })
            })
            .collect()
    }

    fn resolve_chip(
        &self,
        connection: &Connection,
        selector: &ChipSelector,
    ) -> Result<ChipRow, ReadServiceError> {
        let chip_name = selector.chip.trim();
        if chip_name.is_empty() {
            return Err(ReadServiceError::new(
                "invalid_input",
                "chip 不能为空；先调用 get_chip_catalog 获取可用名称",
            ));
        }
        let source_sha256 = selector
            .source_sha256
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let matches = self
            .chip_rows(connection)?
            .into_iter()
            .filter(|chip| chip.sensor.eq_ignore_ascii_case(chip_name))
            .filter(|chip| source_sha256.is_none_or(|hash| chip.source_sha256 == hash))
            .collect::<Vec<_>>();
        match matches.as_slice() {
            [chip] => Ok(chip.clone()),
            [] => Err(ReadServiceError::new(
                "chip_not_found",
                format!(
                    "没有找到芯片 {chip_name}；请调用 get_chip_catalog 检查名称和 sourceSha256"
                ),
            )),
            _ => Err(ReadServiceError::new(
                "ambiguous_chip",
                format!("芯片名称 {chip_name} 不唯一；请补充 sourceSha256"),
            )
            .with_details(json!({
                "candidates": matches.iter().map(|chip| json!({
                    "chip": chip.sensor,
                    "vendor": chip.vendor,
                    "category": chip.category,
                    "sourceName": chip.source_name,
                    "sourceSha256": chip.source_sha256,
                })).collect::<Vec<_>>()
            }))),
        }
    }

    fn parse_chip_document(&self, chip: &ChipRow) -> Result<Value, ReadServiceError> {
        serde_yaml::from_str(&chip.yaml_text).map_err(|error| {
            ReadServiceError::new(
                "invalid_chip_document",
                format!("芯片 {} 的 YAML 无法解析：{error}", chip.sensor),
            )
        })
    }

    fn source_metadata(
        &self,
        connection: &Connection,
        chip: &ChipRow,
        document: &Value,
    ) -> Result<core_service::SourceMetadata, ReadServiceError> {
        let source = document
            .as_mapping()
            .and_then(|root| root.get(Value::String("source".to_owned())))
            .and_then(Value::as_mapping);
        let metadata_text = |name: &str| {
            source
                .and_then(|source| source.get(Value::String(name.to_owned())))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim()
                .to_owned()
        };
        let translation_locales = self.translation_locales(connection, &chip.source_sha256)?;
        let version = metadata_text("version");
        Ok(core_service::SourceMetadata {
            source_name: chip.source_name.clone(),
            source_path: chip.source_path.clone(),
            source_sha256: chip.source_sha256.clone(),
            source_title: metadata_text("title"),
            source_version: if version.is_empty() {
                metadata_text("revision")
            } else {
                version
            },
            source_document: metadata_text("document"),
            imported_at: chip.created_at.clone(),
            updated_at: chip.updated_at.clone(),
            translation_present: !translation_locales.is_empty(),
            translation_locales,
        })
    }

    pub(crate) fn get_source_metadata(
        &self,
        selector: &ChipSelector,
    ) -> Result<core_service::SourceMetadata, ReadServiceError> {
        let connection = self.connect()?;
        let chip = self.resolve_chip(&connection, selector)?;
        let document = self.parse_chip_document(&chip)?;
        self.source_metadata(&connection, &chip, &document)
    }

    fn resolve_register(
        &self,
        connection: &Connection,
        selector: &RegisterSelector,
    ) -> Result<ResolvedRegister, ReadServiceError> {
        if selector.page.trim().is_empty() {
            return Err(ReadServiceError::new("invalid_input", "page 不能为空"));
        }
        if selector.register_name.as_deref().is_none_or(str::is_empty)
            && selector
                .register_locator
                .as_deref()
                .is_none_or(str::is_empty)
            && selector.register_index.is_none()
        {
            return Err(ReadServiceError::new(
                "invalid_input",
                "至少提供 registerName、registerLocator 或 registerIndex 之一",
            ));
        }
        let chip = self.resolve_chip(
            connection,
            &ChipSelector {
                chip: selector.chip.clone(),
                source_sha256: selector.source_sha256.clone(),
            },
        )?;
        let document = self.parse_chip_document(&chip)?;
        let pages = document
            .as_mapping()
            .and_then(|root| root.get(Value::String("pages".to_owned())))
            .and_then(Value::as_mapping)
            .ok_or_else(|| {
                ReadServiceError::new("invalid_chip_document", "芯片 YAML 缺少 pages")
            })?;
        let page_names = pages
            .keys()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect::<Vec<_>>();
        let page_name = page_names
            .iter()
            .find(|name| name.eq_ignore_ascii_case(selector.page.trim()))
            .cloned()
            .ok_or_else(|| {
                ReadServiceError::new(
                    "page_not_found",
                    format!("芯片 {} 没有页面 {}", chip.sensor, selector.page),
                )
                .with_details(json!({ "availablePages": page_names }))
            })?;
        let register_count = pages
            .get(Value::String(page_name.clone()))
            .and_then(Value::as_mapping)
            .and_then(|page| page.get(Value::String("registers".to_owned())))
            .and_then(Value::as_sequence)
            .map(Vec::len)
            .unwrap_or_default();
        let expected_name = selector
            .register_name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let expected_locator = selector
            .register_locator
            .as_deref()
            .map(normalize_locator)
            .filter(|value| !value.is_empty());
        let matches = (0..register_count)
            .filter_map(|index| core_service::get_register(&document, &page_name, index))
            .filter(|register| {
                selector
                    .register_index
                    .is_none_or(|index| register.register_index == index)
                    && expected_name.is_none_or(|name| register.name.eq_ignore_ascii_case(name))
                    && expected_locator
                        .as_deref()
                        .is_none_or(|locator| normalize_locator(&register.locator) == locator)
            })
            .collect::<Vec<_>>();
        match matches.as_slice() {
            [register] => Ok(ResolvedRegister {
                chip,
                register: register.clone(),
            }),
            [] => Err(ReadServiceError::new(
                "register_not_found",
                format!(
                    "没有在芯片 {} 的页面 {page_name} 找到指定寄存器；可先用 search_registers 定位",
                    chip.sensor
                ),
            )),
            _ => Err(ReadServiceError::new(
                "ambiguous_register",
                "寄存器身份不唯一；请补充 registerLocator 或 registerIndex",
            )
            .with_details(json!({
                "candidates": matches.iter().map(|register| register_candidate(&chip, register)).collect::<Vec<_>>()
            }))),
        }
    }

    pub(crate) fn get_register(
        &self,
        selector: &RegisterSelector,
    ) -> Result<RegisterLookup, ReadServiceError> {
        let connection = self.connect()?;
        let resolved = self.resolve_register(&connection, selector)?;
        let document = self.parse_chip_document(&resolved.chip)?;
        let source = self.source_metadata(&connection, &resolved.chip, &document)?;
        Ok(RegisterLookup {
            chip: resolved.chip.sensor,
            source_sha256: resolved.chip.source_sha256,
            register: resolved.register,
            source,
        })
    }

    pub(crate) fn get_field(
        &self,
        selector: &RegisterSelector,
        field_name: &str,
        bits: Option<&str>,
    ) -> Result<FieldLookup, ReadServiceError> {
        if field_name.trim().is_empty() {
            return Err(ReadServiceError::new("invalid_input", "fieldName 不能为空"));
        }
        let connection = self.connect()?;
        let resolved = self.resolve_register(&connection, selector)?;
        let candidates = resolved
            .register
            .fields
            .iter()
            .filter(|field| field.name.eq_ignore_ascii_case(field_name.trim()))
            .filter(|field| {
                bits.is_none_or(|bits| normalize_bits(&field.bits) == normalize_bits(bits))
            })
            .cloned()
            .collect::<Vec<_>>();
        match candidates.as_slice() {
            [field] => Ok(FieldLookup {
                chip: resolved.chip.sensor.clone(),
                source_sha256: resolved.chip.source_sha256.clone(),
                register: register_candidate(&resolved.chip, &resolved.register),
                field: field.clone(),
            }),
            [] => Err(ReadServiceError::new(
                "field_not_found",
                format!(
                    "寄存器 {} 没有位域 {}；请检查 fieldName 和 bits",
                    resolved.register.name, field_name
                ),
            )),
            _ => Err(ReadServiceError::new(
                "ambiguous_field",
                "位域名称不唯一；请补充 bits",
            )
            .with_details(json!({
                "candidates": candidates.iter().map(|field| json!({ "fieldName": field.name, "bits": field.bits })).collect::<Vec<_>>()
            }))),
        }
    }

    pub(crate) fn decode_register_value(
        &self,
        selector: &RegisterSelector,
        value: &str,
    ) -> Result<DecodeLookup, ReadServiceError> {
        let connection = self.connect()?;
        let resolved = self.resolve_register(&connection, selector)?;
        let parsed = parse_register_value(value)?;
        let decoded = core_service::decode_register_value(
            parsed,
            resolved.register.bit_width,
            &resolved.register.fields,
        );
        Ok(DecodeLookup {
            chip: resolved.chip.sensor.clone(),
            source_sha256: resolved.chip.source_sha256.clone(),
            register: register_candidate(&resolved.chip, &resolved.register),
            decoded,
        })
    }

    pub(crate) fn compare_registers(
        &self,
        left: &RegisterSelector,
        right: &RegisterSelector,
    ) -> Result<RegisterComparisonLookup, ReadServiceError> {
        let connection = self.connect()?;
        let left = self.resolve_register(&connection, left)?;
        let right = self.resolve_register(&connection, right)?;
        Ok(RegisterComparisonLookup {
            left: register_candidate(&left.chip, &left.register),
            right: register_candidate(&right.chip, &right.register),
            comparison: core_service::compare_register_details(&left.register, &right.register),
        })
    }

    pub(crate) fn search_registers(
        &self,
        query: &str,
        current_chip: Option<&ChipSelector>,
        limit: usize,
        include_notes: bool,
    ) -> Result<SearchLookupResponse, ReadServiceError> {
        if query.trim().is_empty() {
            return Err(ReadServiceError::new(
                "invalid_input",
                "query 不能为空；可使用 chip:/type:/access:/addr:/bits: 筛选",
            ));
        }
        if !(1..=50).contains(&limit) {
            return Err(ReadServiceError::new(
                "invalid_input",
                "limit 必须在 1 到 50 之间",
            ));
        }
        let connection = self.connect()?;
        let index_status = search::index_status(&connection).map_err(search_error)?;
        if !index_status.ready {
            return Err(ReadServiceError::new(
                "search_index_not_ready",
                format!(
                    "搜索索引尚未就绪（已索引 {}/{} 个芯片）；请在桌面应用中重建索引",
                    index_status.indexed_chips, index_status.total_chips
                ),
            ));
        }
        let current_chip_id = current_chip
            .map(|selector| self.resolve_chip(&connection, selector).map(|chip| chip.id))
            .transpose()?;
        let chip_rows = self
            .chip_rows(&connection)?
            .into_iter()
            .map(|chip| (chip.id.clone(), chip))
            .collect::<BTreeMap<_, _>>();
        let response = search::search(&connection, query, current_chip_id.as_deref(), limit, &[])
            .map_err(search_error)?;
        let results = response
            .results
            .into_iter()
            .filter(|result| include_notes || result.kind != "note")
            .filter_map(|result| {
                let chip = chip_rows.get(&result.chip_id)?;
                Some(SearchLookupResult {
                    entity_type: result.result_type,
                    chip: chip.sensor.clone(),
                    source_sha256: chip.source_sha256.clone(),
                    category: result.category,
                    hidden: !result.enabled,
                    page: result.page_name,
                    register_name: result.register_name,
                    register_locator: result.register_locator,
                    register_index: result.register_index,
                    field_name: result.field_name,
                    field_bits: result.field_bits,
                    title: result.title,
                    snippet: result.snippet,
                    match_reason: match_reason(&result.match_kind).to_owned(),
                    match_kind: result.match_kind,
                    match_language: result.match_language,
                    section: result.section,
                })
            })
            .collect::<Vec<_>>();
        let status = if !response.issues.is_empty() {
            "invalid_query"
        } else if results.is_empty() {
            "no_results"
        } else {
            "ok"
        };
        Ok(SearchLookupResponse {
            status: status.to_owned(),
            results,
            filters: response.filters,
            issues: response.issues,
            suggestion: response.suggestion,
            notes_included: include_notes,
        })
    }
}

pub(crate) fn default_database_path() -> Result<PathBuf, ReadServiceError> {
    #[cfg(target_os = "windows")]
    let base = std::env::var_os("APPDATA").map(PathBuf::from);
    #[cfg(target_os = "macos")]
    let base = std::env::var_os("HOME")
        .map(PathBuf::from)
        .map(|home| home.join("Library").join("Application Support"));
    #[cfg(all(unix, not(target_os = "macos")))]
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME")
                .map(PathBuf::from)
                .map(|home| home.join(".local").join("share"))
        });
    base.map(|base| {
        base.join("com.leo.registerreference")
            .join("register-library.sqlite3")
    })
    .ok_or_else(|| {
        ReadServiceError::new(
            "database_path_unavailable",
            "无法确定平台应用数据目录；请使用 --db <path> 显式指定数据库",
        )
    })
}

fn database_error(error: rusqlite::Error) -> ReadServiceError {
    ReadServiceError::new(
        "database_read_failed",
        format!("读取寄存器数据库失败：{error}"),
    )
}

fn search_error(error: String) -> ReadServiceError {
    ReadServiceError::new("search_failed", error)
}

fn normalize_locator(value: &str) -> String {
    value
        .chars()
        .filter(|character| !character.is_whitespace())
        .flat_map(char::to_lowercase)
        .collect()
}

fn normalize_bits(value: &str) -> String {
    value
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .replace(' ', "")
}

fn register_candidate(
    chip: &ChipRow,
    register: &core_service::RegisterDetails,
) -> RegisterCandidate {
    RegisterCandidate {
        chip: chip.sensor.clone(),
        source_sha256: chip.source_sha256.clone(),
        page: register.page_name.clone(),
        register_name: register.name.clone(),
        register_locator: register.locator.clone(),
        register_index: register.register_index,
    }
}

fn parse_register_value(value: &str) -> Result<u128, ReadServiceError> {
    let compact = value.trim().replace('_', "");
    if compact.is_empty() {
        return Err(ReadServiceError::new(
            "invalid_value",
            "value 不能为空；支持十进制、0x 十六进制和 0b 二进制",
        ));
    }
    if compact.starts_with('-') {
        return Err(ReadServiceError::new(
            "invalid_value",
            "寄存器值必须是无符号整数",
        ));
    }
    let (digits, radix) = if let Some(value) = compact
        .strip_prefix("0x")
        .or_else(|| compact.strip_prefix("0X"))
    {
        (value, 16)
    } else if let Some(value) = compact
        .strip_prefix("0b")
        .or_else(|| compact.strip_prefix("0B"))
    {
        (value, 2)
    } else {
        (compact.as_str(), 10)
    };
    if digits.is_empty() {
        return Err(ReadServiceError::new("invalid_value", "value 缺少数字"));
    }
    u128::from_str_radix(digits, radix).map_err(|_| {
        ReadServiceError::new(
            "invalid_value",
            "value 不是有效的无符号整数，或超过 128-bit 可表示范围",
        )
    })
}

fn match_reason(kind: &str) -> &'static str {
    match kind {
        "register_name" => "exact register name",
        "field_name" => "exact field name",
        "alias" => "alias",
        "address" => "address",
        "system_encoding" => "system register encoding",
        "bits" => "bit range",
        "enum_name" => "enum name",
        "enum_value" => "enum value",
        "translated_description" => "translated description",
        "source_description" => "source description",
        "note" => "user note",
        "fuzzy_name" => "fuzzy identifier",
        "filter" => "structured filter",
        _ => "identifier",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_values_and_rejects_overflow() {
        assert_eq!(parse_register_value("0xFF").unwrap(), 255);
        assert_eq!(parse_register_value("0b1010").unwrap(), 10);
        assert_eq!(parse_register_value("1_024").unwrap(), 1024);
        assert!(parse_register_value("-1").is_err());
        assert!(parse_register_value("0x100000000000000000000000000000000").is_err());
    }

    #[test]
    fn resolves_platform_default_database_name() {
        let path = default_database_path().unwrap();
        assert!(path.ends_with("com.leo.registerreference/register-library.sqlite3"));
    }
}

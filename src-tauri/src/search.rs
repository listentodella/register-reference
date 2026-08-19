use rusqlite::{params, params_from_iter, Connection};
use serde::Serialize;
use serde_yaml::{Mapping, Value};
use std::collections::{HashMap, HashSet};
use strsim::normalized_damerau_levenshtein;

pub(crate) const SEARCH_SCHEMA_VERSION: &str = "2";

#[derive(Clone, Debug)]
pub(crate) struct SearchChipContext {
    pub id: String,
    pub sensor: String,
    pub vendor: String,
    pub family: String,
    pub category: String,
    pub enabled: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct SearchNote {
    pub id: i64,
    pub page_name: String,
    pub register_name: String,
    pub register_key: String,
    pub content: String,
    pub kind: String,
}

#[derive(Clone, Debug)]
struct SearchDocument {
    doc_key: String,
    kind: String,
    page_name: String,
    register_index: Option<usize>,
    register_name: String,
    register_locator: String,
    field_name: String,
    field_bits: String,
    access: String,
    title: String,
    aliases: String,
    source_text: String,
    translated_text: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchResult {
    pub kind: String,
    pub chip_id: String,
    pub chip_name: String,
    pub category: String,
    pub enabled: bool,
    pub page_name: String,
    pub register_index: Option<usize>,
    pub register_name: String,
    pub register_locator: String,
    pub field_name: String,
    pub field_bits: String,
    pub title: String,
    pub snippet: String,
    pub match_language: String,
    pub result_type: String,
    pub match_kind: String,
    pub match_terms: Vec<String>,
    pub section: String,
    #[serde(skip)]
    relevance_tier: u8,
    #[serde(skip)]
    match_quality: f64,
    #[serde(skip)]
    current_chip: bool,
    #[serde(skip)]
    recent_chip_rank: usize,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchFilter {
    pub key: String,
    pub value: String,
    pub token: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchIssue {
    pub token: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchResponse {
    pub results: Vec<SearchResult>,
    pub filters: Vec<SearchFilter>,
    pub issues: Vec<SearchIssue>,
    pub suggestion: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchIndexStatus {
    pub ready: bool,
    pub indexed_chips: usize,
    pub total_chips: usize,
}

fn key(name: &str) -> Value {
    Value::String(name.to_owned())
}

fn get<'a>(mapping: &'a Mapping, name: &str) -> Option<&'a Value> {
    mapping.get(key(name))
}

fn mapping(value: Option<&Value>) -> Option<&Mapping> {
    value.and_then(Value::as_mapping)
}

fn sequence(value: Option<&Value>) -> &[Value] {
    value
        .and_then(Value::as_sequence)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

fn scalar_text(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(value)) => value.clone(),
        Some(Value::Bool(value)) => value.to_string(),
        Some(Value::Number(value)) => value.to_string(),
        _ => String::new(),
    }
}

fn join_text(values: impl IntoIterator<Item = String>) -> String {
    values
        .into_iter()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn value_text(value: &Value) -> String {
    match value {
        Value::String(value) => value.clone(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::Sequence(values) => join_text(values.iter().map(value_text)),
        Value::Mapping(values) => join_text(
            values
                .iter()
                .flat_map(|(key, value)| [value_text(key), value_text(value)]),
        ),
        Value::Tagged(value) => value_text(&value.value),
        Value::Null => String::new(),
    }
}

fn map_text(mapping: &Mapping, names: &[&str]) -> String {
    join_text(names.iter().map(|name| scalar_text(get(mapping, name))))
}

fn string_list(mapping: &Mapping, name: &str) -> Vec<String> {
    sequence(get(mapping, name))
        .iter()
        .map(value_text)
        .filter(|value| !value.is_empty())
        .collect()
}

fn translation_root(document: &Value) -> Option<&Mapping> {
    document
        .as_mapping()
        .and_then(|root| mapping(get(root, "translations")))
}

fn translated_page<'a>(translations: &'a [&Value], page_name: &str) -> Vec<&'a Mapping> {
    translations
        .iter()
        .filter_map(|document| translation_root(document))
        .flat_map(|root| sequence(get(root, "pages")))
        .filter_map(Value::as_mapping)
        .filter(|page| scalar_text(get(page, "name")) == page_name)
        .collect()
}

fn translated_register<'a>(pages: &'a [&Mapping], register_name: &str) -> Vec<&'a Mapping> {
    pages
        .iter()
        .flat_map(|page| sequence(get(page, "registers")))
        .filter_map(Value::as_mapping)
        .filter(|register| scalar_text(get(register, "name")) == register_name)
        .collect()
}

fn translated_field<'a>(
    registers: &'a [&Mapping],
    field_name: &str,
    bits: &str,
) -> Vec<&'a Mapping> {
    registers
        .iter()
        .flat_map(|register| sequence(get(register, "fields")))
        .filter_map(Value::as_mapping)
        .filter(|field| {
            scalar_text(get(field, "name")) == field_name && scalar_text(get(field, "bits")) == bits
        })
        .collect()
}

fn register_locator(register: &Mapping) -> String {
    let addr = scalar_text(get(register, "addr"));
    if !addr.is_empty() {
        if let Ok(number) = addr.parse::<u128>() {
            return format!("0x{number:X}");
        }
        return addr;
    }
    let Some(encoding) = mapping(get(register, "encoding")) else {
        return String::new();
    };
    if let Some(address) = get(encoding, "address") {
        let value = scalar_text(Some(address));
        if let Ok(number) = value.parse::<u128>() {
            return format!("0x{number:X}");
        }
    }
    join_text(
        encoding
            .iter()
            .map(|(key, value)| format!("{}={}", value_text(key), value_text(value))),
    )
    .replace('\n', ", ")
}

fn enum_items(values: Option<&Value>) -> Vec<(String, String, String, String)> {
    match values {
        Some(Value::Mapping(items)) => items
            .iter()
            .map(|(value, desc)| {
                (
                    value_text(value),
                    String::new(),
                    value_text(desc),
                    String::new(),
                )
            })
            .collect(),
        Some(Value::Sequence(items)) => items
            .iter()
            .filter_map(Value::as_mapping)
            .map(|item| {
                (
                    scalar_text(get(item, "value")),
                    scalar_text(get(item, "name")),
                    scalar_text(get(item, "desc")),
                    scalar_text(get(item, "condition")),
                )
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn translated_enum_description(fields: &[&Mapping], enum_value: &str, condition: &str) -> String {
    join_text(
        fields
            .iter()
            .flat_map(|field| enum_items(get(field, "values")))
            .filter_map(|(value, name, desc, translated_condition)| {
                if value == enum_value
                    && (translated_condition.is_empty() || translated_condition == condition)
                {
                    Some(join_text([name, desc, translated_condition]))
                } else {
                    None
                }
            }),
    )
}

fn extract_documents(
    chip: &SearchChipContext,
    source: &Value,
    translations: &[&Value],
    notes: &[SearchNote],
) -> Vec<SearchDocument> {
    let Some(root) = source.as_mapping() else {
        return Vec::new();
    };
    let translated_roots = translations
        .iter()
        .filter_map(|item| translation_root(item))
        .collect::<Vec<_>>();
    let translated_chip = join_text(
        translated_roots
            .iter()
            .map(|root| map_text(root, &["sensor", "vendor", "family", "description"])),
    );
    let chip_source = map_text(root, &["description", "device_type"]);
    let mut documents = vec![SearchDocument {
        doc_key: format!("{}:chip", chip.id),
        kind: "chip".to_owned(),
        page_name: String::new(),
        register_index: None,
        register_name: String::new(),
        register_locator: String::new(),
        field_name: String::new(),
        field_bits: String::new(),
        access: String::new(),
        title: chip.sensor.clone(),
        aliases: join_text([
            chip.vendor.clone(),
            chip.family.clone(),
            chip.category.clone(),
        ]),
        source_text: chip_source.clone(),
        translated_text: translated_chip,
    }];

    let empty_pages = Mapping::new();
    let pages = mapping(get(root, "pages")).unwrap_or(&empty_pages);
    for (page_name_value, page_value) in pages {
        let page_name = value_text(page_name_value);
        let Some(page) = page_value.as_mapping() else {
            continue;
        };
        let page_translations = translated_page(translations, &page_name);
        let page_source = map_text(page, &["title", "access", "desc"]);
        let page_translated = join_text(
            page_translations
                .iter()
                .map(|page| map_text(page, &["title", "access", "desc"])),
        );
        documents.push(SearchDocument {
            doc_key: format!("{}:page:{}", chip.id, page_name),
            kind: "page".to_owned(),
            page_name: page_name.clone(),
            register_index: None,
            register_name: String::new(),
            register_locator: String::new(),
            field_name: String::new(),
            field_bits: String::new(),
            access: scalar_text(get(page, "access")),
            title: page_name.clone(),
            aliases: map_text(page, &["title"]),
            source_text: page_source.clone(),
            translated_text: page_translated.clone(),
        });

        for (register_index, register_value) in sequence(get(page, "registers")).iter().enumerate()
        {
            let Some(register) = register_value.as_mapping() else {
                continue;
            };
            let register_name = scalar_text(get(register, "name"));
            let register_access = scalar_text(get(register, "access"));
            let locator = register_locator(register);
            let register_translations = translated_register(&page_translations, &register_name);
            let mut aliases = string_list(register, "aliases");
            aliases.extend(string_list(register, "groups"));
            for accessor in sequence(get(register, "accessors"))
                .iter()
                .filter_map(Value::as_mapping)
            {
                aliases.extend([
                    scalar_text(get(accessor, "name")),
                    scalar_text(get(accessor, "kind")),
                    scalar_text(get(accessor, "instruction")),
                    scalar_text(get(accessor, "condition")),
                ]);
            }
            let register_source = map_text(
                register,
                &[
                    "desc",
                    "condition",
                    "execution_state",
                    "alias_note",
                    "no_dump_reason",
                ],
            );
            let register_translated = join_text(register_translations.iter().map(|register| {
                map_text(
                    register,
                    &["desc", "condition", "alias_note", "no_dump_reason"],
                )
            }));
            let register_key =
                format!("{}:page:{}:register:{}", chip.id, page_name, register_index);
            documents.push(SearchDocument {
                doc_key: register_key.clone(),
                kind: "register".to_owned(),
                page_name: page_name.clone(),
                register_index: Some(register_index),
                register_name: register_name.clone(),
                register_locator: locator.clone(),
                field_name: String::new(),
                field_bits: String::new(),
                access: register_access.clone(),
                title: register_name.clone(),
                aliases: join_text(aliases),
                source_text: register_source,
                translated_text: register_translated,
            });

            for (field_index, field_value) in sequence(get(register, "fields")).iter().enumerate() {
                let Some(field) = field_value.as_mapping() else {
                    continue;
                };
                let field_name = scalar_text(get(field, "name"));
                let field_bits = scalar_text(get(field, "bits"));
                let field_access = {
                    let value = scalar_text(get(field, "access"));
                    if value.is_empty() {
                        register_access.clone()
                    } else {
                        value
                    }
                };
                let field_translations =
                    translated_field(&register_translations, &field_name, &field_bits);
                let field_source =
                    map_text(field, &["reset_info", "condition", "reserved", "desc"]);
                let field_translated = join_text(
                    field_translations
                        .iter()
                        .map(|field| map_text(field, &["desc", "condition", "reset_info"])),
                );
                let field_key = format!("{register_key}:field:{field_index}");
                documents.push(SearchDocument {
                    doc_key: field_key.clone(),
                    kind: "field".to_owned(),
                    page_name: page_name.clone(),
                    register_index: Some(register_index),
                    register_name: register_name.clone(),
                    register_locator: locator.clone(),
                    field_name: field_name.clone(),
                    field_bits: field_bits.clone(),
                    access: field_access.clone(),
                    title: field_name.clone(),
                    aliases: field_bits.clone(),
                    source_text: field_source,
                    translated_text: field_translated,
                });

                for (enum_index, (enum_value, enum_name, enum_desc, condition)) in
                    enum_items(get(field, "values")).into_iter().enumerate()
                {
                    let translated_desc =
                        translated_enum_description(&field_translations, &enum_value, &condition);
                    documents.push(SearchDocument {
                        doc_key: format!("{field_key}:enum:{enum_index}"),
                        kind: "enum".to_owned(),
                        page_name: page_name.clone(),
                        register_index: Some(register_index),
                        register_name: register_name.clone(),
                        register_locator: locator.clone(),
                        field_name: field_name.clone(),
                        field_bits: field_bits.clone(),
                        access: field_access.clone(),
                        title: if enum_name.is_empty() {
                            enum_value.clone()
                        } else {
                            enum_name.clone()
                        },
                        aliases: join_text([enum_value, enum_name, field_name.clone()]),
                        source_text: join_text([enum_desc, condition]),
                        translated_text: translated_desc,
                    });
                }
            }
        }
    }

    for note in notes {
        documents.push(SearchDocument {
            doc_key: format!("{}:note:{}", chip.id, note.id),
            kind: "note".to_owned(),
            page_name: note.page_name.clone(),
            register_index: None,
            register_name: note.register_name.clone(),
            register_locator: note.register_key.clone(),
            field_name: String::new(),
            field_bits: String::new(),
            access: String::new(),
            title: note.register_name.clone(),
            aliases: note.kind.clone(),
            source_text: note.content.clone(),
            translated_text: String::new(),
        });
    }
    documents
}

pub(crate) fn initialize_schema(connection: &Connection) -> Result<(), String> {
    let has_access_column = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('search_documents') WHERE name = 'access')",
            [],
            |row| row.get::<_, bool>(0),
        )
        .unwrap_or(false);
    if !has_access_column {
        connection
            .execute_batch(
                "DROP TABLE IF EXISTS search_fts;
                 DROP TABLE IF EXISTS search_documents;",
            )
            .map_err(|error| format!("无法升级搜索索引：{error}"))?;
    }
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS app_metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS search_documents (
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
            CREATE INDEX IF NOT EXISTS idx_search_documents_chip ON search_documents(chip_id);
            CREATE INDEX IF NOT EXISTS idx_search_documents_title ON search_documents(title COLLATE NOCASE);
            CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
                title, aliases, source_text, translated_text,
                content='search_documents', content_rowid='id', tokenize='trigram'
            );
            CREATE TRIGGER IF NOT EXISTS search_documents_ai AFTER INSERT ON search_documents BEGIN
                INSERT INTO search_fts(rowid, title, aliases, source_text, translated_text)
                VALUES (new.id, new.title, new.aliases, new.source_text, new.translated_text);
            END;
            CREATE TRIGGER IF NOT EXISTS search_documents_ad AFTER DELETE ON search_documents BEGIN
                INSERT INTO search_fts(search_fts, rowid, title, aliases, source_text, translated_text)
                VALUES ('delete', old.id, old.title, old.aliases, old.source_text, old.translated_text);
            END;
            CREATE TRIGGER IF NOT EXISTS search_documents_au AFTER UPDATE ON search_documents BEGIN
                INSERT INTO search_fts(search_fts, rowid, title, aliases, source_text, translated_text)
                VALUES ('delete', old.id, old.title, old.aliases, old.source_text, old.translated_text);
                INSERT INTO search_fts(rowid, title, aliases, source_text, translated_text)
                VALUES (new.id, new.title, new.aliases, new.source_text, new.translated_text);
            END;",
        )
        .map_err(|error| format!("无法初始化搜索索引：{error}"))
}

pub(crate) fn index_status(connection: &Connection) -> Result<SearchIndexStatus, String> {
    let total_chips = connection
        .query_row("SELECT COUNT(*) FROM chips", [], |row| {
            row.get::<_, usize>(0)
        })
        .map_err(|error| format!("无法统计芯片：{error}"))?;
    let indexed_chips = connection
        .query_row(
            "SELECT COUNT(DISTINCT chip_id) FROM search_documents",
            [],
            |row| row.get::<_, usize>(0),
        )
        .map_err(|error| format!("无法统计搜索索引：{error}"))?;
    let version = connection
        .query_row(
            "SELECT value FROM app_metadata WHERE key = 'search_schema_version'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok();
    Ok(SearchIndexStatus {
        ready: version.as_deref() == Some(SEARCH_SCHEMA_VERSION) && indexed_chips == total_chips,
        indexed_chips,
        total_chips,
    })
}

pub(crate) fn mark_index_ready(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO app_metadata(key, value) VALUES ('search_schema_version', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [SEARCH_SCHEMA_VERSION],
        )
        .map_err(|error| format!("无法记录搜索索引版本：{error}"))?;
    Ok(())
}

pub(crate) fn mark_index_stale(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            "DELETE FROM app_metadata WHERE key = 'search_schema_version'",
            [],
        )
        .map_err(|error| format!("无法标记搜索索引：{error}"))?;
    Ok(())
}

pub(crate) fn replace_chip_documents(
    connection: &Connection,
    chip: &SearchChipContext,
    source: &Value,
    translations: &[&Value],
    notes: &[SearchNote],
) -> Result<(), String> {
    let documents = extract_documents(chip, source, translations, notes);
    connection
        .execute(
            "DELETE FROM search_documents WHERE chip_id = ?1",
            [&chip.id],
        )
        .map_err(|error| format!("无法清理旧搜索索引：{error}"))?;
    let mut statement = connection
        .prepare(
            "INSERT INTO search_documents (
                doc_key, chip_id, chip_name, category, enabled, kind, page_name,
                register_index, register_name, register_locator, field_name, field_bits,
                access, title, aliases, source_text, translated_text
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
        )
        .map_err(|error| format!("无法准备搜索索引：{error}"))?;
    for document in documents {
        statement
            .execute(params![
                document.doc_key,
                chip.id,
                chip.sensor,
                chip.category,
                i64::from(chip.enabled),
                document.kind,
                document.page_name,
                document.register_index.map(|value| value as i64),
                document.register_name,
                document.register_locator,
                document.field_name,
                document.field_bits,
                document.access,
                document.title,
                document.aliases,
                document.source_text,
                document.translated_text,
            ])
            .map_err(|error| format!("无法写入搜索索引：{error}"))?;
    }
    Ok(())
}

pub(crate) fn replace_note_documents(
    connection: &Connection,
    chip: &SearchChipContext,
    notes: &[SearchNote],
) -> Result<(), String> {
    connection
        .execute(
            "DELETE FROM search_documents WHERE chip_id = ?1 AND kind = 'note'",
            [&chip.id],
        )
        .map_err(|error| format!("无法更新备注索引：{error}"))?;
    let empty = Value::Mapping(Mapping::new());
    let documents = extract_documents(chip, &empty, &[], notes);
    let mut statement = connection
        .prepare(
            "INSERT INTO search_documents (
                doc_key, chip_id, chip_name, category, enabled, kind, page_name,
                register_index, register_name, register_locator, field_name, field_bits,
                access, title, aliases, source_text, translated_text
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, ?9, '', '', '', ?10, ?11, ?12, '')",
        )
        .map_err(|error| format!("无法准备备注索引：{error}"))?;
    for document in documents
        .into_iter()
        .filter(|document| document.kind == "note")
    {
        statement
            .execute(params![
                document.doc_key,
                chip.id,
                chip.sensor,
                chip.category,
                i64::from(chip.enabled),
                document.kind,
                document.page_name,
                document.register_name,
                document.register_locator,
                document.title,
                document.aliases,
                document.source_text,
            ])
            .map_err(|error| format!("无法写入备注索引：{error}"))?;
    }
    Ok(())
}

pub(crate) fn update_chip_metadata(
    connection: &Connection,
    chip_id: &str,
    category: Option<&str>,
    enabled: Option<bool>,
) -> Result<(), String> {
    if let Some(category) = category {
        connection
            .execute(
                "UPDATE search_documents SET category = ?1 WHERE chip_id = ?2",
                params![category, chip_id],
            )
            .map_err(|error| format!("无法更新搜索分类：{error}"))?;
    }
    if let Some(enabled) = enabled {
        connection
            .execute(
                "UPDATE search_documents SET enabled = ?1 WHERE chip_id = ?2",
                params![i64::from(enabled), chip_id],
            )
            .map_err(|error| format!("无法更新搜索显示状态：{error}"))?;
    }
    Ok(())
}

fn normalize(value: &str) -> String {
    value
        .chars()
        .flat_map(char::to_lowercase)
        .filter(|character| character.is_alphanumeric())
        .collect()
}

#[derive(Default)]
struct ParsedSearchQuery {
    text: String,
    words: Vec<String>,
    filters: Vec<SearchFilter>,
    issues: Vec<SearchIssue>,
}

#[derive(Debug)]
struct SearchRow {
    kind: String,
    chip_id: String,
    chip_name: String,
    category: String,
    enabled: bool,
    page_name: String,
    register_index: Option<i64>,
    register_name: String,
    register_locator: String,
    field_name: String,
    field_bits: String,
    access: String,
    title: String,
    aliases: String,
    source_text: String,
    translated_text: String,
}

fn query_tokens(query: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quote = None;
    for character in query.chars() {
        if matches!(character, '\'' | '"') {
            if quote == Some(character) {
                quote = None;
            } else if quote.is_none() {
                quote = Some(character);
            } else {
                current.push(character);
            }
        } else if character.is_whitespace() && quote.is_none() {
            if !current.is_empty() {
                tokens.push(std::mem::take(&mut current));
            }
        } else {
            current.push(character);
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

fn canonical_type(value: &str) -> Option<&'static str> {
    match value.trim().to_ascii_lowercase().as_str() {
        "register" | "reg" | "寄存器" => Some("register"),
        "field" | "bitfield" | "位域" => Some("field"),
        "enum" | "value" | "枚举" => Some("enum"),
        "description" | "desc" | "text" | "说明" => Some("description"),
        "note" | "备注" => Some("note"),
        "chip" | "芯片" => Some("chip"),
        "page" | "category" | "分类" => Some("page"),
        _ => None,
    }
}

fn canonical_access(value: &str) -> String {
    let normalized = normalize(value);
    match normalized.as_str() {
        "read" | "readonly" | "ro" => "ro".to_owned(),
        "write" | "writeonly" | "wo" => "wo".to_owned(),
        "readwrite" | "rw" => "rw".to_owned(),
        "writeonce" | "w1" => "w1".to_owned(),
        _ => normalized,
    }
}

fn canonical_address(value: &str) -> Option<String> {
    let trimmed = value.trim();
    let digits = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
        .unwrap_or(trimmed);
    if digits.is_empty()
        || !digits
            .chars()
            .all(|character| character.is_ascii_hexdigit())
        || !digits.chars().any(|character| character.is_ascii_digit())
    {
        return None;
    }
    u128::from_str_radix(digits, 16)
        .ok()
        .map(|address| format!("0x{address:X}"))
}

fn canonical_bits(value: &str) -> Option<String> {
    let mut trimmed = value.trim();
    if trimmed.starts_with('[') && trimmed.ends_with(']') {
        trimmed = &trimmed[1..trimmed.len() - 1];
    }
    let values = trimmed.split(':').collect::<Vec<_>>();
    match values.as_slice() {
        [bit] => bit.trim().parse::<u16>().ok().map(|bit| bit.to_string()),
        [high, low] => {
            let high = high.trim().parse::<u16>().ok()?;
            let low = low.trim().parse::<u16>().ok()?;
            (high >= low).then(|| {
                if high == low {
                    high.to_string()
                } else {
                    format!("{high}:{low}")
                }
            })
        }
        _ => None,
    }
}

fn parse_search_query(query: &str) -> ParsedSearchQuery {
    let mut parsed = ParsedSearchQuery::default();
    let mut text_tokens = Vec::new();
    for token in query_tokens(query) {
        let Some((raw_key, raw_value)) = token.split_once(':') else {
            text_tokens.push(token);
            continue;
        };
        let key = raw_key.to_ascii_lowercase();
        let looks_like_filter = raw_key
            .chars()
            .all(|character| character.is_ascii_alphabetic());
        if !looks_like_filter {
            text_tokens.push(token);
            continue;
        }
        if !matches!(key.as_str(), "chip" | "type" | "access" | "addr" | "bits") {
            parsed.issues.push(SearchIssue {
                token: token.clone(),
                message: format!("不支持筛选项 {raw_key}:，可用 chip/type/access/addr/bits"),
            });
            continue;
        }
        if raw_value.trim().is_empty() {
            parsed.issues.push(SearchIssue {
                token: token.clone(),
                message: format!("筛选项 {raw_key}: 缺少值"),
            });
            continue;
        }
        let canonical = match key.as_str() {
            "type" => canonical_type(raw_value).map(str::to_owned).ok_or_else(|| {
                "type: 支持 register、field、enum、description、note、chip、page".to_owned()
            }),
            "addr" => canonical_address(raw_value)
                .ok_or_else(|| "addr: 需要十六进制地址，例如 addr:0xE000ED00".to_owned()),
            "bits" => canonical_bits(raw_value)
                .ok_or_else(|| "bits: 需要位号或高位:低位，例如 bits:31:28".to_owned()),
            "access" => {
                let value = canonical_access(raw_value);
                (!value.is_empty())
                    .then_some(value)
                    .ok_or_else(|| "access: 缺少访问属性".to_owned())
            }
            _ => Ok(raw_value.trim().to_owned()),
        };
        match canonical {
            Ok(value) => parsed.filters.push(SearchFilter { key, value, token }),
            Err(message) => parsed.issues.push(SearchIssue { token, message }),
        }
    }
    parsed.text = text_tokens.join(" ").trim().to_owned();
    parsed.words = parsed
        .text
        .split(|character: char| !character.is_alphanumeric())
        .map(str::trim)
        .filter(|word| !word.is_empty())
        .map(str::to_lowercase)
        .collect();
    if parsed.words.is_empty() && !parsed.text.is_empty() {
        parsed.words.push(parsed.text.to_lowercase());
    }
    parsed
}

fn filter_values<'a>(parsed: &'a ParsedSearchQuery, key: &'a str) -> impl Iterator<Item = &'a str> {
    parsed
        .filters
        .iter()
        .filter(move |filter| filter.key == key)
        .map(|filter| filter.value.as_str())
}

fn alias_values(aliases: &str) -> impl Iterator<Item = &str> {
    aliases
        .lines()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn canonical_locator_encoding(value: &str) -> Option<String> {
    let compact = value.trim().to_ascii_lowercase().replace(' ', "");
    let display = compact.split('_').collect::<Vec<_>>();
    if display.len() == 5
        && display[0].starts_with('s')
        && display[2].starts_with('c')
        && display[3].starts_with('c')
    {
        return Some(format!(
            "aarch64:{}:{}:{}:{}:{}",
            display[0].trim_start_matches('s'),
            display[1],
            display[2].trim_start_matches('c'),
            display[3].trim_start_matches('c'),
            display[4]
        ));
    }
    let pairs = compact
        .split(',')
        .filter_map(|part| part.split_once('='))
        .map(|(key, value)| (key.trim(), value.trim()))
        .collect::<HashMap<_, _>>();
    match pairs.get("scheme").copied() {
        Some("aarch64_sysreg") => Some(format!(
            "aarch64:{}:{}:{}:{}:{}",
            pairs.get("op0")?,
            pairs.get("op1")?,
            pairs.get("crn")?,
            pairs.get("crm")?,
            pairs.get("op2")?
        )),
        Some("aarch32_cp15") | Some("aarch32_coproc") => Some(format!(
            "aarch32:{}:{}:{}:{}:{}",
            pairs.get("coproc")?,
            pairs.get("opc1").or_else(|| pairs.get("op1"))?,
            pairs.get("crn")?,
            pairs.get("crm")?,
            pairs.get("opc2").or_else(|| pairs.get("op2"))?
        )),
        _ => None,
    }
}

fn locator_address(locator: &str) -> Option<String> {
    let trimmed = locator.trim();
    if trimmed.to_ascii_lowercase().starts_with("0x") {
        canonical_address(trimmed)
    } else {
        None
    }
}

fn field_bits_match(field_bits: &str, expected: &str) -> bool {
    field_bits
        .split(',')
        .filter_map(canonical_bits)
        .any(|bits| bits == expected)
}

fn abbreviation(word: &str) -> &str {
    match word {
        "address" => "addr",
        "error" => "err",
        "configuration" => "cfg",
        "control" => "ctrl",
        "status" => "sts",
        "interrupt" => "int",
        "enable" => "en",
        "disable" => "dis",
        "transmit" => "tx",
        "receive" => "rx",
        "buffer" => "buf",
        "valid" => "vld",
        _ => word,
    }
}

fn identifier_variants(parsed: &ParsedSearchQuery) -> Vec<String> {
    let normalized = normalize(&parsed.text);
    let abbreviated = parsed
        .words
        .iter()
        .map(|word| abbreviation(word))
        .collect::<String>();
    let mut variants = vec![normalized];
    if !abbreviated.is_empty() && abbreviated != variants[0] {
        variants.push(abbreviated);
    }
    variants
}

fn identifier_match(value: &str, variants: &[String]) -> Option<f64> {
    let normalized = normalize(value);
    variants.iter().find_map(|variant| {
        if variant.is_empty() {
            None
        } else if normalized.starts_with(variant) {
            Some(1.0)
        } else if normalized.contains(variant) {
            Some(0.9)
        } else {
            None
        }
    })
}

fn text_match_terms(source: &str, parsed: &ParsedSearchQuery) -> Vec<String> {
    let lowercase = source.to_lowercase();
    let phrase = parsed.text.to_lowercase();
    if !phrase.is_empty() && lowercase.contains(&phrase) {
        return vec![parsed.text.clone()];
    }
    if !parsed.words.is_empty()
        && parsed
            .words
            .iter()
            .all(|word| lowercase.contains(&word.to_lowercase()))
    {
        return parsed.words.clone();
    }
    Vec::new()
}

fn access_matches(access: &str, expected: &str) -> bool {
    canonical_access(access) == expected
        || access
            .split(|character: char| character.is_whitespace() || matches!(character, ',' | ';'))
            .any(|part| canonical_access(part) == expected)
}

fn row_matches_filters(row: &SearchRow, parsed: &ParsedSearchQuery) -> bool {
    let type_filters = filter_values(parsed, "type").collect::<Vec<_>>();
    if !type_filters.is_empty()
        && !type_filters.iter().all(|expected| {
            if *expected == "description" {
                !row.source_text.is_empty() || !row.translated_text.is_empty()
            } else {
                row.kind == *expected
            }
        })
    {
        return false;
    }
    if !filter_values(parsed, "chip").all(|expected| {
        let expected = normalize(expected);
        normalize(&row.chip_name).contains(&expected) || normalize(&row.chip_id).contains(&expected)
    }) {
        return false;
    }
    if !filter_values(parsed, "access").all(|expected| access_matches(&row.access, expected)) {
        return false;
    }
    if !filter_values(parsed, "addr")
        .all(|expected| locator_address(&row.register_locator).as_deref() == Some(expected))
    {
        return false;
    }
    if !filter_values(parsed, "bits").all(|expected| field_bits_match(&row.field_bits, expected)) {
        return false;
    }
    let has_explicit_type = !type_filters.is_empty();
    if !has_explicit_type
        && filter_values(parsed, "addr").next().is_some()
        && row.kind != "register"
    {
        return false;
    }
    if !has_explicit_type && filter_values(parsed, "bits").next().is_some() && row.kind != "field" {
        return false;
    }
    true
}

fn fts_query(query: &str) -> String {
    let chars = query.chars().collect::<Vec<_>>();
    if chars.len() < 3 {
        return format!("\"{}\"", query.replace('"', "\"\""));
    }
    let mut grams = HashSet::new();
    for window in chars.windows(3) {
        grams.insert(window.iter().collect::<String>());
    }
    grams
        .into_iter()
        .map(|gram| format!("\"{}\"", gram.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" OR ")
}

fn snippet(source: &str, query: &str) -> String {
    let compact = source.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.is_empty() {
        return compact;
    }
    let found = compact
        .find(query)
        .map(|start| (start, query.len()))
        .or_else(|| {
            if query.is_ascii() {
                compact
                    .to_ascii_lowercase()
                    .find(&query.to_ascii_lowercase())
                    .map(|start| (start, query.len()))
            } else {
                None
            }
        });
    let (start, matched_len) = found.unwrap_or((0, 0));
    let prefix = compact[..start]
        .char_indices()
        .rev()
        .nth(48)
        .map(|(index, _)| index)
        .unwrap_or(0);
    let suffix_start = (start + matched_len).min(compact.len());
    let suffix = compact[suffix_start..]
        .char_indices()
        .nth(96)
        .map(|(index, _)| suffix_start + index)
        .unwrap_or(compact.len());
    format!(
        "{}{}{}",
        if prefix > 0 { "…" } else { "" },
        &compact[prefix..suffix],
        if suffix < compact.len() { "…" } else { "" }
    )
}

fn make_result(
    row: SearchRow,
    parsed: &ParsedSearchQuery,
    current_chip_id: Option<&str>,
    recent_chip_ids: &[String],
) -> Option<SearchResult> {
    if !row_matches_filters(&row, parsed) {
        return None;
    }
    let normalized_query = normalize(&parsed.text);
    let normalized_title = normalize(&row.title);
    let variants = identifier_variants(parsed);
    let aliases = alias_values(&row.aliases).collect::<Vec<_>>();
    let exact_alias = aliases
        .iter()
        .find(|alias| normalize(alias) == normalized_query)
        .copied();
    let address_intent = canonical_address(&parsed.text).filter(|_| {
        parsed.text.trim().to_ascii_lowercase().starts_with("0x")
            || (parsed.text.trim().len() >= 3
                && parsed
                    .text
                    .chars()
                    .any(|character| character.is_ascii_digit()))
    });
    let bits_intent = canonical_bits(&parsed.text).filter(|_| {
        parsed.text.contains(':')
            || (parsed.text.starts_with('[') && parsed.text.ends_with(']'))
            || parsed.text.parse::<u16>().is_ok()
    });
    let system_encoding_intent = canonical_locator_encoding(&parsed.text);
    let translated_terms = text_match_terms(&row.translated_text, parsed);
    let source_terms = text_match_terms(&row.source_text, parsed);
    let fuzzy = if normalized_query.is_empty() || normalized_title.is_empty() {
        0.0
    } else {
        normalized_damerau_levenshtein(&normalized_query, &normalized_title)
    };

    let type_filter = filter_values(parsed, "type").next();
    let filter_only = parsed.text.is_empty();
    let (relevance_tier, match_quality, match_kind, match_language, match_terms, matched_source) =
        if filter_only {
            if let Some(address) = filter_values(parsed, "addr").next() {
                (
                    0,
                    1.0,
                    "address",
                    "identifier",
                    vec![address.to_owned()],
                    row.register_locator.as_str(),
                )
            } else if let Some(bits) = filter_values(parsed, "bits").next() {
                (
                    1,
                    1.0,
                    "bits",
                    "identifier",
                    vec![bits.to_owned()],
                    row.field_bits.as_str(),
                )
            } else if type_filter == Some("description") {
                if !row.translated_text.is_empty() {
                    (
                        4,
                        1.0,
                        "translated_description",
                        "zh-CN",
                        Vec::new(),
                        row.translated_text.as_str(),
                    )
                } else {
                    (
                        4,
                        1.0,
                        "source_description",
                        "source",
                        Vec::new(),
                        row.source_text.as_str(),
                    )
                }
            } else if row.kind == "note" {
                (5, 1.0, "note", "note", Vec::new(), row.source_text.as_str())
            } else {
                let tier = if row.kind == "enum" { 3 } else { 2 };
                (tier, 1.0, "filter", "identifier", Vec::new(), "")
            }
        } else if row.kind == "register"
            && address_intent.as_deref() == locator_address(&row.register_locator).as_deref()
            && address_intent.is_some()
        {
            (
                0,
                1.0,
                "address",
                "identifier",
                vec![parsed.text.clone()],
                row.register_locator.as_str(),
            )
        } else if row.kind == "register"
            && system_encoding_intent.is_some()
            && system_encoding_intent == canonical_locator_encoding(&row.register_locator)
        {
            (
                0,
                1.0,
                "system_encoding",
                "identifier",
                vec![parsed.text.clone()],
                row.register_locator.as_str(),
            )
        } else if row.kind == "register" && normalized_title == normalized_query {
            (
                0,
                1.0,
                "register_name",
                "identifier",
                vec![parsed.text.clone()],
                "",
            )
        } else if row.kind == "register" && exact_alias.is_some() {
            (
                0,
                1.0,
                "alias",
                "identifier",
                vec![parsed.text.clone()],
                exact_alias.unwrap_or_default(),
            )
        } else if row.kind == "field" && normalized_title == normalized_query {
            (
                1,
                1.0,
                "field_name",
                "identifier",
                vec![parsed.text.clone()],
                "",
            )
        } else if row.kind == "field"
            && bits_intent
                .as_deref()
                .is_some_and(|bits| field_bits_match(&row.field_bits, bits))
        {
            (
                1,
                1.0,
                "bits",
                "identifier",
                vec![parsed.text.clone()],
                row.field_bits.as_str(),
            )
        } else if row.kind == "enum" && normalized_title == normalized_query {
            (
                3,
                1.0,
                "enum_name",
                "identifier",
                vec![parsed.text.clone()],
                "",
            )
        } else if row.kind == "enum" && exact_alias.is_some() {
            (
                3,
                1.0,
                "enum_value",
                "identifier",
                vec![parsed.text.clone()],
                exact_alias.unwrap_or_default(),
            )
        } else if matches!(row.kind.as_str(), "register" | "field" | "chip" | "page")
            && identifier_match(&row.title, &variants).is_some()
        {
            (
                2,
                identifier_match(&row.title, &variants).unwrap_or_default(),
                "name",
                "identifier",
                parsed.words.clone(),
                "",
            )
        } else if row.kind == "register"
            && aliases
                .iter()
                .filter_map(|alias| identifier_match(alias, &variants))
                .next()
                .is_some()
        {
            let matching = aliases
                .iter()
                .find(|alias| identifier_match(alias, &variants).is_some())
                .copied()
                .unwrap_or_default();
            (
                2,
                0.85,
                "alias",
                "identifier",
                parsed.words.clone(),
                matching,
            )
        } else if row.kind == "enum" && identifier_match(&row.title, &variants).is_some() {
            (3, 0.9, "enum_name", "identifier", parsed.words.clone(), "")
        } else if !translated_terms.is_empty() && row.kind != "note" {
            (
                4,
                1.0,
                "translated_description",
                "zh-CN",
                translated_terms,
                row.translated_text.as_str(),
            )
        } else if !source_terms.is_empty() && row.kind != "note" {
            (
                4,
                1.0,
                "source_description",
                "source",
                source_terms,
                row.source_text.as_str(),
            )
        } else if row.kind == "note" && !source_terms.is_empty() {
            (
                5,
                1.0,
                "note",
                "note",
                source_terms,
                row.source_text.as_str(),
            )
        } else if matches!(row.kind.as_str(), "register" | "field") && fuzzy >= 0.72 {
            (6, fuzzy, "fuzzy_name", "identifier", Vec::new(), "")
        } else {
            return None;
        };

    if type_filter == Some("description") && relevance_tier != 4 {
        return None;
    }
    let result_type = match relevance_tier {
        4 => "description",
        _ => row.kind.as_str(),
    }
    .to_owned();
    let section = match relevance_tier {
        0..=3 => "entities",
        4..=5 => "text",
        _ => "suggestions",
    };
    let recent_chip_rank = recent_chip_ids
        .iter()
        .position(|chip_id| chip_id == &row.chip_id)
        .unwrap_or(usize::MAX);
    let snippet_text = if matched_source.is_empty() {
        String::new()
    } else {
        snippet(
            matched_source,
            match_terms.first().map(String::as_str).unwrap_or(""),
        )
    };
    Some(SearchResult {
        kind: row.kind,
        chip_id: row.chip_id.clone(),
        chip_name: row.chip_name,
        category: row.category,
        enabled: row.enabled,
        page_name: row.page_name,
        register_index: row.register_index.map(|value| value as usize),
        register_name: row.register_name,
        register_locator: row.register_locator,
        field_name: row.field_name,
        field_bits: row.field_bits,
        title: row.title,
        snippet: snippet_text,
        match_language: match_language.to_owned(),
        result_type,
        match_kind: match_kind.to_owned(),
        match_terms,
        section: section.to_owned(),
        relevance_tier,
        match_quality,
        current_chip: current_chip_id == Some(row.chip_id.as_str()),
        recent_chip_rank,
    })
}

fn extend_candidates(
    connection: &Connection,
    candidates: &mut HashMap<i64, f64>,
    sql: &str,
    value: &str,
) -> Result<(), String> {
    let mut statement = connection
        .prepare(sql)
        .map_err(|error| format!("无法准备意图搜索：{error}"))?;
    for id in statement
        .query_map([value], |row| row.get::<_, i64>(0))
        .map_err(|error| format!("无法执行意图搜索：{error}"))?
        .flatten()
    {
        candidates.entry(id).or_insert(0.0);
    }
    Ok(())
}

pub(crate) fn search(
    connection: &Connection,
    query: &str,
    current_chip_id: Option<&str>,
    limit: usize,
    recent_chip_ids: &[String],
) -> Result<SearchResponse, String> {
    let parsed = parse_search_query(query.trim());
    if !parsed.issues.is_empty() {
        return Ok(SearchResponse {
            results: Vec::new(),
            filters: parsed.filters,
            issues: parsed.issues,
            suggestion: String::new(),
        });
    }
    if parsed.text.is_empty() && parsed.filters.is_empty() {
        return Ok(SearchResponse {
            results: Vec::new(),
            filters: Vec::new(),
            issues: Vec::new(),
            suggestion: String::new(),
        });
    }
    let mut candidates: HashMap<i64, f64> = HashMap::new();
    let trimmed = parsed.text.trim();
    let address_intent = canonical_address(trimmed).filter(|_| {
        trimmed.to_ascii_lowercase().starts_with("0x")
            || (trimmed.len() >= 3 && trimmed.chars().any(|character| character.is_ascii_digit()))
    });
    let bits_intent = canonical_bits(trimmed).filter(|_| {
        trimmed.contains(':')
            || (trimmed.starts_with('[') && trimmed.ends_with(']'))
            || trimmed.parse::<u16>().is_ok()
    });
    let encoding_intent = canonical_locator_encoding(trimmed);
    let has_structured_intent =
        address_intent.is_some() || bits_intent.is_some() || encoding_intent.is_some();
    if !parsed.text.is_empty() && !has_structured_intent {
        let like = format!(
            "%{}%",
            parsed
                .text
                .to_lowercase()
                .replace('%', "\\%")
                .replace('_', "\\_")
        );
        let mut statement = connection
            .prepare(
                "SELECT id FROM search_documents
                 WHERE lower(title) LIKE ?1 ESCAPE '\\' OR lower(aliases) LIKE ?1 ESCAPE '\\'
                    OR lower(register_locator) LIKE ?1 ESCAPE '\\'
                 LIMIT 400",
            )
            .map_err(|error| format!("无法准备名称搜索：{error}"))?;
        let rows = statement
            .query_map([&like], |row| row.get::<_, i64>(0))
            .map_err(|error| format!("无法执行名称搜索：{error}"))?;
        for id in rows.flatten() {
            candidates.insert(id, 0.0);
        }
        if parsed.text.chars().count() >= 3 {
            let identifier_query = !parsed.text.chars().any(char::is_whitespace)
                && parsed
                    .text
                    .chars()
                    .all(|character| character.is_alphanumeric() || matches!(character, '_' | '-'));
            let expression = if candidates.is_empty() && identifier_query {
                fts_query(&parsed.text.to_lowercase())
            } else {
                format!("\"{}\"", parsed.text.to_lowercase().replace('"', "\"\""))
            };
            let candidate_limit = if candidates.is_empty() && identifier_query {
                400
            } else {
                300
            };
            let mut statement = connection
                .prepare(&format!(
                    "SELECT rowid, bm25(search_fts, 8.0, 5.0, 1.5, 2.0)
                     FROM search_fts WHERE search_fts MATCH ?1 ORDER BY rank LIMIT {candidate_limit}"
                ))
                .map_err(|error| format!("无法准备全文搜索：{error}"))?;
            let rows = statement
                .query_map([expression], |row| {
                    Ok((row.get::<_, i64>(0)?, row.get::<_, f64>(1)?))
                })
                .map_err(|error| format!("无法执行全文搜索：{error}"))?;
            for (id, rank) in rows.flatten() {
                candidates
                    .entry(id)
                    .and_modify(|value| *value = value.min(rank))
                    .or_insert(rank);
            }
        } else {
            let mut statement = connection
                .prepare(
                    "SELECT id FROM search_documents
                     WHERE lower(source_text) LIKE ?1 ESCAPE '\\' OR lower(translated_text) LIKE ?1 ESCAPE '\\'
                     LIMIT 250",
                )
                .map_err(|error| format!("无法准备短语搜索：{error}"))?;
            for id in statement
                .query_map([&like], |row| row.get::<_, i64>(0))
                .map_err(|error| format!("无法执行短语搜索：{error}"))?
                .flatten()
            {
                candidates.entry(id).or_insert(0.0);
            }
        }
    } else if parsed.text.is_empty() {
        let (sql, value) = if let Some(value) = filter_values(&parsed, "addr").next() {
            ("SELECT id FROM search_documents WHERE upper(register_locator) = upper(?1) LIMIT 1200", value.to_owned())
        } else if let Some(value) = filter_values(&parsed, "bits").next() {
            (
                "SELECT id FROM search_documents WHERE field_bits LIKE ?1 LIMIT 1200",
                format!("%{value}%"),
            )
        } else if let Some(value) = filter_values(&parsed, "chip").next() {
            (
                "SELECT id FROM search_documents WHERE lower(chip_name) LIKE lower(?1) LIMIT 1200",
                format!("%{value}%"),
            )
        } else if let Some(value) = filter_values(&parsed, "type").next() {
            if value == "description" {
                ("SELECT id FROM search_documents WHERE source_text <> '' OR translated_text <> '' LIMIT 1200", String::new())
            } else {
                (
                    "SELECT id FROM search_documents WHERE kind = ?1 LIMIT 1200",
                    value.to_owned(),
                )
            }
        } else if let Some(value) = filter_values(&parsed, "access").next() {
            ("SELECT id FROM search_documents WHERE lower(replace(replace(access, '/', ''), '-', '')) LIKE lower(?1) LIMIT 1200", format!("%{value}%"))
        } else {
            ("SELECT id FROM search_documents LIMIT 1200", String::new())
        };
        let mut statement = connection
            .prepare(sql)
            .map_err(|error| format!("无法准备筛选搜索：{error}"))?;
        let mut rows = if sql.contains("?1") {
            statement.query([value])
        } else {
            statement.query([])
        }
        .map_err(|error| format!("无法执行筛选搜索：{error}"))?;
        while let Some(row) = rows
            .next()
            .map_err(|error| format!("无法读取筛选结果：{error}"))?
        {
            candidates.insert(
                row.get::<_, i64>(0)
                    .map_err(|error| format!("无法读取筛选结果：{error}"))?,
                0.0,
            );
        }
    }
    if !parsed.text.is_empty() {
        if let Some(address) = address_intent {
            extend_candidates(
                connection,
                &mut candidates,
                "SELECT id FROM search_documents WHERE upper(register_locator) = upper(?1) LIMIT 400",
                &address,
            )?;
        }
        if let Some(bits) = bits_intent {
            extend_candidates(
                connection,
                &mut candidates,
                "SELECT id FROM search_documents WHERE field_bits LIKE ?1 LIMIT 400",
                &format!("%{bits}%"),
            )?;
        }
        if let Some(encoding) = encoding_intent {
            let parts = encoding.split(':').collect::<Vec<_>>();
            let pattern = match parts.as_slice() {
                ["aarch64", op0, op1, crn, crm, op2] => {
                    format!("%op0={op0}%op1={op1}%crn={crn}%crm={crm}%op2={op2}%")
                }
                ["aarch32", coproc, opc1, crn, crm, opc2] => {
                    format!("%coproc={coproc}%opc1={opc1}%crn={crn}%crm={crm}%opc2={opc2}%")
                }
                _ => String::new(),
            };
            if !pattern.is_empty() {
                extend_candidates(
                    connection,
                    &mut candidates,
                    "SELECT id FROM search_documents WHERE lower(register_locator) LIKE lower(?1) LIMIT 400",
                    &pattern,
                )?;
            }
        }
    }
    if candidates.is_empty() {
        let mut suggestion = (0.0, String::new());
        if !parsed.text.is_empty() {
            let mut statement = connection
                .prepare(
                    "SELECT title FROM search_documents
                     WHERE kind IN ('register', 'field')
                     ORDER BY length(title), title LIMIT 2000",
                )
                .map_err(|error| format!("无法准备相近名称建议：{error}"))?;
            for title in statement
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|error| format!("无法执行相近名称建议：{error}"))?
                .flatten()
            {
                let quality =
                    normalized_damerau_levenshtein(&normalize(&parsed.text), &normalize(&title));
                if quality > suggestion.0 {
                    suggestion = (quality, title);
                }
            }
        }
        return Ok(SearchResponse {
            results: Vec::new(),
            filters: parsed.filters,
            issues: Vec::new(),
            suggestion: if suggestion.0 >= 0.62 {
                suggestion.1
            } else {
                String::new()
            },
        });
    }

    let mut results = Vec::new();
    let placeholders = vec!["?"; candidates.len()].join(",");
    let query_sql = format!(
        "SELECT kind, chip_id, chip_name, category, enabled, page_name, register_index,
                register_name, register_locator, field_name, field_bits, access, title, aliases,
                source_text, translated_text
         FROM search_documents WHERE id IN ({placeholders})"
    );
    let mut statement = connection
        .prepare(&query_sql)
        .map_err(|error| format!("无法读取搜索候选：{error}"))?;
    let rows = statement
        .query_map(params_from_iter(candidates.keys()), |row| {
            Ok(SearchRow {
                kind: row.get(0)?,
                chip_id: row.get(1)?,
                chip_name: row.get(2)?,
                category: row.get(3)?,
                enabled: row.get::<_, i64>(4)? != 0,
                page_name: row.get(5)?,
                register_index: row.get(6)?,
                register_name: row.get(7)?,
                register_locator: row.get(8)?,
                field_name: row.get(9)?,
                field_bits: row.get(10)?,
                access: row.get(11)?,
                title: row.get(12)?,
                aliases: row.get(13)?,
                source_text: row.get(14)?,
                translated_text: row.get(15)?,
            })
        })
        .map_err(|error| format!("无法查询搜索候选：{error}"))?;
    let mut suggestion = (0.0, String::new());
    for row in rows.flatten() {
        if !matches!(row.kind.as_str(), "register" | "field") || parsed.text.is_empty() {
            // Suggestions only use navigable entity names.
        } else {
            let quality =
                normalized_damerau_levenshtein(&normalize(&parsed.text), &normalize(&row.title));
            if quality > suggestion.0 {
                suggestion = (quality, row.title.clone());
            }
        }
        if let Some(result) = make_result(row, &parsed, current_chip_id, recent_chip_ids) {
            results.push(result);
        }
    }
    results.sort_by(|left, right| {
        left.relevance_tier
            .cmp(&right.relevance_tier)
            .then_with(|| right.match_quality.total_cmp(&left.match_quality))
            .then_with(|| right.current_chip.cmp(&left.current_chip))
            .then_with(|| left.recent_chip_rank.cmp(&right.recent_chip_rank))
            .then_with(|| left.chip_name.cmp(&right.chip_name))
            .then_with(|| left.page_name.cmp(&right.page_name))
            .then_with(|| left.register_name.cmp(&right.register_name))
    });
    let limit = limit.clamp(1, 100);
    let strong_count = results
        .iter()
        .filter(|result| result.section == "entities")
        .count();
    let text_cap = if strong_count > 0 { 30 } else { limit };
    let mut text_count = 0;
    results.retain(|result| {
        if result.section == "text" {
            text_count += 1;
            text_count <= text_cap
        } else {
            true
        }
    });
    results.truncate(limit);
    let suggestion = if results.is_empty() && suggestion.0 >= 0.62 {
        suggestion.1
    } else {
        String::new()
    };
    Ok(SearchResponse {
        results,
        filters: parsed.filters,
        issues: Vec::new(),
        suggestion,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDocument<'a> {
        id: i64,
        kind: &'a str,
        chip_id: &'a str,
        chip_name: &'a str,
        page_name: &'a str,
        register_name: &'a str,
        register_locator: &'a str,
        field_name: &'a str,
        field_bits: &'a str,
        access: &'a str,
        title: &'a str,
        aliases: &'a str,
        source_text: &'a str,
        translated_text: &'a str,
    }

    fn connection_with_documents(documents: &[TestDocument<'_>]) -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        initialize_schema(&connection).unwrap();
        for document in documents {
            connection
                .execute(
                    "INSERT INTO search_documents (
                        id, doc_key, chip_id, chip_name, category, enabled, kind, page_name,
                        register_index, register_name, register_locator, field_name, field_bits,
                        access, title, aliases, source_text, translated_text
                     ) VALUES (?1, ?2, ?3, ?4, '测试', 1, ?5, ?6, 0, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
                    params![
                        document.id,
                        format!("test:{}", document.id),
                        document.chip_id,
                        document.chip_name,
                        document.kind,
                        document.page_name,
                        document.register_name,
                        document.register_locator,
                        document.field_name,
                        document.field_bits,
                        document.access,
                        document.title,
                        document.aliases,
                        document.source_text,
                        document.translated_text,
                    ],
                )
                .unwrap();
        }
        connection
    }

    fn fixtures() -> Vec<TestDocument<'static>> {
        vec![
            TestDocument {
                id: 1,
                kind: "register",
                chip_id: "chip:dwc3",
                chip_name: "RK3588_DWC3",
                page_name: "MMIO",
                register_name: "USB3OTG_GBUSERRADDRLO",
                register_locator: "0xC118",
                field_name: "",
                field_bits: "",
                access: "RO",
                title: "USB3OTG_GBUSERRADDRLO",
                aliases: "GBUSERRADDRLO",
                source_text: "Stores the lower bus error address.",
                translated_text: "保存总线错误地址低位。",
            },
            TestDocument {
                id: 2,
                kind: "field",
                chip_id: "chip:dwc3",
                chip_name: "RK3588_DWC3",
                page_name: "MMIO",
                register_name: "USB3OTG_GSTS",
                register_locator: "0xC110",
                field_name: "buserraddrvld",
                field_bits: "4:4",
                access: "RO",
                title: "buserraddrvld",
                aliases: "4:4",
                source_text: "Indicates that the bus error address is valid.",
                translated_text: "指示总线错误地址有效。",
            },
            TestDocument {
                id: 3,
                kind: "field",
                chip_id: "chip:current",
                chip_name: "CURRENT_CHIP",
                page_name: "Events",
                register_name: "EVENT_FIFO",
                register_locator: "0x20",
                field_name: "event_addr",
                field_bits: "31:28",
                access: "RW",
                title: "event_addr",
                aliases: "31:28",
                source_text: "The event FIFO can include a bus error address in diagnostic text.",
                translated_text: "事件 FIFO 的诊断说明可能包含总线错误地址。",
            },
            TestDocument {
                id: 4,
                kind: "register",
                chip_id: "chip:m3",
                chip_name: "Arm Cortex-M3 system registers",
                page_name: "Special Registers",
                register_name: "APSR",
                register_locator: "scheme=aarch64_sysreg, op0=3, op1=0, crn=1, crm=0, op2=3",
                field_name: "",
                field_bits: "",
                access: "RW",
                title: "APSR",
                aliases: "Application Program Status Register",
                source_text: "Application status flags.",
                translated_text: "应用程序状态标志。",
            },
            TestDocument {
                id: 5,
                kind: "field",
                chip_id: "chip:m3",
                chip_name: "Arm Cortex-M3 system registers",
                page_name: "Special Registers",
                register_name: "APSR",
                register_locator: "scheme=aarch64_sysreg, op0=3, op1=0, crn=1, crm=0, op2=3",
                field_name: "overflow",
                field_bits: "31:28",
                access: "RW",
                title: "overflow",
                aliases: "31:28",
                source_text: "Overflow condition flag.",
                translated_text: "算术溢出条件标志。",
            },
            TestDocument {
                id: 6,
                kind: "field",
                chip_id: "chip:m4",
                chip_name: "Arm Cortex-M4 system registers",
                page_name: "Special Registers",
                register_name: "APSR",
                register_locator: "selector=APSR",
                field_name: "overflow",
                field_bits: "31:28",
                access: "RO",
                title: "overflow",
                aliases: "31:28",
                source_text: "Overflow condition flag.",
                translated_text: "算术溢出条件标志。",
            },
            TestDocument {
                id: 7,
                kind: "note",
                chip_id: "chip:dwc3",
                chip_name: "RK3588_DWC3",
                page_name: "MMIO",
                register_name: "USB3OTG_GBUSERRADDRLO",
                register_locator: "note-key",
                field_name: "",
                field_bits: "",
                access: "",
                title: "USB3OTG_GBUSERRADDRLO",
                aliases: "warning",
                source_text: "调试时先清空错误状态。",
                translated_text: "",
            },
        ]
    }

    #[test]
    fn parses_composable_filters_and_reports_invalid_tokens() {
        let parsed = parse_search_query("chip:m3 type:field access:rw overflow");
        assert_eq!(parsed.text, "overflow");
        assert_eq!(parsed.filters.len(), 3);
        assert!(parsed.issues.is_empty());
        assert_eq!(filter_values(&parsed, "type").next(), Some("field"));

        let invalid = parse_search_query("type: addr:xyz scope:all");
        assert_eq!(invalid.issues.len(), 3);
        assert!(invalid
            .issues
            .iter()
            .any(|issue| issue.message.contains("缺少值")));
        assert!(invalid
            .issues
            .iter()
            .any(|issue| issue.message.contains("不支持筛选项")));
    }

    #[test]
    fn upgrades_the_derived_search_schema_without_preserving_stale_rows() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE search_documents (id INTEGER PRIMARY KEY, title TEXT NOT NULL);
                 INSERT INTO search_documents(id, title) VALUES (1, 'stale');",
            )
            .unwrap();
        initialize_schema(&connection).unwrap();
        let has_access = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM pragma_table_info('search_documents') WHERE name = 'access')",
                [],
                |row| row.get::<_, bool>(0),
            )
            .unwrap();
        let rows = connection
            .query_row("SELECT COUNT(*) FROM search_documents", [], |row| {
                row.get::<_, usize>(0)
            })
            .unwrap();
        assert!(has_access);
        assert_eq!(rows, 0);
    }

    #[test]
    fn ranks_entities_before_description_and_uses_context_only_as_a_tie_break() {
        let connection = connection_with_documents(&fixtures());
        let response = search(
            &connection,
            "bus error address",
            Some("chip:current"),
            100,
            &["chip:current".to_owned()],
        )
        .unwrap();
        assert_eq!(response.results[0].section, "entities");
        let first_text = response
            .results
            .iter()
            .position(|result| result.section == "text")
            .unwrap();
        assert!(response.results[..first_text]
            .iter()
            .all(|result| result.section == "entities"));
        assert!(response.results[..first_text]
            .iter()
            .any(|result| result.register_name == "USB3OTG_GBUSERRADDRLO"));
        assert_eq!(response.results[first_text].result_type, "description");
    }

    #[test]
    fn normalizes_address_bits_and_system_encoding_intents() {
        let connection = connection_with_documents(&fixtures());
        for query in ["0xC118", "C118", "addr:0xc118"] {
            let response = search(&connection, query, None, 100, &[]).unwrap();
            assert_eq!(response.results[0].register_name, "USB3OTG_GBUSERRADDRLO");
            assert_eq!(response.results[0].match_kind, "address");
        }
        for query in ["[4]", "4"] {
            let response = search(&connection, query, None, 100, &[]).unwrap();
            assert_eq!(response.results[0].field_name, "buserraddrvld");
            assert_eq!(response.results[0].match_kind, "bits");
        }
        let range = search(&connection, "bits:31:28", None, 100, &[]).unwrap();
        assert!(range
            .results
            .iter()
            .all(|result| result.field_bits == "31:28"));
        let encoding = search(&connection, "S3_0_C1_C0_3", None, 100, &[]).unwrap();
        assert_eq!(encoding.results[0].register_name, "APSR");
        assert_eq!(encoding.results[0].match_kind, "system_encoding");
    }

    #[test]
    fn applies_chip_type_and_access_filters_without_leaking_them_into_text() {
        let connection = connection_with_documents(&fixtures());
        let response = search(
            &connection,
            "chip:m3 type:field access:rw overflow",
            None,
            100,
            &[],
        )
        .unwrap();
        assert_eq!(response.filters.len(), 3);
        assert_eq!(response.results.len(), 1);
        assert_eq!(response.results[0].chip_id, "chip:m3");
        assert_eq!(response.results[0].field_name, "overflow");

        let translated = search(&connection, "算术溢出", None, 100, &[]).unwrap();
        assert_eq!(translated.results[0].match_kind, "translated_description");
        let note = search(&connection, "清空错误状态", None, 100, &[]).unwrap();
        assert_eq!(note.results[0].result_type, "note");
        assert_eq!(note.results[0].match_kind, "note");
    }
}

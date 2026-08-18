use rusqlite::{params, params_from_iter, Connection};
use serde::Serialize;
use serde_yaml::{Mapping, Value};
use std::collections::{HashMap, HashSet};
use strsim::{jaro_winkler, normalized_damerau_levenshtein};

pub(crate) const SEARCH_SCHEMA_VERSION: &str = "1";

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
    title: String,
    aliases: String,
    source_text: String,
    translated_text: String,
}

#[derive(Debug, Serialize)]
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
    pub score: f64,
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

fn enum_items(values: Option<&Value>) -> Vec<(String, String, String)> {
    match values {
        Some(Value::Mapping(items)) => items
            .iter()
            .map(|(value, desc)| (value_text(value), value_text(desc), String::new()))
            .collect(),
        Some(Value::Sequence(items)) => items
            .iter()
            .filter_map(Value::as_mapping)
            .map(|item| {
                (
                    scalar_text(get(item, "value")),
                    join_text([
                        scalar_text(get(item, "name")),
                        scalar_text(get(item, "desc")),
                    ]),
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
            .filter_map(|(value, desc, translated_condition)| {
                if value == enum_value
                    && (translated_condition.is_empty() || translated_condition == condition)
                {
                    Some(join_text([desc, translated_condition]))
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
    let chip_source = join_text([
        chip.sensor.clone(),
        chip.vendor.clone(),
        chip.family.clone(),
        chip.category.clone(),
        map_text(root, &["description", "device_type"]),
    ]);
    let mut documents = vec![SearchDocument {
        doc_key: format!("{}:chip", chip.id),
        kind: "chip".to_owned(),
        page_name: String::new(),
        register_index: None,
        register_name: String::new(),
        register_locator: String::new(),
        field_name: String::new(),
        field_bits: String::new(),
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
            let register_source = join_text([
                map_text(
                    register,
                    &[
                        "name",
                        "access",
                        "reset",
                        "desc",
                        "condition",
                        "execution_state",
                        "alias_note",
                        "no_dump_reason",
                    ],
                ),
                locator.clone(),
                aliases.join(" "),
            ]);
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
                title: register_name.clone(),
                aliases: aliases.join(" "),
                source_text: register_source,
                translated_text: register_translated,
            });

            for (field_index, field_value) in sequence(get(register, "fields")).iter().enumerate() {
                let Some(field) = field_value.as_mapping() else {
                    continue;
                };
                let field_name = scalar_text(get(field, "name"));
                let field_bits = scalar_text(get(field, "bits"));
                let field_translations =
                    translated_field(&register_translations, &field_name, &field_bits);
                let field_source = map_text(
                    field,
                    &[
                        "name",
                        "bits",
                        "access",
                        "reset",
                        "reset_info",
                        "condition",
                        "reserved",
                        "desc",
                    ],
                );
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
                    title: field_name.clone(),
                    aliases: field_bits.clone(),
                    source_text: field_source,
                    translated_text: field_translated,
                });

                for (enum_index, (enum_value, enum_desc, condition)) in
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
                        title: enum_value.clone(),
                        aliases: field_name.clone(),
                        source_text: join_text([enum_value, enum_desc, condition]),
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
            title: note.register_name.clone(),
            aliases: note.kind.clone(),
            source_text: note.content.clone(),
            translated_text: String::new(),
        });
    }
    documents
}

pub(crate) fn initialize_schema(connection: &Connection) -> Result<(), String> {
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
                title, aliases, source_text, translated_text
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
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
                title, aliases, source_text, translated_text
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, ?9, '', '', ?10, ?11, ?12, '')",
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
        .filter(|character| !matches!(character, '_' | '-' | ' ' | '\t' | '\r' | '\n'))
        .collect()
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

pub(crate) fn search(
    connection: &Connection,
    query: &str,
    current_chip_id: Option<&str>,
    limit: usize,
) -> Result<Vec<SearchResult>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let normalized_query = normalize(query);
    let mut candidates: HashMap<i64, f64> = HashMap::new();
    let like = format!(
        "%{}%",
        query.to_lowercase().replace('%', "\\%").replace('_', "\\_")
    );
    {
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
    }
    if query.chars().count() >= 3 {
        let expression = fts_query(&query.to_lowercase());
        let mut statement = connection
            .prepare(
                "SELECT rowid, bm25(search_fts, 8.0, 5.0, 1.5, 2.0)
                 FROM search_fts WHERE search_fts MATCH ?1 ORDER BY rank LIMIT 600",
            )
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
    if candidates.is_empty() {
        return Ok(Vec::new());
    }

    let mut results = Vec::new();
    let placeholders = vec!["?"; candidates.len()].join(",");
    let query_sql = format!(
        "SELECT id, kind, chip_id, chip_name, category, enabled, page_name, register_index,
                register_name, register_locator, field_name, field_bits, title, aliases,
                source_text, translated_text
         FROM search_documents WHERE id IN ({placeholders})"
    );
    let mut statement = connection
        .prepare(&query_sql)
        .map_err(|error| format!("无法读取搜索候选：{error}"))?;
    let rows = statement
        .query_map(params_from_iter(candidates.keys()), |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)? != 0,
                row.get::<_, String>(6)?,
                row.get::<_, Option<i64>>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, String>(9)?,
                row.get::<_, String>(10)?,
                row.get::<_, String>(11)?,
                row.get::<_, String>(12)?,
                row.get::<_, String>(13)?,
                row.get::<_, String>(14)?,
                row.get::<_, String>(15)?,
            ))
        })
        .map_err(|error| format!("无法查询搜索候选：{error}"))?;
    for row in rows.flatten() {
        let (
            id,
            kind,
            chip_id,
            chip_name,
            category,
            enabled,
            page_name,
            register_index,
            register_name,
            register_locator,
            field_name,
            field_bits,
            title,
            aliases,
            source_text,
            translated_text,
        ) = row;
        let Some(fts_rank) = candidates.get(&id) else {
            continue;
        };
        let normalized_title = normalize(&title);
        let normalized_aliases = normalize(&aliases);
        let normalized_locator = normalize(&register_locator);
        let exact_title = normalized_title == normalized_query;
        let exact_locator = normalized_locator == normalized_query;
        let prefix = normalized_title.starts_with(&normalized_query);
        let contains = normalized_title.contains(&normalized_query)
            || normalized_aliases.contains(&normalized_query);
        let fuzzy = jaro_winkler(&normalized_query, &normalized_title).max(
            normalized_damerau_levenshtein(&normalized_query, &normalized_title),
        );
        let source_match = source_text.to_lowercase().contains(&query.to_lowercase());
        let translated_match = translated_text
            .to_lowercase()
            .contains(&query.to_lowercase());
        let mut score = if exact_title || exact_locator {
            1000.0
        } else if prefix {
            900.0
        } else if contains {
            820.0
        } else if fuzzy >= 0.58 {
            520.0 + fuzzy * 260.0
        } else if translated_match {
            570.0
        } else if source_match {
            550.0
        } else {
            420.0 - fts_rank.min(100.0)
        };
        if current_chip_id == Some(chip_id.as_str()) {
            score += 35.0;
        }
        score += match kind.as_str() {
            "register" => 24.0,
            "field" => 18.0,
            "enum" => 10.0,
            "note" => 4.0,
            _ => 0.0,
        };
        let (matched_source, match_language) = if translated_match {
            (&translated_text, "zh-CN")
        } else if source_match {
            (&source_text, "source")
        } else if contains && !aliases.is_empty() {
            (&aliases, "identifier")
        } else {
            (&source_text, "identifier")
        };
        results.push(SearchResult {
            kind,
            chip_id,
            chip_name,
            category,
            enabled,
            page_name,
            register_index: register_index.map(|value| value as usize),
            register_name,
            register_locator,
            field_name,
            field_bits,
            title,
            snippet: snippet(matched_source, query),
            match_language: match_language.to_owned(),
            score,
        });
    }
    results.sort_by(|left, right| {
        right
            .score
            .total_cmp(&left.score)
            .then_with(|| left.chip_name.cmp(&right.chip_name))
            .then_with(|| left.page_name.cmp(&right.page_name))
            .then_with(|| left.register_name.cmp(&right.register_name))
    });
    results.truncate(limit.clamp(1, 100));
    Ok(results)
}

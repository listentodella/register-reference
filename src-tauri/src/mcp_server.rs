use crate::read_service::{
    default_database_path, ChipSelector, ReadService, ReadServiceError, RegisterSelector,
};
use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{CallToolResult, ServerCapabilities, ServerInfo},
    schemars::JsonSchema,
    tool, tool_handler, tool_router, ServerHandler, ServiceExt,
};
use serde::Deserialize;
use serde::Serialize;
use serde_json::json;
use std::ffi::OsString;
use std::path::PathBuf;

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChipArgs {
    /// Exact chip name as returned by get_chip_catalog.
    pub chip: String,
    /// Full source SHA-256 used to disambiguate duplicate chip names.
    #[serde(default)]
    pub source_sha256: Option<String>,
}

impl ChipArgs {
    fn selector(self) -> ChipSelector {
        ChipSelector {
            chip: self.chip,
            source_sha256: self.source_sha256,
        }
    }
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RegisterArgs {
    /// Exact chip name as returned by get_chip_catalog or search_registers.
    pub chip: String,
    /// Full source SHA-256 used to disambiguate duplicate chip names.
    #[serde(default)]
    pub source_sha256: Option<String>,
    /// Exact page/category name containing the register.
    pub page: String,
    /// Register name; add locator or index when the name is not unique.
    #[serde(default)]
    pub register_name: Option<String>,
    /// Address or system encoding returned by search_registers.
    #[serde(default)]
    pub register_locator: Option<String>,
    /// Zero-based register index returned by search_registers.
    #[serde(default)]
    pub register_index: Option<usize>,
}

impl RegisterArgs {
    fn selector(self) -> RegisterSelector {
        RegisterSelector {
            chip: self.chip,
            source_sha256: self.source_sha256,
            page: self.page,
            register_name: self.register_name,
            register_locator: self.register_locator,
            register_index: self.register_index,
        }
    }
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SearchArgs {
    /// Text plus optional chip:, type:, access:, addr:, and bits: filters.
    pub query: String,
    /// Optional current chip used only as a tie-break among equally relevant results.
    #[serde(default)]
    pub current_chip: Option<String>,
    /// Source SHA-256 for an ambiguous current chip.
    #[serde(default)]
    pub current_source_sha256: Option<String>,
    /// Maximum results, from 1 through 50. Defaults to 20.
    #[serde(default)]
    pub limit: Option<usize>,
    /// Include user-note matches and snippets. Defaults to false for privacy.
    #[serde(default)]
    pub include_notes: bool,
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FieldArgs {
    #[serde(flatten)]
    pub register: RegisterArgs,
    /// Exact field name.
    pub field_name: String,
    /// Optional normalized bit range, such as 31:28 or 4.
    #[serde(default)]
    pub bits: Option<String>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DecodeArgs {
    #[serde(flatten)]
    pub register: RegisterArgs,
    /// Unsigned decimal, 0x hexadecimal, or 0b binary register value, up to 128-bit.
    pub value: String,
}

#[derive(Clone, Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CompareArgs {
    /// First imported register.
    pub left: RegisterArgs,
    /// Second imported register.
    pub right: RegisterArgs,
}

#[derive(Clone)]
pub struct RegisterMcpServer {
    read_service: ReadService,
    tool_router: ToolRouter<Self>,
}

impl RegisterMcpServer {
    fn new(read_service: ReadService) -> Self {
        Self {
            read_service,
            tool_router: Self::tool_router(),
        }
    }

    async fn execute<T, F>(&self, operation: F) -> CallToolResult
    where
        T: Serialize + Send + 'static,
        F: FnOnce(ReadService) -> Result<T, ReadServiceError> + Send + 'static,
    {
        let service = self.read_service.clone();
        match tokio::task::spawn_blocking(move || operation(service)).await {
            Ok(Ok(value)) => match serde_json::to_value(value) {
                Ok(value) => CallToolResult::structured(value),
                Err(error) => CallToolResult::structured_error(json!({
                    "code": "serialization_failed",
                    "message": format!("无法序列化工具结果：{error}")
                })),
            },
            Ok(Err(error)) => tool_error(error),
            Err(error) => CallToolResult::structured_error(json!({
                "code": "tool_task_failed",
                "message": format!("只读查询任务异常结束：{error}")
            })),
        }
    }
}

#[tool_router(router = tool_router)]
impl RegisterMcpServer {
    /// List imported chips with vendor, category, source, and translation status.
    #[tool(
        name = "get_chip_catalog",
        annotations(title = "Get chip catalog", read_only_hint = true)
    )]
    async fn get_chip_catalog(&self) -> CallToolResult {
        self.execute(|service| service.chip_catalog()).await
    }

    /// Search register, field, enum, address, and description entities using the desktop ranking semantics.
    #[tool(
        name = "search_registers",
        annotations(title = "Search registers", read_only_hint = true)
    )]
    async fn search_registers(&self, Parameters(args): Parameters<SearchArgs>) -> CallToolResult {
        let current_chip = args.current_chip.map(|chip| ChipSelector {
            chip,
            source_sha256: args.current_source_sha256,
        });
        self.execute(move |service| {
            service.search_registers(
                &args.query,
                current_chip.as_ref(),
                args.limit.unwrap_or(20),
                args.include_notes,
            )
        })
        .await
    }

    /// Return one complete imported register DTO. Ambiguous names return candidates instead of choosing silently.
    #[tool(
        name = "get_register",
        annotations(title = "Get register", read_only_hint = true)
    )]
    async fn get_register(&self, Parameters(args): Parameters<RegisterArgs>) -> CallToolResult {
        let selector = args.selector();
        self.execute(move |service| service.get_register(&selector))
            .await
    }

    /// Return one field with access, bit range, conditions, and enum definitions.
    #[tool(
        name = "get_field",
        annotations(title = "Get register field", read_only_hint = true)
    )]
    async fn get_field(&self, Parameters(args): Parameters<FieldArgs>) -> CallToolResult {
        let selector = args.register.selector();
        self.execute(move |service| {
            service.get_field(&selector, &args.field_name, args.bits.as_deref())
        })
        .await
    }

    /// Decode an unsigned register value into all fields and exact enum meanings.
    #[tool(
        name = "decode_register_value",
        annotations(title = "Decode register value", read_only_hint = true)
    )]
    async fn decode_register_value(
        &self,
        Parameters(args): Parameters<DecodeArgs>,
    ) -> CallToolResult {
        let selector = args.register.selector();
        self.execute(move |service| service.decode_register_value(&selector, &args.value))
            .await
    }

    /// Compare the structures of two imported registers without reading arbitrary files.
    #[tool(
        name = "compare_registers",
        annotations(title = "Compare registers", read_only_hint = true)
    )]
    async fn compare_registers(&self, Parameters(args): Parameters<CompareArgs>) -> CallToolResult {
        let left = args.left.selector();
        let right = args.right.selector();
        self.execute(move |service| service.compare_registers(&left, &right))
            .await
    }

    /// Return source file, version, SHA-256, import timestamps, and translation status.
    #[tool(
        name = "get_source_metadata",
        annotations(title = "Get source metadata", read_only_hint = true)
    )]
    async fn get_source_metadata(&self, Parameters(args): Parameters<ChipArgs>) -> CallToolResult {
        let selector = args.selector();
        self.execute(move |service| service.get_source_metadata(&selector))
            .await
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for RegisterMcpServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build()).with_instructions(
            "Read-only local register library. Use get_chip_catalog or search_registers before exact register lookup. User note text is excluded unless search_registers includeNotes is explicitly true.",
        )
    }
}

fn tool_error(error: ReadServiceError) -> CallToolResult {
    CallToolResult::structured_error(serde_json::to_value(error).unwrap_or_else(|_| {
        json!({
            "code": "tool_failed",
            "message": "只读查询失败"
        })
    }))
}

pub async fn run_from_env() -> Result<(), String> {
    let Some(database_path) = parse_args(std::env::args_os().skip(1))? else {
        return Ok(());
    };
    let service = ReadService::open(database_path).map_err(|error| error.to_string())?;
    eprintln!(
        "register-reference-mcp: read-only stdio server using {}",
        service.database_path().display()
    );
    RegisterMcpServer::new(service)
        .serve(rmcp::transport::stdio())
        .await
        .map_err(|error| format!("无法启动 MCP stdio 服务：{error}"))?
        .waiting()
        .await
        .map_err(|error| format!("MCP stdio 服务异常结束：{error}"))?;
    Ok(())
}

fn parse_args(arguments: impl IntoIterator<Item = OsString>) -> Result<Option<PathBuf>, String> {
    let mut database_path = None;
    let mut arguments = arguments.into_iter();
    while let Some(argument) = arguments.next() {
        match argument.to_string_lossy().as_ref() {
            "--db" => {
                if database_path.is_some() {
                    return Err("--db 只能指定一次".to_owned());
                }
                let path = arguments
                    .next()
                    .ok_or_else(|| "--db 后必须提供数据库路径".to_owned())?;
                database_path = Some(PathBuf::from(path));
            }
            "--help" | "-h" => {
                println!(
                    "register-reference-mcp\n\nUSAGE:\n  register-reference-mcp [--db <path>]\n\nRuns a read-only MCP server over stdio. Diagnostics are written to stderr."
                );
                return Ok(None);
            }
            "--version" | "-V" => {
                println!("register-reference-mcp {}", env!("CARGO_PKG_VERSION"));
                return Ok(None);
            }
            unknown => {
                return Err(format!(
                    "未知参数 {unknown}；仅支持 --db <path>、--help 和 --version"
                ));
            }
        }
    }
    database_path
        .map(Ok)
        .unwrap_or_else(|| default_database_path().map_err(|error| error.to_string()))
        .map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_explicit_database_argument() {
        let path = parse_args([OsString::from("--db"), OsString::from("fixture.sqlite3")])
            .unwrap()
            .unwrap();
        assert_eq!(path, PathBuf::from("fixture.sqlite3"));
    }

    #[test]
    fn rejects_unknown_or_duplicate_arguments() {
        assert!(parse_args([OsString::from("--listen")]).is_err());
        assert!(parse_args([
            OsString::from("--db"),
            OsString::from("a"),
            OsString::from("--db"),
            OsString::from("b"),
        ])
        .is_err());
    }
}

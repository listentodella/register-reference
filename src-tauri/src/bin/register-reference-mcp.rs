#[tokio::main]
async fn main() {
    if let Err(error) = register_reference_lib::mcp_server::run_from_env().await {
        eprintln!("register-reference-mcp: {error}");
        std::process::exit(2);
    }
}

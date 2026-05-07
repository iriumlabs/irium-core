// Irium Core GUI - Tauri Backend
// Full node desktop application for Irium blockchain
// RPC: 127.0.0.1:38300, P2P: 38291
// Addresses: P/Q prefix, Amounts: satoshis (1 IRM = 100,000,000 sats)

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{Arc, Mutex};
use tauri::{Manager, SystemTray, SystemTrayMenu, SystemTrayMenuItem, CustomMenuItem, State};
use tauri::api::process::{Command, CommandChild, CommandEvent};

mod types;
use types::*;

// ============================================================
// STATE
// ============================================================

struct AppState {
    node_process: Arc<Mutex<Option<CommandChild>>>,
    miner_process: Arc<Mutex<Option<CommandChild>>>,
    rpc_url: Arc<Mutex<String>>,
    wallet_path: Arc<Mutex<Option<String>>>,
}

impl AppState {
    fn new() -> Self {
        AppState {
            node_process: Arc::new(Mutex::new(None)),
            miner_process: Arc::new(Mutex::new(None)),
            rpc_url: Arc::new(Mutex::new("http://127.0.0.1:38300".to_string())),
            wallet_path: Arc::new(Mutex::new(None)),
        }
    }
}

// ============================================================
// NODE MANAGEMENT
// ============================================================

#[tauri::command]
async fn start_node(
    state: State<'_, AppState>,
    data_dir: Option<String>,
) -> Result<NodeStartResult, String> {
    let mut proc_lock = state.node_process.lock().map_err(|e| e.to_string())?;

    if proc_lock.is_some() {
        return Ok(NodeStartResult {
            success: false,
            message: "Node is already running".to_string(),
            pid: None,
        });
    }

    let mut args = vec!["--http-rpc".to_string()];
    if let Some(dir) = data_dir {
        args.push(format!("--data-dir={}", dir));
    }

    match Command::new_sidecar("iriumd") {
        Ok(cmd) => {
            match cmd.args(&args).spawn() {
                Ok((mut rx, child)) => {
                    let pid = child.pid();
                    *proc_lock = Some(child);

                    // Drain startup output in background
                    tauri::async_runtime::spawn(async move {
                        while let Some(event) = rx.recv().await {
                            match event {
                                CommandEvent::Stdout(line) => {
                                    tracing::info!("[iriumd] {}", line);
                                }
                                CommandEvent::Stderr(line) => {
                                    tracing::warn!("[iriumd stderr] {}", line);
                                }
                                _ => break,
                            }
                        }
                    });

                    Ok(NodeStartResult {
                        success: true,
                        message: "Node started successfully".to_string(),
                        pid: Some(pid),
                    })
                }
                Err(e) => Err(format!("Failed to spawn iriumd: {}", e)),
            }
        }
        Err(e) => Err(format!("iriumd sidecar not found: {}. Make sure iriumd binary is placed in src-tauri/binaries/", e)),
    }
}

#[tauri::command]
async fn stop_node(state: State<'_, AppState>) -> Result<bool, String> {
    let mut proc_lock = state.node_process.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = proc_lock.take() {
        child.kill().map_err(|e| e.to_string())?;
        return Ok(true);
    }
    Ok(false)
}

#[tauri::command]
async fn get_node_status(state: State<'_, AppState>) -> Result<NodeStatus, String> {
    let rpc_url = state.rpc_url.lock().map_err(|e| e.to_string())?.clone();
    let is_running = state.node_process.lock().map_err(|e| e.to_string())?.is_some();

    if !is_running {
        return Ok(NodeStatus {
            running: false,
            synced: false,
            height: 0,
            tip: String::new(),
            peers: 0,
            network: "irium".to_string(),
            version: String::new(),
            rpc_url: rpc_url,
        });
    }

    // Try to reach RPC
    match get_rpc_info(&rpc_url).await {
        Ok(info) => Ok(NodeStatus {
            running: true,
            synced: info.synced.unwrap_or(false),
            height: info.height.unwrap_or(0),
            tip: info.tip.unwrap_or_default(),
            peers: info.peers.unwrap_or(0),
            network: info.network.unwrap_or("irium".to_string()),
            version: info.version.unwrap_or_default(),
            rpc_url,
        }),
        Err(_) => Ok(NodeStatus {
            running: true,
            synced: false,
            height: 0,
            tip: String::new(),
            peers: 0,
            network: "irium".to_string(),
            version: String::new(),
            rpc_url,
        }),
    }
}

async fn get_rpc_info(rpc_url: &str) -> Result<RpcInfo, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{}/status", rpc_url))
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let info: RpcInfo = resp.json().await.map_err(|e| e.to_string())?;
    Ok(info)
}

// ============================================================
// WALLET COMMANDS
// ============================================================

async fn run_wallet_cmd(args: Vec<String>, wallet_path: Option<String>) -> Result<String, String> {
    let mut full_args = args;
    if let Some(path) = wallet_path {
        full_args.insert(0, format!("--wallet={}", path));
    }

    let cmd = Command::new_sidecar("irium-wallet")
        .map_err(|e| format!("irium-wallet sidecar not found: {}. Place binary in src-tauri/binaries/", e))?
        .args(&full_args);

    let output = cmd.output().map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(output.stdout)
    } else {
        Err(output.stderr)
    }
}

#[tauri::command]
async fn wallet_get_balance(state: State<'_, AppState>) -> Result<WalletBalance, String> {
    let wallet_path = state.wallet_path.lock().map_err(|e| e.to_string())?.clone();
    let output = run_wallet_cmd(vec!["balance".to_string(), "--json".to_string()], wallet_path).await?;
    serde_json::from_str::<WalletBalance>(&output).map_err(|e| format!("Parse error: {} | raw: {}", e, output))
}

#[tauri::command]
async fn wallet_new_address(state: State<'_, AppState>) -> Result<String, String> {
    let wallet_path = state.wallet_path.lock().map_err(|e| e.to_string())?.clone();
    let output = run_wallet_cmd(vec!["new-address".to_string()], wallet_path).await?;
    Ok(output.trim().to_string())
}

#[tauri::command]
async fn wallet_list_addresses(state: State<'_, AppState>) -> Result<Vec<AddressInfo>, String> {
    let wallet_path = state.wallet_path.lock().map_err(|e| e.to_string())?.clone();
    let output = run_wallet_cmd(vec!["list-addresses".to_string(), "--json".to_string()], wallet_path).await?;
    serde_json::from_str::<Vec<AddressInfo>>(&output).map_err(|e| format!("Parse error: {} | raw: {}", e, output))
}

#[tauri::command]
async fn wallet_send(
    state: State<'_, AppState>,
    to: String,
    amount_sats: u64,
    fee_sats: Option<u64>,
) -> Result<SendResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(|e| e.to_string())?.clone();
    let mut args = vec![
        "send".to_string(),
        format!("--to={}", to),
        format!("--amount={}", amount_sats),
    ];
    if let Some(fee) = fee_sats {
        args.push(format!("--fee={}", fee));
    }
    args.push("--json".to_string());

    let output = run_wallet_cmd(args, wallet_path).await?;
    serde_json::from_str::<SendResult>(&output).map_err(|e| format!("Parse error: {} | raw: {}", e, output))
}

#[tauri::command]
async fn wallet_transactions(state: State<'_, AppState>, limit: Option<u32>) -> Result<Vec<Transaction>, String> {
    let wallet_path = state.wallet_path.lock().map_err(|e| e.to_string())?.clone();
    let mut args = vec!["transactions".to_string(), "--json".to_string()];
    if let Some(n) = limit {
        args.push(format!("--limit={}", n));
    }
    let output = run_wallet_cmd(args, wallet_path).await?;
    serde_json::from_str::<Vec<Transaction>>(&output).map_err(|e| format!("Parse error: {} | raw: {}", e, output))
}

#[tauri::command]
async fn wallet_set_path(state: State<'_, AppState>, path: String) -> Result<bool, String> {
    let mut wallet_path = state.wallet_path.lock().map_err(|e| e.to_string())?;
    *wallet_path = Some(path);
    Ok(true)
}

// ============================================================
// OFFER / MARKETPLACE
// ============================================================

#[tauri::command]
async fn offer_list(
    state: State<'_, AppState>,
    source: Option<String>,
    sort: Option<String>,
    limit: Option<u32>,
    min_amount: Option<f64>,
    max_amount: Option<f64>,
    payment: Option<String>,
) -> Result<Vec<Offer>, String> {
    let wallet_path = state.wallet_path.lock().map_err(|e| e.to_string())?.clone();
    let mut args = vec!["offer-list".to_string(), "--json".to_string()];

    if let Some(s) = source { args.push(format!("--source={}", s)); }
    if let Some(s) = sort { args.push(format!("--sort={}", s)); }
    if let Some(n) = limit { args.push(format!("--limit={}", n)); }
    if let Some(a) = min_amount { args.push(format!("--min-amount={}", a)); }
    if let Some(a) = max_amount { args.push(format!("--max-amount={}", a)); }
    if let Some(p) = payment { args.push(format!("--payment={}", p)); }

    let output = run_wallet_cmd(args, wallet_path).await?;
    serde_json::from_str::<Vec<Offer>>(&output).map_err(|e| format!("Parse error: {} | raw: {}", e, output))
}

#[tauri::command]
async fn offer_show(state: State<'_, AppState>, offer_id: String) -> Result<Offer, String> {
    let wallet_path = state.wallet_path.lock().map_err(|e| e.to_string())?.clone();
    let output = run_wallet_cmd(vec!["offer-show".to_string(), offer_id, "--json".to_string()], wallet_path).await?;
    serde_json::from_str::<Offer>(&output).map_err(|e| format!("Parse error: {} | raw: {}", e, output))
}

#[tauri::command]
async fn offer_create(
    state: State<'_, AppState>,
    params: CreateOfferParams,
) -> Result<CreateOfferResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(|e| e.to_string())?.clone();
    let mut args = vec!["offer-create".to_string()];
    args.push(format!("--amount={}", params.amount_sats));
    if let Some(d) = params.description { args.push(format!("--description={}", d)); }
    if let Some(p) = params.payment_method { args.push(format!("--payment={}", p)); }
    if let Some(id) = params.offer_id { args.push(format!("--id={}", id)); }
    args.push("--json".to_string());

    let output = run_wallet_cmd(args, wallet_path).await?;
    serde_json::from_str::<CreateOfferResult>(&output).map_err(|e| format!("Parse error: {} | raw: {}", e, output))
}

#[tauri::command]
async fn offer_take(
    state: State<'_, AppState>,
    offer_id: String,
) -> Result<OfferTakeResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(|e| e.to_string())?.clone();
    let output = run_wallet_cmd(
        vec!["offer-take".to_string(), offer_id, "--json".to_string()],
        wallet_path,
    ).await?;
    serde_json::from_str::<OfferTakeResult>(&output).map_err(|e| format!("Parse error: {} | raw: {}", e, output))
}

#[tauri::command]
async fn offer_export(state: State<'_, AppState>, offer_id: String, out_path: String) -> Result<bool, String> {
    let wallet_path = state.wallet_path.lock().map_err(|e| e.to_string())?.clone();
    run_wallet_cmd(vec!["offer-export".to_string(), offer_id, format!("--out={}", out_path)], wallet_path).await?;
    Ok(true)
}

#[tauri::command]
async fn offer_import(state: State<'_, AppState>, file_path: String) -> Result<bool, String> {
    let wallet_path = state.wallet_path.lock().map_err(|e| e.to_string())?.clone();
    run_wallet_cmd(vec!["offer-import".to_string(), file_path], wallet_path).await?;
    Ok(true)
}

// ============================================================
// FEED MANAGEMENT
// ============================================================

#[tauri::command]
async fn feed_add(state: State<'_, AppState>, url: String) -> Result<bool, String> {
    let wallet_path = state.wallet_path.lock().map_err(|e| e.to_string())?.clone();
    run_wallet_cmd(vec!["feed-add".to_string(), url], wallet_path).await?;
    Ok(true)
}

#[tauri::command]
async fn feed_remove(state: State<'_, AppState>, url: String) -> Result<bool, String> {
    let wallet_path = state.wallet_path.lock().map_err(|e| e.to_string())?.clone();
    run_wallet_cmd(vec!["feed-remove".to_string(), url], wallet_path).await?;
    Ok(true)
}

#[tauri::command]
async fn feed_list(state: State<'_, AppState>) -> Result<Vec<FeedEntry>, String> {
    let wallet_path = state.wallet_path.lock().map_err(|e| e.to_string())?.clone();
    let output = run_wallet_cmd(vec!["feed-list".to_string(), "--json".to_string()], wallet_path).await?;
    serde_json::from_str::<Vec<FeedEntry>>(&output).map_err(|e| format!("Parse error: {} | raw: {}", e, output))
}

#[tauri::command]
async fn feed_sync(state: State<'_, AppState>) -> Result<FeedSyncResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(|e| e.to_string())?.clone();
    let output = run_wallet_cmd(vec!["offer-feed-sync".to_string(), "--json".to_string()], wallet_path).await?;
    serde_json::from_str::<FeedSyncResult>(&output).map_err(|e| format!("Parse error: {} | raw: {}", e, output))
}

#[tauri::command]
async fn feed_fetch(state: State<'_, AppState>, url: String) -> Result<Vec<Offer>, String> {
    let wallet_path = state.wallet_path.lock().map_err(|e| e.to_string())?.clone();
    let output = run_wallet_cmd(
        vec!["offer-feed-fetch".to_string(), url, "--json".to_string()],
        wallet_path,
    ).await?;
    serde_json::from_str::<Vec<Offer>>(&output).map_err(|e| format!("Parse error: {} | raw: {}", e, output))
}

#[tauri::command]
async fn feed_prune(state: State<'_, AppState>) -> Result<bool, String> {
    let wallet_path = state.wallet_path.lock().map_err(|e| e.to_string())?.clone();
    run_wallet_cmd(vec!["offer-feed-prune".to_string()], wallet_path).await?;
    Ok(true)
}

// ============================================================
// AGREEMENTS
// ============================================================

#[tauri::command]
async fn agreement_list(state: State<'_, AppState>) -> Result<Vec<Agreement>, String> {
    let wallet_path = state.wallet_path.lock().map_err(|e| e.to_string())?.clone();
    let output = run_wallet_cmd(vec!["agreement-list".to_string(), "--json".to_string()], wallet_path).await?;
    serde_json::from_str::<Vec<Agreement>>(&output).map_err(|e| format!("Parse error: {} | raw: {}", e, output))
}

#[tauri::command]
async fn agreement_show(state: State<'_, AppState>, agreement_id: String) -> Result<Agreement, String> {
    let wallet_path = state.wallet_path.lock().map_err(|e| e.to_string())?.clone();
    let output = run_wallet_cmd(
        vec!["agreement-show".to_string(), agreement_id, "--json".to_string()],
        wallet_path,
    ).await?;
    serde_json::from_str::<Agreement>(&output).map_err(|e| format!("Parse error: {} | raw: {}", e, output))
}

#[tauri::command]
async fn agreement_create(
    state: State<'_, AppState>,
    params: CreateAgreementParams,
) -> Result<AgreementResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(|e| e.to_string())?.clone();
    let mut args = vec!["agreement-create".to_string()];
    args.push(format!("--template={}", params.template));
    args.push(format!("--counterparty={}", params.counterparty));
    args.push(format!("--amount={}", params.amount_sats));
    if let Some(d) = params.deadline_hours {
        args.push(format!("--deadline={}", d));
    }
    if let Some(m) = params.memo {
        args.push(format!("--memo={}", m));
    }
    args.push("--json".to_string());

    let output = run_wallet_cmd(args, wallet_path).await?;
    serde_json::from_str::<AgreementResult>(&output).map_err(|e| format!("Parse error: {} | raw: {}", e, output))
}

#[tauri::command]
async fn agreement_pack(state: State<'_, AppState>, agreement_id: String, out_path: String) -> Result<bool, String> {
    let wallet_path = state.wallet_path.lock().map_err(|e| e.to_string())?.clone();
    run_wallet_cmd(
        vec!["agreement-pack".to_string(), agreement_id, format!("--out={}", out_path)],
        wallet_path,
    ).await?;
    Ok(true)
}

#[tauri::command]
async fn agreement_unpack(state: State<'_, AppState>, file_path: String) -> Result<Agreement, String> {
    let wallet_path = state.wallet_path.lock().map_err(|e| e.to_string())?.clone();
    let output = run_wallet_cmd(
        vec!["agreement-unpack".to_string(), file_path, "--json".to_string()],
        wallet_path,
    ).await?;
    serde_json::from_str::<Agreement>(&output).map_err(|e| format!("Parse error: {} | raw: {}", e, output))
}

#[tauri::command]
async fn agreement_release(state: State<'_, AppState>, agreement_id: String) -> Result<ReleaseResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(|e| e.to_string())?.clone();
    let output = run_wallet_cmd(
        vec!["agreement-release".to_string(), agreement_id, "--json".to_string()],
        wallet_path,
    ).await?;
    serde_json::from_str::<ReleaseResult>(&output).map_err(|e| format!("Parse error: {} | raw: {}", e, output))
}

#[tauri::command]
async fn agreement_refund(state: State<'_, AppState>, agreement_id: String) -> Result<ReleaseResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(|e| e.to_string())?.clone();
    let output = run_wallet_cmd(
        vec!["agreement-refund".to_string(), agreement_id, "--json".to_string()],
        wallet_path,
    ).await?;
    serde_json::from_str::<ReleaseResult>(&output).map_err(|e| format!("Parse error: {} | raw: {}", e, output))
}

// ============================================================
// PROOFS
// ============================================================

#[tauri::command]
async fn proof_list(state: State<'_, AppState>, agreement_id: Option<String>) -> Result<Vec<Proof>, String> {
    let wallet_path = state.wallet_path.lock().map_err(|e| e.to_string())?.clone();
    let mut args = vec!["proof-list".to_string(), "--json".to_string()];
    if let Some(id) = agreement_id {
        args.push(format!("--agreement={}", id));
    }
    let output = run_wallet_cmd(args, wallet_path).await?;
    serde_json::from_str::<Vec<Proof>>(&output).map_err(|e| format!("Parse error: {} | raw: {}", e, output))
}

#[tauri::command]
async fn proof_sign(
    state: State<'_, AppState>,
    agreement_id: String,
    proof_data: String,
    out_path: String,
) -> Result<bool, String> {
    let wallet_path = state.wallet_path.lock().map_err(|e| e.to_string())?.clone();
    run_wallet_cmd(
        vec![
            "proof-sign".to_string(),
            format!("--agreement={}", agreement_id),
            format!("--data={}", proof_data),
            format!("--out={}", out_path),
        ],
        wallet_path,
    ).await?;
    Ok(true)
}

#[tauri::command]
async fn proof_submit(
    state: State<'_, AppState>,
    agreement_id: String,
    proof_file: String,
) -> Result<ProofSubmitResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(|e| e.to_string())?.clone();
    let output = run_wallet_cmd(
        vec![
            "proof-submit".to_string(),
            format!("--agreement={}", agreement_id),
            format!("--proof={}", proof_file),
            "--json".to_string(),
        ],
        wallet_path,
    ).await?;
    serde_json::from_str::<ProofSubmitResult>(&output).map_err(|e| format!("Parse error: {} | raw: {}", e, output))
}

// ============================================================
// REPUTATION
// ============================================================

#[tauri::command]
async fn reputation_show(state: State<'_, AppState>, pubkey_or_addr: String) -> Result<Reputation, String> {
    let wallet_path = state.wallet_path.lock().map_err(|e| e.to_string())?.clone();
    let output = run_wallet_cmd(
        vec!["reputation-show".to_string(), pubkey_or_addr, "--json".to_string()],
        wallet_path,
    ).await?;
    serde_json::from_str::<Reputation>(&output).map_err(|e| format!("Parse error: {} | raw: {}", e, output))
}

// ============================================================
// SETTLEMENT TEMPLATES
// ============================================================

#[tauri::command]
async fn settlement_create_otc(
    state: State<'_, AppState>,
    params: OtcParams,
) -> Result<AgreementResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(|e| e.to_string())?.clone();
    let mut args = vec!["settlement-otc".to_string()];
    args.push(format!("--buyer={}", params.buyer));
    args.push(format!("--seller={}", params.seller));
    args.push(format!("--amount={}", params.amount_sats));
    if let Some(d) = params.deadline_hours { args.push(format!("--deadline={}", d)); }
    if let Some(m) = params.memo { args.push(format!("--memo={}", m)); }
    args.push("--json".to_string());

    let output = run_wallet_cmd(args, wallet_path).await?;
    serde_json::from_str::<AgreementResult>(&output).map_err(|e| format!("Parse error: {} | raw: {}", e, output))
}

#[tauri::command]
async fn settlement_create_freelance(
    state: State<'_, AppState>,
    params: FreelanceParams,
) -> Result<AgreementResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(|e| e.to_string())?.clone();
    let mut args = vec!["settlement-freelance".to_string()];
    args.push(format!("--client={}", params.client));
    args.push(format!("--contractor={}", params.contractor));
    args.push(format!("--amount={}", params.amount_sats));
    if let Some(d) = params.deadline_hours { args.push(format!("--deadline={}", d)); }
    if let Some(s) = params.scope { args.push(format!("--scope={}", s)); }
    args.push("--json".to_string());

    let output = run_wallet_cmd(args, wallet_path).await?;
    serde_json::from_str::<AgreementResult>(&output).map_err(|e| format!("Parse error: {} | raw: {}", e, output))
}

#[tauri::command]
async fn settlement_create_milestone(
    state: State<'_, AppState>,
    params: MilestoneParams,
) -> Result<AgreementResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(|e| e.to_string())?.clone();
    let mut args = vec!["settlement-milestone".to_string()];
    args.push(format!("--payer={}", params.payer));
    args.push(format!("--payee={}", params.payee));
    args.push(format!("--amount={}", params.amount_sats));
    args.push(format!("--milestone={}", params.milestone_count));
    args.push("--json".to_string());

    let output = run_wallet_cmd(args, wallet_path).await?;
    serde_json::from_str::<AgreementResult>(&output).map_err(|e| format!("Parse error: {} | raw: {}", e, output))
}

#[tauri::command]
async fn settlement_create_deposit(
    state: State<'_, AppState>,
    params: DepositParams,
) -> Result<AgreementResult, String> {
    let wallet_path = state.wallet_path.lock().map_err(|e| e.to_string())?.clone();
    let mut args = vec!["settlement-deposit".to_string()];
    args.push(format!("--depositor={}", params.depositor));
    args.push(format!("--recipient={}", params.recipient));
    args.push(format!("--amount={}", params.amount_sats));
    if let Some(d) = params.deadline_hours { args.push(format!("--deadline={}", d)); }
    args.push("--json".to_string());

    let output = run_wallet_cmd(args, wallet_path).await?;
    serde_json::from_str::<AgreementResult>(&output).map_err(|e| format!("Parse error: {} | raw: {}", e, output))
}

// ============================================================
// MINER
// ============================================================

#[tauri::command]
async fn start_miner(
    state: State<'_, AppState>,
    address: String,
    threads: Option<u32>,
) -> Result<bool, String> {
    let mut miner_lock = state.miner_process.lock().map_err(|e| e.to_string())?;

    if miner_lock.is_some() {
        return Err("Miner is already running".to_string());
    }

    let mut args = vec![format!("--address={}", address)];
    if let Some(t) = threads {
        args.push(format!("--threads={}", t));
    }

    let cmd = Command::new_sidecar("irium-miner")
        .map_err(|e| format!("irium-miner not found: {}", e))?
        .args(&args);

    let (_, child) = cmd.spawn().map_err(|e| e.to_string())?;
    *miner_lock = Some(child);
    Ok(true)
}

#[tauri::command]
async fn stop_miner(state: State<'_, AppState>) -> Result<bool, String> {
    let mut miner_lock = state.miner_process.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = miner_lock.take() {
        child.kill().map_err(|e| e.to_string())?;
        return Ok(true);
    }
    Ok(false)
}

#[tauri::command]
async fn get_miner_status(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let miner_lock = state.miner_process.lock().map_err(|e| e.to_string())?;
    let running = miner_lock.is_some();
    Ok(serde_json::json!({
        "running": running,
        "hashrate_khs": 0,
        "blocks_found": 0,
        "uptime_secs": 0,
        "difficulty": 0,
        "threads": 0,
        "address": null
    }))
}

// ============================================================
// RPC DIRECT CALLS
// ============================================================

#[tauri::command]
async fn rpc_get_peers(state: State<'_, AppState>) -> Result<Vec<PeerInfo>, String> {
    let rpc_url = state.rpc_url.lock().map_err(|e| e.to_string())?.clone();
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{}/peers", rpc_url))
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    resp.json::<Vec<PeerInfo>>().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn rpc_get_mempool(state: State<'_, AppState>) -> Result<MempoolInfo, String> {
    let rpc_url = state.rpc_url.lock().map_err(|e| e.to_string())?.clone();
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{}/mempool", rpc_url))
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    resp.json::<MempoolInfo>().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn rpc_get_block(state: State<'_, AppState>, height_or_hash: String) -> Result<serde_json::Value, String> {
    let rpc_url = state.rpc_url.lock().map_err(|e| e.to_string())?.clone();
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{}/blocks/{}", rpc_url, height_or_hash))
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    resp.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn rpc_get_offers_feed(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let rpc_url = state.rpc_url.lock().map_err(|e| e.to_string())?.clone();
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{}/offers/feed", rpc_url))
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    resp.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn rpc_set_url(state: State<'_, AppState>, url: String) -> Result<bool, String> {
    let mut rpc_url = state.rpc_url.lock().map_err(|e| e.to_string())?;
    *rpc_url = url;
    Ok(true)
}

// ============================================================
// MAIN
// ============================================================

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let tray_menu = SystemTrayMenu::new()
        .add_item(CustomMenuItem::new("show", "Show Irium Core"))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(CustomMenuItem::new("quit", "Quit"));

    let system_tray = SystemTray::new().with_menu(tray_menu);

    tauri::Builder::default()
        .manage(AppState::new())
        .system_tray(system_tray)
        .on_system_tray_event(|app, event| {
            use tauri::{SystemTrayEvent};
            match event {
                SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
                    "show" => {
                        if let Some(window) = app.get_window("main") {
                            window.show().unwrap();
                            window.set_focus().unwrap();
                        }
                    }
                    "quit" => std::process::exit(0),
                    _ => {}
                },
                _ => {}
            }
        })
        .on_window_event(|event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event.event() {
                event.window().hide().unwrap();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            // Node
            start_node,
            stop_node,
            get_node_status,
            // Wallet
            wallet_get_balance,
            wallet_new_address,
            wallet_list_addresses,
            wallet_send,
            wallet_transactions,
            wallet_set_path,
            // Offers
            offer_list,
            offer_show,
            offer_create,
            offer_take,
            offer_export,
            offer_import,
            // Feeds
            feed_add,
            feed_remove,
            feed_list,
            feed_sync,
            feed_fetch,
            feed_prune,
            // Agreements
            agreement_list,
            agreement_show,
            agreement_create,
            agreement_pack,
            agreement_unpack,
            agreement_release,
            agreement_refund,
            // Proofs
            proof_list,
            proof_sign,
            proof_submit,
            // Reputation
            reputation_show,
            // Settlement templates
            settlement_create_otc,
            settlement_create_freelance,
            settlement_create_milestone,
            settlement_create_deposit,
            // Miner
            start_miner,
            stop_miner,
            get_miner_status,
            // RPC
            rpc_get_peers,
            rpc_get_mempool,
            rpc_get_block,
            rpc_get_offers_feed,
            rpc_set_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Irium Core");
}

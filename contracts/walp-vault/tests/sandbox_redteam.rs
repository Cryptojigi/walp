use near_workspaces::types::{AccessKey, AccessKeyPermission, FunctionCallPermission, KeyType, NearToken, SecretKey};
use near_workspaces::{Account, Contract};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Command;

const SEPOLIA_CHAIN_ID: u64 = 11_155_111;
const MAX_TX_WEI: u128 = 50_000_000_000_000_000; // 0.05 ETH
const DAILY_LIMIT_WEI: u128 = 200_000_000_000_000_000; // 0.2 ETH
const THRESHOLD_WEI: u128 = 10_000_000_000_000_000; // 0.01 ETH
const ETH_1: u128 = 1_000_000_000_000_000_000;

fn encode_usize_be(mut v: usize) -> Vec<u8> {
    let mut buf = Vec::new();
    while v > 0 {
        buf.push((v & 0xff) as u8);
        v >>= 8;
    }
    buf.reverse();
    buf
}

fn encode_u128_be(v: u128) -> Vec<u8> {
    if v == 0 {
        return Vec::new();
    }
    let bytes = v.to_be_bytes();
    let idx = bytes.iter().position(|&b| b != 0).unwrap();
    bytes[idx..].to_vec()
}

fn rlp_encode_bytes(data: &[u8]) -> Vec<u8> {
    if data.len() == 1 && data[0] < 0x80 {
        vec![data[0]]
    } else if data.len() <= 55 {
        let mut out = vec![0x80 + data.len() as u8];
        out.extend_from_slice(data);
        out
    } else {
        let len_bytes = encode_usize_be(data.len());
        let mut out = vec![0xb7 + len_bytes.len() as u8];
        out.extend_from_slice(&len_bytes);
        out.extend_from_slice(data);
        out
    }
}

fn rlp_encode_list(items: Vec<Vec<u8>>) -> Vec<u8> {
    let mut payload = Vec::new();
    for item in items {
        payload.extend_from_slice(&item);
    }
    if payload.len() <= 55 {
        let mut out = vec![0xc0 + payload.len() as u8];
        out.extend_from_slice(&payload);
        out
    } else {
        let len_bytes = encode_usize_be(payload.len());
        let mut out = vec![0xf7 + len_bytes.len() as u8];
        out.extend_from_slice(&len_bytes);
        out.extend_from_slice(&payload);
        out
    }
}

fn build_eip1559_hex(chain_id: u64, to_hex: &str, value_wei: u128, data: &[u8]) -> String {
    let to_bytes = hex::decode(to_hex.strip_prefix("0x").unwrap_or(to_hex)).unwrap();
    let list = rlp_encode_list(vec![
        rlp_encode_bytes(&encode_u128_be(chain_id as u128)),
        rlp_encode_bytes(&[]),
        rlp_encode_bytes(&encode_u128_be(1_000_000_000)),
        rlp_encode_bytes(&encode_u128_be(2_000_000_000)),
        rlp_encode_bytes(&encode_u128_be(21_000)),
        rlp_encode_bytes(&to_bytes),
        rlp_encode_bytes(&encode_u128_be(value_wei)),
        rlp_encode_bytes(data),
        rlp_encode_list(vec![]),
    ]);
    let mut raw = vec![0x02];
    raw.extend_from_slice(&list);
    format!("0x{}", hex::encode(raw))
}

fn compile_contracts() -> (Vec<u8>, Vec<u8>, Vec<u8>) {
    let crate_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let workspace_dir = crate_dir.parent().expect("contracts workspace dir");
    let target_dir = workspace_dir.join("target").join("sandbox-wasm");

    // Compile all 3 crates in a separate target-dir to avoid cargo-lock deadlock with `cargo test`.
    let status = Command::new("cargo")
        .args([
            "build",
            "--manifest-path",
            workspace_dir.join("Cargo.toml").to_str().unwrap(),
            "--target",
            "wasm32-unknown-unknown",
            "--release",
            "--target-dir",
            target_dir.to_str().unwrap(),
            "-p",
            "walp-vault",
            "-p",
            "walp-registry",
            "-p",
            "mock-mpc",
        ])
        .env("RUSTFLAGS", "-C link-arg=-s")
        .status()
        .expect("Failed to execute cargo build for wasm32-unknown-unknown");
    assert!(status.success(), "WASM compilation failed");

    let release_dir: PathBuf = target_dir.join("wasm32-unknown-unknown").join("release");
    let vault_wasm = std::fs::read(release_dir.join("walp_vault.wasm")).expect("read walp_vault.wasm");
    let reg_wasm = std::fs::read(release_dir.join("walp_registry.wasm")).expect("read walp_registry.wasm");
    let mpc_wasm = std::fs::read(release_dir.join("mock_mpc.wasm")).expect("read mock_mpc.wasm");
    (vault_wasm, reg_wasm, mpc_wasm)
}

fn extract_nep297_events(logs: &[&str], event_name: &str) -> Vec<Value> {
    logs.iter()
        .filter_map(|line| line.strip_prefix("EVENT_JSON:"))
        .filter_map(|raw| serde_json::from_str::<Value>(raw).ok())
        .filter(|v| v.get("event").and_then(|e| e.as_str()) == Some(event_name))
        .collect()
}

async fn setup_scoped_agent(
    worker: &near_workspaces::Worker<near_workspaces::network::Sandbox>,
    vault_id: &near_workspaces::AccountId,
) -> Account {
    let agent = worker.dev_create_account().await.unwrap();
    let full_pk = agent.secret_key().public_key();
    let scoped_sk = SecretKey::from_random(KeyType::ED25519);
    let scoped_pk = scoped_sk.public_key();

    // Add FunctionCall-only access key restricted strictly to walp-vault::request_intent
    agent
        .batch(agent.id())
        .add_key(
            scoped_pk,
            AccessKey {
                nonce: 0,
                permission: AccessKeyPermission::FunctionCall(FunctionCallPermission {
                    allowance: Some(NearToken::from_near(2)),
                    receiver_id: vault_id.to_string(),
                    method_names: vec!["request_intent".to_string()],
                }),
            },
        )
        .delete_key(full_pk)
        .transact()
        .await
        .unwrap()
        .into_result()
        .unwrap();

    Account::from_secret_key(agent.id().clone(), scoped_sk, worker)
}

#[tokio::test]
async fn sandbox_redteam_vectors_1_through_12() {
    let (vault_wasm, reg_wasm, mpc_wasm) = compile_contracts();
    let worker = near_workspaces::sandbox().await.unwrap();

    let owner = worker.dev_create_account().await.unwrap();
    let mpc_account = worker.dev_create_account().await.unwrap();
    let reg_account = worker.dev_create_account().await.unwrap();
    let vault_account = worker.dev_create_account().await.unwrap();

    let mpc: Contract = mpc_account.deploy(&mpc_wasm).await.unwrap().into_result().unwrap();
    let registry: Contract = reg_account.deploy(&reg_wasm).await.unwrap().into_result().unwrap();
    let vault: Contract = vault_account.deploy(&vault_wasm).await.unwrap().into_result().unwrap();

    registry
        .call("init")
        .args_json(json!({ "owner_id": owner.id() }))
        .transact()
        .await
        .unwrap()
        .into_result()
        .unwrap();

    vault
        .call("init")
        .args_json(json!({
            "owner_id": owner.id(),
            "mpc_contract_id": mpc.id(),
            "max_tx_wei": MAX_TX_WEI.to_string(),
            "daily_limit_wei": DAILY_LIMIT_WEI.to_string(),
            "approval_threshold_wei": THRESHOLD_WEI.to_string(),
            "allowed_chain_ids": [SEPOLIA_CHAIN_ID],
            "registry_contract_id": registry.id(),
            "registry_fail_closed": true,
        }))
        .transact()
        .await
        .unwrap()
        .into_result()
        .unwrap();

    let agent = setup_scoped_agent(&worker, vault.id()).await;
    let keys = agent.view_access_keys().await.unwrap();
    assert_eq!(keys.len(), 1);
    assert!(matches!(
        keys[0].access_key.permission,
        AccessKeyPermission::FunctionCall(_)
    ));

    let clean_dest = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    let local_bad_dest = "0xdead000000000000000000000000000000000001";
    let reg_bad_dest = "0xbad0000000000000000000000000000000000002";

    owner
        .call(vault.id(), "add_denylist")
        .args_json(json!({
            "address": local_bad_dest,
            "reason": "Known drainer contract"
        }))
        .transact()
        .await
        .unwrap()
        .into_result()
        .unwrap();

    owner
        .call(registry.id(), "report_address")
        .args_json(json!({
            "address": reg_bad_dest,
            "category": "EXPLOIT",
            "reason": "Shared threat feed block",
            "evidence_hash": "sha256:redteam"
        }))
        .transact()
        .await
        .unwrap()
        .into_result()
        .unwrap();

    // Vector 1: Over Max Tx with spoofed summary -> WALP_EXCEEDS_MAX_TX + NEP-297 Denied log
    let v1_tx = build_eip1559_hex(SEPOLIA_CHAIN_ID, clean_dest, 5 * ETH_1, &[]);
    let v1_out = agent
        .call(vault.id(), "request_intent")
        .args_json(json!({
            "raw_tx_hex": v1_tx,
            "path": "ethereum-1",
            "intent_summary": "Send 0.0001 ETH"
        }))
        .gas(near_workspaces::types::Gas::from_tgas(200))
        .transact()
        .await
        .unwrap();
    let v1_logs = v1_out.logs();
    let v1_denied = extract_nep297_events(&v1_logs, "Denied");
    assert!(!v1_denied.is_empty(), "Vector 1 must emit Denied event");
    assert_eq!(v1_denied[0]["data"][0]["reason_code"], "WALP_EXCEEDS_MAX_TX");
    let v1_err = format!("{:?}", v1_out.into_result().unwrap_err());
    assert!(v1_err.contains("WALP_EXCEEDS_MAX_TX"), "Unexpected error: {}", v1_err);

    // Vector 2: Denylisted Target -> WALP_TARGET_DENYLISTED
    let v2_tx = build_eip1559_hex(SEPOLIA_CHAIN_ID, local_bad_dest, 100_000_000_000_000, &[]);
    let v2_out = agent
        .call(vault.id(), "request_intent")
        .args_json(json!({ "raw_tx_hex": v2_tx }))
        .gas(near_workspaces::types::Gas::from_tgas(200))
        .transact()
        .await
        .unwrap();
    let v2_denied = extract_nep297_events(&v2_out.logs(), "Denied");
    assert_eq!(v2_denied[0]["data"][0]["reason_code"], "WALP_TARGET_DENYLISTED");
    let v2_err = format!("{:?}", v2_out.into_result().unwrap_err());
    assert!(v2_err.contains("WALP_TARGET_DENYLISTED"), "{}", v2_err);

    // Vector 3: Blocked ERC-20 unlimited approve -> WALP_CALLDATA_BLOCKED
    let mut approve_data = vec![0x09, 0x5e, 0xa7, 0xb3];
    approve_data.extend_from_slice(&[0u8; 12]);
    approve_data.extend_from_slice(&[0xaa; 20]);
    approve_data.extend_from_slice(&[0xff; 32]);
    let v3_tx = build_eip1559_hex(
        SEPOLIA_CHAIN_ID,
        "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
        0,
        &approve_data,
    );
    let v3_out = agent
        .call(vault.id(), "request_intent")
        .args_json(json!({ "raw_tx_hex": v3_tx }))
        .gas(near_workspaces::types::Gas::from_tgas(200))
        .transact()
        .await
        .unwrap();
    let v3_err = format!("{:?}", v3_out.into_result().unwrap_err());
    assert!(v3_err.contains("WALP_CALLDATA_BLOCKED"), "{}", v3_err);

    // Vector 4: Wrong chain_id=1 -> WALP_UNSUPPORTED_CHAIN
    let v4_tx = build_eip1559_hex(1, clean_dest, 100_000_000_000_000, &[]);
    let v4_out = agent
        .call(vault.id(), "request_intent")
        .args_json(json!({ "raw_tx_hex": v4_tx }))
        .gas(near_workspaces::types::Gas::from_tgas(200))
        .transact()
        .await
        .unwrap();
    let v4_err = format!("{:?}", v4_out.into_result().unwrap_err());
    assert!(v4_err.contains("WALP_UNSUPPORTED_CHAIN"), "{}", v4_err);

    // Vector 5: Protocol Key Escalation (agent scoped key tries set_policy / toggle_pause)
    let v5_res = agent
        .call(vault.id(), "set_policy")
        .args_json(json!({
            "max_tx_wei": (100 * ETH_1).to_string(),
            "daily_limit_wei": (100 * ETH_1).to_string(),
            "approval_threshold_wei": (100 * ETH_1).to_string(),
            "allowed_chain_ids": [1, SEPOLIA_CHAIN_ID]
        }))
        .transact()
        .await;
    let v5_err = format!("{:?}", v5_res.unwrap_err());
    assert!(
        v5_err.contains("MethodNameMismatch") || v5_err.contains("allowed method"),
        "Expected access key MethodNameMismatch rejection, got: {}",
        v5_err
    );

    // Vector 6: Safe Threshold Escalation (0.025 ETH > 0.01 threshold) -> PENDING_APPROVAL
    let v6_tx = build_eip1559_hex(SEPOLIA_CHAIN_ID, clean_dest, 25_000_000_000_000_000, &[]);
    let v6_out = agent
        .call(vault.id(), "request_intent")
        .args_json(json!({ "raw_tx_hex": v6_tx, "path": "ethereum-1" }))
        .gas(near_workspaces::types::Gas::from_tgas(250))
        .transact()
        .await
        .unwrap()
        .into_result()
        .unwrap();
    let v6_proposed = extract_nep297_events(&v6_out.logs(), "IntentProposed");
    assert_eq!(v6_proposed.len(), 1);
    assert_eq!(v6_proposed[0]["data"][0]["reason_code"], "WALP_THRESHOLD_ESCALATED");
    let v6_val: Value = v6_out.json().unwrap();
    assert_eq!(v6_val["status"], "PENDING_APPROVAL");
    let intent_id = v6_val["intent_id"].as_str().unwrap().to_string();

    // Vector 7: Owner approve_intent -> registry check -> mock MPC signature -> IntentSigned
    let v7_out = owner
        .call(vault.id(), "approve_intent")
        .args_json(json!({ "intent_id": intent_id }))
        .gas(near_workspaces::types::Gas::from_tgas(300))
        .transact()
        .await
        .unwrap()
        .into_result()
        .unwrap();
    let v7_logs = v7_out.logs();
    assert_eq!(extract_nep297_events(&v7_logs, "IntentApproved").len(), 1);
    let v7_signed = extract_nep297_events(&v7_logs, "IntentSigned");
    assert_eq!(v7_signed.len(), 1);
    let v7_val: Value = v7_out.json().unwrap();
    assert_eq!(v7_val["status"], "SIGNED");
    assert!(v7_val["signature"]["big_r"].as_str().unwrap().starts_with("03"));

    let policy_after_v7: Value = vault.view("get_policy").await.unwrap().json().unwrap();
    assert_eq!(policy_after_v7["spent_today_wei"], "25000000000000000");

    // Vector 8: Shared walp-registry async block + spent_today_wei rollback
    let v8_tx = build_eip1559_hex(SEPOLIA_CHAIN_ID, reg_bad_dest, 100_000_000_000_000, &[]);
    let v8_out = agent
        .call(vault.id(), "request_intent")
        .args_json(json!({ "raw_tx_hex": v8_tx }))
        .gas(near_workspaces::types::Gas::from_tgas(300))
        .transact()
        .await
        .unwrap()
        .into_result()
        .unwrap();
    let v8_denied = extract_nep297_events(&v8_out.logs(), "Denied");
    assert_eq!(v8_denied[0]["data"][0]["reason_code"], "WALP_REGISTRY_DENYLISTED");
    let v8_val: Value = v8_out.json().unwrap();
    assert_eq!(v8_val["status"], "DENIED");

    let policy_after_v8: Value = vault.view("get_policy").await.unwrap().json().unwrap();
    assert_eq!(policy_after_v8["spent_today_wei"], "25000000000000000");

    // Vector 9: Mock MPC sign failure + spent_today_wei rollback
    mpc.call("set_fail_next")
        .args_json(json!({ "fail": true }))
        .transact()
        .await
        .unwrap()
        .into_result()
        .unwrap();
    let v9_tx = build_eip1559_hex(SEPOLIA_CHAIN_ID, clean_dest, 100_000_000_000_000, &[]);
    let v9_out = agent
        .call(vault.id(), "request_intent")
        .args_json(json!({ "raw_tx_hex": v9_tx }))
        .gas(near_workspaces::types::Gas::from_tgas(300))
        .transact()
        .await
        .unwrap()
        .into_result()
        .unwrap();
    let v9_denied = extract_nep297_events(&v9_out.logs(), "Denied");
    assert_eq!(v9_denied[0]["data"][0]["reason_code"], "WALP_MPC_SIGN_FAILED");
    let v9_val: Value = v9_out.json().unwrap();
    assert_eq!(v9_val["status"], "FAILED");

    let policy_after_v9: Value = vault.view("get_policy").await.unwrap().json().unwrap();
    assert_eq!(policy_after_v9["spent_today_wei"], "25000000000000000");

    // Reset fail_next explicitly (NEAR rolls back state mutations inside panicking mock-mpc::sign)
    mpc.call("set_fail_next")
        .args_json(json!({ "fail": false }))
        .transact()
        .await
        .unwrap()
        .into_result()
        .unwrap();

    // Vector 10: Zero-Full-Access-Key FunctionCall agent key cannot attach deposit > 0 (DepositWithFunctionCall)
    let v10_res = agent
        .call(vault.id(), "request_intent")
        .args_json(json!({ "raw_tx_hex": v9_tx }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(near_workspaces::types::Gas::from_tgas(200))
        .transact()
        .await;
    let v10_err = format!("{:?}", v10_res.unwrap_err());
    assert!(
        v10_err.contains("DepositWithFunctionCall") || v10_err.contains("deposit"),
        "Expected DepositWithFunctionCall protocol rejection, got: {}",
        v10_err
    );

    // Vector 11: Unlisted contract call (ERC-20 transfer 0xa9059cbb) escalates -> allowlist unlocks autonomous signing
    let token_addr = "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238";
    let mut transfer_data = vec![0xa9, 0x05, 0x9c, 0xbb];
    transfer_data.extend_from_slice(&[0u8; 31]);
    transfer_data.push(0x42);
    transfer_data.extend_from_slice(&[0u8; 31]);
    transfer_data.push(0x01);
    let v11_tx = build_eip1559_hex(SEPOLIA_CHAIN_ID, token_addr, 0, &transfer_data);

    let v11_out = agent
        .call(vault.id(), "request_intent")
        .args_json(json!({ "raw_tx_hex": v11_tx }))
        .gas(near_workspaces::types::Gas::from_tgas(250))
        .transact()
        .await
        .unwrap()
        .into_result()
        .unwrap();
    let v11_val: Value = v11_out.json().unwrap();
    assert_eq!(v11_val["status"], "PENDING_APPROVAL");
    assert_eq!(v11_val["reason_code"], "WALP_UNLISTED_CONTRACT_CALL");

    owner
        .call(vault.id(), "add_allowlist")
        .args_json(json!({ "address": token_addr, "label": "Sepolia Token" }))
        .transact()
        .await
        .unwrap()
        .into_result()
        .unwrap();

    let v11_auto = agent
        .call(vault.id(), "request_intent")
        .args_json(json!({ "raw_tx_hex": v11_tx }))
        .gas(near_workspaces::types::Gas::from_tgas(300))
        .transact()
        .await
        .unwrap()
        .into_result()
        .unwrap();
    let v11_auto_val: Value = v11_auto.json().unwrap();
    assert_eq!(v11_auto_val["status"], "SIGNED");

    // Vector 12: Emergency pause blocks request_intent with WALP_PAUSED until unpaused
    owner
        .call(vault.id(), "toggle_pause")
        .args_json(json!({ "paused": true, "note": "Sandbox red-team pause" }))
        .transact()
        .await
        .unwrap()
        .into_result()
        .unwrap();

    let v12_res = agent
        .call(vault.id(), "request_intent")
        .args_json(json!({ "raw_tx_hex": v9_tx }))
        .gas(near_workspaces::types::Gas::from_tgas(200))
        .transact()
        .await
        .unwrap();
    assert!(v12_res.is_failure());
    let v12_msg = format!("{:?}", v12_res.failures());
    assert!(v12_msg.contains("WALP_PAUSED"), "Expected WALP_PAUSED, got: {}", v12_msg);
}

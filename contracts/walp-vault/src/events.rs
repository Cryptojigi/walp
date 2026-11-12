use near_sdk::{env, AccountId};
use serde::{Deserialize, Serialize};

pub const STANDARD_NAME: &str = "walp_vault";
pub const STANDARD_VERSION: &str = "1.0.0";

pub const WALP_PAUSED: &str = "WALP_PAUSED";
pub const WALP_RLP_INVALID: &str = "WALP_RLP_INVALID";
pub const WALP_UNSUPPORTED_CHAIN: &str = "WALP_UNSUPPORTED_CHAIN";
pub const WALP_TARGET_DENYLISTED: &str = "WALP_TARGET_DENYLISTED";
pub const WALP_REGISTRY_DENYLISTED: &str = "WALP_REGISTRY_DENYLISTED";
pub const WALP_CALLDATA_BLOCKED: &str = "WALP_CALLDATA_BLOCKED";
pub const WALP_EXCEEDS_MAX_TX: &str = "WALP_EXCEEDS_MAX_TX";
pub const WALP_EXCEEDS_DAILY_LIMIT: &str = "WALP_EXCEEDS_DAILY_LIMIT";
pub const WALP_THRESHOLD_ESCALATED: &str = "WALP_THRESHOLD_ESCALATED";
pub const WALP_UNLISTED_CONTRACT_CALL: &str = "WALP_UNLISTED_CONTRACT_CALL";
pub const WALP_WITHIN_AUTONOMOUS_POLICY: &str = "WALP_WITHIN_AUTONOMOUS_POLICY";
pub const WALP_OWNER_APPROVED: &str = "WALP_OWNER_APPROVED";
pub const WALP_OWNER_REJECTED: &str = "WALP_OWNER_REJECTED";
pub const WALP_MPC_SIGN_FAILED: &str = "WALP_MPC_SIGN_FAILED";
pub const WALP_UNAUTHORIZED_OWNER_ONLY: &str = "WALP_UNAUTHORIZED_OWNER_ONLY";
pub const WALP_INTENT_NOT_FOUND: &str = "WALP_INTENT_NOT_FOUND";
pub const WALP_INVALID_INTENT_STATE: &str = "WALP_INVALID_INTENT_STATE";
pub const WALP_INSUFFICIENT_GAS: &str = "WALP_INSUFFICIENT_GAS";

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct Nep297Event<T> {
    pub standard: String,
    pub version: String,
    pub event: String,
    pub data: Vec<T>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct IntentProposedData {
    pub intent_id: String,
    pub proposer: AccountId,
    pub chain_id: u64,
    pub to: String,
    pub value_wei: String,
    pub sighash_hex: String,
    pub calldata_selector: String,
    pub requires_approval: bool,
    pub reason_code: String,
    pub path: String,
    pub timestamp_ns: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct IntentApprovedData {
    pub intent_id: String,
    pub approver: AccountId,
    pub chain_id: u64,
    pub to: String,
    pub value_wei: String,
    pub reason_code: String,
    pub timestamp_ns: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct IntentRejectedData {
    pub intent_id: String,
    pub actor: AccountId,
    pub to: String,
    pub value_wei: String,
    pub reason_code: String,
    pub note: String,
    pub timestamp_ns: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct IntentSignedData {
    pub intent_id: String,
    pub chain_id: u64,
    pub to: String,
    pub value_wei: String,
    pub sighash_hex: String,
    pub big_r: String,
    pub s: String,
    pub recovery_id: u8,
    pub spent_today_wei: String,
    pub timestamp_ns: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct PolicyUpdatedData {
    pub actor: AccountId,
    pub action: String,
    pub paused: bool,
    pub max_tx_wei: String,
    pub daily_limit_wei: String,
    pub approval_threshold_wei: String,
    pub allowed_chain_ids: Vec<u64>,
    pub registry_contract_id: Option<AccountId>,
    pub target_address: Option<String>,
    pub note: Option<String>,
    pub timestamp_ns: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct DeniedData {
    pub intent_id: String,
    pub proposer: AccountId,
    pub chain_id: u64,
    pub to: String,
    pub value_wei: String,
    pub reason_code: String,
    pub detail: String,
    pub timestamp_ns: String,
}

fn emit_event<T: Serialize>(event: &str, payload: T) {
    let envelope = Nep297Event {
        standard: STANDARD_NAME.to_string(),
        version: STANDARD_VERSION.to_string(),
        event: event.to_string(),
        data: vec![payload],
    };
    if let Ok(json) = serde_json::to_string(&envelope) {
        env::log_str(&format!("EVENT_JSON:{}", json));
    }
}

pub fn emit_intent_proposed(data: IntentProposedData) {
    emit_event("IntentProposed", data);
}

pub fn emit_intent_approved(data: IntentApprovedData) {
    emit_event("IntentApproved", data);
}

pub fn emit_intent_rejected(data: IntentRejectedData) {
    emit_event("IntentRejected", data);
}

pub fn emit_intent_signed(data: IntentSignedData) {
    emit_event("IntentSigned", data);
}

pub fn emit_policy_updated(data: PolicyUpdatedData) {
    emit_event("PolicyUpdated", data);
}

pub fn emit_denied(data: DeniedData) {
    emit_event("Denied", data);
}

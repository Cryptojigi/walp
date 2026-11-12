pub mod events;
pub mod rlp;

use crate::events::{
    emit_denied, emit_intent_approved, emit_intent_proposed, emit_intent_rejected,
    emit_intent_signed, emit_policy_updated, DeniedData, IntentApprovedData, IntentProposedData,
    IntentRejectedData, IntentSignedData, PolicyUpdatedData, WALP_CALLDATA_BLOCKED,
    WALP_EXCEEDS_DAILY_LIMIT, WALP_EXCEEDS_MAX_TX, WALP_INSUFFICIENT_GAS, WALP_INTENT_NOT_FOUND,
    WALP_INVALID_INTENT_STATE, WALP_MPC_SIGN_FAILED, WALP_OWNER_APPROVED, WALP_OWNER_REJECTED,
    WALP_PAUSED, WALP_REGISTRY_DENYLISTED, WALP_RLP_INVALID, WALP_TARGET_DENYLISTED,
    WALP_THRESHOLD_ESCALATED, WALP_UNAUTHORIZED_OWNER_ONLY, WALP_UNLISTED_CONTRACT_CALL,
    WALP_UNSUPPORTED_CHAIN, WALP_WITHIN_AUTONOMOUS_POLICY,
};
use crate::rlp::{
    decode_eip1559_unsigned, decode_hex, encode_hex_lower, inspect_calldata, normalize_evm_address,
    RlpDecodeError,
};
use near_sdk::json_types::{U128, U64};
use near_sdk::store::{IterableMap, Vector};
use near_sdk::{
    env, ext_contract, near, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault,
    Promise, PromiseError, PromiseOrValue,
};
use serde::{Deserialize, Serialize};

pub const ONE_DAY_NS: u64 = 86_400_000_000_000;
const GAS_REGISTRY_CHECK: Gas = Gas::from_tgas(10);
const GAS_MPC_SIGN_MIN: Gas = Gas::from_tgas(20);
const GAS_MPC_CALLBACK: Gas = Gas::from_tgas(25);
const MIN_PREPAID_GAS_REGISTRY_ESCALATE: Gas = Gas::from_tgas(30);
const MIN_PREPAID_GAS_MPC: Gas = Gas::from_tgas(75);
const MIN_PREPAID_GAS_MPC_WITH_REGISTRY: Gas = Gas::from_tgas(95);

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Allowlist,
    Denylist,
    Intents,
    IntentOrder,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum IntentStatus {
    CheckingRegistry,
    PendingApproval,
    ApprovedSigning,
    Signed,
    Rejected,
    Denied,
    Failed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AllowlistEntry {
    pub address: String,
    pub label: String,
    pub added_at_ns: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DenylistEntry {
    pub address: String,
    pub reason: String,
    pub reporter: AccountId,
    pub evidence_hash: String,
    pub added_at_ns: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MpcSignatureResult {
    pub big_r: String,
    pub s: String,
    pub recovery_id: u8,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IntentRecord {
    pub intent_id: String,
    pub proposer: AccountId,
    pub chain_id: u64,
    pub to: String,
    pub value_wei: U128,
    pub sighash_hex: String,
    pub calldata_selector: String,
    pub path: String,
    pub intent_summary: String,
    pub requires_approval: bool,
    pub reason_code: String,
    pub status: IntentStatus,
    pub created_at_ns: U64,
    pub updated_at_ns: U64,
    pub reserved_day_reset_ns: Option<u64>,
    pub signature: Option<MpcSignatureResult>,
    pub detail: Option<String>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IntentActionResponse {
    pub intent_id: String,
    pub status: IntentStatus,
    pub requires_approval: bool,
    pub reason_code: String,
    pub chain_id: u64,
    pub to: String,
    pub value_wei: U128,
    pub sighash_hex: String,
    pub calldata_selector: String,
    pub path: String,
    pub signature: Option<MpcSignatureResult>,
    pub detail: Option<String>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PolicyView {
    pub owner_id: AccountId,
    pub mpc_contract_id: AccountId,
    pub registry_contract_id: Option<AccountId>,
    pub registry_fail_closed: bool,
    pub paused: bool,
    pub max_tx_wei: U128,
    pub daily_limit_wei: U128,
    pub spent_today_wei: U128,
    pub last_reset_ns: U64,
    pub approval_threshold_wei: U128,
    pub allowed_chain_ids: Vec<u64>,
    pub blocked_selectors: Vec<String>,
    pub next_intent_seq: u64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PolicySimulationResult {
    pub allowed: bool,
    pub requires_approval: bool,
    pub reason_code: String,
    pub detail: String,
    pub chain_id: Option<u64>,
    pub to: Option<String>,
    pub value_wei: Option<U128>,
    pub sighash_hex: Option<String>,
    pub calldata_selector: Option<String>,
    pub check_registry: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RegistryEntryView {
    pub address: String,
    pub category: String,
    pub reason: String,
    pub evidence_hash: String,
    pub reporter: AccountId,
    pub added_at_ns: U64,
    pub active: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RegistryCheckResponse {
    pub blocked: bool,
    pub entry: Option<RegistryEntryView>,
}

#[derive(Serialize)]
pub struct MpcPayloadV2 {
    #[serde(rename = "Ecdsa")]
    pub ecdsa: String,
}

#[derive(Serialize)]
pub struct MpcSignRequest {
    pub payload_v2: MpcPayloadV2,
    pub path: String,
    pub domain_id: u64,
}

#[derive(Serialize)]
pub struct MpcSignArgs {
    pub request: MpcSignRequest,
}

#[derive(Deserialize, Debug, Clone)]
pub struct MpcAffinePoint {
    pub affine_point: String,
}

#[derive(Deserialize, Debug, Clone)]
pub struct MpcScalarValue {
    pub scalar: String,
}

#[derive(Deserialize, Debug, Clone)]
pub struct MpcSignResponse {
    pub big_r: MpcAffinePoint,
    pub s: MpcScalarValue,
    pub recovery_id: u8,
}

#[ext_contract(ext_registry)]
pub trait RegistryContract {
    fn check_address(&self, address: String) -> RegistryCheckResponse;
}

#[ext_contract(ext_mpc)]
pub trait MpcContract {
    fn sign(&mut self, request: MpcSignRequest) -> MpcSignResponse;
}

fn default_blocked_selectors() -> Vec<String> {
    vec![
        "0xf2fde38b".to_string(), // transferOwnership(address)
        "0x3659cfe6".to_string(), // upgradeTo(address)
        "0x4f1ef286".to_string(), // upgradeToAndCall(address,bytes)
    ]
}

#[derive(Clone, Copy)]
struct DenyContext<'a> {
    intent_id: &'a str,
    proposer: &'a AccountId,
    chain_id: u64,
    to: &'a str,
    value_wei: u128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct WalpVault {
    owner_id: AccountId,
    mpc_contract_id: AccountId,
    registry_contract_id: Option<AccountId>,
    registry_fail_closed: bool,
    paused: bool,
    max_tx_wei: u128,
    daily_limit_wei: u128,
    spent_today_wei: u128,
    last_reset_ns: u64,
    approval_threshold_wei: u128,
    allowed_chain_ids: Vec<u64>,
    blocked_selectors: Vec<String>,
    allowlist: IterableMap<String, AllowlistEntry>,
    denylist: IterableMap<String, DenylistEntry>,
    intents: IterableMap<String, IntentRecord>,
    intent_order: Vector<String>,
    next_intent_seq: u64,
}

#[near]
impl WalpVault {
    #[init]
    #[allow(clippy::too_many_arguments)]
    pub fn init(
        owner_id: AccountId,
        mpc_contract_id: AccountId,
        max_tx_wei: U128,
        daily_limit_wei: U128,
        approval_threshold_wei: U128,
        allowed_chain_ids: Vec<u64>,
        registry_contract_id: Option<AccountId>,
        registry_fail_closed: Option<bool>,
    ) -> Self {
        let now = env::block_timestamp();
        let vault = Self {
            owner_id: owner_id.clone(),
            mpc_contract_id,
            registry_contract_id,
            registry_fail_closed: registry_fail_closed.unwrap_or(true),
            paused: false,
            max_tx_wei: max_tx_wei.0,
            daily_limit_wei: daily_limit_wei.0,
            spent_today_wei: 0,
            last_reset_ns: now,
            approval_threshold_wei: approval_threshold_wei.0,
            allowed_chain_ids,
            blocked_selectors: default_blocked_selectors(),
            allowlist: IterableMap::new(StorageKey::Allowlist),
            denylist: IterableMap::new(StorageKey::Denylist),
            intents: IterableMap::new(StorageKey::Intents),
            intent_order: Vector::new(StorageKey::IntentOrder),
            next_intent_seq: 1,
        };
        vault.emit_policy_event(&owner_id, "INIT", None, None);
        vault
    }

    fn assert_owner(&self) {
        if env::predecessor_account_id() != self.owner_id {
            env::panic_str(WALP_UNAUTHORIZED_OWNER_ONLY);
        }
    }

    fn maybe_reset_daily_window(&mut self) {
        let now = env::block_timestamp();
        if now >= self.last_reset_ns.saturating_add(ONE_DAY_NS) {
            self.spent_today_wei = 0;
            self.last_reset_ns = now;
        }
    }

    fn effective_spent_today(&self) -> u128 {
        let now = env::block_timestamp();
        if now >= self.last_reset_ns.saturating_add(ONE_DAY_NS) {
            0
        } else {
            self.spent_today_wei
        }
    }

    fn emit_policy_event(
        &self,
        actor: &AccountId,
        action: &str,
        target_address: Option<String>,
        note: Option<String>,
    ) {
        emit_policy_updated(PolicyUpdatedData {
            actor: actor.clone(),
            action: action.to_string(),
            paused: self.paused,
            max_tx_wei: self.max_tx_wei.to_string(),
            daily_limit_wei: self.daily_limit_wei.to_string(),
            approval_threshold_wei: self.approval_threshold_wei.to_string(),
            allowed_chain_ids: self.allowed_chain_ids.clone(),
            registry_contract_id: self.registry_contract_id.clone(),
            target_address,
            note,
            timestamp_ns: env::block_timestamp().to_string(),
        });
    }

    fn deny_and_panic(&self, ctx: DenyContext<'_>, reason_code: &str, detail: String) -> ! {
        emit_denied(DeniedData {
            intent_id: ctx.intent_id.to_string(),
            proposer: ctx.proposer.clone(),
            chain_id: ctx.chain_id,
            to: ctx.to.to_string(),
            value_wei: ctx.value_wei.to_string(),
            reason_code: reason_code.to_string(),
            detail: detail.clone(),
            timestamp_ns: env::block_timestamp().to_string(),
        });
        env::panic_str(&format!("{}: {}", reason_code, detail));
    }

    fn rollback_reserved_spend(&mut self, intent: &mut IntentRecord) {
        if let Some(reserved_reset_ns) = intent.reserved_day_reset_ns.take() {
            if self.last_reset_ns == reserved_reset_ns {
                self.spent_today_wei = self.spent_today_wei.saturating_sub(intent.value_wei.0);
            }
        }
    }

    fn to_action_response(record: &IntentRecord) -> IntentActionResponse {
        IntentActionResponse {
            intent_id: record.intent_id.clone(),
            status: record.status.clone(),
            requires_approval: record.requires_approval,
            reason_code: record.reason_code.clone(),
            chain_id: record.chain_id,
            to: record.to.clone(),
            value_wei: record.value_wei,
            sighash_hex: record.sighash_hex.clone(),
            calldata_selector: record.calldata_selector.clone(),
            path: record.path.clone(),
            signature: record.signature.clone(),
            detail: record.detail.clone(),
        }
    }

    fn call_mpc_sign(&self, intent_id: String, sighash_hex: String, path: String) -> Promise {
        let request = MpcSignRequest {
            payload_v2: MpcPayloadV2 { ecdsa: sighash_hex },
            path,
            domain_id: 0,
        };
        ext_mpc::ext(self.mpc_contract_id.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_MPC_SIGN_MIN)
            .with_unused_gas_weight(1)
            .sign(request)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_MPC_CALLBACK)
                    .with_unused_gas_weight(0)
                    .on_mpc_sign(intent_id),
            )
    }

    fn call_registry_check(&self, intent_id: String, to: String, from_owner_approval: bool) -> Promise {
        let reg_id = self
            .registry_contract_id
            .clone()
            .expect("registry_contract_id must be set");
        ext_registry::ext(reg_id)
            .with_static_gas(GAS_REGISTRY_CHECK)
            .with_unused_gas_weight(0)
            .check_address(to)
            .then(
                Self::ext(env::current_account_id())
                    .with_unused_gas_weight(1)
                    .on_registry_checked(intent_id, from_owner_approval),
            )
    }

    #[payable]
    pub fn request_intent(
        &mut self,
        raw_tx_hex: String,
        path: Option<String>,
        intent_summary: Option<String>,
    ) -> PromiseOrValue<IntentActionResponse> {
        let proposer = env::predecessor_account_id();
        let intent_id = format!("intent_{}", self.next_intent_seq);
        let zero_addr = "0x0000000000000000000000000000000000000000";
        let pre_ctx = DenyContext {
            intent_id: &intent_id,
            proposer: &proposer,
            chain_id: 0,
            to: zero_addr,
            value_wei: 0,
        };

        if self.paused {
            self.deny_and_panic(
                pre_ctx,
                WALP_PAUSED,
                "Vault emergency pause is active".to_string(),
            );
        }

        let clean_path = path
            .unwrap_or_else(|| "ethereum-1".to_string())
            .trim()
            .to_string();
        if clean_path.is_empty() || clean_path.len() > 128 {
            self.deny_and_panic(
                pre_ctx,
                WALP_RLP_INVALID,
                "Derivation path must be 1..128 characters".to_string(),
            );
        }

        let raw_tx_bytes = match decode_hex(&raw_tx_hex) {
            Ok(bytes) => bytes,
            Err(err) => {
                self.deny_and_panic(pre_ctx, WALP_RLP_INVALID, err.to_string());
            }
        };

        let decoded = match decode_eip1559_unsigned(&raw_tx_bytes) {
            Ok(tx) => tx,
            Err(RlpDecodeError::ValueExceedsU128) => {
                self.deny_and_panic(
                    DenyContext {
                        value_wei: u128::MAX,
                        ..pre_ctx
                    },
                    WALP_EXCEEDS_MAX_TX,
                    format!("Decoded value exceeds u128::MAX > max_tx_wei {}", self.max_tx_wei),
                );
            }
            Err(err) => {
                self.deny_and_panic(pre_ctx, WALP_RLP_INVALID, err.to_string());
            }
        };

        let deny_ctx = DenyContext {
            intent_id: &intent_id,
            proposer: &proposer,
            chain_id: decoded.chain_id,
            to: &decoded.to,
            value_wei: decoded.value_wei,
        };

        if !self.allowed_chain_ids.contains(&decoded.chain_id) {
            self.deny_and_panic(
                deny_ctx,
                WALP_UNSUPPORTED_CHAIN,
                format!(
                    "Decoded chain_id {} not in allowed_chain_ids {:?}",
                    decoded.chain_id, self.allowed_chain_ids
                ),
            );
        }

        if let Some(deny) = self.denylist.get(&decoded.to) {
            self.deny_and_panic(
                deny_ctx,
                WALP_TARGET_DENYLISTED,
                format!("Recipient {} denylisted: {}", decoded.to, deny.reason),
            );
        }

        if let Err(err) = inspect_calldata(&decoded.data, &self.blocked_selectors) {
            self.deny_and_panic(deny_ctx, WALP_CALLDATA_BLOCKED, err);
        }

        if decoded.value_wei > self.max_tx_wei {
            self.deny_and_panic(
                deny_ctx,
                WALP_EXCEEDS_MAX_TX,
                format!(
                    "Decoded value {} > max_tx_wei {}",
                    decoded.value_wei, self.max_tx_wei
                ),
            );
        }

        self.maybe_reset_daily_window();
        let next_spent = self.spent_today_wei.checked_add(decoded.value_wei);
        if next_spent.is_none_or(|sum| sum > self.daily_limit_wei) {
            self.deny_and_panic(
                deny_ctx,
                WALP_EXCEEDS_DAILY_LIMIT,
                format!(
                    "spent_today_wei {} + value {} > daily_limit_wei {}",
                    self.spent_today_wei, decoded.value_wei, self.daily_limit_wei
                ),
            );
        }

        let sighash = env::keccak256(&raw_tx_bytes);
        let sighash_hex = encode_hex_lower(&sighash);

        let (requires_approval, reason_code) = if decoded.value_wei > self.approval_threshold_wei {
            (true, WALP_THRESHOLD_ESCALATED.to_string())
        } else if !decoded.data.is_empty() && !self.allowlist.contains_key(&decoded.to) {
            (true, WALP_UNLISTED_CONTRACT_CALL.to_string())
        } else {
            (false, WALP_WITHIN_AUTONOMOUS_POLICY.to_string())
        };

        let required_gas = match (self.registry_contract_id.is_some(), requires_approval) {
            (true, true) => MIN_PREPAID_GAS_REGISTRY_ESCALATE,
            (true, false) => MIN_PREPAID_GAS_MPC_WITH_REGISTRY,
            (false, false) => MIN_PREPAID_GAS_MPC,
            (false, true) => Gas::from_gas(0),
        };
        if env::prepaid_gas() < required_gas {
            self.deny_and_panic(
                deny_ctx,
                WALP_INSUFFICIENT_GAS,
                format!(
                    "Prepaid gas {} TGas < required {} TGas for async execution",
                    env::prepaid_gas().as_tgas(),
                    required_gas.as_tgas()
                ),
            );
        }

        self.next_intent_seq += 1;
        let now = env::block_timestamp();
        let summary = intent_summary.unwrap_or_default();

        if self.registry_contract_id.is_some() {
            let reserved_reset_ns = if !requires_approval {
                self.spent_today_wei += decoded.value_wei;
                Some(self.last_reset_ns)
            } else {
                None
            };

            let record = IntentRecord {
                intent_id: intent_id.clone(),
                proposer,
                chain_id: decoded.chain_id,
                to: decoded.to.clone(),
                value_wei: U128(decoded.value_wei),
                sighash_hex,
                calldata_selector: decoded.calldata_selector,
                path: clean_path,
                intent_summary: summary,
                requires_approval,
                reason_code,
                status: IntentStatus::CheckingRegistry,
                created_at_ns: U64(now),
                updated_at_ns: U64(now),
                reserved_day_reset_ns: reserved_reset_ns,
                signature: None,
                detail: None,
            };
            self.intents.insert(intent_id.clone(), record);
            self.intent_order.push(intent_id.clone());

            return PromiseOrValue::Promise(self.call_registry_check(intent_id, decoded.to, false));
        }

        if requires_approval {
            let record = IntentRecord {
                intent_id: intent_id.clone(),
                proposer: proposer.clone(),
                chain_id: decoded.chain_id,
                to: decoded.to.clone(),
                value_wei: U128(decoded.value_wei),
                sighash_hex: sighash_hex.clone(),
                calldata_selector: decoded.calldata_selector.clone(),
                path: clean_path.clone(),
                intent_summary: summary,
                requires_approval: true,
                reason_code: reason_code.clone(),
                status: IntentStatus::PendingApproval,
                created_at_ns: U64(now),
                updated_at_ns: U64(now),
                reserved_day_reset_ns: None,
                signature: None,
                detail: None,
            };
            let resp = Self::to_action_response(&record);
            self.intents.insert(intent_id.clone(), record);
            self.intent_order.push(intent_id.clone());

            emit_intent_proposed(IntentProposedData {
                intent_id,
                proposer,
                chain_id: decoded.chain_id,
                to: decoded.to,
                value_wei: decoded.value_wei.to_string(),
                sighash_hex,
                calldata_selector: decoded.calldata_selector,
                requires_approval: true,
                reason_code,
                path: clean_path,
                timestamp_ns: now.to_string(),
            });

            return PromiseOrValue::Value(resp);
        }

        self.spent_today_wei += decoded.value_wei;
        let record = IntentRecord {
            intent_id: intent_id.clone(),
            proposer: proposer.clone(),
            chain_id: decoded.chain_id,
            to: decoded.to.clone(),
            value_wei: U128(decoded.value_wei),
            sighash_hex: sighash_hex.clone(),
            calldata_selector: decoded.calldata_selector.clone(),
            path: clean_path.clone(),
            intent_summary: summary,
            requires_approval: false,
            reason_code: reason_code.clone(),
            status: IntentStatus::ApprovedSigning,
            created_at_ns: U64(now),
            updated_at_ns: U64(now),
            reserved_day_reset_ns: Some(self.last_reset_ns),
            signature: None,
            detail: None,
        };
        self.intents.insert(intent_id.clone(), record);
        self.intent_order.push(intent_id.clone());

        emit_intent_proposed(IntentProposedData {
            intent_id: intent_id.clone(),
            proposer,
            chain_id: decoded.chain_id,
            to: decoded.to,
            value_wei: decoded.value_wei.to_string(),
            sighash_hex: sighash_hex.clone(),
            calldata_selector: decoded.calldata_selector,
            requires_approval: false,
            reason_code,
            path: clean_path.clone(),
            timestamp_ns: now.to_string(),
        });

        PromiseOrValue::Promise(self.call_mpc_sign(intent_id, sighash_hex, clean_path))
    }

    pub fn approve_intent(&mut self, intent_id: String) -> PromiseOrValue<IntentActionResponse> {
        self.assert_owner();
        let approver = env::predecessor_account_id();

        let existing = self
            .intents
            .get(&intent_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str(&format!("{}: {}", WALP_INTENT_NOT_FOUND, intent_id)));

        if existing.status != IntentStatus::PendingApproval {
            env::panic_str(&format!(
                "{}: intent {} has status {:?}",
                WALP_INVALID_INTENT_STATE, intent_id, existing.status
            ));
        }

        let deny_ctx = DenyContext {
            intent_id: &intent_id,
            proposer: &existing.proposer,
            chain_id: existing.chain_id,
            to: &existing.to,
            value_wei: existing.value_wei.0,
        };

        if self.paused {
            self.deny_and_panic(
                deny_ctx,
                WALP_PAUSED,
                "Vault emergency pause is active".to_string(),
            );
        }

        if !self.allowed_chain_ids.contains(&existing.chain_id) {
            self.deny_and_panic(
                deny_ctx,
                WALP_UNSUPPORTED_CHAIN,
                format!("Chain {} no longer allowed", existing.chain_id),
            );
        }

        if let Some(deny) = self.denylist.get(&existing.to) {
            self.deny_and_panic(
                deny_ctx,
                WALP_TARGET_DENYLISTED,
                format!("Recipient {} denylisted: {}", existing.to, deny.reason),
            );
        }

        if existing.value_wei.0 > self.max_tx_wei {
            self.deny_and_panic(
                deny_ctx,
                WALP_EXCEEDS_MAX_TX,
                format!(
                    "Value {} > current max_tx_wei {}",
                    existing.value_wei.0, self.max_tx_wei
                ),
            );
        }

        self.maybe_reset_daily_window();
        let next_spent = self.spent_today_wei.checked_add(existing.value_wei.0);
        if next_spent.is_none_or(|sum| sum > self.daily_limit_wei) {
            self.deny_and_panic(
                deny_ctx,
                WALP_EXCEEDS_DAILY_LIMIT,
                format!(
                    "spent_today_wei {} + value {} > daily_limit_wei {}",
                    self.spent_today_wei, existing.value_wei.0, self.daily_limit_wei
                ),
            );
        }

        let required_gas = if self.registry_contract_id.is_some() {
            MIN_PREPAID_GAS_MPC_WITH_REGISTRY
        } else {
            MIN_PREPAID_GAS_MPC
        };
        if env::prepaid_gas() < required_gas {
            self.deny_and_panic(
                deny_ctx,
                WALP_INSUFFICIENT_GAS,
                format!(
                    "Prepaid gas {} TGas < required {} TGas for async signing",
                    env::prepaid_gas().as_tgas(),
                    required_gas.as_tgas()
                ),
            );
        }

        self.spent_today_wei += existing.value_wei.0;
        let now = env::block_timestamp();
        let sighash_hex = existing.sighash_hex.clone();
        let path = existing.path.clone();
        let to = existing.to.clone();

        let mut updated = existing;
        updated.status = if self.registry_contract_id.is_some() {
            IntentStatus::CheckingRegistry
        } else {
            IntentStatus::ApprovedSigning
        };
        updated.reason_code = WALP_OWNER_APPROVED.to_string();
        updated.updated_at_ns = U64(now);
        updated.reserved_day_reset_ns = Some(self.last_reset_ns);
        self.intents.insert(intent_id.clone(), updated.clone());

        emit_intent_approved(IntentApprovedData {
            intent_id: intent_id.clone(),
            approver,
            chain_id: updated.chain_id,
            to: updated.to,
            value_wei: updated.value_wei.0.to_string(),
            reason_code: WALP_OWNER_APPROVED.to_string(),
            timestamp_ns: now.to_string(),
        });

        if self.registry_contract_id.is_some() {
            PromiseOrValue::Promise(self.call_registry_check(intent_id, to, true))
        } else {
            PromiseOrValue::Promise(self.call_mpc_sign(intent_id, sighash_hex, path))
        }
    }

    pub fn reject_intent(&mut self, intent_id: String, reason: Option<String>) -> IntentActionResponse {
        self.assert_owner();
        let actor = env::predecessor_account_id();

        let mut existing = self
            .intents
            .get(&intent_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str(&format!("{}: {}", WALP_INTENT_NOT_FOUND, intent_id)));

        if existing.status != IntentStatus::PendingApproval {
            env::panic_str(&format!(
                "{}: intent {} has status {:?}",
                WALP_INVALID_INTENT_STATE, intent_id, existing.status
            ));
        }

        let note = reason.unwrap_or_else(|| "Rejected by owner".to_string());
        let now = env::block_timestamp();
        existing.status = IntentStatus::Rejected;
        existing.reason_code = WALP_OWNER_REJECTED.to_string();
        existing.updated_at_ns = U64(now);
        existing.detail = Some(note.clone());
        self.intents.insert(intent_id.clone(), existing.clone());

        emit_intent_rejected(IntentRejectedData {
            intent_id,
            actor,
            to: existing.to.clone(),
            value_wei: existing.value_wei.0.to_string(),
            reason_code: WALP_OWNER_REJECTED.to_string(),
            note,
            timestamp_ns: now.to_string(),
        });

        Self::to_action_response(&existing)
    }

    #[private]
    pub fn on_registry_checked(
        &mut self,
        intent_id: String,
        from_owner_approval: bool,
        #[callback_result] reg_result: Result<RegistryCheckResponse, PromiseError>,
    ) -> PromiseOrValue<IntentActionResponse> {
        let mut record = self
            .intents
            .get(&intent_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str(&format!("{}: {}", WALP_INTENT_NOT_FOUND, intent_id)));

        let (blocked, detail) = match reg_result {
            Ok(resp) => {
                if resp.blocked {
                    let msg = resp
                        .entry
                        .map(|e| format!("Shared registry blocked {} [{}]: {}", e.address, e.category, e.reason))
                        .unwrap_or_else(|| "Blocked by shared walp-registry".to_string());
                    (true, msg)
                } else {
                    (false, String::new())
                }
            }
            Err(_) => {
                if self.registry_fail_closed {
                    (
                        true,
                        "Shared walp-registry check failed under fail-closed policy".to_string(),
                    )
                } else {
                    (false, String::new())
                }
            }
        };

        let now = env::block_timestamp();
        if blocked {
            self.rollback_reserved_spend(&mut record);
            record.status = IntentStatus::Denied;
            record.reason_code = WALP_REGISTRY_DENYLISTED.to_string();
            record.updated_at_ns = U64(now);
            record.detail = Some(detail.clone());
            self.intents.insert(intent_id.clone(), record.clone());

            emit_denied(DeniedData {
                intent_id,
                proposer: record.proposer.clone(),
                chain_id: record.chain_id,
                to: record.to.clone(),
                value_wei: record.value_wei.0.to_string(),
                reason_code: WALP_REGISTRY_DENYLISTED.to_string(),
                detail,
                timestamp_ns: now.to_string(),
            });

            return PromiseOrValue::Value(Self::to_action_response(&record));
        }

        if record.requires_approval && !from_owner_approval {
            record.status = IntentStatus::PendingApproval;
            record.updated_at_ns = U64(now);
            self.intents.insert(intent_id.clone(), record.clone());

            emit_intent_proposed(IntentProposedData {
                intent_id,
                proposer: record.proposer.clone(),
                chain_id: record.chain_id,
                to: record.to.clone(),
                value_wei: record.value_wei.0.to_string(),
                sighash_hex: record.sighash_hex.clone(),
                calldata_selector: record.calldata_selector.clone(),
                requires_approval: true,
                reason_code: record.reason_code.clone(),
                path: record.path.clone(),
                timestamp_ns: now.to_string(),
            });

            return PromiseOrValue::Value(Self::to_action_response(&record));
        }

        record.status = IntentStatus::ApprovedSigning;
        record.updated_at_ns = U64(now);
        self.intents.insert(intent_id.clone(), record.clone());

        if !from_owner_approval {
            emit_intent_proposed(IntentProposedData {
                intent_id: intent_id.clone(),
                proposer: record.proposer.clone(),
                chain_id: record.chain_id,
                to: record.to.clone(),
                value_wei: record.value_wei.0.to_string(),
                sighash_hex: record.sighash_hex.clone(),
                calldata_selector: record.calldata_selector.clone(),
                requires_approval: false,
                reason_code: record.reason_code.clone(),
                path: record.path.clone(),
                timestamp_ns: now.to_string(),
            });
        }

        PromiseOrValue::Promise(self.call_mpc_sign(intent_id, record.sighash_hex, record.path))
    }

    #[private]
    pub fn on_mpc_sign(
        &mut self,
        intent_id: String,
        #[callback_result] sign_result: Result<MpcSignResponse, PromiseError>,
    ) -> IntentActionResponse {
        let mut record = self
            .intents
            .get(&intent_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str(&format!("{}: {}", WALP_INTENT_NOT_FOUND, intent_id)));

        let now = env::block_timestamp();
        match sign_result {
            Ok(sig) => {
                let sig_res = MpcSignatureResult {
                    big_r: sig.big_r.affine_point,
                    s: sig.s.scalar,
                    recovery_id: sig.recovery_id,
                };
                record.status = IntentStatus::Signed;
                record.updated_at_ns = U64(now);
                record.reserved_day_reset_ns = None;
                record.signature = Some(sig_res.clone());
                self.intents.insert(intent_id.clone(), record.clone());

                emit_intent_signed(IntentSignedData {
                    intent_id,
                    chain_id: record.chain_id,
                    to: record.to.clone(),
                    value_wei: record.value_wei.0.to_string(),
                    sighash_hex: record.sighash_hex.clone(),
                    big_r: sig_res.big_r,
                    s: sig_res.s,
                    recovery_id: sig_res.recovery_id,
                    spent_today_wei: self.effective_spent_today().to_string(),
                    timestamp_ns: now.to_string(),
                });

                Self::to_action_response(&record)
            }
            Err(_) => {
                self.rollback_reserved_spend(&mut record);
                let detail = "MPC sign promise failed or timed out".to_string();
                record.status = IntentStatus::Failed;
                record.reason_code = WALP_MPC_SIGN_FAILED.to_string();
                record.updated_at_ns = U64(now);
                record.detail = Some(detail.clone());
                self.intents.insert(intent_id.clone(), record.clone());

                emit_denied(DeniedData {
                    intent_id,
                    proposer: record.proposer.clone(),
                    chain_id: record.chain_id,
                    to: record.to.clone(),
                    value_wei: record.value_wei.0.to_string(),
                    reason_code: WALP_MPC_SIGN_FAILED.to_string(),
                    detail,
                    timestamp_ns: now.to_string(),
                });

                Self::to_action_response(&record)
            }
        }
    }

    pub fn set_policy(
        &mut self,
        max_tx_wei: U128,
        daily_limit_wei: U128,
        approval_threshold_wei: U128,
        allowed_chain_ids: Vec<u64>,
        blocked_selectors: Option<Vec<String>>,
        registry_fail_closed: Option<bool>,
    ) {
        self.assert_owner();
        let actor = env::predecessor_account_id();
        self.max_tx_wei = max_tx_wei.0;
        self.daily_limit_wei = daily_limit_wei.0;
        self.approval_threshold_wei = approval_threshold_wei.0;
        self.allowed_chain_ids = allowed_chain_ids;
        if let Some(selectors) = blocked_selectors {
            self.blocked_selectors = selectors
                .into_iter()
                .map(|s| s.trim().to_ascii_lowercase())
                .collect();
        }
        if let Some(fc) = registry_fail_closed {
            self.registry_fail_closed = fc;
        }
        self.emit_policy_event(&actor, "SET_POLICY", None, None);
    }

    pub fn toggle_pause(&mut self, paused: bool, note: Option<String>) {
        self.assert_owner();
        let actor = env::predecessor_account_id();
        self.paused = paused;
        self.emit_policy_event(&actor, "TOGGLE_PAUSE", None, note);
    }

    pub fn set_registry(
        &mut self,
        registry_contract_id: Option<AccountId>,
        registry_fail_closed: Option<bool>,
    ) {
        self.assert_owner();
        let actor = env::predecessor_account_id();
        self.registry_contract_id = registry_contract_id;
        if let Some(fc) = registry_fail_closed {
            self.registry_fail_closed = fc;
        }
        self.emit_policy_event(&actor, "SET_REGISTRY", None, None);
    }

    pub fn add_denylist(&mut self, address: String, reason: String, evidence_hash: Option<String>) {
        self.assert_owner();
        let actor = env::predecessor_account_id();
        let norm = normalize_evm_address(&address).unwrap_or_else(|e| env::panic_str(e));
        let entry = DenylistEntry {
            address: norm.clone(),
            reason: reason.clone(),
            reporter: actor.clone(),
            evidence_hash: evidence_hash.unwrap_or_default(),
            added_at_ns: U64(env::block_timestamp()),
        };
        self.denylist.insert(norm.clone(), entry);
        self.emit_policy_event(&actor, "ADD_DENYLIST", Some(norm), Some(reason));
    }

    pub fn remove_denylist(&mut self, address: String) -> bool {
        self.assert_owner();
        let actor = env::predecessor_account_id();
        let norm = normalize_evm_address(&address).unwrap_or_else(|e| env::panic_str(e));
        let removed = self.denylist.remove(&norm).is_some();
        if removed {
            self.emit_policy_event(&actor, "REMOVE_DENYLIST", Some(norm), None);
        }
        removed
    }

    pub fn add_allowlist(&mut self, address: String, label: String) {
        self.assert_owner();
        let actor = env::predecessor_account_id();
        let norm = normalize_evm_address(&address).unwrap_or_else(|e| env::panic_str(e));
        let entry = AllowlistEntry {
            address: norm.clone(),
            label: label.clone(),
            added_at_ns: U64(env::block_timestamp()),
        };
        self.allowlist.insert(norm.clone(), entry);
        self.emit_policy_event(&actor, "ADD_ALLOWLIST", Some(norm), Some(label));
    }

    pub fn remove_allowlist(&mut self, address: String) -> bool {
        self.assert_owner();
        let actor = env::predecessor_account_id();
        let norm = normalize_evm_address(&address).unwrap_or_else(|e| env::panic_str(e));
        let removed = self.allowlist.remove(&norm).is_some();
        if removed {
            self.emit_policy_event(&actor, "REMOVE_ALLOWLIST", Some(norm), None);
        }
        removed
    }

    pub fn get_policy(&self) -> PolicyView {
        PolicyView {
            owner_id: self.owner_id.clone(),
            mpc_contract_id: self.mpc_contract_id.clone(),
            registry_contract_id: self.registry_contract_id.clone(),
            registry_fail_closed: self.registry_fail_closed,
            paused: self.paused,
            max_tx_wei: U128(self.max_tx_wei),
            daily_limit_wei: U128(self.daily_limit_wei),
            spent_today_wei: U128(self.effective_spent_today()),
            last_reset_ns: U64(self.last_reset_ns),
            approval_threshold_wei: U128(self.approval_threshold_wei),
            allowed_chain_ids: self.allowed_chain_ids.clone(),
            blocked_selectors: self.blocked_selectors.clone(),
            next_intent_seq: self.next_intent_seq,
        }
    }

    pub fn get_intent(&self, intent_id: String) -> Option<IntentRecord> {
        self.intents.get(&intent_id).cloned()
    }

    pub fn get_pending_intents(&self) -> Vec<IntentRecord> {
        let mut out = Vec::new();
        for id in self.intent_order.iter() {
            if let Some(rec) = self.intents.get(id) {
                if rec.status == IntentStatus::PendingApproval {
                    out.push(rec.clone());
                }
            }
        }
        out
    }

    pub fn get_recent_intents(&self, limit: Option<u32>) -> Vec<IntentRecord> {
        let max_len = limit.unwrap_or(25).min(100) as usize;
        let total = self.intent_order.len();
        let start = total.saturating_sub(max_len as u32);
        let mut out = Vec::new();
        for idx in (start..total).rev() {
            if let Some(id) = self.intent_order.get(idx) {
                if let Some(rec) = self.intents.get(id) {
                    out.push(rec.clone());
                }
            }
        }
        out
    }

    pub fn get_denylist(&self) -> Vec<DenylistEntry> {
        self.denylist.values().cloned().collect()
    }

    pub fn get_allowlist(&self) -> Vec<AllowlistEntry> {
        self.allowlist.values().cloned().collect()
    }

    pub fn simulate_policy_check(&self, raw_tx_hex: String) -> PolicySimulationResult {
        if self.paused {
            return PolicySimulationResult {
                allowed: false,
                requires_approval: false,
                reason_code: WALP_PAUSED.to_string(),
                detail: "Vault emergency pause is active".to_string(),
                chain_id: None,
                to: None,
                value_wei: None,
                sighash_hex: None,
                calldata_selector: None,
                check_registry: false,
            };
        }

        let raw_tx_bytes = match decode_hex(&raw_tx_hex) {
            Ok(b) => b,
            Err(e) => {
                return PolicySimulationResult {
                    allowed: false,
                    requires_approval: false,
                    reason_code: WALP_RLP_INVALID.to_string(),
                    detail: e.to_string(),
                    chain_id: None,
                    to: None,
                    value_wei: None,
                    sighash_hex: None,
                    calldata_selector: None,
                    check_registry: false,
                };
            }
        };

        let decoded = match decode_eip1559_unsigned(&raw_tx_bytes) {
            Ok(tx) => tx,
            Err(RlpDecodeError::ValueExceedsU128) => {
                return PolicySimulationResult {
                    allowed: false,
                    requires_approval: false,
                    reason_code: WALP_EXCEEDS_MAX_TX.to_string(),
                    detail: "Decoded value exceeds u128::MAX".to_string(),
                    chain_id: None,
                    to: None,
                    value_wei: None,
                    sighash_hex: None,
                    calldata_selector: None,
                    check_registry: false,
                };
            }
            Err(e) => {
                return PolicySimulationResult {
                    allowed: false,
                    requires_approval: false,
                    reason_code: WALP_RLP_INVALID.to_string(),
                    detail: e.to_string(),
                    chain_id: None,
                    to: None,
                    value_wei: None,
                    sighash_hex: None,
                    calldata_selector: None,
                    check_registry: false,
                };
            }
        };

        let sighash_hex = encode_hex_lower(&env::keccak256(&raw_tx_bytes));

        if !self.allowed_chain_ids.contains(&decoded.chain_id) {
            return PolicySimulationResult {
                allowed: false,
                requires_approval: false,
                reason_code: WALP_UNSUPPORTED_CHAIN.to_string(),
                detail: format!("chain_id {} not in allowed_chain_ids", decoded.chain_id),
                chain_id: Some(decoded.chain_id),
                to: Some(decoded.to),
                value_wei: Some(U128(decoded.value_wei)),
                sighash_hex: Some(sighash_hex),
                calldata_selector: Some(decoded.calldata_selector),
                check_registry: false,
            };
        }

        if let Some(deny) = self.denylist.get(&decoded.to) {
            return PolicySimulationResult {
                allowed: false,
                requires_approval: false,
                reason_code: WALP_TARGET_DENYLISTED.to_string(),
                detail: format!("Denylisted: {}", deny.reason),
                chain_id: Some(decoded.chain_id),
                to: Some(decoded.to),
                value_wei: Some(U128(decoded.value_wei)),
                sighash_hex: Some(sighash_hex),
                calldata_selector: Some(decoded.calldata_selector),
                check_registry: false,
            };
        }

        if let Err(err) = inspect_calldata(&decoded.data, &self.blocked_selectors) {
            return PolicySimulationResult {
                allowed: false,
                requires_approval: false,
                reason_code: WALP_CALLDATA_BLOCKED.to_string(),
                detail: err,
                chain_id: Some(decoded.chain_id),
                to: Some(decoded.to),
                value_wei: Some(U128(decoded.value_wei)),
                sighash_hex: Some(sighash_hex),
                calldata_selector: Some(decoded.calldata_selector),
                check_registry: false,
            };
        }

        if decoded.value_wei > self.max_tx_wei {
            return PolicySimulationResult {
                allowed: false,
                requires_approval: false,
                reason_code: WALP_EXCEEDS_MAX_TX.to_string(),
                detail: format!(
                    "value {} > max_tx_wei {}",
                    decoded.value_wei, self.max_tx_wei
                ),
                chain_id: Some(decoded.chain_id),
                to: Some(decoded.to),
                value_wei: Some(U128(decoded.value_wei)),
                sighash_hex: Some(sighash_hex),
                calldata_selector: Some(decoded.calldata_selector),
                check_registry: false,
            };
        }

        let spent = self.effective_spent_today();
        if spent
            .checked_add(decoded.value_wei)
            .is_none_or(|sum| sum > self.daily_limit_wei)
        {
            return PolicySimulationResult {
                allowed: false,
                requires_approval: false,
                reason_code: WALP_EXCEEDS_DAILY_LIMIT.to_string(),
                detail: format!(
                    "spent_today {} + value {} > daily_limit {}",
                    spent, decoded.value_wei, self.daily_limit_wei
                ),
                chain_id: Some(decoded.chain_id),
                to: Some(decoded.to),
                value_wei: Some(U128(decoded.value_wei)),
                sighash_hex: Some(sighash_hex),
                calldata_selector: Some(decoded.calldata_selector),
                check_registry: false,
            };
        }

        let (requires_approval, reason_code, detail) =
            if decoded.value_wei > self.approval_threshold_wei {
                (
                    true,
                    WALP_THRESHOLD_ESCALATED.to_string(),
                    "Exceeds autonomous approval_threshold_wei".to_string(),
                )
            } else if !decoded.data.is_empty() && !self.allowlist.contains_key(&decoded.to) {
                (
                    true,
                    WALP_UNLISTED_CONTRACT_CALL.to_string(),
                    "Contract call to unallowlisted target requires owner approval".to_string(),
                )
            } else {
                (
                    false,
                    WALP_WITHIN_AUTONOMOUS_POLICY.to_string(),
                    "Clears local firewall rules for autonomous MPC signing".to_string(),
                )
            };

        PolicySimulationResult {
            allowed: true,
            requires_approval,
            reason_code,
            detail,
            chain_id: Some(decoded.chain_id),
            to: Some(decoded.to),
            value_wei: Some(U128(decoded.value_wei)),
            sighash_hex: Some(sighash_hex),
            calldata_selector: Some(decoded.calldata_selector),
            check_registry: self.registry_contract_id.is_some(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::Nep297Event;
    use near_sdk::test_utils::{get_logs, VMContextBuilder};
    use near_sdk::testing_env;

    const SEPOLIA_CHAIN_ID: u64 = 11_155_111;
    const ETH_1: u128 = 1_000_000_000_000_000_000;
    const MAX_TX: u128 = 50_000_000_000_000_000; // 0.05 ETH
    const DAILY_LIMIT: u128 = 200_000_000_000_000_000; // 0.2 ETH
    const THRESHOLD: u128 = 10_000_000_000_000_000; // 0.01 ETH

    // Exact unsigned EIP-1559 vector verified against ethers v6.17.0:
    // chainId=11155111, nonce=0, maxPriority=1gwei, maxFee=2gwei, gas=21000,
    // to=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045, value=0.0001 ETH (100000000000000 wei), data=0x
    const ETHERS_VECTOR_TX_HEX: &str = "0x02f083aa36a780843b9aca00847735940082520894d8da6bf26964af9d7eed9e03e53415d37aa96045865af3107a400080c0";
    const ETHERS_VECTOR_SIGHASH: &str = "3df61ab6eabeccfa32050e72fd4bd676360f8d90bc71bd4fd0c12a9d2589ae3f";

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
        let first_nz = bytes.iter().position(|&b| b != 0).unwrap();
        bytes[first_nz..].to_vec()
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

    fn build_eip1559_hex(chain_id: u64, to_hex: Option<&str>, value_wei: u128, data: &[u8]) -> String {
        let to_bytes = match to_hex {
            Some(h) => decode_hex(h).unwrap(),
            None => Vec::new(),
        };
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
        format!("0x{}", encode_hex_lower(&raw))
    }

    fn ctx(predecessor: &str, ts_ns: u64) -> VMContextBuilder {
        let mut b = VMContextBuilder::new();
        b.predecessor_account_id(predecessor.parse().unwrap());
        b.current_account_id("walp-vault.owner.testnet".parse().unwrap());
        b.block_timestamp(ts_ns);
        b.prepaid_gas(Gas::from_tgas(300));
        b
    }

    fn init_vault(ts_ns: u64) -> WalpVault {
        testing_env!(ctx("owner.testnet", ts_ns).build());
        WalpVault::init(
            "owner.testnet".parse().unwrap(),
            "v1.signer-prod.testnet".parse().unwrap(),
            U128(MAX_TX),
            U128(DAILY_LIMIT),
            U128(THRESHOLD),
            vec![SEPOLIA_CHAIN_ID],
            None,
            Some(true),
        )
    }

    fn last_event_json<T: for<'de> Deserialize<'de>>(event_name: &str) -> Nep297Event<T> {
        let logs = get_logs();
        let line = logs
            .iter()
            .rev()
            .find(|l| l.starts_with("EVENT_JSON:") && l.contains(&format!("\"event\":\"{}\"", event_name)))
            .unwrap_or_else(|| panic!("Missing EVENT_JSON for {}, logs: {:?}", event_name, logs));
        serde_json::from_str(line.strip_prefix("EVENT_JSON:").unwrap()).unwrap()
    }

    #[test]
    fn rlp_matches_ethers_v6_vector_and_keccak() {
        let raw = decode_hex(ETHERS_VECTOR_TX_HEX).unwrap();
        let decoded = decode_eip1559_unsigned(&raw).unwrap();
        assert_eq!(decoded.chain_id, SEPOLIA_CHAIN_ID);
        assert_eq!(decoded.nonce, 0);
        assert_eq!(decoded.to, "0xd8da6bf26964af9d7eed9e03e53415d37aa96045");
        assert_eq!(decoded.value_wei, 100_000_000_000_000);
        assert_eq!(decoded.calldata_selector, "0x");
        testing_env!(ctx("agent.testnet", 1_000).build());
        assert_eq!(encode_hex_lower(&env::keccak256(&raw)), ETHERS_VECTOR_SIGHASH);
    }

    #[test]
    fn rlp_rejects_contract_deploy_legacy_and_non_canonical() {
        let deploy = build_eip1559_hex(SEPOLIA_CHAIN_ID, None, 0, &[0x60, 0x00]);
        assert!(matches!(
            decode_eip1559_unsigned(&decode_hex(&deploy).unwrap()),
            Err(RlpDecodeError::InvalidToAddressLen(0))
        ));
        // Non-0x02 legacy tx
        assert!(matches!(
            decode_eip1559_unsigned(&[0xc0]),
            Err(RlpDecodeError::UnsupportedTxType(0xc0))
        ));
        // Trailing byte after valid tx
        let mut with_trailing = decode_hex(ETHERS_VECTOR_TX_HEX).unwrap();
        with_trailing.push(0x00);
        assert!(matches!(
            decode_eip1559_unsigned(&with_trailing),
            Err(RlpDecodeError::TrailingBytes)
        ));
        // Non-canonical single-byte encoding (0x81 0x05 instead of 0x05 inside a 2-byte list 0xc2)
        assert!(matches!(
            decode_eip1559_unsigned(&[0x02, 0xc2, 0x81, 0x05]),
            Err(RlpDecodeError::NonCanonicalEncoding)
        ));
    }

    #[test]
    #[should_panic(expected = "WALP_PAUSED")]
    fn rejects_when_paused() {
        let mut vault = init_vault(1_000);
        vault.toggle_pause(true, Some("Incident".to_string()));
        testing_env!(ctx("agent.testnet", 2_000).build());
        let _ = vault.request_intent(ETHERS_VECTOR_TX_HEX.to_string(), None, None);
    }

    #[test]
    #[should_panic(expected = "WALP_UNSUPPORTED_CHAIN")]
    fn rejects_unsupported_chain() {
        let mut vault = init_vault(1_000);
        testing_env!(ctx("agent.testnet", 2_000).build());
        let mainnet_tx = build_eip1559_hex(1, Some("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"), 1_000, &[]);
        let _ = vault.request_intent(mainnet_tx, None, None);
    }

    #[test]
    #[should_panic(expected = "WALP_TARGET_DENYLISTED")]
    fn rejects_local_denylist() {
        let mut vault = init_vault(1_000);
        vault.add_denylist(
            "0xdead000000000000000000000000000000000001".to_string(),
            "Drainer".to_string(),
            None,
        );
        testing_env!(ctx("agent.testnet", 2_000).build());
        let bad_tx = build_eip1559_hex(
            SEPOLIA_CHAIN_ID,
            Some("0xdead000000000000000000000000000000000001"),
            1_000,
            &[],
        );
        let _ = vault.request_intent(bad_tx, None, None);
    }

    #[test]
    #[should_panic(expected = "WALP_CALLDATA_BLOCKED")]
    fn rejects_unlimited_erc20_approve_calldata() {
        let mut vault = init_vault(1_000);
        testing_env!(ctx("agent.testnet", 2_000).build());
        let mut approve_data = vec![0x09, 0x5e, 0xa7, 0xb3];
        approve_data.extend_from_slice(&[0u8; 12]);
        approve_data.extend_from_slice(&[0xaa; 20]);
        approve_data.extend_from_slice(&[0xff; 32]); // uint256::MAX
        let tx = build_eip1559_hex(
            SEPOLIA_CHAIN_ID,
            Some("0x1c7d4b196cb0c7b01d743fbc6116a902379c7238"),
            0,
            &approve_data,
        );
        let _ = vault.request_intent(tx, None, None);
    }

    #[test]
    #[should_panic(expected = "WALP_EXCEEDS_MAX_TX")]
    fn rejects_over_max_tx_even_with_spoofed_summary() {
        let mut vault = init_vault(1_000);
        testing_env!(ctx("agent.testnet", 2_000).build());
        let tx = build_eip1559_hex(
            SEPOLIA_CHAIN_ID,
            Some("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"),
            5 * ETH_1,
            &[],
        );
        let _ = vault.request_intent(tx, None, Some("Send 0.0001 ETH".to_string()));
    }

    #[test]
    fn enforces_daily_limit_and_24h_reset() {
        let mut vault = init_vault(1_000);
        testing_env!(ctx("owner.testnet", 1_500).build());
        // 4 calls of 0.04 ETH = 0.16 ETH <= 0.2 ETH daily limit (raise threshold to MAX_TX for autonomous calls)
        vault.set_policy(
            U128(MAX_TX),
            U128(DAILY_LIMIT),
            U128(MAX_TX),
            vec![SEPOLIA_CHAIN_ID],
            None,
            None,
        );
        testing_env!(ctx("agent.testnet", 2_000).build());
        for _ in 0..4 {
            let tx = build_eip1559_hex(
                SEPOLIA_CHAIN_ID,
                Some("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"),
                40_000_000_000_000_000,
                &[],
            );
            let _ = vault.request_intent(tx, None, None);
        }
        assert_eq!(vault.get_policy().spent_today_wei.0, 160_000_000_000_000_000);

        // Next 0.05 ETH would be 0.21 > 0.20 -> simulate catches WALP_EXCEEDS_DAILY_LIMIT
        let over = build_eip1559_hex(
            SEPOLIA_CHAIN_ID,
            Some("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"),
            50_000_000_000_000_000,
            &[],
        );
        let sim = vault.simulate_policy_check(over.clone());
        assert!(!sim.allowed);
        assert_eq!(sim.reason_code, WALP_EXCEEDS_DAILY_LIMIT);

        // Advance past 24h -> resets daily budget!
        testing_env!(ctx("agent.testnet", 1_000 + ONE_DAY_NS).build());
        let sim_next_day = vault.simulate_policy_check(over);
        assert!(sim_next_day.allowed);
        assert_eq!(vault.get_policy().spent_today_wei.0, 0);
    }

    #[test]
    fn escalates_threshold_and_owner_reject_emits_nep297() {
        let mut vault = init_vault(1_000);
        testing_env!(ctx("agent.testnet", 2_000).build());
        let tx = build_eip1559_hex(
            SEPOLIA_CHAIN_ID,
            Some("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"),
            25_000_000_000_000_000, // 0.025 ETH > 0.01 threshold, <= 0.05 max
            &[],
        );
        let PromiseOrValue::Value(res) = vault.request_intent(tx, Some("ethereum-1".to_string()), None) else {
            panic!("Expected synchronous escalation Value");
        };
        assert_eq!(res.status, IntentStatus::PendingApproval);
        assert!(res.requires_approval);
        assert_eq!(res.reason_code, WALP_THRESHOLD_ESCALATED);

        let proposed: Nep297Event<IntentProposedData> = last_event_json("IntentProposed");
        assert_eq!(proposed.standard, "walp_vault");
        assert_eq!(proposed.data[0].reason_code, WALP_THRESHOLD_ESCALATED);

        testing_env!(ctx("owner.testnet", 3_000).build());
        let rej = vault.reject_intent(res.intent_id, Some("Suspicious cadence".to_string()));
        assert_eq!(rej.status, IntentStatus::Rejected);
        let rejected: Nep297Event<IntentRejectedData> = last_event_json("IntentRejected");
        assert_eq!(rejected.data[0].note, "Suspicious cadence");
        assert_eq!(rejected.data[0].reason_code, WALP_OWNER_REJECTED);
    }

    #[test]
    #[should_panic(expected = "WALP_UNAUTHORIZED_OWNER_ONLY")]
    fn non_owner_cannot_approve_or_set_policy() {
        let mut vault = init_vault(1_000);
        testing_env!(ctx("agent.testnet", 2_000).build());
        vault.set_policy(
            U128(ETH_1),
            U128(ETH_1),
            U128(ETH_1),
            vec![1],
            None,
            None,
        );
    }

    #[test]
    fn on_mpc_sign_rolls_back_spend_on_failure_and_emits_signed_on_success() {
        let mut vault = init_vault(1_000);
        testing_env!(ctx("agent.testnet", 2_000).build());
        let _ = vault.request_intent(ETHERS_VECTOR_TX_HEX.to_string(), None, None);
        assert_eq!(vault.get_policy().spent_today_wei.0, 100_000_000_000_000);

        // Simulate MPC callback failure
        testing_env!(ctx("walp-vault.owner.testnet", 3_000).build());
        let failed = vault.on_mpc_sign("intent_1".to_string(), Err(PromiseError::Failed));
        assert_eq!(failed.status, IntentStatus::Failed);
        assert_eq!(failed.reason_code, WALP_MPC_SIGN_FAILED);
        assert_eq!(vault.get_policy().spent_today_wei.0, 0);
        let denied: Nep297Event<DeniedData> = last_event_json("Denied");
        assert_eq!(denied.data[0].reason_code, WALP_MPC_SIGN_FAILED);

        // Now test success callback
        testing_env!(ctx("agent.testnet", 4_000).build());
        let _ = vault.request_intent(ETHERS_VECTOR_TX_HEX.to_string(), None, None);
        assert_eq!(vault.get_policy().spent_today_wei.0, 100_000_000_000_000);

        testing_env!(ctx("walp-vault.owner.testnet", 5_000).build());
        let signed = vault.on_mpc_sign(
            "intent_2".to_string(),
            Ok(MpcSignResponse {
                big_r: MpcAffinePoint {
                    affine_point: "03ab00000000000000000000000000000000000000000000000000000000000001".to_string(),
                },
                s: MpcScalarValue {
                    scalar: "49cd00000000000000000000000000000000000000000000000000000000000002".to_string(),
                },
                recovery_id: 1,
            }),
        );
        assert_eq!(signed.status, IntentStatus::Signed);
        assert_eq!(vault.get_policy().spent_today_wei.0, 100_000_000_000_000);
        let evt: Nep297Event<IntentSignedData> = last_event_json("IntentSigned");
        assert_eq!(evt.data[0].recovery_id, 1);
        assert_eq!(evt.data[0].sighash_hex, ETHERS_VECTOR_SIGHASH);
    }

    #[test]
    fn unlisted_contract_call_escalates_until_allowlisted() {
        let mut vault = init_vault(1_000);
        let token = "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238";
        // ERC-20 transfer(address,uint256) selector = 0xa9059cbb + 64 bytes args
        let mut calldata = vec![0xa9, 0x05, 0x9c, 0xbb];
        calldata.extend_from_slice(&[0u8; 31]);
        calldata.push(0x42);
        calldata.extend_from_slice(&[0u8; 31]);
        calldata.push(0x01);

        let tx = build_eip1559_hex(SEPOLIA_CHAIN_ID, Some(token), 0, &calldata);
        testing_env!(ctx("agent.testnet", 2_000).build());
        let PromiseOrValue::Value(escalated) = vault.request_intent(tx.clone(), None, None) else {
            panic!("Expected PendingApproval escalation for unlisted contract call");
        };
        assert_eq!(escalated.status, IntentStatus::PendingApproval);
        assert!(escalated.requires_approval);
        assert_eq!(escalated.reason_code, WALP_UNLISTED_CONTRACT_CALL);

        // Owner adds token to allowlist -> subsequent identical call runs autonomously
        testing_env!(ctx("owner.testnet", 3_000).build());
        vault.add_allowlist(token.to_string(), "Sepolia USDC".to_string());

        testing_env!(ctx("agent.testnet", 4_000).build());
        let PromiseOrValue::Promise(_) = vault.request_intent(tx, None, None) else {
            panic!("Expected autonomous MPC Promise after allowlisting");
        };
        let rec = vault.get_intent("intent_2".to_string()).unwrap();
        assert_eq!(rec.status, IntentStatus::ApprovedSigning);
        assert_eq!(rec.reason_code, WALP_WITHIN_AUTONOMOUS_POLICY);
    }

    #[test]
    fn calldata_firewall_blocks_increase_allowance_set_approval_and_transfer_ownership() {
        let vault = init_vault(1_000);
        let target = "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238";

        // 1) increaseAllowance(spender, MAX_UINT256) -> blocked
        let mut inc_data = vec![0x39, 0x50, 0x93, 0x51];
        inc_data.extend_from_slice(&[0u8; 32]);
        inc_data.extend_from_slice(&[0xffu8; 32]);
        let inc_tx = build_eip1559_hex(SEPOLIA_CHAIN_ID, Some(target), 0, &inc_data);
        let sim_inc = vault.simulate_policy_check(inc_tx);
        assert!(!sim_inc.allowed);
        assert_eq!(sim_inc.reason_code, WALP_CALLDATA_BLOCKED);

        // 2) setApprovalForAll(operator, true) -> blocked; false -> allowed (escalated if unlisted)
        let mut sfa_true = vec![0xa2, 0x2c, 0xb4, 0x65];
        sfa_true.extend_from_slice(&[0u8; 32]);
        sfa_true.extend_from_slice(&[0u8; 31]);
        sfa_true.push(0x01);
        let sim_sfa_true = vault.simulate_policy_check(build_eip1559_hex(
            SEPOLIA_CHAIN_ID,
            Some(target),
            0,
            &sfa_true,
        ));
        assert!(!sim_sfa_true.allowed);
        assert_eq!(sim_sfa_true.reason_code, WALP_CALLDATA_BLOCKED);

        let mut sfa_false = vec![0xa2, 0x2c, 0xb4, 0x65];
        sfa_false.extend_from_slice(&[0u8; 32]);
        sfa_false.extend_from_slice(&[0u8; 32]);
        let sim_sfa_false = vault.simulate_policy_check(build_eip1559_hex(
            SEPOLIA_CHAIN_ID,
            Some(target),
            0,
            &sfa_false,
        ));
        assert!(sim_sfa_false.allowed);
        assert_eq!(sim_sfa_false.reason_code, WALP_UNLISTED_CONTRACT_CALL);

        // 3) transferOwnership(newOwner) -> blocked
        let mut own_data = vec![0xf2, 0xfd, 0xe3, 0x8b];
        own_data.extend_from_slice(&[0u8; 32]);
        let sim_own = vault.simulate_policy_check(build_eip1559_hex(
            SEPOLIA_CHAIN_ID,
            Some(target),
            0,
            &own_data,
        ));
        assert!(!sim_own.allowed);
        assert_eq!(sim_own.reason_code, WALP_CALLDATA_BLOCKED);
    }

    #[test]
    fn value_exceeding_u128_maps_to_exceeds_max_tx() {
        let vault = init_vault(1_000);
        // Build an EIP-1559 tx with a 17-byte value (2^128)
        let to_bytes = decode_hex("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045").unwrap();
        let mut huge_val = vec![0x01];
        huge_val.extend_from_slice(&[0u8; 16]);
        let list = rlp_encode_list(vec![
            rlp_encode_bytes(&encode_u128_be(SEPOLIA_CHAIN_ID as u128)),
            rlp_encode_bytes(&[]),
            rlp_encode_bytes(&encode_u128_be(1_000_000_000)),
            rlp_encode_bytes(&encode_u128_be(2_000_000_000)),
            rlp_encode_bytes(&encode_u128_be(21_000)),
            rlp_encode_bytes(&to_bytes),
            rlp_encode_bytes(&huge_val),
            rlp_encode_bytes(&[]),
            rlp_encode_list(vec![]),
        ]);
        let mut raw = vec![0x02];
        raw.extend_from_slice(&list);
        let sim = vault.simulate_policy_check(format!("0x{}", encode_hex_lower(&raw)));
        assert!(!sim.allowed);
        assert_eq!(sim.reason_code, WALP_EXCEEDS_MAX_TX);
    }

    #[test]
    #[should_panic(expected = "WALP_INSUFFICIENT_GAS")]
    fn insufficient_prepaid_gas_panics_before_reserving_spend() {
        let mut vault = init_vault(1_000);
        let mut low_gas_ctx = ctx("agent.testnet", 2_000);
        low_gas_ctx.prepaid_gas(Gas::from_tgas(30));
        testing_env!(low_gas_ctx.build());
        let _ = vault.request_intent(ETHERS_VECTOR_TX_HEX.to_string(), None, None);
    }

    #[test]
    fn registry_fail_closed_and_blocked_both_roll_back_spend() {
        testing_env!(ctx("owner.testnet", 1_000).build());
        let mut vault = WalpVault::init(
            "owner.testnet".parse().unwrap(),
            "v1.signer-prod.testnet".parse().unwrap(),
            U128(MAX_TX),
            U128(DAILY_LIMIT),
            U128(THRESHOLD),
            vec![SEPOLIA_CHAIN_ID],
            Some("walp-registry.owner.testnet".parse().unwrap()),
            Some(true),
        );

        // 1) Registry promise error under fail-closed -> Denied + spend rolled back
        testing_env!(ctx("agent.testnet", 2_000).build());
        let _ = vault.request_intent(ETHERS_VECTOR_TX_HEX.to_string(), None, None);
        assert_eq!(vault.get_policy().spent_today_wei.0, 100_000_000_000_000);

        testing_env!(ctx("walp-vault.owner.testnet", 3_000).build());
        let fail_closed = vault.on_registry_checked("intent_1".to_string(), false, Err(PromiseError::Failed));
        let PromiseOrValue::Value(res1) = fail_closed else {
            panic!("Expected synchronous Denied Value on fail-closed registry error");
        };
        assert_eq!(res1.status, IntentStatus::Denied);
        assert_eq!(res1.reason_code, WALP_REGISTRY_DENYLISTED);
        assert_eq!(vault.get_policy().spent_today_wei.0, 0);

        // 2) Registry explicitly returns blocked: true -> Denied + spend rolled back
        testing_env!(ctx("agent.testnet", 4_000).build());
        let _ = vault.request_intent(ETHERS_VECTOR_TX_HEX.to_string(), None, None);
        assert_eq!(vault.get_policy().spent_today_wei.0, 100_000_000_000_000);

        testing_env!(ctx("walp-vault.owner.testnet", 5_000).build());
        let blocked = vault.on_registry_checked(
            "intent_2".to_string(),
            false,
            Ok(RegistryCheckResponse {
                blocked: true,
                entry: Some(RegistryEntryView {
                    address: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045".to_string(),
                    category: "PHISHING".to_string(),
                    reason: "Known drainer".to_string(),
                    reporter: "owner.testnet".parse().unwrap(),
                    evidence_hash: "0xabc".to_string(),
                    added_at_ns: U64(100),
                    active: true,
                }),
            }),
        );
        let PromiseOrValue::Value(res2) = blocked else {
            panic!("Expected synchronous Denied Value on blocked registry entry");
        };
        assert_eq!(res2.status, IntentStatus::Denied);
        assert_eq!(res2.reason_code, WALP_REGISTRY_DENYLISTED);
        assert_eq!(vault.get_policy().spent_today_wei.0, 0);
    }

    #[test]
    #[should_panic(expected = "WALP_PAUSED")]
    fn approve_intent_respects_pause_activated_after_proposal() {
        let mut vault = init_vault(1_000);
        testing_env!(ctx("agent.testnet", 2_000).build());
        let tx = build_eip1559_hex(
            SEPOLIA_CHAIN_ID,
            Some("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"),
            25_000_000_000_000_000,
            &[],
        );
        let PromiseOrValue::Value(prop) = vault.request_intent(tx, None, None) else {
            panic!("Expected escalation");
        };

        testing_env!(ctx("owner.testnet", 3_000).build());
        vault.toggle_pause(true, Some("Incident".to_string()));
        let _ = vault.approve_intent(prop.intent_id);
    }
}

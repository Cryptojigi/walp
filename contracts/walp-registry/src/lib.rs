use near_sdk::json_types::U64;
use near_sdk::store::{IterableMap, IterableSet};
use near_sdk::{env, near, AccountId, BorshStorageKey, PanicOnDefault};
use serde::Serialize;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Curators,
    Entries,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DenylistEntry {
    pub address: String,
    pub category: String,
    pub reason: String,
    pub evidence_hash: String,
    pub reporter: AccountId,
    pub added_at_ns: U64,
    pub active: bool,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CheckAddressResponse {
    pub blocked: bool,
    pub entry: Option<DenylistEntry>,
}

#[derive(Serialize)]
struct RegistryEvent<'a> {
    standard: &'static str,
    version: &'static str,
    event: &'static str,
    data: Vec<RegistryUpdatedData<'a>>,
}

#[derive(Serialize)]
struct RegistryUpdatedData<'a> {
    action: &'a str,
    actor: &'a AccountId,
    address: &'a str,
    category: Option<&'a str>,
    reason: Option<&'a str>,
    evidence_hash: Option<&'a str>,
    timestamp_ns: String,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct WalpRegistry {
    owner_id: AccountId,
    curators: IterableSet<AccountId>,
    entries: IterableMap<String, DenylistEntry>,
}

fn normalize_evm_address(raw: &str) -> Result<String, &'static str> {
    let trimmed = raw.trim();
    let hex_part = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
        .ok_or("WALP_REGISTRY_INVALID_ADDRESS: missing 0x prefix")?;
    if hex_part.len() != 40 || !hex_part.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("WALP_REGISTRY_INVALID_ADDRESS: expected 20-byte EVM hex address");
    }
    Ok(format!("0x{}", hex_part.to_ascii_lowercase()))
}

#[near]
impl WalpRegistry {
    #[init]
    pub fn init(owner_id: AccountId) -> Self {
        let mut curators = IterableSet::new(StorageKey::Curators);
        curators.insert(owner_id.clone());
        Self {
            owner_id,
            curators,
            entries: IterableMap::new(StorageKey::Entries),
        }
    }

    fn assert_owner(&self) {
        if env::predecessor_account_id() != self.owner_id {
            env::panic_str("WALP_REGISTRY_UNAUTHORIZED_OWNER_ONLY");
        }
    }

    fn assert_curator_or_owner(&self) {
        let caller = env::predecessor_account_id();
        if caller != self.owner_id && !self.curators.contains(&caller) {
            env::panic_str("WALP_REGISTRY_UNAUTHORIZED_CURATOR_ONLY");
        }
    }

    fn emit_updated(
        action: &str,
        actor: &AccountId,
        address: &str,
        category: Option<&str>,
        reason: Option<&str>,
        evidence_hash: Option<&str>,
    ) {
        let evt = RegistryEvent {
            standard: "walp_registry",
            version: "1.0.0",
            event: "RegistryUpdated",
            data: vec![RegistryUpdatedData {
                action,
                actor,
                address,
                category,
                reason,
                evidence_hash,
                timestamp_ns: env::block_timestamp().to_string(),
            }],
        };
        if let Ok(json) = serde_json::to_string(&evt) {
            env::log_str(&format!("EVENT_JSON:{}", json));
        }
    }

    pub fn add_curator(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.curators.insert(account_id);
    }

    pub fn remove_curator(&mut self, account_id: AccountId) {
        self.assert_owner();
        if account_id == self.owner_id {
            env::panic_str("WALP_REGISTRY_CANNOT_REMOVE_OWNER");
        }
        self.curators.remove(&account_id);
    }

    pub fn report_address(
        &mut self,
        address: String,
        category: String,
        reason: String,
        evidence_hash: String,
    ) -> DenylistEntry {
        self.assert_curator_or_owner();
        let norm = normalize_evm_address(&address).unwrap_or_else(|e| env::panic_str(e));
        let reporter = env::predecessor_account_id();
        let entry = DenylistEntry {
            address: norm.clone(),
            category: category.clone(),
            reason: reason.clone(),
            evidence_hash: evidence_hash.clone(),
            reporter: reporter.clone(),
            added_at_ns: U64(env::block_timestamp()),
            active: true,
        };
        self.entries.insert(norm.clone(), entry.clone());
        Self::emit_updated(
            "REPORTED",
            &reporter,
            &norm,
            Some(&category),
            Some(&reason),
            Some(&evidence_hash),
        );
        entry
    }

    pub fn clear_address(&mut self, address: String) -> bool {
        self.assert_owner();
        let norm = normalize_evm_address(&address).unwrap_or_else(|e| env::panic_str(e));
        let existed = self.entries.remove(&norm).is_some();
        if existed {
            let actor = env::predecessor_account_id();
            Self::emit_updated("CLEARED", &actor, &norm, None, None, None);
        }
        existed
    }

    pub fn is_denylisted(&self, address: String) -> Option<DenylistEntry> {
        let Ok(norm) = normalize_evm_address(&address) else {
            return None;
        };
        self.entries.get(&norm).filter(|e| e.active).cloned()
    }

    pub fn check_address(&self, address: String) -> CheckAddressResponse {
        let entry = self.is_denylisted(address);
        CheckAddressResponse {
            blocked: entry.is_some(),
            entry,
        }
    }

    pub fn list_entries(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<DenylistEntry> {
        let start = from_index.unwrap_or(0) as usize;
        let max_len = limit.unwrap_or(50).min(200) as usize;
        self.entries
            .values()
            .filter(|e| e.active)
            .skip(start)
            .take(max_len)
            .cloned()
            .collect()
    }

    pub fn get_curators(&self) -> Vec<AccountId> {
        self.curators.iter().cloned().collect()
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner_id.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn ctx(predecessor: &str) -> VMContextBuilder {
        let mut b = VMContextBuilder::new();
        b.predecessor_account_id(predecessor.parse().unwrap());
        b.block_timestamp(1_762_880_000_000_000_000);
        b
    }

    #[test]
    fn curator_reports_and_owner_clears() {
        testing_env!(ctx("owner.testnet").build());
        let mut reg = WalpRegistry::init("owner.testnet".parse().unwrap());
        reg.add_curator("curator.testnet".parse().unwrap());

        testing_env!(ctx("curator.testnet").build());
        let entry = reg.report_address(
            "0xDeaD000000000000000000000000000000000001".to_string(),
            "PHISHING".to_string(),
            "Confirmed drainer".to_string(),
            "sha256:abc".to_string(),
        );
        assert_eq!(entry.address, "0xdead000000000000000000000000000000000001");
        let check = reg.check_address("0xDEAD000000000000000000000000000000000001".to_string());
        assert!(check.blocked);
        assert_eq!(check.entry.unwrap().category, "PHISHING");

        testing_env!(ctx("owner.testnet").build());
        assert!(reg.clear_address("0xdead000000000000000000000000000000000001".to_string()));
        assert!(!reg
            .check_address("0xdead000000000000000000000000000000000001".to_string())
            .blocked);
    }

    #[test]
    #[should_panic(expected = "WALP_REGISTRY_UNAUTHORIZED_CURATOR_ONLY")]
    fn non_curator_cannot_report() {
        testing_env!(ctx("owner.testnet").build());
        let mut reg = WalpRegistry::init("owner.testnet".parse().unwrap());
        testing_env!(ctx("attacker.testnet").build());
        reg.report_address(
            "0xdead000000000000000000000000000000000001".to_string(),
            "SPAM".to_string(),
            "Bad".to_string(),
            "0x0".to_string(),
        );
    }
}

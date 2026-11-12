use near_sdk::{env, near, NearToken};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct PayloadV2 {
    #[serde(rename = "Ecdsa")]
    pub ecdsa: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct SignRequestInner {
    pub payload_v2: Option<PayloadV2>,
    pub path: String,
    pub domain_id: u64,
}

#[derive(Serialize, Deserialize)]
pub struct AffinePoint {
    pub affine_point: String,
}

#[derive(Serialize, Deserialize)]
pub struct ScalarValue {
    pub scalar: String,
}

#[derive(Serialize, Deserialize)]
pub struct MpcSignatureResponse {
    pub big_r: AffinePoint,
    pub s: ScalarValue,
    pub recovery_id: u8,
}

#[near(contract_state)]
#[derive(Default)]
pub struct MockMpc {
    fail_next: bool,
}

#[near]
impl MockMpc {
    pub fn set_fail_next(&mut self, fail: bool) {
        self.fail_next = fail;
    }

    pub fn public_key(&self) -> String {
        "secp256k1:4NfTiv3UsGahebgTaHyD9vF8KYKMBnfd6kh94mK6xv8fGBiJB8TBtFMP5WWXz6B89Ac1fbpzPwAvoyQebemHFwx3".to_string()
    }

    #[payable]
    pub fn sign(&mut self, request: SignRequestInner) -> MpcSignatureResponse {
        if env::attached_deposit() < NearToken::from_yoctonear(1) {
            env::panic_str("MOCK_MPC_MISSING_DEPOSIT");
        }
        if request.domain_id != 0 {
            env::panic_str("MOCK_MPC_UNSUPPORTED_DOMAIN");
        }
        let ecdsa_hex = request
            .payload_v2
            .and_then(|p| p.ecdsa)
            .unwrap_or_else(|| env::panic_str("MOCK_MPC_MISSING_ECDSA_PAYLOAD"));
        if ecdsa_hex.len() != 64 || !ecdsa_hex.bytes().all(|b| b.is_ascii_hexdigit()) {
            env::panic_str("MOCK_MPC_INVALID_ECDSA_HEX");
        }
        if self.fail_next || request.path == "fail-mpc" {
            self.fail_next = false;
            env::panic_str("MOCK_MPC_SIMULATED_SIGN_FAILURE");
        }

        MpcSignatureResponse {
            big_r: AffinePoint {
                affine_point: format!("03{}", ecdsa_hex.to_ascii_lowercase()),
            },
            s: ScalarValue {
                scalar: "112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00".to_string(),
            },
            recovery_id: 0,
        }
    }
}

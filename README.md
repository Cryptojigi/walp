# Walp — Onchain NEAR RLP Policy Firewall for Chain Signatures & AI Agents

Walp constrains autonomous AI-proposed cross-chain EVM transactions inside a NEAR Rust smart contract (`walp-vault`) **before** `v1.signer-prod.testnet` will co-sign the secp256k1 payload, backed by a shared onchain address reputation registry (`walp-registry`) and protocol-level `FunctionCall`-only access keys.

## Architecture Overview

1. **Onchain RLP & Calldata Firewall (`contracts/walp-vault`)**
   - Accepts raw unsigned EIP-1559 transaction bytes (`0x02 || rlp([chain_id, nonce, max_priority_fee_per_gas, max_fee_per_gas, gas_limit, to, value, data, access_list])`) via `request_intent(raw_tx_hex, path, intent_summary)`.
   - Ignores untrusted natural-language `intent_summary` strings when making security decisions; deterministically RLP-decodes `chain_id`, `to`, `value`, and `data` onchain and computes the canonical `keccak256(0x02 || rlp(...))` sighash inside the contract.
   - Screens calldata against blocked 4-byte selectors (`transferOwnership`, `upgradeTo`, `upgradeToAndCall`, customizable by owner), bounded ERC-20 `approve`/`increaseAllowance` limits (rejects allowances `>= 2^128`), and `setApprovalForAll(operator, true)`.
   - Enforces chain allowlist (`11155111` Sepolia by default), pause circuit breaker, local denylist, per-transaction cap (`max_tx_wei`), UTC-day rolling daily spend limit (`daily_limit_wei`), and human escalation (`approval_threshold_wei`).
   - Calls `walp-registry::is_denylisted` and `v1.signer-prod.testnet::sign` with `payload_v2: { Ecdsa }` and `1 yoctoNEAR` paid from vault storage/balance. Rolls back `spent_today_wei` in `on_registry_checked` and `on_mpc_sign` if async registry verification blocks or MPC signing fails.
2. **Shared Onchain Denylist Registry (`contracts/walp-registry`)**
   - Tracks reported malicious EVM addresses with `category`, `reason`, `evidence_hash`, and `reporter`. Queried cross-contract by `walp-vault` with fail-closed support.
3. **Zero-Secret Node API & React UI (`server/`, `src/`)**
   - Local Express/HTTP proxy (`server/index.ts`, port `3001`) holds `NEAR_AI_API_KEY` and signer keys strictly server-side from `.env` (never serialized to browser JS or `localStorage`).
   - Parses prompts using verified TEE models on `https://cloud-api.near.ai/v1` (default `Qwen/Qwen3.6-35B-A3B-FP8`) with regex injection-signal warnings, builds canonical unsigned EIP-1559 payloads via `ethers`, queries Sepolia counterparty bytecode/balance, and fetches **quote-only** cross-chain routes from `https://1click.chaindefuser.com/v0/quote` (`dry: true`).

---

## 1. Zero-Secret Offline Verification (Do X → See Y)

No NEAR credentials, private keys, or API keys are required to verify the Rust RLP decoder, calldata screen, NEP-297 events, `near-workspaces` sandbox execution, and TypeScript firewall/API server.

### A. Rust Contract Unit Tests (WSL2 / Linux)

**Do:**
```bash
cd contracts
cargo test --workspace --lib
```
**See:** All unit tests across `walp-vault` and `walp-registry` pass, covering canonical EIP-1559 RLP decoding and Keccak-256 sighash equality against `ethers.Transaction.unsignedSerialized`, ERC-20 `MaxUint256` approval rejection, daily spend rollover/rollback, and NEP-297 JSON schemas.

### B. Full WASM Compilation + `near-workspaces` Local Sandbox Red-Team (WSL2 / Linux)

**Do:**
```bash
chmod +x scripts/build-contracts.sh
./scripts/build-contracts.sh
cd contracts/walp-vault
cargo test --test sandbox_redteam
```
**See:**
- `contracts/out/walp_vault.wasm` and `contracts/out/walp_registry.wasm` compile cleanly for `wasm32-unknown-unknown`.
- `sandbox_redteam` spins up a local NEAR sandbox, deploys `walp-registry`, `walp-vault`, and `mock-mpc`, provisions `agent` with **zero Full-Access Keys** and a `FunctionCall(request_intent)`-only key, and verifies all 12 assertions:
  - Vector 1: Over `max_tx_wei` with spoofed `intent_summary` → Panic `WALP_EXCEEDS_MAX_TX` + `EVENT_JSON` `Denied` + zero MPC call.
  - Vector 2: Local denylisted target → Panic `WALP_TARGET_DENYLISTED` + `EVENT_JSON` `Denied`.
  - Vector 3: ERC-20 `approve(attacker, uint256::MAX)` calldata → Panic `WALP_CALLDATA_BLOCKED` + `EVENT_JSON` `Denied`.
  - Vector 4: Wrong chain bypass (`chain_id = 1`) → Panic `WALP_UNSUPPORTED_CHAIN` + `EVENT_JSON` `Denied`.
  - Vector 5: Agent attempts `set_policy` using its scoped key → Runtime/AccessKey `MethodNameMismatch` error before contract execution.
  - Vector 6: Value above `approval_threshold_wei` → Status `PENDING_APPROVAL` (`IntentProposed`), zero MPC call until owner executes `approve_intent`.
  - Vector 7: Owner calls `approve_intent` → cross-contract `walp-registry` check → `mock-mpc` signs → Status `SIGNED` (`IntentApproved`, `IntentSigned`), `spent_today_wei` updates to `"25000000000000000"`.
  - Vector 8: Shared `walp-registry` reported address → Async callback returns `DENIED` (`WALP_REGISTRY_DENYLISTED`), tentative `spent_today_wei` increment rolls back cleanly to `"25000000000000000"`.
  - Vector 9: Simulated MPC timeout/failure → Async callback returns `FAILED` (`WALP_MPC_SIGN_FAILED`), tentative `spent_today_wei` increment rolls back cleanly to `"25000000000000000"`.
  - Vector 10: Zero-Full-Access-Key `FunctionCall`-only agent key attaches `1 yoctoNEAR` → Runtime `DepositWithFunctionCall` protocol rejection before contract execution.
  - Vector 11: Unlisted ERC-20 `transfer` (`0xa9059cbb`) escalates to `PENDING_APPROVAL` (`WALP_UNLISTED_CONTRACT_CALL`), then executes autonomously (`SIGNED`) after owner adds the token contract via `add_allowlist`.
  - Vector 12: Owner enables emergency pause (`toggle_pause(true)`) → Subsequent `request_intent` fails with panic `WALP_PAUSED`.

### C. TypeScript Typecheck, Build & Vitest Suite

**Do:**
```bash
npm install
npm run typecheck
npm test
npm run build
```
**See:** `tsc --noEmit` and `tsc -p tsconfig.server.json --noEmit` exit `0`, Vitest passes all 15 tests across `tests/firewall_and_rlp.test.ts` and `tests/server_api.test.ts`, and `vite build` produces `dist/`.

---

## 2. Live NEAR Testnet Deployment (1 Funded Owner Account)

**Do:**
1. Copy `.env.example` to `.env` and populate `NEAR_OWNER_ACCOUNT_ID`, `NEAR_OWNER_PRIVATE_KEY`, and optionally `NEAR_AI_API_KEY`:
   ```bash
   cp .env.example .env
   ```
   *(Never commit `.env` or any Full-Access private key.)*
2. Build contract WASMs (via WSL2 on Windows or bash on Linux):
   ```bash
   wsl bash -lc "./scripts/build-contracts.sh"
   ```
3. Preview deployment plan cleanly without broadcasting:
   ```bash
   npx tsx scripts/setup-scoped-key.ts --dry-run --owner <your-owner.testnet>
   ```
4. Deploy `walp-registry.<owner>`, deploy & initialize `walp-vault.<owner>`, seed a local denylist entry for Vector 2, create `agent.<owner>` with a **single `FunctionCall(request_intent)` access key** (deleting its temporary Full-Access Key in the same batched transaction), and derive the vault's Sepolia MPC address:
   ```bash
   npm run setup-vault
   ```
**See:** Terminal prints `WALP_VAULT_CONTRACT_ID`, `WALP_REGISTRY_CONTRACT_ID`, `NEAR_AGENT_ACCOUNT_ID`, the capped `NEAR_AGENT_PRIVATE_KEY`, and the derived Sepolia address on `v1.signer-prod.testnet`.

---

## 3. Demo / Red-Team Key (Live Testnet Reproducibility)

Walp is live on NEAR Testnet with a **deliberately capped, zero-Full-Access-Key `FunctionCall`-only demo key** scoped exclusively to `request_intent` on `walp-vault.walp-vault.testnet` so judges and external reviewers can reproduce real onchain rejections directly against NEAR Testnet without creating accounts or holding funds.

> **Credential Boundary:** `NEAR_OWNER_PRIVATE_KEY` and `NEAR_AI_API_KEY` stay strictly local in `.env` and are never committed or published. The credential below (`agent.walp-vault.testnet`) has **zero Full-Access Keys onchain** and cannot deploy code, transfer NEAR, attach deposits, modify policy, or approve queued intents.

```text
WALP_VAULT_CONTRACT_ID=walp-vault.walp-vault.testnet
WALP_REGISTRY_CONTRACT_ID=walp-registry.walp-vault.testnet
NEAR_AGENT_ACCOUNT_ID=agent.walp-vault.testnet
NEAR_AGENT_PUBLIC_KEY=ed25519:EyMCXpEPzKhxGMpbnFiSHgyHhY55dcQqs6M1ubJZiVS8
NEAR_AGENT_DEMO_FUNCTION_CALL_KEY=ed25519:3q9DoMQpcC9TqvhXEMQsH5MzQLonYXDY8xZF9rVwa5C8mSFqy5ftmEX39L84C6j4qCXLJXPpwMMZuUbUviSKrS3A
VAULT_DERIVED_SEPOLIA_ADDRESS=0xeB54A733E0c1A63d8bdDb79dcb65DA9abf9e2566
```

- Verified deployment receipts on NEAR Testnet:
  - Registry initialized (`walp-registry.walp-vault.testnet`): `https://testnet.nearblocks.io/txns/FnUS1rFi5p935asuxQ4NafrDtfFH1YRdvK8xvsLXiy5e`
  - Vault deployed & initialized (`walp-vault.walp-vault.testnet`): `https://testnet.nearblocks.io/txns/FPU64cZ8ExhnihrWhcgmTWVH73RryV7KmLo3mrpyuRtb`

### Exact Capability Boundary of the Scoped Demo Key

| Capability | Allowed? | Enforcement Layer |
| :--- | :---: | :--- |
| Call `walp-vault::request_intent` with `0 NEAR` attached (`gas` only, capped by `0.5 NEAR` key allowance) | **YES** | NEAR AccessKey `FunctionCallPermission` |
| Execute autonomous transfers strictly within `max_tx_wei`, `daily_limit_wei`, `approval_threshold_wei`, and chain allowlist | **YES** | `walp-vault` Rust policy + RLP decoder |
| Escalate transfers between `approval_threshold_wei` and `max_tx_wei` into `PENDING_APPROVAL` | **YES** | `walp-vault` queue (does not invoke MPC) |
| Call `set_policy`, `toggle_pause`, `approve_intent`, `reject_intent`, `add_denylist`, or `remove_denylist` | **NO** | NEAR RPC `InvalidAccessKeyError(MethodNameMismatch)` + onchain `WALP_UNAUTHORIZED_OWNER_ONLY` |
| Attach NEAR deposit (`> 0 yoctoNEAR`), deploy contract WASM, transfer NEAR, or add/delete account keys | **NO** | Account has **zero Full-Access Keys** onchain (`DeleteKey` executed during provisioning) |
| Move funds on `chain_id != 11155111`, to denylisted addresses, or via `approve(..., MaxUint256)` | **NO** | `walp-vault` Rust panic + NEP-297 `Denied` log |

### Live Red-Team Reproduction Command

**Do:**
```bash
npx tsx scripts/attack-demo.ts \
  --contract walp-vault.walp-vault.testnet \
  --agent agent.walp-vault.testnet \
  --key ed25519:3q9DoMQpcC9TqvhXEMQsH5MzQLonYXDY8xZF9rVwa5C8mSFqy5ftmEX39L84C6j4qCXLJXPpwMMZuUbUviSKrS3A
```
*(In Windows PowerShell, use `npx.cmd tsx ...` or `npm.cmd run attack-demo` when `.env` is populated. Run `npx tsx scripts/attack-demo.ts --print-vectors` offline to inspect the canonical EIP-1559 payloads.)*

**See:** Terminal runs Vectors 1–6 against live NEAR Testnet and prints `[PASS]` alongside Explorer links and exact observed rejections:
- Vector 1 (Over `max_tx_wei` with spoofed `"Send 0.0001 ETH"` summary): Execution failure `WALP_EXCEEDS_MAX_TX: Decoded value 1050000000000000000 > max_tx_wei 50000000000000000` and `EVENT_JSON` `Denied` (`https://testnet.nearblocks.io/txns/7hLGWGUegGHDdoSbQfWvmeBQBJ46nif9M53dyCsVvyyx`).
- Vector 2 (Denylisted target `0xdead...0001`): Execution failure `WALP_TARGET_DENYLISTED` and `EVENT_JSON` `Denied` (`https://testnet.nearblocks.io/txns/7PqBVpJFnFeCvRvCcmXCaeDJaWuNFKWi5vKkjjVquwZx`).
- Vector 3 (ERC-20 `approve(attacker, MaxUint256)`): Execution failure `WALP_CALLDATA_BLOCKED: Unlimited or >= 2^128 ERC-20 allowance blocked for selector 0x095ea7b3` and `EVENT_JSON` `Denied` (`https://testnet.nearblocks.io/txns/Eej5nBHuuRM8RVYfymsM2VEH4uxYKhrdisX5q3r5B3LF`).
- Vector 4 (`chain_id = 1` Ethereum Mainnet bypass): Execution failure `WALP_UNSUPPORTED_CHAIN: Decoded chain_id 1 not in allowed_chain_ids [11155111]` and `EVENT_JSON` `Denied` (`https://testnet.nearblocks.io/txns/6fskv5FacMsdfQLJXCHd8iBXcFRGjpUKXjqn4KGDkygA`).
- Vector 5 (`set_policy` privilege escalation): NEAR RPC rejection `InvalidAccessKeyError` / `MethodNameMismatch`.
- Vector 6 (Amount between `approval_threshold_wei` and `max_tx_wei`): Succeeds with `status: "PENDING_APPROVAL"` and `EVENT_JSON` `IntentProposed` (`reason_code: "WALP_THRESHOLD_ESCALATED"`), confirming `v1.signer-prod.testnet` was NOT called (`https://testnet.nearblocks.io/txns/FEwbrTx7dwF8MWorJDCX6JFcVbwGcxsH42EzJPLKzMaD`).

### Live Autonomous Agent SDK Execution Command

Any external AI agent (ElizaOS, LangChain, or custom bot) can import `WalpAgentWallet` from `agent/connector.ts` to request policy-enforced EVM transfers with zero Ethereum private keys.

**Do:**
```bash
npm run run-agent
```
**See:** Terminal connects to `walp-vault.walp-vault.testnet` using `agent.walp-vault.testnet`, demonstrates onchain attack rejection (5 ETH over cap, tx [BVwPeB69...](https://testnet.nearblocks.io/txns/BVwPeB69ybsNd9pYHcVeyAdSK3DMkaMawTFPu33Yz8fJ)), executes a compliant 0.0001 ETH transfer co-signed by `v1.signer-prod.testnet` (tx [J9eg81zV...](https://testnet.nearblocks.io/txns/J9eg81zVNBq9QVPAYxaQfWXpJy5ZnDSzaARpSHdjvNc7)), and broadcasts live to Ethereum Sepolia (tx [0x38e4c67b...](https://sepolia.etherscan.io/tx/0x38e4c67b034fa690a5276354efaa3b892fe62bff6e7fccc8753d7425bc7599d6)).

---

## 4. Run Local Console UI (Do X → See Y)

**Do:**
```bash
npm run dev
```
Open `http://127.0.0.1:5173`.

**See:**
- **Account Card**: Displays live NEAR balance of `WALP_VAULT_CONTRACT_ID`, real derived `secp256k1` EVM address from `v1.signer-prod.testnet::derived_public_key`, and Sepolia balance.
- **Intent Console**: Type a prompt (e.g., `"Send 0.0001 Sepolia ETH to 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"` or click a red-team attack preset), inspect the deterministic RLP build (`rawTxHex` + `sighashHex`), pre-flight `simulate_policy` + Sepolia counterparty check, and execute `request_intent` cleanly. Returns real NEAR Explorer links, NEP-297 JSON event logs, and Sepolia tx hashes when signed and broadcast.
- **Policy & Control Center**: Manage limits/pause/denylists/allowlists (when `NEAR_OWNER_PRIVATE_KEY` is present in `.env`), approve/reject queued intents, view `walp-registry` entries, inspect real audit events, and run **1Click Intents dry-run quotes** (`dry: true`).

---

## 5. NEP-297 Structured Events (`standard: "walp_vault"`, `version: "1.0.0"`)

| Event | Emitted When | Key Payload Fields |
| :--- | :--- | :--- |
| `IntentProposed` | Autonomous-eligible intent or escalated intent enters pipeline | `intent_id`, `proposer`, `chain_id`, `to`, `value_wei`, `sighash_hex`, `calldata_selector`, `requires_approval`, `reason_code`, `path`, `timestamp_ns` |
| `IntentApproved` | Owner approves a `PENDING_APPROVAL` intent and fires MPC sign | `intent_id`, `approver`, `chain_id`, `to`, `value_wei`, `reason_code`, `timestamp_ns` |
| `IntentRejected` | Owner explicitly rejects a `PENDING_APPROVAL` intent | `intent_id`, `actor`, `to`, `value_wei`, `reason_code`, `note`, `timestamp_ns` |
| `IntentSigned` | Async MPC callback receives valid `big_r`, `s`, `recovery_id` | `intent_id`, `chain_id`, `to`, `value_wei`, `sighash_hex`, `big_r`, `s`, `recovery_id`, `spent_today_wei`, `timestamp_ns` |
| `PolicyUpdated` | Owner updates limits, pause flag, registry link, allowlist, or denylist | `actor`, `action`, `paused`, `max_tx_wei`, `daily_limit_wei`, `approval_threshold_wei`, `allowed_chain_ids`, `registry_contract_id`, `target_address`, `note`, `timestamp_ns` |
| `Denied` | Pre-MPC rule panic, async `walp-registry` block, or MPC failure rollback | `intent_id`, `proposer`, `chain_id`, `to`, `value_wei`, `reason_code`, `detail`, `timestamp_ns` |

Canonical reason codes: `WALP_PAUSED`, `WALP_RLP_INVALID`, `WALP_UNSUPPORTED_CHAIN`, `WALP_TARGET_DENYLISTED`, `WALP_REGISTRY_DENYLISTED`, `WALP_CALLDATA_BLOCKED`, `WALP_EXCEEDS_MAX_TX`, `WALP_EXCEEDS_DAILY_LIMIT`, `WALP_THRESHOLD_ESCALATED`, `WALP_UNLISTED_CONTRACT_CALL`, `WALP_WITHIN_AUTONOMOUS_POLICY`, `WALP_OWNER_APPROVED`, `WALP_OWNER_REJECTED`, `WALP_MPC_SIGN_FAILED`, `WALP_UNAUTHORIZED_OWNER_ONLY`, `WALP_INTENT_NOT_FOUND`, `WALP_INVALID_INTENT_STATE`, `WALP_INSUFFICIENT_GAS`.

---

## 6. Third-Party Libraries, APIs & Disclosures

- **License**: MIT ([LICENSE](LICENSE))
- **Rust Smart Contract Crates**: `near-sdk 5.30.1`, `serde`, `serde_json`, plus dev-dependency `near-workspaces 0.24.0` (with `tokio`, `hex`) for offline sandbox testing.
- **TypeScript / Frontend Libraries**: `ethers ^6.13.4` (EIP-1559 encoding, Keccak-256, `Signature` recovery), `near-api-js ^4.0.4` (NEAR RPC & Testnet transactions), `react`, `vite`, `tailwindcss`, `lucide-react`, `vitest`, `tsx`.
- **External APIs & Protocols Used**:
  - **NEAR Testnet RPC** (`https://test.rpc.fastnear.com`, `https://rpc.testnet.near.org`): Contract calls, views, and key inspection.
  - **NEAR Chain Signatures MPC** (`v1.signer-prod.testnet`): Derived EVM address (`derived_public_key`) and secp256k1 co-signing (`sign` with `payload_v2: { Ecdsa }`).
  - **NEAR AI Cloud TEE API** (`https://cloud-api.near.ai/v1/chat/completions`, `/v1/models`): Optional TEE-backed natural language intent parsing (default `Qwen/Qwen3.6-35B-A3B-FP8`); deterministic parser fallback runs automatically if `NEAR_AI_API_KEY` is unset.
  - **Ethereum Sepolia RPCs** (`https://ethereum-sepolia-rpc.publicnode.com`, `https://1rpc.io/sepolia`, `https://sepolia.drpc.org`): Counterparty bytecode check, nonces, gas estimates, and signed tx broadcast.
  - **NEAR 1Click Intents API** (`https://1click.chaindefuser.com/v0/tokens`, `/v0/quote`): Asset discovery and **mainnet `dry: true` quote previews only** (1Click has no testnet environment; quote requests are read-only previews and transfer zero funds).

---

## Development Disclosure (Q-005)

Third-party libraries and APIs are listed in section 6.  
AI coding assistance was used during development; all on-chain logic, RLP decoding, policy enforcement, and red-team vectors were reviewed and verified against live NEAR Testnet and Sepolia before submission.


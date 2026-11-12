#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS_DIR="$ROOT_DIR/contracts"
OUT_DIR="$CONTRACTS_DIR/out"

if [ -f "$HOME/.cargo/env" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi

mkdir -p "$OUT_DIR"
cd "$CONTRACTS_DIR"

echo "[walp] Building walp-vault and walp-registry for wasm32-unknown-unknown..."
if command -v cargo-near >/dev/null 2>&1; then
  (cd walp-vault && cargo near build non-reproducible-wasm --no-abi)
  (cd walp-registry && cargo near build non-reproducible-wasm --no-abi)
  cp -f target/near/walp_vault/walp_vault.wasm "$OUT_DIR/walp_vault.wasm"
  cp -f target/near/walp_registry/walp_registry.wasm "$OUT_DIR/walp_registry.wasm"
else
  RUSTFLAGS='-C link-arg=-s' cargo build --target wasm32-unknown-unknown --release -p walp-vault -p walp-registry
  cp -f target/wasm32-unknown-unknown/release/walp_vault.wasm "$OUT_DIR/walp_vault.wasm"
  cp -f target/wasm32-unknown-unknown/release/walp_registry.wasm "$OUT_DIR/walp_registry.wasm"
fi

ls -lh "$OUT_DIR"/*.wasm

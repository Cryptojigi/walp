# Walp: Autonomous Cross-Chain Execution Protocol
### *Powered by NEAR Protocol Chain Signatures (MPC) & NEAR Intents*

Built for the **NEAR Protocol Hackathon 2026**  
**Target Tracks:** *Agent Economy* · *Autonomous Business* · *Unstoppable DeFi* · *Open Innovation*

---

## 🌟 Overview

**Walp** is a full working decentralized application and autonomous agent hub that demonstrates NEAR's ultimate competitive edge: **Chain Abstraction via Chain Signatures**.

Using Walp, a single NEAR account (`alice.testnet`) mathematically controls native assets on foreign blockchains (such as Ethereum Sepolia and Bitcoin) without bridges, wrapped tokens, or storing foreign private keys.

Through an AI Intent Engine, users or autonomous relayers issue natural-language instructions (e.g. *"Transfer 0.001 ETH to 0x742d... on Sepolia"* or *"Automated Treasury Rebalance"*). Walp compiles the raw EIP-1559 transaction, calls NEAR's decentralized threshold MPC network (`v1.signer-prod.testnet`), reconstructs the ECDSA signature, and broadcasts the signed transaction directly to the target network with verifiable onchain confirmation.

---

## 🏗️ Architecture

```
+-------------------------------------------------------------+
|                  Walp Web Client (React + Vite)             |
|                                                             |
|  [Intent Console]        [Dual-Chain Identity Card]         |
|  - Natural Language      - NEAR Account (alice.testnet)     |
|  - One-Click Presets     - Derived Sepolia (0x90dF...8257)  |
+------------------------------+------------------------------+
                               |
                               v
+-------------------------------------------------------------+
|               NEAR Protocol (Testnet)                       |
|                                                             |
|  1. Additive Key Derivation (AKD):                          |
|     P_derived = P_root + H(account_id, path) * G            |
|                                                             |
|  2. Threshold MPC Contract (v1.signer-prod.testnet):        |
|     sign({ payload: [32-byte sighash], path, key_version }) |
|                                                             |
|  3. Decentralized Node Cluster:                             |
|     Returns (big_r, s, recovery_id)                         |
+------------------------------+------------------------------+
                               |
                               v
+-------------------------------------------------------------+
|              Ethereum Sepolia (Destination)                 |
|                                                             |
|  1. Reassemble ECDSA Signature (r, s, v)                    |
|  2. Broadcast Raw EIP-1559 Transaction to Sepolia RPC       |
|  3. Verifiable Confirmation on Sepolia Etherscan            |
+-------------------------------------------------------------+
```

---

## 🚀 Key Features

1. **Deterministic Additive Key Derivation (AKD)**:
   - Derives native child public keys and Ethereum addresses on the `secp256k1` curve via onchain view queries to `v1.signer-prod.testnet`.
   - Supports custom derivation paths (`ethereum-1`, `ethereum-2`, etc.).

2. **Autonomous Intent Engine**:
   - Parses plain-English commands into structured blockchain execution plans with confidence scoring.
   - Includes quick-start demo presets: *Sepolia Self-Ping*, *Vitalik Tribute*, and *Verifiable Zero-Burn*.

3. **5-Stage Real-Time Cryptographic Pipeline Tracker**:
   - Visual progress modal detailing each execution phase:
     1. Build EIP-1559 Transaction & Keccak-256 sighash
     2. Call NEAR MPC Contract (`v1.signer-prod.testnet`)
     3. Collect threshold MPC node shares (`r`, `s`, `recovery_id`)
     4. Assemble valid raw RLP payload
     5. Broadcast to Ethereum Sepolia RPC & confirm on Etherscan

4. **Instant Testnet Sandbox / Keypair Onboarding**:
   - Includes an in-app generator to create and test ed25519 NEAR keypairs with zero onboarding friction for hackathon judges.

5. **Autonomous Relayer Daemon (`agent/relayer.ts`)**:
   - Standalone background worker that monitors cross-chain intents and automates scheduled execution without human intervention.

---

## 🛠️ Tech Stack

- **Blockchain Networks**: NEAR Protocol (Testnet), Ethereum Sepolia (Testnet)
- **MPC Infrastructure**: NEAR Chain Signatures (`v1.signer-prod.testnet`)
- **Frontend Framework**: React 18, Vite 5, TypeScript, Tailwind CSS
- **Cryptography & Web3 Libraries**: `near-api-js`, `ethers.js` v6, `@noble/curves`, `js-sha256`
- **Icons & UI**: Lucide React

---

## ⚡ Quick Start

### Prerequisites
- Node.js v18+ (tested on Node v24)
- npm v10+

### 1. Installation
```bash
npm.cmd install
```

### 2. Run the Development Server
```bash
npm.cmd run dev
```
Open `http://localhost:5173` in your browser.

### 3. Build for Production
```bash
npm.cmd run build
```

### 4. Run the Autonomous Relayer Daemon
```bash
npx.cmd tsx agent/relayer.ts
```

---

## 📋 Hackathon Submission Guide

| Requirement | Walp Implementation |
| :--- | :--- |
| **Public Code Repository** | Complete codebase organized in `walp` |
| **Working Demo** | Fully functional local dev & production build (`dist/`) |
| **Demo Post on X** | Showcase video/screenshots demonstrating NEAR MPC signing a Sepolia transaction |
| **NEAR Technologies Used** | NEAR Chain Signatures (`v1.signer-prod.testnet`), NEAR Intents, Account Abstraction |

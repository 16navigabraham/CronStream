# CronStream — Hackathon Resources

> Arbitrum Open House London Buildathon | Deadline: June 14, 2026 11:59PM BST

---

## Deployed Contracts

| Network | Chain ID | Contract Address | Explorer |
|---|---|---|---|
| Arbitrum Sepolia | 421614 | `0x3feb14d164EaA05a85e0276321E4F090a03549f9` | [Arbiscan](https://sepolia.arbiscan.io/address/0x3feb14d164EaA05a85e0276321E4F090a03549f9) |
| Robinhood Chain Testnet | 46630 | `0x3feb14d164EaA05a85e0276321E4F090a03549f9` | [Explorer](https://explorer.testnet.chain.robinhood.com/address/0x3feb14d164EaA05a85e0276321E4F090a03549f9) |

---

## Faucets

### Ethereum Sepolia (bridge to Arbitrum Sepolia)
- https://sepoliafaucet.com/
- https://arbitrum.faucet.dev/
- https://www.infura.io/faucet/sepolia
- https://sepolia-faucet.pk910.de/

### Arbitrum Sepolia ETH
- https://arbitrum.faucet.dev/
- https://faucet.quicknode.com/arbitrum/sepolia
- https://www.l2faucet.com/arbitrum

### Arbitrum Sepolia USDC ⚠️ needed for stream demos
- https://faucet.circle.com/
- Select **Arbitrum Sepolia**, paste deployer wallet address
- Required for `createStream` and `withdrawFromStream` end-to-end demos

### Robinhood Chain Testnet ETH + Stock Tokens
- https://faucet.testnet.chain.robinhood.com/
- Sends **0.01 ETH** + **5 of each Stock Token** (tokenized AAPL, TSLA, etc.)
- Claim once per 24 hours
- Chain ID: **46630** | Explorer: https://explorer.testnet.chain.robinhood.com
- Stock Tokens are ERC-20 — CronStream can stream them as contractor pay out of the box

---

## RPC Endpoints

| Network | RPC |
|---|---|
| Arbitrum One (mainnet) | https://arb1.arbitrum.io/rpc |
| Arbitrum One (alt) | https://rpc.ankr.com/arbitrum |
| Arbitrum One (alt) | https://arbitrum.llamarpc.com |
| Arbitrum Sepolia (testnet) | https://sepolia-rollup.arbitrum.io/rpc |
| Robinhood Chain (testnet) | `https://rpc.testnet.chain.robinhood.com` (public, rate-limited) |
| Robinhood Chain (testnet, Alchemy) | `https://robinhood-testnet.g.alchemy.com/v2/<YOUR_API_KEY>` (recommended) |

---

## Developer Documentation

| Resource | Link |
|---|---|
| Arbitrum Docs | https://docs.arbitrum.io/ |
| Get started with Arbitrum | https://docs.arbitrum.io/getting-started |
| Get started with Robinhood Chain | TBD |
| Gentle intro to Arbitrum | https://docs.arbitrum.io/intro |
| Quickstart: Solidity dApp | https://docs.arbitrum.io/build-decentralized-apps/quickstart-solidity-hardhat |
| Quickstart: Rust/Stylus | https://docs.arbitrum.io/stylus/quickstart |
| Gentle intro: Stylus | https://docs.arbitrum.io/stylus/gentle-introduction |
| Run a local Nitro dev node | https://docs.arbitrum.io/node-running/how-tos/local-dev-node |
| Arbitrum bridge | https://docs.arbitrum.io/bridge-tokens/overview |
| Third-party RPCs, Indexers, Oracles | https://docs.arbitrum.io/build-decentralized-apps/third-party-docs/overview |
| Arbitrum FAQ | https://docs.arbitrum.io/faqs/developer-faqs |

---

## SDKs & Tools

| Tool | Link | Relevance to CronStream |
|---|---|---|
| Arbitrum SDK | https://github.com/OffchainLabs/arbitrum-sdk | Bridging, L2 interactions |
| OpenZeppelin Solidity | https://github.com/OpenZeppelin/openzeppelin-contracts | Already used — AccessControl, SafeERC20, ECDSA |
| ZeroDev | https://docs.zerodev.app/ | Account abstraction — gasless stream creation for companies |
| Stylus CLI | https://github.com/OffchainLabs/cargo-stylus | Rust contract tooling (future) |
| Stylus Rust SDK | https://github.com/OffchainLabs/stylus-sdk-rs | Rust contract tooling (future) |
| OpenZeppelin Rust | https://github.com/OpenZeppelin/rust-contracts-stylus | OZ for Stylus (future) |

---

## Hackathon Schedule

| Date | Time (BST) | Event | Action |
|---|---|---|---|
| May 25 | 11:00AM | Buildathon Kickoff | ✅ Started |
| May 25 | 12:00PM | Builder speed dating | Network |
| May 27 | 11:00AM | Feedback session #1 | Show deployed contract |
| May 28 | 11:00AM | Getting started with Arbitrum | Attend |
| May 28 | 3:00PM | Workshop: Smart Contract Security Pitfalls | Attend — audit CronStreamRouter |
| May 29 | 11:00AM | Feedback session #2 | Show agent-node running |
| June 1 | 11:00AM | Workshop: Agentic Dev — ERC-8004 agent registry | **Critical** — align agent-node |
| June 1 | 11:30AM | Workshop: Agentic payments with x402 | **Critical** — wire x402 into agent |
| June 2 | 5:00PM | Workshop: Introduction to Robinhood Chain | Get RPC + chain ID, deploy |
| June 3 | 4:00PM | Feedback session #3 | Show full end-to-end flow |
| June 4 | 11:00AM | Workshop: Building on GMX | Attend |
| June 4 | 1:00PM | Workshop: Crypto apps that don't feel like crypto | UX inspiration |
| June 5 | 11:00AM | Workshop: Game Theory for Founders | Attend |
| June 5 | 4:00PM | Feedback session #4 | Polish |
| June 8 | 11:00AM | Feedback session #5 | Final feedback |
| June 9 | 11:00AM | Workshop: Governance on Arbitrum | Attend |
| June 10 | 11:00AM | Workshop: OIF + Broadcaster — user onboarding | UX reference |
| **June 14** | **11:59PM** | **Submission deadline** | **Ship it** |
| June 18 | — | Winners announced | |

---

## Prize Tracks

| Track | Prize | Strategy |
|---|---|---|
| Overall Best | $70,000 | Full protocol — contract + agent + frontend |
| Agentic | $15,000 | Agent-node + ERC-8004 registration + x402 payments |
| Robinhood Chain | Reserved slot | Deploy on Robinhood testnet after June 2 workshop |
| Grants | $30,000 | Apply post-hackathon |

---

## Deploy Checklist

- [ ] Get Arbitrum Sepolia ETH from faucet
- [ ] Get Arbitrum Sepolia USDC from `faucet.circle.com`
- [ ] Get Robinhood Chain testnet ETH from `faucet.testnet.chain.robinhood.com`
- [ ] Deploy to Arbitrum Sepolia — `forge script script/Deploy.s.sol --rpc-url arbitrum_sepolia --broadcast --verify`
- [ ] Copy deployed address into `agent-node/.env` → `CONTRACT_ADDRESS`
- [ ] Fund agent-node signing wallet with Sepolia ETH (for gas on extensions)
- [ ] Host agent-node publicly (Railway / Render / Fly.io free tier)
- [ ] Register webhook on GitHub repo → agent-node public URL
- [ ] Attend June 2 workshop → get Robinhood Chain RPC + chain ID
- [ ] Deploy to Robinhood Chain testnet
- [ ] Submit before June 14 11:59PM BST

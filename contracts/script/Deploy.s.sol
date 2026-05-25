// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {CronStreamRouter} from "../src/CronStreamRouter.sol";

/**
 * @title  Deploy
 * @notice Foundry deployment script for CronStreamRouter.
 *
 * Usage — Arbitrum Sepolia:
 *   forge script script/Deploy.s.sol \
 *     --rpc-url arbitrum_sepolia \
 *     --broadcast \
 *     --verify \
 *     -vvvv
 *
 * Usage — Robinhood Chain (once RPC is available):
 *   forge script script/Deploy.s.sol \
 *     --rpc-url robinhood \
 *     --broadcast \
 *     -vvvv
 *
 * Required environment variables (set in .env or shell):
 *   DEPLOYER_PRIVATE_KEY   — wallet funding the deployment tx
 *   ADMIN_ADDRESS          — address granted all admin roles
 *   AGENT_SIGNER_ADDRESS   — address of the agent-node signing wallet
 *   FEE_RECIPIENT_ADDRESS  — address that receives protocol fees
 *   FEE_BPS                — initial fee in basis points (e.g. 50 = 0.5%)
 *   ETHERSCAN_API_KEY      — for --verify on Arbiscan
 */
contract Deploy is Script {

    function run() external {
        // ── Load config from environment ──────────────────────────────────
        uint256 deployerKey     = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address admin           = vm.envAddress("ADMIN_ADDRESS");
        address agentSigner     = vm.envAddress("AGENT_SIGNER_ADDRESS");
        address feeRecipient    = vm.envAddress("FEE_RECIPIENT_ADDRESS");
        uint256 feeBps          = vm.envUint("FEE_BPS");

        // ── Sanity checks before spending gas ────────────────────────────
        require(admin        != address(0), "Deploy: ADMIN_ADDRESS not set");
        require(agentSigner  != address(0), "Deploy: AGENT_SIGNER_ADDRESS not set");
        require(feeRecipient != address(0), "Deploy: FEE_RECIPIENT_ADDRESS not set");
        require(feeBps       <= 500,        "Deploy: FEE_BPS exceeds 500 (5%)");

        address deployer = vm.addr(deployerKey);

        console.log("===========================================");
        console.log(" CronStream Deployment");
        console.log("===========================================");
        console.log(" Deployer:      ", deployer);
        console.log(" Admin:         ", admin);
        console.log(" Agent signer:  ", agentSigner);
        console.log(" Fee recipient: ", feeRecipient);
        console.log(" Fee bps:       ", feeBps);
        console.log(" Chain ID:      ", block.chainid);
        console.log("===========================================");

        // ── Deploy ────────────────────────────────────────────────────────
        vm.startBroadcast(deployerKey);

        CronStreamRouter router = new CronStreamRouter(
            agentSigner,
            feeBps,
            feeRecipient,
            admin
        );

        vm.stopBroadcast();

        // ── Post-deploy log ───────────────────────────────────────────────
        console.log("===========================================");
        console.log(" Deployed CronStreamRouter");
        console.log(" Address: ", address(router));
        console.log("===========================================");
        console.log(" Next steps:");
        console.log("  1. Copy address above into agent-node .env CONTRACT_ADDRESS");
        console.log("  2. Verify: forge verify-contract <address> src/CronStreamRouter.sol:CronStreamRouter");
        console.log("  3. Fund the agent signer wallet with ETH for gas");
        console.log("===========================================");
    }
}

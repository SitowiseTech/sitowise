// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {SitowiseFactory} from "../src/SitowiseFactory.sol";

/// Deploys SitowiseFactory. Run from the DEPLOYER key (wallet 1) — that key
/// becomes `owner`, so it should be a cold key kept off the server.
///
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url https://rpc.mainnet.chain.robinhood.com \
///     --private-key $DEPLOYER_PRIVATE_KEY --broadcast
contract Deploy is Script {
    function run() external returns (SitowiseFactory factory) {
        address relayer = vm.envAddress("RELAYER_ADDRESS");
        address distributor = vm.envAddress("DISTRIBUTOR_ADDRESS");

        // The relayer and distributor keys both live on the server. Letting
        // either equal the owner would put the cold key online, so refuse.
        address deployer = msg.sender;
        require(relayer != deployer, "relayer must not be the deployer/owner");
        require(distributor != deployer, "distributor must not be the deployer/owner");

        vm.startBroadcast();
        factory = new SitowiseFactory(relayer, distributor);
        vm.stopBroadcast();

        console.log("SitowiseFactory :", address(factory));
        console.log("owner          :", factory.owner());
        console.log("relayer        :", factory.relayer());
        console.log("distributor    :", factory.distributor());
        console.log("maxPerWallet   :", factory.maxPerWallet());
    }
}

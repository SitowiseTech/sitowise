// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {SitowiseHook} from "../src/SitowiseHook.sol";

/// @notice Finds a CREATE2 salt that puts SitowiseHook at an address whose low
///         14 bits equal 0x44 (afterSwap | afterSwapReturnDelta).
///
///         Uniswap v4 reads a hook's permissions from its address, so the
///         address is not a detail of deployment, it IS the configuration. The
///         hook's constructor calls `validateFlags()`, so deploying to an
///         unmined address reverts rather than producing a hook the manager
///         will silently refuse to call.
///
///         Run:
///           forge script script/MineHook.s.sol --sig "run(address,address)" \
///             <poolManager> <factory>
///
///         Then deploy with the printed salt through the canonical CREATE2
///         factory at 0x4e59b44847b379578588920cA78FbF26c0B4956C:
///           cast send 0x4e59b44847b379578588920cA78FbF26c0B4956C \
///             <salt ++ initcode> --private-key $PK --rpc-url $RPC
contract MineHook is Script {
    // CREATE2_FACTORY is inherited from forge-std's Base and is the canonical
    // 0x4e59b448... deterministic deployer.
    uint160 internal constant ALL_HOOK_MASK = uint160((1 << 14) - 1);
    uint160 internal constant REQUIRED_FLAGS = uint160((1 << 6) | (1 << 2));

    function run(address poolManager, address factory) external pure {
        bytes memory initCode =
            abi.encodePacked(type(SitowiseHook).creationCode, abi.encode(poolManager, factory));
        bytes32 initCodeHash = keccak256(initCode);

        for (uint256 salt = 0; salt < 500_000; ++salt) {
            address candidate = _create2(bytes32(salt), initCodeHash);
            if (uint160(candidate) & ALL_HOOK_MASK == REQUIRED_FLAGS) {
                console.log("salt      ", salt);
                console.log("address   ", candidate);
                console.log("flags     ", uint160(candidate) & ALL_HOOK_MASK);
                console.logBytes32(initCodeHash);
                return;
            }
        }
        revert("no salt found in range");
    }

    function _create2(bytes32 salt, bytes32 initCodeHash) internal pure returns (address) {
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), CREATE2_FACTORY, salt, initCodeHash))))
        );
    }
}

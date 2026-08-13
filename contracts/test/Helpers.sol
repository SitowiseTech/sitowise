// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SitowiseFactory} from "../src/SitowiseFactory.sol";

/// @dev Plain contract that refuses every incoming ETH transfer.
contract RejectsETH {
    error No();

    receive() external payable {
        revert No();
    }
}

/// @dev Contract with no receive/fallback at all: `call` with value fails.
contract NoReceive {
    uint256 public x;
}

/// @dev Re-enters `withdraw(id, to)` from its receive hook.
///      The re-entry is wrapped in try/catch so the OUTER withdraw still
///      succeeds; that is what lets us prove the attacker is paid exactly once.
contract ReentrantWithdrawer {
    SitowiseFactory public immutable f;
    uint256 public id;
    uint256 public reenterCount;
    uint256 public reenterSucceeded;
    bool public swallow = true;

    constructor(SitowiseFactory f_) {
        f = f_;
    }

    function setId(uint256 id_) external {
        id = id_;
    }

    function setSwallow(bool v) external {
        swallow = v;
    }

    function go() external {
        f.withdraw(id, address(this));
    }

    receive() external payable {
        if (reenterCount >= 3) return;
        reenterCount++;
        if (swallow) {
            try f.withdraw(id, address(this)) {
                reenterSucceeded++;
            } catch {}
        } else {
            f.withdraw(id, address(this));
            reenterSucceeded++;
        }
    }
}

/// @dev Re-enters `withdrawAll(to)` from its receive hook.
contract ReentrantWithdrawAll {
    SitowiseFactory public immutable f;
    uint256 public reenterCount;
    uint256 public reenterSucceeded;
    bool public swallow = true;

    constructor(SitowiseFactory f_) {
        f = f_;
    }

    function setSwallow(bool v) external {
        swallow = v;
    }

    function go() external returns (uint256) {
        return f.withdrawAll(address(this));
    }

    receive() external payable {
        if (reenterCount >= 3) return;
        reenterCount++;
        if (swallow) {
            try f.withdrawAll(address(this)) {
                reenterSucceeded++;
            } catch {}
        } else {
            f.withdrawAll(address(this));
            reenterSucceeded++;
        }
    }
}

/// @dev Cross-function re-entry: withdraw() -> receive() -> withdrawAll().
contract CrossReenter {
    SitowiseFactory public immutable f;
    uint256 public id;
    uint256 public reenterCount;
    uint256 public reenterSucceeded;

    constructor(SitowiseFactory f_) {
        f = f_;
    }

    function setId(uint256 id_) external {
        id = id_;
    }

    function go() external {
        f.withdraw(id, address(this));
    }

    receive() external payable {
        if (reenterCount >= 2) return;
        reenterCount++;
        try f.withdrawAll(address(this)) {
            reenterSucceeded++;
        } catch {}
    }
}

/// @dev Owner-controlled contract that re-enters `rescue` from its receive hook.
contract ReentrantRescuer {
    SitowiseFactory public immutable f;
    uint256 public reenterCount;
    uint256 public reenterSucceeded;

    constructor(SitowiseFactory f_) {
        f = f_;
    }

    function go(uint256 amount) external {
        f.rescue(address(this), amount);
    }

    /// @dev Ownership is two-step: the offer must be accepted by this contract.
    function claimOwnership() external {
        f.acceptOwnership();
    }

    receive() external payable {
        if (reenterCount >= 2) return;
        reenterCount++;
        try f.rescue(address(this), 1) {
            reenterSucceeded++;
        } catch {}
    }
}

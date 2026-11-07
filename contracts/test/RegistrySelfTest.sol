// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../StockMaxxIndexRegistry.sol";

/// @dev Test-only helper acting as a second account.
contract RegistryActor {
    function tryUpdate(StockMaxxIndexRegistry r, uint256 id, uint16[] memory w) external returns (bool ok) {
        try r.updateWeights(id, w, bytes32(0)) {
            ok = true;
        } catch {
            ok = false;
        }
    }
}

/**
 * @title RegistrySelfTest
 * @notice Self-contained test suite executed entirely inside a constructor via eth_call
 *         (no deployment, no funds). Reverts with the failing check's name; on success
 *         returns abi.encode(passedCount) as the "runtime code".
 *         Run with: npm run test:contracts
 */
contract RegistrySelfTest {
    uint256 private passed;

    address constant NVDA = 0xb20000000000000000000078ee7ce2fE4908108C;
    address constant AAPL = 0xb200000000000000000000C2e324d24d7eEcd1fb;
    address constant MSFT = 0xB200000000000000000000Ab99cFa739E253872B;
    address constant NOT_ALLOWED = 0x4200000000000000000000000000000000000006;

    function check(bool cond, string memory name) internal {
        require(cond, name);
        passed++;
    }

    constructor() {
        address[] memory allowed = new address[](3);
        allowed[0] = NVDA;
        allowed[1] = AAPL;
        allowed[2] = MSFT;
        StockMaxxIndexRegistry r = new StockMaxxIndexRegistry(allowed);

        check(r.owner() == address(this), "owner set to deployer");
        check(r.isAllowedToken(NVDA) && !r.isAllowedToken(NOT_ALLOWED), "allowlist initialised");

        // --- happy path ---
        address[] memory t = new address[](2);
        t[0] = NVDA;
        t[1] = AAPL;
        uint16[] memory w = new uint16[](2);
        w[0] = 6000;
        w[1] = 4000;
        uint256 id = r.createIndex("AI Leaders", "MAXX-AI", t, w);
        check(id == 0 && r.indexCount() == 1, "createIndex returns id 0");

        (string memory name, string memory ticker, address creator, , , uint32 version, address[] memory gotT, uint16[] memory gotW) = r.getIndex(0);
        check(keccak256(bytes(name)) == keccak256("AI Leaders"), "name stored");
        check(keccak256(bytes(ticker)) == keccak256("MAXX-AI"), "ticker stored");
        check(creator == address(this) && version == 1, "creator & version stored");
        check(gotT.length == 2 && gotT[1] == AAPL && gotW[0] == 6000, "constituents stored");
        check(r.getCreatorIndexes(address(this)).length == 1, "creator index list");

        // --- creator update ---
        uint16[] memory w2 = new uint16[](2);
        w2[0] = 5000;
        w2[1] = 5000;
        r.updateWeights(0, w2, keccak256("research"));
        (, , , , , uint32 v2, , uint16[] memory gotW2) = r.getIndex(0);
        check(v2 == 2 && gotW2[0] == 5000, "creator can update weights");

        // --- non-creator cannot update ---
        RegistryActor actor = new RegistryActor();
        check(!actor.tryUpdate(r, 0, w2), "non-creator update rejected");

        // --- validation failures ---
        uint16[] memory bad = new uint16[](2);
        bad[0] = 6000;
        bad[1] = 3000;
        check(!_tryCreate(r, "X", "X", t, bad), "weights must sum to 10000");

        address[] memory na = new address[](1);
        na[0] = NOT_ALLOWED;
        uint16[] memory full = new uint16[](1);
        full[0] = 10000;
        check(!_tryCreate(r, "X", "X", na, full), "non-allowlisted token rejected");

        address[] memory dup = new address[](2);
        dup[0] = NVDA;
        dup[1] = NVDA;
        check(!_tryCreate(r, "X", "X", dup, w), "duplicate token rejected");

        uint16[] memory zero = new uint16[](2);
        zero[0] = 10000;
        zero[1] = 0;
        check(!_tryCreate(r, "X", "X", t, zero), "zero weight rejected");

        check(!_tryCreate(r, "", "X", t, w), "empty name rejected");
        check(!_tryCreate(r, "X", "TICKER-TOO-LONG-XYZ", t, w), "long ticker rejected");

        address[] memory none = new address[](0);
        uint16[] memory noneW = new uint16[](0);
        check(!_tryCreate(r, "X", "X", none, noneW), "empty index rejected");

        // --- no ETH accepted ---
        (bool sent, ) = address(r).call{value: 0}("");
        check(!sent, "plain calls / ETH rejected (no receive)");

        // --- admin ---
        r.setAllowedToken(NOT_ALLOWED, true);
        check(r.isAllowedToken(NOT_ALLOWED), "owner can extend allowlist");

        bytes memory result = abi.encode(passed);
        assembly {
            return(add(result, 32), mload(result))
        }
    }

    function _tryCreate(
        StockMaxxIndexRegistry r,
        string memory name,
        string memory ticker,
        address[] memory t,
        uint16[] memory w
    ) internal returns (bool ok) {
        try r.createIndex(name, ticker, t, w) returns (uint256) {
            ok = true;
        } catch {
            ok = false;
        }
    }
}

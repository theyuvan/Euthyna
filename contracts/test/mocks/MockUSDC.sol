// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice 6-decimal USDC stand-in with a protocol-style blocklist (transfers to blocked addresses revert).
contract MockUSDC is ERC20 {
    mapping(address => bool) public blocked;

    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlocked(address a, bool b) external {
        blocked[a] = b;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!blocked[to] && !blocked[from], "blocklisted");
        super._update(from, to, value);
    }
}

interface IReceiveHook {
    function onTokenReceived() external;
}

/// @notice ERC777-style token that calls the recipient on every transfer, to prove nonReentrant holds
///         even if the settlement token ever gained callbacks.
contract HookUSDC is ERC20 {
    constructor() ERC20("Hook USDC", "hUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (from != address(0) && to.code.length > 0) IReceiveHook(to).onTokenReceived();
    }
}

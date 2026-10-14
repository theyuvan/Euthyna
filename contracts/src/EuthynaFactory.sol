// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EuthynaVault} from "./EuthynaVault.sol";

/// @title EuthynaFactory
/// @notice Creates one EuthynaVault per business. The caller becomes the vault owner.
contract EuthynaFactory {
    IERC20 public immutable usdc;
    EuthynaVault.Params public defaults;

    address[] public allVaults;
    mapping(address => address[]) internal _vaultsOf;

    event VaultCreated(address indexed owner, address indexed vault, address indexed agent);

    constructor(IERC20 usdc_, EuthynaVault.Params memory defaults_) {
        usdc = usdc_;
        defaults = defaults_;
    }

    /// @notice Vault with the factory's default parameters.
    function createVault(address agent) external returns (EuthynaVault vault) {
        vault = _create(agent, defaults);
    }

    /// @notice Vault with custom parameters (the caller is still the owner).
    function createVaultWithParams(address agent, EuthynaVault.Params calldata p) external returns (EuthynaVault vault) {
        vault = _create(agent, p);
    }

    function vaultsOf(address owner) external view returns (address[] memory) {
        return _vaultsOf[owner];
    }

    function vaultCount() external view returns (uint256) {
        return allVaults.length;
    }

    function getDefaults() external view returns (EuthynaVault.Params memory) {
        return defaults;
    }

    function _create(address agent, EuthynaVault.Params memory p) internal returns (EuthynaVault vault) {
        vault = new EuthynaVault(usdc, msg.sender, agent, p);
        allVaults.push(address(vault));
        _vaultsOf[msg.sender].push(address(vault));
        emit VaultCreated(msg.sender, address(vault), agent);
    }
}

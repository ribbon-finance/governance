// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

abstract contract RibbonStakingVaultStorageV1 {}

// We are following Compound's method of upgrading new contract implementations
// When we need to add new storage variables, we create a new version of RibbonThetaVaultStorage
// e.g. RibbonThetaVaultStorage<versionNumber>, so finally it would look like
// contract RibbonThetaVaultStorage is RibbonThetaVaultStorageV1, RibbonThetaVaultStorageV2
abstract contract RibbonStakingVaultStorage is RibbonStakingVaultStorageV1 {

}

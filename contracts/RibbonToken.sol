// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "hardhat/console.sol";

/**
 * RIBBON FINANCE: STRUCTURED PRODUCTS FOR THE PEOPLE
 */
contract RibbonToken is AccessControl, ERC20 {
    /// @dev The identifier of the role which maintains other roles.
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN");
    /// @dev The identifier of the role which allows accounts to mint tokens.
    bytes32 public constant MINTER_ROLE = keccak256("MINTER");

    mapping(address => bool) public canTransfer;

    /// @dev bool flag of whether transfer is currently allowed for all people.
    bool public transfersAllowed = false;

    constructor(
        string memory name,
        string memory symbol,
        uint256 totalSupply,
        address beneficiary
    ) public ERC20(name, symbol) {
        // We are minting initialSupply number of tokens
        _mint(beneficiary, totalSupply);
        // Add beneficiary as minter
        _setupRole(MINTER_ROLE, beneficiary);
        // Add beneficiary as admin
        _setupRole(ADMIN_ROLE, beneficiary);
    }

    /// @dev A modifier which checks that the caller has the minter role.
    modifier onlyMinter() {
        require(hasRole(MINTER_ROLE, msg.sender), "RibbonToken: only minter");
        _;
    }

    /// @dev A modifier which checks that the caller has the admin role.
    modifier onlyAdmin() {
        require(hasRole(ADMIN_ROLE, msg.sender), "RibbonToken: only admin");
        _;
    }

    /// @dev A modifier which checks that the caller has transfer privileges.
    modifier onlyTransferer(address from) {
        console.log(transfersAllowed, msg.sender, canTransfer[msg.sender]);
        require(
            transfersAllowed ||
                from == address(0) ||
                canTransfer[msg.sender],
            "RibbonToken: no transfer privileges"
        );
        _;
    }

    /// @dev Mints tokens to a recipient.
    ///
    /// This function reverts if the caller does not have the minter role.
    function mint(address _recipient, uint256 _amount) external onlyMinter {
        _mint(_recipient, _amount);
    }

    /// @dev Toggles transfer allowed flag.
    ///
    /// This function reverts if the caller does not have the admin role.
    function setTransfersAllowed(bool _transfersAllowed) external onlyAdmin {
        transfersAllowed = _transfersAllowed;
        emit TransfersAllowed(transfersAllowed);
    }

    /// @dev Toggles ability to transfer for an address
    ///
    /// This function grants or revokes the ability to make transfers for an address.
    function toggleTransferForAddress(address transferrer, bool _transfersAllowed) external onlyAdmin {
        canTransfer[transferrer] = _transfersAllowed;
    }

    /// @dev Hook that is called before any transfer of tokens.
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override onlyTransferer(from) {}

    /// @dev Emitted when transfer toggle is switched
    event TransfersAllowed(bool transfersAllowed);
}

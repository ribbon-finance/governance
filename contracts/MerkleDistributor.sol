//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "./interfaces/IMerkleDistributor.sol";
import "./Owned.sol";

contract MerkleDistributor is IMerkleDistributor, Owned {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    address public immutable override token;
    bytes32 public immutable override merkleRoot;

    // This is a packed array of booleans.
    mapping(uint256 => uint256) private claimedBitMap;

    uint256 public immutable ownerUnlockTime;

    constructor(
        address _owner,
        address _token,
        bytes32 _merkleRoot,
        uint256 _daysUntilUnlock
    ) public Owned(_owner) {
        require(_owner != address(0), "Owner must be non-zero address");
        require(_token != address(0), "Airdrop token must be non-zero address");
        require(_merkleRoot != bytes32(0), "Merkle root must be non-zero");
        require(
            _daysUntilUnlock > 0,
            "Days until owner unlock must be in the future"
        );
        token = _token;
        merkleRoot = _merkleRoot;
        ownerUnlockTime = block.timestamp.add(_daysUntilUnlock * 1 days);
    }

    function isClaimed(uint256 index) public view override returns (bool) {
        uint256 claimedWordIndex = index / 256;
        uint256 claimedBitIndex = index % 256;
        uint256 claimedWord = claimedBitMap[claimedWordIndex];
        uint256 mask = (1 << claimedBitIndex);
        return claimedWord & mask == mask;
    }

    function _setClaimed(uint256 index) private {
        uint256 claimedWordIndex = index / 256;
        uint256 claimedBitIndex = index % 256;
        claimedBitMap[claimedWordIndex] =
            claimedBitMap[claimedWordIndex] |
            (1 << claimedBitIndex);
    }

    function claim(
        uint256 index,
        address account,
        uint256 amount,
        bytes32[] calldata merkleProof
    ) external override {
        require(!isClaimed(index), "MerkleDistributor: Drop already claimed.");

        // Verify the merkle proof.
        bytes32 node = keccak256(abi.encodePacked(index, account, amount));
        require(
            MerkleProof.verify(merkleProof, merkleRoot, node),
            "MerkleDistributor: Invalid proof."
        );

        // Mark it claimed and send the token.
        _setClaimed(index);
        require(
            IERC20(token).transfer(account, amount),
            "MerkleDistributor: Transfer failed."
        );

        emit Claimed(index, account, amount);
    }

    // Used for recovery purposes
    function recoverERC20(address tokenAddress, uint256 tokenAmount)
        external
        onlyOwner
    {
        require(
            tokenAddress == address(token)
                ? block.timestamp >= ownerUnlockTime
                : true,
            "MerkleDistributor: Cannot withdraw the token before unlock time"
        );
        IERC20(tokenAddress).safeTransfer(owner, tokenAmount);
        emit Recovered(tokenAddress, tokenAmount);
    }

    /* ========== EVENTS ========== */
    event Recovered(address token, uint256 amount);
}

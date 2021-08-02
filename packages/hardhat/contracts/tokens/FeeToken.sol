//SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

// import "hardhat/console.sol";

// https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/token/ERC20/ERC20.sol
// https://docs.openzeppelin.com/contracts/4.x/erc20
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract FeeToken is ERC20 {

  uint public immutable feePercent;

  constructor(
    string memory name, 
    string memory symbol, 
    address recipient,
    uint amount,
    uint _feePercent
  ) ERC20(name, symbol) {
    _mint(recipient, amount);
    require(_feePercent <= 100, "fee can't be higher than 100%");
    feePercent = _feePercent;
  }

  /// @dev burns a fee before any transfer
  function _transfer(address sender, address recipient, uint256 amount) internal override {
    uint feeAmount = amount * feePercent / 100;
    uint transferAmount = amount  - feeAmount;
    super._burn(sender, feeAmount);
    super._transfer(sender, recipient, transferAmount);
  }
}
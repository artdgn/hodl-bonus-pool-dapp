//SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

/// @dev interface for interacting with WETH (wrapped ether) for handling ETH
/// https://github.com/Uniswap/uniswap-v2-periphery/blob/master/contracts/interfaces/IWETH.sol
interface IWETH {
  function deposit() external payable;
  function withdraw(uint) external;
}

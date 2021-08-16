import React, { useState } from "react";
import { useBalance } from "../hooks";
import { utils } from "ethers";

/*
  ~ What it does? ~

  Displays a balance of given address in ether & dollar

  ~ How can I use? ~

  <Balance
    address={address}
    provider={mainnetProvider}
    price={price}
  />

  ~ If you already have the balance as a bignumber ~
  <Balance
    balance={balance}
    price={price}
  />

  ~ Features ~

  - Provide address={address} and get balance corresponding to given address
  - Provide provider={mainnetProvider} to access balance on mainnet or any other network (ex. localProvider)
  - Provide price={price} of ether and get your balance converted to dollars
*/

export default function Balance({
    address, balance, provider, price, size, symbol
  }) {
  const [dollarMode, setDollarMode] = useState(false && price);

  const viewBalance = useBalance(provider, address)

  symbol = symbol || "ETH"

  let floatBalance = parseFloat("0.00");

  let usingBalance = viewBalance;

  if (typeof balance !== "undefined") {
    usingBalance = balance;
  }

  if (usingBalance) {
    const etherBalance = utils.formatEther(usingBalance);
    floatBalance = parseFloat(etherBalance);
  }

  if (dollarMode) {
    floatBalance *= price;
  }

  const precision = dollarMode ? 2 : 3;

  let displayBalance;
  if (floatBalance > 1) {
    displayBalance = floatBalance.toFixed(precision);
  } else if (floatBalance === 0) {
    displayBalance = 0;
  } else {
    // minimal precision that avoids scientific notation
    const shortPrecision = Math.abs(Math.round(Math.log10(floatBalance))) + precision;
    displayBalance = floatBalance.toFixed(shortPrecision);
  }
  return (
    <span
      style={{
        verticalAlign: "middle",
        fontSize: size ? size : 24,
        padding: 8,
        cursor: "pointer",
      }}
      onClick={() => {
        setDollarMode(!dollarMode && price);
      }}
    >
      {dollarMode ? `$${displayBalance}` : `${displayBalance} ${symbol}`}
    </span>
  );
}

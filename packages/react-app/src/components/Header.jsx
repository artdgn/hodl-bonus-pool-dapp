import { PageHeader } from "antd";
import React from "react";

// displays a page header

export default function Header() {
  return (
    <a href="https://github.com/artdgn/hodl-bonus-pool-dapp" target="_blank" rel="noopener noreferrer">
      <PageHeader
        title="HODL Bonus Pool 🧑‍🤝‍🧑🤽"
        subTitle="dApp for earning from HODLing."
        style={{ cursor: "pointer" }}
      />
    </a>
  );
}

import React from "react";
import { PageHeader } from "antd";

// displays a page header

export default function Header() {
  return (
    <a href="https://github.com/artdgn/hodl-pool-dapp" target="_blank" rel="noopener noreferrer">
      <PageHeader
        title="HODL-bonus-pool 🧑‍🤝‍🧑🤽"
        subTitle="dApp for a earning from HODLing."
        style={{ cursor: "pointer" }}
      />
    </a>
  );
}

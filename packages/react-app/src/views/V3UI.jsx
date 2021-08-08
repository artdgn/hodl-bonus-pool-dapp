/* eslint-disable jsx-a11y/accessible-emoji */

import React, { useState, useEffect } from "react";
import { Divider, Card, Space, Result, Tooltip } from "antd";
import { Address, Balance, TokenSelection } from "../components";
import { useContractExistsAtAddress } from "../hooks";
import { InfoCircleTwoTone, LoadingOutlined } from "@ant-design/icons";
import { MotivationButton, MechanismButton, IncentivesButton } from "./TextContentComponents";
import { HodlPoolV3StateHooks, ERC20StateHooks } from "./ContractsStateHooks";
import { NewDepositCard } from "./DepositComponents";
import { WithdrawalsCard } from "./WithdrawalComponents";
import { EventsList } from "./EventsList";


export function HodlPoolV3UI(
  { address, provider, blockExplorer, tx, readContracts, writeContracts, contractName }) {

  // main contract
  const contract = readContracts && readContracts[contractName];  

  // token choice state  
  const [tokenChoice, setTokenChoice] = useState("");
  const [tokenAddress, setTokenAddress] = useState();
  const [ethMode, ethModeSet] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // contract state hooks
  const tokenContract = ERC20StateHooks.useERC20ContractAtAddress(tokenAddress, provider);
  const tokenState = new ERC20StateHooks(
    tokenContract, address, contract?.address, setLoading, setError);
  const contractState = new HodlPoolV3StateHooks(contract, address, tokenAddress);
  
  // switch token address and eth-mode depending on token choice
  useEffect(() => {
    setTokenAddress(tokenChoice === "ETH" ? contractState.WETHAddress : tokenChoice);
    ethModeSet(tokenChoice === "ETH");
  }, [tokenChoice, contractState?.WETHAddress])

  // transaction wrappers
  const contractTx = (method, args, callback) =>
    tx(writeContracts[contractName][method](...(args ?? [])).finally(callback));
  const tokenTx = (method, args, callback) =>
    tx(tokenContract.connect(provider.getSigner())[method](...(args ?? [])).finally(callback));

  const symbol = ethMode ? "ETH" : tokenState.symbol;

  return (
    <div>      
      <HeaderCard
        provider={provider}
        blockExplorer={blockExplorer}
        contractState={contractState}
        tokenState={tokenState}
        loading={loading}
        ethMode={ethMode}
        error={error}
        setTokenChoice={setTokenChoice}
      />

      <NewDepositCard
        contractState={contractState}
        tokenState={tokenState}
        loading={loading}
        ethMode={ethMode}
        contractTx={contractTx}
        tokenTx={tokenTx}
      />

      {loading || !tokenState.address ? "" : 
          <WithdrawalsCard
            contractState={contractState}
            contractTx={contractTx}
            tokenState={tokenState}
            ethMode={ethMode}
          />}

      {loading || !tokenState.address ? "" : 
          <PoolInfo
            contractState={contractState}
            symbol={symbol}
            tokenState={tokenState}
          />}

      <EventsList 
        contractState={contractState} 
        contract={contract} 
        address={address} 
      />

    </div>
  );
}

function HeaderCard({
   provider, contractState, blockExplorer, tokenState, setTokenChoice, 
   address, loading, ethMode, error
}) {
  const contractIsDeployed = useContractExistsAtAddress(provider, contractState?.address);

  return (
    <Card
      style={{
        border: "1px solid #cccccc", padding: 16, width: 600,
        margin: "auto", marginTop: 64, borderRadius: "20px"
      }}
      title={
        <div>
          <h1>HODL Bonus Pool</h1>
          <h4>Deposit ERC20 tokens or ETH and don't withdraw early 💎✊</h4>
          <h4>Get bonus if other people withdraw early 💰🤑</h4>
        </div>
      }
      size="large"
      loading={!contractIsDeployed}
    >
      <Space direction="horizontal" size={30}>
        <MotivationButton />
        <MechanismButton />
        <IncentivesButton />
        <a
          target="_blank"
          href={`${blockExplorer || "https://etherscan.io/"}${"address/"}${contractState?.address}`}
          rel="noopener noreferrer"
        >Contract
        </a>
      </Space>

      <Divider dashed> <h3>👇 Pick or paste token 👇</h3></Divider>

      <Space direction="vertical" size="large">
        <TokenSelection
          provider={provider}
          addessUpdateFn={setTokenChoice}
          prependedTokens={[{ "address": "ETH", "symbol": "ETH" }]}
          defaultChoice="ETH"
        />

        {error ? <Result status="warning" subTitle={error} /> : ""}

        {loading ?
          <LoadingOutlined style={{ fontSize: 24 }} spin size="large" /> :
          <TokenOrETHBalance
            tokenState={tokenState}
            blockExplorer={blockExplorer}
            ethMode={ethMode}
            address={address}
            provider={provider}
          />
        }
      </Space>
    </Card>
  );
}

function TokenOrETHBalance({ tokenState, blockExplorer, ethMode, address, provider }) {
  if (ethMode) {
    return (
      <h3>Available balance: <Balance address={address} provider={provider} size="20" /></h3>
    );
  } else {
    if (!tokenState.address) return "";
    return (
      <Space size="large" align="start">
        <Space align="center" direction="vertical">
          <h3>Wallet balance</h3>
          <Balance
            balance={tokenState.balance}
            symbol={tokenState.symbol}
            size="20" />
        </Space>

        <Space align="center" direction="vertical">
          <h3>Allowance</h3>
          <Balance
            balance={tokenState.allowance}
            symbol={tokenState.symbol}
            size="20" />
        </Space>

        <Space align="center" direction="vertical">
          <h3>Token address</h3>
          <Address address={tokenState.address} blockExplorer={blockExplorer} fontSize="20" />
        </Space>
      </Space>
    );
  }
}

function PoolInfo({ contractState, tokenState, symbol }) {

  const pointsToTokenDays = (val) => {
    return contractState?.pointsToTokenDays(val, tokenState?.decimals);
  }

  function bonusTotalsTooltip() {
    return <Tooltip
      placement="top"
      title={
        <div>
          <p>Hold bonus pool + Commitment bonus pool:</p>
          <p>
            <b><Balance balance={contractState.holdBonusesSum} symbol={symbol} size="20" /></b>
            +
            <b><Balance balance={contractState.commitBonusesSum} symbol={symbol} size="20" /></b>
          </p>
          <p>Total hold points:&nbsp;
          {pointsToTokenDays(contractState.totalHoldPoints)?.toPrecision(3)} token-days.
          </p>
          <p>Total commitment points:&nbsp;
          {pointsToTokenDays(contractState.totalCommitPoints)?.toPrecision(3)} token-days.
          </p>
        </div>
      }>
      <InfoCircleTwoTone></InfoCircleTwoTone>
    </Tooltip>
  }

  return (
    <Card
      style={{ 
        border: "1px solid #cccccc", margin: "auto",marginTop: 32, width: 600, borderRadius: "20px"}}
      title={<h2>{symbol} pool info</h2>}
      size="small">
      <Space size="large" direction="horizontal">
        <div>All deposits:<Balance balance={contractState.depositsSum} symbol={symbol} size="20" /></div>
        <div>Bonuses pool:<Balance balance={contractState.bonusesPool} symbol={symbol} size="20" />
          {bonusTotalsTooltip()}</div>
      </Space>
    </Card>
  );
}

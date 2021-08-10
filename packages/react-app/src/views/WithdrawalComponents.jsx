/* eslint-disable jsx-a11y/accessible-emoji */

import React, { useState } from "react";
import { Button,  Card,  Modal, Space, Tooltip, Collapse, Empty } from "antd";
import { Balance } from "../components";
import { formatUnits } from "@ethersproject/units";
import { InfoCircleTwoTone, WarningTwoTone } from "@ant-design/icons";


export function WithdrawalsCard({contractState, tokenState, contractTx, ethMode }) {
  const symbol = ethMode ? "ETH" : tokenState.symbol;
  const tokenIds = contractState?.poolTokenIds;
  
  return (
    <Card
      style={{ 
        border: "1px solid #cccccc", width: 600, 
        margin: "auto", marginTop: 32, borderRadius: "20px"}}
      title={<h2><b>Withdraw</b> from {symbol} pool</h2>}
      size="small"
    >
      {tokenIds.length > 0 ? <Collapse
        destroyInactivePanel={false}
        defaultActiveKey={tokenIds?.length > 0 ? tokenIds[0].toNumber() : ""}
        bordered={false}
        style={{ borderRadius: "20px" }}
      >
        {tokenIds?.map(
          (tokenId) =>
            <Collapse.Panel
              header={<WithdrawalHeader
                contractState={contractState}
                symbol={symbol}
                tokenId={tokenId}
              />}
              style={{ border: "1px solid #cccccc", borderRadius: "20px", marginBottom: "10px" }}
              key={tokenId.toNumber()}
            >
              <WithdrawalInfo
                contractState={contractState}
                contractTx={contractTx}
                tokenState={tokenState}
                ethMode={ethMode}
                tokenId={tokenId}
              />
            </Collapse.Panel>
        )}
      </Collapse> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="You have no deposits in this pool"/>}
    </Card>
  )
}

function WithdrawalHeader({ contractState, symbol, tokenId}) {
  const deposit = contractState.getDepositDetails(tokenId);
  const withText = deposit?.penalty?.gt(0) ? "with penalty ⛔" : 
      ( deposit?.bonus?.gt(0) ? "with bonus 🤑" : "✅" )

  return <Space size="small" direction="horizontal">
    <h3>Deposit #<b>{deposit.tokenId.toNumber()}</b>:
      Can withdraw<Balance
        balance={"" + (deposit.withdrawWithBonus || deposit.withdrawWithPenalty)}
        symbol={symbol}
        size="20"
      />{withText}
    </h3>
    </Space>
}

function WithdrawalInfo({ contractState, tokenState, ethMode, contractTx, tokenId }) {
  const symbol = ethMode ? "ETH" : tokenState.symbol;
  const deposit = contractState.getDepositDetails(tokenId);

  const pointsToTokenDays = (val) => {
    return contractState?.pointsToTokenDays(val, tokenState?.decimals);
  }

  function pointsSummary(title, points, totalPoints) {
    return (
      <p>{title}:&nbsp;
        {pointsToTokenDays(points)?.toPrecision(3)} token-days&nbsp;
        ({(100 * pointsToTokenDays(points) / 
          pointsToTokenDays(totalPoints))?.toPrecision(3)}% of&nbsp;
        {pointsToTokenDays(totalPoints)?.toPrecision(3)} token-days in pool)
      </p>)
  }

  function bonusTooltip() {
    return <Tooltip
      placement="top"
      title={
        <div>
          <p>Hold bonus + Commitment bonus:</p>
          <p>
            <b><Balance balance={deposit.holdBonus} symbol={symbol} size="20" /></b>
            +
            <b><Balance balance={deposit.commitBonus} symbol={symbol} size="20" /></b>
          </p>
          <br/>
          {pointsSummary(
            "Hold points", deposit.holdPoints, contractState.totalHoldPoints)}
          {pointsSummary(
            "Commit points", deposit.commitPoints, contractState.totalCommitPoints)}
        </div>
      }>
      <InfoCircleTwoTone></InfoCircleTwoTone>
    </Tooltip>
  }

  const depositTime = contractState?.depositParams && contractState?.depositParams[tokenId]?.time ?
    (new Date(contractState?.depositParams[tokenId]?.time * 1000)).toISOString().split('.')[0] : "";
  return (
    <div>
      <h3>Initial deposit:
        <Balance
          balance={deposit.balance}
          symbol={symbol}
          size="20" />
      </h3>

      <h3>Deposit time: {depositTime}</h3>

      {deposit.withdrawWithBonus > 0 ?
        <div>
          <h3>Current bonus:
            <Balance balance={deposit.bonus} symbol={symbol} size="20" />
            {bonusTooltip()}
          </h3>
          <WithdrawWithBonusButton
            contractState={contractState}
            txFn={contractTx}
            tokenState={tokenState}
            ethMode={ethMode}
            deposit={deposit}
          />
        </div>
        : ""}

      {deposit.withdrawWithPenalty > 0 ?
        <div>
          <h3>Current penalty:
            <Balance balance={deposit.penalty} symbol={symbol} size="20" />
          </h3>

          <h3>Penalty percent:&nbsp;
            {(deposit.currentPenaltyPercent || "").toString()}%
            (initial was {(deposit.initialPenaltyPercent || "").toString()}%)
          </h3>

          <h3>
            Time left to hold: {deposit.timeLeftString}&nbsp;
            (of {deposit.commitString})
          </h3>

          <WithdrawWithPenaltyButton
            contractState={contractState}
            txFn={contractTx}
            tokenState={tokenState}
            ethMode={ethMode}
            deposit={deposit}
          />
        </div>
        : ""}

    </div>
  )
}

function WithdrawWithPenaltyButton({ contractState, txFn, tokenState, ethMode, deposit }) {
  const [penaltyModalVisible, setPenaltyModalVisible] = useState(false);
  const symbol = ethMode ? "ETH" : tokenState.symbol;
  return (
    <div>

      <Button
        onClick={() => setPenaltyModalVisible(true)}
        type="primary"
        shape="round"
        danger
        size="large"
        disabled={!(deposit.withdrawWithPenalty > 0)}
      > Withdraw with penalty
      </Button>

      <Modal
        title={<h3 style={{ textAlign: "center" }}>
          Confirm withdrawal of {
            tokenState.decimals && 
            formatUnits("" + deposit.withdrawWithPenalty, tokenState.decimals)
          } {symbol} with penalty
        </h3>}
        okText="Withdraw with penalty"
        visible={penaltyModalVisible}
        okButtonProps={{ danger: true }}
        onOk={() => {
          setPenaltyModalVisible(false);
          if (ethMode) {
            txFn("withdrawWithPenaltyETH", [deposit.tokenId]);
          } else {
            txFn("withdrawWithPenalty", [deposit.tokenId]);
          }
        }}
        onCancel={() => setPenaltyModalVisible(false)}>
        <h2>Withdraw&nbsp;
          {formatUnits("" + deposit.withdrawWithPenalty, tokenState.decimals)}&nbsp;
          {symbol} out of deposited&nbsp;
          {formatUnits(deposit.balance, tokenState.decimals)} due to&nbsp;
          {formatUnits(deposit.penalty, tokenState.decimals)} penalty.</h2>
        <h2>
          <WarningTwoTone twoToneColor="red" /> Wait until end of commitment period
          ({deposit.timeLeftString})
          to withdraw full deposit + any bonus share!
          <br/>
          {deposit?.bonus?.gt(0) ?
            `Current bonus share is ${formatUnits(deposit.bonus, tokenState.decimals)} 
            ${symbol}.` : ""}
        </h2>
      </Modal>

    </div>
  );
}

function WithdrawWithBonusButton({ contractState, txFn, tokenState, ethMode, deposit }) {
  const [bonusModalVisible, setBonusModalVisible] = useState(false);
  const symbol = ethMode ? "ETH" : tokenState.symbol;
  return (
    <div>

      <Button
        onClick={() => setBonusModalVisible(true)}
        type="primary"
        shape="round"
        size="large"
        disabled={!(deposit.withdrawWithBonus > 0)}
      > Withdraw
        {deposit?.bonus?.gt(0) ? " with bonus 🤑" : ""}
      </Button>

      <Modal
        title={<h3 style={{ textAlign: "center" }}>
          Confirm withdrawal of {
            formatUnits("" + deposit.withdrawWithBonus, tokenState.decimals)
          } {symbol}</h3>}
        okText="Withdraw"
        visible={bonusModalVisible}
        onOk={() => {
          setBonusModalVisible(false);
          if (ethMode) {
            txFn("withdrawWithBonusETH", [deposit.tokenId]);
          } else {
            txFn("withdrawWithBonus", [deposit.tokenId]);
          }
        }}
        onCancel={() => setBonusModalVisible(false)}>
        <h2>
          Withdraw&nbsp;
          {formatUnits("" + deposit.withdrawWithBonus, tokenState.decimals)}&nbsp;
          {symbol} out of deposited&nbsp;
          {formatUnits(deposit.balance, tokenState.decimals)} {symbol}
          {deposit?.bonus?.gt(0) ?
            ` with ${formatUnits(deposit.bonus, tokenState.decimals)} 
            ${symbol} bonus!` : "."}
        </h2>
        <h2>⚠️ Waiting for longer may increase available bonus.</h2>
      </Modal>

    </div>
  );
}

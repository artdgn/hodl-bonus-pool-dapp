import React, { useState } from "react";
import { Button,  Card,  Modal, Space, Tooltip, Collapse, Empty, Badge } from "antd";
import { Balance } from "../components";
import { utils } from "ethers";
import { InfoCircleTwoTone, WarningTwoTone } from "@ant-design/icons";


export function WithdrawalsCard({contractState, tokenState, contractTx, ethMode }) {
  const symbol = ethMode ? "ETH" : tokenState.symbol;
  const tokenIds = contractState?.poolTokenIds;
  
  return (
    <Card
      title={<h2><b>Withdraw</b> from {symbol} pool</h2>}
      size="small"
    >
      {tokenIds?.length > 0 ? <Collapse
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

  const depositTime = contractState?.depositDatetime(tokenId);

  const bonusSection = contractState?.bonusesPool?.gt(0) ? (
    <div>
      { deposit?.penalty?.gt(0) ?
          <APYTextPenalty
            contractState={contractState}
            tokenId={tokenId}
            deposit={deposit}
            />
          : 
          <APYText
            contractState={contractState}
            tokenId={tokenId}
            deposit={deposit}
            />
      }
      <h3>Current bonus:
        <Balance balance={deposit.bonus} symbol={symbol} size="20" />
        {bonusTooltip()}
      </h3>
    </div>
  ) : <h3> Bonus & Bonus APY: no bonus in pool yet 😢 </h3>

  return (
    <div>
      <Space direction="horizontal" size="small">
        <h3>Initial deposit:
          <Balance
            balance={deposit.balance}
            symbol={symbol}
            size="20" />
        </h3>

        <h3>Deposit time: {depositTime ? depositTime.toISOString().split('.')[0] : ""}</h3>
      </Space>

      { bonusSection }

      {deposit.withdrawWithBonus > 0 ?
          <WithdrawWithBonusButton
            contractState={contractState}
            txFn={contractTx}
            tokenState={tokenState}
            ethMode={ethMode}
            deposit={deposit}
          />
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
        danger
        size="large"
        disabled={!(deposit.withdrawWithPenalty > 0)}
      > Withdraw with penalty
      </Button>

      <Modal
        className="modal-container"        
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
        <h1 style={{ textAlign: "center" }}>
          Confirm withdrawal of {
            tokenState.decimals && 
            utils.formatUnits("" + deposit.withdrawWithPenalty, tokenState.decimals)
          } {symbol} with penalty
        </h1>
        <h2>Withdraw&nbsp;
          {utils.formatUnits("" + deposit.withdrawWithPenalty, tokenState.decimals)}&nbsp;
          {symbol} out of deposited&nbsp;
          {utils.formatUnits(deposit.balance, tokenState.decimals)} due to&nbsp;
          {utils.formatUnits(deposit.penalty, tokenState.decimals)} penalty.</h2>
        <h2>
          <WarningTwoTone twoToneColor="red" /> No bonus will be withdrawed!
          {deposit?.bonus?.gt(0) ?
            ` (Current bonus share is ${utils.formatUnits(deposit.bonus, tokenState.decimals)} 
            ${symbol})` : ""}
        </h2>
        <h2>
          <WarningTwoTone twoToneColor="red" /> Wait until end of commitment period
          ({deposit.timeLeftString})
          to withdraw full deposit + any bonus share!
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
        size="large"
        disabled={!(deposit.withdrawWithBonus > 0)}
      > Withdraw
        {deposit?.bonus?.gt(0) ? " with bonus 🤑" : ""}
      </Button>

      <Modal
        className="modal-container"
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
        <h1 style={{ textAlign: "center" }}>
          Confirm withdrawal of {
            utils.formatUnits("" + deposit.withdrawWithBonus, tokenState.decimals)
          } {symbol}</h1>
        <h2>
          Withdraw&nbsp;
          {utils.formatUnits("" + deposit.withdrawWithBonus, tokenState.decimals)}&nbsp;
          {symbol} out of deposited&nbsp;
          {utils.formatUnits(deposit.balance, tokenState.decimals)} {symbol}
          {deposit?.bonus?.gt(0) ?
            ` with ${utils.formatUnits(deposit.bonus, tokenState.decimals)} 
            ${symbol} bonus!` : "."}
        </h2>
        <h2>⚠️ Waiting for longer may increase available bonus.</h2>
      </Modal>

    </div>
  );
}

function APYText({contractState, tokenId, deposit}) {
  const commitAPY = calcAPYPercent(
    contractState, tokenId, deposit?.balance, deposit?.commitBonus);
  const holdAPY = calcAPYPercent(
    contractState, tokenId, deposit?.balance, deposit?.holdBonus);
  const totalAPY = calcAPYPercent(
    contractState, tokenId, deposit?.balance, deposit?.bonus);

  function tooltip() {
    return <Tooltip
      placement="top"
      title={
        <div>
          <p>Commit bonus APY: { commitAPY }</p>
          <p>Hold bonus APY so far: { holdAPY }</p>
        </div>
      }>
      <InfoCircleTwoTone></InfoCircleTwoTone>
    </Tooltip>
  }

  return <div>    
    <h3> Bonus APY&nbsp;{ tooltip() } : 
      <Badge
        count={totalAPY}
        showZero={true}
      /> 
      </h3>
  </div>
}

function APYTextPenalty({contractState, tokenId, deposit}) {
  const secondsLeft = deposit?.timeLeft?.toNumber();
  const commitAPY = calcAPYPercent(
    contractState, tokenId, deposit?.balance, deposit?.commitBonus, secondsLeft);
  const holdAPY = calcAPYPercent(
    contractState, tokenId, deposit?.balance, deposit?.holdBonus, secondsLeft);
  const totalAPY = calcAPYPercent(
    contractState, tokenId, deposit?.balance, deposit?.bonus, secondsLeft);

  function tooltip() {
    return <Tooltip
      placement="top"
      title={
        <div>
          <p><b>Bonus will only be available after commitment period</b></p>
          <p>Calualations are assuming current bonus as available at commitment end time</p>
          <p>Possible commit bonus APY: { commitAPY }</p>
          <p>Possible hold bonus APY so far: { holdAPY }</p>
        </div>
      }>
      <InfoCircleTwoTone></InfoCircleTwoTone>
    </Tooltip>
  }

  return <div>    
    <h3> Possible bonus APY&nbsp;{ tooltip() } : 
      <Badge  count={totalAPY} showZero={true} />
    </h3>
  </div>
}



function calcAPYPercent(contractState, tokenId, principal, bonus, futureOffset) {
  const depositTime = contractState?.depositDatetime(tokenId);
  const withdrawalTime = new Date((contractState?.blockTimestamp + (futureOffset || 0)) * 1000);
  // const withdrawalTime = new Date(contractState?.blockTimestamp * 1000);
  const timeHeldSeconds = (withdrawalTime.getTime() - depositTime?.getTime()) / 1000;

  if (timeHeldSeconds === 0) return 'not available yet'; // same block as deposit

  // calc (bonus + deposit) / deposit in and avoid rounding to zero
  const precision = (Number.MAX_SAFE_INTEGER / 10000).toFixed(0);
  const bonuseRate = principal?.add(bonus).mul(precision)?.div(principal) / precision;

  // compound to yearly rate and remove 100%
  const apyPercent = 100 * (bonuseRate ** ( 86400 * 365 / timeHeldSeconds ) - 1); 

  // console.log(depositTime, timeHeldSeconds, bonuseRate, apyPercent )
  if (apyPercent > 10000) {
    return "10000+%";  // do not show astronomical percentages for short deposits
  } else if (apyPercent > 100) {
    return apyPercent.toFixed(1) + '%';
  } else if (apyPercent > 0) {
    return apyPercent.toFixed(2) + '%';
  } else {
    return "0%"
  }
}
/* eslint-disable jsx-a11y/accessible-emoji */

import React, { useState, useEffect } from "react";
import { Button, Input, Card, Row, Col, Modal, Tooltip, Divider,
  Steps, Empty, InputNumber} from "antd";
import { parseEther, parseUnits } from "@ethersproject/units";
import { LoadingOutlined, WarningTwoTone, DollarTwoTone, InfoCircleTwoTone } from "@ant-design/icons";


export function NewDepositCard(
  {contractState, contractTx, tokenTx, loading, tokenState, ethMode}
) {
  // commitment params
  const [penalty, penaltySet] = useState();
  const [period, periodSet] = useState();

  useEffect(() => {
    // set defaults when available
    penaltySet(contractState?.minInitialPenaltyPercent?.toNumber());
    periodSet(contractState?.minCommitPeriod?.toNumber());
  }, [contractState?.minInitialPenaltyPercent, contractState?.minCommitPeriod])

  const symbol = ethMode ? "ETH" : tokenState.symbol;
  const notReady = loading || !tokenState.address;
  return (
    <Card
      style={{
        border: "1px solid #cccccc", width: 600,
        margin: "auto", marginTop: 32, borderRadius: "20px"
      }}
      title={<h2>{notReady ? 
        <span>☝️ Choose token to deposit ☝️</span> : 
        <span><b>Deposit</b> to {symbol} pool</span>}</h2>}
      size="small"
    >

      {notReady ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No token chosen"/> :
        <div>
          <CommitmentInput
            contractState={contractState}
            penalty={penalty}
            period={period}
            penaltySet={penaltySet}
            periodSet={periodSet}
          />

          {ethMode ?
            <DepositElementETH
              contractState={contractState}
              contractTx={contractTx}
              penalty={penalty}
              period={period}
            />
            :
            <DepositElementERC20
              contractState={contractState}
              contractTx={contractTx}
              tokenTx={tokenTx}
              tokenState={tokenState}
              penalty={penalty}
              period={period}
            />
          }   
        </div>
      }
    </Card>
  );
}

function CommitmentInput(
   { contractState, penalty, penaltySet, period, periodSet } ) 
{
  const [daysValue, daysValueSet] = useState(period);
  const minPeriodSec = contractState?.minCommitPeriod?.toNumber();
  const minPeriodDaysRoundDown = (minPeriodSec / 86400).toPrecision(2);    
  const minInitialPenaltyPercent = contractState?.minInitialPenaltyPercent?.toNumber();

  // round up by adding a 0.0001 at whatever is the last decimal if is fraction
  const minPeriodDays = parseFloat(minPeriodDaysRoundDown) >= 1 ? 
    minPeriodDaysRoundDown : 
    ( 
      parseFloat(minPeriodDaysRoundDown) + 
      parseFloat(minPeriodDaysRoundDown.replace(/\d/ig, "0").slice(0, -1) + "1")
    ).toPrecision(2);

  // set default when available
  useEffect(() => daysValueSet(minPeriodDays), [minPeriodDays]);

  // call the update function when either changes
  useEffect(() => periodSet(parseInt(daysValue * 86400)) , [daysValue])
  
  return (
    <h3>
      Deposit for:&nbsp;
      <InputNumber
        style={{ margin: 8, width: "8rem", borderRadius: "20px"}}
        size="large"
        min={minPeriodDays}
        max={4 * 365}
        value={daysValue}
        onChange={daysValueSet}
        formatter={value => `${value} days`}
        parser={value => value.replace(' days', '')}
      />
      <CommitTimeTooltip contractState={contractState} />&nbsp;
      with&nbsp;
      <InputNumber
        size="large"
        step={5}
        min={minInitialPenaltyPercent}
        max={100}
        style={{ margin: 8, borderRadius: "20px" }}
        value={penalty}
        formatter={value => `${value}%`}
        parser={value => value.replace('%', '')}
        onChange={penaltySet}
      />
      <PenaltyTooltip contractState={contractState}/>&nbsp;
      penalty
    </h3>)
}

function DepositElementERC20({ contractState, contractTx, tokenState, tokenTx, penalty, period }) {
  const [amountToSend, setAmountToSend] = useState("0");
  const [depositModalVisible, setDepositModalVisible] = useState(false);
  const [depositButtonEnabled, setDepositButtonEnabled] = useState(false);
  const [approveButtonEnabled, setApproveButtonEnabled] = useState(false);
  const [approving, approvingSet] = useState(false);
  const [depositting, deposittingSet] = useState(false);

  useEffect(() => {
    const sendAmountBig = tokenState.decimals && parseUnits(amountToSend, tokenState.decimals);
    setApproveButtonEnabled(
      sendAmountBig?.gt(0) && tokenState?.allowance?.lt(sendAmountBig));
    setDepositButtonEnabled(
      sendAmountBig?.gt(0) && tokenState?.allowance?.gte(sendAmountBig));
  }, [amountToSend, tokenState.address, tokenState.allowance, tokenState.decimals])

  return (
    <div style={{ margin: 8 }}>
      <Row justify="center" style={{ margin: 12 }}>
        <Col span={20}>
          <Steps current={
            (depositting || depositButtonEnabled) ? 2 : ((approving || approveButtonEnabled) ? 1 : 0)
          } size="small">
            <Steps.Step title="Set amount" />
            <Steps.Step title="Approve" icon={approving ? <LoadingOutlined /> : null} />
            <Steps.Step title="Deposit" icon={depositting ? <LoadingOutlined /> : null} />
          </Steps>
        </Col>
      </Row>

      <Row gutter={24} justify="center">
        <Col span={8}>
          <Input
            onChange={(e) => {
              setAmountToSend(parseFloat(e.target.value) > 0 ? e.target.value : "0");
            }}
            size="large"
            suffix={tokenState.symbol}
            style={{ width: "100%", textAlign: "center", borderRadius: "20px"}}
          />
        </Col>

        <Col span={8}>
          <Tooltip
            title={approveButtonEnabled ? `Approve ${amountToSend} ${tokenState.symbol}` : ""}
            placement="top"
            color="blue">
            <Button
              onClick={() => {
                approvingSet(true);
                if (amountToSend > 0 && tokenState.decimals) {
                  tokenTx(
                    "approve",
                    [contractState.address, parseUnits(amountToSend, tokenState.decimals)],
                    () => approvingSet(false)
                  );
                }
              }}
              type="primary"
              size="large"
              shape="round"
              disabled={!approveButtonEnabled || approving}
              style={{ width: "100%", textAlign: "center" }}
            >
              {approveButtonEnabled ? `Approve` : "Approved"}
            </Button>
          </Tooltip>
        </Col>

        <Col span={8}>
          <Button
            onClick={() => setDepositModalVisible(true)}
            type="primary"
            size="large"
            shape="round"
            disabled={!depositButtonEnabled || depositting}
            style={{ width: "100%", textAlign: "center" }}
          >
            {contractState?.balance?.gt(0) ?
              "Add another deposit" : "Make a deposit"}
          </Button>
        </Col>
      </Row>

      <Modal
        title={<h3 style={{textAlign: "center"}}>
          Confirm deposit of {amountToSend} {tokenState.symbol}</h3>}
        okText="Confirm and commit"
        visible={depositModalVisible}
        onOk={() => {
          setDepositModalVisible(false);
          deposittingSet(true);
          if (amountToSend && amountToSend > 0 && tokenState.decimals) {
            contractTx(
              "deposit",
              [
                tokenState.address,
                parseUnits(amountToSend, tokenState.decimals),
                penalty,
                period,
              ],
              () => deposittingSet(false)
            );
          }
        }}
        onCancel={() => setDepositModalVisible(false)}>
          <DepositModalContent contractState={contractState} period={period} penalty={penalty}/>
      </Modal>     
    </div>)
}

function DepositElementETH({ contractState, contractTx, penalty, period }) {
  const [amountToSend, setAmountToSend] = useState("0");
  const [depositModalVisible, setDepositModalVisible] = useState(false);
  const [depositButtonEnabled, setDepositButtonEnabled] = useState(false);
  const [depositting, deposittingSet] = useState(false);

  useEffect(() => {
    const sendAmountBig = parseEther(amountToSend);
    setDepositButtonEnabled(sendAmountBig > 0);
  }, [amountToSend])

  return (
    <div style={{ margin: 8 }}>
      <Row justify="center" style={{ margin: 12 }}>
        <Col span={12}>
          <Steps current={(depositting || depositButtonEnabled) ? 1 : 0} size="small">
            <Steps.Step title="Set amount" />
            <Steps.Step title="Deposit" icon={depositting ? <LoadingOutlined /> : null} />
          </Steps>
        </Col>
      </Row>

      <Row gutter={24} justify="center">
        <Col span={8}>
          <Input
            onChange={(e) => {
              setAmountToSend(parseFloat(e.target.value) > 0 ? e.target.value : "0");
            }}
            size="large"
            suffix="ETH"
            style={{ width: "100%", textAlign: "center", borderRadius: "20px" }}
          />
        </Col>

        <Col span={8}>
          <Button
            onClick={() => setDepositModalVisible(true)}
            type="primary"
            size="large"
            shape="round"
            disabled={!depositButtonEnabled || depositting}
            style={{ width: "100%", textAlign: "center" }}
          >
            {contractState?.balance?.gt(0) ?
              "Add to deposit" : "Make a deposit"}
          </Button>
        </Col>

      </Row>

      <Modal
        title={<h3 style={{ textAlign: "center" }}>Confirm deposit of {amountToSend} ETH</h3>}
        okText="Confirm and commit"
        visible={depositModalVisible}
        onOk={() => {
          setDepositModalVisible(false);
          deposittingSet(true);
          if (amountToSend && amountToSend > 0) {
            contractTx(
              "depositETH",
              [penalty, period, { value: parseEther(amountToSend) }],
              () => deposittingSet(false));
          }
        }}
        onCancel={() => setDepositModalVisible(false)}>
        <DepositModalContent contractState={contractState} period={period} penalty={penalty} />
      </Modal>

    </div>)
}


function CommitTimeTooltip({ contractState }) {
  const minPeriodSec = contractState?.minCommitPeriod?.toNumber();
  return (
    <Tooltip title={
      <div>
        <b>Length of time before which withdrawing will only be possible with a penalty.</b>
        <ul>
          <li><b>Commit for longer to receive higher share of the bonus!</b></li>
          <li>Withdrawing with bonus will only be possible after this time.</li>
          <li>The minimum value allowed: {minPeriodSec} seconds (roughly {
            (minPeriodSec / 86400).toPrecision(2)
          } days).</li>
          <li>The maximum value allowed: four years.</li>
        </ul>
      </div>
    }>
      <InfoCircleTwoTone />
    </Tooltip>
  );
}

function PenaltyTooltip({ contractState }) {
  return (
    <Tooltip title={
      <div>
        <b>Starting value of the penalty percent</b>.
        <ul>
          <li><b>Commit to higher penalty to receive higher share of the bonus!</b></li>
          <li><b>The penalty decreases with time from the initial value to 0. </b>
            So immediately after deposit it's roughly this initial percent,
            and just before the end of the commitment period it's roughly 0.
          </li>
          <li>The minimum value allowed: {contractState?.minInitialPenaltyPercent?.toNumber()}%.</li>
          <li>The maximum value allowed: 100%.</li>
        </ul>
      </div>
    }>
      <InfoCircleTwoTone />
    </Tooltip>);
}

function DepositModalContent({contractState, period, penalty}) {
  return (
    <div>
      <h2>
        <DollarTwoTone twoToneColor="#52c41a" />&nbsp;
        Tip: Increasing commitment period and/or penalty percent will result higher share of bonus!
      </h2>
      <Divider />
      <h2>Chosen commitment period <CommitTimeTooltip contractState={contractState}/> : {
        contractState.secondsToCommitTimeString(period)
        }</h2>
      <h2>Chosen initial penalty <PenaltyTooltip contractState={contractState}/> : {penalty}%</h2>
      <Divider />      
      <h2>
        <WarningTwoTone twoToneColor="red" />&nbsp;
        Withdrawing before end of commitment period will be possible only with a penalty!!
      </h2>
    </div>
  );
}


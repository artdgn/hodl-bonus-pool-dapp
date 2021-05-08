/* eslint-disable jsx-a11y/accessible-emoji */

import React, { useState } from "react";
import { Button, List, Divider, Input, Card, DatePicker, Slider, Switch, Progress, Spin, Row, Col, Modal, Collapse, Checkbox, Typography, Drawer } from "antd";
import { Account, Address, Balance } from "../components";
import { parseEther, formatEther } from "@ethersproject/units";
import { useContractExistsAtAddress, useContractReader, useEventListener } from "../hooks";


class ContractStateHooks {

  constructor(readContracts, contractName, address) {
    this.balance = useContractReader(readContracts, contractName, "balanceOf", [address]);
    this.bonus = useContractReader(readContracts, contractName, "bonusOf", [address]);
    this.penalty = useContractReader(readContracts, contractName, "penaltyOf", [address]);
    this.timeLeft = useContractReader(readContracts, contractName, "timeLeftToHoldOf", [address]);
    this.bonusesPool = useContractReader(readContracts, contractName, "bonusesPool");
    this.depositsSum = useContractReader(readContracts, contractName, "depositsSum");
    this.commitPeriod = useContractReader(readContracts, contractName, "commitPeriod");
    this.initialPenaltyPercent = useContractReader(readContracts, contractName, "initialPenaltyPercent");

    // time convenience variables
    this.commitDays = parseFloat((this.commitPeriod || "0").toString()) / 86400;
    this.commitString = `${(this.commitPeriod || "").toString()} seconds 
                                  (${(this.commitDays).toPrecision(2)} days)`;
    this.timeLeftString = `${(this.timeLeft || "").toString()} seconds (out of 
                                    ${(this.commitPeriod || "").toString()} seconds)`;
    // withdrawal convenience variables
    this.withdrawWithPenalty = this.balance && this.penalty && this.penalty.gt(0) ?
      parseFloat(this.balance.sub(this.penalty).toString()) : 0;
    this.withdrawWithBonus = this.penalty && this.bonus && this.balance && this.penalty.eq(0) ?
      parseFloat(this.balance.add(this.bonus).toString()) : 0;
  }
}

export default function BasicUI(
  { address, provider, blockExplorer, price, tx, readContracts, writeContracts, contractName }) {

  // contract is there
  const contractAddress = readContracts && readContracts[contractName] ? 
    readContracts[contractName].address: "";
  const contractIsDeployed = useContractExistsAtAddress(provider, contractAddress);

  // contract state hooks
  const contractState = new ContractStateHooks(readContracts, contractName, address);

  // events
  const depositedEvents = useEventListener(readContracts, contractName, "Deposited", provider, 1, [address]);
  const withdrawedEvents = useEventListener(readContracts, contractName, "Withdrawed", provider, 1, [address]);
  const allEvents = depositedEvents.concat(withdrawedEvents)
    .sort((a, b) => b.blockNumber - a.blockNumber);

  // transaction callbacks
  const transactionFn = (method, ...args) => tx(writeContracts[contractName][method](...args));

  return (
    <div>
      <Card
        style={{ border: "1px solid #cccccc", padding: 16, width: 600, margin: "auto", marginTop: 64 }}
        title={<h2>{contractName}</h2>}
        size="large"
        loading={!contractIsDeployed}
      >        
        <Divider dashed>Deposit</Divider>

        <DepositElement contractState={contractState} txFn={transactionFn} />

        <Divider dashed>Withdraw</Divider>

        <h2>Current deposit:
            <Balance balance={contractState.balance} price={price} size="20"/>
        </h2>

        {(contractState.balance && contractState.balance.gt(0)) ? (
          <div>
            <h2>Time left to hold: {contractState.timeLeftString}</h2>

            <h2>Current penalty:
                <Balance balance={contractState.penalty} price={price} size="20"/>
            </h2>

            <h2>Current bonus:
                <Balance balance={contractState.bonus} price={price} size="20"/>
            </h2>

            <h2>Available to withdraw:
                <Balance
                balance={"" + (contractState.withdrawWithBonus || contractState.withdrawWithPenalty)}
                price={price} size="20"/>
            </h2>

            {contractState.withdrawWithBonus > 0 ?
              <WithdrawWithBonusButton contractState={contractState} txFn={transactionFn} />
              : ""}

            {contractState.withdrawWithPenalty > 0 ?
              <WithdrawWithPenaltyButton contractState={contractState} txFn={transactionFn} />
              : ""}

          </div>
        ) : ""}

        <Divider dashed>Pool info</Divider>

        <h2>
            Contract address: <Address address={contractAddress} blockExplorer={blockExplorer} fontSize="20"/> 
        </h2>

        <h2>Total deposits in pool:
            <Balance balance={contractState.depositsSum} price={price} size="20"/>
        </h2>

        <h2>Total bonus in pool:
            <Balance balance={contractState.bonusesPool} price={price} size="20"/>
        </h2>

        <h2>Commitment period: {contractState.commitString}</h2>

        <h2>Initial penalty percent: {(contractState.initialPenaltyPercent || "").toString()}%</h2>

      </Card>

      <EventsList eventsArray={allEvents}/>

    </div>
  );
}

function DepositElement({ contractState, txFn }) {
  const [amountToSend, setAmountToSend] = useState(0);
  const [depositModalVisible, setDepositModalVisible] = useState(false);
  const [depositButtonEnabled, setDepositButtonEnabled] = useState(false);
  // show rules description
  const [showRules, setShowRules] = useState(false);

  return (
    <div style={{ margin: 8 }}>
      <Row gutter={24}>
        <Col span={6}>
          <Button 
            onClick={()=>setShowRules(true)}
            size="large">
            Show rules
          </Button>

          <Drawer
            placement="bottom"
            height="40%"
            closable={false}
            onClose={()=>setShowRules(false)}
            visible={showRules}>
              <RulesDescription/>
          </Drawer>
        </Col>

        <Col span={10}>
          <Input
            onChange={(e) => {
              setAmountToSend(e.target.value);
              setDepositButtonEnabled(parseFloat(e.target.value) > 0);
            }}
            size="large"
            allowClear={true}
            suffix="ETH"
            style={{ textAlign: "right" }}
          />
        </Col>

        <Col span={6}>
          <Button
            onClick={() => setDepositModalVisible(true)}
            type="primary"
            size="large"
            disabled={!depositButtonEnabled}
          >
            {contractState.balance && contractState.balance.gt(0) ?
              "Add to deposit" : "Make a deposit"}
          </Button>
        </Col>

        <Modal
          title={`Confirm deposit of ${amountToSend} ETH`}
          okText="Confirm and commit"
          visible={depositModalVisible}
          onOk={() => {
            setDepositModalVisible(false);
            if (amountToSend && amountToSend > 0) {
              txFn("deposit", {value: parseEther(amountToSend)});
            }
          }}
          onCancel={() => setDepositModalVisible(false)}>
          <h2>Commitment period: {contractState.commitString}</h2>
          <Divider />
          <h2>⚠️ Withdrawing without penalty before that time won't be possible!!</h2>
        </Modal>

      </Row>
    </div>)
}

function WithdrawWithPenaltyButton({ contractState, txFn }) {
  const [penaltyModalVisible, setPenaltyModalVisible] = useState(false);
  return (
    <div>

      <Button
        onClick={() => setPenaltyModalVisible(true)}
        type="primary"
        danger
        size="large"
        disabled={!(contractState.withdrawWithPenalty > 0)}
      > Withdraw with penalty
      </Button>

      <Modal
        title={`Confirm withdrawal of 
                ${formatEther("" + contractState.withdrawWithPenalty)} ETH with penalty`}
        okText="Withdraw with penalty"
        visible={penaltyModalVisible}
        okButtonProps={{ danger: true }}
        onOk={() => {
          setPenaltyModalVisible(false);
          txFn("withdrawWithPenalty");
        }}
        onCancel={() => setPenaltyModalVisible(false)}>
        <h2>Withdraw {formatEther("" + contractState.withdrawWithPenalty)} ETH out of
            deposited {(formatEther(contractState.balance || "0").toString())} due
            to {formatEther((contractState.penalty || "0").toString())} penalty.</h2>
        <h2>⚠️ Wait until end of commitment period (
          {(contractState.timeLeft || "").toString()} seconds)
          to withdraw full deposit + any bonus!</h2>
      </Modal>

    </div>
  );
}

function WithdrawWithBonusButton({ contractState, txFn }) {
  const [bonusModalVisible, setBonusModalVisible] = useState(false);
  return (
    <div>

      <Button
        onClick={() => setBonusModalVisible(true)}
        type="primary"
        size="large"
        disabled={!(contractState.withdrawWithBonus > 0)}
      > Withdraw{contractState.bonus ? " with bonus 🤑" : ""}
      </Button>

      <Modal
        title={`Confirm withdrawal of ${formatEther("" + contractState.withdrawWithBonus)} ETH`}
        okText="Withdraw"
        visible={bonusModalVisible}
        onOk={() => {
          setBonusModalVisible(false);
          txFn("withdrawWithBonus");
        }}
        onCancel={() => setBonusModalVisible(false)}>
        <h2>Withdraw {formatEther("" + contractState.withdrawWithBonus)} ETH out of
            deposited {formatEther("" + (contractState.balance || "0"))} ETH
            {contractState.bonus ?
            ` with ${formatEther("" + (contractState.bonus || "0"))} ETH bonus!` : ""}
        </h2>
        <h2>⚠️ Waiting for longer may increase available bonus</h2>
      </Modal>

    </div>
  );
}

function EventsList({eventsArray}) {
  return (
    <Card
      style={{ width: 600, margin: "auto", marginTop: 32, paddingBottom: 32 }}
      title="Your past contract events"
    >
      <List
        bordered
        dataSource={eventsArray}
        renderItem={(item) => {
          let eventText = "";
          if (item.eventName == "Deposited") {
            eventText = `deposited ${item.amount.toString()} wei at ${item.time.toString()}`;
          } else if (item.eventName == "Withdrawed") {
            eventText = (`withdrew ${item.amount.toString()} wei ` +
              `out of ${item.depositAmount.toString()} ` +
              `(held for ${item.timeHeld.toString()}s)`
            );
            eventText += (item.penalty > 0) ? ` with ${item.penalty} penalty` : ''
            eventText += (item.bonus > 0) ? ` with ${item.bonus} bonus` : ''
          }
          return (
            <List.Item key={item.blockNumber + item.eventName + item.sender}>
              block {item.blockNumber}: <Address
                address={item.sender}
                fontSize={16}
              /> {eventText}
            </List.Item>
          )
        }}
      />
    </Card>);
}

function RulesDescription() {
  return (
    <Typography style={{textAlign: "left"}}>
      <Typography.Title level={4}>The pool allows ETH deposits and withdrawals with penalty
          and bonus mechanisms to encaurage long term holding:
      </Typography.Title>
      <Typography.Paragraph>
        <ul>
          <li> Depositor commits for a "commitment period", after which the deposit 
            can be withdrawn with any bonus.
          </li>          
          <li> The the bonus pool share is equal to the share of the deposit from all deposits
              at the time of withdrawal. E.g. if when you withdraw, the bonus pool is 2 ETH, 
              total deposits are 10 ETH, and your deposit is 1 ETH - you get 
              0.2 ETH ( = 2 * (1 / 10)) as bonus.
          </li>
          <li> Bonus pool is collected from penalties paid by early withdrawals 
            (withdrawals before the commitment period).
          </li>
          <li> Withdrawal before commitment period is does not get any bonus. 
              Instead, it is "slashed" with a penalty (that is added to the bonus pool).
          </li>
          <li> The penalty percent is decreasing linearly with time from 
              "initialPenaltyPercent" to 0 (for the duration of the commitPeriod). 
              E.g. if initialPenaltyPercent was 10%, and you withdraw after half the 
              commitment period, you get 5% penalty and withdraw 95% of the initial deposit.
          </li>
          <li> Any additional deposits are added to current deposit, and "reset" the
              commitment period required to wait.
          </li>
        </ul>
      </Typography.Paragraph>
    </Typography>
  )
}

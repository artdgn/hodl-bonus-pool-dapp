/* eslint-disable jsx-a11y/accessible-emoji */

import React, { useState } from "react";
import { Button, List, Divider, Input, Card, Row, Col, Modal, Typography, Drawer } from "antd";
import { Address, Balance } from "../components";
import { parseEther, formatEther } from "@ethersproject/units";
import { useContractExistsAtAddress, useContractReader, useEventListener } from "../hooks";
import ReactMarkdown from "react-markdown";
import { InfoCircleTwoTone, QuestionCircleTwoTone, WarningTwoTone } from "@ant-design/icons";


class HodlPoolEthV0StateHooks {

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
    this.timeLeftDays = parseFloat((this.timeLeft || "0").toString()) / 86400;
    this.commitString = `${(this.commitPeriod || "").toString()}s 
                        or ${(this.commitDays).toPrecision(2)} days`;
    this.timeLeftString = `${(this.timeLeft || "").toString()}s
                           or ${(this.timeLeftDays.toPrecision(2)).toString()} days`;
    // withdrawal convenience variables
    this.withdrawWithPenalty = this.balance && this.penalty && this.penalty.gt(0) ?
      parseFloat(this.balance.sub(this.penalty).toString()) : 0;
    this.withdrawWithBonus = this.penalty && this.bonus && this.balance && this.penalty.eq(0) ?
      parseFloat(this.balance.add(this.bonus).toString()) : 0;
  }
}

export function HodlPoolEthV0UI(
  { address, provider, blockExplorer, price, tx, readContracts, writeContracts, contractName }) {

  // contract is there
  const contractAddress = readContracts && readContracts[contractName] ? 
    readContracts[contractName].address: "";
  const contractIsDeployed = useContractExistsAtAddress(provider, contractAddress);

  // contract state hooks
  const contractState = new HodlPoolEthV0StateHooks(readContracts, contractName, address);

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
        title={
        <div>
          <h2>{contractName}</h2>
          <Row gutter={24} justify="center">
            <Col span={10}>
              <MotivationButton/>
            </Col>
            <Col span={10}>
              <RulesButton/>
            </Col>
          </Row>
        </div>
        }
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
  
  return (
    <div style={{ margin: 8}}>
      <Row gutter={24} justify="center">
        
        <Col span={8}>
          <Button
            onClick={() => setDepositModalVisible(true)}
            type="primary"
            size="large"
            disabled={!depositButtonEnabled}
            style={{ width: "100%", textAlign: "center"}}
          >
            {contractState.balance && contractState.balance.gt(0) ?
              "Add to deposit" : "Make a deposit"}
          </Button>
        </Col>

        <Col span={8}>
          <Input
            onChange={(e) => {
              setAmountToSend(e.target.value);
              setDepositButtonEnabled(parseFloat(e.target.value) > 0);
            }}
            size="large"
            suffix="ETH"
            style={{ width: "100%", textAlign: "center"}}
          />
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
          <h2>
            <WarningTwoTone twoToneColor="red"/> Withdrawing without
            penalty before that time won't be possible!!</h2>
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
        <h2> 
          <WarningTwoTone twoToneColor="red"/> Wait until end of commitment period
          ({contractState.timeLeftString})
          to withdraw full deposit + any bonus share!
          {contractState.bonus ?
            ` Current bonus share ${formatEther("" + (contractState.bonus || "0"))} ETH.` : ""}
          </h2>
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
        <h2>
          Withdraw {formatEther("" + contractState.withdrawWithBonus)} ETH out of
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

function RulesButton() {
  const markdown = `
## Pool Rules
- Depositor commits for a "commitment period", after which the deposit 
can be withdrawn with any bonus share.
- The bonus pool share is equal to the share of the deposit from all deposits
at the time of withdrawal. E.g. if when you withdraw, the bonus pool is 2 ETH, 
total deposits are 10 ETH, and your deposit is 1 ETH - you get 
0.2 ETH ( = 2 * (1 / 10)) as bonus.
- Bonus pool is collected from penalties paid by early withdrawals 
(withdrawals before the commitment period).
- Withdrawal before commitment period is does not get any bonus. 
Instead, it is "slashed" with a penalty (that is added to the bonus pool).  
- The penalty percent is decreasing linearly with time from 
"initialPenaltyPercent" to 0 (for the duration of the commitPeriod). 
E.g. if initialPenaltyPercent was 10%, and you withdraw after half the 
commitment period, you get 5% penalty and withdraw 95% of the initial deposit.
- Any additional deposits are added to current deposit, and "reset" the
  commitment period required to wait.`
  
  return <MarkdownDrawerButton 
    markdown={markdown} 
    title={<div><InfoCircleTwoTone /> Show rules</div>}
  />
}

function MotivationButton() {
    const markdown = `
### 💡 The idea: "Strong 💎 hands" (committed hodlers) get a bonus from "weak 🧁 hands"'s penalties for early withdrawals.

### ❔ Why this may be a good idea:
1. **Price effects** - like "staking", but without the inflation:
    - Makes HODLing more attractive by providing a positive economic incentive 🤑. 
    - Raises the price by reducing amount in circulation 📥.
    - Builds trust in the asset by proving an amount commited to be held 💍.
1. **Social / network effects** - like "time lock", but with an incentive to participate:
    - Makes HODLing provable and shareable 🐦 .
    - Increases trust in the community's / project team's long term commitment, provides a social incentive to demonstrate "skin in the game" 🙋‍♀️ .
1. **Yield generating** - like AMMs LP or lending, but without AMM's impermanent loss and doesn't depend on borrowing demand:
    - Vs. liquidity providing in AMMs: no dependence on trading volume, no exposure to additional assets, no bleeding value to arbitrageurs (~~not-so~~""impermanent"" loss) 🩸.
    - Vs. lending: earns yield on tokens that don't have a borrowing market with high interest rates 🔄 (or any borrowing market).
1. **Volatility bonus** - market volatility causes higher bonuses:
    - Asset price "moons" 🥳 - more "weak hands" will withdraw early to take profits, increasing the bonus 💸.
    - Asset price "tanks" 😢 - more "weak hands" will withdraw early to panic-sell, increasing the bonus 💸.`
    
      return <MarkdownDrawerButton 
      markdown={markdown} 
      title={<div><QuestionCircleTwoTone /> Show motivation </div>}
    />
}

function MarkdownDrawerButton({title, markdown}) {
  const [drawerVisible, setDrawerVisible] = useState(false);

  return (
    <div>
      <Button 
        onClick={()=>setDrawerVisible(true)}
        size="large"
        style={{fontSize: 20}}
        >{title}</Button>

      <Drawer
        placement="bottom"
        height="50%"
        closable={false}
        onClose={()=>setDrawerVisible(false)}
        visible={drawerVisible}>
          <Typography style={{textAlign: "left"}}>
            <ReactMarkdown children={markdown}/>
          </Typography>
      </Drawer>
    </div>
  );
}

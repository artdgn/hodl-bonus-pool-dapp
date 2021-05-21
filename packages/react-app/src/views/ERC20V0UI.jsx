/* eslint-disable jsx-a11y/accessible-emoji */

import React, { useState, useEffect } from "react";
import { Button, List, Divider, Input, Card, Row, Col, Modal, Typography, Drawer, Space, notification, Steps } from "antd";
import { Address, Balance } from "../components";
import { parseUnits, formatUnits } from "@ethersproject/units";
import { ethers } from "ethers";
import { useContractExistsAtAddress, useContractReader, useEventListener, useOnBlock } from "../hooks";
import ReactMarkdown from "react-markdown";
import { InfoCircleTwoTone, QuestionCircleTwoTone, WarningTwoTone, LoadingOutlined } from "@ant-design/icons";

class HodlPoolERC20V0StateHooks {

  constructor(contract, address) {
    this.address = contract && contract.address;
    this.balance = useContractReader(contract, "balanceOf", [address]);
    this.bonus = useContractReader(contract, "bonusOf", [address]);
    this.penalty = useContractReader(contract, "penaltyOf", [address]);
    this.timeLeft = useContractReader(contract, "timeLeftToHoldOf", [address]);
    this.bonusesPool = useContractReader(contract, "bonusesPool");
    this.depositsSum = useContractReader(contract, "depositsSum");
    this.commitPeriod = useContractReader(contract, "commitPeriod");
    this.initialPenaltyPercent = useContractReader(contract, "initialPenaltyPercent");
    this.tokenAddress = useContractReader(contract, "token");

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

const erc20Abi = [
  "function balanceOf(address owner) view returns (uint256)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
  "function approve(address _spender, uint256 _value) public returns (bool success)",
  "function allowance(address _owner, address _spender) public view returns (uint256 remaining)"
];

function useTokenState(contract, userAddress, spenderAddress) {
  const emptyState = {
    tokenContract: contract,
    address: contract.address,
    decimals: undefined,
    name: undefined,
    symbol: undefined,
    balance: undefined,
    allowance: undefined,
  }
  const [tokenState, setTokenState] = useState(emptyState);

  const updateValues = async () => {
    if (contract.address && contract) {
      try {
        setTokenState({
          tokenContract: contract,
          address: contract.address,
          decimals: await contract.decimals(),
          name: await contract.name(),
          symbol: await contract.symbol(),
          balance: await contract.balanceOf(userAddress),
          allowance: await contract.allowance(userAddress, spenderAddress),
        });
        if (tokenState.address && tokenState.address !== contract.address) {
          notification.open({
            message: 'Switched token contract',
            description:
            `From ${tokenState.address} to ${contract.address}`,
          });  
        }
      } catch (e) {
        console.log(e);
        notification.open({
          message: 'Failed to read ERC20 contract',
          description:
          `${contract.address} is not a valid ERC20 contract address`,
        });
      }
    }
  }

  useEffect(() => { if (contract) updateValues() }, [contract]); 
  
  useOnBlock(contract && contract.provider, () => updateValues());

  return tokenState;
}

function useContractAtAddress(address, abi, provider) {
  const [contract, setContract] = useState({ address: address });

  const readContract = async () => {
    if (address && provider) {
      const contract = new ethers.Contract(address, abi, provider, provider.getSigner());
      setContract(contract);
    }
  }
  useEffect(() => {
    readContract();
  }, [address, abi, provider]);

  return contract;
}

export function HodlPoolERC20V0UI(
  { address, provider, blockExplorer, tx, readContracts, writeContracts, contractName }) {

  // contract is there
  const contract = readContracts && readContracts[contractName];
  const contractAddress = contract ? contract.address : "";
  const contractIsDeployed = useContractExistsAtAddress(provider, contractAddress);
  
  // contract state hooks
  const contractState = new HodlPoolERC20V0StateHooks(contract, address);
  
  const [tokenAddress, setTokenAddress] = useState();

  useEffect(() => setTokenAddress(contractState.tokenAddress), [contractState.tokenAddress])

  const tokenContract = useContractAtAddress(tokenAddress, erc20Abi, provider);
  
  const tokenState = useTokenState(tokenContract, address, contractAddress);

  // transaction callbacks
  const contractTx = (method, ...args) => tx(writeContracts[contractName][method](...args));
  const tokenTx = (method, ...args) => tx(tokenContract.connect(provider.getSigner())[method](...args));

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
        <Divider dashed>Token</Divider>

        <TokenControl tokenState={tokenState} addessUpdateFn={setTokenAddress} blockExplorer={blockExplorer}/>

        <Divider dashed>Deposit</Divider>
        
        <DepositElement 
          contractState={contractState} contractTx={contractTx} tokenTx={tokenTx} tokenState={tokenState} />

        <Divider dashed>Withdraw</Divider>

        <h2>Current deposit:
            <Balance balance={contractState.balance} symbol={tokenState.symbol} size="20" />
        </h2>

        {(contractState.balance && contractState.balance.gt(0)) ? (
          <div>
            <h2>Time left to hold: {contractState.timeLeftString}</h2>

            <h2>Current penalty:
                <Balance balance={contractState.penalty} symbol={tokenState.symbol} size="20" />
            </h2>

            <h2>Current bonus:
                <Balance balance={contractState.bonus} symbol={tokenState.symbol} size="20" />
            </h2>

            <h2>Available to withdraw:
                <Balance
                  balance={"" + (contractState.withdrawWithBonus || contractState.withdrawWithPenalty)}
                  symbol={tokenState.symbol}
                  size="20" />
            </h2>

            {contractState.withdrawWithBonus > 0 ?
              <WithdrawWithBonusButton
                contractState={contractState}
                txFn={contractTx}
                tokenState={tokenState} />
              : ""}

            {contractState.withdrawWithPenalty > 0 ?
              <WithdrawWithPenaltyButton
                contractState={contractState}
                txFn={contractTx}
                tokenState={tokenState} />
              : ""}

          </div>
        ) : ""}

        <Divider dashed>Pool info</Divider>

        <h2>
          Contract address: <Address address={contractAddress} blockExplorer={blockExplorer} fontSize="20" />
        </h2>

        <h2>Total deposits in pool:
            <Balance balance={contractState.depositsSum} symbol={tokenState.symbol} size="20" />
        </h2>

        <h2>Total bonus in pool:
            <Balance balance={contractState.bonusesPool} symbol={tokenState.symbol} size="20" />
        </h2>

        <h2>Commitment period: {contractState.commitString}</h2>

        <h2>Initial penalty percent: {(contractState.initialPenaltyPercent || "").toString()}%</h2>

      </Card>

      <EventsList contract={contract} address={address} />

    </div>
  );
}

function TokenControl({tokenState, addessUpdateFn, blockExplorer}) {
  return (
    <Space direction="vertical">

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

      
      {/* <Input
        defaultValue={tokenState.address}
        prefix="Switch token: "
        onPressEnter={e => addessUpdateFn(e.target.value)}>
      </Input> */}

    </Space>
  )
}

function DepositElement({ contractState, contractTx, tokenState, tokenTx }) {
  const [amountToSend, setAmountToSend] = useState("0");
  const [depositModalVisible, setDepositModalVisible] = useState(false);
  const [depositButtonEnabled, setDepositButtonEnabled] = useState(false);
  const [approveButtonEnabled, setApproveButtonEnabled] = useState(false);
  const [approving, approvingSet] = useState(false);
  const [depositting, deposittingSet] = useState(false);

  useEffect(() => {
    const sendAmountBig = tokenState.decimals && parseUnits(amountToSend, tokenState.decimals);
    setApproveButtonEnabled(tokenState.allowance && tokenState.allowance.lt(sendAmountBig));
    setDepositButtonEnabled(
      (sendAmountBig > 0) && (tokenState.allowance && tokenState.allowance.gte(sendAmountBig))
    );
  }, [amountToSend, tokenState.address, tokenState.allowance, tokenState.decimals])

  return (
    <div style={{ margin: 8 }}>
      <Row justify="center" style={{ margin: 12 }}>
        <Col span={20}>
          <Steps current={
            (depositting || depositButtonEnabled) ? 2 : ((approving || approveButtonEnabled) ? 1 : 0)
          } size="small">
            <Steps.Step title="Set amount"/>
            <Steps.Step title="Approve" icon={approving ? <LoadingOutlined /> : null}/>
            <Steps.Step title="Deposit" icon={depositting ? <LoadingOutlined /> : null}/>
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
            style={{ width: "100%", textAlign: "center" }}
          />
        </Col>

        <Col span={8}>
          <Button
            onClick={() => {
              approvingSet(true);
              if (amountToSend && amountToSend > 0 && tokenState.decimals) {
                tokenTx("approve", contractState.address, parseUnits(amountToSend, tokenState.decimals));
              }
              setTimeout(()=>approvingSet(false), 1000);
            }}
            type="primary"
            size="large"
            disabled={!approveButtonEnabled}
            style={{ width: "100%", textAlign: "center" }}
          >
            {approveButtonEnabled ? `Approve ${amountToSend} ${tokenState.symbol}` : "Approved"}
          </Button>
        </Col>

        <Col span={8}>
          <Button
            onClick={() => setDepositModalVisible(true)}
            type="primary"
            size="large"
            disabled={!depositButtonEnabled}
            style={{ width: "100%", textAlign: "center" }}
          >
            {contractState.balance && contractState.balance.gt(0) ?
              "Add to deposit" : "Make a deposit"}
          </Button>
        </Col>
        
        <Modal
          title={`Confirm deposit of ${amountToSend} ${tokenState.symbol}`}
          okText="Confirm and commit"
          visible={depositModalVisible}
          onOk={() => {
            setDepositModalVisible(false);
            deposittingSet(true);
            if (amountToSend && amountToSend > 0 && tokenState.decimals) {
              contractTx("deposit", parseUnits(amountToSend, tokenState.decimals));
            }
            setTimeout(()=>deposittingSet(false), 1000);
          }}
          onCancel={() => setDepositModalVisible(false)}>
          <h2>Commitment period: {contractState.commitString}</h2>
          <Divider />
          <h2>
            <WarningTwoTone twoToneColor="red" /> Withdrawing without
            penalty before that time won't be possible!!</h2>
        </Modal>

      </Row>
    </div>)
}

function WithdrawWithPenaltyButton({ contractState, txFn, tokenState }) {
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
                ${tokenState.decimals && 
                  formatUnits("" + contractState.withdrawWithPenalty, tokenState.decimals)} 
                ${tokenState.symbol} with penalty`}
        okText="Withdraw with penalty"
        visible={penaltyModalVisible}
        okButtonProps={{ danger: true }}
        onOk={() => {
          setPenaltyModalVisible(false);
          txFn("withdrawWithPenalty");
        }}
        onCancel={() => setPenaltyModalVisible(false)}>
        <h2>Withdraw&nbsp;
          {formatUnits("" + contractState.withdrawWithPenalty, tokenState.decimals)}&nbsp;
          {tokenState.symbol} out of deposited&nbsp;
          {formatUnits(contractState.balance, tokenState.decimals)} due to&nbsp;
          {formatUnits(contractState.penalty, tokenState.decimals)} penalty.</h2>
        <h2>
          <WarningTwoTone twoToneColor="red" /> Wait until end of commitment period
          ({contractState.timeLeftString})
          to withdraw full deposit + any bonus share!
          {contractState.bonus && contractState.bonus.gt(0) ?
            ` Current bonus share ${formatUnits(contractState.bonus, tokenState.decimals)} 
            ${tokenState.symbol}.` : ""}
        </h2>
      </Modal>

    </div>
  );
}

function WithdrawWithBonusButton({ contractState, txFn, tokenState }) {
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
        title={`Confirm withdrawal of 
              ${formatUnits("" + contractState.withdrawWithBonus, tokenState.decimals)} 
              ${tokenState.symbol}`}
        okText="Withdraw"
        visible={bonusModalVisible}
        onOk={() => {
          setBonusModalVisible(false);
          txFn("withdrawWithBonus");
        }}
        onCancel={() => setBonusModalVisible(false)}>
        <h2>
          Withdraw&nbsp;
          {formatUnits("" + contractState.withdrawWithBonus, tokenState.decimals)}&nbsp;
          {tokenState.symbol} out of deposited&nbsp;
          {formatUnits(contractState.balance, tokenState.decimals)} {tokenState.symbol}
          {contractState.bonus && contractState.bonus.gt(0) ?
            ` with ${formatUnits(contractState.bonus, tokenState.decimals)} 
            ${tokenState.symbol} bonus!` : "."}
        </h2>
        <h2>⚠️ Waiting for longer may increase available bonus.</h2>
      </Modal>

    </div>
  );
}

function EventsList({ contract, address }) {
  const depositedEvents = useEventListener(
    contract, "Deposited", contract && contract.provider, 0, [address]);
  const withdrawedEvents = useEventListener(
    contract, "Withdrawed", contract && contract.provider, 0, [address]);
  const allEvents = depositedEvents.concat(withdrawedEvents)
    .sort((a, b) => b.blockNumber - a.blockNumber);

  return (
    <Card
      style={{ width: 600, margin: "auto", marginTop: 32, paddingBottom: 32 }}
      title="Your past contract events"
    >
      <List
        bordered
        dataSource={allEvents}
        renderItem={(item) => {
          let eventText = "";
          if (item.eventName === "Deposited") {
            eventText = `deposited ${item.amount.toString()} at ${item.time.toString()}`;
          } else if (item.eventName === "Withdrawed") {
            eventText = (`withdrew ${item.amount.toString()} ` +
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
### TL;DR: 1. Deposit and don't withdraw early 💎✊. 2. Get bonus if other people withdraw early 🤑.
- Depositor commits for a "commitment period", after which the deposit 
can be withdrawn with any bonus share.
- The bonus pool share is equal to the share of the deposit from all deposits
at the time of withdrawal. E.g. if when you withdraw, the bonus pool is 2 Token, 
total deposits are 10 Token, and your deposit is 1 Token - you get 
0.2 Token ( = 2 * (1 / 10)) as bonus.
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

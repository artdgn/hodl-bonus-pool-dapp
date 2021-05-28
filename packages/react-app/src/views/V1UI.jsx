/* eslint-disable jsx-a11y/accessible-emoji */

import React, { useState, useEffect } from "react";
import { Button, List, Divider, Input, Card, Row, Col, Modal, Typography, Space, notification, Select, Steps, Result, Tooltip, Skeleton, Empty } from "antd";
import { Address, Balance } from "../components";
import { parseEther, parseUnits, formatUnits } from "@ethersproject/units";
import { ethers } from "ethers";
import { useContractExistsAtAddress, useContractReader, useEventListener, useTokenList } from "../hooks";
import ReactMarkdown from "react-markdown";
import { InfoCircleTwoTone, QuestionCircleTwoTone, WarningTwoTone, LoadingOutlined, QuestionOutlined } from "@ant-design/icons";

class HodlPoolV1StateHooks {

  constructor(contract, address, tokenAddress) {
    this.address = contract && contract.address;
    this.tokenAddress = tokenAddress;
    this.balance = useContractReader(tokenAddress && contract, "balanceOf", [tokenAddress, address]);
    this.bonus = useContractReader(tokenAddress && contract, "bonusOf", [tokenAddress, address]);
    this.penalty = useContractReader(tokenAddress && contract, "penaltyOf", [tokenAddress, address]);
    this.timeLeft = useContractReader(tokenAddress && contract, "timeLeftToHoldOf", [tokenAddress, address]);
    this.bonusesPool = useContractReader(tokenAddress && contract, "bonusesPool", [tokenAddress]);
    this.depositsSum = useContractReader(tokenAddress && contract, "depositsSum", [tokenAddress]);
    this.commitPeriod = useContractReader(contract, "commitPeriod", [], 86400 * 1000);
    this.initialPenaltyPercent = useContractReader(contract, "initialPenaltyPercent", [], 86400 * 1000);
    this.WETHAddress = useContractReader(contract, "WETH", [], 86400 * 1000);

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

class TokenStateHooks {

  constructor(contract, userAddress, spenderAddress, setLoading, setError) {
    const [prevAddress, setPrevAddress] = useState()
    const [failed, setFailed] = useState(false);

    this.tokenContract = contract;
    this.address = contract && contract.address;

    const onFail = () => {
      setFailed(this.address);
      setLoading(true);
    }
    const onChange = () => {
      setFailed(false);
      setLoading(false);
    }

    this.symbol = useContractReader(
      contract, "symbol", [], 86400 * 1000, onChange, onFail);
    this.decimals = useContractReader(
      contract, "decimals", [], 86400 * 1000, null, onFail);
    this.name = useContractReader(
      contract, "name", [], 86400 * 1000, null, onFail);
    this.balance = useContractReader(
      contract, "balanceOf", [userAddress], 0, null, onFail);
    this.allowance = useContractReader(
      contract, "allowance", [userAddress, spenderAddress], 0, null, onFail);

    // notify of failure
    useEffect(() => {
      if (this.address && failed) {
        notification.error({
          message: 'Failed to read ERC20 contract',
          description: `${failed} is not a valid ERC20 contract address`,
        });
        setError(`${failed} is not a valid ERC20 contract address, select another token.`);
      }
      setPrevAddress(this.address);
    }, [failed, this.address])

    // notify of address change
    useEffect(() => {
      if (this.address && prevAddress && prevAddress !== this.address) {
        setLoading(true);
        setError("");
        notification.success({
          message: 'Switched token contract',
          description: `From ${prevAddress} to ${this.address}`,
        });
      }
    }, [this.address, prevAddress])
  }
}

function useERC20ContractAtAddress(address, provider) {
  const [contract, setContract] = useState();

  useEffect(() => {
    const erc20Abi = [
      "function balanceOf(address owner) view returns (uint256)",
      "function symbol() view returns (string)",
      "function name() view returns (string)",
      "function decimals() view returns (uint8)",
      "function approve(address _spender, uint256 _value) public returns (bool success)",
      "function allowance(address _owner, address _spender) public view returns (uint256 remaining)"
    ];

    const readContract = async () => {
      if (address && provider) {
        const contract = new ethers.Contract(address, erc20Abi, provider, provider.getSigner());
        setContract(contract);
      } else {
        setContract(null);
      }
    }

    readContract();
  }, [address, provider]);

  return contract;
}

export function HodlPoolV1UI(
  { address, provider, blockExplorer, tx, readContracts, writeContracts, contractName }) {

  // main contract
  const contract = readContracts && readContracts[contractName];
  const contractAddress = contract ? contract.address : "";
  const contractIsDeployed = useContractExistsAtAddress(provider, contractAddress);

  // token choice state
  const [tokenChoice, setTokenChoice] = useState("");
  const [ethMode, ethModeSet] = useState(false);
  const [tokenAddress, setTokenAddress] = useState();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // contract state hooks
  const tokenContract = useERC20ContractAtAddress(tokenAddress, provider);
  const tokenState = new TokenStateHooks(
    tokenContract, address, contractAddress, setLoading, setError);
  const contractState = new HodlPoolV1StateHooks(contract, address, tokenAddress);

  // switch token address and eth-mode depending on token choice
  useEffect(() => {
    setTokenAddress(tokenChoice === "ETH" ? contractState.WETHAddress : tokenChoice);
    ethModeSet(tokenChoice === "ETH");
  }, [tokenChoice, contractState.WETHAddress])

  // transaction wrappers
  const contractTx = (method, args, callback) =>
    tx(writeContracts[contractName][method](...(args ?? [])).finally(callback));
  const tokenTx = (method, args, callback) =>
    tx(tokenContract.connect(provider.getSigner())[method](...(args ?? [])).finally(callback));

  const symbol = ethMode ? "ETH" : tokenState.symbol;

  return (
    <div>
      <Card
        style={{ border: "1px solid #cccccc", padding: 16, width: 600, margin: "auto", marginTop: 64 }}
        title={
          <div>
            <h1>HODL pool V1</h1>
            <h4>Deposit ERC20 tokens or ETH and don't withdraw early 💎✊</h4>
            <h4>Get bonus if other people withdraw early 🤑</h4>
          </div>
        }
        size="large"
        loading={!contractIsDeployed}
      >
        <Divider dashed> <h3>👇 Pick or import token 👇</h3></Divider>

        <Space direction="vertical" size="large">
          <TokenSelection provider={provider} addessUpdateFn={setTokenChoice} />

          {error ? <Result status="warning" subTitle={error} /> : ""}

          {loading ?
            <LoadingOutlined style={{ fontSize: 24 }} spin size="large" /> :
            <TokenBalance
              tokenState={tokenState}
              blockExplorer={blockExplorer}
              ethMode={ethMode}
              address={address}
              provider={provider}
            />
          }
        </Space>

        {loading || !tokenState.address ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} /> :
          <div>
            <Divider dashed>Deposit to {symbol} pool</Divider>

            {ethMode ?
              <DepositElementETH
                contractState={contractState}
                contractTx={contractTx}
              />
              :
              <DepositElementToken
                contractState={contractState}
                contractTx={contractTx}
                tokenTx={tokenTx}
                tokenState={tokenState}
                ethMode={ethMode}
              />
            }

            <Divider dashed>Withdraw from {symbol} pool</Divider>

            <WithdrawElement
              contractState={contractState}
              contractTx={contractTx}
              tokenState={tokenState}
              ethMode={ethMode}
            />

            <Divider dashed>{symbol} Pool info</Divider>

            <PoolInfo
              contractState={contractState}
              blockExplorer={blockExplorer}
              contractAddress={contractAddress}
              symbol={symbol}
            />
          </div>
        }

        <Space size="large" direction="vertical">
          <Row span={24} gutter={300}>
            <Col span={12}><MotivationButton /></Col> <Col span={12}><RulesButton /></Col>
          </Row>
        </Space>

      </Card>

      <EventsList contract={contract} address={address} />

    </div>
  );
}

function TokenBalance({ tokenState, blockExplorer, ethMode, address, provider }) {
  if (ethMode) {
    return (
      <h3>Wallet balance: <Balance address={address} provider={provider} size="20" /></h3>
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

function TokenSelection({ provider, addessUpdateFn }) {

  // external token list
  const activeChainId = provider && provider.network && provider.network.chainId;
  const tokenListURI = activeChainId === 31337 ?
    "local" : "https://gateway.ipfs.io/ipns/tokens.uniswap.org";
  const externalTokensList = useTokenList(tokenListURI, activeChainId);

  // track the input state
  const [rawInput, rawInputSet] = useState("");
  const [selectedValue, selectedValueSet] = useState("");

  // any additional tokens
  const [extraTokens, extraTokensSet] = useState([{
    "chainId": activeChainId,
    "address": "ETH",
    "symbol": "ETH",
  }])

  function tokenLogo(token) {
    let logoURI;
    if (token.logoURI) {
      logoURI = token.logoURI.replace("ipfs://", "https://ipfs.io/ipfs/");
    } else if (token.symbol === "ETH" || token.symbol === "WETH") {
      logoURI = (
        "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains" +
        "/ethereum/assets/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/logo.png");
    } else {
      return <QuestionOutlined style={{ width: '30px' }} />
    }
    return <img src={logoURI} width='30px' alt="" />
  }

  const shortenString = val => (val.length > 8 ? val.slice(0, 8) + '..' : val);

  const importTokenButton = (
    <Button
      onClick={() => {
        addessUpdateFn(rawInput);
        extraTokensSet(arr =>
          [...arr, {
            "chainId": activeChainId,
            "address": rawInput,
            "symbol": rawInput,
          }]);
        selectedValueSet(rawInput);
      }}
      type="primary"
      size="large"
      style={{ width: "100%", textAlign: "center" }}
    >
      Import token {shortenString(rawInput)} ?
    </Button>
  )

  return (
    <Tooltip title="Paste address to add a token to the list" 
      placement="left" 
      autoAdjustOverflow="false"
      color="gray">
      <Select
        showSearch
        value={selectedValue}
        onChange={(val) => {
          addessUpdateFn(val);
          selectedValueSet(val);
        }}
        optionFilterProp="children"
        size="large"
        dropdownMatchSelectWidth={false}
        style={{ minWidth: "14rem", textAlign: "center" }}
        autoFocus={true}
        onSearch={rawInputSet}
        notFoundContent={importTokenButton}
      >
        {[{ address: "" }, ...extraTokens, ...externalTokensList].map((token, i) =>
          <Select.Option key={i} value={token.address}>
            {token.symbol && tokenLogo(token)} {token.symbol}
          </Select.Option>
        )}
      </Select>
    </Tooltip>
  );
}

function DepositElementToken({ contractState, contractTx, tokenState, tokenTx }) {
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
            style={{ width: "100%", textAlign: "center" }}
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
                if (amountToSend && amountToSend > 0 && tokenState.decimals) {
                  tokenTx(
                    "approve",
                    [contractState.address, parseUnits(amountToSend, tokenState.decimals)],
                    () => approvingSet(false)
                  );
                }
              }}
              type="primary"
              size="large"
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
            disabled={!depositButtonEnabled || depositting}
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
              contractTx(
                "deposit",
                [tokenState.address, parseUnits(amountToSend, tokenState.decimals)],
                () => deposittingSet(false)
              );
            }
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

function DepositElementETH({ contractState, contractTx }) {
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
            style={{ width: "100%", textAlign: "center" }}
          />
        </Col>

        <Col span={8}>
          <Button
            onClick={() => setDepositModalVisible(true)}
            type="primary"
            size="large"
            disabled={!depositButtonEnabled || depositting}
            style={{ width: "100%", textAlign: "center" }}
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
            deposittingSet(true);
            if (amountToSend && amountToSend > 0) {
              contractTx(
                "depositETH",
                [{ value: parseEther(amountToSend) }],
                () => deposittingSet(false));
            }
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

function WithdrawElement({ contractState, tokenState, ethMode, contractTx }) {
  const symbol = ethMode ? "ETH" : tokenState.symbol;

  let depositInfo = "";
  if (contractState.balance && contractState.balance.gt(0)) {
    depositInfo = (
      <div>

        <h2>Available to withdraw:
            <Balance
            balance={"" + (contractState.withdrawWithBonus || contractState.withdrawWithPenalty)}
            symbol={symbol}
            size="20" />
        </h2>

        {contractState.bonus?.gt(0) ?
          <h2>Current bonus:
            <Balance balance={contractState.bonus} symbol={symbol} size="20" />
          </h2>
          : ""}


        {contractState.withdrawWithBonus > 0 ?
          <WithdrawWithBonusButton
            contractState={contractState}
            txFn={contractTx}
            tokenState={tokenState}
            ethMode={ethMode}
          />
          : ""}

        {contractState.withdrawWithPenalty > 0 ?
          <div>
            <h2>Current penalty:
              <Balance balance={contractState.penalty} symbol={symbol} size="20" />
            </h2>
            <h2>Time left to hold: {contractState.timeLeftString}</h2>
            <WithdrawWithPenaltyButton
              contractState={contractState}
              txFn={contractTx}
              tokenState={tokenState}
              ethMode={ethMode}
            />
          </div>
          : ""}

      </div>
    );
  }

  return (
    <div>
      <h2>Your deposit:
        <Balance balance={contractState.balance} symbol={symbol} size="20" />
      </h2>
      { depositInfo}
    </div>
  );
}

function WithdrawWithPenaltyButton({ contractState, txFn, tokenState, ethMode }) {
  const [penaltyModalVisible, setPenaltyModalVisible] = useState(false);
  const symbol = ethMode ? "ETH" : tokenState.symbol;
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
                ${symbol} with penalty`}
        okText="Withdraw with penalty"
        visible={penaltyModalVisible}
        okButtonProps={{ danger: true }}
        onOk={() => {
          setPenaltyModalVisible(false);
          if (ethMode) {
            txFn("withdrawWithPenaltyETH");
          } else {
            txFn("withdrawWithPenalty", [tokenState.address]);
          }
        }}
        onCancel={() => setPenaltyModalVisible(false)}>
        <h2>Withdraw&nbsp;
          {formatUnits("" + contractState.withdrawWithPenalty, tokenState.decimals)}&nbsp;
          {symbol} out of deposited&nbsp;
          {formatUnits(contractState.balance, tokenState.decimals)} due to&nbsp;
          {formatUnits(contractState.penalty, tokenState.decimals)} penalty.</h2>
        <h2>
          <WarningTwoTone twoToneColor="red" /> Wait until end of commitment period
          ({contractState.timeLeftString})
          to withdraw full deposit + any bonus share!
          {contractState.bonus && contractState.bonus.gt(0) ?
            ` Current bonus share ${formatUnits(contractState.bonus, tokenState.decimals)} 
            ${symbol}.` : ""}
        </h2>
      </Modal>

    </div>
  );
}

function WithdrawWithBonusButton({ contractState, txFn, tokenState, ethMode }) {
  const [bonusModalVisible, setBonusModalVisible] = useState(false);
  const symbol = ethMode ? "ETH" : tokenState.symbol;
  return (
    <div>

      <Button
        onClick={() => setBonusModalVisible(true)}
        type="primary"
        size="large"
        disabled={!(contractState.withdrawWithBonus > 0)}
      > Withdraw
        {contractState.bonus && contractState.bonus.gt(0) ? " with bonus 🤑" : ""}
      </Button>

      <Modal
        title={`Confirm withdrawal of 
              ${formatUnits("" + contractState.withdrawWithBonus, tokenState.decimals)} 
              ${symbol}`}
        okText="Withdraw"
        visible={bonusModalVisible}
        onOk={() => {
          setBonusModalVisible(false);
          if (ethMode) {
            txFn("withdrawWithBonusETH");
          } else {
            txFn("withdrawWithBonus", [tokenState.address]);
          }
        }}
        onCancel={() => setBonusModalVisible(false)}>
        <h2>
          Withdraw&nbsp;
          {formatUnits("" + contractState.withdrawWithBonus, tokenState.decimals)}&nbsp;
          {symbol} out of deposited&nbsp;
          {formatUnits(contractState.balance, tokenState.decimals)} {symbol}
          {contractState.bonus && contractState.bonus.gt(0) ?
            ` with ${formatUnits(contractState.bonus, tokenState.decimals)} 
            ${symbol} bonus!` : "."}
        </h2>
        <h2>⚠️ Waiting for longer may increase available bonus.</h2>
      </Modal>

    </div>
  );
}

function PoolInfo({ contractState, blockExplorer, contractAddress, symbol }) {
  return (
    <div>
      <h3>Total deposits in {symbol} pool:
          <Balance balance={contractState.depositsSum} symbol={symbol} size="20" />
      </h3>

      <h3>Total bonus in {symbol} pool:
          <Balance balance={contractState.bonusesPool} symbol={symbol} size="20" />
      </h3>

      <h3>Commitment period: {contractState.commitString}</h3>

      <h3>Initial penalty percent:&nbsp;
          {(contractState.initialPenaltyPercent || "").toString()}%
      </h3>

      <h3>Contract address:&nbsp;
          <Address address={contractAddress} blockExplorer={blockExplorer} fontSize="20" />
      </h3>
    </div>
  );
}

function EventsList({ contract, address }) {
  const depositedEvents = useEventListener(
    contract, "Deposited", contract && contract.provider, 0, [null, address]);
  const withdrawedEvents = useEventListener(
    contract, "Withdrawed", contract && contract.provider, 0, [null, address]);
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
            eventText = (
              `deposited ${item.amount.toString()} ` +
              `at ${item.time.toString()}`);
          } else if (item.eventName === "Withdrawed") {
            eventText = (
              `withdrew ${item.amount.toString()} ` +
              `out of ${item.depositAmount.toString()} ` +
              `(held for ${item.timeHeld.toString()}s)`
            );
            eventText += (item.penalty > 0) ? ` with ${item.penalty} penalty` : ''
            eventText += (item.bonus > 0) ? ` with ${item.bonus} bonus` : ''
          }
          return (
            <List.Item key={item.blockNumber + item.eventName + item.sender}>
              block {item.blockNumber}:
              user <Address address={item.sender} fontSize={16} />&nbsp;
              {eventText} of token <Address address={item.token} fontSize={16} />.
            </List.Item>
          )
        }}
      />
    </Card>);
}

function RulesButton() {
  const markdown = `
## Pool Rules
- Each token has one independent pool. i.e. all accounting is separate for each token.
- There is no pool creation process - one contract holds all pools.
- Depositor commits for a "commitment period", after which the deposit 
can be withdrawn with any bonus share.
- The bonus pool share is equal to the share of the deposit from all deposits
at the time of withdrawal. E.g. if when you withdraw, the bonus pool is 2 Token, 
total deposits are 10 Token, and your deposit is 1 Token - you get 
0.2 Token ( = 2 * (1 / 10)) as bonus.
- Bonus pool is collected from penalties paid by early withdrawals 
(withdrawals before the commitment period).
- Withdrawal before commitment period does not get any bonus. 
Instead, it is "slashed" with a penalty (that is added to the bonus pool).  
- The penalty percent is decreasing linearly with time from 
"initialPenaltyPercent" to 0 (for the duration of the commitPeriod). 
E.g. if initialPenaltyPercent was 10%, and you withdraw after half the 
commitment period, you get 5% penalty and withdraw 95% of the initial deposit.
- Any additional deposits are added to current deposit, and "reset" the
  commitment period required to wait.`

  return <MarkdownModalButton
    markdown={markdown}
    title={<div><InfoCircleTwoTone /> Rules</div>}
  />
}

function MotivationButton() {
  const markdown = `
### 💡 The idea: "Strong 💎 hands" get a bonus from "weak 🧁 hands"'s penalties for early withdrawals.

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

  return <MarkdownModalButton
    markdown={markdown}
    title={<div><QuestionCircleTwoTone /> Motivation </div>}
  />
}

function MarkdownModalButton({ title, markdown }) {
  const [drawerVisible, setDrawerVisible] = useState(false);

  return (
    <div>
      <Button
        onClick={() => setDrawerVisible(true)}
        size="large"
        style={{ fontSize: 16 }}
      >{title}</Button>

      <Modal
        onOk={() => setDrawerVisible(false)}
        onCancel={() => setDrawerVisible(false)}
        centered
        cancelText="Yep"
        okText="OK"
        visible={drawerVisible}>
        <Typography style={{ textAlign: "left" }}>
          <ReactMarkdown children={markdown} />
        </Typography>
      </Modal>
    </div>
  );
}
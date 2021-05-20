/* eslint-disable jsx-a11y/accessible-emoji */

import React, { useState, useEffect } from "react";
import { Button, List, Divider, Input, Card, Row, Col, Modal, Typography, Drawer, Space, InputNumber, notification, Select, Descriptions, Tooltip, Steps } from "antd";
import { Address, Balance } from "../components";
import { parseEther, formatEther, parseUnits, formatUnits } from "@ethersproject/units";
import { ethers } from "ethers";
import { useContractExistsAtAddress, useContractReader, useEventListener, useExternalContractLoader, useOnBlock, usePoller, useTokenList } from "../hooks";
import ReactMarkdown from "react-markdown";
import { InfoCircleTwoTone, QuestionCircleTwoTone, WarningTwoTone, LoadingOutlined, QuestionOutlined } from "@ant-design/icons";

class HodlPoolV1StateHooks {

  constructor(contract, address, tokenAddress) {
    tokenAddress = tokenAddress || ethers.constants.AddressZero;
    this.address = contract && contract.address;
    this.tokenAddress = tokenAddress;
    this.WETHAddress = useContractReader(contract, "WETH");
    this.balance = useContractReader(contract, "balanceOf", [tokenAddress, address]);
    this.bonus = useContractReader(contract, "bonusOf", [tokenAddress, address]);
    this.penalty = useContractReader(contract, "penaltyOf", [tokenAddress, address]);
    this.timeLeft = useContractReader(contract, "timeLeftToHoldOf", [tokenAddress, address]);
    this.bonusesPool = useContractReader(contract, "bonusesPool", [tokenAddress]);
    this.depositsSum = useContractReader(contract, "depositsSum", [tokenAddress]);
    this.commitPeriod = useContractReader(contract, "commitPeriod");
    this.initialPenaltyPercent = useContractReader(contract, "initialPenaltyPercent");

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
    address: undefined,
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
        if (tokenState.address && tokenState.address != contract.address) {
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
        setTokenState(emptyState);
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
    } else {
      setContract({ address: address });
    }
  }
  useEffect(() => {
    readContract();
  }, [address, abi, provider]);

  return contract;
}

export function HodlPoolV1UI(
  { address, provider, blockExplorer, tx, readContracts, writeContracts, contractName }) {

  // contract is there
  const contract = readContracts && readContracts[contractName];
  const contractAddress = contract ? contract.address : "";
  const contractIsDeployed = useContractExistsAtAddress(provider, contractAddress);

  // token choice state
  const [tokenChoice, setTokenChoice] = useState("");
  const [ethMode, ethModeSet] = useState(false);
  const [tokenAddress, setTokenAddress] = useState();

  // contract state hooks
  const tokenContract = useContractAtAddress(tokenAddress, erc20Abi, provider);
  const contractState = new HodlPoolV1StateHooks(contract, address, tokenAddress);
  const tokenState = useTokenState(tokenContract, address, contractAddress);

  // switch token address and eth-mode depending on token choice
  useEffect(() => {
    setTokenAddress(tokenChoice == "ETH" ? contractState.WETHAddress : tokenChoice);
    ethModeSet(tokenChoice == "ETH");
  }, [tokenChoice, contractState.WETHAddress])

  // transaction wrappers
  const contractTx = (method, ...args) =>
    tx(writeContracts[contractName][method](...args));
  const tokenTx = (method, ...args) =>
    tx(tokenContract.connect(provider.getSigner())[method](...args));

  return (
    <div>
      <Card
        style={{ border: "1px solid #cccccc", padding: 16, width: 600, margin: "auto", marginTop: 64 }}
        title={
          <div>
            <h2>{contractName}</h2>
          </div>
        }
        size="large"
        loading={!contractIsDeployed}
      >
        <Divider dashed>Token Choice</Divider>

        <Space direction="vertical">
          <TokenSelection provider={provider} addessUpdateFn={setTokenChoice} />

          <TokenBalance
            tokenState={tokenState}
            blockExplorer={blockExplorer}
            ethMode={ethMode}
            address={address}
            provider={provider}
          />
        </Space>

        {!tokenState.address ? "" :
          <div>
            <Divider dashed>Deposit</Divider>

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

            <Divider dashed>Withdraw</Divider>

            <WithdrawElement
              contractState={contractState}
              contractTx={contractTx}
              tokenState={tokenState}
              ethMode={ethMode}
            />

            <Divider dashed>Pool info</Divider>

            <PoolInfo
              contractState={contractState}
              blockExplorer={blockExplorer}
              contractAddress={contractAddress}
              symbol={ethMode ? "ETH" : tokenState.symbol}
            />
          </div>
        }

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
  const activeChainId = provider && provider.network.chainId;
  const tokenListURI = activeChainId == 31337 ?
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
      logoURI = token.logoURI;
    } else if (token.symbol == "ETH" || token.symbol == "WETH") {
      logoURI = (
        "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains" +
        "/ethereum/assets/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/logo.png");
    } else {
      return <QuestionOutlined style={{ width: '30px' }} />
    }
    return <img src={logoURI} width='30px' />
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
    <Select
      showSearch
      value={selectedValue}
      placeholder="Pick token or paste address"
      onChange={(val) => {
        addessUpdateFn(val);
        selectedValueSet(val);
      }}
      optionFilterProp="children"
      size="large"
      dropdownMatchSelectWidth={false}
      style={{ minWidth: "10rem", textAlign: "center" }}
      onSearch={rawInputSet}
      notFoundContent={importTokenButton}
    >
      {[{}, ...extraTokens, ...externalTokensList].map((token, i) =>
        <Select.Option key={i} value={token.address}>
          {token.symbol && tokenLogo(token)} {token.symbol}
        </Select.Option>
      )}
    </Select>);
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
          <Button
            onClick={() => {
              approvingSet(true);
              if (amountToSend && amountToSend > 0 && tokenState.decimals) {
                tokenTx(
                  "approve",
                  contractState.address,
                  parseUnits(amountToSend, tokenState.decimals));
              }
              setTimeout(() => approvingSet(false), 1000);
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
              contractTx(
                "deposit",
                tokenState.address,
                parseUnits(amountToSend, tokenState.decimals));
            }
            setTimeout(() => deposittingSet(false), 1000);
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
            disabled={!depositButtonEnabled}
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
              contractTx("depositETH", { value: parseEther(amountToSend) });
            }
            setTimeout(() => deposittingSet(false), 1000);
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
        <h2>Time left to hold: {contractState.timeLeftString}</h2>

        <h2>Current penalty:
            <Balance balance={contractState.penalty} symbol={symbol} size="20" />
        </h2>

        <h2>Current bonus:
            <Balance balance={contractState.bonus} symbol={symbol} size="20" />
        </h2>

        <h2>Available to withdraw:
            <Balance
            balance={"" + (contractState.withdrawWithBonus || contractState.withdrawWithPenalty)}
            symbol={symbol}
            size="20" />
        </h2>

        {contractState.withdrawWithBonus > 0 ?
          <WithdrawWithBonusButton
            contractState={contractState}
            txFn={contractTx}
            tokenState={tokenState}
            ethMode={ethMode}
          />
          : ""}

        {contractState.withdrawWithPenalty > 0 ?
          <WithdrawWithPenaltyButton
            contractState={contractState}
            txFn={contractTx}
            tokenState={tokenState}
            ethMode={ethMode}
          />
          : ""}

      </div>
    );
  }

  return (
    <div>
      <h2>Current deposit:
        <Balance balance={contractState.balance} symbol={symbol} size="20" />
      </h2>
      { depositInfo }
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
            txFn("withdrawWithPenalty", tokenState.address);
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
      > Withdraw{contractState.bonus ? " with bonus 🤑" : ""}
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
            txFn("withdrawWithBonus", tokenState.address);
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
      <h2>Total deposits in {symbol} pool:
          <Balance balance={contractState.depositsSum} symbol={symbol} size="20" />
      </h2>

      <h2>Total bonus in {symbol} pool:
          <Balance balance={contractState.bonusesPool} symbol={symbol} size="20" />
      </h2>

      <h2>Commitment period: {contractState.commitString}</h2>

      <h2>Initial penalty percent:&nbsp;
          {(contractState.initialPenaltyPercent || "").toString()}%
      </h2>

      <h2>Contract address:&nbsp;
          <Address address={contractAddress} blockExplorer={blockExplorer} fontSize="20" />
      </h2>
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
          if (item.eventName == "Deposited") {
            eventText = (
              `deposited ${item.amount.toString()} ` +
              `at ${item.time.toString()}`);
          } else if (item.eventName == "Withdrawed") {
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

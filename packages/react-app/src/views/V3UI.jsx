/* eslint-disable jsx-a11y/accessible-emoji */

import React, { useState, useEffect } from "react";
import { Button, List, Divider, Input, Card, Row, Col, Modal, 
  Space, notification, Select, Steps, Result, Tooltip, 
  Empty, InputNumber, Collapse } from "antd";
import { Address, Balance } from "../components";
import { parseEther, parseUnits, formatUnits } from "@ethersproject/units";
import { ethers } from "ethers";
import { useContractExistsAtAddress, useContractReader, useEventListener, useTokenList } from "../hooks";
import { InfoCircleTwoTone, WarningTwoTone, 
  LoadingOutlined, QuestionOutlined, DollarTwoTone } from "@ant-design/icons";
import { MotivationButton, MechanismButton, IncentivesButton, PenaltyTooltip, 
  CommitTimeTooltip, DepositModalContent } from "./V3ContentComponents";

class HodlPoolV3StateHooks {

  constructor(contract, address, tokenAddress) {
    this.contract = contract;
    this.address = contract?.address;
    this.tokenAddress = tokenAddress;
    this.WETHAddress = useContractReader(contract, "WETH", [], 86400 * 1000);
    this.minInitialPenaltyPercent = useContractReader(
      contract, "minInitialPenaltyPercent", [], 86400 * 1000);
    this.minCommitPeriod = useContractReader(
        contract, "minCommitPeriod", [], 86400 * 1000);
    
    // all deposits view
    this.depositsOfOwner = useContractReader(
      address && contract, "depositsOfOwner", [address]);
    this.allTokenIds = this.depositsOfOwner?.tokenIds;
    this.depositParams = this.depositsOfOwner?.accountDeposits;
    
    // filter only chosen asset
    this.poolTokenIds = this.allTokenIds && this.allTokenIds.filter(
      (id, ind) => this.depositParams[ind]?.asset == tokenAddress);
    
    // pool details view
    this.poolDetails = useContractReader(
      tokenAddress && contract, "poolDetails", [tokenAddress]);
    this.depositsSum = this.poolDetails && this.poolDetails[0]; 
    this.holdBonusesSum = this.poolDetails && this.poolDetails[1]; 
    this.commitBonusesSum = this.poolDetails && this.poolDetails[2]; 
    this.totalHoldPoints = this.poolDetails && this.poolDetails[3]; 
    this.totalCommitPoints = this.poolDetails && this.poolDetails[4]; 
    this.bonusesPool = this.holdBonusesSum?.add(this.commitBonusesSum);
  }

  getDepositDetails(tokenId) {
    const depositDetails = useContractReader(
      tokenId && this.contract, "depositDetails", [tokenId]);
    
    // basic details
    const details = {
      depositDetails: depositDetails,
      tokenId: tokenId,
      balance: depositDetails && depositDetails[2],
      timeLeft: depositDetails && depositDetails[3], 
      penalty: depositDetails && depositDetails[4], 
      holdBonus: depositDetails && depositDetails[5], 
      commitBonus: depositDetails && depositDetails[6], 
      holdPoints: depositDetails && depositDetails[7], 
      commitPoints: depositDetails && depositDetails[8], 
      initialPenaltyPercent: depositDetails && depositDetails[9], 
      currentPenaltyPercent: depositDetails && depositDetails[10], 
      commitPeriod: depositDetails && depositDetails[11],
    }

    // add derived data
    details.bonus = details.holdBonus?.add(details.commitBonus)

    // time convenience variables
    details.commitString = this.secondsToCommitTimeString(details.commitPeriod);
    details.timeLeftString = this.secondsToCommitTimeString(details.timeLeft);
    // withdrawal convenience variables
    details.withdrawWithPenalty = details.balance && details.penalty?.gt(0) ?
      parseFloat(details.balance.sub(details.penalty).toString()) : 0;
    details.withdrawWithBonus = details.bonus && details.balance && details.penalty?.eq(0) ?
      parseFloat(details.balance.add(details.bonus).toString()) : 0;
    return details;
  }

  pointsToTokenDays(val, decimals) {
    return val && decimals && parseFloat(formatUnits(val.div(86400), decimals));
  }

  bigNumberSecondsToDays(sec, precision = 2) {
    return (parseFloat((sec || "0").toString()) / 86400).toPrecision(precision)
  }
  
  secondsToCommitTimeString(sec) {
    return `${(sec || "").toString()}s or ${this.bigNumberSecondsToDays(sec)} days`;
  }
}


class TokenStateHooks {

  constructor(contract, userAddress, spenderAddress, setLoading, setError) {
    const [prevAddress, setPrevAddress] = useState()
    const [failed, setFailed] = useState(false);

    this.tokenContract = contract;
    this.address = contract?.address;

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

export function HodlPoolV3UI(
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

  // commitment params
  const [penalty, penaltySet] = useState();
  const [period, periodSet] = useState();

  // contract state hooks
  const tokenContract = useERC20ContractAtAddress(tokenAddress, provider);
  const tokenState = new TokenStateHooks(
    tokenContract, address, contractAddress, setLoading, setError);
  const contractState = new HodlPoolV3StateHooks(contract, address, tokenAddress);

  useEffect(() => {
    // set defaults when available
    penaltySet(contractState?.minInitialPenaltyPercent?.toNumber());
    periodSet(contractState?.minCommitPeriod?.toNumber());
  }, [contractState?.minInitialPenaltyPercent, contractState?.minCommitPeriod])

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
      <Card
        style={{ 
          border: "1px solid #cccccc", padding: 16, width: 600, 
          margin: "auto", marginTop: 64, borderRadius: "20px" }}
        title={
          <div>
            <h1>HODL pool V3</h1>
            <h4>Deposit ERC20 tokens or ETH and don't withdraw early 💎✊</h4>
            <h4>Get bonus if other people withdraw early 🤑</h4>
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
              href={`${blockExplorer || "https://etherscan.io/"}${"address/"}${contractAddress}`}
              rel="noopener noreferrer"
              >Contract
            </a>
        </Space>

        <Divider dashed> <h3>👇 Pick or paste token 👇</h3></Divider>

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
              <DepositElementToken
                contractState={contractState}
                contractTx={contractTx}
                tokenTx={tokenTx}
                tokenState={tokenState}
                penalty={penalty}
                period={period}
              />
            }
            
            <Divider dashed>{symbol} Pool info</Divider>

            <PoolInfo
              contractState={contractState}
              symbol={symbol}
              tokenState={tokenState}
            />
          </div>
        }
      </Card>

      {loading || !tokenState.address ? "" : 
      <WithdrawList
        contractState={contractState}
        contractTx={contractTx}
        tokenState={tokenState}
        ethMode={ethMode}
      />}

      <EventsList contractState={contractState} contract={contract} address={address} />

    </div>
  );
}

function TokenBalance({ tokenState, blockExplorer, ethMode, address, provider }) {
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

function TokenSelection({ provider, addessUpdateFn }) {

  // external token list
  const activeChainId = provider?.network?.chainId;
  const tokenListURI = activeChainId === 31337 ?
    "local" : "https://gateway.ipfs.io/ipns/tokens.uniswap.org";
  const externalTokensList = useTokenList(tokenListURI, activeChainId);
  
  // track the input state
  const [rawInput, rawInputSet] = useState("");
  const [selectedValue, selectedValueSet] = useState("");

  // select initial value
  useEffect(() => {
    const defaultChoice = "";
    addessUpdateFn(defaultChoice);
    selectedValueSet(defaultChoice);
  }, []);

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
      shape="round"
      style={{ width: "100%", textAlign: "center" }}
    >
      Import token {shortenString(rawInput)} ?
    </Button>
  )

  const style = { minWidth: "14rem", textAlign: "center", borderRadius: "20px"};
  return (
    <Tooltip 
      title="Paste address to add a token to the list" 
      placement="left" 
      autoAdjustOverflow="false"
      color="blue">
      <div style={{borderRadius: "20px", border: "2px solid #cccccc"}}>
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
          style={style}
          bordered={false}
          dropdownStyle={style}
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
      </div>
    </Tooltip>
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

function DepositElementToken({ contractState, contractTx, tokenState, tokenTx, penalty, period }) {
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

function WithdrawList({contractState, tokenState, contractTx, ethMode }) {
  const symbol = ethMode ? "ETH" : tokenState.symbol;
  const tokenIds = contractState?.poolTokenIds;
  
  return (
    <Card
      style={{ border: "1px solid #cccccc", padding: 16, width: 600, margin: "auto", marginTop: 64, borderRadius: "20px"}}
      title={`Withdraw from ${symbol} pool`}
      size="small"
    >
      <Collapse 
        destroyInactivePanel={true} 
        defaultActiveKey={tokenIds?.length > 0 ? tokenIds[0].toNumber() : ""}
        bordered={false}
        style={{ borderRadius: "20px"}}
      >
        {tokenIds?.map(
          (tokenId) => 
            <Collapse.Panel
              header={<DepositHeader
                contractState={contractState}
                tokenState={tokenState}
                ethMode={ethMode}
                tokenId={tokenId}
              />}
              style={{ border: "1px solid #cccccc", borderRadius: "20px", marginBottom: "10px"}}
              key={tokenId.toNumber()}
            >
              <DepositInfo
                contractState={contractState}
                contractTx={contractTx}
                tokenState={tokenState}
                ethMode={ethMode}
                tokenId={tokenId}
              />
            </Collapse.Panel>
        )}
      </Collapse>
    </Card>
  )
}

function DepositHeader({ contractState, tokenState, ethMode, tokenId }) {
  const symbol = ethMode ? "ETH" : tokenState.symbol;
  const deposit = contractState.getDepositDetails(tokenId);
  const withText = deposit?.penalty?.gt(0) ? "with penalty ⛔" : 
      ( deposit?.bonus?.gt(0) ? "with bonus 🤑" : "✅" )

  return <Space size="small" direction="horizontal">
    <h3>#<b>{deposit.tokenId.toNumber()}</b>:
      Can withdraw<Balance
        balance={"" + (deposit.withdrawWithBonus || deposit.withdrawWithPenalty)}
        symbol={symbol}
        size="20"
      />{withText}
    </h3>
    </Space>
}

function DepositInfo({ contractState, tokenState, ethMode, contractTx, tokenId }) {
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

  return <div>

    <h3>Initial deposit:
      <Balance
        balance={deposit.balance}
        symbol={symbol}
        size="20" />
    </h3>

    <h3>Can withdraw:
      <Balance
        balance={"" + (deposit.withdrawWithBonus || deposit.withdrawWithPenalty)}
        symbol={symbol}
        size="20" />
    </h3>

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
      <Space size="large" direction="horizontal">
        <div>All deposits:<Balance balance={contractState.depositsSum} symbol={symbol} size="20" /></div>
        <div>Bonuses pool:<Balance balance={contractState.bonusesPool} symbol={symbol} size="20" />
          {bonusTotalsTooltip()}</div>
      </Space>
  );
}

function EventsList({ contractState, contract, address }) {
  const depositedEvents = useEventListener(
    contract, "Deposited", contract?.provider, 0, [null, address]);
  const withdrawedEvents = useEventListener(
    contract, "Withdrawed", contract?.provider, 0, [null, address]);
  // TODO: add transfers
  const allEvents = depositedEvents.concat(withdrawedEvents)
    .sort((a, b) => b.blockNumber - a.blockNumber);

  return (
      <List
        style={{ width: 600, margin: "auto", marginTop: 32, paddingBottom: 32, borderRadius: "20px"}}
        bordered
        dataSource={allEvents}
        header="Your past contract events"
        renderItem={(item) => {
          let eventText = "";
          if (item.eventName === "Deposited") {
            eventText = (
              `deposited ${item.amount.toString()} ` + 
              `(received ${item.amountReceived.toString()}) ` +
              `at ${item.time.toString()} ` + 
              `committed to ${contractState.bigNumberSecondsToDays(item.commitPeriod)} days at ` + 
              `${item.initialPenaltyPercent.toString()}% initial penalty`
            );
          } else if (item.eventName === "Withdrawed") {
            eventText = (
              `withdrew ${item.amount.toString()} ` +
              `for initial deposit of ${item.depositAmount.toString()} ` +
              `(held for ${contractState.bigNumberSecondsToDays(item.timeHeld)} days)`
            );
            eventText += (item.penalty > 0) ? ` with ${item.penalty} penalty` : ''
            eventText += (item.bonus > 0) ? ` with ${item.bonus} bonus` : ''
          }
          return (
            <List.Item key={item.blockNumber + item.eventName + item.account}>
              block {item.blockNumber}:
              user <Address address={item.account} fontSize={16} />&nbsp;
              {eventText}. Token <Address address={item.asset} fontSize={16} />.
            </List.Item>
          )
        }}
      />);
}


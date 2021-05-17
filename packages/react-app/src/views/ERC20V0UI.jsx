/* eslint-disable jsx-a11y/accessible-emoji */

import React, { useState, useEffect } from "react";
import { Button, List, Divider, Input, Card, Row, Col, Modal, Typography, Drawer, Space, InputNumber, notification, Select, Descriptions, Tooltip, Steps } from "antd";
import { Address, Balance } from "../components";
import { parseEther, formatEther, parseUnits, formatUnits } from "@ethersproject/units";
import { ethers } from "ethers";
import { useContractExistsAtAddress, useContractReader, useEventListener, useExternalContractLoader, useOnBlock } from "../hooks";
import ReactMarkdown from "react-markdown";
import { InfoCircleTwoTone, QuestionCircleTwoTone, WarningTwoTone, SettingOutlined, RetweetOutlined, LoadingOutlined } from "@ant-design/icons";

// swap imports
import { ChainId, Token, WETH, Fetcher, Trade, TokenAmount, Percent } from '@uniswap/sdk'
import { usePoller } from "eth-hooks";

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

  const updateFn = () => {
    const updateState = async () => {
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
        }
      }
    }
    updateState();
  }

  useEffect(updateFn, [contract, userAddress, spenderAddress]);
  usePoller(updateFn, 2000);

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
  const contractAddress = readContracts && readContracts[contractName] ?
    readContracts[contractName].address : "";
  const contractIsDeployed = useContractExistsAtAddress(provider, contractAddress);

  // contract state hooks
  const contractState = new HodlPoolERC20V0StateHooks(readContracts && readContracts[contractName], address);

  // events
  const depositedEvents = useEventListener(readContracts, contractName, "Deposited", provider, 1, [address]);
  const withdrawedEvents = useEventListener(readContracts, contractName, "Withdrawed", provider, 1, [address]);
  const allEvents = depositedEvents.concat(withdrawedEvents)
    .sort((a, b) => b.blockNumber - a.blockNumber);

  
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
          </div>
        }
        size="large"
        loading={!contractIsDeployed}
      >
        {/* <Divider dashed>Swap</Divider>

        <Swap
          selectedProvider={provider}
          contract={readContracts && readContracts[contractName]}
          tokenState={tokenState}
          address={address}
        /> */}
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

      <EventsList eventsArray={allEvents} />

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

      <Input
        defaultValue={tokenState.address}
        prefix="Switch token: "
        onPressEnter={e => addessUpdateFn(e.target.value)}>
      </Input>

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

function EventsList({ eventsArray }) {
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
            eventText = `deposited ${item.amount.toString()} at ${item.time.toString()}`;
          } else if (item.eventName == "Withdrawed") {
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


const makeCall = async (callName, contract, args, metadata = {}) => {
  if (contract[callName]) {
    let result
    if (args) {
      result = await contract[callName](...args, metadata)
    } else {
      result = await contract[callName]()
    }
    return result
  } else {
    console.log('no call of that name!')
  }
}



const tokenListToObject = (array) =>
  array.reduce((obj, item) => {
    obj[item.symbol] = new Token(item.chainId, item.address, item.decimals, item.symbol, item.name)
    return obj
  }, {})

function Swap({ address, selectedProvider, contract, tokenState }) {

  const [tokenIn, setTokenIn] = useState()
  const [amountIn, setAmountIn] = useState()
  const [routerAllowance, setRouterAllowance] = useState()
  const [balanceIn, setBalanceIn] = useState()

  const [tokenList, setTokenList] = useState([])
  const [tokens, setTokens] = useState()

  let signer = selectedProvider.getSigner()
  let routerContract = contract.connect(signer);

  let _tokenListUri = 'https://gateway.ipfs.io/ipns/tokens.uniswap.org'

  const activeChainId = (process.env.REACT_APP_NETWORK === 'kovan' ? ChainId.KOVAN : ChainId.MAINNET)

  useEffect(() => {
    const getTokenList = async () => {
      console.log(_tokenListUri)
      try {
        let tokenList = await fetch(_tokenListUri)
        let tokenListJson = await tokenList.json()
        let filteredTokens = tokenListJson.tokens.filter(function (t) {
          return t.chainId === activeChainId
        })

        let someToken = {
          name: tokenState.name,
          symbol: tokenState.symbol,
          address: tokenState.address,
          chainId: activeChainId,
          decimals: tokenState.decimals,
        }

        let ethToken = WETH[activeChainId]
        ethToken.name = 'Ethereum'
        ethToken.symbol = 'ETH'
        let _tokenList = [someToken, ethToken, ...filteredTokens]
        setTokenList(_tokenList)
        let _tokens = tokenListToObject(_tokenList)
        setTokens(_tokens)
      } catch (e) {
        console.log(e)
      }
    }
    getTokenList()
  }, [tokenState.address, tokenState.name, tokenState.symbol, tokenState.decimals])

  const getBalance = async (_token, _account, _contract) => {

    let newBalance
    if (_token === 'ETH') {
      newBalance = await selectedProvider.getBalance(_account)
    } else {
      newBalance = await makeCall('balanceOf', _contract, [_account])
    }
    return newBalance
  }

  const getAccountInfo = async () => {

    if (tokens) {

      if (tokenIn) {
        let tempContractIn = new ethers.Contract(tokens[tokenIn].address, erc20Abi, selectedProvider);
        let newBalanceIn = await getBalance(tokenIn, address, tempContractIn)
        setBalanceIn(newBalanceIn)

        let allowance

        if (tokenIn === 'ETH') {
          setRouterAllowance()
        } else {
          allowance = await makeCall('allowance', tempContractIn, [address, contract.address])
          setRouterAllowance(allowance)
        }
      }
    }
  }

  usePoller(getAccountInfo, 2000)

  const updateRouterAllowance = async (newAllowance) => {
    try {
      let tempContract = new ethers.Contract(tokens[tokenIn].address, erc20Abi, signer);
      console.log(signer)
      let result = await makeCall('approve', tempContract, [contract.address, newAllowance])
      console.log(result)
      return true
    } catch (e) {
      notification.open({
        message: 'Approval unsuccessful',
        description:
          `Error: ${e.message}`,
      });
    }
  }

  const approveRouter = async () => {
    let approvalAmount = ethers.utils.hexlify(parseUnits(amountIn.toString(), tokens[tokenIn].decimals));
    console.log(approvalAmount)
    let approval = updateRouterAllowance(approvalAmount)
    if (approval) {
      notification.open({
        message: 'Token transfer approved',
        description:
          `You can now swap up to ${amountIn} ${tokenIn}`,
      });
    }
  }

  const executeSwap = async () => {
    let args
    let metadata = {}
    let call

    let _amountIn = ethers.utils.hexlify(parseUnits(amountIn.toString(), tokens[tokenIn].decimals))
    if (tokenIn === 'ETH') {
      call = 'depositETH';
      args = []
      metadata['value'] = _amountIn
    } else {
      call = 'deposit';
      args = [_amountIn]
    }
    console.log(call, args, metadata)
    let result = await makeCall(call, routerContract, args, metadata)
  }

  let insufficientBalance = balanceIn ? parseFloat(formatUnits(balanceIn, tokens[tokenIn].decimals)) < amountIn : null
  let inputIsToken = tokenIn !== 'ETH'
  let insufficientAllowance = !inputIsToken ? false : routerAllowance ?
    parseFloat(formatUnits(routerAllowance, tokens[tokenIn].decimals)) < amountIn : null
  let formattedBalanceIn = balanceIn ? parseFloat(formatUnits(balanceIn, tokens[tokenIn].decimals)).toPrecision(6) : null

  let metaIn = tokens && tokenList && tokenIn ? tokenList.filter(function (t) {
    return t.address === tokens[tokenIn].address
  })[0] : null

  const cleanIpfsURI = (uri) => {
    try {
      return uri ? (uri).replace('ipfs://', 'https://ipfs.io/ipfs/') : uri
    } catch (e) {
      console.log(e, uri)
      return uri
    }
  }

  let logoIn = metaIn ? cleanIpfsURI(metaIn.logoURI) : null

  return (
    <div>
      <Space direction="vertical">
        <Row justify="center" align="middle">
          <Card
            size="small" type="inner"
            title={`Deposit ${tokenState.symbol} token`}
            extra={
              <><img src={logoIn} alt={tokenIn} width='30' />
                <Button type="link" onClick={() => {
                  setAmountIn(formatUnits(balanceIn, tokens[tokenIn].decimals))
                }}>{formattedBalanceIn}
                </Button></>}
            style={{ width: 400, textAlign: 'left' }}>
            <InputNumber style={{ width: '160px' }} min={0} size={'large'} value={amountIn} onChange={(e) => {
              setAmountIn(e)
            }} />
            <Select
              showSearch value={tokenIn} style={{ width: '120px' }} size={'large'}
              bordered={true}
              value={tokenState.symbol}
              onChange={(value) => {
                console.log(value)
                setTokenIn(value)
                setAmountIn()
                setBalanceIn()
              }}
              filterOption={(input, option) =>
                option.children.toLowerCase().indexOf(input.toLowerCase()) >= 0
              }
              optionFilterProp="children">
              {tokenList.map(token => (
                <Select.Option key={token.symbol} value={token.symbol}>{token.symbol}</Select.Option>
              ))}
            </Select>
          </Card>
        </Row>

        <Row justify="center" align="middle">
          <Space>
            {inputIsToken ?
              <Button size="large" disabled={!insufficientAllowance}
                onClick={approveRouter}>
                {(!insufficientAllowance && amountIn) ? 'Approved' : 'Approve'}
              </Button>
              : null}
            <Button size="large" disabled={insufficientAllowance || insufficientBalance || !amountIn}
              onClick={executeSwap}>
              {insufficientBalance ? 'Insufficient balance' : 'Swap!'}
            </Button>
          </Space>
        </Row>
      </Space>
    </div>
  )

}
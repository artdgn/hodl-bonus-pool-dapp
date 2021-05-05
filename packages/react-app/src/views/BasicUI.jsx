/* eslint-disable jsx-a11y/accessible-emoji */

import React, { useState } from "react";
import { Button, List, Divider, Input, Card, DatePicker, Slider, Switch, Progress, Spin, Row, Col, Modal } from "antd";
import { Address, Balance } from "../components";
import { parseEther, formatEther } from "@ethersproject/units";
import { useContractReader } from "../hooks";
import { BigNumber } from "@ethersproject/bignumber";

export default function BasicUI(
  {address, localProvider, price, tx, readContracts, writeContracts, contractName}) {

  const [depositModalVisible, setDepositModalVisible] = useState(false);
  const [depositButtonEnabled, setDepositButtonEnabled] = useState(false);
  const [amountToSend, setAmountToSend] = useState(0);

  const contractState = {
    balance: useContractReader(readContracts, contractName, "balanceOf", [address]),
    bonus: useContractReader(readContracts, contractName, "bonusOf", [address]),
    penalty: useContractReader(readContracts, contractName, "penaltyOf", [address]),
    timeLeft: useContractReader(readContracts, contractName, "timeLeftToHoldOf", [address]),
    bonusesPool: useContractReader(readContracts, contractName, "bonusesPool", null, 10000),
    depositsSum: useContractReader(readContracts, contractName, "depositsSum", null, 10000),
    commitPeriod: useContractReader(readContracts, contractName, "commitPeriod", null, 60000),
    maxPenaltyPercent: useContractReader(readContracts, contractName, "maxPenaltyPercent", null, 60000),
    }
  contractState.commitDays = parseFloat((contractState.commitPeriod || "0").toString()) / 86400;
  contractState.commitString = `${(contractState.commitPeriod || "").toString()} seconds 
                                (${(contractState.commitDays).toPrecision(2)} days)`;
  contractState.timeLeftString = `${(contractState.timeLeft || "").toString()} seconds (out of 
                                  ${(contractState.commitPeriod || "").toString()} seconds)`;

  contractState.withdrawWithPenalty = 
    contractState.balance && contractState.penalty && contractState.penalty.gt(0) ? 
    parseFloat(contractState.balance.sub(contractState.penalty).toString()): 0;
  contractState.withdrawWithBonus = contractState.penalty && contractState.penalty.eq(0) ? 
    parseFloat(contractState.balance.add(contractState.bonus).toString()): 0;

  const [penaltyModalVisible, setPenaltyModalVisible] = useState(false);
  const [bonusModalVisible, setBonusModalVisible] = useState(false);

  const depositElement = (
    <div style={{margin:8}}>
      <Row>
        <Col span={16}>
          <Input
            onChange={(e)=>{
              setAmountToSend(e.target.value);
              setDepositButtonEnabled(parseFloat(e.target.value) > 0);
            }} 
            size="large"
            allowClear={true}
            addonBefore="Deposit amount"
            suffix="ETH"
            style={{textAlign: "right"}}
          />
        </Col>
        <Col span={8}>
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
              tx( writeContracts[contractName].deposit({value: parseEther(amountToSend)})
            );
          }}} 
          onCancel={() => setDepositModalVisible(false)}>
          <h2>Commitment period: {contractState.commitString}</h2>
          <Divider/>
          <h2>⚠️ Withdrawing without penalty before that time won't be possible!!</h2>
        </Modal>
      </Row>
    </div>
  );

  const withdrawWithPenaltyButton = (
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
                ${formatEther(""+contractState.withdrawWithPenalty)} ETH with penalty`}
        okText="Withdraw with penalty"
        visible={penaltyModalVisible} 
        onOk={() => {
          setPenaltyModalVisible(false);
          tx(writeContracts[contractName].withdrawWithPenalty());
        }} 
        onCancel={() => setPenaltyModalVisible(false)}>
        <h2>Withdraw {formatEther(""+contractState.withdrawWithPenalty)} ETH out of 
            deposited {(formatEther(contractState.balance || "0").toString())} due 
            to {formatEther((contractState.penalty || "0").toString())} penalty.</h2>
        <h2>⚠️ Wait until end of commitment period (
          {(contractState.timeLeft || "").toString()} seconds) 
          to withdraw full deposit + any bonus!</h2>
      </Modal>
    </div>
  ); 

  const withdrawWithBonusButton = (
    <div>
      <Button 
        onClick={() => setBonusModalVisible(true)}
        type="primary"
        size="large"
        disabled={!(contractState.withdrawWithBonus > 0)}
        > Withdraw{!contractState.bonus ? " with bonus": ""}
      </Button>
      <Modal 
        title={`Confirm withdrawal of ${formatEther(""+contractState.withdrawWithBonus)} ETH`}
        okText="Withdraw"
        visible={bonusModalVisible} 
        onOk={() => {
          setBonusModalVisible(false);
          tx(writeContracts[contractName].withdrawWithBonus());
        }} 
        onCancel={() => setBonusModalVisible(false)}>
        <h2>Withdraw {formatEther(""+contractState.withdrawWithBonus)} ETH out of 
            deposited {formatEther(""+(contractState.balance || "0"))} ETH 
            {!contractState.bonus ? 
            ` with ${formatEther(""+(contractState.bonus || "0"))} ETH bonus` : ""}
        .</h2>
        <h2>⚠️ Waiting for longer may increase available bonus</h2>
      </Modal>
    </div>
  ); 

  return (
    <div>
      <div style={{border:"1px solid #cccccc", padding:16, width:600, margin:"auto",marginTop:64}}>
        <h2>Basic UI:</h2>

        <Divider dashed>Deposit</Divider>

        {depositElement}

        <Divider dashed>Withdraw</Divider>

        <h2>Your deposit: 
            <Balance balance={contractState.balance} price={price} /> 
        </h2>

        { (contractState.balance && contractState.balance.gt(0)) ? (
          <div>
            <h2>Time left to hold: {contractState.timeLeftString}</h2>
          
            <h2>Your current penalty: 
                <Balance balance={contractState.penalty} price={price} /> 
            </h2>
    
            <h2>Your current bonus: 
                <Balance balance={contractState.bonus} price={price} /> 
            </h2>
    
            <h2>Available to withdraw: 
                <Balance 
                  balance={"" + (contractState.withdrawWithBonus || contractState.withdrawWithPenalty)} 
                  price={price} /> 
            </h2>
            
            {contractState.withdrawWithBonus > 0 ? withdrawWithBonusButton : ""}

            {contractState.withdrawWithPenalty > 0 ? withdrawWithPenaltyButton : ""}

          </div> 
        ) : ""}
        
        <Divider dashed>Pool info</Divider>

        <h2>Total deposits in pool:
            <Balance balance={contractState.depositsSum} price={price} /> 
        </h2>
        
        <h2>Total bonus in pool: 
            <Balance balance={contractState.bonusesPool} price={price} /> 
        </h2>

        <h2>Commitment period: {contractState.commitString}</h2>

        <h2>Maximum penalty percent: {(contractState.maxPenaltyPercent || "").toString()}%</h2>

      </div>

    </div>
  );
}

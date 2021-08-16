import React from "react";
import { List, Empty } from "antd";
import { Address } from "../components";
import { ethers } from "ethers";
import { useEventListener } from "../hooks";


export function EventsList({ contractState, contract, address }) {
  const depositedEvents = useEventListener(
    contract, "Deposited", contract?.provider, 0, [null, address]);
  const withdrawedEvents = useEventListener(
    contract, "Withdrawed", contract?.provider, 0, [null, address]);
  const transferFromEvents = useEventListener(
    contract, "Transfer", contract?.provider, 0, [address, null]);
  const transferToEvents = useEventListener(
    contract, "Transfer", contract?.provider, 0, [null, address]);
  const allEvents = depositedEvents
    .concat(withdrawedEvents)
    .concat(transferFromEvents)
    .concat(transferToEvents)
    .sort((a, b) => b.blockNumber - a.blockNumber);

  return (
      <List
        style={{ width: 600, margin: "auto", marginTop: 32, paddingBottom: 32, borderRadius: "20px"}}
        bordered
        dataSource={allEvents}
        header={<h2>Your past contract <b>events</b></h2>}
        renderItem={(item) => {
          let eventText = "";
          if (item.eventName === "Transfer") {
            if (item.from === ethers.constants.AddressZero || item.to === ethers.constants.AddressZero)
              return;
            eventText = (
              <span>
                user {<Address address={item.from} fontSize={16} />} transfered
                to user {<Address address={item.to} fontSize={16} />}
                tokenId #{item.tokenId.toString()}
              </span>
            );
            item.account = address;
          } else if (item.eventName === "Deposited") {
            eventText = (
              `you deposited ${item.amount.toString()} ` + 
              (!item.amount.eq(item.amountReceived) ? `(received ${item.amountReceived.toString()}) ` : '') +
              `committed to ${contractState.bigNumberSecondsToDays(item.commitPeriod)} days at ` + 
              `${item.initialPenaltyPercent.toString()}% initial penalty`
            );
          } else if (item.eventName === "Withdrawed") {
            eventText = (
              `you withdrew ${item.amount.toString()} ` +
              `for initial deposit of ${item.depositAmount.toString()} ` +
              `(held for ${contractState.bigNumberSecondsToDays(item.timeHeld)} days)`
            );
            eventText += (item.penalty > 0) ? ` with ${item.penalty} penalty` : ''
            eventText += (item.bonus > 0) ? ` with ${item.bonus} bonus` : ''
          } 
          return (
            <List.Item key={item.blockNumber + item.eventName + item.account}>
              {item.eventName} at block {item.blockNumber}: {eventText}. 
              {item.asset ? <span>, asset <Address address={item.asset} fontSize={16}/></span> : ""}
              
            </List.Item>
          )
        }}
      > 
      { allEvents?.length > 0 ? "" : 
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="You have no past events"/>
      }
      </List>);
}


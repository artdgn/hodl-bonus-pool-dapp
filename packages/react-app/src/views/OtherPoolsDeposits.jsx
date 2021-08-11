/* eslint-disable jsx-a11y/accessible-emoji */

import React, { useEffect, useState } from "react";
import { Button,  Card,  Space, Collapse, Empty} from "antd";
import { Balance } from "../components";
import { useERC20ContractAtAddress } from "./ContractsStateHooks";


export function OtherPoolsDeposits({ provider, contractState, tokenState, tokenChoice, setTokenChoice }) {

  // filter deposits from the selected asset
  const tokenIds = contractState?.allTokenIds?.filter(
    (tokenId) => contractState?.depositParams[tokenId].asset != tokenState.address);

  return <Card
    title={<h2>Your deposits in <b>{tokenChoice ? "Other" : "All"} Pools</b></h2>}
    size="small"
  >
    {tokenIds?.length > 0 ?
      <Collapse
        destroyInactivePanel={false}
        bordered={false}
        style={{ borderRadius: "20px" }}
      >
        {tokenIds?.map(
          (tokenId) =>
            <Collapse.Panel
              header={<AnyTokenDepositHeader
                contractState={contractState}
                provider={provider}
                erc20Address={contractState?.depositParams[tokenId].asset}
                tokenId={tokenId}
              />}
              style={{ border: "1px solid #cccccc", borderRadius: "20px", marginBottom: "10px" }}
              key={tokenId.toNumber()}
            >
              <Button
                onClick={() => {
                  if (contractState?.depositParams[tokenId].asset === contractState?.WETHAddress) {
                    setTokenChoice('ETH');
                  } else {
                    setTokenChoice(contractState?.depositParams[tokenId].asset);
                  }
                }}
                type="secondary"
                size="large"
              > Switch view to this pool
              </Button>
            </Collapse.Panel>
        )}
      </Collapse> :
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={`You have no deposits in ${tokenChoice ? "other pools" : "any pool"}`} 
      />
    }
  </Card>
}

function AnyTokenDepositHeader({ provider, contractState, erc20Address, tokenId}) {
  
  const tokenContract = useERC20ContractAtAddress(erc20Address, provider);
  
  const [symbol, setSymbol] = useState("");
  
  useEffect(() => {
    // https://stackoverflow.com/questions/53949393/cant-perform-a-react-state-update-on-an-unmounted-component
    let isMounted = true;

    const getSymbol = async () => {
      if (isMounted) {
        if (erc20Address === contractState?.WETHAddress) {
          setSymbol('ETH');
        } else if (tokenContract) {
          setSymbol(await tokenContract.symbol())
        }
      };
    }    
    getSymbol();

    // return () =>  { isMounted = false };
  }, [contractState, tokenContract, erc20Address]);

  const deposit = contractState.getDepositDetails(tokenId);
  const withText = deposit?.penalty?.gt(0) ? "with penalty ⛔" : 
      ( deposit?.bonus?.gt(0) ? "with bonus 🤑" : "✅" )  

  return <Space size="small" direction="horizontal">
    <h3>Deposit #<b>{deposit.tokenId.toNumber()}</b>:
      Can withdraw<Balance
        balance={"" + (deposit.withdrawWithBonus || deposit.withdrawWithPenalty)}
        symbol={symbol}
        size="20"
      />{withText}
    </h3>
    </Space>
}


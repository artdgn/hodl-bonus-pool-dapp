/* eslint-disable jsx-a11y/accessible-emoji */

import React, { useState, useEffect } from "react";
import { Button, Select, Tooltip } from "antd";
import { useTokenList } from "../hooks";
import { QuestionOutlined } from "@ant-design/icons";

/*
  ~ What it does? ~

  A components to select a token from a list, or add it into list with a callback
  that runs with the update address of the chosen token.

  Can import tokens by pasting an address.
*/

export default function TokenSelection({ provider, addessUpdateFn, prependedTokens, tokenListURI, defaultChoice }) {

    // external token list
    const activeChainId = provider?.network?.chainId;
    const defaultTokenListURI = activeChainId === 31337 ?
      "local" : "https://gateway.ipfs.io/ipns/tokens.uniswap.org";
    const externalTokensList = useTokenList(tokenListURI || defaultTokenListURI, activeChainId);
    
    // track the input state
    const [rawInput, rawInputSet] = useState("");
    const [selectedValue, selectedValueSet] = useState("");
  
    // select initial value
    useEffect(() => {
      addessUpdateFn(defaultChoice || "");
      selectedValueSet(defaultChoice || "");
    }, [defaultChoice]);

    // set active chainId for prependeded tokens
    prependedTokens = (prependedTokens || []).map(
        (token) => {return {...token, ...{"chainId": activeChainId}}});
  
    // any additional tokens
    const [extraTokens, extraTokensSet] = useState([])
  
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
        title="Paste address to add a token to the list. Start typing to seach in the list." 
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
            {[{ address: "" }, ...prependedTokens, ...externalTokensList, ...extraTokens].map((token, i) =>
              <Select.Option key={i} value={token.address}>
                {token.symbol && tokenLogo(token)} {token.symbol}
              </Select.Option>
            )}
          </Select>
        </div>
      </Tooltip>
    );
  }
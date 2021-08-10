/* eslint-disable import/no-dynamic-require */
/* eslint-disable global-require */
import { useEffect, useState } from "react";

/*
  ~ What it does? ~

  Gets a tokenlist (see more at https://tokenlists.org/), returning the .tokens only

  ~ How can I use? ~

  const tokenList = useTokenList(); <- default returns the Unsiwap tokens
  const tokenList = useTokenList("https://gateway.ipfs.io/ipns/tokens.uniswap.org");

  ~ Features ~

  - Optional - specify chainId to filter by chainId
*/

const useTokenList = (tokenListUri, chainId) => {
  const [tokenList, setTokenList] = useState([]);

  let _tokenListUri = tokenListUri || "https://gateway.ipfs.io/ipns/tokens.uniswap.org";

  useEffect(() => {
    let isMounted = true;

    const getTokenList = async () => {
      try {
        if (chainId && isMounted) {
          let _tokenList;

          if (_tokenListUri.startsWith("local")) {
            _tokenList = require('../contracts/localTokens.js');
          } else {
            const tokenList = await fetch(_tokenListUri);
            _tokenList = await tokenList.json();
          }

          _tokenList = _tokenList.tokens
            .filter(t => t.chainId === chainId);

          setTokenList(_tokenList);
        }
      } catch (e) {
        console.log(e)
      }
    }
    
    getTokenList();

    return () => { isMounted = false };

  }, [_tokenListUri, chainId]);

  return tokenList;
};

export default useTokenList;

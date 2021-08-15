import React, { useCallback, useEffect, useState } from "react";
import "antd/dist/antd.css";
import { StaticJsonRpcProvider, Web3Provider } from "@ethersproject/providers";
import "./App.css";
import { Button, Menu, Alert, Space, Empty } from "antd";
import Web3Modal from "web3modal";
import WalletConnectProvider from "@walletconnect/web3-provider";
import { useUserAddress } from "eth-hooks";
import { useGasPrice, useUserProvider, useContractLoader } from "./hooks";
// eslint-disable-next-line
import { Header, Account, Faucet, Contract, ThemeSwitch } from "./components";
import { Transactor } from "./helpers";
import { parseEther } from "@ethersproject/units";
import { HodlPoolV3UI } from "./views"
// import {  Subgraph } from "./views"
import { INFURA_ID, NETWORK, NETWORKS, contractName, defaultNetwork } from "./constants";
// eslint-disable-next-line
// import { BrowserRouter, Link, Route, Switch } from "react-router-dom";


/// 📡 What chain are your contracts deployed to?
const targetNetwork = NETWORKS[defaultNetwork];

const DEBUG = true

// 🛰 providers
// const mainnetProvider = getDefaultProvider("mainnet", { infura: INFURA_ID, etherscan: ETHERSCAN_KEY, quorum: 1 });
// const mainnetProvider = new InfuraProvider("mainnet",INFURA_ID);
//
// attempt to connect to our own scaffold eth rpc and if that fails fall back to infura...
// Using StaticJsonRpcProvider as the chainId won't change see https://github.com/ethers-io/ethers.js/issues/901
const scaffoldEthProvider = new StaticJsonRpcProvider("https://rpc.scaffoldeth.io:48544")
const mainnetInfura = new StaticJsonRpcProvider("https://mainnet.infura.io/v3/" + INFURA_ID)
// ( ⚠️ Getting "failed to meet quorum" errors? Check your INFURA_I

// 🏠 Your local provider is usually pointed at your local blockchain
const localProviderUrl = targetNetwork.rpcUrl;
// as you deploy to other networks you can set REACT_APP_PROVIDER=https://dai.poa.network in packages/react-app/.env
const localProviderUrlFromEnv = process.env.REACT_APP_PROVIDER ? process.env.REACT_APP_PROVIDER : localProviderUrl;
if (DEBUG) console.log("🏠 Connecting to provider:", localProviderUrlFromEnv);
const localProvider = new StaticJsonRpcProvider(localProviderUrlFromEnv);


// 🔭 block explorer URL
const blockExplorer = targetNetwork.blockExplorer;


function App(props) {

  const mainnetProvider = (scaffoldEthProvider && scaffoldEthProvider._network) ? scaffoldEthProvider : mainnetInfura

  const [injectedProvider, setInjectedProvider] = useState();

  /* 🔥 This hook will get the price of Gas from ⛽️ EtherGasStation */
  const gasPrice = useGasPrice(targetNetwork, "fast");
  // Use your injected provider from 🦊 Metamask or if you don't have it then instantly generate a 🔥 burner wallet.
  const userProvider = useUserProvider(injectedProvider, (defaultNetwork === 'localhost') && localProvider);
  const address = useUserAddress(userProvider);

  // You can warn the user if you would like them to be on a specific network
  let localChainId = localProvider && localProvider._network && localProvider._network.chainId
  let selectedChainId = userProvider && userProvider._network && userProvider._network.chainId

  // For more hooks, check out 🔗eth-hooks at: https://www.npmjs.com/package/eth-hooks

  // The transactor wraps transactions and provides notificiations
  const tx = Transactor(userProvider, gasPrice)

  // Faucet Tx can be used to send funds from the faucet
  const faucetTx = Transactor(localProvider, gasPrice)

  // Load in your local 📝 contract and read a value from it:
  const readContracts = useContractLoader(localProvider, targetNetwork.contractAddresses);

  // If you want to make 🔐 write transactions to your contracts, use the userProvider:
  const writeContracts = useContractLoader(userProvider, targetNetwork.contractAddresses);

  // // EXTERNAL CONTRACT EXAMPLE:
  // //
  // // If you want to bring in the mainnet DAI contract it would look like:
  // const mainnetDAIContract = useExternalContractLoader(mainnetProvider, DAI_ADDRESS, DAI_ABI)

  // // Then read your DAI balance like:
  // const myMainnetDAIBalance = useContractReader({DAI: mainnetDAIContract},"DAI", "balanceOf",["0x34aA3F359A9D614239015126635CE7732c18fDF3"])

  const wrongNetwork = localChainId && selectedChainId && localChainId !== selectedChainId;
  const networkDisplay = (wrongNetwork ?
    <div style={{ zIndex: 2, position: 'absolute', right: 0, top: 60, padding: 16 }}>
      <Alert
        message={"⚠️ Wrong Network"}
        description={(
          <div>
            You have <b>{NETWORK(selectedChainId).name}</b> selected and you need to be on <b>{NETWORK(localChainId).name}</b>.
          </div>
        )}
        type="error"
        closable={false}
      />
    </div>
    :
    <h4 style={{ zIndex: -1, position: 'absolute', right: 12, top: 40, padding: 16, color: targetNetwork.color }}>
      { targetNetwork.name }
    </h4>
  )

  const loadWeb3Modal = useCallback(async () => {
    const provider = await web3Modal.connect();
    setInjectedProvider(new Web3Provider(provider));
  }, [setInjectedProvider]);

  useEffect(() => {
    if (web3Modal.cachedProvider) {
      loadWeb3Modal();
    }
  }, [loadWeb3Modal]);

  const [route, setRoute] = useState();
  useEffect(() => {
    setRoute(window.location.pathname)
  }, [setRoute]);

  let faucetHint = "";
  const localEnv = localProvider && localProvider.connection && targetNetwork.name === "localhost";

  if (
    localProvider &&
    localProvider._network &&
    localProvider._network.chainId === 31337
  ) {
    faucetHint = (
      <div style={{ padding: 16 }}>
        <Button
          type="primary"
          onClick={() => {
            faucetTx({
              to: address,
              value: parseEther("0.1"),
            });
          }}
        >
          Grab funds from the faucet!
        </Button>
      </div>
    );
  }

  return (
    <div className="App">

      <Header />

      {networkDisplay}

      { !wrongNetwork && !userProvider ? 
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Please connect Web3 wallet"/> : ""}

      { !wrongNetwork && userProvider ?
        // <BrowserRouter>

        //   <Menu style={{ textAlign: "center" }} selectedKeys={[route]} mode="horizontal">
        //     <Menu.Item key="/">
        //       <Link onClick={()=>{setRoute("/")}} to="/">Main UI</Link>
        //     </Menu.Item>
        //     <Menu.Item key="/contract">
        //       <Link onClick={()=>{setRoute("/contract")}} to="/contract">Raw contract UI</Link>
        //     </Menu.Item>
        //     <Menu.Item key="/token">
        //       <Link onClick={()=>{setRoute("/token")}} to="/token">Token</Link>
        //     </Menu.Item>
        //   </Menu>

        //   <Switch>
        //     <Route exact path="/">

              <HodlPoolV3UI
                address={address}
                tx={tx}
                writeContracts={writeContracts}
                readContracts={readContracts}
                contractName={contractName}
                provider={userProvider}
                blockExplorer={blockExplorer}
              />

        //      </Route>

        //      <Route exact path="/contract">
        //        <Contract
        //         name={contractName}
        //         signer={userProvider.getSigner()}
        //         provider={localProvider}
        //         address={address}
        //         blockExplorer={blockExplorer}
        //       />
        //     </Route>

        //     <Route exact path="/token">
        //       <Contract
        //         name={tokenContractName}
        //         signer={userProvider.getSigner()}
        //         provider={localProvider}
        //         address={address}
        //         blockExplorer={blockExplorer}
        //       />
        //     </Route>

        //   </Switch>

        // </BrowserRouter>
      : ""}

      <ThemeSwitch />

      {/* 👨‍💼 Your account is in the top right with a wallet at connect options */}
      <div style={{ position: "fixed", textAlign: "right", right: 0, top: 0, padding: 10 }}>
        <Account
          address={address}
          localProvider={localProvider}
          userProvider={userProvider}
          minimized={injectedProvider}
          mainnetProvider={mainnetProvider}
          web3Modal={web3Modal}
          loadWeb3Modal={loadWeb3Modal}
          logoutOfWeb3Modal={logoutOfWeb3Modal}
          blockExplorer={blockExplorer}
        />
      </div>
      
      {/* 🗺 Extra UI like gas price, eth price, faucet, and support: */}

      <div style={{ position: "fixed", textAlign: "left", left: 0, bottom: 20, padding: 10 }}>
        {localEnv ? (
          <Space direction="vertical" size="small">
            {faucetHint}
            <Faucet localProvider={localProvider} />
          </Space>
        ) : ""
        }
      </div>

    </div>
  );
}

/*
  Web3 modal helps us "connect" external wallets:
*/
const web3Modal = new Web3Modal({
  // network: "mainnet", // optional
  cacheProvider: true, // optional
  providerOptions: {
    walletconnect: {
      package: WalletConnectProvider, // required
      options: {
        infuraId: INFURA_ID,
      },
    },
  },
});

const logoutOfWeb3Modal = async () => {
  await web3Modal.clearCachedProvider();
  setTimeout(() => {
    window.location.reload();
  }, 1);
};

/* eslint-disable */
window.ethereum &&
  window.ethereum.on("chainChanged", chainId => {
    web3Modal.cachedProvider &&
      setTimeout(() => {
        window.location.reload();
      }, 1);
  });

window.ethereum &&
  window.ethereum.on("accountsChanged", accounts => {
    web3Modal.cachedProvider &&
      setTimeout(() => {
        window.location.reload();
      }, 1);
  });
/* eslint-enable */

export default App;

# HODL-rewards-pool 🧑‍🤝‍🧑🤽 dApp 
A small project for learning smart-contract-full-stack-whizz-banging-dApp-buidling using the incredible [scaffold-eth](https://github.com/austintgriffith/scaffold-eth).

### 💡 The idea

A HODLing pool smart contract with rewards and penalties. "HODL me, I'm scared".

Incentivising long term holding of tokens together as communities / teams. Committed hodlers, "strong 💎 hands" are rewarded from penalties for early withdrawals by the "weak 🧁 hands". 

### 📔 Vague versions plan
1. v0
    - goal: 🚀 end-to-end bare skeleton first version deployed (to testnet). 
    - scope: fixed commitment params, reward by ratio of current pool, only eth
    - stretch scope: erc20 support
    - deliver: repo, tests, deployed contract and frontend for testnet
2. v0.5:
    - goal: 🧠 better incentives mechanism, slightly more complex calc and interaction 
    - scope: fixed commitment params, reward by time held, erc20 support
    - stretch scope: contract creation flow + contract
    - deliver: clear UI, FAQ, initial feedback, more testing on testnet
3. v1: 🍕+🍔 flexible commitment params UI + calc, reward by time held and commitment time
4. v2: 🚢 single contract for all tokens?

---

# 🏃‍♀️ Local development

System dependencies: [Node](https://nodejs.org/dist/latest-v12.x/) plus [Yarn](https://classic.yarnpkg.com/en/docs/install/)

1. Install dependecies: `yarn install`
2. Start a local chain: `yarn chain`
3. In second terminal: deploy the contract to the chain - `yarn deploy` or `yarn watch`
4. In third terminal: start the frontend react server `yarn start`

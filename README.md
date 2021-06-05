![CI](https://github.com/artdgn/hodl-bonus-pool-dapp/workflows/CI/badge.svg) 
<a href=https://hodl-pool-dapp-v1-kovan.surge.sh/><img src=https://img.shields.io/badge/Kovan--V1-Surge-blueviolet></img></a>

# HODL-bonus-pool 🧑‍🤝‍🧑🤽 dApp 
> A project for learning smart-contract-full-stack-whizz-bang-dApp-buidling using the **incredible [austintgriffith/scaffold-eth](https://github.com/austintgriffith/scaffold-eth)**.

## 💡 The idea: "Strong 💎✊ hands" get a bonus from "weak 🧁 hands"'s penalties for early withdrawals.

### Why would anyone use it, why is it a good idea ❔

1. <details><summary> Price effect: like "staking", but without the inflation </summary>

    - Raises the price by reducing amount in circulation 📥.
    - Builds trust in the asset by proving an amount commited to be held 💍.
    - Makes HODLing more attractive by providing a positive economic incentive 🤑. 

    </details>

1. <details><summary> Social proof / network effects: like "time lock", but with an incentive to participate </summary>

    - Makes HODLing provable and shareable 🐦 .
    - Increases trust in the community's / project team's long term commitment, provides a social incentive to demonstrate "skin in the game" 🙋‍♀️ .

    </details>

1. <details><summary> Yield generating: like AMMs LP or lending, but without AMM's impermanent loss and doesn't depend on borrowing demand </summary>

    - Vs. liquidity providing in AMMs: no dependence on trading volume, no exposure to additional assets, no bleeding value to arbitrageurs (~~not-so~~""impermanent"" loss) 🩸.
    - Vs. lending: earns yield on tokens that don't have a borrowing market with high interest rates 🔄 (or any borrowing market).

    </details>

1. <details><summary> Volatility bonus: market volatility causes higher bonuses </summary>

    - Asset price "moons" 🥳 - more "weak hands" will withdraw early to take profits, increasing the bonus 💸.
    - Asset price "tanks" 😢 - more "weak hands" will withdraw early to panic-sell, increasing the bonus 💸.

    </details>

1. <details><summary> So what tokens this should / shouldn't be used for? </summary>

    - ✔️ Most tokens which don't have profitable AMM / staking / lending usage.
    - ✔️✔️✔️ Especially smaller project tokens, or community driven tokens like meme-tokens.
    - 👎 Stablecoins: they can be profitably and safely lended, or provided as liquidity in AMMs.
    - 👎 Tokens which have very high trading volume but don't change in price much: they can be LPed in AMMs.
    - 👎 Tokens which have profitable staking mechanisms: they can be staked for guaranteed yield.

    </details>

---

### 🧭 Vague versions plan (roadmap?)
1. <details><summary>v0 ✔️ (PoC)</summary>

    - goal: 🚀 end-to-end bare skeleton first version deployed (to testnet). 
    - scope: fixed commitment params & bonus depends on ratio of current pool, only eth
    - deliver ✔️ repo ✔️, tests + CI ✔️, basic UI ✔️, [kovan testnet deployed & verified contract](https://kovan.etherscan.io/address/0xaD00093d69829C61c952eF9A354B14D41F38BEA3#code) ✔️ and [frontend (eth) ✔️](https://hodl-pool-dapp-v0-kovan.surge.sh/)
    - stretch ✔️: erc20 support ✔️ (supporting a single token)
    </details>

1. v1 ✔️ (alpha):
    - goal: handle all tokens & ETH in one contract
    - scope: any ERC20 token ✔️ (even fee-on-transder tokens ✔️), handle ETH as WETH ✔️, single contract for all tokens ✔️ 
    - deliver: UI ✔️ [frontend (ERC20 tokens / eth) ✔️](https://hodl-pool-dapp-v1-kovan.surge.sh/), explanations ✔️, [kovan testnet deployed & verified contract](https://kovan.etherscan.io/address/0xf15E3349B9CB5452638130cd958E3f1be2f934Eb#code) ✔️, some feedback ✔️   
1. v2 ⌛ (beta):
    - goal & scope: bonus depends on time held 🕥, flexible commitment params 🍕+🍔
    - deliver: UI, testnet, 🚀 mainnet!

---

# Basic V1 demo:
![](https://artdgn.github.io/images/hodl-pool-v1.gif)

---

# Local development

System dependencies: [Node](https://nodejs.org/dist/latest-v12.x/) plus [Yarn](https://classic.yarnpkg.com/en/docs/install/)

## Running local chain + contract + local frontend
1. Install dependecies: `yarn install`
1. Start a local chain: `yarn chain`
1. In second terminal: deploy the contract to the chain - `yarn deploy` or `yarn watch`
1. In third terminal: start the frontend react server `yarn start`

## Testing:
- All tests: `yarn test`
- Run some tests matching a pattern (in their description strings):
  1. Go to contracts package: `cd packages/hardhat`
  2. Start a local chain: `yarn chain`
  3. In second terminal: run e.g. "deployment" related tests - `yarn mocha -g deployment`

![CI](https://github.com/artdgn/hodl-bonus-pool-dapp/workflows/CI/badge.svg)

# HODL-bonus-pool 🧑‍🤝‍🧑🤽 dApp 
> A small project for learning smart-contract-full-stack-whizz-bang-dApp-buidling with the **incredible [austintgriffith/scaffold-eth](https://github.com/austintgriffith/scaffold-eth) framework**.

### 💡 The idea: "Strong 💎 hands" (committed hodlers) get a bonus from "weak 🧁 hands"'s penalties for early withdrawals.

### ❔ Why this may be a good idea:
1. **Price effects** - like "staking", but without the inflation:
    - Makes HODLing more attractive by providing a positive economic incentive 🤑. 
    - Raises the price by reducing amount in circulation 📥.
    - Builds trust in the asset by proving an amount commited to be held 💍.
1. **Social / network effects** - like "time lock", but with an incentive to participate:
    - Makes HODLing provable and shareable 🐦 .
    - Increases trust in the community's / project team's long term commitment, provides a social incentive to demonstrate "skin in the game" 🙋‍♀️ .
1. **Yield generating** - like AMMs LP or lending, but without AMM's impermanent loss and doesn't depend on borrowing demand:
    - Vs. liquidity providing in AMMs: no dependence on trading volume, no exposure to additional assets, no bleeding value to arbitrageurs (~~not-so~~""impermanent"" loss) 🩸.
    - Vs. lending: earns yield on tokens that don't have a borrowing market with high interest rates 🔄 (or any borrowing market).
1. **Volatility bonus** - market volatility causes higher bonuses:
    - Asset price "moons" 🥳 - more "weak hands" will withdraw early to take profits, increasing the bonus 💸.
    - Asset price "tanks" 😢 - more "weak hands" will withdraw early to panic-sell, increasing the bonus 💸.

### 🧭 Vague versions plan (roadmap?)
1. v0 ⌛ (PoC)
    - goal: 🚀 end-to-end bare skeleton first version deployed (to testnet). 
    - scope: fixed commitment params & bonus depends on ratio of current pool, only eth
    - deliver ⌛: repo ✅, tests + CI ✅, basic UI ⌛, testnet deployed contract ⌛ and frontend ⌛
    - stretch ⌛: erc20 support
1. v0.5 (alpha):
    - goal: 🧠 better incentives mechanism, slightly more complex calc and interaction 
    - scope: fixed commitment params, bonus depends on time held, erc20 support
    - deliver: clear UI, FAQ, initial feedback, more testing on testnet
    - stretch: contract creation flow + contract
1. v1 (beta): 🍕+🍔 flexible commitment params UI + calc, bonus depends on time held and commitment time
1. v2: 🚢 single contract for all tokens?

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

RBN 🎀
===

RBN is Ribbon's governance token. It is used to
- Steward the development of the protocol & get community feedback on important parameters such as fee models
- Align incentives between the Ribbon stakeholders (product creators, users, team), such as liquidity mining programs or grants
- Unite all current and future Ribbon products under a single umbrella

Getting Started
---

Install node dependencies with yarn:

```
yarn install
```

Testing Contracts
---

To run tests, you will need to have access to an archive node. Create a .env file in the root with the variable:

```
TEST_URI=<archive node uri>
```

Run tests with hardhat:

```
npx hardhat test
```

Token Parameters
---

- [Token Deployer Params](https://github.com/ribbon-finance/token/blob/18883f75335af47844f64c13744bdcf95445f6db/params.js#L5)
- [Staking Rewards Deployer Params](https://github.com/ribbon-finance/token/blob/18883f75335af47844f64c13744bdcf95445f6db/params.js#L16)

Deploying
---

Deploying Ribbon token to Mainnet ([reference](https://hardhat.org/tutorial/deploying-to-a-live-network.html))

* add mainnet url / accounts in hardhat.config.js
* `npx hardhat run scripts/deploy.js --network mainnet`

Deploying Ribbon staking rewards to Mainnet ([reference](https://hardhat.org/tutorial/deploying-to-a-live-network.html))

* add mainnet url / accounts in hardhat.config.js
* `npx hardhat run scripts/deploy-stakingrewards.js --network mainnet`

Deploying Merkle Airdrop to Mainnet ([reference](https://hardhat.org/tutorial/deploying-to-a-live-network.html))

* add mainnet url / accounts in hardhat.config.js
* add owner address to params.js under AIRDROP_PARAMS object
* add token address to params.js under AIRDROP_PARAMS object
* add merkle root to params.js under AIRDROP_PARAMS object
  * `node scripts/generate-recipients-json.js -b <BLOCKNUM> -f <FILEPATH>` 
      * ex: `node scripts/generate-recipients-json.js -b 12480786 -f airdrop.json`
      * This will generate the address -> balance mapping of all relevant users 
        from hegic, opyn, charm, primitive, ribbon strangle, ribbon theta vault
      * _NOTE:_ this will take a few minutes (~10m) the first time around, but afterwards will be quicker as 
        block info is cached
  * `npx ts-node scripts/generate-merkle-root.ts -i <FILEPATH> -n <NEW_FILEPATH>` where FILEPATH is path from above step. 
      * This will give you the **merkle root** itself for the params.js file 
         and full details for the merkle proof is written to NEW_FILEPATH
  * To verify the merkle root from previous step is correct:
    * `npx ts-node scripts/verify-merkle-root.ts -i <FILEPATH>` where FILEPATH is NEW_FILEPATH from above step. 
       *  This will give you the **merkle root** itself for the params.js file 
          and full details for the merkle proof is written to NEW_FILEPATH
* add days until unlock for owner to params.js under AIRDROP_PARAMS object
* `npx hardhat run scripts/deploy-merkle-distributor.js --network mainnet`

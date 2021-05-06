[Token Deployer Params](https://github.com/ribbon-finance/token/blob/18883f75335af47844f64c13744bdcf95445f6db/params.js#L5) \
[Staking Rewards Deployer Params](https://github.com/ribbon-finance/token/blob/18883f75335af47844f64c13744bdcf95445f6db/params.js#L16)


Testing Contracts

* `npx hardhat test`

Deploying Ribbon token to Mainnet ([reference](https://hardhat.org/tutorial/deploying-to-a-live-network.html))

* add mainnet url / accounts in hardhat.config.js
* `npx hardhat run scripts/deploy.js --network mainnet`

Deploying Ribbon staking rewards to Mainnet ([reference](https://hardhat.org/tutorial/deploying-to-a-live-network.html))

* add mainnet url / accounts in hardhat.config.js
* `npx hardhat run scripts/deploy-stakingrewards.js --network mainnet`

Deploying Merkle Airdrop to Mainnet ([reference](https://hardhat.org/tutorial/deploying-to-a-live-network.html))

* add mainnet url / accounts in hardhat.config.js
* add token address to params.js under AIRDROP_PARAMS object
* add merkle root to params.js under AIRDROP_PARAMS object
  * `node scripts/generate-recipients-json.js -b <BLOCKNUM> -f <FILEPATH>` 
      * ex: `node scripts/generate-recipients-json.js -b 12378107 -f airdrop.json`
      * This will generate the address -> balance mapping of all relevant users 
        from hegic, opyn, charm, primitive, ribbon strangle, ribbon theta vault
      * _NOTE:_ this will take a few minutes (~10m) the first time around, but afterwards will be quicker as 
        block info is cached
  * `npx ts-node scripts/generate-merkle-root.ts -i <FILEPATH>` where FILEPATH is path from above step. 
      * This will give you the **merkle root** itself for the params.js file 
         and details for merkle proofs of all addresses
* `npx hardhat run scripts/deploy-merkle-distributor.js --network mainnet`

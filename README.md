[Token Deployer Params](https://github.com/ribbon-finance/token/blob/18883f75335af47844f64c13744bdcf95445f6db/params.js#L5) \
[Staking Rewards Deployer Params](https://github.com/ribbon-finance/token/blob/18883f75335af47844f64c13744bdcf95445f6db/params.js#L16)


Testing Contracts

1. `npx hardhat test`

Deploying Ribbon token to Mainnet ([reference](https://hardhat.org/tutorial/deploying-to-a-live-network.html))

1. add mainnet url / accounts in hardhat.config.js
2. `npx hardhat run scripts/deploy.js --network mainnet`

Deploying Ribbon staking rewards to Mainnet ([reference](https://hardhat.org/tutorial/deploying-to-a-live-network.html))

1. add mainnet url / accounts in hardhat.config.js
2. `npx hardhat run scripts/deploy-stakingrewards.js --network mainnet`

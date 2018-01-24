const {getERC20TokenContract, web3} = require('./blockchain')

const {
  requiredConfirmations,
  maxBlocksRead,
} = require('app/config')

const {
  loggers: {logger},
} = require('@welldone-software/node-toolbelt')

const {
  validateAddress,
  weiToEther,
} = require('app/utils')

const getLastConfirmedBlock = async () => {
  const currentBlock = await web3.eth.getBlockNumber()
  return (currentBlock - requiredConfirmations)
}

const getLatestTransferTransactions = async (tokenAddress, fromBlock) => {
  validateAddress(tokenAddress)
  const tokenContract = getERC20TokenContract(tokenAddress)

  const toBlock = await getLastConfirmedBlock()
  if ((toBlock - fromBlock) > maxBlocksRead) {
    fromBlock = toBlock - maxBlocksRead
    fromBlock = fromBlock < 0 ? fromBlock = 0 : fromBlock
  }

  if (fromBlock > toBlock) {
    logger.info(`Block number ${fromBlock} does not have enough confirmations (${requiredConfirmations}). 
    Current block number is ${await web3.eth.getBlockNumber()}`)
  }

  const transactions = []
  const events = await tokenContract.getPastEvents('Transfer', {fromBlock, toBlock})
  events.forEach((event) => {
    const transaction = {
      // eslint-disable-next-line no-underscore-dangle
      from: event.returnValues._from,
      // eslint-disable-next-line no-underscore-dangle
      to: event.returnValues._to,
      // eslint-disable-next-line no-underscore-dangle
      amount: weiToEther(event.returnValues._value),
      logIndex: event.logIndex,
      transactionIndex: event.transactionIndex,
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
      event,
    }

    transactions.push(transaction)
    // if (weiToEther(event.returnValues._value) > 50000) {
    //   transactions.push(transaction)
    // }
  })

  return ({toBlock, transactions})
}

const getAccountBalance = async (tokenAddress, owner) => {
  validateAddress(tokenAddress)
  validateAddress(owner)
  const tokenContract = getERC20TokenContract(tokenAddress)
  return tokenContract.methods.balanceOf(owner).call(undefined, await getLastConfirmedBlock())
}

const getAccountBalanceInEther = async (tokenAddress, owner) => ({
  balance: Number(weiToEther(await getAccountBalance(tokenAddress, owner))),
})

module.exports = {
  getLatestTransferTransactions,
  getAccountBalanceInEther,
}

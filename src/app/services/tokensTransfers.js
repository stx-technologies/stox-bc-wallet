const {flatten, uniq, omit} = require('lodash')
const Sequelize = require('sequelize')
const {exceptions: {UnexpectedError}, loggers: {logger}} = require('@welldone-software/node-toolbelt')
const db = require('app/db')
const tokenTracker = require('../services/tokenTracker')
const backendApi = require('../services/backendApi')
const {promiseSerial} = require('../promise')
const {network, tokenTransferCron} = require('app/config')
const {getBlockData} = require('app/utils')
const {scheduleJob, cancelJob} = require('../scheduleUtils')
const {logError} = require('../errorHandle')
const tokensTransfersReads = require('./db/tokensTransfersReads')
const tokensTransfers = require('./db/tokensTransfers')
const tokensBalances = require('./db/tokensBalances')

const {Op} = Sequelize

const fetchLatestTransactions = async ({id, name, address}) => {
  const lastReadBlockNumber = await tokensTransfersReads.fetchLastReadBlock(id)
  const fromBlock = lastReadBlockNumber !== 0 ? lastReadBlockNumber + 1 : 0

  try {
    const {blockNumber: currentBlock, timestamp: currentBlockTime} = await getBlockData()
    const result = await tokenTracker.getLatestTransferTransactions(address, fromBlock)

    logger.info({
      network,
      token: name,
      transactions: result.transactions.length,
      fromBlock: result.fromBlock,
      toBlock: result.toBlock,
      currentBlock,
      currentBlockTime: currentBlockTime.toUTCString(),
    }, 'READ_TRANSACTIONS')

    return {
      ...result,
      currentBlockTime,
    }
  } catch (e) {
    throw new UnexpectedError(`blockchain read failed, ${e.message}`, e)
  }
}

const insertTransactions = async (token, transactions, currentBlockTime) => {
  try {
    await tokensTransfers.insertTransactions(token.id, transactions, currentBlockTime)
    logger.info({
      network,
      token: token.name,
      currentBlockTime,
      transactions: transactions.length,
    }, 'WRITE_TRANSACTIONS')
  } catch (e) {
    logError(e)
  }
}

const updateBalance = async (token, wallet, balance) => {
  try {
    await tokensBalances.updateBalance(token.id, wallet.id, balance)
    logger.info({
      network,
      token: token.name,
      walletAddress: wallet.address,
      balance,
    }, 'UPDATE_BALANCE')
  } catch (e) {
    logError(e)
  }
}

const sendMessageToBackend = async (token, wallet, transactions, balance, currentBlockTime) => {
  const walletAddress = wallet.address
  const message = {
    network,
    address: walletAddress,
    asset: token.name,
    balance,
    happenedAt: currentBlockTime,
    transactions: transactions.map(({transactionHash, to, amount}) => ({
      transactionHash,
      amount,
      status: 'confirmed',
      type: to.toLowerCase() === walletAddress.toLowerCase() ? 'deposit' : 'withdraw',
    })),
  }

  try {
    await backendApi.sendTransactionMessage(message)
    const rest = omit(message, 'transactions')
    logger.info({
      ...rest,
      transactions: transactions.length,
    }, 'SEND_TRANSACTIONS')
  } catch (e) {
    logError(e)
  }
}

const getWalletsFromTransactions = async (transactions) => {
  const addresses = uniq(flatten(transactions.map(t => ([t.to.toLowerCase(), t.from.toLowerCase()])))).join('|')
  // todo: sould we filter unassigned wallets ?
  return db.sequelize.query(
    `select * from wallets where lower(address) similar to '%(${addresses})%'`,
    {type: Sequelize.QueryTypes.SELECT},
  )
}

const getBalanceInEther = async (token, wallet) => {
  const lastReadBlock = await tokensTransfersReads.fetchLastReadBlock(token.id)

  try {
    const {balance} = await tokenTracker.getAccountBalanceInEther(token.address, wallet.address, lastReadBlock)
    return balance
  } catch (e) {
    throw new UnexpectedError(`blockchain read failed, ${e.message}`, e)
  }
}

const filterTransactionsByWallets = (transactions, wallets) => {
  const addresses = wallets.map(w => w.address.toLowerCase())
  return transactions.filter(t => addresses.includes(t.to.toLowerCase()) || addresses.includes(t.from.toLowerCase()))
}

const filterTransactionsByAddress = (transactions, address) =>
  transactions.filter(t =>
    t.to.toLowerCase() === address.toLowerCase() ||
    t.from.toLowerCase() === address.toLowerCase())

const updateTokenBalances = async (token, wallet, tokenTransactions, currentBlockTime) => {
  const balance = await getBalanceInEther(token, wallet)
  const {address} = wallet
  const addressTransactions = filterTransactionsByAddress(tokenTransactions, address.toLowerCase())

  await updateBalance(token, wallet, balance)
  await sendMessageToBackend(token, wallet, addressTransactions, balance, currentBlockTime)
}

const tokensTransfersJob = async () => {
  const tokens = await db.tokens.findAll({where: {network: {[Op.eq]: network}}})
  return promiseSerial(tokens.map(token => async () => {
    const {transactions, toBlock, currentBlockTime} = await fetchLatestTransactions(token)

    if (transactions.length) {
      const wallets = await getWalletsFromTransactions(transactions)
      const tokenTransactions = filterTransactionsByWallets(transactions, wallets)

      if (tokenTransactions.length) {
        await insertTransactions(token, tokenTransactions, currentBlockTime)
      }

      const funcs = wallets.map(wallet =>
        () => updateTokenBalances(token, wallet, tokenTransactions, currentBlockTime))

      try {
        await promiseSerial(funcs)
      } catch (e) {
        logError(e)
      }
    }

    await tokensTransfersReads.updateLastReadBlock(token.id, toBlock)
  }))
}

module.exports = {
  start: async () => scheduleJob('tokensTransfers', tokenTransferCron, tokensTransfersJob),
  stop: async () => cancelJob('tokensTransfers'),
}

const {exceptions: {UnexpectedError}} = require('@welldone-software/node-toolbelt')

module.exports = ({db}) => ({
  updateBalance: async (tokenId, walletId, balance) => {
    const transaction = await db.sequelize.transaction()

    try {
      const tokenBalance = await db.tokensBalances.findOne({
        where: {
          walletId,
          tokenId,
        },
        transaction,
      })

      if (!tokenBalance) {
        await db.tokensBalances.create(
          {
            walletId,
            tokenId,
            balance,
            pendingUpdateBalance: 0,
          },
          {transaction}
        )
      } else {
        await tokenBalance.update({balance, pendingUpdateBalance: 0}, {
          where: {
            walletId,
            tokenId,
          },
        }, {transaction})
      }
      transaction.commit()
    } catch (e) {
      transaction.rollback()
      throw new UnexpectedError(e)
    }
  }
})

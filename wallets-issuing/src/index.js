require('app-module-path').addPath(__dirname) // eslint-disable-line import/no-unresolved
const {loggers: {logger}} = require('@welldone-software/node-toolbelt')
const {createService} = require('stox-common')
const {models, initContext} = require('stox-bc-wallet-common')
const config = require('config')
const jobs = require('jobs')

const {databaseUrl, mqConnectionUrl} = config

const builderFunc = (builder) => {
  builder.db(databaseUrl, models)
  builder.addJobs(jobs)
  builder.addQueues(mqConnectionUrl)
}

createService('wallets-sync', builderFunc)
  .then(service => {
    initContext({...service.context, config})
    return service.start()
  })
  .catch(e => logger.error(e))


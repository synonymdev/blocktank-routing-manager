'use strict'
const { Worker } = require('blocktank-worker')
const RouterManager = require('./RouterManager')
const config = require('../config/worker.config.json')
const privates = [
  'constructor'
]

class LightningRouter extends Worker {
  constructor (appConfig) {
    super({
      name: 'svc:ln:router',
      port: 58121,
      db_url: 'mongodb://localhost:27017',
      modules: [
        {
          name: 'sats-convert'
        }
      ]
    })
    this.router = new RouterManager(config, {
      getChannels: this.getChannels.bind(this),
      getInfo: this.getNodeInfo.bind(this),
      amlFiatCapactyCheck: this.amlFiatCapactyCheck.bind(this),
      updateLnRoutingFee: this.updateLnRoutingFee.bind(this),
      getBtcUsd: this.getBtcUsd.bind(this),
      satsToBtc: this.satsConvert.toBtc.bind(this),
      alert: this.alertSlack.bind(this)
    })
  }

  start () {
    Object.getOwnPropertyNames(Object.getPrototypeOf(this.router))
      .filter((n) => !privates.includes(n.toLowerCase()))
      .forEach((n) => {
        this[n] = this._handler.bind(this, n)
      })
  }

  _handler (action, args, cb) {
    if (!Array.isArray(args)) {
      args = [args]
    }
    if (!args.push) {
      throw new Error('Invalid params passed:')
    }
    args.push(cb)
    this.router[action].apply(this.router, args)
  }

  getChannels (cb) {
    return this.callLn('listChannels', { is_active: true }, cb)
  }

  getNodeInfo (cb) {
    return this.callLn('getInfo', null, cb)
  }

  amlFiatCapactyCheck (args, cb) {
    return this.callWorker('svc:channel_aml', 'amlFiatCapactyCheck', args, cb)
  }

  updateLnRoutingFee (args, cb) {
    return this.callLn('updateRoutingFees', args, cb)
  }

  getBtcUsd (args, cb) {
    return this.callWorker('svc:exchange_rate', 'getBtcUsd', args, cb)
  }
}

module.exports = LightningRouter

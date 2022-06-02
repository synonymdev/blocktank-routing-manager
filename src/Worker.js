'use strict'
const { Worker } = require('blocktank-worker')
const RouterManager = require('./RouterManager')
const config = require('../config/worker.config.json')
const { promisify } = require('util')
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
      onNewChannelRequest: this.onNewChannelRequest.bind(this),
      updateLnRoutingFee: this.updateLnRoutingFee.bind(this),
      getBtcUsd: this.getBtcUsd.bind(this),
      satsToBtc: this.satsConvert.toBtc.bind(this),
      getForwards: this.getForwards.bind(this),
      getNodeOfClosedChannel: promisify(this.getNodeOfClosedChannel.bind(this)),
      alertSlack: this.alertSlack.bind(this),
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

  onNewChannelRequest (args, cb) {
    return this.callWorker('svc:channel_aml', 'amlFiatCapactyCheck', args, cb)
  }

  updateLnRoutingFee (args, cb) {
    return this.callLn('updateRoutingFees', args, cb)
  }

  getBtcUsd (args, cb) {
    return this.callWorker('svc:exchange_rate', 'getBtcUsd', args, cb)
  }

  getForwards(node,args,cb){
    this.callLn("getForwards",[!node ? {all: true} : {node_id:node },args],(err,data)=>{
      if(err) return cb(err)
      cb(null, data)
    })
  }

  getNodeOfClosedChannel(chan,cb){
    this.callLn("getNodeOfClosedChannel",[null,{ channel_id: chan}],(err,data)=>{
      if(err) return cb(err)
      cb(null, data)
    })
  }

  async syncFwdEvents(cb){
    return this.router.syncFwdEvents(cb)
  }

}

module.exports = LightningRouter

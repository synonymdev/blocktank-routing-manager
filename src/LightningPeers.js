'use strict'
const { DB } = require('blocktank-worker')
const config = require('../config/worker.config.json')
const { EventEmitter } = require('events')
const FeeTier = require('./FeeTier')
const promcb = (resolve, reject, cb) => {
  return (err, data) => {
    if (err) {
      return cb ? cb(err, data) : reject(err)
    }
    cb ? cb(err, data) : resolve(data)
  }
}

const STARTING_FEE_TIER = FeeTier.LEVELS[0]

class LightningPeers extends EventEmitter {
  constructor (params) {
    super()
    this.data = params
    this.ready = false
    DB(config, (err, db) => {
      if (err) throw err
      this.db = db
      this.ready = true
      process.nextTick(() => this.emit('ready'))
    })
  }

  static from (params) {
    return new LightningPeers(params)
  }

  LogEvent (pk, events, cb) {
    return (err) => {
      if (err) return cb(err)
      const bulk = this.db.LightningPeerLog.initializeUnorderedBulkOp()
      events.forEach(({ name, meta }) => {
        const data = {
          node_public_key: pk,
          name,
          ts: Date.now(),
          meta: meta || null
        }
        bulk.insert(data)
      })
      bulk.execute(cb)
    }
  }

  static newPeer (params, cb) {
    return new Promise((resolve, reject) => {
      const p = new LightningPeers()
      p.on('ready', () => {
        const data = {
          node_public_key: params.public_key,
          routing_fee_tier: STARTING_FEE_TIER,
          created_at: Date.now(),
          last_connect: Date.now(),
          last_disconnect: null
        }

        const logEvent = p.LogEvent(params.public_key, [
          { name: 'CREATED' },
          { name: 'ROUTING_FEE_TIER', meta: { tier: STARTING_FEE_TIER } },
          { name: 'CONNECTED' }
        ], promcb(resolve, reject, cb))

        p.db.LightningPeers.insertOne(data, logEvent)
      })
    })
  }

  static getPeer (pk, cb) {
    return new Promise((resolve, reject) => {
      const p = new LightningPeers()
      p.on('ready', () => {
        p.db.LightningPeers.findOne({
          node_public_key: pk
        }, promcb(resolve, reject, cb))
      })
    })
  }

  static peerDisonnected (pk, cb) {
    return new Promise((resolve, reject) => {
      const p = new LightningPeers()

      const logEvent = p.LogEvent(pk, [{ name: 'DISCONNECTED' }], promcb(resolve, reject, cb))

      return p.db.LightningPeers.updateOne(
        { node_public_key: pk },
        {
          $set: {
            last_disconnect: Date.now()
          }
        }, logEvent)
    })
  }

  static channelRejected (pk, {reason}, cb) {
    return new Promise((resolve, reject) => {
      const p = new LightningPeers()

      p.LogEvent(pk, [{ name: 'CHANNEL_REJECT', reason }], promcb(resolve, reject, cb))
    })
  }

  static peerConnected (pk, cb) {
    return new Promise((resolve, reject) => {
      const p = new LightningPeers()

      const logEvent = p.LogEvent(pk, [{ name: 'CONNECTED' }], promcb(resolve, reject, cb))

      return p.db.LightningPeers.updateOne(
        { node_public_key: pk },
        {
          $set: {
            last_connect: Date.now()
          }
        }, logEvent)
    })
  }

  static updateFeeTier (pk, { tier }, cb) {
    return new Promise((resolve, reject) => {
      const p = new LightningPeers()

      const logEvent = p.LogEvent(pk,
        [{ name: 'ROUTING_FEE_TIER', meta: { tier: STARTING_FEE_TIER }} ],
        promcb(resolve, reject, cb))

      return p.db.LightningPeers.updateOne(
        { node_public_key: pk },
        {
          $set: {
            routing_fee_tier: tier
          }
        }, logEvent)
    })
  }
}

module.exports = LightningPeers

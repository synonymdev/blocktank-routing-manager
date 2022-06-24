'use strict'
const config = require('../config/worker.config.json')
const { EventEmitter } = require('events')
const { DB } = require("blocktank-worker")

const promcb = (resolve, reject, cb) => {
  return (err, data) => {
    if (err) {
      return cb ? cb(err, data) : reject(err)
    }
    cb ? cb(err, data) : resolve(data)
  }
}

class LightningPeerGroups extends EventEmitter {
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
    return new LightningPeerGroups(params)
  }

  static newGroup (params, cb) {
    return new Promise((resolve, reject) => {
      const p = new LightningPeerGroups()
      p.on('ready', () => {
        const data = {
          nodes: params.nodes,
          routing_fee_tier: params.fee_tier,
          created_at: Date.now(),
          total_sats_fwd: 0,
          total_usd_fwd: 0,
          total_sats_fee: 0,
          total_usd_fee: 0,
        }
        p.db.LightningPeerGroups.insertOne(data, promcb(resolve, reject, cb))
      })
    })
  }

  static updateGroup(id,data, cb){
    return new Promise((resolve, reject) => {
      const p = new LightningPeerGroups()
      p.on('ready', () => {
        if(data._id){
          delete data._id
        }

        return p.db.LightningPeerGroups.updateOne(
          { _id: new order.db.ObjectId(id) },
          {
            $set: data
          }, promcb(resolve, reject, cb))
      })
    })
  }

  static getGroup (pk, cb) {
    return new Promise((resolve, reject) => {
      const p = new LightningPeerGroups()
      p.on('ready', () => {
        p.db.LightningPeerGroups.findOne({ nodes:  {$in : [pk] } }, promcb(resolve, reject, cb))
      })
    })
  }
}

module.exports = LightningPeerGroups

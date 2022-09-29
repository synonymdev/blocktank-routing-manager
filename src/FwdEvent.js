'use strict'
const { DB } = require('blocktank-worker')
const config = require('../config/worker.config.json')
const { EventEmitter } = require('events')
const crypto = require("crypto")

const promcb = (resolve, reject, cb) => {
  return (err, data) => {
    if (err) {
      return cb ? cb(err, data) : reject(err)
    }
    cb ? cb(err, data) : resolve(data)
  }
}

class LightningFwd extends EventEmitter {
  constructor (params) {
    super()
    this.data = params
    this.ready = false
    DB(config, async (err, db) => {
      if (err) throw err
      this.db = db
      this.ready = true
      await this.addIndex()
      process.nextTick(() => this.emit('ready'))
    })
  }

  async addIndex(){
    try{
      await this.db.LightningFwdEvent.createIndex( { "event_id": 1 }, { unique: true } )
    } catch(err){
      console.log("FAILED_TO_CREATE_INDEX")
      console.log(err)
    }

  }
  static from (params) {
    return new LightningFwd(params)
  }

  static addEvent (params, cb) {
    return new Promise((resolve, reject) => {
      const p = new LightningFwd()
      p.on('ready', () => {
        const data = {
          node_public_key: params.node_public_key,
          in_chan: params.in_chan,
          in_chan_node: params.in_chan_node,
          out_chan: params.out_chan,
          out_chan_node: params.out_chan_node,
          fee: params.fee,
          amount: params.amount,
          routed_at: params.routed_at,
          usd_amount: params.usd_amount,
          usd_fee: params.usd_fee,
          created_at: Date.now(),
          event_id: crypto.createHash('sha256').update(`${params.in_chan_node}:${params.out_chan_node}:${params.routed_at}:${params.amount}`).digest('hex')
        }
        p.db.LightningFwdEvent.insertOne(data,(err,res)=>{
          if(err && err.code === 11000){
            return promcb(resolve, reject, cb)(null,"EXISTS")
          }
          return promcb(resolve, reject, cb)(err,res)
        })
      })
    })
  }

  static latestEvent (cb) {
    return new Promise((resolve, reject) => {
      const p = new LightningFwd()
      p.on('ready', () => {
        p.db.LightningFwdEvent.find().sort({ routed_at: -1 }).limit(1).toArray(promcb(resolve, reject, cb))
      })
    })
  }

  static eachEvent (query, iter) {
    const p = new LightningFwd()
    p.on('ready', () => {
      p.db.LightningFwdEvent.find(query)
        .sort({ routed_at: -1 })
        .forEach(iter)
    })
  }
}

module.exports = LightningFwd

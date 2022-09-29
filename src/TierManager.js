'use strict'
const BN = require('bignumber.js')
const async = require('async')
const LightningPeers = require('./LightningPeers')
const FwdEvent = require('./FwdEvent')
const PeerGroup = require('./PeerGroups')
const { promisify } = require('util')
const FeeTier = LightningPeers.FeeTier

// TierManager is in charge of calculating and deciding the fee tier of a node
class TierManager {
  constructor (config, lnChannels, api) {
    this.config = config
    this.api = api
    this.lnChannels = lnChannels
    this._updates = new Map()
    this._updating_db = false
    lnChannels.on('channels_updated', () => {
      this.syncFwdEvents()
    })
  }

  // Call LN worker and update a channel's fee
  async updateLNFees (tier, pubkeys) {
    const chans = pubkeys.map((pubkey) =>{
      return this.lnChannels.getNodeChannels(pubkey)
    }).flat()
    this.api.alertSlack('info', 'channel_tier', `Channel tier changed for node ${pubkeys.join(",")}`)
    return new Promise((resolve, reject) => {
      async.mapSeries(chans, async (chan) => {
        const params = {
          transaction_id: chan.transaction_id,
          transaction_vout: chan.transaction_vout,
          fee_rate: FeeTier.tierToPpmFeeRate(tier)
        }
        return this.api.updateLnRoutingFee(params)
      }, (err, data) => {
        if (err) {
          console.log("FAILED_TO_UPDATE_CHANNEL")
          return reject(err)
        }
        resolve(data)
      })
    })
  }

  initPeerFees (pub) {
    return LightningPeers.newPeer({ public_key: pub })
  }

  _addPeerGroup(nodes){
    return PeerGroup.newGroup({
      nodes,
      fee_tier: LightningPeers.FeeTier.LEVELS[0]
    })
  }

  async addEvent (fwds, pubkey) {
    for (let x = 0; x < fwds.length; x++) {
      const fwd = fwds[x]
      const inNode = await this.lnChannels.getNodeOfChannel(fwd.incoming_channel)
      const outNode = await this.lnChannels.getNodeOfChannel(fwd.outgoing_channel)
      if(!outNode){
        console.log('XXX')
        console.log(fwd)
      }
      const p  = await this.api.getBtcUsd({ts:fwd.created_at - 5000})
      const { price }  = p
      const usdAmount = BN(this.api.satsToBtc(fwd.tokens)).times(price).toNumber()
      const usdFee = BN(this.api.satsToBtc(fwd.fee)).times(price).toNumber()
      const res = await FwdEvent.addEvent({
        in_chan: fwd.incoming_channel,
        in_chan_node: inNode,
        out_chan: fwd.outgoing_channel,
        out_chan_node: outNode,
        fee: fwd.fee,
        amount: fwd.tokens,
        routed_at: new Date(fwd.created_at).getTime(),
        node_public_key: pubkey,
        usd_amount: usdAmount,
        usd_fee: usdFee
      })
      if(res === "EXISTS") {
        continue
      }
      
      let outGroup = await PeerGroup.getGroup(outNode)
      let inGroup = await PeerGroup.getGroup(inNode)

      if(!outGroup && outNode){
        await this._addPeerGroup([outNode])
        outGroup = await PeerGroup.getGroup(outNode)
      }

      if(outGroup){
        outGroup.total_usd_fwd += usdAmount
        outGroup.total_usd_fee += usdFee
        outGroup.total_sats_fwd += fwd.tokens
        outGroup.total_sats_fee += fwd.fee
        const newTier = FeeTier.getTierFromAmount(outGroup.total_usd_fwd)
        if(!FeeTier.isSame(outGroup.routing_fee_tier,newTier)){
          outGroup.routing_fee_tier = newTier
          await this.updateLNFees(newTier,outGroup.nodes)
        }
        await PeerGroup.updateGroup(outGroup._id, outGroup)
      }


      if(!inGroup && inNode){
        await this._addPeerGroup([inNode])
        inGroup = await PeerGroup.getGroup(inNode)
      }
      if(inGroup){ 
        inGroup.total_sats_fwd += fwd.tokens
        inGroup.total_sats_fee += fwd.fee
        inGroup.total_usd_fwd += usdAmount
        inGroup.total_usd_fee += usdFee
        const newTier = FeeTier.getTierFromAmount(inGroup.total_usd_fwd)
        if(!FeeTier.isSame(inGroup.routing_fee_tier,newTier)){
          inGroup.routing_fee_tier = newTier
          await this.updateLNFees(newTier,inGroup.nodes)
        }
        await PeerGroup.updateGroup(inGroup._id, inGroup)
      }
    }
  }

  async syncFwdEvents (cb) {
    const latestForward = await FwdEvent.latestEvent()
    const query = {}
    if (latestForward.length > 0) {
      query.after = new Date(new Date(latestForward.pop().routed_at).getTime() + 1000)
      query.before = new Date()
    }
    const getForwards = promisify(this.api.getForwards.bind(this))
    const nodes = await promisify(this.api.getInfo.bind(this))()
    async.eachOf([nodes], async (node) => {
      let token
      while (true) {
        let data
        try{
          const page = !token ? { limit: 100 } : {token}
          data = await getForwards(node.public_key, page)
          await this.addEvent(data.forwards, node.public_key)
          if (!data.next) break
          data.next = JSON.parse(data.next)
          data.next.limit = 100
          token = JSON.stringify(data.next)
        } catch(err){
          console.log(err)
        }
      }
    }, async (err,data)=>{
      if(err) return cb(err)
      cb()
    })
  }
}

module.exports = TierManager

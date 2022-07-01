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
      this.updateDB()
    })
  }

  // Channel list is refreshed, we calculate the new fee tiers
  // Go through nodes, calculate their fee tier.
  async updateDB () {
    if (this._updating_db) return
    const nodeTiers = await this.calcTier()
    this._updating_db = true
    async.forEachOf(nodeTiers, async ([pub, info]) => {
      if (this.config.node_whitelist.includes(pub)) return null
      let dbPeer = await LightningPeers.getPeer(pub)
      if (!dbPeer) {
        await this.initPeerFees(pub)
        dbPeer = await LightningPeers.getPeer(pub)
      }
      if (FeeTier.isSame(dbPeer.routing_fee_tier, info.tier)) return null
      console.log(`Fee tier ${pub} changed`)
      this.api.alertSlack('info', 'channel_tier', `Channel tier changed for node ${pub}`)
      await this.updateLNFees(info.tier, info.chans)
      return LightningPeers.updateFeeTier(pub, info)
    }, async (err) => {
      if (err) {
        console.log(err)
        this.api.alertSlack('error', 'channel_tier', 'Failed to update channel tiers')
        throw new Error('Failed to update fee tier')
      }
      this._updates = new Map()
      this._updating_db = false
    })
  }

  // Call LN worker and update a channel's fee
  async updateLNFees (tier, chans) {
    return new Promise((resolve, reject) => {
      async.mapSeries(chans, async (chan) => {
        const params = {
          transaction_id: chan.transaction_id,
          transaction_vout: chan.transaction_vout,
          fee_rate: FeeTier.tierToPpmFeeRate(tier)
        }
        await this.api.updateLnRoutingFee(params)
      }, (err, data) => {
        if (err) {
          return reject(err)
        }
        resolve(data)
      })
    })
  }

  // A new channel update has been detected.
  // We save channel updates so later on we can check if we need to change the fee tier of the node
  add (args) {
    // Routing event makes changes to 2 channels. in channel and out channel.
    if (!this._updates.has(args.in_channel)) {
      this._updates.set(args.in_channel, [])
    }
    if (!this._updates.has(args.out_channel)) {
      this._updates.set(args.out_channel, [])
    }

    // We save channel updates in to a map, with channel Id as the key
    const inChan = this._updates.get(args.in_channel)
    inChan.push(this._updates.length - 1)
    this._updates.set(args.in_channel, inChan)
    const outChan = this._updates.get(args.out_channel)
    outChan.push(this._updates.length - 1)
    this._updates.set(args.out_channel, outChan)
  }

  // When the channel list is refreshed, we check the _updates Map and decide if the fee tiers need to be updated.
  async calcTier () {
    // Fee tiers are based on USD, we need to convert all btc values to USD.
    const { price } = await this.api.getBtcUsd()

    // We need to get list of nodes that have had a channel state change since last update
    const nodes = this.lnChannels.getNodeChannelInfo(Array.from(this._updates.keys()))

    const nodeTiers = new Map()

    nodes.forEach((chans, pub) => {
      let totals = {
        total_in: 0,
        total_out: 0,
        total_in_out: 0,
        total_changes: 0
      }
      totals = chans.reduce((totals, ch) => {
        totals.total_in += ch.received
        totals.total_out += ch.sent
        totals.total_changes += ch.past_states
        totals.total_in_out += (ch.sent + ch.received)
        return totals
      }, totals)

      // After calculating total amounts of all the channels of a node, we determine what the fee tier should be.
      const btcTotal = this.api.satsToBtc(totals.total_in_out)
      const tier = LightningPeers.FeeTier.getTierFromAmount(BN(btcTotal).times(price).toNumber())

      nodeTiers.set(pub, { tier, chans })
    })
    return nodeTiers
  }

  initPeerFees (pub) {
    return LightningPeers.newPeer({ public_key: pub })
  }

  async calcFwdHistory (cb) {

    const pCache = new Map()
    FwdEvent.eachEvent({}, async (fwd) => {
      let inGroup
      let outGroup
      try {
        inGroup = await PeerGroup.getGroup(fwd.in_chan_node)
        outGroup = await PeerGroup.getGroup(fwd.out_chan_node)
      } catch(err){
        console.log(err)
      }

      console.log("IN", inGroup)
      console.log("OUT", outGroup)
      if (!inGroup) {
        console.log("Adding new group: ", fwd.in_chan_node)
        await PeerGroup.newGroup({
          nodes: [fwd.in_chan_node],
          fee_tier: LightningPeers.FeeTier.LEVELS[0]
        })
        inGroup = await PeerGroup.getGroup(fwd.in_chan_node)
      }
      if (!outGroup) {
        console.log("Adding new group: ", fwd.out_chan_node)
        await PeerGroup.newGroup({
          nodes: [fwd.out_chan_node],
          fee_tier: LightningPeers.FeeTier.LEVELS[0]
        })
        outGroup = await PeerGroup.getGroup(fwd.out_chan_node)
      }

      inGroup.total_sats_fwd += fwd.amount
      inGroup.total_usd_fwd += fwd.usd_amount
      // await PeerGroup.updateGroup(inGroup._id, inGroup)
      // await PeerGroup.updateGroup(inGroup._id, outGroup)
    })
  }

  _addPeerGroup(nodes){
    return PeerGroup.newGroup({
      nodes,
      fee_tier: LightningPeers.FeeTier.LEVELS[0]
    })
  }

  async syncFwdEvents (cb) {
    const addEvent = async (fwds, pubkey) => {
      for (let x = 0; x < fwds.length; x++) {
        const fwd = fwds[x]
        const inNode = await this.lnChannels.getNodeOfChannel(fwd.incoming_channel)
        const outNode = await this.lnChannels.getNodeOfChannel(fwd.outgoing_channel)
        const { price } = await this.api.getBtcUsd({ts:fwd.created_at})

        const usdAmount = BN(this.api.satsToBtc(fwd.tokens)).times(price).toNumber()
        const usdFee = BN(this.api.satsToBtc(fwd.fee)).times(price).toNumber()

        await FwdEvent.addEvent({
          in_chan: fwd.incoming_channel,
          in_chan_node: outNode,
          out_chan: fwd.outgoing_channel,
          out_chan_node: inNode,
          fee: fwd.fee,
          amount: fwd.tokens,
          routed_at: new Date(fwd.created_at).getTime(),
          node_public_key: pubkey,
          usd_amount: usdAmount,
          usd_fee: usdFee
        })
        
        const outGroup = await PeerGroup.getGroup(outNode)
        const inGroup = await PeerGroup.getGroup(inNode)

        if(!outGroup){
          await this._addPeerGroup([outGroup])
          outGroup = await PeerGroup.getGroup(outNode)
        }

        if(!inGroup){
          await this._addPeerGroup([inGroup])
          inGroup = await PeerGroup.getGroup(inNode)
        }

        inGroup.total_sats_fwd += fwd.tokens
        inGroup.total_sats_fee += fwd.fee

        inGroup.total_usd_fwd += usdAmount
        inGroup.total_usd_fee += usdFee
        
        await PeerGroup.updateGroup(outGroup._id, outGroup)
        await PeerGroup.updateGroup(inGroup._id, inGroup)
      }
    }

    const latestForward = await FwdEvent.latestEvent()

    const query = {}
    if (latestForward.length > 0) {
      query.after = new Date(new Date(latestForward.pop().routed_at).getTime() + 1000)
      query.before = new Date()
    }
    const getForwards = promisify(this.api.getForwards.bind(this))
    const forwards = await getForwards(null, { limit: 2, ...query })
    async.eachOf(forwards, async (node, name) => {
      let { forwards, next } = node.data
      await addEvent(forwards, node.node_public_key)
      while (next) {
        const data = await getForwards(name, { token: next })
        await addEvent(data.forwards, node.node_public_key)
        if (!data.next) break
        next = data.next
      }
    }, cb)
  }
}

module.exports = TierManager

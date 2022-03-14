'use strict'
const { EventEmitter } = require('events')
const LightningPeers = require('./LightningPeers')
const FeeTier = require('./FeeTier')
const Bignumber = require('bignumber.js')
const async = require('async')

// This class is used for fetching list of channels and processing into useful format
class LnChannels extends EventEmitter {
  constructor (api) {
    super()
    this.api = api
    this._updateChannelList()
    this._channel_timer = setInterval(() => {
      this._updateChannelList()
    }, 5000)
  }

  async _updateChannelList () {
    this._channels_loading = true
    await this._processChannels()
    this._channels_loading = false
  }

  async _processChannels () {
    const channelArr = await this.api.getChannels()

    // currentChannels holds list of channels keyed by channel id
    this.currentChannels = new Map()

    // nodes is a map that holds channels keyed by the remote node id
    this.nodes = new Map()
    
    if(!channelArr) return 
    
    channelArr.forEach((ch) => {
      this.currentChannels.set(ch.id, ch)
      if (!this.nodes.has(ch.partner_public_key)) {
        this.nodes.set(ch.partner_public_key, [])
      }
      const nodeChans = this.nodes.get(ch.partner_public_key)
      nodeChans.push(ch)
      this.nodes.set(ch.partner_public_key, nodeChans)
    })
    this.emit('channels_updated')
  }

  // Given an array of channel ids, return the nodes and all of their channels
  getNodeChannelInfo (channelIds) {
    const info = new Map()
    channelIds.forEach((chanId) => {
      const chan = this.currentChannels.get(chanId)
      if (info.has(chan.partner_public_key)) return
      const chans = this.nodes.get(chan.partner_public_key)
      info.set(chan.partner_public_key, chans)
    })
    return info
  }
}

// TierManager is in charge of calculating and deciding the fee tier of a node
class TierManager {
  constructor (lnChannels, api) {
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
      const dbPeer = await LightningPeers.getPeer(pub)
      if (!dbPeer) return
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
      const tier = FeeTier.getTierFromAmount(Bignumber(btcTotal).times(price).toNumber())

      nodeTiers.set(pub, { tier, chans })
    })
    return nodeTiers
  }
}

module.exports = class RouteManager {
  constructor (config = {}, api) {
    this.config = config.bitcoin_node
    this.api = api

    this.lnChannels = new LnChannels(api)
    this.lnChannels.once('channels_updated', () => {
      this.tierManager = new TierManager(this.lnChannels, this.api)
    })

    //TODO record all current peers on launch
  }

  // A new routing event has been detected, we start
  newHtlcForward (args, cb) {
    cb(null)

    if (args.is_send) {
      return this.handleOutgoing(args)
    }

    if (args.is_receive) {
      return this.handleIncoming(args)
    }

    if (args.is_confirmed) {
      this.handleConfirmedRoute(args)
    }
  }

  // A routing event has completed, we save this event to our tier manager to update it at later point
  async handleConfirmedRoute (args) {
    this.tierManager.add(args)
  }

  // Process channel opening requets
  async newChannelRequest (chan, cb) {
    console.log('New Channel Request:')
    console.log(`ID: ${chan.id}`)
    console.log(`Capacity: ${chan.capacity}`)
    console.log(`Remote Node: ${chan.partner_public_key}`)
    // We need to check if the node's capacity is aligned with our AML requirements.
    const remoteBalance = chan.capacity - chan.local_balance
    let amlCheck
    try {
      amlCheck = await this.api.amlFiatCapactyCheck({
        node_public_key: chan.partner_public_key,
        node_socket: chan.peer_info ? chan.peer_info.socket : "",
        order: {
          remote_balance: remoteBalance,
          local_balance: chan.local_balance
        }
      })
    } catch (err) {
      // By default we reject channels.
      console.log('Failed to check AML. Rejecting channel')
      console.log(err)
      this.api.alertSlack('error', 'router', 'Failed to check aml on channel request')
      cb(null, { accept: false })
      return LightningPeers.channelRejected(chan.partner_public_key,{
        reason: err.message || "Error checking aml"
      })
    }

    // We accept channels only if AML is ok
    if (amlCheck.aml_pass === true) {
      this.api.alertSlack('info', 'router', `New channel from ${ch.partner_public_key} - Capacity: ${chan.capacity}`)
      return cb(null, { accept: true })
    }
    this.api.alertSlack('info', 'router', 'channel rejected '+amlCheck.reason)
    cb(null, { accept: false, reason: amlCheck.reason })
    LightningPeers.channelRejected(chan.partner_public_key,{ reason: amlCheck.reason })
  }

  // Record peer informationa and create/update node's profile
  newPeerEvent ({ event, peer }, cb) {
    cb(null)
    console.log('New Peer Event', event, peer.public_key)

    if (event === 'connected') {
      this.peerConnected(peer)
    }
    if (event === 'disconnected') {
      this.peerDisonnected(peer)
    }
  }

  // A peer has disconnected, we perform an update to it's profile
  peerDisonnected (peer) {
    LightningPeers.peerDisonnected(peer.public_key)
  }

  // When a peer connects, we determine if we have seen this node before or not.
  // If we have seen it, we update it's profile
  // If it's a new node, we create a profile
  async peerConnected (peer) {
    try {
      const dbPeer = await LightningPeers.getPeer(peer.public_key)
      if (!dbPeer) {
        LightningPeers.newPeer(peer)
      } else {
        LightningPeers.peerConnected(peer.public_key)
      }
    } catch (err) {
      console.log('Failed to process connected peer')
      throw new Error(err)
    }
  }
}

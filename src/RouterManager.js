'use strict'
const LightningPeers = require('./LightningPeers')
const TierManager = require('./TierManager')
const LnChannels = require("./LnChannels")
const { EventEmitter } = require('events')

module.exports = class RouteManager extends EventEmitter {
  constructor (config = {}, api) {
    super()
    this.config = config
    this.api = api

    this.lnChannels = new LnChannels(api)
    this.lnChannels.once('channels_updated', () => {
      this.tierManager = new TierManager(config, this.lnChannels, this.api)
      this.emit("ready")
    })
  }

  // A new routing event has been detected, we start
  newHtlcForward (args, cb) {
    cb(null)

    if (args.is_send) {
      // return this.handleOutgoing(args)
    }

    if (args.is_receive) {
      // return this.handleIncoming(args)
    }

    if (args.is_confirmed) {
      this.handleConfirmedRoute(args)
    }
  }

  // A routing event has completed, we save this event to our tier manager to update it at later point
  async handleConfirmedRoute (args) {
// this.tierManager.add(args)
  }

  // Process channel opening requets
  async newChannelRequest (chan, cb) {
    if (this.config.node_whitelist.includes(chan.partner_public_key)) {
      this.api.alertSlack('info', 'router', `New channel from whitelisted node ${chan.partner_public_key} - Capacity: ${chan.capacity}`)
      return cb(null, { accept: true })
    }
    console.log('New Channel Request:')
    console.log(`ID: ${chan.id}`)
    console.log(`Capacity: ${chan.capacity}`)
    console.log(`Remote Node: ${chan.partner_public_key}`)
    // We need to check if the node's capacity is aligned with our AML requirements.
    const remoteBalance = chan.capacity - chan.local_balance
    this.api.onNewChannelRequest({
      action:"channel_opening_request",
      node_public_key: chan.partner_public_key,
      node_socket: chan.peer_info ? chan.peer_info.socket : '',
      order: {
        remote_balance: remoteBalance,
        local_balance: chan.local_balance
      }
    }, (err, amlCheck) => {
      if (err) {
        console.log('FAILED_TO_CHECK_CHANNEL_REQUEST')
        cb(err)
        this.api.alertSlack('error', 'router', 'Failed to check aml on channel request')
        return
      }

      // We accept channels only if AML is ok
      if (amlCheck.aml_pass === true) {
        this.api.alertSlack('info', 'router', `New channel from ${chan.partner_public_key} - Capacity: ${chan.capacity}`)
        return cb(null, { accept: true })
      }

      this.api.alertSlack('info', 'router', 'channel rejected ' + amlCheck.reason)
      cb(null, { accept: false, reason: amlCheck.reason })
      LightningPeers.channelRejected(chan.partner_public_key, { reason: amlCheck.reason })
    })
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

  async syncFwdEvents(cb){
    return this.tierManager.syncFwdEvents(cb)
  }
  
  async calcFwdHistory(cb){
    return this.tierManager.calcFwdHistory(cb)
  }
}

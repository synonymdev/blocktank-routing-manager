// This class is used for fetching list of channels and processing into useful format
'use strict'
const { EventEmitter } = require('events')

class LnChannels extends EventEmitter {
  constructor (api) {
    super()
    this.api = api
    this._updateChannelList()
    this._channel_timer = setInterval(() => {
      this._updateChannelList()
    }, 5000)
  }

  async getNodeOfChannel(chanId){
    let chan = this.currentChannels.get(chanId)
    if (chan) {
      return chan.partner_public_key
    }
    chan = await this.api.getNodeOfClosedChannel(chanId)
    return chan.public_key
  }

  addForward(fwds){
    if(!Array.isArray(fwds)) { 
      fwds = [fwds]
    }

    fwds.forEach((fwd)=>{
      const inChan  = this.currentChannels.get(fwd.incoming_channel)
      const outChan  = this.currentChannels.get(fwd.outgoing_channel)

      if(inChan){
        if(!inChan.fwds){
          inChan.fwds = []
        }
        inChan.fwds.push(fwd)
        this.currentChannels.set(fwd.incoming_channel, inChan)
      }

      if(outChan){
        if(!outChan.fwds){
          outChan.fwds = []
        }
        outChan.fwds.push(fwd)
        this.currentChannels.set(fwd.outgoing_channel, outChan)
      }
    })
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

    if (!channelArr) return

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

  getAllNodes(){
    const keys  = []
    this.currentChannels.forEach((chan)=>{
      if(keys.includes(chan.partner_public_key)) return
      keys.push(chan.partner_public_key)
    })
    return keys
  }

  // Given an array of channel ids, return the nodes and all of their channels
  getNodeChannelInfo (channelIds) {
    const info = new Map()
    channelIds.forEach((chanId) => {
      const chan = this.currentChannels.get(chanId)
      if (!chan || info.has(chan.partner_public_key)) return
      const chans = this.nodes.get(chan.partner_public_key)
      info.set(chan.partner_public_key, chans)
    })
    return info
  }
}

module.exports = LnChannels
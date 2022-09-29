/* eslint-env mocha */
'use strict'
process.env.NODE_ENV = 'test'
const BN = require('bignumber.js')
const assert = require('assert')
const Worker = require('../src/Worker')
const { promisify } = require('util')
const nodeman = require('blocktank-worker-ln')
const LnWorker = require('blocktank-worker-ln/src/Worker')
const FwdEvent = require('../src/FwdEvent')
const PeerGroups = require('../src/PeerGroups')
const regtest = require("blocktank-dev-net")
const { FeeTier } = require('../src/LightningPeers')

function random (min, max) {
  return Math.floor(Math.random() * (max - min) + min)
}

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const worker = null
const nodes = { carol: null, dave: null }
let hubNode  = null

async function setupLN (name, opts) {
  console.log('Setting up LN client')
  const config = {
    ln_nodes: [opts], 
    events : {
      htlc_forward_event: [],
      channel_acceptor: [],
      peer_events: []
    }
  }
  return new Promise((resolve, reject) => {
    nodes[name] = nodeman(config)
    nodes[name].start((err) => {
      if (err) throw err
      nodes[name].info = nodes[name].nodes[0].info
      resolve()
    })
  })
}

const newInvoice = promisify(function (node, amount, cb) {
  console.log(`Creating new Invoice via ${node} - ${amount} sats`)
  nodes[node].callAction('createInvoice', null, [{ amount, expiry: Date.now() + 300000 }], cb)
})
const pay = promisify(function (node, invoice, cb) {
  console.log(`Paying invoice via ${node}`)
  nodes[node].callAction('pay', null, [{ invoice }], cb)
})

const createWorker = promisify(function (config, cb) {
  Worker.prototype.getBtcUsd = (args,cb)=>{
    return {price : config.price || 1000000}
  }
  const worker = new Worker({})
  worker.start()
  worker.router.on("ready",()=>{
    cb(null, worker)
  })
})

const dropFwdDb = promisify(function dropFwdDb (cb) {
  const fwd = new FwdEvent()
  fwd.on('ready', async () => {
    try {
      const z = await fwd.db.LightningFwdEvent.drop()
    } catch (err) {
    }
    cb()
  })
})
const dropPeerGroups = promisify(function dropFwdDb (cb) {
  const fwd = new PeerGroups()
  fwd.on('ready', async () => {
    try {
      const z = await fwd.db.LightningPeerGroups.drop()
    } catch (err) {
      console.log(err)
    }
    cb()
  })
})

function getPeerGroup(pk){
  return PeerGroups.getGroup(pk)
}

describe('End to end test', async function () {
  before(async function () {
    this.timeout(100000)
    console.log('Setting up lightning cluster')
    const {nodes,hub, kill} = await regtest.getOrCreateHub(2)
    console.log("Settings up hub")
    hubNode = new LnWorker({
      port: 9881,
      ln_nodes: [{
        cert: hub.cert,
        macaroon: hub.macaroon,
        socket: hub.rpc_socket,
        node_type: 'LND',
        node_name: 'lnd'
      }]
    })
    console.log("Starting hub node")
    await promisify(hubNode.start.bind(hubNode))()
    console.log("Started hub node")
    
    console.log("Settings up spokes")
    await setupLN('carol', {
      cert: nodes[1].cert,
      macaroon: nodes[1].macaroon,
      socket: nodes[1].rpc_socket,
      node_type: 'LND',
      node_name: 'lnd'
    })
    await setupLN('dave', {
      cert: nodes[2].cert,
      macaroon: nodes[2].macaroon,
      socket: nodes[2].rpc_socket,
      node_type: 'LND',
      node_name: 'lnd'
    })

    const invoice = await newInvoice('carol', 1)
    const dPay = await pay('dave', invoice.request)
    console.log("Finished setting up LN")
  })

  after(async ()=>{
  })

  it('Should sync forward events', async function () {
    // Send between nodes
    // record amount
    // call sync node
    // make sure its there
    this.timeout(5000000)
    await dropFwdDb()
    const worker = await createWorker({})
    await promisify(worker.syncFwdEvents)()
    let prevCarolGroup = await getPeerGroup(nodes.carol.info.pubkey)
    let prevDaveGroup = await getPeerGroup(nodes.dave.info.pubkey)
    const invoiceAmount = random(1, 1000)
    const invoice = await newInvoice('carol', invoiceAmount)
    const dPay = await pay('dave', invoice.request)
    const [inHop] = dPay.payment.hops
    if (!dPay.is_confirmed) throw new Error('Payment hasnt confirmed')
    console.log('Waiting for payment to confirm')
    await sleep(3000)
    console.log('Syncing events to db')
    await promisify(worker.syncFwdEvents)()
    const event = (await FwdEvent.latestEvent()).pop()
    assert(event.amount === invoice.tokens)
    assert(event.fee === dPay.payment.fee)
    assert(event.in_chan_node === nodes.dave.info.pubkey)
    assert(event.in_chan === inHop.channel)
    let currentCarolGroup = await getPeerGroup(nodes.carol.info.pubkey)
    let currentDaveGroup = await getPeerGroup(nodes.dave.info.pubkey)
    assert(currentCarolGroup.total_sats_fwd === prevCarolGroup.total_sats_fwd + invoiceAmount)
    assert(currentDaveGroup.total_sats_fwd === prevDaveGroup.total_sats_fwd + invoiceAmount)
    worker.stopWorker()
  })


  it('Syncing multiple times should not change balance', async function () {
    this.timeout(5000000)
    await dropPeerGroups()
    await dropFwdDb()
    const worker = await createWorker({})
    await promisify(worker.syncFwdEvents)()
    let prevCarolGroup = await getPeerGroup(nodes.carol.info.pubkey)
    await promisify(worker.syncFwdEvents)()
    await promisify(worker.syncFwdEvents)()
    await promisify(worker.syncFwdEvents)()
    let currentCarolGroup = await getPeerGroup(nodes.carol.info.pubkey)
    assert(JSON.stringify(currentCarolGroup) === JSON.stringify(prevCarolGroup))
    worker.stopWorker()
  })

  it('Increase fee tier', async function () {
    this.timeout(5000000)
    await dropPeerGroups()
    await dropFwdDb()
    const worker = await createWorker({})
    await promisify(worker.syncFwdEvents)()
    const prevPg = await getPeerGroup(nodes.carol.info.pubkey)
    const hubLn = hubNode.ln.getNode()
    const event = (await promisify(hubNode.ln.getForwards.bind(hubNode.ln))(hubLn,{limit:1})).forwards.pop()
    event.created_at = new Date().toISOString()
    event.tokens = (new BN(FeeTier.nextTierAmount(prevPg.total_usd_fwd)).dividedBy((await worker.getBtcUsd()).price)).times(100000000).toNumber()
    await worker.router.tierManager.addEvent([event],hubLn.info)
    const currentPg = await getPeerGroup(nodes.carol.info.pubkey)
    const prevIndex = FeeTier.tierIndex(prevPg.routing_fee_tier)
    const currentIndex= FeeTier.tierIndex(currentPg.routing_fee_tier)
    assert(prevIndex === 0)
    assert( currentIndex === 1)
    assert(!FeeTier.isSame(currentPg.routing_fee_tier,prevPg.routing_fee_tier))
    worker.stopWorker()
  })

})

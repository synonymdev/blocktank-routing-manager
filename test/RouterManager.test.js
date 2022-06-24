/* eslint-env mocha */
'use strict'
const assert = require('assert')
const Worker = require('../src/Worker')
const { promisify } = require('util')
const nodeman = require('blocktank-worker-ln')
const FwdEvent = require('../src/FwdEvent')

function random (min, max) {
  return Math.floor(Math.random() * (max - min) + min)
}

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
// Lightning node config
const carolConfig = {
  ln_nodes: [{
    cert: '/Users/reza/.polar/networks/3/volumes/lnd/carol/tls.cert',
    macaroon: '/Users/reza/.polar/networks/3/volumes/lnd/carol/data/chain/bitcoin/regtest/admin.macaroon',
    socket: '127.0.0.1:10003',
    node_type: 'LND',
    node_name: 'lnd'
  }],
  events: {
    htlc_forward_event: [],
    channel_acceptor: [],
    peer_events: []
  }
}

const daveConfig = {
  ln_nodes: [{
    cert: '/Users/reza/.polar/networks/3/volumes/lnd/bob/tls.cert',
    macaroon: '/Users/reza/.polar/networks/3/volumes/lnd/bob/data/chain/bitcoin/regtest/admin.macaroon',
    socket: '127.0.0.1:10002',
    node_type: 'LND',
    node_name: 'lnd'
  }],
  events: {
    htlc_forward_event: [],
    channel_acceptor: [],
    peer_events: []
  }
}
const worker = null
const nodes = { carol: null, dave: null }

function setupLN (name, config) {
  console.log('Setting up LN client')
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
  console.log(`Creating new Invoice via ${node}`)
  nodes[node].callAction('createInvoice', null, [{ amount, expiry: Date.now() + 300000 }], cb)
})
const pay = promisify(function (node, invoice, cb) {
  console.log(`Paying invoice via ${node}`)
  nodes[node].callAction('pay', null, [{ invoice }], cb)
})

const createWorker = promisify(function (cb) {
  const worker = new Worker({})
  worker.start()
  cb(null, worker)
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

describe('End to end test', async function () {
  before(async function () {
    this.timeout(10000)
    console.log('Setting up libs')
    await setupLN('carol', carolConfig)
    await setupLN('dave', daveConfig)
  })

  it('Should sync forward events', async function () {
    // Send between nodes
    // record amount
    // call sync node
    // make sure its there
    this.timeout(50000)
    const worker = await createWorker()
    const invoice = await newInvoice('carol', random(1, 1000))
    const dPay = await pay('dave', invoice.request)
    if (!dPay.is_confirmed) throw new Error('Payment hasnt confirmed')
    console.log('Waiting for payment to confirm')
    await sleep(3000)
    console.log('Syncing events to db')
    await promisify(worker.syncFwdEvents)()
    console.log('Getting latest db event')
    const event = (await FwdEvent.latestEvent()).pop()
    assert(event.amount === invoice.tokens)
    assert(event.in_chan_node === nodes.carol.info.pubkey)
    assert(event.out_chan_node === nodes.dave.info.pubkey)
    console.log('done')
  })

  it('should calculate fee tier', async function () {
    this.timeout(50000)
    await dropFwdDb()
    const worker = await createWorker()
    const { price } = await promisify(worker.getBtcUsd.bind(worker))({ ts: Date.now() })
    if (!price) throw new Error('Failed to get price')
    await sleep(3000)
    await promisify(worker.syncFwdEvents)()
    await worker.calcFwdHistory()
  })
})

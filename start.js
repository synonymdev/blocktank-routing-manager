'use strict'
const Server = require('./src/Worker')
const ln = new Server({})
ln.start()

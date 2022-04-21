'use strict'
const BN = require('bignumber.js')

class FeeTier {
  static LEVELS = [
    [0,(5000-1), 1],
    [5000,(250000-1), 0.8],
    [250000,(500000-1), 0.6],
    [500000,(750000-1), 0.4],
    [750000,(1000000-1), 0.2],
    [1000000, Number.MAX_SAFE_INTEGER, 0.01],
  ]

  constructor(param){
    this.min = param[0]
    this.max = param[1]
    this.fee_pcnt = param[2]
  }

  static getTierFromAmount(amount){
    for (const tier of FeeTier.LEVELS) {
      const [min, max] = tier
      if(amount >= min && amount <= max) return tier
    }
  }

  static isSame(t1,t2){
    return t1.toString() === t2.toString()
  }

  static tierToPpmFeeRate(tier){
    const pcnt = tier[2]
    const rate = new BN(pcnt).times(100000).toString()
    return rate
  }
}

module.exports = FeeTier

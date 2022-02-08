'use strict'
const BN = require('bignumber.js')

class FeeTier {
  static LEVELS = [
    [0,5000, 0.1],
    [5000,250000, 0.8],
    [250000,500000, 0.8],
    [500000,750000, 0.6],
    [750000,1000000, 0.4],
    [1000000, Number.MAX_SAFE_INTEGER, 0.01],
  ]
  constructor(param){
    this.min = param[0]
    this.max = param[1]
    this.fee_pcnt = param[1]
  }

  static getTierFromAmount(amount){
    for (const tier of FeeTier.LEVELS) {
      const [min, max] = tier
      if(amount >= min && amount < max) return tier
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

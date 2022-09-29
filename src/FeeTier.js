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
      if(new BN(amount).gte(min) && new BN(amount).lte(max)) return tier
    }
  }

  static isSame(t1,t2){
    return t1.toString() === t2.toString()
  }
  
  static tierIndex(tier){
    const amount = tier[0]
    for(let x = 0; x <= FeeTier.LEVELS.length; x++){
      const [min, max] = FeeTier.LEVELS[x]
      if(new BN(amount).gte(min) && new BN(amount).lte(max)) return x
    }
  }

  static nextTierAmount(amount){
    for(let x = 0; x <= FeeTier.LEVELS.length; x++){
      const [min, max] = FeeTier.LEVELS[x]
      if(x === FeeTier.LEVELS.length-1) return Number.MAX_SAFE_INTEGER
      if(new BN(amount).gte(min) && new BN(amount).lte(max)) {
        const nextTier = FeeTier.LEVELS[x+1]
        return nextTier[0] - amount
      }
    }
    throw new Error("FAILED_TO_GET_FEE_TIER")
  }

  static tierToPpmFeeRate(tier){
    const pcnt = tier[2]
    return this.pcntToPpm(pcnt)
  }

  static ppmToPcnt(ppm){
    return new BN(ppm).dividedBy(10000).toNumber()
  }

  static pcntToPpm(pcnt){
    return new BN(pcnt).times(10000).toNumber()
  }
}

module.exports = FeeTier
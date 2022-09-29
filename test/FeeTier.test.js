/* eslint-env mocha */
'use strict'
const assert = require('assert')
const FeeTier = require('../src/FeeTier')

describe('Fee Tier', () => {
  it('Fee tiers are not repeated', () => {
    const tiers = FeeTier.LEVELS.flat()
    const dups = tiers.filter((t, index) => tiers.indexOf(t) !== index)
    assert(dups.length === 0)
  })

  it('Fee tiers are valid numbers', () => {
    FeeTier.LEVELS.forEach((tier) => {
      const t = new FeeTier(tier)
      assert(Number.isInteger(t.min))
      assert(Number.isInteger(t.max))
      assert(!Number.isNaN(+t.fee_pcnt))
    })
  })

  describe('isSame', () => {
    it('Should return true when tiers are same', () => {
      assert(FeeTier.isSame(FeeTier.LEVELS[0], FeeTier.LEVELS[0]))
    })
    it('Should return false when tiers are same', () => {
      assert(!FeeTier.isSame(FeeTier.LEVELS[0], FeeTier.LEVELS[1]))
    })
  })

  describe('tierToPpmFeeRate', () => {
    
    it("ppmToPcnt",()=>{
      const pcnt = FeeTier.ppmToPcnt(1)
      assert(pcnt === 0.0001)
    })
    it("pcntToPpm",()=>{
      const pcnt = FeeTier.pcntToPpm(1)
      assert(pcnt === 10000)
    })
    it('tierToPpmFeeRate', () => {
      const res = FeeTier.tierToPpmFeeRate(FeeTier.LEVELS[0])
      assert(res === 10000)
    })
  })

  describe('nextTierAmount', () => {
    it('should get next tier amount', () => {
      const t = FeeTier.LEVELS[0]
      const amt = FeeTier.nextTierAmount(t[1])
      assert(amt === 1)
    })
    it('should get next tier amount for max amount', () => {
      const t = FeeTier.LEVELS[5]
      const amt = FeeTier.nextTierAmount(10000000000)
      assert(amt === Number.MAX_SAFE_INTEGER)
    })
  })

  describe('Fee Tier Class', () => {
    it('is able to parse tier array', () => {
      const t = FeeTier.LEVELS[0]
      const f = new FeeTier(t)
      assert(f.min === t[0])
      assert(f.max === t[1])
      assert(f.fee_pcnt === t[2])
    })
  })
})

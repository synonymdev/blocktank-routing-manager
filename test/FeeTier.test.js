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
    it('tierToPpmFeeRate', () => {
      const rate = 1 * 100000
      const res = FeeTier.tierToPpmFeeRate(FeeTier.LEVELS[0])
      assert(rate === +res)
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

// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { sparklinePoints } from './sparklinePoints'

describe('sparklinePoints', () => {
  it('returns nothing for an empty series', () => {
    expect(sparklinePoints([], 100, 20)).toBe('')
  })

  it('spans the width and puts the max at the top and the min at the bottom', () => {
    const points = sparklinePoints([0, 5, 10], 100, 20, 2).split(' ').map((pair) => pair.split(',').map(Number))
    expect(points[0]).toEqual([2, 18])
    expect(points[1]).toEqual([50, 10])
    expect(points[2]).toEqual([98, 2])
  })

  it('draws a flat series in the middle and a single point centered', () => {
    expect(sparklinePoints([3, 3], 100, 20)).toBe('2.0,10.0 98.0,10.0')
    expect(sparklinePoints([7], 100, 20)).toBe('50.0,10.0')
  })
})

import { describe, expect, it } from 'vitest'
import { decodeBatteryPercent, getBatteryFillPercent, isLowBatteryPercent } from '../src/core/sensor/bsbt91/BsBt91Battery'

describe('decodeBatteryPercent', () => {
  it.each([
    [414, 100], [413, 95], [406, 95], [405, 90], [402, 90], [401, 85],
    [397, 85], [396, 80], [393, 80], [392, 75], [390, 75], [389, 70],
    [386, 70], [385, 65], [384, 65], [383, 60], [381, 60], [380, 55],
    [376, 55], [375, 50], [373, 50], [372, 45], [370, 45], [369, 40],
    [368, 40], [367, 35], [366, 35], [365, 30], [364, 30], [363, 25],
    [362, 25], [361, 20], [359, 20], [358, 15], [355, 15], [354, 10],
    [350, 10], [349, 5], [342, 5], [341, 0], [0, 0],
  ])('将 Raw %i 解码为 %i%%', (rawValue, percent) => {
    expect(decodeBatteryPercent(rawValue)).toBe(percent)
  })

  it('拒绝不可能由寄存器产生的非法值', () => {
    expect(decodeBatteryPercent(Number.NaN)).toBeNull()
    expect(decodeBatteryPercent(Number.POSITIVE_INFINITY)).toBeNull()
    expect(decodeBatteryPercent(-1)).toBeNull()
    expect(decodeBatteryPercent(391.5)).toBeNull()
  })

  it.each([
    [null, 0, false], [0, 0, true], [5, 5, true], [20, 20, true],
    [21, 21, false], [75, 75, false], [100, 100, false], [150, 100, false], [-4, 0, true],
  ])('将显示值 %s 规范为填充 %i%%，低电量=%s', (percent, fillPercent, low) => {
    expect(getBatteryFillPercent(percent)).toBe(fillPercent)
    expect(isLowBatteryPercent(percent)).toBe(low)
  })
})

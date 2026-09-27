import { describe, expect, it } from 'vitest'
import { formatTile, formatTiles, parseTileInput, splitTokens } from '../src/engine/notation'

describe('牌名解析', () => {
  it('识别数字与汉字写法', () => {
    expect(parseTileInput('5万')).toBe(4)
    expect(parseTileInput('五万')).toBe(4)
    expect(parseTileInput('5m')).toBe(4)
    expect(parseTileInput('5M')).toBe(4)
    expect(parseTileInput('3筒')).toBe(11)
    expect(parseTileInput('三条')).toBe(20)
    expect(parseTileInput('9条')).toBe(26)
  })

  it('识别字牌及其别名', () => {
    expect(parseTileInput('东')).toBe(27)
    expect(parseTileInput('东风')).toBe(27)
    expect(parseTileInput('南')).toBe(28)
    expect(parseTileInput('红中')).toBe(31)
    expect(parseTileInput('发财')).toBe(32)
    expect(parseTileInput('白板')).toBe(33)
  })

  it('容忍手牌显示里的财神与白板标记', () => {
    expect(parseTileInput('4万*')).toBe(3)
    expect(parseTileInput('白^')).toBe(33)
    expect(parseTileInput('东*')).toBe(27)
  })

  it('无法识别时返回 null', () => {
    expect(parseTileInput('随便')).toBeNull()
    expect(parseTileInput('')).toBeNull()
    expect(parseTileInput('10万')).toBeNull()
    expect(parseTileInput('万')).toBeNull()
  })

  it('按分隔符切分多张牌', () => {
    expect(splitTokens('1万 2万,3筒、东')).toEqual(['1万', '2万', '3筒', '东'])
  })
})

describe('手牌文字化', () => {
  it('财神牌与白板带标记', () => {
    const jokerTile = 1
    expect(formatTiles([0, 1, 33, 27], jokerTile)).toBe('1万 2万* 白^ 东')
  })

  it('单张牌文字化', () => {
    expect(formatTile(1, 1)).toBe('2万*')
    expect(formatTile(33, 27)).toBe('白^')
    expect(formatTile(27, 29)).toBe('东')
    // 财神为白板时白板升格为万能牌本体，不再标 ^
    expect(formatTile(33, 33)).toBe('白*')
  })

  it('空手牌显示占位符', () => {
    expect(formatTiles([], 5)).toBe('—')
  })
})

import { describe, expect, it } from 'vitest'
import { sortHand } from '../src/engine/game'
import { normalize } from '../src/engine/joker'
import { legalDiscards, nextFollowHonor } from '../src/engine/rules'
import { calcShanten } from '../src/engine/shanten'
import { toCounts } from '../src/engine/tiles'
import { detectWinType, isStandardWin, WIN_TYPE } from '../src/engine/win'

/** 万 */
const m = (rank: number) => rank - 1
/** 筒 */
const p = (rank: number) => 9 + rank - 1
/** 条 */
const s = (rank: number) => 18 + rank - 1
const EAST = 27
const SOUTH = 28
const WEST = 29
const NORTH = 30
const RED = 31
const GREEN = 32
const WHITE = 33

/** 财神取值不影响牌型时，统一用「北风」这类不在测试手牌里的牌种 */
const IDLE_JOKER = NORTH

describe('手牌排序', () => {
  it('白板归位到财神原牌旁，不落在字牌堆', () => {
    const hand = [WHITE, NORTH, p(1), p(2), p(3)]
    sortHand(hand, p(3))
    expect(hand.indexOf(WHITE)).toBeLessThan(hand.indexOf(NORTH))
    expect(Math.abs(hand.indexOf(WHITE) - hand.indexOf(p(3)))).toBe(1)
  })

  it('财神恰为白板时白板留在字牌区', () => {
    const hand = [WHITE, NORTH, p(1)]
    sortHand(hand, WHITE)
    expect(hand).toEqual([p(1), NORTH, WHITE])
  })
})

function analyze(tiles: number[], jokerTile: number) {
  const { counts, wildcards } = normalize(tiles, jokerTile)
  return { counts, wildcards }
}

function shantenOf(tiles: number[], jokerTile: number, meldCount = 0) {
  const { counts, wildcards } = analyze(tiles, jokerTile)
  return calcShanten(counts, wildcards, meldCount)
}

function winTypeOf(tiles: number[], jokerTile: number, meldCount = 0) {
  const { counts, wildcards } = analyze(tiles, jokerTile)
  return detectWinType(counts, wildcards, meldCount)
}

describe('胡牌判定', () => {
  it('识别无财神的标准牌型', () => {
    const tiles = [
      m(1), m(2), m(3), m(1), m(2), m(3),
      p(4), p(5), p(6),
      s(7), s(8), s(9),
      EAST, EAST, EAST,
      RED, RED,
    ]
    expect(tiles).toHaveLength(17)
    expect(winTypeOf(tiles, IDLE_JOKER)).toBe(WIN_TYPE.STANDARD)
  })

  it('财神牌可补任意缺口', () => {
    const joker = m(5)
    const tiles = [
      m(1), m(2), m(3), m(1), m(2), m(3),
      p(4), p(5), p(6),
      s(7), s(8), s(9),
      EAST, EAST, EAST,
      RED, joker,
    ]
    expect(winTypeOf(tiles, joker)).toBe(WIN_TYPE.STANDARD)
  })

  it('白板等效财神原牌，可补顺子', () => {
    const joker = m(2)
    const tiles = [
      m(1), WHITE, m(3),
      m(1), m(2), m(3),
      p(4), p(5), p(6),
      s(7), s(8), s(9),
      EAST, EAST, EAST,
      RED, RED,
    ]
    expect(winTypeOf(tiles, joker)).toBe(WIN_TYPE.STANDARD)
  })

  it('白板不能充当财神原牌以外的牌', () => {
    const joker = m(2)
    const tiles = [
      m(4), WHITE, m(6),
      p(1), p(2), p(3),
      s(1), s(2), s(3),
      EAST, EAST, EAST,
      SOUTH, SOUTH, SOUTH,
      RED, RED,
    ]
    const { counts, wildcards } = analyze(tiles, joker)
    // 白板折算为二万，凑不出顺子；若能随意当五万则成 456 万
    expect(counts[m(2)]).toBe(1)
    expect(wildcards).toBe(0)
    expect(winTypeOf(tiles, joker)).toBeNull()
  })

  it('财神为白板时，白板升格为万能牌', () => {
    const tiles = [
      m(1), m(2), m(3), m(1), m(2), m(3),
      p(4), p(5), p(6),
      s(7), s(8), s(9),
      EAST, EAST, EAST,
      RED, WHITE,
    ]
    expect(winTypeOf(tiles, WHITE)).toBe(WIN_TYPE.STANDARD)
  })

  it('三财神可直接胡牌', () => {
    const joker = m(5)
    const tiles = [
      joker, joker, joker,
      m(1), m(3), m(7), p(2), p(9),
      s(1), s(4), s(8), EAST, SOUTH, WEST,
      RED, GREEN, WHITE,
    ]
    expect(tiles).toHaveLength(17)
    expect(winTypeOf(tiles, joker)).toBe(WIN_TYPE.THREE_JOKERS)
  })

  it('八对牌型成立', () => {
    const tiles = [
      m(1), m(1), m(3), m(3), m(5), m(5), m(7), m(7),
      p(2), p(2), p(4), p(4), p(6), p(6), p(8), p(8),
      EAST,
    ]
    expect(tiles).toHaveLength(17)
    expect(winTypeOf(tiles, IDLE_JOKER)).toBe(WIN_TYPE.EIGHT_PAIRS)
  })

  it('八对可由财神补足缺张', () => {
    const joker = m(5)
    const tiles = [
      m(1), m(1), m(3), m(3), m(7), m(7),
      p(2), p(2), p(4), p(4), p(6), p(6), p(8), p(8),
      EAST, SOUTH,
      joker,
    ]
    expect(winTypeOf(tiles, joker)).toBe(WIN_TYPE.EIGHT_PAIRS)
  })

  it('副露占用面子配额', () => {
    const tiles = [
      m(1), m(2), m(3), m(1), m(2), m(3),
      p(4), p(5), p(6),
      EAST, EAST,
    ]
    const { counts, wildcards } = analyze(tiles, IDLE_JOKER)
    // 已碰出 2 组时，11 张手牌恰好补 3 组面子 + 1 对将；只碰出 1 组则缺口对不上
    expect(isStandardWin(counts, wildcards, 2)).toBe(true)
    expect(isStandardWin(counts, wildcards, 1)).toBe(false)
  })
})

describe('向听数', () => {
  it('胡牌手牌为 -1 向听', () => {
    const tiles = [
      m(1), m(2), m(3), m(1), m(2), m(3),
      p(4), p(5), p(6),
      s(7), s(8), s(9),
      EAST, EAST, EAST,
      RED, RED,
    ]
    expect(shantenOf(tiles, IDLE_JOKER)).toBe(-1)
  })

  it('听牌手牌为 0 向听', () => {
    const tiles = [
      m(1), m(2), m(3), m(1), m(2), m(3),
      p(4), p(5), p(6),
      s(7), s(8), s(9),
      EAST, EAST,
      m(7), m(8),
    ]
    expect(tiles).toHaveLength(16)
    expect(shantenOf(tiles, IDLE_JOKER)).toBe(0)
  })

  it('孤张手牌按缺口数递增', () => {
    const tiles = [
      m(1), m(2), m(3), m(1), m(2), m(3),
      p(4), p(5), p(6),
      s(7), s(8), s(9),
      EAST, EAST,
      m(7), p(1),
    ]
    expect(shantenOf(tiles, IDLE_JOKER)).toBe(1)
  })

  it('财神可加速牌型推进', () => {
    const joker = m(5)
    const tiles = [
      m(1), m(2), m(3), m(1), m(2), m(3),
      p(4), p(5), p(6),
      s(7), s(8), s(9),
      EAST, EAST,
      m(7), joker,
    ]
    expect(shantenOf(tiles, joker)).toBe(0)
  })

  it('副露后手牌按剩余面子数计算', () => {
    const tiles = [
      m(1), m(2), m(3), m(1), m(2), m(3),
      p(4), p(5), p(6),
      EAST, EAST, EAST,
      RED, RED,
    ]
    expect(tiles).toHaveLength(14)
    // 1 组副露 + 上手 14 张需补 4 组面子 + 1 对将
    const { counts, wildcards } = analyze(tiles, IDLE_JOKER)
    expect(calcShanten(counts, wildcards, 1)).toBe(-1)
  })
})

describe('牌张工具', () => {
  it('计数与牌列表互转', () => {
    const tiles = [m(1), m(1), p(9), EAST]
    const counts = toCounts(tiles)
    expect(counts[m(1)]).toBe(2)
    expect(counts[p(9)]).toBe(1)
    expect(counts[EAST]).toBe(1)
  })
})

describe('有风跟打与财神', () => {
  it('牌河末张为字牌且手中仅一张时必须跟打', () => {
    const hand = [SOUTH, m(1), m(2)]
    expect(nextFollowHonor(SOUTH, EAST, hand)).toBe(SOUTH)
    expect(legalDiscards(hand, SOUTH)).toEqual([SOUTH])
  })

  it('手中成对的字牌不拆对', () => {
    const hand = [EAST, EAST, m(1), m(2)]
    expect(nextFollowHonor(EAST, WEST, hand)).toBeNull()
    expect(legalDiscards(hand, nextFollowHonor(EAST, WEST, hand))).toEqual([EAST, m(1), m(2)])
  })

  it('手中成刻的字牌不拆刻', () => {
    const hand = [EAST, EAST, EAST, m(1)]
    expect(legalDiscards(hand, nextFollowHonor(EAST, WEST, hand))).toEqual([EAST, m(1)])
  })

  it('手中没有该字牌时不受跟打约束', () => {
    expect(nextFollowHonor(SOUTH, EAST, [EAST, m(1), m(2)])).toBeNull()
  })

  it('无跟打目标时自由出牌，字牌也不例外', () => {
    const hand = [EAST, SOUTH, m(1)]
    expect(legalDiscards(hand, nextFollowHonor(null, WEST, hand))).toEqual([EAST, SOUTH, m(1)])
  })

  it('财神不构成跟打目标', () => {
    expect(nextFollowHonor(EAST, EAST, [EAST, m(1)])).toBeNull()
    expect(nextFollowHonor(null, EAST, [EAST])).toBeNull()
    expect(nextFollowHonor(SOUTH, EAST, [SOUTH, m(1)])).toBe(SOUTH)
  })

  it('数牌结尾时跟打约束解除', () => {
    expect(nextFollowHonor(m(1), EAST, [m(1), m(2)])).toBeNull()
  })
})

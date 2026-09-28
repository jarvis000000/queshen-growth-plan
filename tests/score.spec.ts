import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyAnKong,
  applyKong,
  createGame,
  settleDraw,
  settleWin,
  type GameState,
} from '../src/engine/game'
import { normalize } from '../src/engine/joker'
import { MELD_KIND } from '../src/engine/meld'
import { BASE_SCORE, formatScoreLine, PATTERN, scoreWin, shareScore, UNIT, type ScoreResult } from '../src/engine/score'
import { WIN_TYPE } from '../src/engine/win'
import { HUMAN_SEAT, useGameStore } from '../src/stores/game'
import { resetStats } from '../src/stores/stats'

/** 财神固定为白板；除财神相关的用例外所有手牌都不含它，避免万能牌扰动手牌结构 */
const JOKER = 33
const WINNER = 0
const DEALER = 3

/** 清一色 + 硬胡成牌：通吃万1-9，无字牌、无财神 */
const PURE_HAND = [0, 1, 2, 0, 1, 2, 3, 4, 5, 6, 7, 8, 6, 7, 8, 4, 4]
/** 三门混成的普通成牌：既非清一色也非碰碰胡，用于隔离其它倍数 */
const PLAIN_HAND = [0, 1, 2, 9, 10, 11, 18, 19, 20, 6, 7, 8, 15, 16, 17, 4, 4]
/** 对对胡 + 一张财神：四副刻子，万6 两张配财神成刻，万9 作将 */
const PONG_HAND = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 5, 5, JOKER, 8, 8]
/**
 * 主人报例用的软胡牌：万1+财神+万3 与 万5+财神 才成牌，
 * 把财神当白板则拆不出面子，故非硬胡。
 */
const SOFT_HAND = [0, JOKER, 2, 9, 10, 11, 18, 19, 20, 6, 7, 8, 15, 16, 17, 4, JOKER]
/** 软胡牌中的财神张数，用于把财神分从净变化里剥出来 */
const SOFT_JOKER_COUNT = SOFT_HAND.filter((tile) => tile === JOKER).length

interface ScoreOptions {
  selfDraw?: boolean
  dealerStreak?: number
  kongChain?: number
}

/** 只算分不落局，用于逐项核对倍数 */
function scored(hand: number[], options: ScoreOptions = {}): ScoreResult {
  const folded = normalize(hand, JOKER)
  return scoreWin({
    winType: WIN_TYPE.STANDARD,
    counts: folded.counts,
    wildcards: folded.wildcards,
    meldCount: 0,
    jokerTile: JOKER,
    allTiles: hand,
    selfDraw: options.selfDraw ?? false,
    dealerStreak: options.dealerStreak ?? 0,
    kongChain: options.kongChain ?? 0,
  })
}

/**
 * 构造一局并把四家暗牌与副露清空，再放上赢家的成牌。
 * 清空是为了让财神分只取决于用例显式给出的牌，不受牌墙发牌影响。
 */
function blankState(hand: number[], dealer = DEALER, dealerStreak = 0): GameState {
  const state = createGame(() => 0.5, dealer, dealerStreak)
  state.jokerTile = JOKER
  for (const player of state.players) {
    player.hand = []
    player.melds = []
  }
  state.players[WINNER].hand = hand.slice(0, hand.length - 1)
  return state
}

/** 自摸结算：成牌的最后一张作为摸到的那张 */
function settleSelfDraw(hand: number[], dealer = DEALER, dealerStreak = 0): GameState {
  const state = blankState(hand, dealer, dealerStreak)
  settleWin(state, WINNER, null, hand[hand.length - 1], WIN_TYPE.STANDARD)
  return state
}

/** 点炮结算：放炮者由 from 指定 */
function settleDealIn(hand: number[], from: number, dealer = DEALER): GameState {
  const state = blankState(hand, dealer)
  settleWin(state, WINNER, from, hand[hand.length - 1], WIN_TYPE.STANDARD)
  return state
}

function deltasOf(state: GameState): number[] {
  return state.result?.deltas ?? []
}

describe('单局得分（口径算例）', () => {
  it('算例 1：闲家自摸 + 硬胡 + 清一色 = 8 分', () => {
    const score = settleSelfDraw(PURE_HAND).result?.winners[0].score
    expect(score?.patterns).toEqual([
      PATTERN.PING_HU,
      PATTERN.PURE_SUIT,
      PATTERN.SELF_DRAW,
      PATTERN.HARD,
    ])
    expect(score?.multiplier).toBe(8)
    expect(score?.jokerScore).toBe(0)
    expect(score?.total).toBe(8)
  })

  it('算例 2：自摸 + 硬胡 = 4 分', () => {
    const score = settleSelfDraw(PLAIN_HAND).result?.winners[0].score
    expect(score?.patterns).toEqual([PATTERN.PING_HU, PATTERN.SELF_DRAW, PATTERN.HARD])
    expect(score?.total).toBe(4)
  })

  it('算例 3：点炮 + 对对胡（界面标签为碰碰胡）+ 1 财神 = 3 分', () => {
    const score = settleDealIn(PONG_HAND, 1).result?.winners[0].score
    expect(score?.patterns).toEqual([PATTERN.PING_HU, PATTERN.PONG_PONG])
    expect(score?.multiplier).toBe(2)
    expect(score?.jokerScore).toBe(1)
    expect(score?.total).toBe(3)
  })

  it('算例 4：连庄 2 次时自摸 + 硬胡 = 16 分', () => {
    const score = settleSelfDraw(PLAIN_HAND, DEALER, 2).result?.winners[0].score
    expect(score?.multiplier).toBe(16)
    expect(score?.total).toBe(16)
  })

  it('财神分在倍数之外相加，不参与翻倍', () => {
    for (const hand of [PURE_HAND, PLAIN_HAND, PONG_HAND]) {
      const score = scored(hand, { selfDraw: true })
      expect(score.total).toBe(BASE_SCORE * score.multiplier + score.jokerScore)
    }
  })

  it('连庄 n 次按 ×2ⁿ 放大，未连庄不计该项', () => {
    const plain = scored(PLAIN_HAND, { selfDraw: true })
    expect(plain.multipliers.some((item) => item.pattern === PATTERN.DEALER_STREAK)).toBe(false)
    expect(scored(PLAIN_HAND, { selfDraw: true, dealerStreak: 1 }).total).toBe(plain.total * 2)
    expect(scored(PLAIN_HAND, { selfDraw: true, dealerStreak: 2 }).total).toBe(plain.total * 4)
    expect(scored(PLAIN_HAND, { selfDraw: true, dealerStreak: 3 }).total).toBe(plain.total * 8)
    expect(scored(PLAIN_HAND, { selfDraw: true, dealerStreak: 4 }).total).toBe(plain.total * 16)
  })

  it('分数文案列出倍数明细与合计，无财神分时不显示该项', () => {
    expect(formatScoreLine(scored(PURE_HAND, { selfDraw: true }))).toBe(
      '清一色×2 · 硬胡×2 · 自摸×2｜合计 8',
    )
    expect(formatScoreLine(scored(PONG_HAND))).toBe('碰碰胡×2｜财神分 1｜合计 3')
  })

  it('杠开 ×2，二连杠 ×4 且不叠加，三杠封顶', () => {
    const plain = scored(PLAIN_HAND, { selfDraw: true })
    expect(scored(PLAIN_HAND, { selfDraw: true, kongChain: 1 }).multiplier).toBe(plain.multiplier * 2)
    expect(scored(PLAIN_HAND, { selfDraw: true, kongChain: 2 }).multiplier).toBe(plain.multiplier * 4)
    expect(scored(PLAIN_HAND, { selfDraw: true, kongChain: 3 }).multiplier).toBe(plain.multiplier * 4)

    const doubleKong = scored(PLAIN_HAND, { selfDraw: true, kongChain: 2 })
    expect(doubleKong.patterns).toContain(PATTERN.DOUBLE_KONG)
    expect(doubleKong.patterns).not.toContain(PATTERN.KONG_DRAW)
  })
})

describe('分家结算', () => {
  it('算例 1：自摸三家各付一份', () => {
    expect(deltasOf(settleSelfDraw(PURE_HAND))).toEqual([24, -8, -8, -8])
  })

  it('算例 2：底分 1 × 硬胡 2 × 自摸 2 = 4，三家各付 4', () => {
    expect(deltasOf(settleSelfDraw(PLAIN_HAND))).toEqual([12, -4, -4, -4])
  })

  it('算例 3：点炮时三家各付一份，放炮者多付一份罚分', () => {
    // 胡牌：三家各付「对对胡 2」，放炮者再付 2；财神：赢家 1 张向三家各收 1
    expect(deltasOf(settleDealIn(PONG_HAND, 1))).toEqual([11, -5, -3, -3])
  })

  it('主人报例：点炮 + 软胡 + 2 财神，赢家应收 10 分', () => {
    const state = blankState(SOFT_HAND)
    settleWin(state, WINNER, 1, SOFT_HAND[SOFT_HAND.length - 1], WIN_TYPE.STANDARD)
    const score = state.result?.winners[0].score
    expect(score?.multiplier).toBe(1)
    expect(score?.jokerScore).toBe(2)
    // 胡牌：三家各付 1，放炮者再付 1；财神：2 张 × 3 家 = 6
    expect(deltasOf(state)).toEqual([10, -4, -3, -3])
  })

  it('点炮的份数结构：赢家收 4 份、放炮者付 2 份、其余两家各付 1 份', () => {
    const state = blankState(SOFT_HAND)
    settleWin(state, WINNER, 1, SOFT_HAND[SOFT_HAND.length - 1], WIN_TYPE.STANDARD)
    // 软胡无倍数，剥掉财神分后剩下的就是胡牌部分的份数
    const deltas = deltasOf(state)
    const others = deltas.filter((_, seat) => seat !== WINNER)
    const jokerPerSeat = shareScore(UNIT.JOKER) * SOFT_JOKER_COUNT
    const handShares = [deltas[WINNER] - jokerPerSeat * others.length, ...others.map((value) => value + jokerPerSeat)]
    expect(handShares).toEqual([4, -2, -1, -1])
  })

  it('算例 4：连庄 2 次时自摸，三家各付 16', () => {
    expect(deltasOf(settleSelfDraw(PLAIN_HAND, DEALER, 2))).toEqual([48, -16, -16, -16])
  })

  it('每局四家净变化恒为零和', () => {
    const states = [
      settleSelfDraw(PURE_HAND),
      settleSelfDraw(PLAIN_HAND),
      settleDealIn(PONG_HAND, 1),
      settleSelfDraw(PLAIN_HAND, DEALER, 2),
    ]
    for (const state of states) {
      expect(deltasOf(state).reduce((sum, value) => sum + value, 0)).toBe(0)
    }
  })
})

describe('财神分', () => {
  it('各持有者按自己暗牌中的财神数向其他三家各收一份', () => {
    const state = blankState(PONG_HAND)
    // 南暗牌 2 张；西的 3 张财神在副露里，不计
    state.players[1].hand = [JOKER, JOKER]
    state.players[2].melds = [{ kind: MELD_KIND.PONG, tiles: [JOKER, JOKER, JOKER], from: null }]
    settleWin(state, WINNER, 1, PONG_HAND[PONG_HAND.length - 1], WIN_TYPE.STANDARD)
    // 财神：东 1 张收 3 付 2，南 2 张收 6 付 1，西 0 张付 3；胡牌：三家各付 2，南作为放炮者再付 2
    expect(deltasOf(state)).toEqual([9, 1, -5, -5])
  })

  it('财神分与胡牌倍数无关，流局照常结算', () => {
    const state = blankState(PURE_HAND)
    state.players[0].hand = [JOKER, JOKER]
    state.players[3].hand = [JOKER]
    settleDraw(state)
    // 东 2 张收 6 付 1，北 1 张收 3 付 2
    expect(deltasOf(state)).toEqual([5, -3, -3, 1])
  })
})

describe('杠分', () => {
  function kongState(dealer = 0, dealerStreak = 0): GameState {
    const state = createGame(() => 0.5, dealer, dealerStreak)
    state.jokerTile = JOKER
    for (const player of state.players) {
      player.hand = []
      player.melds = []
    }
    return state
  }

  it('明杠：其他三家各付一份，杠家得三份', () => {
    const state = kongState()
    state.players[1].hand = [5, 5, 5, 0, 1, 2]
    state.pending = { tile: 5, from: 0 }
    expect(applyKong(state, 1)).not.toBeNull()
    expect(state.kongPoints).toEqual([-1, 3, -1, -1])
  })

  it('暗杠：其他三家各付两份，杠家得六份', () => {
    const state = kongState()
    state.players[2].hand = [7, 7, 7, 7, 0, 1, 2]
    expect(applyAnKong(state, 2, 7)).not.toBeNull()
    expect(state.kongPoints).toEqual([-2, -2, 6, -2])
  })

  it('杠分是固定值，不随连庄倍数放大', () => {
    const state = kongState(0, 4)
    state.players[1].hand = [5, 5, 5]
    state.pending = { tile: 5, from: 0 }
    applyKong(state, 1)
    expect(state.kongPoints).toEqual([-1, 3, -1, -1])
  })

  it('流局把已结算的杠分与财神分一并并入四家净变化', () => {
    const state = kongState()
    state.players[1].hand = [5, 5, 5]
    state.pending = { tile: 5, from: 0 }
    applyKong(state, 1)
    // 杠后补牌来自牌墙且可能是财神，清空以把杠分与财神分隔离
    for (const player of state.players) {
      player.hand = []
      player.melds = []
    }
    state.players[0].hand = [JOKER]
    settleDraw(state)
    expect(deltasOf(state)).toEqual([2, 2, -2, -2])
  })

  it('杠分、财神分与胡牌结算叠加后仍是零和', () => {
    const state = blankState(PURE_HAND)
    state.players[1].hand = [5, 5, 5]
    state.pending = { tile: 5, from: 0 }
    applyKong(state, 1)
    for (const player of state.players) {
      player.hand = []
      player.melds = []
    }
    state.players[0].hand = PURE_HAND.slice(0, PURE_HAND.length - 1)
    settleWin(state, WINNER, null, PURE_HAND[PURE_HAND.length - 1], WIN_TYPE.STANDARD)
    expect(deltasOf(state)).toEqual([23, -5, -9, -9])
    expect(deltasOf(state).reduce((sum, value) => sum + value, 0)).toBe(0)
  })
})

describe('轮庄与连庄', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetStats()
  })

  /** 直接写入 result 触发结算，绕开完整对局以便精确指定胡牌者 */
  function publishResult(winner: number | null): void {
    const store = useGameStore()
    store.state.result = winner === null
      ? { draw: true, winners: [], deltas: [0, 0, 0, 0] }
      : {
          draw: false,
          winners: [
            {
              seat: winner,
              from: null,
              tile: 0,
              winType: WIN_TYPE.STANDARD,
              score: {
                patterns: [],
                multipliers: [],
                multiplier: 1,
                jokerScore: 0,
                total: 1,
                labels: [],
              },
            },
          ],
          deltas: [0, 0, 0, 0],
        }
  }

  async function flushSettlement(): Promise<void> {
    await nextTick()
    await nextTick()
  }

  it('庄家胡牌则连庄次数加一，庄位不变', async () => {
    const store = useGameStore()
    expect(store.dealer).toBe(HUMAN_SEAT)
    publishResult(store.dealer)
    await flushSettlement()
    expect(store.dealer).toBe(HUMAN_SEAT)
    expect(store.dealerStreak).toBe(1)
  })

  it('闲家胡牌则庄家下庄给下家，连庄归零', async () => {
    const store = useGameStore()
    publishResult((store.dealer + 1) % 4)
    await flushSettlement()
    expect(store.dealer).toBe(1)
    expect(store.dealerStreak).toBe(0)
  })

  it('流局庄位与连庄次数都不变', async () => {
    const store = useGameStore()
    publishResult(null)
    await flushSettlement()
    expect(store.dealer).toBe(HUMAN_SEAT)
    expect(store.dealerStreak).toBe(0)
  })

  it('结算文案按东南西北列出四家净变化', async () => {
    const store = useGameStore()
    store.state.result = {
      draw: false,
      winners: [
        {
          seat: WINNER,
          from: null,
          tile: 0,
          winType: WIN_TYPE.STANDARD,
          score: { patterns: [], multipliers: [], multiplier: 1, jokerScore: 0, total: 7, labels: [] },
        },
      ],
      deltas: [7, 0, 0, -7],
    }
    await flushSettlement()
    expect(store.settlementText).toBe('东+7  南0  西0  北-7')
  })
})

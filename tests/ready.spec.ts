import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { canDeclareReady } from '../src/engine/game'
import { HUMAN_SEAT, useGameStore } from '../src/stores/game'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 轮询等待条件成立：建议计算会阻塞主线程，固定延时在负载高时不可靠 */
async function waitUntil(cond: () => boolean, timeout = 8000): Promise<void> {
  const deadline = Date.now() + timeout
  while (!cond() && Date.now() < deadline) await delay(20)
}

/** 听 3筒 / 6筒 的 16 张手牌：四组顺子 + 一对东 + 4筒5筒搭子 */
const TENPAI_HAND = [0, 1, 2, 3, 4, 5, 9, 10, 11, 18, 19, 20, 27, 27, 12, 13]
/** 同为 16 张但散乱，尚未听牌 */
const SCATTERED_HAND = [0, 2, 4, 8, 9, 11, 15, 18, 20, 22, 26, 27, 30, 31, 32, 28]

/** 财神固定为白板，测试手牌不含它，避免万能牌把散牌也折算成听牌 */
const JOKER = 33

describe('报听：可否报听', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('手牌听牌时可报听', () => {
    const store = useGameStore()
    store.state.jokerTile = JOKER
    store.state.players[HUMAN_SEAT].hand = [...TENPAI_HAND]
    expect(canDeclareReady(store.state, HUMAN_SEAT)).toBe(true)
  })

  it('尚未听牌时不可报听', () => {
    const store = useGameStore()
    store.state.jokerTile = JOKER
    store.state.players[HUMAN_SEAT].hand = [...SCATTERED_HAND]
    expect(canDeclareReady(store.state, HUMAN_SEAT)).toBe(false)
  })

  it('已报听后不可重复报听', () => {
    const store = useGameStore()
    store.state.jokerTile = JOKER
    store.state.players[HUMAN_SEAT].hand = [...TENPAI_HAND]
    store.state.players[HUMAN_SEAT].declaredReady = true
    expect(canDeclareReady(store.state, HUMAN_SEAT)).toBe(false)
  })
})

describe('报听：状态与约束', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  /** 伪造一个已听牌的手牌与一个打开的响应提示，用来验证 declareReady 的接线 */
  function readyUp() {
    const store = useGameStore()
    store.state.jokerTile = JOKER
    store.state.players[HUMAN_SEAT].hand = [...TENPAI_HAND]
    store.claimPrompt = { options: [], tile: 27, canDeclareReady: true }
    return store
  }

  it('declareReady 置位报听并关闭响应提示', () => {
    const store = readyUp()
    store.declareReady()
    expect(store.human.declaredReady).toBe(true)
    expect(store.claimPrompt).toBeNull()
  })

  it('报听期间合法出牌只剩刚摸的那张', () => {
    const store = readyUp()
    store.declareReady()
    const player = store.state.players[HUMAN_SEAT]
    const drawn = player.hand[0]
    player.drawnTile = drawn
    expect([...store.legalTiles]).toEqual([drawn])
  })

  it('报听后随时可取消，出过牌也不关闭窗口', () => {
    const store = readyUp()
    store.declareReady()
    expect(store.canCancelReady).toBe(true)
    store.state.players[HUMAN_SEAT].discards.push(0)
    expect(store.canCancelReady).toBe(true)
  })

  it('cancelReady 撤销报听', () => {
    const store = readyUp()
    store.declareReady()
    store.cancelReady()
    expect(store.human.declaredReady).toBe(false)
  })

  it('取消后手牌解锁，恢复常规出牌范围', () => {
    const store = readyUp()
    store.declareReady()
    store.state.players[HUMAN_SEAT].drawnTile = 21
    expect([...store.legalTiles]).toEqual([21])
    store.cancelReady()
    expect([...store.legalTiles].length).toBeGreaterThan(1)
  })

  it('对局结束后不可取消', () => {
    const store = readyUp()
    store.declareReady()
    store.state.result = { draw: true, winners: [], deltas: [0, 0, 0, 0] }
    expect(store.canCancelReady).toBe(false)
    store.cancelReady()
    expect(store.human.declaredReady).toBe(true)
  })

  it('无响应提示时报听无效', () => {
    const store = readyUp()
    store.claimPrompt = null
    store.declareReady()
    expect(store.human.declaredReady).toBe(false)
  })
})

// 建议计算会阻塞主线程，机器繁忙时单个用例耗时远超默认的 5s
describe('报听：摸打自动胡牌', { timeout: 20000 }, () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('报听后自摸到胡牌张直接成立，不再弹确认', async () => {
    const store = useGameStore()
    void store.start()
    await waitUntil(() => store.canDiscard)

    const game = store.state
    // 财神固定为白板：下面所有手牌都不含它，避免万能牌扰动手牌结构
    game.jokerTile = JOKER
    // 三家手牌换成互不成对、也不与人类弃牌相邻的散牌：
    // 无将牌故不可能胡，无四张故不可能暗杠，不邻接故不可能吃——避免抢先结束本局把牌墙位置挪走
    for (let offset = 1; offset < 4; offset++) {
      const seat = (HUMAN_SEAT + offset) % 4
      const player = game.players[seat]
      player.hand = [0, 2, 4, 6, 8, 9, 11, 13, 15, 17, 18, 24, 26, 27, 29, 31]
      player.melds = []
    }

    // 人类：听 3筒／6筒，刚摸到一张无关牌；报听后只能摸切
    const junk = 21
    const player = game.players[HUMAN_SEAT]
    player.hand = [...TENPAI_HAND, junk]
    player.drawnTile = junk
    player.declaredReady = true

    // 弃牌后三家各摸一张，人类的下一张牌落在 wallCursor + 3
    game.wall[game.wallCursor + 3] = 11

    store.commitDiscard(junk)
    let prompted = false
    await waitUntil(() => {
      if (store.selfWinPrompt) prompted = true
      return !!store.state.result
    })

    expect(prompted).toBe(false)
    expect(store.state.result?.winners[0]?.seat).toBe(HUMAN_SEAT)
    store.reset()
  })
})

describe('报听：自动摸打与放炮可放弃', { timeout: 20000 }, () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  /**
   * 人类听 3筒/6筒 并已报听；三家清空手牌使其「摸到什么打什么」，
   * 从而可用牌墙精确安排喂牌。调用后当前这一手仍需手动放行（decideDiscard 已挂起）。
   */
  async function readyWithEmptyOpponents() {
    const store = useGameStore()
    void store.start()
    await waitUntil(() => store.canDiscard)

    const game = store.state
    game.jokerTile = JOKER
    for (let offset = 1; offset < 4; offset++) {
      const seat = (HUMAN_SEAT + offset) % 4
      game.players[seat].hand = []
      game.players[seat].melds = []
    }
    const human = game.players[HUMAN_SEAT]
    human.hand = [...TENPAI_HAND, 21]
    human.drawnTile = 21
    human.melds = []
    human.declaredReady = true
    return { store, human }
  }

  it('报听后轮到出牌即自动摸切，不再需要玩家操作', async () => {
    const { store, human } = await readyWithEmptyOpponents()
    // 换掉牌墙里剩余的听牌张，避免三家打出后人类直接胡牌，干扰对「自动摸切」的观察
    store.state.wall = store.state.wall.map((tile) => ([11, 14].includes(tile) ? 0 : tile))

    const before = human.discards.length
    store.commitDiscard(21)
    await waitUntil(() => human.discards.length > before + 1)

    expect(human.discards.length).toBeGreaterThan(before + 1)
    store.reset()
  })

  it('报听后放炮可胡时弹询问，选项只有胡、且不再提供听牌入口', async () => {
    const { store } = await readyWithEmptyOpponents()
    // 下家摸到 3筒 后手里只剩它，必然打出；人类听 3筒，故构成放炮胡
    store.state.wall[store.state.wallCursor] = 11
    store.commitDiscard(21)

    await waitUntil(() => store.claimPrompt !== null)
    expect(store.claimPrompt?.options).toEqual([{ seat: HUMAN_SEAT, kind: 'win' }])
    expect(store.claimPrompt?.canDeclareReady).toBe(false)

    // 放弃胡：不结算，继续听牌
    store.answerClaim(false)
    await delay(80)
    expect(store.state.result).toBeNull()
    expect(store.human.declaredReady).toBe(true)
    store.reset()
  })

  it('报听后放炮可胡时选择胡，正常结算', async () => {
    const { store } = await readyWithEmptyOpponents()
    store.state.wall[store.state.wallCursor] = 11
    store.commitDiscard(21)

    await waitUntil(() => store.claimPrompt !== null)
    store.answerClaim(true, store.claimPrompt?.options[0])

    await waitUntil(() => !!store.state.result)
    expect(store.state.result?.winners[0]?.seat).toBe(HUMAN_SEAT)
    store.reset()
  })
})

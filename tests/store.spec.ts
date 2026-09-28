import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { WHITE_DRAGON } from '../src/engine/tiles'
import { HUMAN_SEAT, useGameStore } from '../src/stores/game'

/** 筒2–筒8：对 筒4 / 筒5 / 筒6 都能吃出 2 种以上组合 */
const CHOW_FRIENDLY_HAND = [10, 11, 12, 13, 14, 15, 16]

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 轮询等待条件成立：建议计算会阻塞主线程，固定延时在负载高时不可靠 */
async function waitUntil(cond: () => boolean, timeout = 5000): Promise<void> {
  const deadline = Date.now() + timeout
  while (!cond() && Date.now() < deadline) await delay(20)
}

// 建议计算会阻塞主线程，机器繁忙时单个用例耗时远超默认的 5s
describe('对局编排', { timeout: 20000 }, () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('开局后进入等待玩家出牌的状态', async () => {
    const store = useGameStore()
    void store.start()
    await waitUntil(() => store.canDiscard)

    expect(store.running).toBe(true)
    expect(store.state.result).toBeNull()
    expect(store.canDiscard).toBe(true)
    expect(store.human.hand.length).toBe(17)
    store.reset()
  })

  it('重开时旧循环被唤醒退出，新对局继续推进', async () => {
    const store = useGameStore()
    void store.start()
    await waitUntil(() => store.canDiscard)
    const firstSeq = store.turnSeq
    expect(firstSeq).toBeGreaterThan(0)

    // 重开：旧循环若仍挂在等待上，新对局将无法进入出牌状态
    void store.start()
    await waitUntil(() => store.canDiscard && store.turnSeq > firstSeq)

    expect(store.turnSeq).toBeGreaterThan(firstSeq)
    expect(store.canDiscard).toBe(true)
    expect(store.state.result).toBeNull()
    expect(store.human.hand.length).toBe(17)
    store.reset()
  })

  it('连续重开不会让对局卡死', async () => {
    const store = useGameStore()
    for (let i = 0; i < 3; i++) {
      void store.start()
      await delay(120)
    }
    await waitUntil(() => store.canDiscard)
    expect(store.canDiscard).toBe(true)
    expect(store.wallLeft).toBeGreaterThan(0)
    store.reset()
  })

  it('玩家出牌后进入他家行动流程', async () => {
    const store = useGameStore()
    void store.start()
    await waitUntil(() => store.canDiscard)

    const tile = [...store.legalTiles][0]
    const handBefore = store.human.hand.length
    store.commitDiscard(tile)
    // 这张牌可能立刻被他人吃碰杠而从牌河取回（reclaimDiscard），
    // 故以「手牌少一张」判断本手已生效，而不是看自己牌河里有没有它
    await waitUntil(() => store.human.hand.length === handBefore - 1)

    expect(store.human.hand.length).toBe(handBefore - 1)
    expect(store.state.lastDiscardSeat).toBe(HUMAN_SEAT)
    store.reset()
  })

  it('同一张打牌有多个响应组合时，玩家只被询问一次', async () => {
    const store = useGameStore()
    void store.start()
    await waitUntil(() => store.canDiscard)

    const game = store.state
    // 财神固定为白板，下面所有手牌都不含它，避免万能牌扰动手牌结构
    game.jokerTile = WHITE_DRAGON

    // 其余补互不成对的散牌，避免人类自己先形成响应
    const human = game.players[HUMAN_SEAT]
    human.hand = [...CHOW_FRIENDLY_HAND, 0, 1, 3, 4, 6, 7, 18, 21, 24]
    human.melds = []

    // 上家（座位 3）只留筒4/5/6：无论它打哪张，人类都能吃出多种组合。
    // 另两家只留字牌：既抢不走这张牌，其自身弃牌也不会被人类吃碰。
    const upper = game.players[3]
    upper.hand = [13, 14, 15]
    upper.melds = []
    game.players[1].hand = [29, 30]
    game.players[1].melds = []
    game.players[2].hand = [32, 28]
    game.players[2].melds = []

    // 人类先手（庄家）打牌后依次轮到座位 1、2、3 各摸一张，位置因此固定
    game.wall[game.wallCursor] = 31
    game.wall[game.wallCursor + 1] = 27
    game.wall[game.wallCursor + 2] = 15

    const seqBefore = store.turnSeq
    store.commitDiscard(0)
    await waitUntil(() => store.claimPrompt !== null)

    const prompt = store.claimPrompt
    expect(prompt).not.toBeNull()
    // 场景有效性：玩家确有多条响应组合，否则本用例无法暴露「反复询问」
    expect(prompt?.options.length ?? 0).toBeGreaterThan(1)

    store.answerClaim(false)
    // 两种结局都要立刻退出等待：正常轮到人类下一次出牌，或同一张牌再次弹出询问
    await waitUntil(() => store.claimPrompt !== null || store.turnSeq > seqBefore)

    expect(store.claimPrompt).toBeNull()
    expect(store.turnSeq).toBeGreaterThan(seqBefore)
    store.reset()
  })
})

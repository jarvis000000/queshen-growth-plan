import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { HUMAN_SEAT, useGameStore } from '../src/stores/game'

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
})

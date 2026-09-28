import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameResult } from '../src/engine/game'
import { WIN_TYPE } from '../src/engine/win'
import { HUMAN_SEAT, useGameStore } from '../src/stores/game'
import { recordDiscard, recordGame, resetStats, stats, summarize } from '../src/stores/stats'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 轮询等待条件成立：建议计算会阻塞主线程，固定延时在负载高时不可靠 */
async function waitUntil(cond: () => boolean, timeout = 5000): Promise<void> {
  const deadline = Date.now() + timeout
  while (!cond() && Date.now() < deadline) await delay(20)
}

/**
 * 手写一局结果。deltas 由用例显式给出以锁定净分口径；
 * 其中的 score 仅作占位（净分不再由它推导）。
 */
function gameResult(options: { draw?: boolean; seat?: number; from?: number | null; deltas?: number[] } = {}): GameResult {
  const { draw = false, seat = HUMAN_SEAT, from = null, deltas = [0, 0, 0, 0] } = options
  if (draw) return { draw: true, winners: [], deltas }
  return {
    draw: false,
    winners: [
      {
        seat,
        from,
        tile: 0,
        winType: WIN_TYPE.STANDARD,
        score: { patterns: [], multipliers: [], multiplier: 1, jokerScore: 0, total: 10, labels: [] },
      },
    ],
    deltas,
  }
}

/** node 测试环境没有 localStorage，换成内存实现以便验证读写 */
class MemoryStorage {
  private store = new Map<string, string>()

  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  clear(): void {
    this.store.clear()
  }
}

describe('战绩累计', () => {
  beforeEach(() => {
    resetStats()
  })

  it('人类胡牌计入胡牌局数并累加本人分家结算分', () => {
    recordGame(gameResult({ deltas: [18, -6, -6, -6] }), HUMAN_SEAT)
    expect(stats.games).toBe(1)
    expect(stats.wins).toBe(1)
    expect(stats.score).toBe(18)
  })

  it('人类放炮按其分家结算分扣减', () => {
    recordGame(gameResult({ seat: 2, from: HUMAN_SEAT, deltas: [-25, 5, 15, 5] }), HUMAN_SEAT)
    expect(stats.dealIns).toBe(1)
    expect(stats.score).toBe(-25)
  })

  it('他家胡且人类未放炮只计数，但杠分仍计入净分', () => {
    recordGame(gameResult({ seat: 2, from: 3, deltas: [2, -3, 4, -3] }), HUMAN_SEAT)
    expect(stats.others).toBe(1)
    expect(stats.score).toBe(2)
  })

  it('流局只计局数，杠分仍计入净分', () => {
    recordGame(gameResult({ draw: true, deltas: [3, -1, -1, -1] }), HUMAN_SEAT)
    expect(stats.draws).toBe(1)
    expect(stats.score).toBe(3)
  })
})

describe('汇总口径', () => {
  beforeEach(() => {
    resetStats()
  })

  it('无战绩时标记为空且胜率为 null', () => {
    const summary = summarize(stats)
    expect(summary.empty).toBe(true)
    expect(summary.winRate).toBeNull()
    expect(summary.hands).toBe(0)
  })

  it('总手数为四类之和，百分比按总手数折算', () => {
    recordDiscard('best')
    recordDiscard('best')
    recordDiscard('acceptable')
    recordDiscard('unrated')
    const summary = summarize(stats)
    expect(summary.hands).toBe(4)
    expect(summary.buckets.map((bucket) => bucket.count)).toEqual([2, 1, 0, 1])
    expect(summary.buckets[0].pct).toBeCloseTo(50)
  })

  it('未评定为 0 时不出现该行', () => {
    recordDiscard('best')
    expect(summarize(stats).buckets.map((bucket) => bucket.key)).toEqual(['best', 'acceptable', 'blunder'])
  })

  it('胜率按胡牌局数占总局数折算', () => {
    recordGame(gameResult(), HUMAN_SEAT)
    recordGame(gameResult({ draw: true }), HUMAN_SEAT)
    recordGame(gameResult({ draw: true }), HUMAN_SEAT)
    recordGame(gameResult({ draw: true }), HUMAN_SEAT)
    expect(summarize(stats).winRate).toBeCloseTo(25)
  })

  it('清空后全部归零', () => {
    recordDiscard('blunder')
    recordGame(gameResult({ deltas: [30, -10, -10, -10] }), HUMAN_SEAT)
    resetStats()
    expect(summarize(stats).empty).toBe(true)
    expect(stats.score).toBe(0)
  })
})

describe('持久化', () => {
  beforeEach(() => {
    resetStats()
  })

  it('记录后写入 queshen-stats', async () => {
    const storage = new MemoryStorage()
    vi.stubGlobal('localStorage', storage)
    vi.resetModules()
    const module = await import('../src/stores/stats')
    module.recordDiscard('best')
    expect((JSON.parse(storage.getItem('queshen-stats') ?? '{}') as { best?: number }).best).toBe(1)
    vi.unstubAllGlobals()
  })

  it('读回时用默认值补齐缺失字段', async () => {
    const storage = new MemoryStorage()
    storage.setItem('queshen-stats', JSON.stringify({ games: 3, best: 7 }))
    vi.stubGlobal('localStorage', storage)
    vi.resetModules()
    const module = await import('../src/stores/stats')
    expect(module.stats.games).toBe(3)
    expect(module.stats.best).toBe(7)
    expect(module.stats.acceptable).toBe(0)
    vi.unstubAllGlobals()
  })
})

// 建议计算会阻塞主线程，机器繁忙时单个用例耗时远超默认的 5s
describe('出牌评级接入', { timeout: 20000 }, () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetStats()
  })

  it('打出最优解后 best 计数加一', async () => {
    const store = useGameStore()
    void store.start()
    await waitUntil(() => store.canDiscard)
    await waitUntil(() => (store.advice?.candidates.length ?? 0) > 0)
    const best = store.advice?.candidates[0]?.tile
    expect(best).toBeDefined()
    store.commitDiscard(best as number)
    expect(stats.best).toBe(1)
    expect(summarize(stats).hands).toBe(1)
    store.reset()
  })

  it('建议前三名都记为最优', async () => {
    const store = useGameStore()
    void store.start()
    await waitUntil(() => store.canDiscard)
    await waitUntil(() => (store.advice?.candidates.length ?? 0) >= 4)

    const third = (store.advice?.candidates ?? []).find((item) => item.rank === 3)
    expect(third).toBeDefined()
    store.commitDiscard(third?.tile as number)

    expect(stats.best).toBe(1)
    store.reset()
  })

  it('第四名起不再记为最优', async () => {
    const store = useGameStore()
    void store.start()
    await waitUntil(() => store.canDiscard)
    await waitUntil(() => (store.advice?.candidates.length ?? 0) >= 5)

    const fourth = (store.advice?.candidates ?? []).find((item) => item.rank === 4)
    expect(fourth).toBeDefined()
    store.commitDiscard(fourth?.tile as number)

    expect(stats.best).toBe(0)
    expect(summarize(stats).hands).toBe(1)
    store.reset()
  })

  it('每一次人类出牌都恰好记入一个评级档', async () => {
    const store = useGameStore()
    void store.start()
    await waitUntil(() => store.canDiscard)
    await waitUntil(() => (store.advice?.candidates.length ?? 0) > 0)
    const worst = store.advice?.candidates[store.advice.candidates.length - 1]?.tile
    expect(worst).toBeDefined()
    store.commitDiscard(worst as number)
    const summary = summarize(stats)
    expect(summary.hands).toBe(1)
    expect(summary.buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(1)
    expect(stats.best).toBe(0)
    store.reset()
  })
})

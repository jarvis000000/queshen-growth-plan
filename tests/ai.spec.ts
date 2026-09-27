import { describe, expect, it } from 'vitest'
import { DIFFICULTY, chooseDiscard, evaluateDiscards } from '../src/engine/ai'
import { createGame, viewFor } from '../src/engine/game'
import { readOpponent } from '../src/engine/read'
import { legalDiscards } from '../src/engine/rules'
import { tileName } from '../src/engine/tiles'

function fixedRandom(seed: number) {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

// 逐手评估全部候选，机器繁忙时用例耗时远超默认的 5s
describe('AI 决策', { timeout: 20000 }, () => {
  it('玩家视角不含他家暗牌', () => {
    const game = createGame(fixedRandom(7))
    const view = viewFor(game, 0)
    expect(view.hand).toHaveLength(17)
    expect(view.discards).toHaveLength(4)
    expect(view).not.toHaveProperty('players')
    expect(view).not.toHaveProperty('wall')
  })

  it('决策耗时在可交互范围内', () => {
    const game = createGame(fixedRandom(11))
    const view = viewFor(game, 0)
    const start = performance.now()
    const candidates = evaluateDiscards(view, DIFFICULTY.GOD)
    const elapsed = performance.now() - start

    expect(candidates.length).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(1500)
    console.log(`评估耗时 ${elapsed.toFixed(1)}ms，候选 ${candidates.length} 张`)
    console.log(`最优：${tileName(candidates[0].tile)} → ${candidates[0].reason}`)
  })

  it('只推荐规则允许打出的牌', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const game = createGame(fixedRandom(seed))
      const view = viewFor(game, 0)
      const allowed = new Set(legalDiscards(view.hand, view.pendingHonor))
      const candidates = evaluateDiscards(view, DIFFICULTY.GOD)
      for (const candidate of candidates) expect(allowed.has(candidate.tile)).toBe(true)
    }
  })

  it('三档难度均能给出可打出的牌', () => {
    const game = createGame(fixedRandom(3))
    const view = viewFor(game, 0)
    for (const difficulty of Object.values(DIFFICULTY)) {
      const pick = chooseDiscard(view, difficulty, fixedRandom(99))
      expect(view.hand).toContain(pick.tile)
    }
  })

  it('对手分析给出危险牌与理由', () => {
    const game = createGame(fixedRandom(21))
    const view = viewFor(game, 0)
    const read = readOpponent(view, 1)
    expect(read.dangers).toHaveLength(34)
    expect(read.dangers[0].danger).toBeGreaterThanOrEqual(read.dangers[33].danger)
    expect(read.summary.length).toBeGreaterThan(0)
    console.log('对手分析：', read.summary)
    console.log(
      '危险前三：',
      read.dangers
        .slice(0, 3)
        .map((item) => `${tileName(item.tile)}(${item.danger})`)
        .join('、'),
    )
  })
})

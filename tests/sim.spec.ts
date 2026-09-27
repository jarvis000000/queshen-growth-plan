import { describe, expect, it } from 'vitest'
import { DIFFICULTY, shouldClaim } from '../src/engine/ai'
import {
  applyAddKong,
  applyAnKong,
  applyChow,
  applyDiscard,
  applyKong,
  applyPong,
  createGame,
  drawTile,
  findClaims,
  findSelfActions,
  isDraw,
  SEATS,
  settleDraw,
  settleWin,
  viewFor,
  type ClaimKind,
  type GameResult,
  type GameState,
} from '../src/engine/game'
import { normalize } from '../src/engine/joker'
import { MELD_KIND } from '../src/engine/meld'
import { legalDiscards } from '../src/engine/rules'
import { shantenCached } from '../src/engine/shanten'
import type { WinType } from '../src/engine/win'

function fixedRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

/** 简化决策：只比向听数，让整局模拟保持秒级完成 */
function quickDiscard(game: GameState, seat: number, random: () => number): number {
  const view = viewFor(game, seat)
  const legal = legalDiscards(view.hand, view.pendingHonor)
  let bestTile = legal[0]
  let bestShanten = Number.POSITIVE_INFINITY
  for (const tile of legal) {
    const rest = [...view.hand]
    rest.splice(rest.indexOf(tile), 1)
    const folded = normalize(rest, view.jokerTile)
    const shanten = shantenCached(folded.counts, folded.wildcards, view.melds.length)
    if (shanten < bestShanten) {
      bestShanten = shanten
      bestTile = tile
    }
  }
  // 掺入少量随机出牌，制造副露与多样牌型
  return random() < 0.15 ? legal[Math.floor(random() * legal.length)] : bestTile
}

function playClaims(game: GameState, random: () => number): { seat: number; kind: ClaimKind } | null {
  const claims = findClaims(game)
  if (claims.length === 0) return null
  const pending = game.pending
  if (!pending) return null

  const win = claims.find((claim) => claim.kind === 'win')
  if (win) {
    settleWin(game, win.seat, pending.from, pending.tile, 'standard' as WinType)
    return { seat: win.seat, kind: 'win' }
  }

  for (const kind of ['kong', 'pong', 'chow'] as const) {
    const claim = claims.find((item) => item.kind === kind)
    if (!claim) continue
    const view = viewFor(game, claim.seat)
    const accepted = shouldClaim(
      view,
      kind,
      { tile: pending.tile, used: claim.tiles ?? [] },
      DIFFICULTY.NORMAL,
      random,
    )
    if (!accepted) continue
    if (kind === 'kong') {
      applyKong(game, claim.seat)
      return { seat: claim.seat, kind }
    }
    if (kind === 'pong' && applyPong(game, claim.seat)) return { seat: claim.seat, kind }
    if (kind === 'chow' && applyChow(game, claim.seat, claim.tiles ?? [])) return { seat: claim.seat, kind }
  }
  return null
}

interface SimResult {
  finished: boolean
  steps: number
  melds: number
  winType: WinType | null
  anKongs: number
  addKongs: number
}

/** 摸牌后的杠决策：暗杠财神等于钉死万能牌，模拟中同样回避 */
function pickKong(game: GameState, seat: number): { tile: number; kind: 'an' | 'add' } | null {
  const actions = findSelfActions(game, seat)
  const an = actions.anKongs.find((tile) => tile !== game.jokerTile)
  if (an !== undefined) return { tile: an, kind: 'an' }
  const add = actions.addKongs.find((tile) => tile !== game.jokerTile)
  if (add !== undefined) return { tile: add, kind: 'add' }
  return null
}

function simulate(seed: number): SimResult {
  const random = fixedRandom(seed)
  const game = createGame(random)
  let currentSeat = game.dealer
  let mustDraw = false
  let steps = 0
  let winType: WinType | null = null
  let anKongs = 0
  let addKongs = 0

  while (!game.result && steps < 4000) {
    steps++
    if (mustDraw) {
      const drawn = drawTile(game, currentSeat)
      if (drawn === null || isDraw(game)) {
        settleDraw(game)
        break
      }
      const actions = findSelfActions(game, currentSeat)
      if (actions.winType) {
        settleWin(game, currentSeat, null, drawn, actions.winType)
        winType = actions.winType
        break
      }

      let kong = pickKong(game, currentSeat)
      let kongEnded = false
      while (kong) {
        const supplement =
          kong.kind === 'an'
            ? applyAnKong(game, currentSeat, kong.tile)
            : applyAddKong(game, currentSeat, kong.tile)
        if (supplement === null) break
        if (kong.kind === 'an') anKongs++
        else addKongs++
        const after = findSelfActions(game, currentSeat)
        if (after.winType) {
          settleWin(game, currentSeat, null, supplement, after.winType)
          winType = after.winType
          kongEnded = true
          break
        }
        kong = pickKong(game, currentSeat)
      }
      if (kongEnded) break
    }

    applyDiscard(game, currentSeat, quickDiscard(game, currentSeat, random))

    const claim = playClaims(game, random)
    // 循环条件已把 game.result 窄化为 null，此处需显式取回结算结果
    const settled = game.result as GameResult | null
    if (settled) {
      winType = settled.winners[0]?.winType ?? null
      break
    }
    if (claim) {
      currentSeat = claim.seat
      mustDraw = false
    } else {
      game.pending = null
      currentSeat = (currentSeat + 1) % SEATS
      mustDraw = true
    }
    game.turn = currentSeat
  }

  const melds = game.players.reduce((total, player) => total + player.melds.length, 0)
  return { finished: game.result !== null, steps, melds, winType, anKongs, addKongs }
}

describe('完整对局模拟', () => {
  // 规则放开后可打牌变多，逐步评估全部候选使单局耗时上升，需要更宽的超时
  it('多局模拟均能正常结束，并会自然触发暗杠', { timeout: 60000 }, () => {
    let winCount = 0
    let meldTotal = 0
    let maxSteps = 0
    let anKongTotal = 0
    let addKongTotal = 0

    for (let seed = 1; seed <= 60; seed++) {
      const result = simulate(seed)
      expect(result.finished).toBe(true)
      maxSteps = Math.max(maxSteps, result.steps)
      meldTotal += result.melds
      anKongTotal += result.anKongs
      addKongTotal += result.addKongs
      if (result.winType) winCount++
    }

    console.log(
      `60 局：胡牌 ${winCount} 局，副露累计 ${meldTotal} 组，暗杠 ${anKongTotal} 次，加杠 ${addKongTotal} 次，最长 ${maxSteps} 步`,
    )
    expect(meldTotal).toBeGreaterThan(0)
    // 暗杠与加杠都必须在对局中真实出现过，否则说明杠路径未被走到
    expect(anKongTotal).toBeGreaterThan(0)
  })

  it('每家手牌张数始终与副露数自洽', () => {
    const game = createGame(fixedRandom(5))
    let currentSeat = game.dealer
    let mustDraw = false
    let steps = 0

    while (!game.result && steps < 4000) {
      steps++
      if (mustDraw) {
        const drawn = drawTile(game, currentSeat)
        if (drawn === null || isDraw(game)) {
          settleDraw(game)
          break
        }
        const actions = findSelfActions(game, currentSeat)
        if (actions.winType) {
          settleWin(game, currentSeat, null, drawn, actions.winType)
          break
        }
      }

      for (const player of game.players) {
        const base = 16 - player.melds.length * 3
        const ceiling = player.seat === currentSeat ? base + 1 : base
        expect(player.hand.length).toBeLessThanOrEqual(ceiling)
        expect(player.melds.every((meld) => meld.tiles.length === (meld.kind === MELD_KIND.KONG || meld.kind === MELD_KIND.AN_KONG ? 4 : 3))).toBe(true)
      }

      applyDiscard(game, currentSeat, quickDiscard(game, currentSeat, fixedRandom(steps)))
      const claim = playClaims(game, fixedRandom(steps + 977))
      if (claim) {
        currentSeat = claim.seat
        mustDraw = false
      } else {
        game.pending = null
        currentSeat = (currentSeat + 1) % SEATS
        mustDraw = true
      }
      game.turn = currentSeat
    }
  })
})

describe('副露结算', () => {
  it('碰牌从手牌取出两张并从牌河收回被打出的牌', () => {
    const game = createGame(fixedRandom(9))
    const seat = 1
    game.players[seat].hand = [0, 0, 5, 6, 7, 12, 13, 14, 20, 21, 22, 27, 27, 30, 31, 32]
    game.pending = { tile: 0, from: 0 }
    game.players[0].discards.push(0)

    expect(applyPong(game, seat)).toBe(true)
    const meld = game.players[seat].melds[0]
    expect(meld.kind).toBe(MELD_KIND.PONG)
    expect(meld.tiles).toHaveLength(3)
    expect(game.players[seat].hand).toHaveLength(14)
    expect(game.players[0].discards).toHaveLength(0)
    expect(game.pending).toBeNull()
  })

  it('白板可代替财神原牌参与碰牌', () => {
    const game = createGame(fixedRandom(13))
    const jokerTile = 0
    game.jokerTile = jokerTile
    const seat = 2
    // 手中一张一万加一张白板，可碰一万
    game.players[seat].hand = [0, 33, 5, 6, 7, 12, 13, 14, 20, 21, 22, 27, 27, 30, 31, 32]
    game.pending = { tile: 0, from: 1 }
    game.players[1].discards.push(0)

    expect(applyPong(game, seat)).toBe(true)
    expect(game.players[seat].melds[0].tiles).toEqual([0, 0, 33])
  })
})

describe('暗杠与加杠', () => {
  it('暗杠取出四张并补一张牌', () => {
    const game = createGame(fixedRandom(3))
    const seat = 0
    game.players[seat].hand = [5, 5, 5, 5, 1, 2, 3, 10, 11, 12, 20, 21, 22, 27, 28, 29, 30]
    const cursorBefore = game.wallCursor

    const drawn = applyAnKong(game, seat, 5)
    expect(drawn).not.toBeNull()
    expect(game.players[seat].melds).toHaveLength(1)
    expect(game.players[seat].melds[0].kind).toBe(MELD_KIND.AN_KONG)
    expect(game.players[seat].melds[0].tiles).toHaveLength(4)
    expect(game.players[seat].melds[0].from).toBeNull()
    // 取出四张再补一张，净减三张
    expect(game.players[seat].hand).toHaveLength(14)
    expect(game.wallCursor).toBe(cursorBefore + 1)
  })

  it('加杠在已碰刻子上补第四张并补牌', () => {
    const game = createGame(fixedRandom(4))
    const seat = 0
    game.players[seat].melds = [{ kind: MELD_KIND.PONG, tiles: [5, 5, 5], from: 1 }]
    game.players[seat].hand = [5, 1, 2, 3, 10, 11, 12, 20, 21, 22, 27, 28, 29, 30]

    const drawn = applyAddKong(game, seat, 5)
    expect(drawn).not.toBeNull()
    expect(game.players[seat].melds[0].kind).toBe(MELD_KIND.KONG)
    expect(game.players[seat].melds[0].tiles).toHaveLength(4)
    // 出一张进一张，手牌数不变
    expect(game.players[seat].hand).toHaveLength(14)
  })

  it('findSelfActions 同时识别暗杠与加杠候选', () => {
    const game = createGame(fixedRandom(6))
    const seat = 0
    game.players[seat].hand = [5, 5, 5, 5, 9, 9, 9, 10, 11, 12, 20, 21, 22, 27, 28, 29, 30]
    game.players[seat].melds = [{ kind: MELD_KIND.PONG, tiles: [9, 9, 9], from: 1 }]

    const actions = findSelfActions(game, seat)
    expect(actions.anKongs).toContain(5)
    expect(actions.addKongs).toContain(9)
  })

  it('手牌不足四张时暗杠不成立', () => {
    const game = createGame(fixedRandom(8))
    const seat = 0
    game.players[seat].hand = [5, 5, 5, 1, 2, 3, 10, 11, 12, 20, 21, 22, 27, 28, 29, 30]
    expect(applyAnKong(game, seat, 5)).toBeNull()
    expect(game.players[seat].melds).toHaveLength(0)
  })
})

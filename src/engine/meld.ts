import { whiteActsAsJokerTile } from './joker'
import { TILE_KINDS, WHITE_DRAGON, isSuited, toCounts } from './tiles'

export const MELD_KIND = {
  CHOW: 'chow',
  PONG: 'pong',
  KONG: 'kong',
  AN_KONG: 'anKong',
} as const
export type MeldKind = (typeof MELD_KIND)[keyof typeof MELD_KIND]

export interface Meld {
  kind: MeldKind
  /** 副露张数：吃碰为 3，杠为 4 */
  tiles: number[]
  /** 供牌者座位，暗杠为 null */
  from: number | null
}

/** 副露占用的面子数：杠同样只占一个面子位 */
export function meldCountOf(melds: readonly Meld[]): number {
  return melds.length
}

export function meldTilesOf(melds: readonly Meld[]): number[] {
  return melds.flatMap((meld) => meld.tiles)
}

/**
 * 手牌中能充当 tile 的张数：本色牌计入，白板在非财神局面下等效财神原牌同样计入。
 */
export function countSupport(hand: readonly number[], tile: number, jokerTile: number): number {
  let count = 0
  const whiteAsJokerTile = whiteActsAsJokerTile(jokerTile)
  for (const held of hand) {
    if (held === tile) count++
    else if (whiteAsJokerTile && held === WHITE_DRAGON && tile === jokerTile) count++
  }
  return count
}

/**
 * 从手牌中取出 need 张可充当 tile 的牌，本色牌优先，不足部分由白板补位。
 * 返回实际取到的牌张（可能少于 need）。
 */
export function collectSupport(
  hand: readonly number[],
  tile: number,
  jokerTile: number,
  need: number,
): number[] {
  const picked: number[] = []
  for (const held of hand) {
    if (picked.length >= need) break
    if (held === tile) picked.push(held)
  }
  if (picked.length < need && whiteActsAsJokerTile(jokerTile) && tile === jokerTile) {
    for (const held of hand) {
      if (picked.length >= need) break
      if (held === WHITE_DRAGON) picked.push(held)
    }
  }
  return picked
}

function takeIndex(
  hand: readonly number[],
  need: number,
  jokerTile: number,
  used: readonly number[],
): number {
  for (let i = 0; i < hand.length; i++) {
    if (used.includes(i)) continue
    if (hand[i] === need) return i
  }
  if (whiteActsAsJokerTile(jokerTile) && need === jokerTile) {
    for (let i = 0; i < hand.length; i++) {
      if (used.includes(i)) continue
      if (hand[i] === WHITE_DRAGON) return i
    }
  }
  return -1
}

/**
 * 列出可用手牌吃进 tile 的组合，每项为 2 张手牌。
 * 吃仅限下家，故只在此处校验牌型，不校验顺序。
 */
export function findChowOptions(hand: readonly number[], tile: number, jokerTile: number): number[][] {
  if (!isSuited(tile)) return []
  const rank = tile % 9
  const patterns: number[][] = []
  if (rank <= 6) patterns.push([tile, tile + 1, tile + 2])
  if (rank >= 1 && rank <= 7) patterns.push([tile - 1, tile, tile + 1])
  if (rank >= 2) patterns.push([tile - 2, tile - 1, tile])

  const options: number[][] = []
  for (const pattern of patterns) {
    const needs = pattern.filter((member) => member !== tile)
    const first = takeIndex(hand, needs[0], jokerTile, [])
    if (first === -1) continue
    const second = takeIndex(hand, needs[1], jokerTile, [first])
    if (second === -1) continue
    options.push([hand[first], hand[second]])
  }
  return options
}

export function canPong(hand: readonly number[], tile: number, jokerTile: number): boolean {
  return countSupport(hand, tile, jokerTile) >= 2
}

/** 明杠：手中已有三张可响应他家打出的牌 */
export function canKong(hand: readonly number[], tile: number, jokerTile: number): boolean {
  return countSupport(hand, tile, jokerTile) >= 3
}

/** 暗杠候选：手中自持四张的牌种 */
export function findAnKongTiles(hand: readonly number[], jokerTile: number): number[] {
  const counts = toCounts(hand)
  const wildcardSupport = whiteActsAsJokerTile(jokerTile) ? counts[WHITE_DRAGON] : 0
  const result: number[] = []
  for (let tile = 0; tile < TILE_KINDS; tile++) {
    if (tile === WHITE_DRAGON && whiteActsAsJokerTile(jokerTile)) continue
    let support = counts[tile]
    if (tile === jokerTile) support += wildcardSupport
    if (support >= 4) result.push(tile)
  }
  return result
}

/** 加杠候选：已碰出的刻子又摸到第四张 */
export function findAddKongTiles(
  hand: readonly number[],
  melds: readonly Meld[],
  jokerTile: number,
): number[] {
  const counts = toCounts(hand)
  const result: number[] = []
  for (const meld of melds) {
    if (meld.kind !== MELD_KIND.PONG) continue
    const tile = meld.tiles[0]
    let support = counts[tile]
    if (tile === jokerTile && whiteActsAsJokerTile(jokerTile)) support += counts[WHITE_DRAGON]
    if (support >= 1) result.push(tile)
  }
  return result
}

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

/** 副露标签；暗杠与明杠在牌桌上形态不同，需分别显示 */
export function meldKindLabel(kind: MeldKind): string {
  if (kind === MELD_KIND.CHOW) return '吃'
  if (kind === MELD_KIND.PONG) return '碰'
  return kind === MELD_KIND.AN_KONG ? '暗杠' : '杠'
}

export function meldTilesOf(melds: readonly Meld[]): number[] {
  return melds.flatMap((meld) => meld.tiles)
}

/** 该牌能否充当 tile：本色牌总是可以，白板在 tile 恰为财神本色时等效 */
function actsAs(held: number, tile: number, jokerTile: number): boolean {
  if (held === tile) return true
  return whiteActsAsJokerTile(jokerTile) && held === WHITE_DRAGON && tile === jokerTile
}

/**
 * 手牌中能充当 tile 的张数：本色牌计入，白板在非财神局面下等效财神原牌同样计入。
 */
export function countSupport(hand: readonly number[], tile: number, jokerTile: number): number {
  return hand.filter((held) => actsAs(held, tile, jokerTile)).length
}

/**
 * 从手牌中取出 need 张可充当 tile 的牌并返回这些牌张（可能少于 need）。
 * 取牌优先级同 takeIndex：需要财神本色时白板优先，不花掉万能牌。
 */
export function collectSupport(
  hand: readonly number[],
  tile: number,
  jokerTile: number,
  need: number,
): number[] {
  const indexes: number[] = []
  while (indexes.length < need) {
    const index = takeIndex(hand, tile, jokerTile, indexes)
    if (index === -1) break
    indexes.push(index)
  }
  return indexes.map((index) => hand[index])
}

function takeIndex(
  hand: readonly number[],
  need: number,
  jokerTile: number,
  used: readonly number[],
): number {
  // 白板只等效财神本色，而财神牌本身是万能牌，
  // 故需要该本色时先花白板，把万能牌留在手里
  if (whiteActsAsJokerTile(jokerTile) && need === jokerTile) {
    for (let i = 0; i < hand.length; i++) {
      if (used.includes(i)) continue
      if (hand[i] === WHITE_DRAGON) return i
    }
  }
  for (let i = 0; i < hand.length; i++) {
    if (used.includes(i)) continue
    if (hand[i] === need) return i
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

/** 碰、明杠要从手牌里补的张数，剩下的那张来自他家打出的牌 */
export const PONG_FROM_HAND = 2
export const KONG_FROM_HAND = 3
/** 暗杠自持四张；加杠只补第四张，其余三张已在副露里 */
export const AN_KONG_TILES = 4
export const ADD_KONG_TILES = 1

export function canPong(hand: readonly number[], tile: number, jokerTile: number): boolean {
  return countSupport(hand, tile, jokerTile) >= PONG_FROM_HAND
}

/** 明杠：手中已有三张可响应他家打出的牌 */
export function canKong(hand: readonly number[], tile: number, jokerTile: number): boolean {
  return countSupport(hand, tile, jokerTile) >= KONG_FROM_HAND
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
    if (support >= AN_KONG_TILES) result.push(tile)
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
    if (support >= ADD_KONG_TILES) result.push(tile)
  }
  return result
}

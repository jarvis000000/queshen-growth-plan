import { TILE_KINDS, WHITE_DRAGON } from './tiles'

/**
 * 手牌在财神语境下的规范形态。
 *
 * 规则契约：财神牌是万能牌（可作任意牌，含其本身）；白板非财神时等效于财神原牌，
 * 且该等效贯穿吃、碰、杠、胡全部牌型判定。因此引擎内部统一把白板折算进
 * counts[财神原牌]，财神牌单独计为 wildcards，后续算法只面对「本色牌 + 万能牌」两种输入。
 */
export interface NormalizedHand {
  counts: number[]
  wildcards: number
}

/** 白板是否等效于财神原牌（财神恰为白板时白板本身就是万能牌，不存在折算关系） */
export function whiteActsAsJokerTile(jokerTile: number): boolean {
  return jokerTile !== WHITE_DRAGON
}

export function isWildcardTile(tile: number, jokerTile: number): boolean {
  return tile === jokerTile
}

export function normalize(tiles: readonly number[], jokerTile: number): NormalizedHand {
  const counts = new Array<number>(TILE_KINDS).fill(0)
  let wildcards = 0
  const foldWhite = whiteActsAsJokerTile(jokerTile)
  for (const tile of tiles) {
    if (tile === jokerTile) wildcards++
    else if (foldWhite && tile === WHITE_DRAGON) counts[jokerTile]++
    else counts[tile]++
  }
  return { counts, wildcards }
}

/** 单张牌的折算去向，用于进张推演与剩余张数统计 */
export function foldTile(tile: number, jokerTile: number): { tile: number; wildcard: boolean } {
  if (tile === jokerTile) return { tile: -1, wildcard: true }
  if (whiteActsAsJokerTile(jokerTile) && tile === WHITE_DRAGON) return { tile: jokerTile, wildcard: false }
  return { tile, wildcard: false }
}

/**
 * 白板的等效牌：非财神局面下白板即财神原牌，其余牌为本色值。
 * 排序与跟打判定都按此口径，故白板不会落到字牌堆末尾。
 */
export function effectiveTile(tile: number, jokerTile: number): number {
  return whiteActsAsJokerTile(jokerTile) && tile === WHITE_DRAGON ? jokerTile : tile
}

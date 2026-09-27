/**
 * 牌张编码：0-8 一万至九万，9-17 一筒至九筒，18-26 一条至九条，27-30 东南西北，31-33 中发白。
 * 全副 136 张，每种 4 张，无花牌。
 */

export const TILE_KINDS = 34
export const COPIES_PER_TILE = 4
export const TOTAL_TILES = TILE_KINDS * COPIES_PER_TILE

export const EAST = 27
export const SOUTH = 28
export const WEST = 29
export const NORTH = 30
export const RED_DRAGON = 31
export const GREEN_DRAGON = 32
export const WHITE_DRAGON = 33

export const WINDS: readonly number[] = [EAST, SOUTH, WEST, NORTH]
export const DRAGONS: readonly number[] = [RED_DRAGON, GREEN_DRAGON, WHITE_DRAGON]
export const HONORS: readonly number[] = [...WINDS, ...DRAGONS]

/** 胡牌牌型的面子总数：5 组面子 + 1 对将，共 17 张 */
export const MELDS_REQUIRED = 5

const SUIT_LABELS = ['万', '筒', '条']
const HONOR_LABELS = ['东', '南', '西', '北', '中', '发', '白']

const TILE_NAMES: readonly string[] = Array.from({ length: TILE_KINDS }, (_, tile) =>
  tile < 27 ? `${(tile % 9) + 1}${SUIT_LABELS[Math.floor(tile / 9)]}` : HONOR_LABELS[tile - 27],
)

export function tileName(tile: number): string {
  return TILE_NAMES[tile]
}

export function tilesName(tiles: readonly number[]): string {
  return tiles.map(tileName).join(' ')
}

export function isSuited(tile: number): boolean {
  return tile < 27
}

export function isHonor(tile: number): boolean {
  return tile >= 27
}

export function isWind(tile: number): boolean {
  return tile >= EAST && tile <= NORTH
}

/** 数牌花色序号 0/1/2，字牌返回 -1 */
export function suitOf(tile: number): number {
  return tile < 27 ? Math.floor(tile / 9) : -1
}

export function suitLabel(tile: number): string {
  return tile < 27 ? SUIT_LABELS[suitOf(tile)] : '字'
}

/** 数牌花色内序号 0-8，字牌返回 -1 */
export function rankOf(tile: number): number {
  return tile < 27 ? tile % 9 : -1
}

/** 能否以该牌为起始组成顺子（同花色内 1-7，即不越花色边界） */
export function canStartRun(tile: number): boolean {
  return tile < 27 && tile % 9 <= 6
}

export function toCounts(tiles: readonly number[]): number[] {
  const counts = new Array<number>(TILE_KINDS).fill(0)
  for (const tile of tiles) counts[tile]++
  return counts
}

export function toTiles(counts: readonly number[]): number[] {
  const tiles: number[] = []
  for (let tile = 0; tile < TILE_KINDS; tile++) {
    for (let n = 0; n < counts[tile]; n++) tiles.push(tile)
  }
  return tiles
}

export function countsTotal(counts: readonly number[]): number {
  let total = 0
  for (let tile = 0; tile < TILE_KINDS; tile++) total += counts[tile]
  return total
}

/** 生成全副牌墙（未洗牌） */
export function createWall(): number[] {
  const wall: number[] = []
  for (let tile = 0; tile < TILE_KINDS; tile++) {
    for (let n = 0; n < COPIES_PER_TILE; n++) wall.push(tile)
  }
  return wall
}

export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[items[i], items[j]] = [items[j], items[i]]
  }
  return items
}

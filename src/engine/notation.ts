import { tileName, WHITE_DRAGON } from './tiles'

const CN_NUM: Record<string, number> = {
  一: 1,
  幺: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
}

const SUIT_ALIAS: Record<string, number> = {
  万: 0,
  萬: 0,
  筒: 1,
  饼: 1,
  餅: 1,
  条: 2,
  條: 2,
  索: 2,
}

const HONOR_ALIAS: Record<string, number> = {
  东: 27,
  東: 27,
  东风: 27,
  南: 28,
  南风: 28,
  西: 29,
  西风: 29,
  北: 30,
  北风: 30,
  中: 31,
  红中: 31,
  紅中: 31,
  发: 32,
  發: 32,
  发财: 32,
  白: 33,
  白板: 33,
}

const TILE_PATTERN = /^([1-9]|[一二三四五六七八九幺两])\s*([万萬mM筒饼餅pP条條索sS])$/

/**
 * 解析命令行里输入的牌名，支持「5万」「五万」「5m」「東」「红中」等写法。
 * 无法识别时返回 null。
 */
export function parseTileInput(raw: string): number | null {
  // 容忍把「手牌」显示里的财神 / 白板标记一并复制过来
  const text = raw.trim().replace(/[*^]/g, '')
  if (!text) return null

  const honor = HONOR_ALIAS[text]
  if (honor !== undefined) return honor

  const match = TILE_PATTERN.exec(text)
  if (!match) return null

  const rankText = match[1]
  const rank = /^[1-9]$/.test(rankText) ? Number(rankText) : CN_NUM[rankText]
  if (rank === undefined) return null

  const suitChar = match[2]
  const asciiSuit = { m: 0, M: 0, p: 1, P: 1, s: 2, S: 2 }[suitChar]
  const suit = asciiSuit !== undefined ? asciiSuit : SUIT_ALIAS[suitChar]
  if (suit === undefined) return null

  return suit * 9 + rank - 1
}

/**
 * 把整串命令按空白与常见分隔符切分，供批量解析多张牌。
 */
export function splitTokens(raw: string): string[] {
  return raw
    .split(/[\s,，、/]+/)
    .map((token) => token.trim())
    .filter(Boolean)
}

/** 单张牌的文字表示：财神牌加 *，等效财神原牌的白板加 ^ */
export function formatTile(tile: number, jokerTile: number): string {
  const mark = tile === jokerTile ? '*' : tile === WHITE_DRAGON && jokerTile !== WHITE_DRAGON ? '^' : ''
  return `${tileName(tile)}${mark}`
}

export function formatTiles(tiles: readonly number[], jokerTile: number): string {
  return tiles.length === 0 ? '—' : tiles.map((tile) => formatTile(tile, jokerTile)).join(' ')
}

export function formatTileList(tiles: readonly number[]): string {
  return tiles.length === 0 ? '—' : tiles.map(tileName).join(' ')
}

export const NOTATION_LEGEND = '牌名标记：* 为财神牌（万能），^ 为白板（等效财神原牌）'

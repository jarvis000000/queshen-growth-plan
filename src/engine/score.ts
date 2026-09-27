import { isEightPairs, isStandardWin, WIN_TYPE, type WinType } from './win'
import { isHonor, isSuited, MELDS_REQUIRED, suitOf, TILE_KINDS } from './tiles'

export const PATTERN = {
  PING_HU: 'pingHu',
  PONG_PONG: 'pongPong',
  PURE_SUIT: 'pureSuit',
  MIXED_SUIT: 'mixedSuit',
  EIGHT_PAIRS: 'eightPairs',
  THREE_JOKERS: 'threeJokers',
  SELF_DRAW: 'selfDraw',
  CONCEALED: 'concealed',
} as const
export type Pattern = (typeof PATTERN)[keyof typeof PATTERN]

export const PATTERN_LABELS: Record<Pattern, string> = {
  [PATTERN.PING_HU]: '平胡',
  [PATTERN.PONG_PONG]: '碰碰胡',
  [PATTERN.PURE_SUIT]: '清一色',
  [PATTERN.MIXED_SUIT]: '混一色',
  [PATTERN.EIGHT_PAIRS]: '八对',
  [PATTERN.THREE_JOKERS]: '三财神',
  [PATTERN.SELF_DRAW]: '自摸',
  [PATTERN.CONCEALED]: '门清',
}

/** 底分基准；连庄递增由对局流程累加 */
export const BASE_SCORE = 2
/** 倍数档位：软牌 / 硬牌 / 双翻 */
export const MULTIPLIER = { SOFT: 1, HARD: 2, DOUBLE: 4 } as const

/**
 * 硬牌判定：财神全部归位（当作自身牌面）也能成牌。
 * 白板在非财神局面下已折算为财神原牌，故只需把财神牌回填为自身牌种。
 */
export function isHardWin(
  counts: number[],
  wildcards: number,
  meldCount: number,
  jokerTile: number,
): boolean {
  if (wildcards === 0) return true
  const rigid = counts.slice()
  rigid[jokerTile] += wildcards
  return isStandardWin(rigid, 0, meldCount) || isEightPairs(rigid, 0, meldCount)
}

/** 碰碰胡：全部面子皆为刻子（含副露），仅对标准牌型成立 */
function isAllTriplets(counts: number[], wildcards: number, needMelds: number): boolean {
  const work = counts.slice()

  const search = (wilds: number, meldsLeft: number, needPair: boolean): boolean => {
    let total = wilds
    for (let tile = 0; tile < TILE_KINDS; tile++) total += work[tile]
    if (total !== meldsLeft * 3 + (needPair ? 2 : 0)) return false

    let anchor = -1
    for (let tile = 0; tile < TILE_KINDS; tile++) {
      if (work[tile] > 0) {
        anchor = tile
        break
      }
    }
    if (anchor === -1) return true

    if (meldsLeft > 0) {
      for (let take = Math.min(3, work[anchor]); take >= 1; take--) {
        const gap = 3 - take
        if (gap > wilds) continue
        work[anchor] -= take
        const ok = search(wilds - gap, meldsLeft - 1, needPair)
        work[anchor] += take
        if (ok) return true
      }
    }

    if (needPair) {
      if (work[anchor] >= 2) {
        work[anchor] -= 2
        const ok = search(wilds, meldsLeft, false)
        work[anchor] += 2
        if (ok) return true
      }
      if (wilds >= 1) {
        work[anchor]--
        const ok = search(wilds - 1, meldsLeft, false)
        work[anchor]++
        if (ok) return true
      }
    }

    return false
  }

  return search(wildcards, needMelds, true)
}

export interface FlushInfo {
  pure: boolean
  mixed: boolean
}

/** 清一色：单一数牌花色且无字牌；混一色：单一数牌花色加字牌 */
export function flushInfoOf(allTiles: readonly number[]): FlushInfo {
  const suits = new Set<number>()
  let hasHonor = false
  for (const tile of allTiles) {
    if (isSuited(tile)) suits.add(suitOf(tile))
    else if (isHonor(tile)) hasHonor = true
  }
  const singleSuit = suits.size <= 1
  return { pure: singleSuit && !hasHonor && suits.size === 1, mixed: singleSuit && hasHonor }
}

export interface ScoreContext {
  winType: WinType
  counts: number[]
  wildcards: number
  meldCount: number
  jokerTile: number
  /** 手牌与副露的全部牌张，用于花色判定 */
  allTiles: readonly number[]
  selfDraw: boolean
}

export interface ScoreResult {
  patterns: Pattern[]
  hard: boolean
  multiplier: number
  jokerScore: number
  total: number
  labels: string[]
}

export function scoreWin(context: ScoreContext): ScoreResult {
  const { winType, counts, wildcards, meldCount, jokerTile, allTiles, selfDraw } = context
  const patterns: Pattern[] = []
  const hard = isHardWin(counts, wildcards, meldCount, jokerTile)

  if (winType === WIN_TYPE.THREE_JOKERS) {
    patterns.push(PATTERN.THREE_JOKERS)
  } else if (winType === WIN_TYPE.EIGHT_PAIRS) {
    patterns.push(PATTERN.EIGHT_PAIRS)
  } else {
    patterns.push(PATTERN.PING_HU)
    if (isAllTriplets(counts, wildcards, MELDS_REQUIRED - meldCount)) patterns.push(PATTERN.PONG_PONG)
  }

  const flush = flushInfoOf(allTiles)
  if (flush.pure) patterns.push(PATTERN.PURE_SUIT)
  else if (flush.mixed) patterns.push(PATTERN.MIXED_SUIT)

  if (selfDraw) patterns.push(PATTERN.SELF_DRAW)
  if (meldCount === 0) patterns.push(PATTERN.CONCEALED)

  const doublePattern =
    patterns.includes(PATTERN.PONG_PONG) ||
    patterns.includes(PATTERN.PURE_SUIT) ||
    patterns.includes(PATTERN.THREE_JOKERS) ||
    (patterns.includes(PATTERN.EIGHT_PAIRS) && hard)

  // 双翻只由牌型决定；自摸、门清等状态不计入倍数，避免与牌型价值叠加失真
  const multiplier = doublePattern
    ? MULTIPLIER.DOUBLE
    : hard
      ? MULTIPLIER.HARD
      : MULTIPLIER.SOFT

  const jokerScore = wildcards * BASE_SCORE
  const total = BASE_SCORE * multiplier + jokerScore

  return {
    patterns,
    hard,
    multiplier,
    jokerScore,
    total,
    labels: patterns.map((pattern) => PATTERN_LABELS[pattern]),
  }
}

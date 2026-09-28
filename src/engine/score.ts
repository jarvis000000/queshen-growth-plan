import { isEightPairs, isStandardWin, WIN_TYPE, type WinType } from './win'
import { isHonor, isSuited, MELDS_REQUIRED, suitOf, TILE_KINDS } from './tiles'

export const PATTERN = {
  PING_HU: 'pingHu',
  PONG_PONG: 'pongPong',
  PURE_SUIT: 'pureSuit',
  EIGHT_PAIRS: 'eightPairs',
  THREE_JOKERS: 'threeJokers',
  SELF_DRAW: 'selfDraw',
  HARD: 'hard',
  KONG_DRAW: 'kongDraw',
  DOUBLE_KONG: 'doubleKong',
  DEALER_STREAK: 'dealerStreak',
} as const
export type Pattern = (typeof PATTERN)[keyof typeof PATTERN]

export const PATTERN_LABELS: Record<Pattern, string> = {
  [PATTERN.PING_HU]: '平胡',
  [PATTERN.PONG_PONG]: '碰碰胡',
  [PATTERN.PURE_SUIT]: '清一色',
  [PATTERN.EIGHT_PAIRS]: '八对',
  [PATTERN.THREE_JOKERS]: '三财神',
  [PATTERN.SELF_DRAW]: '自摸',
  [PATTERN.HARD]: '硬胡',
  [PATTERN.KONG_DRAW]: '杠开',
  [PATTERN.DOUBLE_KONG]: '二连杠',
  [PATTERN.DEALER_STREAK]: '连庄',
}

/** 底分：所有倍数相乘后作为得分基数 */
export const BASE_SCORE = 1

/**
 * 以「一份」为单位的系数：实际分 = 系数 × BASE_SCORE。
 * 财神与杠按「其他每一家」各付一份计；
 * 加杠的第四张已副露，与明杠同价。底分一变，这些数值同步缩放。
 */
export const UNIT = {
  JOKER: 1,
  EXPOSED_KONG: 1,
  CONCEALED_KONG: 2,
} as const

/** 把份数折算为实际分 */
export function shareScore(count: number): number {
  return BASE_SCORE * count
}
/** 各项倍数取值；同时命中则相乘 */
export const BONUS = {
  HARD: 2,
  SELF_DRAW: 2,
  PURE_SUIT: 2,
  PONG_PONG: 2,
  KONG_DRAW: 2,
  DOUBLE_KONG: 4,
} as const
/** 连庄 n 次即 ×2ⁿ，故以 2 为底 */
export const DEALER_STREAK_BASE = 2
/** 连开杠达到该次数按二连杠计，此时不再叠加杠开 */
export const DOUBLE_KONG_CHAIN = 2

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
  /** 当前连庄次数；0 表示未连庄，n 次即 ×2ⁿ */
  dealerStreak: number
  /** 本手胡牌的摸牌来自连开杠的补牌：0 为普通摸牌，1 为杠开，2 及以上为二连杠 */
  kongChain: number
}

/** 命中的倍数项及取值，供界面展示「硬胡×2 · 自摸×2」 */
export interface ScoreMultiplier {
  pattern: Pattern
  value: number
}

export interface ScoreResult {
  /** 命中的牌型与状态标签，按固定顺序 */
  patterns: Pattern[]
  /** 实际计分的倍数项 */
  multipliers: ScoreMultiplier[]
  /** 全部倍数之积；无倍数项时为 1 */
  multiplier: number
  /** 财神加分：财神张数 × JOKER_BONUS */
  jokerScore: number
  /** 本局得分：BASE_SCORE × multiplier + jokerScore */
  total: number
  labels: string[]
}

export function scoreWin(context: ScoreContext): ScoreResult {
  const {
    winType,
    counts,
    wildcards,
    meldCount,
    jokerTile,
    allTiles,
    selfDraw,
    dealerStreak,
    kongChain,
  } = context
  const patterns: Pattern[] = []
  const hard = isHardWin(counts, wildcards, meldCount, jokerTile)
  const doubleKong = kongChain >= DOUBLE_KONG_CHAIN

  if (winType === WIN_TYPE.THREE_JOKERS) {
    patterns.push(PATTERN.THREE_JOKERS)
  } else if (winType === WIN_TYPE.EIGHT_PAIRS) {
    patterns.push(PATTERN.EIGHT_PAIRS)
  } else {
    patterns.push(PATTERN.PING_HU)
    if (isAllTriplets(counts, wildcards, MELDS_REQUIRED - meldCount)) patterns.push(PATTERN.PONG_PONG)
  }

  if (flushInfoOf(allTiles).pure) patterns.push(PATTERN.PURE_SUIT)
  if (selfDraw) patterns.push(PATTERN.SELF_DRAW)
  if (hard) patterns.push(PATTERN.HARD)
  if (doubleKong) patterns.push(PATTERN.DOUBLE_KONG)
  else if (kongChain > 0) patterns.push(PATTERN.KONG_DRAW)
  if (dealerStreak > 0) patterns.push(PATTERN.DEALER_STREAK)

  const multipliers: ScoreMultiplier[] = []
  if (patterns.includes(PATTERN.PONG_PONG)) {
    multipliers.push({ pattern: PATTERN.PONG_PONG, value: BONUS.PONG_PONG })
  }
  if (patterns.includes(PATTERN.PURE_SUIT)) {
    multipliers.push({ pattern: PATTERN.PURE_SUIT, value: BONUS.PURE_SUIT })
  }
  if (hard) multipliers.push({ pattern: PATTERN.HARD, value: BONUS.HARD })
  if (selfDraw) multipliers.push({ pattern: PATTERN.SELF_DRAW, value: BONUS.SELF_DRAW })
  if (doubleKong) multipliers.push({ pattern: PATTERN.DOUBLE_KONG, value: BONUS.DOUBLE_KONG })
  else if (kongChain > 0) multipliers.push({ pattern: PATTERN.KONG_DRAW, value: BONUS.KONG_DRAW })
  if (dealerStreak > 0) {
    multipliers.push({
      pattern: PATTERN.DEALER_STREAK,
      value: DEALER_STREAK_BASE ** dealerStreak,
    })
  }

  const multiplier = multipliers.reduce((product, item) => product * item.value, 1)
  const jokerScore = wildcards * shareScore(UNIT.JOKER)

  return {
    patterns,
    multipliers,
    multiplier,
    jokerScore,
    total: BASE_SCORE * multiplier + jokerScore,
    labels: patterns.map((pattern) => PATTERN_LABELS[pattern]),
  }
}

/** 单局得分文案；两个界面共用同一口径，避免各写一份而漂移 */
export function formatScoreLine(score: ScoreResult): string {
  const parts = score.multipliers.map((item) => `${PATTERN_LABELS[item.pattern]}×${item.value}`)
  const joker = score.jokerScore > 0 ? `财神分 ${score.jokerScore}｜` : ''
  return `${parts.join(' · ')}｜${joker}合计 ${score.total}`
}

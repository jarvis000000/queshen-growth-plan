import type { PlayerView } from './game'
import { normalize } from './joker'
import { readOpponent, tenpaiRiskOf } from './read'
import { legalDiscards } from './rules'
import { shantenCached } from './shanten'
import { TILE_KINDS, tileName } from './tiles'
import { analyzeDiscards, type DiscardOption } from './ukeire'

export const DIFFICULTY = {
  EASY: 'easy',
  NORMAL: 'normal',
  GOD: 'god',
} as const
export type Difficulty = (typeof DIFFICULTY)[keyof typeof DIFFICULTY]

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  [DIFFICULTY.EASY]: '简单',
  [DIFFICULTY.NORMAL]: '普通',
  [DIFFICULTY.GOD]: '雀神',
}

interface DifficultyProfile {
  /** 有效进张在评分中的权重，为 0 时只看向听数 */
  ukeireWeight: number
  /** 安全度权重，为 0 时完全不防守 */
  safetyWeight: number
  /** 打出非最优牌的概率 */
  blunderRate: number
  /** 失误时允许偏离最优解的名次跨度 */
  blunderRange: number
  readsOpponents: boolean
}

const PROFILES: Record<Difficulty, DifficultyProfile> = {
  [DIFFICULTY.EASY]: {
    ukeireWeight: 0,
    safetyWeight: 0,
    blunderRate: 0.4,
    blunderRange: 4,
    readsOpponents: false,
  },
  [DIFFICULTY.NORMAL]: {
    ukeireWeight: 1,
    safetyWeight: 25,
    blunderRate: 0.12,
    blunderRange: 2,
    readsOpponents: true,
  },
  [DIFFICULTY.GOD]: {
    ukeireWeight: 1,
    safetyWeight: 60,
    blunderRate: 0,
    blunderRange: 0,
    readsOpponents: true,
  },
}

export interface DiscardCandidate extends DiscardOption {
  /** 对全场威胁的综合危险度 0-1 */
  danger: number
  /** 综合评分，越高越优 */
  value: number
  rank: number
  reason: string
}

/** 从公共视角统计已见张数：自己手牌、四家牌河、四家副露与财神标记 */
export function seenFromView(view: PlayerView): number[] {
  const seen = new Array<number>(TILE_KINDS).fill(0)
  for (const tile of view.hand) seen[tile]++
  for (const discards of view.discards) {
    for (const tile of discards) seen[tile]++
  }
  for (const melds of view.meldsBySeat) {
    for (const meld of melds) {
      for (const tile of meld.tiles) seen[tile]++
    }
  }
  seen[view.jokerTile]++
  return seen
}

function threatsOf(view: PlayerView, reads: boolean): number[] {
  return view.discards.map((_, seat) => (seat === view.seat || !reads ? 0 : tenpaiRiskOf(view, seat)))
}

function dangerMapOf(view: PlayerView, threats: readonly number[]): number[] {
  const dangerByTile = new Array<number>(TILE_KINDS).fill(0)
  for (let seat = 0; seat < view.discards.length; seat++) {
    if (seat === view.seat || threats[seat] === 0) continue
    const read = readOpponent(view, seat)
    for (const item of read.dangers) {
      const weighted = item.danger * threats[seat]
      if (weighted > dangerByTile[item.tile]) dangerByTile[item.tile] = weighted
    }
  }
  return dangerByTile
}

function buildReason(candidate: DiscardCandidate, best: DiscardCandidate | undefined): string {
  const parts: string[] = []
  if (candidate.shanten < 0) parts.push('打出后即可成牌')
  else if (candidate.shanten === 0) parts.push('打出后进入听牌')
  else parts.push(`打出后距听牌还差 ${candidate.shanten} 步`)

  if (candidate.ukeireTotal > 0) {
    const detail = candidate.ukeire
      .slice(0, 4)
      .map((entry) => `${tileName(entry.tile)}×${entry.count}`)
      .join('、')
    parts.push(`有效进张 ${candidate.ukeireTotal} 张（${detail}）`)
  } else if (candidate.shanten > 0) {
    parts.push('暂无直接进张，需先改良牌型')
  }

  if (candidate.danger >= 0.5) parts.push('但对他家危险度偏高，需谨慎')
  else if (candidate.danger <= 0.2) parts.push('对他家相对安全')

  if (best && candidate.tile !== best.tile && candidate.value < best.value) {
    const gap = (best.value - candidate.value).toFixed(0)
    parts.push(`综合评分低于最优解 ${gap} 分`)
  }
  return parts.join('；')
}

/**
 * 评估当前可打出的每一张牌。
 * 只使用 PlayerView 中的公开信息与自己的手牌，不含他家暗牌。
 */
export function evaluateDiscards(view: PlayerView, difficulty: Difficulty): DiscardCandidate[] {
  const profile = PROFILES[difficulty]
  const threats = threatsOf(view, profile.readsOpponents)
  const maxThreat = threats.reduce((max, value) => Math.max(max, value), 0)
  const dangerByTile = profile.readsOpponents ? dangerMapOf(view, threats) : new Array<number>(TILE_KINDS).fill(0)
  const legal = new Set(legalDiscards(view.hand, view.pendingHonor))

  const options = analyzeDiscards(view.hand, view.melds.length, view.jokerTile, seenFromView(view))
  const scored: DiscardCandidate[] = options
    .filter((option) => legal.has(option.tile))
    .map((option) => {
      const danger = dangerByTile[option.tile]
      const efficiency = -option.shanten * 100 + option.ukeireTotal * profile.ukeireWeight
      const safety = -danger * profile.safetyWeight * (0.4 + 0.6 * maxThreat)
      return { ...option, danger, value: efficiency + safety, rank: 0, reason: '' }
    })
    .sort((a, b) => b.value - a.value)

  scored.forEach((candidate, index) => {
    candidate.rank = index + 1
    candidate.reason = buildReason(candidate, scored[0])
  })
  return scored
}

export interface DiscardAdvice {
  /** 推荐打出 */
  best: DiscardCandidate
  /** 全部候选，按评分降序 */
  candidates: DiscardCandidate[]
  /** 是否存在明显更优的选择 */
  hasBetter: boolean
}

/** 分差折算为相对胜率时的温度系数：分差越小越接近，越大则迅速拉开差距 */
const RATE_TEMPERATURE = 20

/**
 * 把候选评分折算为相对胜率百分比。
 * 向听数相差一步即 100 分，经该温度折算后相对权重趋近 0，与「慢一步基本无缘」的牌感一致。
 */
export function relativeRates(candidates: readonly DiscardCandidate[]): number[] {
  if (candidates.length === 0) return []
  const top = candidates[0].value
  const weights = candidates.map((candidate) => Math.exp((candidate.value - top) / RATE_TEMPERATURE))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  return weights.map((weight) => weight / total)
}

/** 教学建议：给出最优解与全部候选，供「出牌提示」与「复盘」共用 */
export function adviseDiscard(view: PlayerView): DiscardAdvice {
  const candidates = evaluateDiscards(view, DIFFICULTY.GOD)
  return { best: candidates[0], candidates, hasBetter: candidates.length > 1 }
}

export function chooseDiscard(
  view: PlayerView,
  difficulty: Difficulty,
  random: () => number = Math.random,
): DiscardCandidate {
  const candidates = evaluateDiscards(view, difficulty)
  const profile = PROFILES[difficulty]

  if (candidates.length > 1 && random() < profile.blunderRate) {
    const upper = Math.min(candidates.length, 1 + profile.blunderRange)
    return candidates[1 + Math.floor(random() * (upper - 1))]
  }
  return candidates[0]
}

/**
 * 吃碰杠响应判断：以行动后的向听数与当前向听数比较，只有真正推进牌型才认同。
 * 副露会损失一次摸牌机会，故要求严格更优。
 */
export function shouldClaim(
  view: PlayerView,
  kind: 'pong' | 'kong' | 'chow',
  payload: { tile: number; used: readonly number[] },
  difficulty: Difficulty,
  random: () => number = Math.random,
): boolean {
  if (difficulty === DIFFICULTY.EASY) return random() < 0.7
  if (kind === 'kong') return true

  const afterHand = view.hand.filter((tile) => !payload.used.includes(tile))
  const afterFolded = normalize(afterHand, view.jokerTile)
  const afterShanten = shantenCached(afterFolded.counts, afterFolded.wildcards, view.melds.length + 1)

  const before = normalize(view.hand, view.jokerTile)
  const beforeShanten = shantenCached(before.counts, before.wildcards, view.melds.length)

  return afterShanten < beforeShanten
}

import { reactive } from 'vue'
import type { GameResult } from '../engine/game'
import { loadJson, saveJson } from './persist'

const STATS_KEY = 'queshen-stats'

/** 单次出牌相对最优解的评级 */
export type DiscardRating = 'best' | 'acceptable' | 'blunder' | 'unrated'

/**
 * 跨场次累计的战绩。字段刻意保持扁平（全为计数或累加值）：
 * 读回时才能靠浅合并把旧数据与缺失字段直接补齐。
 */
export interface GameStats {
  games: number
  wins: number
  dealIns: number
  draws: number
  /** 他家胡牌且非人类放炮的局数 */
  others: number
  /** 累计净分：由引擎分家结算累加，含杠分与放炮罚分 */
  score: number
  /** 打出即最优解的手数 */
  best: number
  /** 非最优、但未达明显劣化的手数 */
  acceptable: number
  /** 明显劣化（会触发拦截）的手数 */
  blunder: number
  /** 建议缺席、无从评定的手数 */
  unrated: number
}

const DEFAULT_STATS: GameStats = {
  games: 0,
  wins: 0,
  dealIns: 0,
  draws: 0,
  others: 0,
  score: 0,
  best: 0,
  acceptable: 0,
  blunder: 0,
  unrated: 0,
}

export const stats = reactive<GameStats>(loadJson(STATS_KEY, DEFAULT_STATS))

function save(): void {
  saveJson(STATS_KEY, stats)
}

export function recordDiscard(rating: DiscardRating): void {
  stats[rating]++
  save()
}

/** 结算一局：净分取引擎的分家结算（含杠分与放炮罚分） */
export function recordGame(result: GameResult, humanSeat: number): void {
  stats.games++
  stats.score += result.deltas[humanSeat] ?? 0
  if (result.draw) {
    stats.draws++
    save()
    return
  }
  const record = result.winners[0]
  if (record?.seat === humanSeat) stats.wins++
  else if (record?.from === humanSeat) stats.dealIns++
  else stats.others++
  save()
}

export function resetStats(): void {
  Object.assign(stats, DEFAULT_STATS)
  save()
}

export interface StatsBucket {
  key: DiscardRating
  label: string
  count: number
  /** 占人类出牌总手数的百分比 */
  pct: number
}

export interface StatsSummary {
  games: number
  wins: number
  dealIns: number
  draws: number
  others: number
  netScore: number
  /** 胡牌率百分比；尚未打完任何一局时为 null */
  winRate: number | null
  /** 人类出牌总手数，由四类之和推出，不额外存字段以免冗余状态漂移 */
  hands: number
  buckets: StatsBucket[]
  empty: boolean
}

const BUCKET_LABELS: Record<DiscardRating, string> = {
  best: '最优',
  acceptable: '可接受',
  blunder: '失误',
  unrated: '未评定',
}

const BUCKET_ORDER: readonly DiscardRating[] = ['best', 'acceptable', 'blunder', 'unrated']

/** 汇总为面板可直接渲染的形状；`unrated` 只在实际出现过时展示 */
export function summarize(source: GameStats): StatsSummary {
  const hands = source.best + source.acceptable + source.blunder + source.unrated
  const buckets = BUCKET_ORDER.filter((key) => key !== 'unrated' || source.unrated > 0).map((key) => ({
    key,
    label: BUCKET_LABELS[key],
    count: source[key],
    pct: hands === 0 ? 0 : (source[key] / hands) * 100,
  }))
  return {
    games: source.games,
    wins: source.wins,
    dealIns: source.dealIns,
    draws: source.draws,
    others: source.others,
    netScore: source.score,
    winRate: source.games === 0 ? null : (source.wins / source.games) * 100,
    hands,
    buckets,
    empty: source.games === 0 && hands === 0,
  }
}

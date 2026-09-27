import type { PlayerView } from './game'
import { meldTilesOf, type Meld } from './meld'
import { isHonor, isSuited, suitLabel, suitOf, TILE_KINDS, tileName } from './tiles'

export interface TileDanger {
  tile: number
  /** 0-1，越高越可能点炮 */
  danger: number
  reason: string
}

export interface OpponentRead {
  seat: number
  /** 疑似已听牌的概率 0-1 */
  tenpaiRisk: number
  meldCount: number
  /** 牌型方向判断 */
  tendency: string
  /** 按危险度降序排列的危险牌 */
  dangers: TileDanger[]
  summary: string
}

/** 中张比边张更易被吃进，字牌在无人碰时相对安全 */
function baseDanger(tile: number): number {
  if (isHonor(tile)) return 0.45
  const rank = tile % 9
  if (rank >= 3 && rank <= 5) return 1
  if (rank === 2 || rank === 6) return 0.85
  if (rank === 1 || rank === 7) return 0.7
  return 0.6
}

/**
 * 筋牌折扣：对手打出过同花色相隔三位的牌，说明该筋线上的牌不易被其需要。
 * 温州麻将无振听限制，故现物仍保留残余危险度。
 */
function sujiFactor(tile: number, discards: readonly number[]): number {
  if (discards.includes(tile)) return 0.15
  if (!isSuited(tile)) return 1
  const rank = tile % 9
  const suit = suitOf(tile)
  for (const delta of [-3, 3]) {
    const neighborRank = rank + delta
    if (neighborRank < 0 || neighborRank > 8) continue
    if (discards.includes(suit * 9 + neighborRank)) return 0.6
  }
  return 1
}

/** 对手副露集中的花色，其同花色牌更可能被其需要 */
function meldFactor(tile: number, melds: readonly Meld[]): number {
  if (!isSuited(tile)) return 1
  const suit = suitOf(tile)
  const suitedMelds = melds.filter((meld) => isSuited(meld.tiles[0]) && suitOf(meld.tiles[0]) === suit)
  return 1 + suitedMelds.length * 0.15
}

export function tenpaiRiskOf(view: PlayerView, seat: number): number {
  const meldCount = view.meldsBySeat[seat].length
  const turns = view.discards[seat].length
  return Math.min(0.92, 0.12 + meldCount * 0.24 + turns * 0.035)
}

function describeTendency(view: PlayerView, seat: number): string {
  const melds = view.meldsBySeat[seat]
  const discards = view.discards[seat]
  if (melds.length === 0 && discards.length === 0) return '尚未有明确方向'

  const allMelded = meldTilesOf(melds)
  const suitedMelded = allMelded.filter(isSuited)
  if (suitedMelded.length >= 3) {
    const suits = new Set(suitedMelded.map(suitOf))
    if (suits.size === 1) return `副露集中在${suitLabel(suitedMelded[0])}，疑似做一色牌`
    return '副露跨花色，偏向快速成牌'
  }

  const suitedDiscards = discards.filter(isSuited)
  if (suitedDiscards.length >= 4) {
    const counts = [0, 0, 0]
    for (const tile of suitedDiscards) counts[suitOf(tile)]++
    const dominant = counts.indexOf(Math.max(...counts))
    const label = suitLabel(dominant * 9)
    if (counts[dominant] >= suitedDiscards.length * 0.7) return `牌河以${label}为主，可能已放弃该花色`
  }
  if (melds.length >= 2) return '多组副露，成牌速度快'
  return '牌河分散，牌型尚不明朗'
}

export function readOpponent(view: PlayerView, targetSeat: number): OpponentRead {
  const discards = view.discards[targetSeat]
  const melds = view.meldsBySeat[targetSeat]
  const tenpaiRisk = tenpaiRiskOf(view, targetSeat)

  const dangers: TileDanger[] = []
  for (let tile = 0; tile < TILE_KINDS; tile++) {
    const base = baseDanger(tile)
    const suji = sujiFactor(tile, discards)
    const meldBoost = meldFactor(tile, melds)
    const raw = base * suji * meldBoost * (0.35 + 0.65 * tenpaiRisk)
    const danger = Math.min(1, Math.round(raw * 100) / 100)
    dangers.push({ tile, danger, reason: dangerReason(tile, discards, melds, suji) })
  }
  dangers.sort((a, b) => b.danger - a.danger)

  const tendency = describeTendency(view, targetSeat)
  const summary = buildSummary(tenpaiRisk, melds.length, tendency, dangers)

  return { seat: targetSeat, tenpaiRisk, meldCount: melds.length, tendency, dangers, summary }
}

function dangerReason(
  tile: number,
  discards: readonly number[],
  melds: readonly Meld[],
  suji: number,
): string {
  if (discards.includes(tile)) return '对手已打过这张牌，短期内不太需要'
  if (suji < 1) return '处于对手打过的筋线上，需求较低'
  if (isSuited(tile) && meldFactor(tile, melds) > 1) {
    return `与对手副露同花色（${suitLabel(tile)}），可能正需要`
  }
  if (isHonor(tile)) return '字牌，若对手未碰则多半只作将牌或对子'
  const rank = tile % 9
  if (rank >= 3 && rank <= 5) return '中张牌，两面搭子的常见进张'
  return '偏张，需结合牌河判断'
}

function buildSummary(
  tenpaiRisk: number,
  meldCount: number,
  tendency: string,
  dangers: readonly TileDanger[],
): string {
  const level = tenpaiRisk >= 0.65 ? '较高' : tenpaiRisk >= 0.35 ? '中等' : '偏低'
  const top = dangers.slice(0, 3).map((item) => tileName(item.tile)).join('、')
  const meldText = meldCount > 0 ? `该家已有 ${meldCount} 组副露，` : '该家尚无副露，'
  return `${meldText}${tendency}；听牌概率${level}（约 ${Math.round(tenpaiRisk * 100)}%）。当前最需提防：${top}。`
}

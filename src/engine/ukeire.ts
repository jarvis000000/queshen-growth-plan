import { foldTile, normalize, whiteActsAsJokerTile } from './joker'
import { shantenCached } from './shanten'
import { COPIES_PER_TILE, isSuited, suitOf, TILE_KINDS, WHITE_DRAGON } from './tiles'

export interface UkeireEntry {
  /** 摸到的牌种（原始牌面） */
  tile: number
  /** 视野内剩余张数 */
  count: number
  /** 摸到后的向听数 */
  shanten: number
}

export interface DiscardOption {
  /** 候选打出的牌种 */
  tile: number
  /** 打出后的向听数 */
  shanten: number
  /** 打出后的有效进张总张数 */
  ukeireTotal: number
  /** 打出后的有效进张明细 */
  ukeire: UkeireEntry[]
}

/** 已见张数统计：手牌、牌河、副露、以及本局财神标识牌都要计入 */
export function createSeenCounter(): number[] {
  return new Array<number>(TILE_KINDS).fill(0)
}

/**
 * 有效进张：摸到后能降低向听数的牌及其剩余张数。
 * seen 传入各牌种已见张数，剩余量按 4 张减去已见计算。
 */
export function calcUkeire(
  hand: readonly number[],
  meldCount: number,
  jokerTile: number,
  seen: readonly number[],
): UkeireEntry[] {
  const base = normalize(hand, jokerTile)
  const baseShanten = shantenCached(base.counts, base.wildcards, meldCount)
  const entries: UkeireEntry[] = []
  const probe = base.counts.slice()

  for (let tile = 0; tile < TILE_KINDS; tile++) {
    const count = COPIES_PER_TILE - seen[tile]
    if (count <= 0) continue
    if (!mayImproveHand(hand, tile, jokerTile)) continue
    const folded = foldTile(tile, jokerTile)
    let shanten: number
    if (folded.wildcard) {
      shanten = shantenCached(probe, base.wildcards + 1, meldCount)
    } else {
      probe[folded.tile] += 1
      shanten = shantenCached(probe, base.wildcards, meldCount)
      probe[folded.tile] -= 1
    }
    if (shanten < baseShanten) entries.push({ tile, count, shanten })
  }

  return entries.sort((a, b) => b.count - a.count || a.tile - b.tile)
}

export function ukeireTotalOf(entries: readonly UkeireEntry[]): number {
  let total = 0
  for (const entry of entries) total += entry.count
  return total
}

/**
 * 摸到的牌若与手牌邻域（同花色 ±2）内任何一张都无关联，则必为孤张，
 * 无法参与任何面子或搭子，可直接跳过向听计算。
 */
function mayImproveHand(hand: readonly number[], tile: number, jokerTile: number): boolean {
  if (tile === jokerTile) return true
  if (whiteActsAsJokerTile(jokerTile) && tile === WHITE_DRAGON) return true
  if (!isSuited(tile)) return hand.includes(tile)

  const suit = suitOf(tile)
  for (const held of hand) {
    if (!isSuited(held) || suitOf(held) !== suit) continue
    if (Math.abs(held - tile) <= 2) return true
  }
  return false
}

/**
 * 出牌分析：对每个可打出的牌种，给出打出后的向听数与有效进张，作为教学建议的原始依据。
 */
export function analyzeDiscards(
  hand: readonly number[],
  meldCount: number,
  jokerTile: number,
  seen: readonly number[],
): DiscardOption[] {
  const options: DiscardOption[] = []
  const probe = hand.slice()
  const seenAfter = seen.slice()

  for (let tile = 0; tile < TILE_KINDS; tile++) {
    const index = probe.indexOf(tile)
    if (index === -1) continue
    probe.splice(index, 1)
    seenAfter[tile]++

    const folded = normalize(probe, jokerTile)
    const shanten = shantenCached(folded.counts, folded.wildcards, meldCount)
    const ukeire = calcUkeire(probe, meldCount, jokerTile, seenAfter)

    options.push({ tile, shanten, ukeireTotal: ukeireTotalOf(ukeire), ukeire })

    seenAfter[tile]--
    probe.splice(index, 0, tile)
  }

  return options
}

/** 打牌优劣排序：向听数优先，其次有效进张总张数 */
export function rankDiscards(options: readonly DiscardOption[]): DiscardOption[] {
  return [...options].sort((a, b) => a.shanten - b.shanten || b.ukeireTotal - a.ukeireTotal)
}

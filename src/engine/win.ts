import { canStartRun, countsTotal, MELDS_REQUIRED, TILE_KINDS } from './tiles'

export const WIN_TYPE = {
  STANDARD: 'standard',
  EIGHT_PAIRS: 'eightPairs',
  THREE_JOKERS: 'threeJokers',
} as const
export type WinType = (typeof WIN_TYPE)[keyof typeof WIN_TYPE]

/** 胡牌总张数：5 组面子 + 1 对将 */
export const WIN_TILE_COUNT = MELDS_REQUIRED * 3 + 2
/** 八对牌型的对子数 */
export const EIGHT_PAIRS_COUNT = 8
/** 三财神直接胡牌所需的财神张数 */
export const THREE_JOKERS_COUNT = 3

/**
 * 判断 counts（本色牌，不含万能牌）与 wildcards 张万能牌能否「恰好用完」地拆成
 * needMelds 组面子加一对将。
 *
 * 递归锚定最小非零牌：该牌若入面子，必为刻子成员或以它开头的顺子。它作为顺子中张或末张时，
 * 所缺的前置牌只能由万能牌补，与「本色刻子 + 万能补位」消耗的本色牌和万能牌数量完全相同，
 * 后续剩余手牌状态也一致，故该情形无需枚举，搜索空间由此收敛。
 */
export function canFormExactly(
  counts: number[],
  wildcards: number,
  needMelds: number,
  needPair: boolean,
): boolean {
  let total = wildcards
  for (let tile = 0; tile < TILE_KINDS; tile++) total += counts[tile]
  if (total !== needMelds * 3 + (needPair ? 2 : 0)) return false

  let anchor = -1
  for (let tile = 0; tile < TILE_KINDS; tile++) {
    if (counts[tile] > 0) {
      anchor = tile
      break
    }
  }
  // 本色牌已用尽，余下需求全由万能牌自由补位
  if (anchor === -1) return true

  if (needMelds > 0) {
    const maxTake = Math.min(3, counts[anchor])
    for (let take = maxTake; take >= 1; take--) {
      const gap = 3 - take
      if (gap > wildcards) continue
      counts[anchor] -= take
      const ok = canFormExactly(counts, wildcards - gap, needMelds - 1, needPair)
      counts[anchor] += take
      if (ok) return true
    }

    if (canStartRun(anchor)) {
      const maxTake1 = Math.min(1, counts[anchor + 1])
      const maxTake2 = Math.min(1, counts[anchor + 2])
      for (let take1 = maxTake1; take1 >= 0; take1--) {
        for (let take2 = maxTake2; take2 >= 0; take2--) {
          const gap = 2 - take1 - take2
          if (gap > wildcards) continue
          counts[anchor]--
          counts[anchor + 1] -= take1
          counts[anchor + 2] -= take2
          const ok = canFormExactly(counts, wildcards - gap, needMelds - 1, needPair)
          counts[anchor]++
          counts[anchor + 1] += take1
          counts[anchor + 2] += take2
          if (ok) return true
        }
      }
    }
  }

  if (needPair) {
    if (counts[anchor] >= 2) {
      counts[anchor] -= 2
      const ok = canFormExactly(counts, wildcards, needMelds, false)
      counts[anchor] += 2
      if (ok) return true
    }
    if (wildcards >= 1) {
      counts[anchor]--
      const ok = canFormExactly(counts, wildcards - 1, needMelds, false)
      counts[anchor]++
      if (ok) return true
    }
  }

  return false
}

/** 标准牌型：暗牌补足 (5 - 副露数) 组面子 + 1 对将 */
export function isStandardWin(counts: number[], wildcards: number, meldCount: number): boolean {
  const needMelds = MELDS_REQUIRED - meldCount
  if (needMelds < 0) return false
  return canFormExactly(counts, wildcards, needMelds, true)
}

/**
 * 八对牌型：17 张恰好凑出 8 个对子，余下一张单牌随形。
 * 万能牌可补单张成对，也可两张自成一对。
 */
export function isEightPairs(counts: number[], wildcards: number, meldCount: number): boolean {
  // 八对要求 16 张暗牌全部成对，副露会占掉暗牌位
  if (meldCount > 0) return false
  if (countsTotal(counts) + wildcards !== WIN_TILE_COUNT) return false

  let pairs = 0
  let singles = 0
  for (let tile = 0; tile < TILE_KINDS; tile++) {
    pairs += counts[tile] >> 1
    singles += counts[tile] & 1
  }

  const pairUpSingles = Math.min(wildcards, singles)
  const wildcardPairs = (wildcards - pairUpSingles) >> 1
  return pairs + pairUpSingles + wildcardPairs >= EIGHT_PAIRS_COUNT
}

export function hasThreeJokers(wildcards: number): boolean {
  return wildcards >= THREE_JOKERS_COUNT
}

/** 按牌型价值从高到低择一返回；非胡牌返回 null */
export function detectWinType(counts: number[], wildcards: number, meldCount: number): WinType | null {
  if (hasThreeJokers(wildcards)) return WIN_TYPE.THREE_JOKERS
  if (isEightPairs(counts, wildcards, meldCount)) return WIN_TYPE.EIGHT_PAIRS
  if (isStandardWin(counts, wildcards, meldCount)) return WIN_TYPE.STANDARD
  return null
}

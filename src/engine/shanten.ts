import { canStartRun, MELDS_REQUIRED, TILE_KINDS } from './tiles'

/**
 * 向听数：距离听牌还差的有效牌张数。听牌为 0，已胡为 -1。
 *
 * 推导契约：完成牌型需要 meldsNeeded 组面子与 1 对将。每个成型面子省下 2 张，
 * 每个搭子省下 1 张，将牌省下 1 张，故 shanten = meldsNeeded * 2 - 面子 * 2 - 搭子 - 将。
 * 搭子计入配额时上限为 meldsNeeded，超出的搭子无法再成面子。
 */
export function calcShanten(counts: readonly number[], wildcards: number, meldCount: number): number {
  const meldsNeeded = MELDS_REQUIRED - meldCount
  const ceiling = meldsNeeded * 2 + 1
  const work = counts.slice()
  let bestScore = 0
  let settled = false

  const dfs = (wilds: number, melds: number, partials: number, hasPair: boolean): void => {
    if (settled) return

    const score = melds * 2 + partials + (hasPair ? 1 : 0)
    if (score > bestScore) {
      bestScore = score
      // 满分即牌型已完全成立，不可能更优
      if (bestScore >= ceiling) {
        settled = true
        return
      }
    }

    let remaining = wilds
    for (let tile = 0; tile < TILE_KINDS; tile++) remaining += work[tile]
    const slots = meldsNeeded - melds - partials
    // 乐观上界必须按面子的最高密度 2 分/3 张估算，按 1 分/2 张会低估并剪掉带财神的最优解
    const optimistic = Math.min(slots * 2, Math.floor((remaining * 2) / 3)) + (hasPair ? 0 : 1)
    if (score + optimistic <= bestScore) return

    let anchor = -1
    for (let tile = 0; tile < TILE_KINDS; tile++) {
      if (work[tile] > 0) {
        anchor = tile
        break
      }
    }

    if (anchor === -1) {
      const gain = wildcardGain(wilds, melds, partials, hasPair, meldsNeeded)
      if (gain > bestScore) {
        bestScore = gain
        if (bestScore >= ceiling) settled = true
      }
      return
    }

    const own = work[anchor]

    // 孤张快速路径：无万能牌时，前后邻牌皆无的单张无法参与任何面子或搭子，直接作浮牌略过
    if (wilds === 0 && own === 1) {
      const runnable = canStartRun(anchor)
      if ((!runnable || work[anchor + 1] === 0) && (!runnable || work[anchor + 2] === 0)) {
        work[anchor] = 0
        dfs(wilds, melds, partials, hasPair)
        work[anchor] = 1
        return
      }
    }

    if (melds < meldsNeeded) {
      for (let take = Math.min(3, own); take >= 1; take--) {
        const gap = 3 - take
        if (gap > wilds) continue
        work[anchor] -= take
        dfs(wilds - gap, melds + 1, partials, hasPair)
        work[anchor] += take
        if (settled) return
      }

      if (canStartRun(anchor)) {
        const maxNext = Math.min(1, work[anchor + 1])
        const maxNext2 = Math.min(1, work[anchor + 2])
        for (let take1 = maxNext; take1 >= 0; take1--) {
          for (let take2 = maxNext2; take2 >= 0; take2--) {
            const gap = 2 - take1 - take2
            if (gap > wilds) continue
            work[anchor]--
            work[anchor + 1] -= take1
            work[anchor + 2] -= take2
            dfs(wilds - gap, melds + 1, partials, hasPair)
            work[anchor]++
            work[anchor + 1] += take1
            work[anchor + 2] += take2
            if (settled) return
          }
        }
      }
    }

    if (!hasPair) {
      if (own >= 2) {
        work[anchor] -= 2
        dfs(wilds, melds, partials, true)
        work[anchor] += 2
        if (settled) return
      }
      if (wilds >= 1) {
        work[anchor]--
        dfs(wilds - 1, melds, partials, true)
        work[anchor]++
        if (settled) return
      }
    }

    if (melds + partials < meldsNeeded) {
      if (own >= 2) {
        work[anchor] -= 2
        dfs(wilds, melds, partials + 1, hasPair)
        work[anchor] += 2
        if (settled) return
      }
      if (canStartRun(anchor) && work[anchor + 1] >= 1) {
        work[anchor]--
        work[anchor + 1]--
        dfs(wilds, melds, partials + 1, hasPair)
        work[anchor]++
        work[anchor + 1]++
        if (settled) return
      }
      if (canStartRun(anchor) && work[anchor + 2] >= 1) {
        work[anchor]--
        work[anchor + 2]--
        dfs(wilds, melds, partials + 1, hasPair)
        work[anchor]++
        work[anchor + 2]++
        if (settled) return
      }
      // 单张本色牌配万能牌可成任意搭子（对子、两面或嵌张）
      if (wilds >= 1) {
        work[anchor]--
        dfs(wilds - 1, melds, partials + 1, hasPair)
        work[anchor]++
        if (settled) return
      }
    }

    const saved = work[anchor]
    work[anchor] = 0
    dfs(wilds, melds, partials, hasPair)
    work[anchor] = saved
  }

  dfs(wildcards, 0, 0, false)
  return meldsNeeded * 2 - bestScore
}

/** 本色牌耗尽后，剩余万能牌自由补位的最大得分：面子分值密度最高，其次补将，最后才是搭子 */
function wildcardGain(
  wilds: number,
  melds: number,
  partials: number,
  hasPair: boolean,
  meldsNeeded: number,
): number {
  let remaining = wilds
  let m = melds
  let p = partials
  let pair = hasPair
  while (remaining >= 3 && m + p < meldsNeeded) {
    m++
    remaining -= 3
  }
  if (!pair && remaining >= 2) {
    pair = true
    remaining -= 2
  }
  while (remaining >= 2 && m + p < meldsNeeded) {
    p++
    remaining -= 2
  }
  return m * 2 + p + (pair ? 1 : 0)
}

const shantenCache = new Map<string, number>()
const SHANTEN_CACHE_LIMIT = 20000

function cacheKey(counts: readonly number[], wildcards: number, meldCount: number): string {
  return `${counts.join('')}|${wildcards}|${meldCount}`
}

/** 带缓存的向听计算，进张与出牌分析会高频复用同一手牌形态 */
export function shantenCached(counts: readonly number[], wildcards: number, meldCount: number): number {
  const key = cacheKey(counts, wildcards, meldCount)
  const hit = shantenCache.get(key)
  if (hit !== undefined) return hit
  const value = calcShanten(counts, wildcards, meldCount)
  if (shantenCache.size >= SHANTEN_CACHE_LIMIT) shantenCache.clear()
  shantenCache.set(key, value)
  return value
}

import { isHonor } from './tiles'

/**
 * 可打出的牌种。
 *
 * 温州本地契约：只有跟打目标存在时才受限，其余情况自由出牌。
 * 财神是万能牌，既不会被强制打出，也不会因此失去出牌自由。
 */
export function legalDiscards(hand: readonly number[], followHonor: number | null): number[] {
  return followHonor === null ? [...new Set(hand)] : [followHonor]
}

/**
 * 跟打目标：牌河末张为字牌、且手中该种牌恰好一张时必须跟打该张。
 * 成对成刻的字牌能组成面子，不拆对；打出数牌后跟打约束即刻解除。
 * 财神为万能牌，不构成跟打目标。
 */
export function nextFollowHonor(
  lastDiscard: number | null,
  jokerTile: number,
  hand: readonly number[],
): number | null {
  if (lastDiscard === null || lastDiscard === jokerTile || !isHonor(lastDiscard)) return null
  return hand.filter((tile) => tile === lastDiscard).length === 1 ? lastDiscard : null
}

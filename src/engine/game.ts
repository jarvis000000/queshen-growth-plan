import { effectiveTile, normalize } from './joker'
import {
  ADD_KONG_TILES,
  AN_KONG_TILES,
  canKong,
  canPong,
  collectSupport,
  findAddKongTiles,
  findAnKongTiles,
  findChowOptions,
  KONG_FROM_HAND,
  MELD_KIND,
  meldTilesOf,
  PONG_FROM_HAND,
  type Meld,
} from './meld'
import { nextFollowHonor } from './rules'
import { scoreWin, shareScore, UNIT, type ScoreResult } from './score'
import { createWall, isHonor, shuffle } from './tiles'
import { createSeenCounter } from './ukeire'
import { shantenCached } from './shanten'
import { detectWinType, type WinType } from './win'

export const SEATS = 4
/** 闲家起手 16 张，庄家起手 17 张 */
export const HAND_SIZE = 16
/** 牌墙末尾保留张数，流局判定以此为界 */
export const RESERVED_WALL = 16

export const SEAT_LABELS = ['东', '南', '西', '北']

export interface PlayerState {
  seat: number
  hand: number[]
  melds: Meld[]
  discards: number[]
  /** 刚摸进手牌的那张，出牌后清空；供界面单独标记 */
  drawnTile: number | null
  /** 已报听：手牌锁死（不可吃碰杠、只能摸切），摸打自动胡牌 */
  declaredReady: boolean
}

export interface PendingDiscard {
  tile: number
  from: number
}

export interface WinRecord {
  seat: number
  /** 放炮者座位；自摸为 null */
  from: number | null
  tile: number
  winType: WinType
  score: ScoreResult
}

export interface GameResult {
  draw: boolean
  winners: WinRecord[]
  /** 四家本局净变化，含杠分、跟打罚分与放炮罚分；恒为零和 */
  deltas: number[]
}

export interface GameState {
  players: PlayerState[]
  wall: number[]
  /** 已摸走的牌墙位置 */
  wallCursor: number
  jokerTile: number
  dealer: number
  /** 当前连庄次数，0 表示未连庄；得分按 ×2ⁿ 放大 */
  dealerStreak: number
  /** 本局各家累计的即时固定分（杠分、四连跟打罚分），局末并入 deltas */
  instantPoints: number[]
  turn: number
  /** 待响应的打牌；null 表示当前处于摸牌阶段 */
  pending: PendingDiscard | null
  /** 最近打出的牌，驱动跟打判定 */
  lastDiscard: number | null
  /** 打出 lastDiscard 的座位，与 lastDiscard 成对更新，不随回合推进而改变 */
  lastDiscardSeat: number | null
  /**
   * 牌河上连续同种字牌的进度：key 为等效牌种，starter 为连打起点即首张的出牌者。
   * 满四张时结算跟打罚分并清空；牌被吃碰杠拿走时同样清空。
   */
  followChain: { key: number; count: number; starter: number } | null
  result: GameResult | null
}

/**
 * 玩家视角快照：只包含该座位可见的信息。
 * AI 决策一律基于此结构，其他玩家的手牌在类型层面即不可达，从架构上杜绝作弊。
 */
export interface PlayerView {
  seat: number
  hand: number[]
  melds: Meld[]
  jokerTile: number
  discards: number[][]
  meldsBySeat: Meld[][]
  wallRemaining: number
  lastDiscard: number | null
  pendingHonor: number | null
  turn: number
}

function emptyPlayer(seat: number): PlayerState {
  return { seat, hand: [], melds: [], discards: [], drawnTile: null, declaredReady: false }
}

/** 按归位值理牌：白板跟随财神原牌归位，其余按本色牌值 */
export function sortHand(hand: number[], jokerTile: number): number[] {
  return hand.sort((a, b) => effectiveTile(a, jokerTile) - effectiveTile(b, jokerTile))
}

export function createGame(random: () => number = Math.random, dealer = 0, dealerStreak = 0): GameState {
  const wall = shuffle(createWall(), random)
  const jokerTile = wall[Math.floor(random() * wall.length)]

  const players = Array.from({ length: SEATS }, (_, seat) => emptyPlayer(seat))
  let cursor = 0
  for (let round = 0; round < HAND_SIZE; round++) {
    for (let seat = 0; seat < SEATS; seat++) players[seat].hand.push(wall[cursor++])
  }
  players[dealer].hand.push(wall[cursor++])
  players.forEach((player) => sortHand(player.hand, jokerTile))

  return {
    players,
    wall,
    wallCursor: cursor,
    jokerTile,
    dealer,
    dealerStreak,
    instantPoints: Array.from({ length: SEATS }, () => 0),
    turn: dealer,
    pending: null,
    lastDiscard: null,
    lastDiscardSeat: null,
    followChain: null,
    result: null,
  }
}

export function wallRemaining(state: GameState): number {
  return Math.max(0, state.wall.length - RESERVED_WALL - state.wallCursor)
}

export function isDraw(state: GameState): boolean {
  return wallRemaining(state) <= 0
}

export function drawTile(state: GameState, seat: number): number | null {
  if (state.wallCursor >= state.wall.length) return null
  const tile = state.wall[state.wallCursor++]
  const player = state.players[seat]
  const insertAt = player.hand.findIndex(
    (held) => effectiveTile(held, state.jokerTile) > effectiveTile(tile, state.jokerTile),
  )
  player.hand.splice(insertAt === -1 ? player.hand.length : insertAt, 0, tile)
  player.drawnTile = tile
  return tile
}

export function applyDiscard(state: GameState, seat: number, tile: number): boolean {
  const player = state.players[seat]
  const index = player.hand.indexOf(tile)
  if (index === -1) return false
  player.hand.splice(index, 1)
  player.discards.push(tile)
  player.drawnTile = null
  state.lastDiscard = tile
  state.lastDiscardSeat = seat
  state.pending = { tile, from: seat }
  state.turn = seat
  advanceFollowChain(state, seat, tile)
  return true
}

/**
 * 四连跟打：同一种字牌连续被打出四张时，首张的出牌者向其余三家各赔一份。
 * 与是否受跟打规则强制无关 —— 成对成刻主动拆打、刚摸到直接打出同样计入。
 */
function advanceFollowChain(state: GameState, seat: number, tile: number): void {
  const key = effectiveTile(tile, state.jokerTile)
  if (!isHonor(key)) {
    state.followChain = null
    return
  }
  const chain = state.followChain
  if (chain?.key !== key) {
    state.followChain = { key, count: 1, starter: seat }
    return
  }
  chain.count += 1
  if (chain.count < SEATS) return
  settleFollowChain(state, chain.starter)
  state.followChain = null
}

export function clearPending(state: GameState): void {
  state.pending = null
}

export const CLAIM_PRIORITY = { win: 3, kong: 2, pong: 1, chow: 0 } as const
export type ClaimKind = keyof typeof CLAIM_PRIORITY

export interface ClaimOption {
  seat: number
  kind: ClaimKind
  /** 该响应会从手牌里用掉的牌；胡牌不耗手牌，故缺省 */
  tiles?: number[]
}


/** 按逆时针顺序列出其他玩家对 pending 打牌的可行响应 */
export function findClaims(state: GameState): ClaimOption[] {
  const pending = state.pending
  if (!pending) return []
  const options: ClaimOption[] = []

  for (let offset = 1; offset < SEATS; offset++) {
    const seat = (pending.from + offset) % SEATS
    const player = state.players[seat]

    if (detectWinType(...winArgsFor(player, pending.tile, state.jokerTile))) {
      options.push({ seat, kind: 'win' })
    }
    if (canKong(player.hand, pending.tile, state.jokerTile)) {
      options.push({ seat, kind: 'kong', tiles: collectSupport(player.hand, pending.tile, state.jokerTile, KONG_FROM_HAND) })
    }
    if (canPong(player.hand, pending.tile, state.jokerTile)) {
      options.push({ seat, kind: 'pong', tiles: collectSupport(player.hand, pending.tile, state.jokerTile, PONG_FROM_HAND) })
    }
    // 吃仅限下家
    if (offset === 1) {
      for (const combo of findChowOptions(player.hand, pending.tile, state.jokerTile)) {
        options.push({ seat, kind: 'chow', tiles: combo })
      }
    }
  }
  return options
}

function winArgsFor(player: PlayerState, tile: number, jokerTile: number): [number[], number, number] {
  const folded = normalize([...player.hand, tile], jokerTile)
  return [folded.counts, folded.wildcards, player.melds.length]
}

export function canWinOn(player: PlayerState, tile: number, jokerTile: number): WinType | null {
  return detectWinType(...winArgsFor(player, tile, jokerTile))
}

export function canSelfWin(player: PlayerState, jokerTile: number): WinType | null {
  const folded = normalize(player.hand, jokerTile)
  return detectWinType(folded.counts, folded.wildcards, player.melds.length)
}

/** 能否报听：手牌确已听牌，且尚未报听 */
export function canDeclareReady(state: GameState, seat: number): boolean {
  const player = state.players[seat]
  if (player.declaredReady) return false
  const folded = normalize(player.hand, state.jokerTile)
  return shantenCached(folded.counts, folded.wildcards, player.melds.length) === 0
}

export interface SelfActions {
  winType: WinType | null
  anKongs: number[]
  addKongs: number[]
}

export function findSelfActions(state: GameState, seat: number): SelfActions {
  const player = state.players[seat]
  return {
    winType: canSelfWin(player, state.jokerTile),
    anKongs: findAnKongTiles(player.hand, state.jokerTile),
    addKongs: findAddKongTiles(player.hand, player.melds, state.jokerTile),
  }
}

function removeTiles(hand: number[], tiles: readonly number[]): void {
  for (const tile of tiles) {
    const index = hand.indexOf(tile)
    if (index !== -1) hand.splice(index, 1)
  }
}

/** 被吃碰杠走的牌要从供牌者的牌河里撤下 */
function reclaimDiscard(state: GameState, from: number, tile: number): void {
  const discards = state.players[from].discards
  const index = discards.lastIndexOf(tile)
  if (index !== -1) discards.splice(index, 1)
  // 牌河被撤走一张，连续同种字牌的链条不复成立
  state.followChain = null
}

/**
 * 杠分：其他三家各付一份，杠家收其余额（三家之和）。
 * 暗杠按两份计，故杠家实得 6 份；加杠的第四张已副露，与明杠同价。
 */
function settleKongPoints(state: GameState, seat: number, concealed: boolean): void {
  const unit = shareScore(concealed ? UNIT.CONCEALED_KONG : UNIT.EXPOSED_KONG)
  for (let other = 0; other < SEATS; other++) {
    if (other === seat) continue
    state.instantPoints[other] -= unit
    state.instantPoints[seat] += unit
  }
}

/**
 * 四连跟打罚分：按三家均分总额，故逐家对扣加即为零和。
 * 与杠分同为固定分，不参与胡牌倍数。
 */
function settleFollowChain(state: GameState, starter: number): void {
  const unit = shareScore(UNIT.FOLLOW_CHAIN) / (SEATS - 1)
  for (let other = 0; other < SEATS; other++) {
    if (other === starter) continue
    state.instantPoints[other] += unit
    state.instantPoints[starter] -= unit
  }
}

/**
 * 财神分：按暗牌中的财神张数，由持有者向其他三家各收一份。
 * 副露中的财神不计；与胡牌无关，故流局同样结算。
 */
function applyJokerPoints(
  state: GameState,
  deltas: number[],
  winnerSeat: number,
  winnerTiles: readonly number[],
): void {
  for (let holder = 0; holder < SEATS; holder++) {
    const tiles = holder === winnerSeat ? winnerTiles : state.players[holder].hand
    const unit = shareScore(UNIT.JOKER) * normalize(tiles, state.jokerTile).wildcards
    if (unit === 0) continue
    for (let other = 0; other < SEATS; other++) {
      if (other === holder) continue
      deltas[other] -= unit
      deltas[holder] += unit
    }
  }
}

/**
 * 分家结算：三家各付一份「底分 × 倍数」，点炮者额外多付一份罚分；
 * 财神分与即时固定分只跟底分相关、不参与倍数，叠加后恒为零和。
 */
function settlementOf(
  state: GameState,
  record: WinRecord,
  winnerTiles: readonly number[],
): number[] {
  const { seat, from, score } = record
  const deltas = state.instantPoints.slice()
  applyJokerPoints(state, deltas, seat, winnerTiles)

  const share = shareScore(score.multiplier)
  for (let other = 0; other < SEATS; other++) {
    if (other === seat) continue
    deltas[other] -= share
    deltas[seat] += share
  }
  // 放炮者多担一份罚分
  if (from !== null) {
    deltas[from] -= share
    deltas[seat] += share
  }
  return deltas
}

export function applyPong(state: GameState, seat: number): boolean {
  const pending = state.pending
  if (!pending) return false
  const player = state.players[seat]
  const used = collectSupport(player.hand, pending.tile, state.jokerTile, PONG_FROM_HAND)
  if (used.length < 2) return false

  removeTiles(player.hand, used)
  player.melds.push({ kind: MELD_KIND.PONG, tiles: [pending.tile, ...used], from: pending.from })
  reclaimDiscard(state, pending.from, pending.tile)
  state.turn = seat
  state.pending = null
  return true
}

export function applyChow(state: GameState, seat: number, tiles: readonly number[]): boolean {
  const pending = state.pending
  if (!pending) return false
  const player = state.players[seat]
  if (!tiles.every((tile) => player.hand.includes(tile))) return false

  removeTiles(player.hand, tiles)
  player.melds.push({
    kind: MELD_KIND.CHOW,
    tiles: [...tiles, pending.tile].sort((a, b) => a - b),
    from: pending.from,
  })
  reclaimDiscard(state, pending.from, pending.tile)
  state.turn = seat
  state.pending = null
  return true
}

export function applyKong(state: GameState, seat: number): number | null {
  const pending = state.pending
  if (!pending) return null
  const player = state.players[seat]
  const used = collectSupport(player.hand, pending.tile, state.jokerTile, KONG_FROM_HAND)
  if (used.length < KONG_FROM_HAND) return null

  removeTiles(player.hand, used)
  player.melds.push({ kind: MELD_KIND.KONG, tiles: [pending.tile, ...used], from: pending.from })
  reclaimDiscard(state, pending.from, pending.tile)
  settleKongPoints(state, seat, false)
  state.turn = seat
  state.pending = null
  return drawTile(state, seat)
}

export function applyAnKong(state: GameState, seat: number, tile: number): number | null {
  const player = state.players[seat]
  const used = collectSupport(player.hand, tile, state.jokerTile, AN_KONG_TILES)
  if (used.length < AN_KONG_TILES) return null
  removeTiles(player.hand, used)
  player.melds.push({ kind: MELD_KIND.AN_KONG, tiles: used, from: null })
  settleKongPoints(state, seat, true)
  return drawTile(state, seat)
}

/** 加杠：在已碰出的刻子上补第四张，随后补牌 */
export function applyAddKong(state: GameState, seat: number, tile: number): number | null {
  const player = state.players[seat]
  const meld = player.melds.find((item) => item.kind === MELD_KIND.PONG && item.tiles[0] === tile)
  if (!meld) return null
  const used = collectSupport(player.hand, tile, state.jokerTile, ADD_KONG_TILES)
  if (used.length < ADD_KONG_TILES) return null

  removeTiles(player.hand, used)
  meld.kind = MELD_KIND.KONG
  meld.tiles = [...meld.tiles, ...used]
  settleKongPoints(state, seat, false)
  return drawTile(state, seat)
}

export function settleWin(
  state: GameState,
  seat: number,
  from: number | null,
  tile: number,
  winType: WinType,
  /** 本手胡牌的摸牌来自连开杠的补牌：0 为普通摸牌，1 为杠开，2 及以上为二连杠 */
  kongChain = 0,
): WinRecord {
  const player = state.players[seat]
  const allTiles = [...player.hand, ...meldTilesOf(player.melds), tile]
  const folded = normalize(allTiles, state.jokerTile)

  const score = scoreWin({
    winType,
    counts: folded.counts,
    wildcards: folded.wildcards,
    meldCount: player.melds.length,
    jokerTile: state.jokerTile,
    allTiles,
    selfDraw: from === null,
    dealerStreak: state.dealerStreak,
    kongChain,
  })

  if (from === null) {
    player.hand.push(tile)
    sortHand(player.hand, state.jokerTile)
  } else {
    reclaimDiscard(state, from, tile)
  }

  const record: WinRecord = { seat, from, tile, winType, score }
  // 自摸时赢牌张已并入暗牌，点炮时需补上才能与手牌一起计入财神
  const winnerTiles = from === null ? player.hand : [...player.hand, tile]
  state.result = { draw: false, winners: [record], deltas: settlementOf(state, record, winnerTiles) }
  state.pending = null
  return record
}

export function settleDraw(state: GameState): void {
  const deltas = state.instantPoints.slice()
  applyJokerPoints(state, deltas, -1, [])
  state.result = { draw: true, winners: [], deltas }
  state.pending = null
}

export function viewFor(state: GameState, seat: number): PlayerView {
  const player = state.players[seat]
  return {
    seat,
    hand: [...player.hand],
    melds: player.melds.map((meld) => ({ ...meld, tiles: [...meld.tiles] })),
    jokerTile: state.jokerTile,
    discards: state.players.map((other) => [...other.discards]),
    meldsBySeat: state.players.map((other) => other.melds.map((meld) => ({ ...meld, tiles: [...meld.tiles] }))),
    wallRemaining: wallRemaining(state),
    lastDiscard: state.lastDiscard,
    pendingHonor: nextFollowHonor(state.lastDiscard, state.jokerTile, player.hand),
    turn: state.turn,
  }
}

/**
 * 已见张数：自己手牌、四家牌河、四家副露，以及翻出的财神标记牌。
 */
export function seenCounterFor(state: GameState, seat: number): number[] {
  const seen = createSeenCounter()
  for (const tile of state.players[seat].hand) seen[tile]++
  for (const player of state.players) {
    for (const tile of player.discards) seen[tile]++
    for (const meld of player.melds) {
      for (const tile of meld.tiles) seen[tile]++
    }
  }
  seen[state.jokerTile]++
  return seen
}

/** 牌河与副露中出现的所有牌，用于花色判定 */
export function visibleTilesOf(state: GameState, seat: number): number[] {
  const tiles = [...state.players[seat].hand]
  for (const player of state.players) {
    tiles.push(...player.discards)
    tiles.push(...meldTilesOf(player.melds))
  }
  return tiles
}

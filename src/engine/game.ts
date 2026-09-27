import { handSortValue, normalize } from './joker'
import {
  canKong,
  canPong,
  collectSupport,
  findAddKongTiles,
  findAnKongTiles,
  findChowOptions,
  MELD_KIND,
  meldTilesOf,
  type Meld,
} from './meld'
import { nextFollowHonor } from './rules'
import { scoreWin, type ScoreResult } from './score'
import { createWall, shuffle } from './tiles'
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
}

export interface GameState {
  players: PlayerState[]
  wall: number[]
  /** 已摸走的牌墙位置 */
  wallCursor: number
  jokerTile: number
  dealer: number
  turn: number
  /** 待响应的打牌；null 表示当前处于摸牌阶段 */
  pending: PendingDiscard | null
  /** 最近打出的牌，驱动跟打判定 */
  lastDiscard: number | null
  /** 打出 lastDiscard 的座位，与 lastDiscard 成对更新，不随回合推进而改变 */
  lastDiscardSeat: number | null
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
  return hand.sort((a, b) => handSortValue(a, jokerTile) - handSortValue(b, jokerTile))
}

export function createGame(random: () => number = Math.random, dealer = 0): GameState {
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
    turn: dealer,
    pending: null,
    lastDiscard: null,
    lastDiscardSeat: null,
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
    (held) => handSortValue(held, state.jokerTile) > handSortValue(tile, state.jokerTile),
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
  return true
}

export function clearPending(state: GameState): void {
  state.pending = null
}

export const CLAIM_PRIORITY = { win: 3, kong: 2, pong: 1, chow: 0 } as const
export type ClaimKind = keyof typeof CLAIM_PRIORITY

export interface ClaimOption {
  seat: number
  kind: ClaimKind
  /** 吃牌时使用的手牌组合 */
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
    if (canKong(player.hand, pending.tile, state.jokerTile)) options.push({ seat, kind: 'kong' })
    if (canPong(player.hand, pending.tile, state.jokerTile)) options.push({ seat, kind: 'pong' })
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
}

export function applyPong(state: GameState, seat: number): boolean {
  const pending = state.pending
  if (!pending) return false
  const player = state.players[seat]
  const used = collectSupport(player.hand, pending.tile, state.jokerTile, 2)
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
  const used = collectSupport(player.hand, pending.tile, state.jokerTile, 3)
  if (used.length < 3) return null

  removeTiles(player.hand, used)
  player.melds.push({ kind: MELD_KIND.KONG, tiles: [pending.tile, ...used], from: pending.from })
  reclaimDiscard(state, pending.from, pending.tile)
  state.turn = seat
  state.pending = null
  return drawTile(state, seat)
}

export function applyAnKong(state: GameState, seat: number, tile: number): number | null {
  const player = state.players[seat]
  const used = collectSupport(player.hand, tile, state.jokerTile, 4)
  if (used.length < 4) return null
  removeTiles(player.hand, used)
  player.melds.push({ kind: MELD_KIND.AN_KONG, tiles: used, from: null })
  return drawTile(state, seat)
}

/** 加杠：在已碰出的刻子上补第四张，随后补牌 */
export function applyAddKong(state: GameState, seat: number, tile: number): number | null {
  const player = state.players[seat]
  const meld = player.melds.find((item) => item.kind === MELD_KIND.PONG && item.tiles[0] === tile)
  if (!meld) return null
  const used = collectSupport(player.hand, tile, state.jokerTile, 1)
  if (used.length < 1) return null

  removeTiles(player.hand, used)
  meld.kind = MELD_KIND.KONG
  meld.tiles = [...meld.tiles, ...used]
  return drawTile(state, seat)
}

export function settleWin(
  state: GameState,
  seat: number,
  from: number | null,
  tile: number,
  winType: WinType,
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
  })

  if (from === null) {
    player.hand.push(tile)
    sortHand(player.hand, state.jokerTile)
  } else {
    reclaimDiscard(state, from, tile)
  }

  const record: WinRecord = { seat, from, tile, winType, score }
  state.result = { draw: false, winners: [record] }
  state.pending = null
  return record
}

export function settleDraw(state: GameState): void {
  state.result = { draw: true, winners: [] }
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

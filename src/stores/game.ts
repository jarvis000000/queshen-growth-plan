import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import {
  adviseDiscard,
  chooseDiscard,
  DIFFICULTY,
  shouldClaim,
  type Difficulty,
  type DiscardAdvice,
  type DiscardCandidate,
} from '../engine/ai'
import {
  applyAddKong,
  applyAnKong,
  applyChow,
  applyDiscard,
  applyKong,
  applyPong,
  canDeclareReady,
  canWinOn,
  CLAIM_PRIORITY,
  createGame,
  drawTile,
  findClaims,
  findSelfActions,
  isDraw,
  SEAT_LABELS,
  SEATS,
  settleDraw,
  settleWin,
  viewFor,
  wallRemaining,
  type ClaimKind,
  type ClaimOption,
  type GameResult,
  type GameState,
} from '../engine/game'
import { collectSupport, meldTilesOf } from '../engine/meld'
import { readOpponent, type OpponentRead } from '../engine/read'
import { legalDiscards, nextFollowHonor } from '../engine/rules'
import { tileName } from '../engine/tiles'
import { loadJson, saveJson } from './persist'
import { recordDiscard, recordGame, type DiscardRating } from './stats'

export const HUMAN_SEAT = 0

/** 重开时用来唤醒挂起等待的哨兵牌值，收到它即代表本局已作废 */
const ABORT_TILE = -1

/** 出牌建议与最优解的分差达到该值时才提示玩家 */
const ADVICE_ALERT_GAP = 12
/** 建议前若干名都算「最佳选择」，不必强求打出唯一最优的那张 */
export const BEST_RANK_LIMIT = 3

const SETTINGS_KEY = 'queshen-settings'

export interface GameSettings {
  /** 出牌偏离最优解时弹出胜率对比 */
  adviceAlert: boolean
  /** 悬停手牌显示该张胜率与是否为最佳出牌 */
  hoverRate: boolean
  /** 高亮推荐打出的牌 */
  highlightBest: boolean
  /** 摸鱼模式：隐藏图形界面，改为纯文字命令行交互 */
  plainMode: boolean
}

const DEFAULT_SETTINGS: GameSettings = {
  adviceAlert: true,
  hoverRate: true,
  highlightBest: true,
  plainMode: false,
}

function loadSettings(): GameSettings {
  return loadJson(SETTINGS_KEY, DEFAULT_SETTINGS)
}

export interface ClaimPrompt {
  options: ClaimOption[]
  tile: number
  /** 人类手牌确已听牌且尚未报听时可选择报听 */
  canDeclareReady: boolean
}

export interface KongPrompt {
  anKongs: number[]
  addKongs: number[]
}

function thinkDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const useGameStore = defineStore('game', () => {
  const state = ref<GameState>(createGame())
  const difficulty = ref<Difficulty>(DIFFICULTY.NORMAL)
  const running = ref(false)
  const settings = ref<GameSettings>(loadSettings())

  const advice = ref<DiscardAdvice | null>(null)
  const advicePending = ref(false)
  const claimPrompt = ref<ClaimPrompt | null>(null)
  const kongPrompt = ref<KongPrompt | null>(null)
  const selfWinPrompt = ref(false)
  const opponentRead = ref<OpponentRead | null>(null)
  const focusSeat = ref<number | null>(null)

  let discardResolver: ((tile: number) => void) | null = null
  let claimResolver: ((accepted: ClaimOption | null) => void) | null = null
  let kongResolver: ((tile: number | null) => void) | null = null
  let selfWinResolver: ((accepted: boolean) => void) | null = null
  let advicePromise: Promise<void> | null = null
  /** 对局代次：重开时自增，旧循环据此在下一个检查点自行退出 */
  let generation = 0

  /** 庄家座位与连庄次数：跨局保留，故不放进每局重建的 state */
  const dealer = ref(0)
  const dealerStreak = ref(0)

  watch(settings, (value) => saveJson(SETTINGS_KEY, value), { deep: true })

  // 每局结算时记一次战绩并转交庄位。result 由 null 变为全新对象即代表本局已结束，
  // 重开时被 createGame() 清为 null，判真值即可避免重复计数
  watch(
    () => state.value.result,
    (result) => {
      if (!result) return
      recordGame(result, HUMAN_SEAT)
      advanceDealer(result)
    },
  )

  /**
   * 轮庄：庄家胡牌则连庄次数 +1（庄位不变），闲家胡牌则庄家下庄给下家且连庄归零。
   * 流局无胡牌，庄位与连庄次数都不变。
   */
  function advanceDealer(result: GameResult): void {
    if (result.draw) return
    if (result.winners[0]?.seat === dealer.value) {
      dealerStreak.value++
      return
    }
    dealer.value = (dealer.value + 1) % SEATS
    dealerStreak.value = 0
  }

  const human = computed(() => state.value.players[HUMAN_SEAT])
  const followHonor = computed(() =>
    nextFollowHonor(state.value.lastDiscard, state.value.jokerTile, human.value.hand),
  )
  const legalTiles = computed(() => {
    const player = human.value
    // 报听期间只能摸切；drawnTile 为空（庄家首回合等）时不加此约束，避免无牌可打
    if (player.declaredReady && player.drawnTile !== null) return new Set([player.drawnTile])
    return new Set(legalDiscards(player.hand, followHonor.value))
  })
  const awaitingHumanDiscard = ref(false)
  /**
   * 轮到玩家的序号，每次进入出牌等待即自增。
   * 布尔标志在「重开」时会连续经历 true→false→true 而被响应式批处理合并掉，
   * 文字界面据此监听会漏掉整局，故改用单调递增的计数。
   */
  const turnSeq = ref(0)
  /** 报听时刻的已出牌张数：据此判断「下一次自己出牌之前」的取消窗口是否还开着 */
  const readyDiscardMark = ref(-1)
  const isHumanTurn = computed(() => running.value && !state.value.result && state.value.turn === HUMAN_SEAT)
  const canDiscard = computed(() => awaitingHumanDiscard.value && !state.value.result)
  const wallLeft = computed(() => wallRemaining(state.value))
  /** 报听可否取消：出牌张数未变即仍在「下一次自己出牌之前」 */
  const canCancelReady = computed(
    () => human.value.declaredReady && human.value.discards.length === readyDiscardMark.value,
  )
  /** 本局四家净变化，双界面共用 */
  const settlementText = computed(() => {
    const deltas = state.value.result?.deltas
    if (!deltas) return ''
    return deltas
      .map((value, seat) => `${SEAT_LABELS[seat]}${value > 0 ? `+${value}` : value}`)
      .join('  ')
  })

  function viewOfHuman() {
    return viewFor(state.value, HUMAN_SEAT)
  }

  function seatName(seat: number): string {
    return SEAT_LABELS[seat]
  }

  function isDealer(seat: number): boolean {
    return seat === dealer.value
  }

  function relativeLabel(seat: number): string {
    if (seat === HUMAN_SEAT) return '本家'
    const offset = (seat - HUMAN_SEAT + SEATS) % SEATS
    return offset === 1 ? '下家' : offset === 2 ? '对家' : '上家'
  }

  function reset(): void {
    // 代次自增让旧循环在下一个检查点失效，再唤醒它挂起的所有等待
    generation++
    discardResolver?.(ABORT_TILE)
    claimResolver?.(null)
    kongResolver?.(null)
    selfWinResolver?.(false)
    discardResolver = null
    claimResolver = null
    kongResolver = null
    selfWinResolver = null

    state.value = createGame(Math.random, dealer.value, dealerStreak.value)
    advice.value = null
    advicePending.value = false
    claimPrompt.value = null
    kongPrompt.value = null
    selfWinPrompt.value = false
    opponentRead.value = null
    focusSeat.value = null
    running.value = false
    awaitingHumanDiscard.value = false
    advicePromise = null
  }

  async function start(): Promise<void> {
    reset()
    const currentGeneration = generation
    running.value = true
    await gameLoop(currentGeneration)
  }

  async function gameLoop(gen: number): Promise<void> {
    const game = state.value
    let currentSeat = game.dealer
    // 庄家起手 17 张，首回合直接出牌
    let mustDraw = false

    while (!game.result) {
      if (gen !== generation) return
      if (mustDraw) {
        const drawn = drawTile(game, currentSeat)
        if (drawn === null || isDraw(game)) {
          settleDraw(game)
          break
        }
        if (await resolveSelfWin(currentSeat, drawn)) break

        // 杠后可连续补牌，补牌同样可能自摸或再次具备杠的条件
        let kong = await resolveSelfKong(currentSeat)
        let kongChain = 0
        let kongEnded = false
        while (kong) {
          const supplement =
            kong.kind === 'an'
              ? applyAnKong(game, currentSeat, kong.tile)
              : applyAddKong(game, currentSeat, kong.tile)
          if (supplement === null) break
          kongChain++
          if (await resolveSelfWin(currentSeat, supplement, kongChain)) {
            kongEnded = true
            break
          }
          kong = await resolveSelfKong(currentSeat)
        }
        if (kongEnded) break
      }

      const tile = await decideDiscard(currentSeat)
      if (gen !== generation || tile === ABORT_TILE) return
      if (game.result) break
      applyDiscard(game, currentSeat, tile)
      advice.value = null
      advicePending.value = false

      const claim = await resolveClaims()
      if (gen !== generation) return
      if (game.result) break

      if (claim) {
        // 杠已在结算时补牌，吃碰后直接轮到该家出牌
        currentSeat = claim.seat
        mustDraw = false
      } else {
        game.pending = null
        currentSeat = (currentSeat + 1) % SEATS
        mustDraw = true
      }
      // 界面依赖 state.turn 判断当前行动方，必须与循环内的座位保持同步
      game.turn = currentSeat
    }
    // 旧循环结束时不得覆盖新对局的运行标记
    if (gen === generation) running.value = false
  }

  /** 摸牌后的自摸结算；人类玩家需确认，报听者自动成立 */
  async function resolveSelfWin(seat: number, drawnTile: number, kongChain = 0): Promise<boolean> {
    const game = state.value
    const actions = findSelfActions(game, seat)
    if (!actions.winType) return false

    if (seat !== HUMAN_SEAT || human.value.declaredReady) {
      settleWin(game, seat, null, drawnTile, actions.winType, kongChain)
      return true
    }

    selfWinPrompt.value = true
    const accepted = await new Promise<boolean>((resolve) => {
      selfWinResolver = resolve
    })
    selfWinPrompt.value = false
    if (!accepted) return false

    settleWin(game, seat, null, drawnTile, actions.winType, kongChain)
    return true
  }

  /**
   * 摸牌后的杠决策。暗杠财神等于把万能牌钉死成刻子，属明显亏损，AI 主动回避。
   */
  async function resolveSelfKong(seat: number): Promise<{ tile: number; kind: 'an' | 'add' } | null> {
    const game = state.value
    // 报听锁死手牌：暗杠/加杠都会改动手牌，一律不补
    if (game.players[seat].declaredReady) return null
    const actions = findSelfActions(game, seat)
    const options = [
      ...actions.anKongs.map((tile) => ({ tile, kind: 'an' as const })),
      ...actions.addKongs.map((tile) => ({ tile, kind: 'add' as const })),
    ].filter((option) => option.tile !== game.jokerTile)
    if (options.length === 0) return null

    if (seat !== HUMAN_SEAT) return options[0] ?? null

    kongPrompt.value = {
      anKongs: actions.anKongs.filter((tile) => tile !== game.jokerTile),
      addKongs: actions.addKongs.filter((tile) => tile !== game.jokerTile),
    }
    const picked = await new Promise<number | null>((resolve) => {
      kongResolver = resolve
    })
    kongPrompt.value = null
    if (picked === null) return null
    return options.find((option) => option.tile === picked) ?? null
  }

  function answerKong(tile: number | null): void {
    const resolve = kongResolver
    kongResolver = null
    kongPrompt.value = null
    resolve?.(tile)
  }

  function decideDiscard(seat: number): Promise<number> {
    const game = state.value
    if (seat !== HUMAN_SEAT) {
      awaitingHumanDiscard.value = false
      return thinkDelay(420 + Math.round(Math.random() * 320)).then(
        () => chooseDiscard(viewFor(game, seat), difficulty.value).tile,
      )
    }
    awaitingHumanDiscard.value = true
    turnSeq.value++
    // 每次轮到玩家出牌都重算建议，点击手牌时才有依据即时给出提示
    scheduleAdvice()
    return new Promise<number>((resolve) => {
      discardResolver = resolve
    })
  }

  /** 建议计算放到下一轮事件循环，避免阻塞出牌动画与渲染 */
  function scheduleAdvice(): void {
    advice.value = null
    advicePending.value = true
    advicePromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        advice.value = adviseDiscard(viewOfHuman())
        advicePending.value = false
        resolve()
      }, 0)
    })
  }

  /** 直接产出某家的牌型推断，供文字界面调用 */
  function readSeat(seat: number): OpponentRead {
    return readOpponent(viewOfHuman(), seat)
  }

  function scheduleOpponentRead(seat: number): void {
    opponentRead.value = null
    focusSeat.value = seat
    setTimeout(() => {
      opponentRead.value = readOpponent(viewOfHuman(), seat)
    }, 0)
  }

  function clearOpponentRead(): void {
    opponentRead.value = null
    focusSeat.value = null
  }

  function isLegalDiscard(tile: number): boolean {
    return legalTiles.value.has(tile)
  }

  /**
   * 该出牌与最优解的差距；落在建议前几名内、或无从比较时返回 null。
   * significant 表示差距已大到需要完整对比的程度。
   */
  function adviceDiffFor(
    tile: number,
  ): { best: DiscardCandidate; chosen: DiscardCandidate; gap: number; significant: boolean } | null {
    const candidates = advice.value?.candidates
    if (!candidates || candidates.length < 2) return null
    const best = candidates[0]
    const chosen = candidates.find((candidate) => candidate.tile === tile)
    if (!chosen || chosen.rank <= BEST_RANK_LIMIT) return null
    const gap = best.value - chosen.value
    return { best, chosen, gap, significant: gap >= ADVICE_ALERT_GAP }
  }

  /** 该出牌是否显著劣于最优解，需要在打出前拦截确认 */
  function adviceGapFor(tile: number): { best: DiscardCandidate; chosen: DiscardCandidate; gap: number } | null {
    const diff = adviceDiffFor(tile)
    return diff?.significant ? diff : null
  }

  /**
   * 本次出牌相对最优解的评级，与 adviceAlert 开关正交——该开关只决定是否提示，
   * 评级始终进行；建议缺席时记为 unrated，不当作失误。
   */
  function rateDiscard(tile: number): DiscardRating {
    if (!advice.value?.candidates.length) return 'unrated'
    const diff = adviceDiffFor(tile)
    if (!diff) return 'best'
    return diff.significant ? 'blunder' : 'acceptable'
  }

  function commitDiscard(tile: number): void {
    if (!discardResolver || !isLegalDiscard(tile)) return
    const resolve = discardResolver
    discardResolver = null
    awaitingHumanDiscard.value = false
    // 评级须在清空建议前完成
    recordDiscard(rateDiscard(tile))
    advice.value = null
    advicePending.value = false
    resolve(tile)
  }

  /** 玩家点击手牌：明显偏离最优解时不立即打出，交由界面弹出提示 */
  async function requestDiscard(tile: number): Promise<{ needsConfirm: boolean }> {
    if (!discardResolver || !isLegalDiscard(tile)) return { needsConfirm: false }
    // 建议尚未算完时先等结果，避免漏掉该给玩家的提示
    if (advicePromise) await advicePromise
    if (adviceGapFor(tile)) return { needsConfirm: true }
    commitDiscard(tile)
    return { needsConfirm: false }
  }

  function usedTilesFor(claim: ClaimOption): number[] {
    if (claim.kind === 'chow') return claim.tiles ?? []
    const pending = state.value.pending
    if (!pending) return []
    const need = claim.kind === 'kong' ? 3 : 2
    return collectSupport(state.value.players[claim.seat].hand, pending.tile, state.value.jokerTile, need)
  }

  async function resolveClaims(): Promise<{ seat: number; kind: ClaimKind } | null> {
    const game = state.value
    const pending = game.pending
    if (!pending) return null

    const claims = findClaims(game)
    if (claims.length === 0) return null
    const ordered = [...claims].sort((a, b) => CLAIM_PRIORITY[b.kind] - CLAIM_PRIORITY[a.kind])

    // 吃有多种组合，同一座位会产出多条响应，但玩家只该被询问一次
    let askedHuman = false
    for (const claim of ordered) {
      if (claim.seat === HUMAN_SEAT) {
        // 报听：胡自动成立，其余响应一律放弃（手牌已锁死）
        if (human.value.declaredReady) {
          if (claim.kind === 'win') return executeClaim(claim)
          continue
        }
        if (askedHuman) continue
        askedHuman = true
        const accepted = await askHumanClaim(ordered)
        if (accepted) return executeClaim(accepted)
        continue
      }
      if (claim.kind === 'win') return executeClaim(claim)
      const view = viewFor(game, claim.seat)
      if (shouldClaim(view, claim.kind, { tile: pending.tile, used: usedTilesFor(claim) }, difficulty.value)) {
        return executeClaim(claim)
      }
    }
    return null
  }

  function askHumanClaim(all: readonly ClaimOption[]): Promise<ClaimOption | null> {
    const pending = state.value.pending
    if (!pending) return Promise.resolve(null)
    claimPrompt.value = {
      options: all.filter((item) => item.seat === HUMAN_SEAT),
      tile: pending.tile,
      canDeclareReady: canDeclareReady(state.value, HUMAN_SEAT),
    }
    return new Promise<ClaimOption | null>((resolve) => {
      claimResolver = resolve
    })
  }

  function answerClaim(accepted: boolean, option?: ClaimOption): void {
    const resolve = claimResolver
    claimResolver = null
    claimPrompt.value = null
    resolve?.(accepted && option ? option : null)
  }

  /** 放弃当前响应：吃碰杠、明杠、自摸三处的「不作响应」语义相同，界面只需报一次意图 */
  function dismissPrompt(): void {
    if (claimPrompt.value) {
      answerClaim(false)
      return
    }
    if (kongPrompt.value) {
      answerKong(null)
      return
    }
    if (selfWinPrompt.value) answerSelfWin(false)
  }

  /**
   * 报听：锁死手牌并放弃本次响应，此后摸打自动胡牌；
   * 取消窗口截至下一次自己出牌之前。
   */
  function declareReady(): void {
    if (!claimPrompt.value || !canDeclareReady(state.value, HUMAN_SEAT)) return
    human.value.declaredReady = true
    readyDiscardMark.value = human.value.discards.length
    answerClaim(false)
  }

  function cancelReady(): void {
    if (!canCancelReady.value) return
    human.value.declaredReady = false
  }

  function executeClaim(claim: ClaimOption): { seat: number; kind: ClaimKind } | null {
    const game = state.value
    const pending = game.pending
    if (!pending) return null

    if (claim.kind === 'win') {
      const winType = canWinOn(game.players[claim.seat], pending.tile, game.jokerTile)
      if (!winType) return null
      settleWin(game, claim.seat, pending.from, pending.tile, winType)
      return { seat: claim.seat, kind: 'win' }
    }

    if (claim.kind === 'pong') {
      if (!applyPong(game, claim.seat)) return null
      return { seat: claim.seat, kind: 'pong' }
    }

    if (claim.kind === 'kong') {
      applyKong(game, claim.seat)
      if (game.pending) return null
      return { seat: claim.seat, kind: 'kong' }
    }

    if (!applyChow(game, claim.seat, claim.tiles ?? [])) return null
    return { seat: claim.seat, kind: 'chow' }
  }

  function answerSelfWin(accepted: boolean): void {
    const resolve = selfWinResolver
    selfWinResolver = null
    resolve?.(accepted)
  }

  function handTilesOf(seat: number): number[] {
    return state.value.players[seat].hand
  }

  function openMelds(seat: number) {
    return state.value.players[seat].melds
  }

  function allTilesOf(seat: number): number[] {
    const player = state.value.players[seat]
    return [...player.hand, ...meldTilesOf(player.melds)]
  }

  function tileLabel(tile: number): string {
    return tileName(tile)
  }

  return {
    state,
    difficulty,
    running,
    settings,
    advice,
    advicePending,
    claimPrompt,
    kongPrompt,
    selfWinPrompt,
    opponentRead,
    focusSeat,
    human,
    followHonor,
    isHumanTurn,
    canDiscard,
    canCancelReady,
    dealer,
    dealerStreak,
    isDealer,
    settlementText,
    awaitingHumanDiscard,
    turnSeq,
    wallLeft,
    legalTiles,
    start,
    reset,
    requestDiscard,
    commitDiscard,
    answerClaim,
    declareReady,
    cancelReady,
    answerKong,
    dismissPrompt,
    answerSelfWin,
    scheduleOpponentRead,
    clearOpponentRead,
    readSeat,
    seatName,
    relativeLabel,
    handTilesOf,
    openMelds,
    allTilesOf,
    tileLabel,
    adviceGapFor,
    adviceDiffFor,
  }
})

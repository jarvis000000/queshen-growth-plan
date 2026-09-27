<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { relativeRates, type DiscardCandidate } from '../engine/ai'
import { MELD_KIND, type Meld } from '../engine/meld'
import { formatTile, formatTileList, formatTiles, NOTATION_LEGEND, parseTileInput, splitTokens } from '../engine/notation'
import { tileName } from '../engine/tiles'
import { HUMAN_SEAT, useGameStore, type ClaimPrompt, type KongPrompt } from '../stores/game'
import StatsPanel from './StatsPanel.vue'

const emit = defineEmits<{ (event: 'exit'): void }>()

const store = useGameStore()

const myMeldText = computed(() => meldText(store.human.melds))
const myDiscardText = computed(() => formatTileList(store.human.discards))
/** 对手只报张数与副露，牌河细节留在日志里 */
const opponentSummary = computed(() =>
  [1, 2, 3]
    .map((offset) => (HUMAN_SEAT + offset) % 4)
    .map((seat) => {
      const player = store.state.players[seat]
      const melds = player.melds.length > 0 ? `[${meldText(player.melds)}]` : ''
      return `${store.relativeLabel(seat)}${player.hand.length}张${melds}`
    })
    .join('  '),
)

type LineKind = 'info' | 'action' | 'input' | 'hint' | 'error' | 'dim' | 'divider'

interface LogLine {
  kind: LineKind
  text: string
}

const lines = ref<LogLine[]>([])
const input = ref('')
const logEl = ref<HTMLElement | null>(null)
const pendingDiscard = ref<number | null>(null)
const statsOpen = ref(false)

const canPick = computed(() => store.canDiscard)

/**
 * 命令行当前指向的牌：出牌时是那一张，响应「吃 3筒 4筒」时是所点名的两张。
 * 「碰 / 胡」不带牌张，指向牌河里那张。
 */
const pickedTiles = computed<number[]>(() => {
  const text = input.value.trim()
  if (!text) return []
  const prompt = store.claimPrompt
  if (prompt && ['碰', '胡'].includes(text)) return [prompt.tile]
  return splitTokens(text.replace(/^(暗杠|加杠|吃|碰|杠)/, ''))
    .map((token) => parseTileInput(token))
    .filter((tile): tile is number => tile !== null)
})

/** 手牌顺序：新摸的牌单独排到末尾，与已理顺的牌分开 */
function orderedHand(hand: readonly number[], drawn: number | null): number[] {
  if (drawn === null) return [...hand]
  const index = hand.indexOf(drawn)
  if (index < 0) return [...hand]
  return [...hand.slice(0, index), ...hand.slice(index + 1), drawn]
}

/**
 * 手牌逐张展开供上色。选中的牌由命令行文本反推，
 * 因此方向键填入、手动输入牌名、响应选项三条路径都会点亮。
 */
const handCards = computed(() => {
  const jokerTile = store.state.jokerTile
  const drawn = store.human.drawnTile
  const picked = pickedTiles.value
  const hand = orderedHand(store.human.hand, drawn)
  return hand.map((tile, index) => ({
    text: formatTile(tile, jokerTile),
    joker: tile === jokerTile,
    playable: store.legalTiles.has(tile),
    focused: picked.includes(tile),
    // 只认末尾那张，避免同值牌被一并标记
    drawn: drawn !== null && index === hand.length - 1 && tile === drawn,
  }))
})

const hasBlocked = computed(
  () => canPick.value && store.human.hand.some((tile) => !store.legalTiles.has(tile)),
)
const inputEl = ref<HTMLInputElement | null>(null)
/** 小窗挂载点；非空时整个界面被 Teleport 到画中画窗口 */
const pipTarget = ref<HTMLElement | null>(null)
let pipWindowRef: Window | null = null

interface DocumentPictureInPicture {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>
}

function pipApi(): DocumentPictureInPicture | undefined {
  return (window as unknown as { documentPictureInPicture?: DocumentPictureInPicture }).documentPictureInPicture
}

/** 画中画窗口是独立 document，需把当前样式表整份复制过去 */
function copyStyles(target: Window): void {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const cssText = Array.from(sheet.cssRules)
        .map((rule) => rule.cssText)
        .join('\n')
      const style = target.document.createElement('style')
      style.textContent = cssText
      target.document.head.append(style)
    } catch (error) {
      console.error(error)
    }
  }
}

async function openPip(): Promise<void> {
  const api = pipApi()
  if (!api) {
    push('error', '当前浏览器不支持小窗（需 Chrome / Edge 116 及以上）')
    return
  }
  try {
    const pipWindow = await api.requestWindow({ width: 470, height: 620 })
    copyStyles(pipWindow)
    pipWindow.document.body.style.margin = '0'
    pipWindow.document.title = '对局记录'
    const host = pipWindow.document.createElement('div')
    pipWindow.document.body.append(host)
    pipWindowRef = pipWindow
    pipTarget.value = host
    pipWindow.addEventListener('pagehide', () => {
      pipTarget.value = null
      pipWindowRef = null
    })
  } catch (error) {
    console.error(error)
    push('error', '小窗打开失败')
  }
}

function exitPlain(): void {
  pipWindowRef?.close()
  pipWindowRef = null
  pipTarget.value = null
  emit('exit')
}

const MAX_LINES = 500

/** 非最优解待确认时可用的命令 */
const DISCARD_CMD = '打出'
const ADVICE_CMD = '查看建议'

/** 报听相关命令 */
const READY_CMD = '听牌'
const CANCEL_READY_CMD = '取消听牌'

/**
 * 滚到日志末行。常规下日志区自身是滚动容器；窗口过矮时改由外层页面承担滚动，
 * 只滚日志区末行仍会留在视口外，故两层都要滚。
 */
function scrollToEnd(): void {
  const el = logEl.value
  if (!el) return
  el.scrollTop = el.scrollHeight
  const outer = el.closest<HTMLElement>('.plain-page')
  if (outer) outer.scrollTop = outer.scrollHeight
}

function push(kind: LineKind, text: string): void {
  lines.value.push({ kind, text })
  if (lines.value.length > MAX_LINES) lines.value.splice(0, lines.value.length - MAX_LINES)
  void nextTick(scrollToEnd)
}

function divider(): void {
  push('divider', '')
}

/**
 * 棋盘事件同步：把四家的出牌与副露变化实时写进日志。
 * 状态里没有事件流，只能比对快照。出牌者必须取 lastDiscardSeat 而非 turn——
 * turn 会随回合推进变成下一家，用它会把同一手牌重复记到下一家头上。
 * lastDiscard 与 lastDiscardSeat 成对更新，故打出的牌被吃碰走也能补记。
 */
interface BoardSnapshot {
  meldSignatures: string[]
  lastDiscard: number | null
  lastDiscardSeat: number | null
}

function captureBoard(): BoardSnapshot {
  return {
    meldSignatures: store.state.players.map((player) =>
      player.melds.map((meld) => `${meld.kind}${meld.tiles.join(',')}`).join('|'),
    ),
    lastDiscard: store.state.lastDiscard,
    lastDiscardSeat: store.state.lastDiscardSeat,
  }
}

let board: BoardSnapshot = { meldSignatures: [], lastDiscard: null, lastDiscardSeat: null }

function seatLabel(seat: number): string {
  return seat === HUMAN_SEAT ? '你' : store.relativeLabel(seat)
}

function meldVerb(kind: string): string {
  if (kind === MELD_KIND.CHOW) return '吃'
  if (kind === MELD_KIND.PONG) return '碰'
  if (kind === MELD_KIND.AN_KONG) return '暗杠'
  return '杠'
}

function syncBoard(): void {
  const next = captureBoard()

  for (let seat = 0; seat < next.meldSignatures.length; seat++) {
    if (next.meldSignatures[seat] === board.meldSignatures[seat]) continue
    const melds = store.state.players[seat].melds
    const meld = melds[melds.length - 1]
    if (meld) {
      push(seat === HUMAN_SEAT ? 'action' : 'info', `${seatLabel(seat)} ${meldVerb(meld.kind)} [${formatTileList(meld.tiles)}]`)
    }
  }

  const { lastDiscard, lastDiscardSeat } = next
  if (
    lastDiscard !== null &&
    lastDiscardSeat !== null &&
    (lastDiscard !== board.lastDiscard || lastDiscardSeat !== board.lastDiscardSeat)
  ) {
    push(
      lastDiscardSeat === HUMAN_SEAT ? 'action' : 'info',
      `${seatLabel(lastDiscardSeat)} 打出 ${tileName(lastDiscard)}`,
    )
  }

  board = next
}

function meldText(melds: readonly Meld[]): string {
  if (melds.length === 0) return '无'
  return melds
    .map((meld) => {
      const tag =
        meld.kind === MELD_KIND.CHOW
          ? '吃'
          : meld.kind === MELD_KIND.PONG
            ? '碰'
            : meld.kind === MELD_KIND.AN_KONG
              ? '暗杠'
              : '杠'
      return `${tag}[${formatTileList(meld.tiles)}]`
    })
    .join(' ')
}

function printSituation(): void {
  // 手牌与对手概况常驻顶部状态栏，四家动向由 syncBoard 实时记录，这里只标出轮次
  divider()
  push('info', `轮到你 · 剩余 ${store.wallLeft} 张 · 第 ${store.human.discards.length + 1} 手`)
  if (store.human.declaredReady) {
    push(
      'hint',
      store.canCancelReady
        ? `已听牌：只能摸切，输入「${CANCEL_READY_CMD}」可取消`
        : '已听牌：只能摸切，摸打自动胡牌',
    )
  }
  if (store.followHonor !== null) {
    push('hint', `有风跟打：须跟打 ${tileName(store.followHonor)}`)
  }
  divider()
}

function printHelp(): void {
  divider()
  push('info', '命令列表')
  push('info', '  <牌名>        打出该牌，如「5万」「五万」「东」（也支持 5m / 5M 写法）')
  push('info', '  建议 / t      列出每张可打牌的胜率与理由')
  push('info', '  分析 下家     查看某家牌型推断（下家 / 对家 / 上家）')
  push('info', '  碰 吃 杠 胡   响应他家打出的牌')
  push('info', '  过 / pass     放弃响应')
  push('info', `  ${READY_CMD}          报听：锁死手牌，此后摸打自动胡牌（仅已听牌时可用）`)
  push('info', `  ${CANCEL_READY_CMD}      撤销报听（仅限下一次自己出牌之前）`)
  push('info', '  手牌 / h      重新显示手牌')
  push('info', '  重开          重开一局')
  push('info', '  退出          返回图形界面')
  push('dim', `  ${NOTATION_LEGEND}`)
  push('dim', '  手牌末尾带下划线的是刚摸到的牌；绿色为可打出，灰色受有风跟打限制')
  divider()
}

function printHand(): void {
  push('info', `手牌(${store.human.hand.length})：${formatTiles(store.human.hand, store.state.jokerTile)}`)
  push('dim', '能否打出以顶部手牌的颜色表示')
}

/**
 * 输出候选行明细。胜率按传入的完整候选集折算，focusTile 只用来筛行与标注——
 * 传子集进来会被 relativeRates 重新归一化，胜率随之失真。
 */
function printAdviceRows(candidates: readonly DiscardCandidate[], focusTile?: number): void {
  const rates = relativeRates(candidates)
  candidates.forEach((candidate, index) => {
    if (focusTile !== undefined && index >= 3 && candidate.tile !== focusTile) return
    const star = index === 0 ? '★' : ' '
    const mark = candidate.tile === focusTile ? '  ← 你原本要打的' : ''
    const shantenText = candidate.shanten < 0 ? '成牌' : candidate.shanten === 0 ? '听牌' : `${candidate.shanten}向听`
    push(
      index === 0 ? 'hint' : 'info',
      `${star} ${tileName(candidate.tile).padEnd(4)} 胜率 ${((rates[index] ?? 0) * 100).toFixed(1)}% | ${shantenText} | 进张${candidate.ukeireTotal}张 | 危险${Math.round(candidate.danger * 100)}%${mark}`,
    )
    push('dim', `    ${candidate.reason}`)
  })
}

function adviceCandidates(): readonly DiscardCandidate[] | null {
  const candidates = store.advice?.candidates ?? []
  if (candidates.length === 0) {
    push('error', '暂时没有建议：可能未轮到你出牌，或建议仍在计算')
    return null
  }
  return candidates
}

function printAdviceTable(candidates: readonly DiscardCandidate[]): void {
  divider()
  push('info', '出牌建议（按胜率降序）')
  printAdviceRows(candidates)
  divider()
}

/** 待确认出牌的对比：原牌与前 3 名并列，供玩家决定是否改打 */
function printComparison(tile: number): void {
  const candidates = adviceCandidates()
  if (!candidates) return
  divider()
  push('info', `出牌对比（★ 为最优解 · 含你原本要打的 ${tileName(tile)}）`)
  printAdviceRows(candidates, tile)
  divider()
}

function printAdvice(): void {
  const candidates = adviceCandidates()
  if (!candidates) return
  printAdviceTable(candidates)
}

function printRead(target: string): void {
  const map: Record<string, number> = {
    下家: (HUMAN_SEAT + 1) % 4,
    对家: (HUMAN_SEAT + 2) % 4,
    上家: (HUMAN_SEAT + 3) % 4,
  }
  const seat = map[target.trim()]
  if (seat === undefined) {
    push('error', '用法：分析 下家 / 分析 对家 / 分析 上家')
    return
  }
  const read = store.readSeat(seat)
  divider()
  push('info', `${store.relativeLabel(seat)} 牌型分析`)
  push('info', read.summary)
  push('info', `方向：${read.tendency}`)
  push(
    'info',
    `危险牌：${read.dangers
      .slice(0, 5)
      .map((item) => `${tileName(item.tile)}(${Math.round(item.danger * 100)}%)`)
      .join(' ')}`,
  )
  divider()
}

function printResult(): void {
  const result = store.state.result
  if (!result) return
  divider()
  if (result.draw) {
    push('hint', '流局，本局无人胡牌')
  } else {
    const record = result.winners[0]
    if (record) {
      const who = record.seat === HUMAN_SEAT ? '你' : store.relativeLabel(record.seat)
      const detail = record.from === null ? '自摸' : `放炮者 ${store.relativeLabel(record.from)}`
      push('hint', `${who} 胡牌（${detail}）：${tileName(record.tile)}`)
      push('info', `${record.score.labels.join(' · ')} | ${record.score.hard ? '硬牌' : '软牌'} ${record.score.multiplier}倍 | 合计 ${record.score.total}`)
    }
  }
  push('dim', '输入「重开」再来一局')
}

function printClaims(prompt: ClaimPrompt): void {
  cursor.value = 0
  const kinds = prompt.options.map((option) =>
    option.kind === 'chow'
      ? `吃(${formatTileList(option.tiles ?? [])})`
      : claimVerb(option.kind),
  )
  // 报听只在确实听牌时出现；选了它就等于放弃本次响应
  if (prompt.canDeclareReady) kinds.push(READY_CMD)
  push('hint', `可以响应 ${tileName(prompt.tile)}：${kinds.join(' / ')}（←→ 选择后回车，或直接输入命令）`)
}

function printKongs(prompt: KongPrompt): void {
  cursor.value = 0
  const parts = [
    ...prompt.anKongs.map((tile) => `暗杠 ${tileName(tile)}`),
    ...prompt.addKongs.map((tile) => `加杠 ${tileName(tile)}`),
  ]
  push('hint', `可以杠：${parts.join(' / ')}（←→ 选择后回车，或输入「杠 牌名」）`)
}

/**
 * 出牌。明显劣于最优解时不直接落子，转为待确认态交给玩家决定，
 * 与图形界面的 pickTile 同构。
 */
async function tryDiscard(tile: number): Promise<void> {
  if (!store.human.hand.includes(tile)) {
    push('error', `手里没有 ${tileName(tile)}`)
    return
  }
  if (!store.legalTiles.has(tile)) {
    const follow = store.followHonor
    const reason = follow === null ? '' : `：有风跟打，须跟打 ${tileName(follow)}`
    push('error', `${tileName(tile)} 当前不可打出${reason}`)
    return
  }
  if (!store.settings.adviceAlert) {
    store.commitDiscard(tile)
    return
  }
  // 差距须在出牌前取好：commitDiscard 会清空建议
  const diff = store.adviceDiffFor(tile)
  const { needsConfirm } = await store.requestDiscard(tile)
  if (needsConfirm) {
    pendingDiscard.value = tile
    if (diff) push('hint', `${tileName(tile)} 明显劣于 ${tileName(diff.best.tile)}（相差 ${diff.gap.toFixed(0)} 分）`)
    push('hint', `输入「${DISCARD_CMD}」确认打出，或「${ADVICE_CMD}」查看胜率对比`)
    return
  }
  pendingDiscard.value = null
  if (!diff) return
  push('dim', `与最优解 ${tileName(diff.best.tile)} 相差 ${diff.gap.toFixed(0)} 分，输入「建议」看全部对比`)
}

/** 确认打出待判定的那张牌；出牌记录由 syncBoard 补记 */
function confirmDiscard(): void {
  const tile = pendingDiscard.value
  if (tile === null) return
  pendingDiscard.value = null
  store.commitDiscard(tile)
}

function handleClaim(raw: string): void {
  const prompt = store.claimPrompt
  if (!prompt) return
  const command = raw.toLowerCase()

  if (raw === READY_CMD) {
    if (!prompt.canDeclareReady) {
      push('error', `当前不可报听：需手牌已听牌且尚未报听`)
      return
    }
    store.declareReady()
    push('action', '你已报听（此后摸打自动胡牌）')
    return
  }

  if (['过', 'pass', 'p', '不要'].includes(command)) {
    store.answerClaim(false)
    push('action', '你选择过')
    return
  }

  // 吃可能有多种组合，允许用「吃 3筒 4筒」指定用哪两张
  if (command.startsWith('吃')) {
    const wanted = splitTokens(raw.slice(1))
      .map((token) => parseTileInput(token))
      .filter((tile): tile is number => tile !== null)
    const option = prompt.options.find((item) => {
      if (item.kind !== 'chow') return false
      if (wanted.length === 0) return true
      const tiles = item.tiles ?? []
      return wanted.every((tile) => tiles.includes(tile))
    })
    if (!option) {
      push('error', '没有这样的吃法，可用：' + prompt.options.filter((o) => o.kind === 'chow').map((o) => formatTileList(o.tiles ?? [])).join(' / '))
      return
    }
    store.answerClaim(true, option)
    push('action', `你选择吃 ${formatTileList(option.tiles ?? [])}`)
    return
  }

  const kindMap: Record<string, string> = { 碰: 'pong', 杠: 'kong', 胡: 'win' }
  const wanted = kindMap[command]
  if (!wanted) {
    push('error', '可用命令：碰 / 吃 / 杠 / 胡 / 过')
    return
  }
  const option = prompt.options.find((item) => item.kind === wanted)
  if (!option) {
    push('error', `当前不能「${command}」`)
    return
  }
  store.answerClaim(true, option)
  push('action', `你选择${command}`)
}

function submit(): void {
  // 战绩面板打开时命令行退居幕后，避免回车误出牌
  if (statsOpen.value) return
  const raw = input.value.trim()
  if (!raw) return
  push('input', `> ${raw}`)
  input.value = ''

  if (store.claimPrompt) {
    handleClaim(raw)
    return
  }
  if (store.selfWinPrompt) {
    if (['胡', 'hu', 'y'].includes(raw.toLowerCase())) store.answerSelfWin(true)
    else store.answerSelfWin(false)
    return
  }
  if (store.kongPrompt) {
    if (['过', 'pass', 'p'].includes(raw.toLowerCase())) {
      store.answerKong(null)
      push('action', '你选择过')
      return
    }
    const match = /^杠\s*(.+)$/.exec(raw)
    const tile = match ? parseTileInput(match[1]) : null
    const prompt = store.kongPrompt
    const canAn = tile !== null && prompt.anKongs.includes(tile)
    const canAdd = tile !== null && prompt.addKongs.includes(tile)
    if (tile === null || (!canAn && !canAdd)) {
      push('error', '用法：杠 <牌名>，或输入「过」')
      return
    }
    store.answerKong(tile)
    push('action', `你选择${canAn ? '暗杠' : '加杠'} ${tileName(tile)}`)
    return
  }

  const command = raw.toLowerCase()
  if (pendingDiscard.value !== null) {
    if (raw === DISCARD_CMD) {
      confirmDiscard()
      return
    }
    if (raw === ADVICE_CMD) {
      printComparison(pendingDiscard.value)
      return
    }
  }
  if (raw === CANCEL_READY_CMD) {
    if (!store.canCancelReady) {
      push('error', '当前不可取消报听：仅限下一次自己出牌之前')
      return
    }
    store.cancelReady()
    push('action', '你已取消报听')
    return
  }
  if (['帮助', 'help', '?'].includes(command)) return printHelp()
  if (['重开', 'restart', 'r'].includes(command)) {
    lines.value = []
    board = { meldSignatures: [], lastDiscard: null, lastDiscardSeat: null }
    pendingDiscard.value = null
    void store.start()
    return
  }
  if (['退出', 'exit', 'q'].includes(command)) {
    exitPlain()
    return
  }
  if (store.state.result) {
    push('dim', '本局已结束，输入「重开」再来一局')
    return
  }
  if (['建议', 'advice', 't'].includes(command)) return printAdvice()
  if (['手牌', 'hand', 'h'].includes(command)) return printHand()
  if (raw.startsWith('分析')) return printRead(raw.slice(2))

  const tile = parseTileInput(raw)
  if (tile === null) {
    push('error', `无法识别的牌名「${raw}」，输入「帮助」查看用法`)
    return
  }
  void tryDiscard(tile)
}

function focusInput(): void {
  inputEl.value?.focus()
}

const cursor = ref(0)

function claimVerb(kind: string): string {
  if (kind === 'chow') return '吃'
  if (kind === 'pong') return '碰'
  if (kind === 'kong') return '杠'
  return '胡'
}

/** 可打出的牌名，刚摸的那张排最前——它是每次摸牌后的默认选中项 */
function legalTileNames(): string[] {
  const tiles = [...store.legalTiles]
  const drawn = store.human.drawnTile
  if (drawn === null || !store.legalTiles.has(drawn)) return tiles.map((tile) => tileName(tile))
  return [drawn, ...tiles.filter((tile) => tile !== drawn)].map((tile) => tileName(tile))
}

/**
 * 方向键当前可循环的命令：处于响应状态时给出响应选项，否则给出可打出的牌。
 */
function navigableCommands(): string[] {
  // 对局结束后只剩重开与退出可选，继续列手牌会让人以为还能打
  if (store.state.result) return ['重开', '退出']

  // 待确认态：确认与看对比排最前便于立即选中，其后保留选牌以便改打
  if (pendingDiscard.value !== null) {
    return [DISCARD_CMD, ADVICE_CMD, ...legalTileNames()]
  }

  const claim = store.claimPrompt
  if (claim) {
    const commands = claim.options.map((option) =>
      // 吃可能有多种组合，命令带上具体牌张才分得清选的是哪一种
      option.kind === 'chow'
        ? `吃 ${(option.tiles ?? []).map((tile) => tileName(tile)).join(' ')}`
        : claimVerb(option.kind),
    )
    if (claim.canDeclareReady) commands.push(READY_CMD)
    return [...commands, '过']
  }

  const kong = store.kongPrompt
  if (kong) {
    return [
      ...kong.anKongs.map((tile) => `杠 ${tileName(tile)}`),
      ...kong.addKongs.map((tile) => `杠 ${tileName(tile)}`),
      '过',
    ]
  }
  if (store.selfWinPrompt) return ['胡', '过']
  return legalTileNames()
}

/** 输入框内用方向键在可选项之间循环，直接把命令填进命令行 */
function onInputKeydown(event: KeyboardEvent): void {
  if (statsOpen.value) return
  const commands = navigableCommands()
  if (commands.length === 0) return
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault()
    cursor.value = cursor.value <= 0 ? commands.length - 1 : cursor.value - 1
    input.value = commands[cursor.value] ?? commands[0]
    return
  }
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault()
    cursor.value = (cursor.value + 1) % commands.length
    input.value = commands[cursor.value] ?? commands[0]
  }
}

onMounted(() => {
  push('dim', `${NOTATION_LEGEND}`)
  push('info', '摸鱼模式已开启。输入「帮助」查看命令，←→ 键选牌（选中的牌会在手牌中点亮）。')
  board = captureBoard()
  if (store.canDiscard) printSituation()
  focusInput()
})

/** 四家出牌与副露的版本号，任一处变化即触发日志补记 */
const boardVersion = computed(
  () =>
    `${store.state.players.map((player) => player.melds.length).join(',')}|${store.state.lastDiscard}|${store.state.lastDiscardSeat}`,
)

watch(boardVersion, () => {
  syncBoard()
})

watch(
  () => store.turnSeq,
  () => {
    if (!store.canDiscard) return
    printSituation()
    cursor.value = 0
    // 刚摸的那张作为默认选中：填进命令行让手牌同步点亮，直接回车即可打出
    const drawn = store.human.drawnTile
    if (drawn === null || !store.legalTiles.has(drawn)) return
    input.value = tileName(drawn)
    // 全选住，直接输入别的牌名即可覆盖，不必先清空
    void nextTick(() => inputEl.value?.select())
  },
)

watch(
  () => store.claimPrompt,
  (prompt) => {
    if (prompt) printClaims(prompt)
  },
)

watch(
  () => store.kongPrompt,
  (prompt) => {
    if (prompt) printKongs(prompt)
  },
)

watch(
  () => store.selfWinPrompt,
  (active) => {
    if (active) push('hint', '可以自摸胡牌：输入「胡」或「过」')
  },
)

watch(
  () => store.state.result,
  (result) => {
    if (result) printResult()
  },
)

watch(
  () => store.running,
  (running, previous) => {
    if (running && !previous) push('dim', '新对局开始')
  },
)
</script>

<template>
  <Teleport :to="pipTarget ?? 'body'" :disabled="pipTarget === null">
    <div class="plain-page" @click="focusInput">
      <div class="plain-inner">
        <header class="plain-head">
          <span class="title">对局记录</span>
          <span class="meta">剩余 {{ store.wallLeft }} 张 · 财神 {{ tileName(store.state.jokerTile) }}</span>
          <button v-if="pipTarget === null" type="button" class="tool" @click.stop="openPip">小窗</button>
          <button type="button" class="tool" @click.stop="statsOpen = true">战绩</button>
          <button type="button" class="tool" @click.stop="exitPlain">图形模式</button>
        </header>

        <section class="plain-status">
          <div class="status-line">
            <span class="label">手牌</span>
            <span class="value"><template v-for="(card, index) in handCards" :key="index"><span
              class="hand-card"
              :class="{
                playable: canPick && card.playable,
                blocked: canPick && !card.playable,
                joker: card.joker,
                focused: card.focused,
                drawn: card.drawn,
              }"
            >{{ card.text }}</span>{{ ' ' }}</template></span>
          </div>
          <div v-if="hasBlocked" class="status-line note">
            <span class="label"></span>
            <span class="value">灰字受「有风跟打」限制，当前不可打出</span>
          </div>
          <div class="status-line">
            <span class="label">副露</span>
            <span class="value">{{ myMeldText }}</span>
          </div>
          <div class="status-line">
            <span class="label">我的河</span>
            <span class="value faint">{{ myDiscardText }}</span>
          </div>
          <div class="status-line">
            <span class="label">对手</span>
            <span class="value faint">{{ opponentSummary }}</span>
          </div>
        </section>

        <div ref="logEl" class="plain-log">
          <p v-for="(line, index) in lines" :key="index" :class="line.kind">{{ line.text }}</p>
        </div>

        <div class="plain-input">
          <span class="prompt">&gt;</span>
          <input
            ref="inputEl"
            v-model="input"
            type="text"
            autocomplete="off"
            spellcheck="false"
            placeholder="输入牌名出牌，←→ 键选牌，或输入「帮助」"
            @keydown="onInputKeydown"
            @keydown.enter="submit"
          />
        </div>
      </div>

      <StatsPanel v-if="statsOpen" variant="light" @close="statsOpen = false" />
    </div>
  </Teleport>
  <div v-if="pipTarget" class="pip-note">
    <p>对局界面已移至小窗，可悬浮在其他窗口之上继续对局。</p>
    <p class="sub">关闭小窗即自动回到本页。</p>
  </div>
</template>

<style scoped>
/* 铺满视口，避免露出图形界面的深色背景；窗口过矮时由本层滚动，不裁切 */
.plain-page {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: #ffffff;
  overflow-y: auto;
}

.plain-inner {
  display: flex;
  flex-direction: column;
  /* 须用确定高度，否则容器被日志内容撑高，日志区永无内部溢出、自身滚动失效 */
  height: 100%;
  padding: 18px 26px 22px;
  color: #24292f;
  font-family: 'Cascadia Mono', 'JetBrains Mono', Consolas, 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.75;
}

/* 界面在小窗时主页面留个说明，避免看到空白 */
.pip-note {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 100vh;
  background: #ffffff;
  color: #57606a;
  font-family: 'Cascadia Mono', 'JetBrains Mono', Consolas, 'Courier New', monospace;
  font-size: 14px;
}

.pip-note p {
  margin: 0;
}

.pip-note .sub {
  color: #8c959f;
  font-size: 12.5px;
}

.plain-head {
  display: flex;
  align-items: baseline;
  gap: 14px;
  padding-bottom: 8px;
  border-bottom: 1px solid #d8dee4;
}

.title {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.meta {
  color: #57606a;
  font-size: 12px;
}

.tool {
  margin-left: auto;
  padding: 2px 10px;
  border: 1px solid #d0d7de;
  border-radius: 4px;
  background: #f6f8fa;
  color: #57606a;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}

.tool + .tool {
  margin-left: 6px;
}

.tool:hover {
  background: #eaeef2;
}

/* 自己的牌常驻顶部，不随日志滚走 */
.plain-status {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  margin-top: 8px;
  border: 1px solid #e4e8ed;
  border-radius: 6px;
  background: #f8fafc;
}

.status-line {
  display: flex;
  gap: 8px;
  font-size: 12.5px;
  line-height: 1.65;
}

.status-line .label {
  flex: none;
  width: 52px;
  color: #8c959f;
}

.status-line .value {
  flex: 1;
  word-break: break-all;
}

.status-line .value.faint {
  color: #8c959f;
}

/* 语义色：绿=可打出，灰=受有风跟打限制，琥珀底=方向键当前选中 */
.hand-card {
  display: inline-block;
  border-radius: 3px;
  /* 与父级 break-all 相反，避免「1万*」被从中间拆开换行 */
  white-space: nowrap;
}

.hand-card.playable {
  color: #1a7f37;
}

.hand-card.blocked {
  color: #a8b1ba;
}

/* 财神是万能牌，用金色与「可打出」的绿色区分开 */
.hand-card.joker {
  color: #b8860b;
  font-weight: 700;
}

.hand-card.focused {
  background: #fff3bf;
  color: #7a4f01;
  outline: 1px solid #e3b341;
}

/* 新摸的牌用下划线形状标记，与上面三种颜色语义互不干扰 */
.hand-card.drawn {
  text-decoration: underline;
  text-decoration-thickness: 2px;
  text-underline-offset: 3px;
}

.status-line.note .value {
  color: #8c959f;
  font-size: 11.5px;
}

.plain-log {
  flex: 1;
  /* 窗口过矮时保住日志区高度，让整页滚动而不是把这里压没 */
  min-height: 5em;
  overflow-y: auto;
  padding: 10px 2px;
  scrollbar-width: thin;
  scrollbar-color: #d8dee4 transparent;
}

.plain-log::-webkit-scrollbar {
  width: 8px;
}

.plain-log::-webkit-scrollbar-track {
  background: transparent;
}

.plain-log::-webkit-scrollbar-thumb {
  border-radius: 4px;
  background: #d8dee4;
}

.plain-log::-webkit-scrollbar-thumb:hover {
  background: #b6bfc8;
}

.plain-log p {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

/* 用边框而非重复字符画线，线长自适应容器，窄窗口下不会折行 */
.plain-log .divider {
  height: 0;
  margin: 6px 0;
  border-top: 1px solid #d8dee4;
}

.info {
  color: #24292f;
}

.dim {
  color: #8c959f;
}

.action {
  color: #0969da;
}

.input {
  color: #1a7f37;
}

.hint {
  color: #9a6700;
}

.error {
  color: #cf222e;
}

.plain-input {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid #d8dee4;
}

.prompt {
  color: #1a7f37;
  font-weight: 700;
}

.plain-input input {
  flex: 1;
  padding: 4px 0;
  border: none;
  outline: none;
  background: transparent;
  color: #24292f;
  font-family: inherit;
  font-size: 13px;
}
</style>

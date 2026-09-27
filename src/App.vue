<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PlainMode from './components/PlainMode.vue'
import StatsPanel from './components/StatsPanel.vue'
import TileView from './components/TileView.vue'
import { DIFFICULTY_LABELS, relativeRates, type Difficulty, type DiscardCandidate } from './engine/ai'
import { MELD_KIND, type Meld } from './engine/meld'
import { tileName } from './engine/tiles'
import { HUMAN_SEAT, useGameStore } from './stores/game'

const store = useGameStore()

const pendingTile = ref<number | null>(null)
const adviceOpen = ref(false)
const readOpen = ref(false)
const settingsOpen = ref(false)
const statsOpen = ref(false)
/** 悬停的是手牌中的第几张，而非牌种——同种牌可能有多张 */
const hoveredIndex = ref<number | null>(null)

onMounted(() => {
  void store.start()
})

const opponents = computed(() => [1, 2, 3].map((offset) => (HUMAN_SEAT + offset) % 4))
const seatLayout = computed(() => ({
  right: (HUMAN_SEAT + 1) % 4,
  top: (HUMAN_SEAT + 2) % 4,
  left: (HUMAN_SEAT + 3) % 4,
}))

const candidates = computed<DiscardCandidate[]>(() => store.advice?.candidates ?? [])
const rates = computed(() => relativeRates(candidates.value))
const best = computed<DiscardCandidate | null>(() => candidates.value[0] ?? null)

/**
 * 悬停某张手牌时的即时评估。
 * 候选列表只含规则允许打出的牌，查不到即说明该张受跟打约束不可打。
 */
const hoverTip = computed(() => {
  if (!store.settings.hoverRate || hoveredIndex.value === null) return null
  const tile = store.human.hand[hoveredIndex.value]
  if (tile === undefined) return null
  const list = candidates.value
  const index = list.findIndex((item) => item.tile === tile)
  if (index === -1) {
    return { tile, blocked: true, rate: 0, isBest: false, rank: 0, total: 0, shanten: 0, ukeire: 0 }
  }
  const item = list[index]
  return {
    tile,
    blocked: false,
    rate: (rates.value[index] ?? 0) * 100,
    isBest: index === 0,
    rank: item.rank,
    total: list.length,
    shanten: item.shanten,
    ukeire: item.ukeireTotal,
  }
})
const pendingCandidate = computed<DiscardCandidate | null>(() => {
  if (pendingTile.value === null) return null
  return candidates.value.find((item) => item.tile === pendingTile.value) ?? null
})
const resultText = computed(() => {
  const result = store.state.result
  if (!result) return ''
  if (result.draw) return '流局'
  const record = result.winners[0]
  if (!record) return ''
  const who = record.seat === HUMAN_SEAT ? '你' : `${store.relativeLabel(record.seat)}（${store.seatName(record.seat)}）`
  const how = record.from === null ? '自摸' : `放炮者 ${store.seatName(record.from)}`
  return `${who} 胡牌（${how}）· ${tileName(record.tile)}`
})
const resultDetail = computed(() => {
  const record = store.state.result?.winners[0]
  if (!record) return ''
  const score = record.score
  return `${score.labels.join(' · ')}｜${score.hard ? '硬牌' : '软牌'} ${score.multiplier} 倍｜财神分 ${score.jokerScore}｜合计 ${score.total}`
})

function isJoker(tile: number): boolean {
  return tile === store.state.jokerTile
}

function isProxy(tile: number): boolean {
  return tile === 33 && store.state.jokerTile !== 33
}

function claimLabel(kind: string): string {
  return kind === 'chow' ? '吃' : kind === 'pong' ? '碰' : kind === 'kong' ? '杠' : '胡'
}

function meldLabel(meld: Meld): string {
  if (meld.kind === MELD_KIND.CHOW) return '吃'
  if (meld.kind === MELD_KIND.PONG) return '碰'
  return '杠'
}

async function pickTile(tile: number): Promise<void> {
  if (!store.canDiscard) return
  if (!store.settings.adviceAlert) {
    store.commitDiscard(tile)
    return
  }
  const { needsConfirm } = await store.requestDiscard(tile)
  if (needsConfirm) {
    pendingTile.value = tile
    adviceOpen.value = true
  }
}

function keepOriginal(): void {
  if (pendingTile.value !== null) store.commitDiscard(pendingTile.value)
  adviceOpen.value = false
  pendingTile.value = null
}

function switchTo(tile: number): void {
  store.commitDiscard(tile)
  adviceOpen.value = false
  pendingTile.value = null
}

function openRead(seat: number): void {
  store.scheduleOpponentRead(seat)
  readOpen.value = true
}

function closeRead(): void {
  readOpen.value = false
  store.clearOpponentRead()
}

function restart(difficulty: Difficulty): void {
  store.difficulty = difficulty
  void store.start()
}

const cursorIndex = ref(0)
const liftedIndex = ref<number | null>(null)
const claimCursor = ref(0)
const kongCursor = ref(0)

// 每次轮到自己时把光标与提起位落到刚摸的那张，回车即可直接打出；
// 摸到的牌受跟打限制或无从识别时，退回第一张可打出的牌
watch(
  () => store.turnSeq,
  () => {
    const hand = store.human.hand
    const drawn = store.human.drawnTile
    // 手牌按序插入，同值牌里最后一张才是刚摸进来的
    const drawnIndex = drawn === null ? -1 : hand.lastIndexOf(drawn)
    if (drawn !== null && drawnIndex >= 0 && store.legalTiles.has(drawn)) {
      cursorIndex.value = drawnIndex
      liftedIndex.value = drawnIndex
      return
    }
    const first = hand.findIndex((tile) => store.legalTiles.has(tile))
    cursorIndex.value = first >= 0 ? first : 0
    liftedIndex.value = null
  },
)

// 手牌变短时把光标收回界内，否则会指向空位
watch(
  () => store.human.hand.length,
  (length) => {
    if (cursorIndex.value >= length) cursorIndex.value = Math.max(0, length - 1)
  },
)

watch(
  () => store.claimPrompt,
  () => {
    claimCursor.value = 0
  },
)

watch(
  () => store.kongPrompt,
  () => {
    kongCursor.value = 0
  },
)

/** 手牌导航：←→ 在可打出的牌之间移动，↑ 提牌，↓ 放回，回车或空格打出 */
function handleHandKeys(event: KeyboardEvent): void {
  if (!store.canDiscard) return
  const hand = store.human.hand
  // 光标只在规则允许打出的牌上游走，避免停在禁用牌上按空格无反应
  const legalIndexes = hand.map((tile, index) => (store.legalTiles.has(tile) ? index : -1)).filter((index) => index >= 0)
  if (legalIndexes.length === 0) return
  const position = legalIndexes.indexOf(cursorIndex.value)

  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    const next = position <= 0 ? legalIndexes.length - 1 : position - 1
    cursorIndex.value = legalIndexes[next] ?? legalIndexes[0]
    liftedIndex.value = null
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    const next = (position + 1) % legalIndexes.length
    cursorIndex.value = legalIndexes[next] ?? legalIndexes[0]
    liftedIndex.value = null
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    liftedIndex.value = cursorIndex.value
  } else if (event.key === 'ArrowDown') {
    event.preventDefault()
    liftedIndex.value = null
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    const tile = hand[liftedIndex.value ?? cursorIndex.value]
    if (tile !== undefined) {
      liftedIndex.value = null
      void pickTile(tile)
    }
  }
}

function handleClaimKeys(event: KeyboardEvent): void {
  const prompt = store.claimPrompt
  const options = prompt?.options ?? []
  if (!prompt || options.length === 0) return
  // 报听项排在响应选项之后，光标只能多走这一格；「过」仍只走点击与 Esc
  const total = options.length + (prompt.canDeclareReady ? 1 : 0)
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault()
    claimCursor.value = claimCursor.value <= 0 ? total - 1 : claimCursor.value - 1
  } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault()
    claimCursor.value = (claimCursor.value + 1) % total
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    if (prompt.canDeclareReady && claimCursor.value === options.length) {
      store.declareReady()
      return
    }
    const option = options[claimCursor.value]
    if (option) store.answerClaim(true, option)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    store.answerClaim(false)
  }
}

function handleKongKeys(event: KeyboardEvent): void {
  const prompt = store.kongPrompt
  if (!prompt) return
  const tiles = [...prompt.anKongs, ...prompt.addKongs]
  if (tiles.length === 0) return
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault()
    kongCursor.value = kongCursor.value <= 0 ? tiles.length - 1 : kongCursor.value - 1
  } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault()
    kongCursor.value = (kongCursor.value + 1) % tiles.length
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    const tile = tiles[kongCursor.value]
    if (tile !== undefined) store.answerKong(tile)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    store.answerKong(null)
  }
}

function onGlobalKeydown(event: KeyboardEvent): void {
  // 摸鱼模式自带一套键盘处理，避免两边抢方向键
  if (store.settings.plainMode) return
  if (event.metaKey || event.ctrlKey || event.altKey) return
  // 战绩面板盖在对局弹层之上，打开期间必须让对局键盘动作整体停摆，
  // 否则被面板遮住的吃碰杠/自摸提示仍会响应回车，替玩家静默做决定
  if (statsOpen.value) return

  if (store.claimPrompt) return handleClaimKeys(event)
  if (store.kongPrompt) return handleKongKeys(event)
  if (store.selfWinPrompt) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      store.answerSelfWin(true)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      store.answerSelfWin(false)
    }
    return
  }
  if (adviceOpen.value || readOpen.value || settingsOpen.value || store.state.result) return

  handleHandKeys(event)
}

onMounted(() => {
  window.addEventListener('keydown', onGlobalKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
})
</script>

<template>
  <PlainMode v-if="store.settings.plainMode" @exit="store.settings.plainMode = false" />
  <div v-else class="app">
    <header class="topbar">
      <h1>雀神成长计划</h1>
      <div class="meta">
        <span class="chip joker-chip">
          财神
          <TileView :tile="store.state.jokerTile" small joker />
        </span>
        <span class="chip">剩余 {{ store.wallLeft }} 张</span>
        <span v-if="store.followHonor !== null" class="chip warn">
          须跟打 {{ tileName(store.followHonor) }}
        </span>
        <span v-if="store.human.declaredReady" class="chip">已听牌</span>
      </div>
      <div class="difficulty">
        <button
          v-for="(label, key) in DIFFICULTY_LABELS"
          :key="key"
          type="button"
          :class="{ active: store.difficulty === key }"
          @click="restart(key as Difficulty)"
        >
          {{ label }}
        </button>
        <button v-if="store.canCancelReady" type="button" class="icon" @click="store.cancelReady()">取消听牌</button>
        <button type="button" class="icon" @click="statsOpen = true">战绩</button>
        <button type="button" class="icon" @click="settingsOpen = true">设置</button>
      </div>
    </header>

    <main class="table">
      <section class="seat seat-top" @click="openRead(seatLayout.top)">
        <div class="seat-head">
          <strong>{{ store.relativeLabel(seatLayout.top) }}</strong>
          <span>手牌 {{ store.handTilesOf(seatLayout.top).length }} 张</span>
        </div>
        <div class="backs">
          <span v-for="n in store.handTilesOf(seatLayout.top).length" :key="n" class="back" />
        </div>
        <div class="melds">
          <div v-for="(meld, i) in store.openMelds(seatLayout.top)" :key="i" class="meld">
            <TileView v-for="(tile, j) in meld.tiles" :key="j" :tile="tile" small />
          </div>
        </div>
        <div class="pool">
          <TileView v-for="(tile, i) in store.state.players[seatLayout.top].discards" :key="i" :tile="tile" small dimmed />
        </div>
      </section>

      <section class="seat seat-left" @click="openRead(seatLayout.left)">
        <div class="seat-head">
          <strong>{{ store.relativeLabel(seatLayout.left) }}</strong>
          <span>{{ store.handTilesOf(seatLayout.left).length }} 张</span>
        </div>
        <div class="backs column">
          <span v-for="n in store.handTilesOf(seatLayout.left).length" :key="n" class="back" />
        </div>
        <div class="melds column">
          <div v-for="(meld, i) in store.openMelds(seatLayout.left)" :key="i" class="meld column">
            <TileView v-for="(tile, j) in meld.tiles" :key="j" :tile="tile" small />
          </div>
        </div>
        <div class="pool compact">
          <TileView v-for="(tile, i) in store.state.players[seatLayout.left].discards" :key="i" :tile="tile" small dimmed />
        </div>
      </section>

      <section class="center">
        <div class="center-tile">
          <TileView :tile="store.state.jokerTile" joker />
          <p>本局财神</p>
          <p class="hint">白板视同 {{ tileName(store.state.jokerTile) }}</p>
        </div>
        <p class="turn-hint" v-if="store.running && !store.state.result">
          {{ store.isHumanTurn ? '轮到你出牌' : `${store.relativeLabel(store.state.turn)}思考中…` }}
        </p>
      </section>

      <section class="seat seat-right" @click="openRead(seatLayout.right)">
        <div class="seat-head">
          <strong>{{ store.relativeLabel(seatLayout.right) }}</strong>
          <span>{{ store.handTilesOf(seatLayout.right).length }} 张</span>
        </div>
        <div class="backs column">
          <span v-for="n in store.handTilesOf(seatLayout.right).length" :key="n" class="back" />
        </div>
        <div class="melds column">
          <div v-for="(meld, i) in store.openMelds(seatLayout.right)" :key="i" class="meld column">
            <TileView v-for="(tile, j) in meld.tiles" :key="j" :tile="tile" small />
          </div>
        </div>
        <div class="pool compact">
          <TileView v-for="(tile, i) in store.state.players[seatLayout.right].discards" :key="i" :tile="tile" small dimmed />
        </div>
      </section>
    </main>

    <footer class="mine">
      <div class="mine-head">
        <strong>我的手牌</strong>
        <span v-if="store.advicePending" class="hint">正在计算出牌建议…</span>
        <span v-else-if="store.settings.highlightBest && best && store.canDiscard" class="hint">
          推荐：{{ tileName(best.tile) }}（{{ best.shanten <= 0 ? '听牌' : `${best.shanten} 向听` }}，进张 {{ best.ukeireTotal }} 张）
        </span>
        <span class="hint">←→ 选牌 · ↑ 提牌 · 空格出牌 · 悬停看胜率</span>
      </div>
      <div v-if="store.kongPrompt" class="kong-bar">
        <span>可以杠：</span>
        <button
          v-for="(tile, i) in store.kongPrompt.anKongs"
          :key="`an-${tile}`"
          type="button"
          class="primary"
          :class="{ active: kongCursor === i }"
          @click="store.answerKong(tile)"
        >
          暗杠 {{ tileName(tile) }}
        </button>
        <button
          v-for="(tile, i) in store.kongPrompt.addKongs"
          :key="`add-${tile}`"
          type="button"
          class="primary"
          :class="{ active: kongCursor === store.kongPrompt.anKongs.length + i }"
          @click="store.answerKong(tile)"
        >
          加杠 {{ tileName(tile) }}
        </button>
        <button type="button" class="ghost" @click="store.answerKong(null)">过</button>
      </div>
      <div class="mine-melds">
        <div v-for="(meld, i) in store.openMelds(HUMAN_SEAT)" :key="i" class="meld">
          <span class="meld-tag">{{ meldLabel(meld) }}</span>
          <TileView v-for="(tile, j) in meld.tiles" :key="j" :tile="tile" small />
        </div>
      </div>
      <div class="hand">
        <div
          v-for="(tile, i) in store.human.hand"
          :key="`${tile}-${i}`"
          class="hand-item"
          :class="{ 'tip-right': i >= store.human.hand.length / 2 }"
          @mouseenter="hoveredIndex = i"
          @mouseleave="hoveredIndex = null"
        >
          <TileView
            :tile="tile"
            :joker="isJoker(tile)"
            :proxy="isProxy(tile)"
            :clickable="store.canDiscard && store.legalTiles.has(tile)"
            :dimmed="store.canDiscard && !store.legalTiles.has(tile)"
            :highlighted="store.settings.highlightBest && best?.tile === tile && store.canDiscard"
            :focused="store.canDiscard && i === cursorIndex"
            :lifted="store.canDiscard && i === liftedIndex"
            @pick="pickTile(tile)"
          />
          <div
            v-if="hoverTip && hoveredIndex === i"
            class="rate-tip"
            :class="{ best: !hoverTip.blocked && hoverTip.isBest, blocked: hoverTip.blocked }"
          >
            <template v-if="hoverTip.blocked">
              <strong>当前不可打出</strong>
              <span>有风跟打：牌河末张的字牌，手中仅一张时须跟打</span>
            </template>
            <template v-else>
              <strong>{{ hoverTip.isBest ? '✓ 最佳出牌' : `第 ${hoverTip.rank} 选 / 共 ${hoverTip.total} 张` }}</strong>
              <span class="tip-rate">胜率 {{ hoverTip.rate.toFixed(1) }}%</span>
              <span>
                {{ hoverTip.shanten <= 0 ? '打出即听牌' : `打出后 ${hoverTip.shanten} 向听` }} · 进张 {{ hoverTip.ukeire }} 张
              </span>
            </template>
          </div>
        </div>
      </div>
      <div class="mine-pool">
        <TileView v-for="(tile, i) in store.human.discards" :key="i" :tile="tile" small dimmed />
      </div>
      <div class="seat-actions">
        <button v-for="seat in opponents" :key="seat" type="button" class="ghost" @click="openRead(seat)">
          分析{{ store.relativeLabel(seat) }}
        </button>
      </div>
    </footer>

    <div v-if="settingsOpen" class="overlay">
      <div class="dialog narrow">
        <h2>设置</h2>
        <div class="settings-list">
          <label>
            <input v-model="store.settings.adviceAlert" type="checkbox" />
            <span>
              <b>出牌胜率提示</b>
              <em>打出的牌明显偏离最优解时，弹出全部可打牌的胜率对比并可改牌</em>
            </span>
          </label>
          <label>
            <input v-model="store.settings.hoverRate" type="checkbox" />
            <span>
              <b>悬停显示胜率</b>
              <em>鼠标移到手牌上，即时显示该张胜率、排名与是否最佳出牌</em>
            </span>
          </label>
          <label>
            <input v-model="store.settings.highlightBest" type="checkbox" />
            <span>
              <b>高亮推荐牌</b>
              <em>在手牌上标出当前推荐打出的牌，并在牌桌提示推荐结论</em>
            </span>
          </label>
          <label>
            <input v-model="store.settings.plainMode" type="checkbox" />
            <span>
              <b>摸鱼模式</b>
              <em>收起图形牌桌，改为纯文字命令行交互，整页呈现为一份对局记录</em>
            </span>
          </label>
        </div>
        <div class="dialog-actions">
          <button type="button" class="primary" @click="settingsOpen = false">完成</button>
        </div>
      </div>
    </div>

    <div v-if="adviceOpen" class="overlay">
      <div class="dialog wide">
        <h2>这一手更推荐打 {{ best ? tileName(best.tile) : '' }}</h2>
        <p class="lead">
          你选择的是
          <b>{{ pendingTile !== null ? tileName(pendingTile) : '' }}</b>
          ，与推荐解相差
          <b>{{ pendingCandidate && best ? (best.value - pendingCandidate.value).toFixed(0) : '—' }}</b>
          分。下表列出每一张可打牌的评估与理由。
        </p>
        <div class="table-wrap">
          <table class="advice-table">
            <thead>
              <tr>
                <th>排名</th>
                <th>牌</th>
                <th>胜率</th>
                <th>打出后</th>
                <th>有效进张</th>
                <th>危险度</th>
                <th>理由</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, index) in candidates"
                :key="row.tile"
                :class="{ best: row.rank === 1, chosen: row.tile === pendingTile }"
              >
                <td>{{ row.rank }}</td>
                <td><TileView :tile="row.tile" small :joker="isJoker(row.tile)" :proxy="isProxy(row.tile)" /></td>
                <td class="rate">{{ ((rates[index] ?? 0) * 100).toFixed(1) }}%</td>
                <td>{{ row.shanten < 0 ? '成牌' : row.shanten === 0 ? '听牌' : `${row.shanten} 向听` }}</td>
                <td>{{ row.ukeireTotal }} 张</td>
                <td>{{ Math.round(row.danger * 100) }}%</td>
                <td class="reason">{{ row.reason }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="hint">
          胜率由「打出后的向听数、有效进张张数、对他家的危险度」综合折算，同一手牌内横向比较，数值越高越优。
        </p>
        <div class="dialog-actions">
          <button type="button" class="ghost" @click="keepOriginal">仍打 {{ pendingTile !== null ? tileName(pendingTile) : '' }}</button>
          <button v-if="best" type="button" class="primary" @click="switchTo(best.tile)">
            改打 {{ tileName(best.tile) }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="readOpen" class="overlay">
      <div class="dialog">
        <h2>{{ store.focusSeat !== null ? store.relativeLabel(store.focusSeat) : '' }} 的牌型分析</h2>
        <template v-if="store.opponentRead">
          <p class="lead">{{ store.opponentRead.summary }}</p>
          <p class="hint">方向判断：{{ store.opponentRead.tendency }}</p>
          <h3>最需要提防的牌</h3>
          <ul class="danger-list">
            <li v-for="item in store.opponentRead.dangers.slice(0, 8)" :key="item.tile">
              <TileView :tile="item.tile" small />
              <span class="danger-value">{{ Math.round(item.danger * 100) }}%</span>
              <span class="reason">{{ item.reason }}</span>
            </li>
          </ul>
          <h3>该家牌河</h3>
          <div class="pool">
            <TileView
              v-for="(tile, i) in store.focusSeat !== null ? store.state.players[store.focusSeat].discards : []"
              :key="i"
              :tile="tile"
              small
              dimmed
            />
          </div>
        </template>
        <p v-else class="hint">正在分析…</p>
        <div class="dialog-actions">
          <button type="button" class="primary" @click="closeRead">知道了</button>
        </div>
      </div>
    </div>

    <div v-if="store.claimPrompt" class="overlay">
      <div class="dialog narrow">
        <h2>可以响应 {{ tileName(store.claimPrompt.tile) }}</h2>
        <div class="dialog-actions">
          <button
            v-for="(option, i) in store.claimPrompt.options"
            :key="`${option.kind}-${option.tiles?.join(',') ?? ''}`"
            type="button"
            class="primary"
            :class="{ active: claimCursor === i }"
            @click="store.answerClaim(true, option)"
          >
            {{ claimLabel(option.kind) }}
          </button>
          <button
            v-if="store.claimPrompt.canDeclareReady"
            type="button"
            class="ghost"
            :class="{ active: claimCursor === store.claimPrompt.options.length }"
            @click="store.declareReady()"
          >
            听牌
          </button>
          <button type="button" class="ghost" @click="store.answerClaim(false)">过</button>
        </div>
      </div>
    </div>

    <div v-if="store.selfWinPrompt" class="overlay">
      <div class="dialog narrow">
        <h2>可以自摸胡牌</h2>
        <div class="dialog-actions">
          <button type="button" class="primary" @click="store.answerSelfWin(true)">胡牌</button>
          <button type="button" class="ghost" @click="store.answerSelfWin(false)">继续打</button>
        </div>
      </div>
    </div>

    <div v-if="store.state.result" class="overlay">
      <div class="dialog narrow">
        <h2>{{ resultText }}</h2>
        <p v-if="resultDetail" class="lead">{{ resultDetail }}</p>
        <div class="dialog-actions">
          <button type="button" class="primary" @click="restart(store.difficulty)">再来一局</button>
        </div>
      </div>
    </div>

    <StatsPanel v-if="statsOpen" variant="dark" @close="statsOpen = false" />
  </div>
</template>

<style scoped>
/* 至少撑满一屏，多余空间由牌桌吸收；内容更高时让页面滚动，不裁切 */
.app {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  gap: 12px;
  padding: 14px 18px 20px;
}

.topbar {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
}

h1 {
  margin: 0;
  font-size: 19px;
  letter-spacing: 1px;
}

.meta {
  display: flex;
  align-items: center;
  gap: 10px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  font-size: 13px;
}

.chip.warn {
  background: rgba(255, 176, 32, 0.24);
  color: #ffd479;
}

.difficulty {
  margin-left: auto;
  display: flex;
  gap: 6px;
}

.difficulty button {
  padding: 6px 14px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font-size: 13px;
  cursor: pointer;
}

.difficulty button.active {
  background: #d9a520;
  border-color: #d9a520;
  color: #2b1d00;
  font-weight: 700;
}

.table {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 170px minmax(280px, 1fr) 170px;
  grid-template-rows: auto auto;
  gap: 12px;
  align-items: start;
}

.seat {
  padding: 10px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.22);
  cursor: pointer;
  transition: background 0.15s ease;
}

.seat:hover {
  background: rgba(0, 0, 0, 0.34);
}

.seat-top {
  grid-column: 2;
  grid-row: 1;
}

.seat-left {
  grid-column: 1;
  grid-row: 2;
}

.seat-right {
  grid-column: 3;
  grid-row: 2;
}

.center {
  grid-column: 2;
  grid-row: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 190px;
}

.center-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.center-tile p {
  margin: 0;
  font-size: 13px;
}

.turn-hint {
  margin: 0;
  font-size: 14px;
  color: #ffd479;
}

.seat-head {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  margin-bottom: 8px;
  opacity: 0.9;
}

.backs {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  margin-bottom: 8px;
}

/* 左右座位竖排牌背会叠成 300px+ 把牌桌撑高，改双列 */
.backs.column {
  display: grid;
  grid-template-columns: repeat(2, 14px);
}

.back {
  width: 14px;
  height: 20px;
  border-radius: 3px;
  background: linear-gradient(160deg, #2f6fb0, #1d4a7c);
  border: 1px solid rgba(255, 255, 255, 0.25);
}

.melds {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.melds.column {
  flex-direction: column;
}

.meld {
  display: flex;
  align-items: center;
  gap: 2px;
}

.meld.column {
  flex-direction: column;
}

.meld-tag {
  font-size: 11px;
  opacity: 0.75;
  margin-right: 4px;
}

.pool {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  max-height: 120px;
  overflow: hidden;
}

.pool.compact {
  max-height: 150px;
}

.mine {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.26);
}

.mine-head {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
}

.hint {
  opacity: 0.82;
  font-size: 12px;
}

.mine-melds {
  display: flex;
  gap: 10px;
}

.hand {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.hand-item {
  position: relative;
}

/* 靠左的牌提示框左对齐、靠右的右对齐，避免贴边时被视口裁掉 */
.rate-tip {
  position: absolute;
  bottom: calc(100% + 10px);
  left: -4px;
  z-index: 6;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 148px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #0b1a24;
  border: 1px solid rgba(255, 255, 255, 0.2);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.5);
  font-size: 11px;
  line-height: 1.4;
  white-space: nowrap;
  pointer-events: none;
}

.hand-item.tip-right .rate-tip {
  left: auto;
  right: -4px;
}

.rate-tip.best {
  border-color: rgba(217, 165, 32, 0.85);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.5), 0 0 14px rgba(217, 165, 32, 0.4);
}

.rate-tip.blocked {
  border-color: rgba(248, 113, 113, 0.6);
}

.rate-tip.blocked strong {
  color: #fca5a5;
}

.rate-tip strong {
  font-size: 12px;
  color: #cfe4f5;
}

.rate-tip.best strong {
  color: #ffd479;
}

.tip-rate {
  color: #7dd3fc;
  font-weight: 700;
}

.kong-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(217, 165, 32, 0.18);
  font-size: 13px;
}

.kong-bar button {
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  background: transparent;
  color: inherit;
  font-size: 12px;
  cursor: pointer;
}

.kong-bar button.primary {
  background: #e0a815;
  border-color: #e0a815;
  color: #2b1d00;
  font-weight: 700;
}

.settings-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin: 4px 0 8px;
}

.settings-list label {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  cursor: pointer;
}

.settings-list input {
  margin-top: 3px;
  width: 16px;
  height: 16px;
  accent-color: #e0a815;
  cursor: pointer;
}

.settings-list span {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.settings-list b {
  font-size: 13px;
}

.settings-list em {
  font-size: 11.5px;
  font-style: normal;
  opacity: 0.72;
  line-height: 1.5;
}

.difficulty button.icon {
  border-color: rgba(255, 255, 255, 0.4);
}

.mine-pool {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}

.seat-actions {
  display: flex;
  gap: 8px;
}

.overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(4, 10, 16, 0.72);
  z-index: 20;
}

.dialog {
  width: min(560px, 100%);
  max-height: 86vh;
  overflow: auto;
  padding: 20px;
  border-radius: 14px;
  background: #12202c;
  border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5);
}

.dialog.wide {
  width: min(880px, 100%);
}

.dialog.narrow {
  width: min(400px, 100%);
}

.dialog h2 {
  margin: 0 0 10px;
  font-size: 17px;
}

.dialog h3 {
  margin: 14px 0 8px;
  font-size: 14px;
  opacity: 0.9;
}

.lead {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.6;
  opacity: 0.92;
}

.table-wrap {
  overflow-x: auto;
}

.advice-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.advice-table th,
.advice-table td {
  padding: 6px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  text-align: left;
  vertical-align: middle;
}

.advice-table th {
  font-weight: 600;
  opacity: 0.75;
  white-space: nowrap;
}

.advice-table tr.best {
  background: rgba(217, 165, 32, 0.16);
}

.advice-table tr.chosen {
  outline: 1px solid rgba(255, 120, 120, 0.6);
}

.rate {
  font-weight: 700;
  color: #ffd479;
  white-space: nowrap;
}

.reason {
  opacity: 0.85;
  line-height: 1.5;
}

.danger-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.danger-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.danger-value {
  min-width: 40px;
  color: #ff9a76;
  font-weight: 700;
}

.dialog-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 16px;
}

.dialog-actions button {
  padding: 8px 18px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  background: transparent;
  color: inherit;
  font-size: 13px;
  cursor: pointer;
}

.dialog-actions button.primary {
  background: #d9a520;
  border-color: #d9a520;
  color: #2b1d00;
  font-weight: 700;
}

.dialog-actions button.ghost:hover {
  background: rgba(255, 255, 255, 0.1);
}

/* 键盘光标所在项 */
.dialog-actions button.active,
.kong-bar button.active {
  outline: 2px solid #ffd479;
  outline-offset: 1px;
}
</style>

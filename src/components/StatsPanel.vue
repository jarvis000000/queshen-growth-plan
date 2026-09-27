<script setup lang="ts">
import { computed, ref } from 'vue'
import { resetStats, stats, summarize } from '../stores/stats'

/** variant 决定遮罩与卡片配色：dark 用于图形界面，light 用于摸鱼模式的浅色终端 */
const props = defineProps<{ variant?: 'dark' | 'light' }>()

const emit = defineEmits<{ (event: 'close'): void }>()

const rootClass = computed(() => props.variant ?? 'dark')
const summary = computed(() => summarize(stats))

/** 清空属实破坏性操作，先切到二次确认再执行 */
const confirming = ref(false)

function signed(value: number): string {
  return value > 0 ? `+${value}` : `${value}`
}

function percent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`
}

function confirmReset(): void {
  resetStats()
  confirming.value = false
}
</script>

<template>
  <div class="stats-layer" :class="rootClass" @click.stop>
    <section class="stats-panel">
      <h2>
        战绩
        <span v-if="summary.games > 0" class="sub">累计 {{ summary.games }} 局</span>
      </h2>

      <p v-if="summary.empty" class="empty">还没有战绩，打完一局再来看看。</p>

      <template v-else>
        <div class="headline">
          <span class="label">累计净分</span>
          <strong class="value" :class="{ up: summary.netScore > 0, down: summary.netScore < 0 }">
            {{ signed(summary.netScore) }}
          </strong>
          <span class="label">胜率</span>
          <strong class="value">{{ percent(summary.winRate) }}</strong>
        </div>

        <dl class="rows">
          <div><dt>总局数</dt><dd>{{ summary.games }}</dd></div>
          <div><dt>胡牌</dt><dd>{{ summary.wins }}</dd></div>
          <div><dt>放炮</dt><dd>{{ summary.dealIns }}</dd></div>
          <div><dt>流局</dt><dd>{{ summary.draws }}</dd></div>
          <div v-if="summary.others > 0"><dt>他胡</dt><dd>{{ summary.others }}</dd></div>
        </dl>

        <dl class="rows">
          <div class="wide"><dt>总手数</dt><dd>{{ summary.hands }}</dd></div>
          <div v-for="bucket in summary.buckets" :key="bucket.key" class="wide">
            <dt>{{ bucket.label }}</dt>
            <dd>{{ bucket.count }} <em>{{ percent(bucket.pct) }}</em></dd>
          </div>
        </dl>
      </template>

      <div class="actions">
        <template v-if="confirming">
          <button type="button" class="danger" @click="confirmReset">确认清空</button>
          <button type="button" @click="confirming = false">取消</button>
        </template>
        <template v-else>
          <button type="button" :disabled="summary.empty" @click="confirming = true">清空战绩</button>
          <button type="button" class="primary" @click="emit('close')">关闭</button>
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* 覆盖图形弹层(z-index 20)与摸鱼模式整页(z-index 40) */
.stats-layer {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: var(--scrim);
}

.stats-layer.dark {
  --scrim: rgba(4, 10, 16, 0.72);
  --panel-bg: #12202c;
  --fg: #eef3f8;
  --muted: rgba(238, 243, 248, 0.72);
  --line: rgba(255, 255, 255, 0.16);
  --accent: #ffd479;
  --up: #ffd479;
  --down: #fca5a5;
  --btn-bg: rgba(255, 255, 255, 0.06);
  --btn-line: rgba(255, 255, 255, 0.24);
  --btn-fg: #cfe4f5;
  --primary-bg: #d9a520;
  --primary-fg: #2b1d00;
}

.stats-layer.light {
  --scrim: rgba(31, 41, 55, 0.28);
  --panel-bg: #ffffff;
  --fg: #24292f;
  --muted: #8c959f;
  --line: #d8dee4;
  --accent: #0969da;
  --up: #1a7f37;
  --down: #cf222e;
  --btn-bg: #f6f8fa;
  --btn-line: #d0d7de;
  --btn-fg: #57606a;
  --primary-bg: #1a7f37;
  --primary-fg: #ffffff;
}

.stats-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: min(400px, 100%);
  max-height: 100%;
  overflow-y: auto;
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--panel-bg);
  color: var(--fg);
  font-size: 13px;
}

h2 {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0;
  font-size: 15px;
  color: var(--accent);
}

h2 .sub {
  color: var(--muted);
  font-size: 12px;
  font-weight: 400;
}

.empty {
  margin: 0;
  color: var(--muted);
}

.headline {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}

.headline .label {
  color: var(--muted);
  font-size: 12px;
}

.headline .value {
  margin-right: 14px;
  font-size: 16px;
}

.headline .value.up {
  color: var(--up);
}

.headline .value.down {
  color: var(--down);
}

.rows {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  margin: 0;
  padding: 10px 0 0;
  border-top: 1px solid var(--line);
}

.rows > div {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.rows dt {
  color: var(--muted);
  font-size: 12px;
}

.rows dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.rows dd em {
  color: var(--muted);
  font-size: 12px;
  font-style: normal;
  font-weight: 400;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
}

.actions button {
  padding: 7px 16px;
  border: 1px solid var(--btn-line);
  border-radius: 8px;
  background: var(--btn-bg);
  color: var(--btn-fg);
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
}

.actions button:disabled {
  opacity: 0.5;
  cursor: default;
}

.actions button.primary {
  border-color: transparent;
  background: var(--primary-bg);
  color: var(--primary-fg);
  font-weight: 600;
}

.actions button.danger {
  border-color: var(--down);
  color: var(--down);
}

.actions button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
</style>

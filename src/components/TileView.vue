<script setup lang="ts">
import { computed } from 'vue'
import { suitOf } from '../engine/tiles'

const props = withDefaults(
  defineProps<{
    tile: number
    /** 是否为万能牌本体（财神牌） */
    joker?: boolean
    /** 是否为等效财神原牌的白板 */
    proxy?: boolean
    small?: boolean
    dimmed?: boolean
    highlighted?: boolean
    clickable?: boolean
    /** 横向紧凑排列（用于副露等） */
    flat?: boolean
    /** 键盘光标当前停留 */
    focused?: boolean
    /** 已被提起，等待确认打出 */
    lifted?: boolean
  }>(),
  {
    joker: false,
    proxy: false,
    small: false,
    dimmed: false,
    highlighted: false,
    clickable: false,
    flat: false,
    focused: false,
    lifted: false,
  },
)

const emit = defineEmits<{ (event: 'pick'): void }>()

const HONOR_LABELS = ['东', '南', '西', '北', '中', '发', '白']
const WHITE_DRAGON = 33

/** 各牌种的图案落点，坐标为 0-1 的相对位置 */
const PIP_LAYOUTS: readonly (readonly [number, number][])[] = [
  [[0.5, 0.5]],
  [
    [0.5, 0.28],
    [0.5, 0.72],
  ],
  [
    [0.26, 0.22],
    [0.5, 0.5],
    [0.74, 0.78],
  ],
  [
    [0.3, 0.3],
    [0.7, 0.3],
    [0.3, 0.7],
    [0.7, 0.7],
  ],
  [
    [0.26, 0.26],
    [0.74, 0.26],
    [0.5, 0.5],
    [0.26, 0.74],
    [0.74, 0.74],
  ],
  [
    [0.3, 0.2],
    [0.7, 0.2],
    [0.3, 0.5],
    [0.7, 0.5],
    [0.3, 0.8],
    [0.7, 0.8],
  ],
  [
    [0.24, 0.18],
    [0.5, 0.18],
    [0.76, 0.18],
    [0.3, 0.5],
    [0.7, 0.5],
    [0.3, 0.82],
    [0.7, 0.82],
  ],
  [
    [0.3, 0.16],
    [0.7, 0.16],
    [0.3, 0.39],
    [0.7, 0.39],
    [0.3, 0.61],
    [0.7, 0.61],
    [0.3, 0.84],
    [0.7, 0.84],
  ],
  [
    [0.24, 0.2],
    [0.5, 0.2],
    [0.76, 0.2],
    [0.24, 0.5],
    [0.5, 0.5],
    [0.76, 0.5],
    [0.24, 0.8],
    [0.5, 0.8],
    [0.76, 0.8],
  ],
]

const PIP_RADIUS = [0, 27, 21, 18, 17, 15.5, 13.5, 12.5, 11.5, 11]
const CN_DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']

const face = computed(() => {
  const tile = props.tile
  if (tile >= 27) {
    const label = HONOR_LABELS[tile - 27]
    return { kind: 'honor' as const, label, red: tile === 31 }
  }
  const suit = suitOf(tile)
  const rank = (tile % 9) + 1
  const pips = PIP_LAYOUTS[rank - 1]
  const radius = PIP_RADIUS[rank]
  if (suit === 0) return { kind: 'wan' as const, rank, cn: CN_DIGITS[rank] }
  if (suit === 1) return { kind: 'tong' as const, pips, radius }
  return { kind: 'tiao' as const, pips, radius }
})

const suitClass = computed(() => {
  const tile = props.tile
  if (tile < 27) return ['suit-wan', 'suit-tong', 'suit-tiao'][suitOf(tile)]
  return tile === WHITE_DRAGON ? 'suit-white' : 'suit-honor'
})
</script>

<template>
  <button
    type="button"
    class="tile"
    :class="[suitClass, { small, flat, dimmed, highlighted, clickable, joker, focused, lifted }]"
    :disabled="!clickable"
    @click="emit('pick')"
  >
    <span class="face">
      <template v-if="face.kind === 'wan'">
        <span class="wan-cn">{{ face.cn }}</span>
        <span class="wan-char">萬</span>
      </template>

      <svg v-else-if="face.kind === 'tong'" class="pips" viewBox="0 0 100 100" aria-hidden="true">
        <template v-for="(pip, index) in face.pips" :key="index">
          <circle :cx="pip[0] * 100" :cy="pip[1] * 100" :r="face.radius" class="pip-outer" />
          <circle :cx="pip[0] * 100" :cy="pip[1] * 100" :r="face.radius * 0.42" class="pip-inner" />
        </template>
      </svg>

      <svg v-else-if="face.kind === 'tiao'" class="pips" viewBox="0 0 100 100" aria-hidden="true">
        <template v-for="(pip, index) in face.pips" :key="index">
          <rect
            :x="pip[0] * 100 - face.radius * 0.36"
            :y="pip[1] * 100 - face.radius * 1.15"
            :width="face.radius * 0.72"
            :height="face.radius * 2.3"
            :rx="face.radius * 0.34"
            class="stick"
          />
          <rect
            :x="pip[0] * 100 - face.radius * 0.36"
            :y="pip[1] * 100 - face.radius * 0.16"
            :width="face.radius * 0.72"
            :height="face.radius * 0.32"
            class="stick-band"
          />
        </template>
      </svg>

      <span v-else class="honor" :class="{ red: face.red }">{{ face.label }}</span>
    </span>

    <span v-if="joker" class="mark">财</span>
    <span v-else-if="proxy" class="mark proxy">代</span>
  </button>
</template>

<style scoped>
.tile {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 43px;
  height: 61px;
  padding: 3px;
  border: none;
  border-radius: 7px;
  background: linear-gradient(180deg, #fffef9 0%, #fbf6e6 62%, #e8dfc6 100%);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.85),
    0 0 0 1px #c9bd9d,
    0 3px 0 #b8a97f,
    0 5px 9px rgba(0, 0, 0, 0.32);
  color: #2b2f36;
  font-family: inherit;
  line-height: 1;
  cursor: default;
  transition: transform 0.12s ease, box-shadow 0.12s ease, opacity 0.12s ease, filter 0.12s ease;
}

.tile.small {
  width: 32px;
  height: 46px;
  padding: 2px;
  border-radius: 5px;
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.85),
    0 0 0 1px #c9bd9d,
    0 2px 0 #b8a97f,
    0 3px 6px rgba(0, 0, 0, 0.3);
}

.tile.flat {
  width: 28px;
}

.face {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

/* 万子 */
.wan-cn {
  font-size: 18px;
  font-weight: 800;
  color: #1d4ed8;
}

.wan-char {
  font-size: 18px;
  font-weight: 800;
  color: #b91c1c;
  margin-top: 1px;
}

.small .wan-cn {
  font-size: 13px;
}

.small .wan-char {
  font-size: 12px;
}

/* 筒子与条子图案 */
.pips {
  width: 100%;
  height: 100%;
}

.tile.suit-tong .pip-outer {
  fill: #fff;
  stroke: #1d4ed8;
  stroke-width: 7;
}

.tile.suit-tong .pip-inner {
  fill: #1d4ed8;
}

.tile.suit-tiao .stick {
  fill: #15803d;
}

.tile.suit-tiao .stick-band {
  fill: #bbf7d0;
}

/* 字牌 */
.honor {
  font-size: 24px;
  font-weight: 800;
  color: #1f2937;
}

.honor.red {
  color: #b91c1c;
}

.small .honor {
  font-size: 17px;
}

.tile.suit-white .honor {
  color: #64748b;
  font-size: 21px;
  padding: 2px 5px;
  border: 2px solid #64748b;
  border-radius: 3px;
}

.small.tile.suit-white .honor {
  font-size: 13px;
  border-width: 1.5px;
}

.mark {
  position: absolute;
  top: 1px;
  right: 2px;
  padding: 0 3px;
  border-radius: 3px;
  background: #e0a815;
  color: #4a3400;
  font-size: 9px;
  font-weight: 800;
  line-height: 13px;
  box-shadow: 0 0 6px rgba(224, 168, 21, 0.7);
}

.small .mark {
  font-size: 7px;
  line-height: 10px;
  padding: 0 2px;
}

.mark.proxy {
  background: #7f9cc9;
  color: #0f2038;
  box-shadow: none;
}

.tile.clickable {
  cursor: pointer;
}

.tile.clickable:hover:not(:disabled) {
  transform: translateY(-7px);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.9),
    0 0 0 1px #c9bd9d,
    0 3px 0 #b8a97f,
    0 12px 20px rgba(0, 0, 0, 0.4);
}

.tile.joker {
  background: linear-gradient(180deg, #fffdf0 0%, #fdf1c4 62%, #f0dfa0 100%);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.9),
    0 0 0 2px #e0a815,
    0 3px 0 #b8860b,
    0 0 16px rgba(224, 168, 21, 0.6);
}

.tile.highlighted {
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.9),
    0 0 0 2px #38bdf8,
    0 3px 0 #0369a1,
    0 0 18px rgba(56, 189, 248, 0.75);
}

.tile.focused {
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.9),
    0 0 0 2px #f59e0b,
    0 3px 0 #b45309,
    0 0 16px rgba(245, 158, 11, 0.65);
}

.tile.lifted {
  transform: translateY(-13px);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.95),
    0 0 0 3px #22d3ee,
    0 7px 0 #0e7490,
    0 16px 24px rgba(0, 0, 0, 0.5);
}

.tile.dimmed {
  opacity: 0.45;
  filter: saturate(0.55);
}

.tile:disabled {
  cursor: default;
}
</style>

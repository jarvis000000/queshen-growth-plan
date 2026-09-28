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

interface Stick {
  x: number
  y: number
  /** 倾斜角度（度），0 为竖直；供 8 条画出斜向交叉 */
  angle?: number
}

/**
 * 条子按真实麻将排布：成行横排，8 条上下两行斜向相反形成交叉。
 * 与筒子的圆点排布差异较大，故单独维护一张表。
 */
const TIAO_LAYOUTS: readonly (readonly Stick[])[] = [
  [{ x: 0.5, y: 0.5 }],
  [{ x: 0.5, y: 0.27 }, { x: 0.5, y: 0.73 }],
  [{ x: 0.5, y: 0.24 }, { x: 0.28, y: 0.72 }, { x: 0.72, y: 0.72 }],
  [{ x: 0.3, y: 0.28 }, { x: 0.7, y: 0.28 }, { x: 0.3, y: 0.72 }, { x: 0.7, y: 0.72 }],
  [{ x: 0.28, y: 0.2 }, { x: 0.72, y: 0.2 }, { x: 0.5, y: 0.5 }, { x: 0.28, y: 0.8 }, { x: 0.72, y: 0.8 }],
  [{ x: 0.22, y: 0.3 }, { x: 0.5, y: 0.3 }, { x: 0.78, y: 0.3 }, { x: 0.22, y: 0.72 }, { x: 0.5, y: 0.72 }, { x: 0.78, y: 0.72 }],
  [
    { x: 0.5, y: 0.14 },
    { x: 0.24, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.76, y: 0.5 },
    { x: 0.24, y: 0.84 }, { x: 0.5, y: 0.84 }, { x: 0.76, y: 0.84 },
  ],
  [
    { x: 0.16, y: 0.28, angle: 32 }, { x: 0.39, y: 0.28, angle: 32 }, { x: 0.62, y: 0.28, angle: 32 }, { x: 0.85, y: 0.28, angle: 32 },
    { x: 0.16, y: 0.72, angle: -32 }, { x: 0.39, y: 0.72, angle: -32 }, { x: 0.62, y: 0.72, angle: -32 }, { x: 0.85, y: 0.72, angle: -32 },
  ],
  [
    { x: 0.24, y: 0.22 }, { x: 0.5, y: 0.22 }, { x: 0.76, y: 0.22 },
    { x: 0.24, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.76, y: 0.5 },
    { x: 0.24, y: 0.78 }, { x: 0.5, y: 0.78 }, { x: 0.76, y: 0.78 },
  ],
]

/** 条子的宽高：列多则窄、行多则矮，避免相邻两根粘连成一片 */
const TIAO_SIZE = [
  { w: 16, h: 46 },
  { w: 16, h: 30 },
  { w: 15, h: 26 },
  { w: 15, h: 26 },
  { w: 14, h: 22 },
  { w: 13, h: 32 },
  { w: 13, h: 22 },
  { w: 11, h: 26 },
  { w: 13, h: 22 },
]

const CN_DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']

const face = computed(() => {
  const tile = props.tile
  if (tile >= 27) {
    // 白板与真实牌面一致：只留空框，不写「白」字
    const isWhite = tile === WHITE_DRAGON
    return {
      kind: 'honor' as const,
      label: isWhite ? '' : HONOR_LABELS[tile - 27],
      red: tile === 31,
      green: tile === 32,
    }
  }
  const suit = suitOf(tile)
  const rank = (tile % 9) + 1
  if (suit === 0) return { kind: 'wan' as const, rank, cn: CN_DIGITS[rank] }
  if (suit === 1) return { kind: 'tong' as const, pips: PIP_LAYOUTS[rank - 1], radius: PIP_RADIUS[rank] }
  return { kind: 'tiao' as const, sticks: TIAO_LAYOUTS[rank - 1], size: TIAO_SIZE[rank - 1] }
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
        <template v-for="stick in face.sticks" :key="`${stick.x}-${stick.y}`">
          <g :transform="`rotate(${stick.angle ?? 0} ${stick.x * 100} ${stick.y * 100})`">
            <rect
              :x="stick.x * 100 - face.size.w / 2"
              :y="stick.y * 100 - face.size.h / 2"
              :width="face.size.w"
              :height="face.size.h"
              :rx="face.size.w * 0.42"
              class="stick"
            />
            <rect
              :x="stick.x * 100 - face.size.w / 2"
              :y="stick.y * 100 - face.size.h * 0.06"
              :width="face.size.w"
              :height="face.size.h * 0.16"
              class="stick-band"
            />
          </g>
        </template>
      </svg>

      <span v-else class="honor" :class="{ red: face.red, green: face.green }">{{ face.label }}</span>
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
  color: #1f2937;
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
  stroke: #166534;
  stroke-width: 7;
}

.tile.suit-tong .pip-inner {
  fill: #b91c1c;
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

.honor.green {
  color: #15803d;
}

.small .honor {
  font-size: 17px;
}

/* 白板只画一个空框，无文字，故用尺寸而非字号撑开 */
.tile.suit-white .honor {
  width: 58%;
  height: 68%;
  border: 2.5px solid #3f3f46;
  border-radius: 3px;
}

.small.tile.suit-white .honor {
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

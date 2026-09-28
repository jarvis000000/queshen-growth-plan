import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'

/** 递归清空目录内容；中文路径下 fs.rm 会静默失败，只能逐项 unlink */
function emptyDir(dir: string): void {
  for (const item of fs.readdirSync(dir)) {
    const abs = path.join(dir, item)
    if (fs.lstatSync(abs).isDirectory()) emptyDir(abs)
    else fs.unlinkSync(abs)
  }
}

/**
 * 兜底清空 outDir。
 * 项目路径含中文时 Vite 内建的 emptyOutDir 会静默失效，旧构建产物一直堆积。
 */
function emptyOutDirFallback(): Plugin {
  let outDir = ''
  let active = false
  return {
    name: 'empty-out-dir-fallback',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
      active = config.build.emptyOutDir === true
    },
    buildStart() {
      if (active && fs.existsSync(outDir)) emptyDir(outDir)
    },
  }
}

export default defineConfig({
  // 相对 base：同一份产物既能放域名根目录，也能放 GitHub Pages 的 /<仓库名>/ 子路径
  base: './',
  plugins: [vue(), emptyOutDirFallback()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  worker: {
    format: 'es',
  },
  build: {
    emptyOutDir: true,
  },
})

#!/usr/bin/env node
// Pasang hook git commit-msg yang mewajibkan versi aplikasi di pesan commit.
//
// Dijalankan lewat `git config core.hooksPath .githooks` (disimpan di .git/config,
// jadi tidak ikut ter-commit). Clone baru menjalankan `npm run setup` agar
// aturan versi berlaku kembali.
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, chmodSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOOKS_PATH = '.githooks'

const hook = join(ROOT, HOOKS_PATH, 'commit-msg')
if (!existsSync(hook)) {
  console.error(`Hook tidak ditemukan: ${hook}`)
  process.exit(1)
}
chmodSync(hook, 0o755)

try {
  execFileSync('git', ['config', 'core.hooksPath', HOOKS_PATH], { cwd: ROOT })
  console.log(`Hook commit-msg terpasang (core.hooksPath = ${HOOKS_PATH}).`)
  console.log('Setiap pesan commit wajib memuat versi aplikasi, mis. "[v1.0.0]".')
} catch (err) {
  console.error('Gagal mengatur core.hooksPath:', err.message)
  process.exit(1)
}

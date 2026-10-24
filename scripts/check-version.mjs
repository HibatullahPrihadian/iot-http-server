#!/usr/bin/env node
// Validasi versi aplikasi.
//
// 1. Semua package.json di repo harus punya versi yang sama dengan file VERSION.
// 2. Pesan commit harus memuat versi aplikasi (mis. "v1.0.0" atau "[v1.0.0]").
//
// Dipakai oleh hook commit-msg (scripts/hooks/commit-msg) dan bisa dijalankan
// manual: node scripts/check-version.mjs [file-pesan-commit]
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readVersion } from './version.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Package yang versinya harus sinkron dengan VERSION.
const PACKAGES = ['package.json', 'web/package.json', 'iot-api/package.json', 'hidro-backend/package.json']

let failed = false

// 1. Sinkronisasi versi package.json <-> VERSION.
const version = readVersion()
for (const rel of PACKAGES) {
  const file = join(ROOT, rel)
  if (!existsSync(file)) continue
  const pkg = JSON.parse(readFileSync(file, 'utf8'))
  if (pkg.version !== version) {
    console.error(
      `Versi tidak sinkron: ${rel} = "${pkg.version}", VERSION = "${version}". ` +
        `Jalan "npm run version:bump" lalu perbarui package.json.`
    )
    failed = true
  }
}

// 2. Pesan commit wajib memuat versi aplikasi.
const msgFile = process.argv[2]
if (msgFile && existsSync(msgFile)) {
  const message = readFileSync(msgFile, 'utf8')
  // Buang komentar & baris kosong (git menyisipkan "# ..." di awal file).
  const subject = message
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))[0] || ''
  if (!new RegExp(`\\bv${version.replace(/\./g, '\\.')}\\b`).test(subject)) {
    console.error(
      `Pesan commit wajib memuat versi aplikasi "v${version}".\n` +
        `Contoh: "Fitur baru: deskripsi singkat [v${version}]"`
    )
    failed = true
  }
}

if (failed) process.exit(1)
if (msgFile) console.log(`Versi aplikasi v${version} valid.`)

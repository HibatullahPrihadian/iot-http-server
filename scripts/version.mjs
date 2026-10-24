#!/usr/bin/env node
// Utilitas versi aplikasi.
//
// Sumber versi yang dibaca script ini adalah file /VERSION di root repo.
// Setiap service (iot-api, hidro-backend, web) memakai versi yang sama lewat
// package.json masing-masing; scripts/check-version.mjs memaksa keduanya
// selalu sinkron, dan hook commit-msg menolak commit bila tidak.
//
// Jalankan:
//
//   node scripts/version.mjs            -> cetak versi, mis. "1.0.0"
//   node scripts/version.mjs --json     -> {"version":"1.0.0"}
//   node scripts/version.mjs --bump patch|minor|major -> naikkan versi + tulis VERSION
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const VERSION_FILE = join(ROOT, 'VERSION')

// Baca versi saat ini dari file VERSION.
export function readVersion() {
  const raw = readFileSync(VERSION_FILE, 'utf8').trim()
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(raw)) {
    throw new Error(`VERSION tidak valid: "${raw}" (harus semver x.y.z)`)
  }
  return raw
}

// Naikkan versi sesuai bagian semver.
export function bumpVersion(part) {
  const current = readVersion()
  const [major, minor, patch] = current.split('.').map(Number)
  let next
  if (part === 'major') next = `${major + 1}.0.0`
  else if (part === 'minor') next = `${major}.${minor + 1}.0`
  else if (part === 'patch') next = `${major}.${minor}.${patch + 1}`
  else throw new Error(`Bagian versi tidak dikenal: ${part} (major|minor|patch)`)
  writeFileSync(VERSION_FILE, `${next}\n`)
  return next
}

// CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = process.argv[2]
  if (arg === '--json') {
    console.log(JSON.stringify({ version: readVersion() }))
  } else if (arg === '--bump') {
    console.log(bumpVersion(process.argv[3] || 'patch'))
  } else {
    console.log(readVersion())
  }
}

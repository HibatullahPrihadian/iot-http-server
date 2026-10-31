// Salinan nilai default setting untuk fallback frontend (offline/PWA atau saat
// GET /api/settings belum selesai). Sumber kebenaran ada di
// hidro-backend/settings.js — jaga keduanya tetap sinkron saat menambah field.
export const DEFAULT_SETTINGS = {
  general: {
    farmName: 'Hidroponik',
  },
  plan: {
    harvestReadyDays: 3,
    harvestBannerDays: 1,
    ppmTolerancePct: 10,
    phFallbackMin: 5.5,
    phFallbackMax: 6.5,
  },
  monitoring: {
    pollHidroSeconds: 5,
    pollListrikSeconds: 2,
    onlineWindowMinutes: 5,
    thresholds: {
      suhu_air: { warn: 28, danger: 30 },
      suhu_udara: { warn: 32, danger: 35 },
      kadar_tds: { dangerLow: 500, warnLow: 700, warnHigh: 1300, dangerHigh: 1500 },
      kelembapan_udara: { dangerLow: 40, dangerHigh: 80 },
      kadar_ph: { dangerLow: 5.5, dangerHigh: 6.5 },
      intensitas_uv: { dangerLow: 0, dangerHigh: 2000 },
    },
  },
  listrik: {
    tariffPerKwh: 1444.7,
    voltageWarnLow: 207,
    voltageDangerLow: 198,
    voltageWarnHigh: 235,
    voltageDangerHigh: 242,
    powerFactorWarn: 0.85,
  },
  device: {
    uplinkIntervalSeconds: 60,
    uplinkIntervalOptions: [60, 180, 300, 600],
    dosingTargetPpm: 800,
    dosingVolumeLiters: 180,
    dosingConstant: 160,
    maxPumpSeconds: 600,
    relayLabels: ['Relay 1', 'Relay 2', 'Relay 3', 'Relay 4'],
  },
  limits: {
    maxNotesChars: 2000,
    maxImagesPerBatch: 5,
    maxImageMb: 5,
  },
}

export default DEFAULT_SETTINGS

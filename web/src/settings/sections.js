import { Cpu, Gauge, Settings, ShieldCheck, Sprout, Upload, Zap } from 'lucide-react'

// Satu sumber metadata sub-tab Settings: label, ikon, judul kartu, deskripsi, dan
// kunci seksi di SETTINGS (null untuk tab yang tidak memakai draft).
export const SETTINGS_SECTIONS = [
  {
    key: 'umum',
    label: 'Umum',
    Icon: Settings,
    settingKey: 'general',
    title: 'Umum',
    description: 'Identitas kebun yang tampil di header aplikasi.',
  },
  {
    key: 'plan',
    label: 'Plan',
    Icon: Sprout,
    settingKey: 'plan',
    title: 'Plan',
    description: 'Ambang status panen dan toleransi nutrisi terhadap resep.',
  },
  {
    key: 'monitoring',
    label: 'Monitoring',
    Icon: Gauge,
    settingKey: 'monitoring',
    title: 'Monitoring',
    description: 'Interval polling dan ambang warna/alert kartu sensor.',
  },
  {
    key: 'listrik',
    label: 'Listrik',
    Icon: Zap,
    settingKey: 'listrik',
    title: 'Listrik',
    description: 'Tarif dan ambang anomali PZEM-004T.',
  },
  {
    key: 'perangkat',
    label: 'Perangkat',
    Icon: Cpu,
    settingKey: 'device',
    title: 'Perangkat',
    description:
      'Preferensi aktuator. Simpan hanya menyimpan nilai; kirim ke perangkat lewat tombol Terapkan.',
  },
  {
    key: 'batas',
    label: 'Batas',
    Icon: Upload,
    settingKey: 'limits',
    title: 'Batas & Unggahan',
    description: 'Batas catatan dan gambar pada Plan.',
  },
  {
    key: 'keamanan',
    label: 'Keamanan',
    Icon: ShieldCheck,
    settingKey: null,
    title: 'Keamanan',
    description: 'PIN dipakai untuk semua perubahan pengaturan.',
  },
]

export const DEFAULT_SECTION = 'umum'

export function findSection(key) {
  return SETTINGS_SECTIONS.find((section) => section.key === key) || null
}

export default SETTINGS_SECTIONS

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { useSettings } from '../settings/SettingsProvider.jsx'
import usePinGate from '../settings/usePinGate.js'
import PinPromptModal from '../settings/PinPromptModal.jsx'
import { DEFAULT_SECTION, SETTINGS_SECTIONS, findSection } from '../settings/sections.js'
import { useToast } from '../features/iot/Toast.jsx'
import { BottomTabs, Tabs } from './Tabs.jsx'
import GeneralSection from './settings/GeneralSection.jsx'
import PlanSection from './settings/PlanSection.jsx'
import MonitoringSection from './settings/MonitoringSection.jsx'
import ListrikSection from './settings/ListrikSection.jsx'
import DeviceSection from './settings/DeviceSection.jsx'
import WifiSection from './settings/WifiSection.jsx'
import LimitsSection from './settings/LimitsSection.jsx'
import SecuritySection from './settings/SecuritySection.jsx'

// Seksi yang punya draft setting (SecuritySection & WifiSection tidak).
const DRAFT_SECTIONS = SETTINGS_SECTIONS.filter((s) => s.settingKey)

const SECTION_COMPONENTS = {
  umum: GeneralSection,
  plan: PlanSection,
  monitoring: MonitoringSection,
  listrik: ListrikSection,
  perangkat: DeviceSection,
  wifi: WifiSection,
  batas: LimitsSection,
  keamanan: SecuritySection,
}

function isSame(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function buildDrafts(settings) {
  const drafts = {}
  for (const section of DRAFT_SECTIONS) drafts[section.key] = settings[section.settingKey]
  return drafts
}

function buildLastSynced(settings) {
  const map = {}
  for (const section of DRAFT_SECTIONS) map[section.key] = settings[section.settingKey]
  return map
}

export default function SettingsPage() {
  const { section: routeSection } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { settings, loading, error, pinIsDefault, saveSection, changePin, refresh } = useSettings()
  const gate = usePinGate()

  const section = findSection(routeSection || DEFAULT_SECTION)
  const activeKey = section ? section.key : DEFAULT_SECTION

  // Sub-route tak dikenal -> arahkan ke tab default (tanpa menambah history).
  useEffect(() => {
    if (routeSection && !findSection(routeSection)) {
      navigate(`/settings/${DEFAULT_SECTION}`, { replace: true })
    }
  }, [routeSection, navigate])

  // Draft tiap seksi diangkat ke sini agar tidak hilang saat pindah tab.
  const [drafts, setDrafts] = useState(() => buildDrafts(settings))
  const [busyKey, setBusyKey] = useState('')
  // Nilai server terakhir yang sudah tercermin di draft, per seksi.
  const lastSynced = useRef(buildLastSynced(settings))

  // Sinkronkan draft dengan nilai server: draft yang tidak kotor ikut berubah,
  // draft kotor dipertahankan.
  useEffect(() => {
    const previous = lastSynced.current
    const next = buildLastSynced(settings)
    lastSynced.current = next

    setDrafts((current) => {
      let changed = false
      const merged = { ...current }
      for (const s of DRAFT_SECTIONS) {
        if (isSame(current[s.key], previous[s.key])) {
          if (!isSame(current[s.key], next[s.key])) changed = true
          merged[s.key] = next[s.key]
        }
      }
      return changed ? merged : current
    })
  }, [settings])

  const dirtyBySection = useMemo(() => {
    const map = {}
    for (const s of DRAFT_SECTIONS) {
      map[s.key] = !isSame(drafts[s.key], settings[s.settingKey])
    }
    return map
  }, [drafts, settings])

  const dirtyKeys = DRAFT_SECTIONS.filter((s) => dirtyBySection[s.key]).map((s) => s.key)

  const setField = useCallback((key, field, value) => {
    setDrafts((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }))
  }, [])

  const resetSection = useCallback(
    (key, sectionMeta) => {
      setDrafts((prev) => ({ ...prev, [key]: settings[sectionMeta.settingKey] }))
      lastSynced.current[key] = settings[sectionMeta.settingKey]
    },
    [settings]
  )

  async function handleSave(key, values) {
    setBusyKey(key)
    try {
      await gate.guarded(
        (pinOverride) => saveSection(key, values, pinOverride),
        () => toast.success('Pengaturan tersimpan.')
      )
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusyKey('')
    }
  }

  function changeTab(key) {
    if (key === activeKey) return
    navigate(`/settings/${key}`)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Tab Keamanan: form PIN lokal.
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [pinLocalError, setPinLocalError] = useState('')
  const [pinBusy, setPinBusy] = useState(false)

  async function handleChangePin(e) {
    e.preventDefault()
    setPinLocalError('')
    if (newPin.trim().length < 4) {
      setPinLocalError('PIN minimal 4 karakter.')
      return
    }
    if (newPin.trim().length > 64) {
      setPinLocalError('PIN maksimal 64 karakter.')
      return
    }
    if (newPin !== confirmPin) {
      setPinLocalError('Konfirmasi PIN tidak sama.')
      return
    }
    setPinBusy(true)
    try {
      const done = await gate.guarded(
        (pinOverride) => changePin(newPin, pinOverride),
        () => toast.success('PIN berhasil diganti.')
      )
      // Jangan kosongkan form bila PIN modal masih terbuka (belum tersimpan).
      if (done) {
        setNewPin('')
        setConfirmPin('')
      }
    } catch (err) {
      toast.error(err.message)
    } finally {
      setPinBusy(false)
    }
  }

  const ActiveSection = SECTION_COMPONENTS[activeKey] || GeneralSection
  const activeMeta = findSection(activeKey)

  const sectionProps = activeMeta?.settingKey
    ? {
        draft: drafts[activeKey],
        set: (field, value) => setField(activeKey, field, value),
        dirty: Boolean(dirtyBySection[activeKey]),
        busy: busyKey === activeKey,
        onSave: () => handleSave(activeMeta.settingKey, drafts[activeKey]),
        onReset: () => resetSection(activeKey, activeMeta),
      }
    : activeKey === 'wifi'
      ? { gate }
      : {
          newPin,
          confirmPin,
          onNewPin: setNewPin,
          onConfirmPin: setConfirmPin,
          localError: pinLocalError,
          busy: pinBusy,
          pinIsDefault,
          pinActive: gate.hasPin,
          onSubmit: handleChangePin,
        }

  // Metadata tab untuk Tabs/BottomTabs (bentuk sama dengan tab Plan).
  const tabs = SETTINGS_SECTIONS.map(({ key, label, Icon }) => ({ key, label, Icon }))
  const renderBadge = (key) =>
    dirtyKeys.includes(key) ? (
      <span
        className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-ios-orange"
        aria-label="Ada perubahan belum disimpan"
      />
    ) : null

  return (
    <>
      <div className="glass-panel p-4 mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div>
            <h1 className="text-xl font-bold text-text-hi">Pengaturan</h1>
            <p className="hidden md:block text-sm text-text-low mt-0.5">
              Nilai operasional yang dipakai bersama Monitoring, Listrik, dan Plan.
            </p>
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            aria-label="Muat ulang pengaturan"
            title="Muat ulang pengaturan"
            className="btn-ios mt-0.5 inline-flex items-center justify-center rounded-xl bg-white/10
              text-text-body p-2 disabled:opacity-60"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : undefined} aria-hidden="true" />
          </button>
        </div>
        <Tabs
          active={activeKey}
          onChange={changeTab}
          tabs={tabs}
          idPrefix="settings-tab"
          renderBadge={renderBadge}
        />
      </div>

      <div className="space-y-6 pb-20 md:pb-0">
        {pinIsDefault && (
          <div className="rounded-lg bg-ios-orange/10 border border-ios-orange/40 text-ios-orange text-sm px-4 py-3">
            PIN Settings masih default (<strong>1234</strong>). Ganti lewat tab{' '}
            <button
              type="button"
              onClick={() => changeTab('keamanan')}
              className="font-semibold underline underline-offset-2"
            >
              Keamanan
            </button>
            .
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-ios-red/10 border border-ios-red/40 text-ios-red text-sm px-4 py-3">
            Gagal memuat pengaturan: {error} (memakai nilai cache/default)
          </div>
        )}

        <div role="tabpanel" aria-labelledby={`settings-tab-${activeKey}`}>
          <ActiveSection key={activeKey} {...sectionProps} />
        </div>
      </div>

      <PinPromptModal gate={gate} />

      <BottomTabs
        active={activeKey}
        onChange={changeTab}
        tabs={tabs}
        idPrefix="settings-bottom-tab"
        renderBadge={renderBadge}
        scrollable
      />
    </>
  )
}

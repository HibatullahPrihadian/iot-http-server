import { Field, FieldsGrid, LABEL, ThresholdGroup } from './fields.jsx'
import SectionShell, { SectionActions } from './SectionShell.jsx'
import { findSection } from '../../settings/sections.js'

const meta = findSection('monitoring')

export default function MonitoringSection({ draft, set, dirty, busy, onSave, onReset }) {
  const th = draft.thresholds
  const setTh = (sensor, field, value) =>
    set('thresholds', { ...th, [sensor]: { ...th[sensor], [field]: value } })

  return (
    <SectionShell title={meta.title} description={meta.description}>
      <FieldsGrid>
        <Field
          label="Polling Monitoring (detik)"
          value={draft.pollHidroSeconds}
          onChange={(v) => set('pollHidroSeconds', v)}
          min={1}
          max={60}
        />
        <Field
          label="Polling Listrik (detik)"
          value={draft.pollListrikSeconds}
          onChange={(v) => set('pollListrikSeconds', v)}
          min={1}
          max={60}
        />
        <Field
          label="Batas data basi (menit)"
          value={draft.onlineWindowMinutes}
          onChange={(v) => set('onlineWindowMinutes', v)}
          min={1}
          max={60}
          hint="Sensor dianggap offline bila data terakhir lebih tua dari ini."
        />

        <div className="sm:col-span-2 mt-2">
          <p className={LABEL}>Ambang sensor</p>
          <div className="grid gap-3 sm:grid-cols-2 mt-2">
            <ThresholdGroup title="Suhu Air (°C)">
              <Field
                label="Warning"
                value={th.suhu_air.warn}
                onChange={(v) => setTh('suhu_air', 'warn', v)}
              />
              <Field
                label="Danger"
                value={th.suhu_air.danger}
                onChange={(v) => setTh('suhu_air', 'danger', v)}
              />
            </ThresholdGroup>
            <ThresholdGroup title="Suhu Udara (°C)">
              <Field
                label="Warning"
                value={th.suhu_udara.warn}
                onChange={(v) => setTh('suhu_udara', 'warn', v)}
              />
              <Field
                label="Danger"
                value={th.suhu_udara.danger}
                onChange={(v) => setTh('suhu_udara', 'danger', v)}
              />
            </ThresholdGroup>
            <ThresholdGroup title="Kadar TDS (ppm)">
              <Field
                label="Danger rendah"
                value={th.kadar_tds.dangerLow}
                onChange={(v) => setTh('kadar_tds', 'dangerLow', v)}
              />
              <Field
                label="Warning rendah"
                value={th.kadar_tds.warnLow}
                onChange={(v) => setTh('kadar_tds', 'warnLow', v)}
              />
              <Field
                label="Warning tinggi"
                value={th.kadar_tds.warnHigh}
                onChange={(v) => setTh('kadar_tds', 'warnHigh', v)}
              />
              <Field
                label="Danger tinggi"
                value={th.kadar_tds.dangerHigh}
                onChange={(v) => setTh('kadar_tds', 'dangerHigh', v)}
              />
            </ThresholdGroup>
            <ThresholdGroup title="Kelembapan Udara (%)">
              <Field
                label="Danger rendah"
                value={th.kelembapan_udara.dangerLow}
                onChange={(v) => setTh('kelembapan_udara', 'dangerLow', v)}
              />
              <Field
                label="Danger tinggi"
                value={th.kelembapan_udara.dangerHigh}
                onChange={(v) => setTh('kelembapan_udara', 'dangerHigh', v)}
              />
            </ThresholdGroup>
            <ThresholdGroup title="Kadar pH">
              <Field
                label="Danger rendah"
                value={th.kadar_ph.dangerLow}
                onChange={(v) => setTh('kadar_ph', 'dangerLow', v)}
                step="0.1"
              />
              <Field
                label="Danger tinggi"
                value={th.kadar_ph.dangerHigh}
                onChange={(v) => setTh('kadar_ph', 'dangerHigh', v)}
                step="0.1"
              />
            </ThresholdGroup>
            <ThresholdGroup title="Intensitas UV">
              <Field
                label="Danger rendah"
                value={th.intensitas_uv.dangerLow}
                onChange={(v) => setTh('intensitas_uv', 'dangerLow', v)}
              />
              <Field
                label="Danger tinggi"
                value={th.intensitas_uv.dangerHigh}
                onChange={(v) => setTh('intensitas_uv', 'dangerHigh', v)}
              />
            </ThresholdGroup>
          </div>
        </div>
      </FieldsGrid>
      <SectionActions dirty={dirty} busy={busy} onSave={onSave} onReset={onReset} />
    </SectionShell>
  )
}

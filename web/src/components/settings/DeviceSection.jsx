import { Field, FieldsGrid, LABEL } from './fields.jsx'
import SectionShell, { SectionActions } from './SectionShell.jsx'
import DeviceInfo from './DeviceInfo.jsx'
import ApplyButtons from './ApplyButtons.jsx'
import { INPUT } from '../Modal.jsx'
import { findSection } from '../../settings/sections.js'

const meta = findSection('perangkat')

export default function DeviceSection({ draft, set, dirty, busy, onSave, onReset }) {
  return (
    <div className="space-y-5">
      <SectionShell title={meta.title} description={meta.description}>
        <FieldsGrid>
          <Field
            label="Interval uplink (detik)"
            value={draft.uplinkIntervalSeconds}
            onChange={(v) => set('uplinkIntervalSeconds', v)}
            min={10}
            max={3600}
          />
          <Field
            label="Opsi interval (detik)"
            type="text"
            value={(draft.uplinkIntervalOptions || []).join(', ')}
            onChange={(v) =>
              set(
                'uplinkIntervalOptions',
                v
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
              )
            }
            hint="Pisahkan dengan koma, 1-8 angka. Wajib memuat interval uplink."
          />
          <Field
            label="Target dosing (ppm)"
            value={draft.dosingTargetPpm}
            onChange={(v) => set('dosingTargetPpm', v)}
            min={1}
          />
          <Field
            label="Volume air dosing (L)"
            value={draft.dosingVolumeLiters}
            onChange={(v) => set('dosingVolumeLiters', v)}
            min={1}
          />
          <Field
            label="Konstanta pupuk (K)"
            value={draft.dosingConstant}
            onChange={(v) => set('dosingConstant', v)}
            min={1}
          />
          <Field
            label="Durasi pompa maksimum (detik)"
            value={draft.maxPumpSeconds}
            onChange={(v) => set('maxPumpSeconds', v)}
            min={1}
            max={3600}
          />
          <div className="sm:col-span-2">
            <p className={LABEL}>Label relay</p>
            <div className="grid gap-2 sm:grid-cols-4 mt-1.5">
              {[0, 1, 2, 3].map((i) => (
                <input
                  key={i}
                  type="text"
                  value={draft.relayLabels?.[i] ?? ''}
                  onChange={(e) => {
                    const next = [...(draft.relayLabels || [])]
                    next[i] = e.target.value
                    set('relayLabels', next)
                  }}
                  className={INPUT}
                  aria-label={`Label relay ${i + 1}`}
                  maxLength={30}
                />
              ))}
            </div>
          </div>
        </FieldsGrid>
        <SectionActions
          dirty={dirty}
          busy={busy}
          onSave={onSave}
          onReset={onReset}
          footer={<ApplyButtons />}
        />
      </SectionShell>

      <DeviceInfo />
    </div>
  )
}

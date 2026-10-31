import { Field, FieldsGrid } from './fields.jsx'
import SectionShell, { SectionActions } from './SectionShell.jsx'
import { findSection } from '../../settings/sections.js'

const meta = findSection('listrik')

export default function ListrikSection({ draft, set, dirty, busy, onSave, onReset }) {
  return (
    <SectionShell title={meta.title} description={meta.description}>
      <FieldsGrid>
        <Field
          label="Tarif (Rp/kWh)"
          value={draft.tariffPerKwh}
          onChange={(v) => set('tariffPerKwh', v)}
          step="0.1"
          min={0}
          hint="Dipakai untuk estimasi biaya di halaman Listrik."
        />
        <Field
          label="Faktor daya warning"
          value={draft.powerFactorWarn}
          onChange={(v) => set('powerFactorWarn', v)}
          step="0.01"
          min={0}
          max={1}
        />
        <Field
          label="Tegangan danger rendah (V)"
          value={draft.voltageDangerLow}
          onChange={(v) => set('voltageDangerLow', v)}
          step="0.1"
        />
        <Field
          label="Tegangan warning rendah (V)"
          value={draft.voltageWarnLow}
          onChange={(v) => set('voltageWarnLow', v)}
          step="0.1"
        />
        <Field
          label="Tegangan warning tinggi (V)"
          value={draft.voltageWarnHigh}
          onChange={(v) => set('voltageWarnHigh', v)}
          step="0.1"
        />
        <Field
          label="Tegangan danger tinggi (V)"
          value={draft.voltageDangerHigh}
          onChange={(v) => set('voltageDangerHigh', v)}
          step="0.1"
        />
      </FieldsGrid>
      <SectionActions dirty={dirty} busy={busy} onSave={onSave} onReset={onReset} />
    </SectionShell>
  )
}

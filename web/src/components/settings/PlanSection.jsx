import { Field, FieldsGrid } from './fields.jsx'
import SectionShell, { SectionActions } from './SectionShell.jsx'
import { findSection } from '../../settings/sections.js'

const meta = findSection('plan')

export default function PlanSection({ draft, set, dirty, busy, onSave, onReset }) {
  return (
    <SectionShell title={meta.title} description={meta.description}>
      <FieldsGrid>
        <Field
          label="Siap panen (hari)"
          value={draft.harvestReadyDays}
          onChange={(v) => set('harvestReadyDays', v)}
          min={0}
          max={30}
          hint="Batch Meja 1-2 berstatus Siap Panen bila sisa hari <= nilai ini."
        />
        <Field
          label="Banner perlu panen (hari)"
          value={draft.harvestBannerDays}
          onChange={(v) => set('harvestBannerDays', v)}
          min={0}
          max={30}
          hint="Banner peringatan muncul bila sisa hari <= nilai ini."
        />
        <Field
          label="Toleransi ppm (%)"
          value={draft.ppmTolerancePct}
          onChange={(v) => set('ppmTolerancePct', v)}
          min={1}
          max={50}
          hint="Penyimpangan ppm dari target resep yang dianggap aman."
        />
        <Field
          label="pH fallback minimum"
          value={draft.phFallbackMin}
          onChange={(v) => set('phFallbackMin', v)}
          step="0.1"
          min={0}
          max={14}
          hint="Dipakai bila resep belum punya rentang pH."
        />
        <Field
          label="pH fallback maksimum"
          value={draft.phFallbackMax}
          onChange={(v) => set('phFallbackMax', v)}
          step="0.1"
          min={0}
          max={14}
        />
      </FieldsGrid>
      <SectionActions dirty={dirty} busy={busy} onSave={onSave} onReset={onReset} />
    </SectionShell>
  )
}

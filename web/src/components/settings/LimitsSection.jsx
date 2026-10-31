import { Field, FieldsGrid } from './fields.jsx'
import SectionShell, { SectionActions } from './SectionShell.jsx'
import { findSection } from '../../settings/sections.js'

const meta = findSection('batas')

export default function LimitsSection({ draft, set, dirty, busy, onSave, onReset }) {
  return (
    <SectionShell title={meta.title} description={meta.description}>
      <FieldsGrid>
        <Field
          label="Catatan maksimum (karakter)"
          value={draft.maxNotesChars}
          onChange={(v) => set('maxNotesChars', v)}
          min={100}
          max={10000}
        />
        <Field
          label="Gambar maksimum per batch"
          value={draft.maxImagesPerBatch}
          onChange={(v) => set('maxImagesPerBatch', v)}
          min={1}
          max={20}
        />
        <Field
          label="Ukuran gambar maksimum (MB)"
          value={draft.maxImageMb}
          onChange={(v) => set('maxImageMb', v)}
          min={1}
          max={20}
        />
      </FieldsGrid>
      <SectionActions dirty={dirty} busy={busy} onSave={onSave} onReset={onReset} />
    </SectionShell>
  )
}

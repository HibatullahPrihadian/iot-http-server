import { Field, FieldsGrid } from './fields.jsx'
import SectionShell, { SectionActions } from './SectionShell.jsx'
import { findSection } from '../../settings/sections.js'

const meta = findSection('umum')

export default function GeneralSection({ draft, set, dirty, busy, onSave, onReset }) {
  return (
    <SectionShell title={meta.title} description={meta.description}>
      <FieldsGrid>
        <Field
          label="Nama kebun"
          type="text"
          value={draft.farmName}
          onChange={(v) => set('farmName', v)}
          hint="1-60 karakter."
        />
      </FieldsGrid>
      <SectionActions dirty={dirty} busy={busy} onSave={onSave} onReset={onReset} />
    </SectionShell>
  )
}

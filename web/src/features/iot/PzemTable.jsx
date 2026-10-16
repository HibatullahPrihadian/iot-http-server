import { PZEM_METRICS, PZEM_ORDER, pzemValueOrNull } from './listrikUtils.js'

// Tabel log listrik (terbaru dulu) — paralel SensorTable.jsx.
export default function PzemTable({ data }) {
  const rows = [...data].reverse()

  return (
    <div className="glass-panel my-8 mx-auto max-w-[1300px] p-6 overflow-x-auto">
      <h3 className="mt-0 mb-4 text-white font-semibold text-lg tracking-[-0.3px] text-glow-white">
        Riwayat Log Listrik
      </h3>
      <div className="overflow-y-auto rounded-xl" style={{ maxHeight: 400 }}>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-text-low">
              <th className="px-4 py-3.5 font-semibold sticky top-0 z-[1] bg-[rgba(28,28,30,0.95)] backdrop-blur">
                Waktu (Timestamp)
              </th>
              {PZEM_ORDER.map((key) => {
                const meta = PZEM_METRICS[key]
                return (
                  <th
                    key={key}
                    className="px-4 py-3.5 font-semibold sticky top-0 z-[1] bg-[rgba(28,28,30,0.95)] backdrop-blur"
                  >
                    {meta.label}
                    {meta.unit ? ` (${meta.unit})` : ''}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={PZEM_ORDER.length + 1} className="px-4 py-4 text-text-low">
                  Belum ada data.
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr
                  key={`${row.waktu}-${i}`}
                  className="border-b border-white/8 hover:bg-white/5 transition"
                >
                  <td className="px-4 py-3.5 text-text-dim">
                    {new Date(row.waktu).toLocaleString('id-ID')}
                  </td>
                  {PZEM_ORDER.map((key) => (
                    <td key={key} className="px-4 py-3.5 text-text-dim">
                      {pzemValueOrNull(row, key) ?? '—'}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

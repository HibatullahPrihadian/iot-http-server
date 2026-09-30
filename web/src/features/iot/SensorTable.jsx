import { sensorValue } from './utils.js'

// Tabel log sensor (terbaru dulu) — port dari index.html tabel riwayat.
export default function SensorTable({ data }) {
  const rows = [...data].reverse()

  return (
    <div className="glass-panel my-8 mx-auto max-w-[1300px] p-6 overflow-x-auto">
      <h3 className="mt-0 mb-4 text-white font-semibold text-lg tracking-[-0.3px] text-glow-white">
        Riwayat Log Sensor
      </h3>
      <div
        className="overflow-y-auto rounded-xl"
        style={{ maxHeight: 400 }}
      >
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-text-low">
              {[
                'Waktu (Timestamp)',
                'Suhu Udara',
                'Kelembapan',
                'TDS (ppm)',
                'pH',
                'UV',
                'Suhu Air',
              ].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3.5 font-semibold sticky top-0 z-[1] bg-[rgba(28,28,30,0.95)] backdrop-blur"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-4 text-text-low">
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
                  <td className="px-4 py-3.5 text-text-dim">{sensorValue(row, 'suhu_udara')}°C</td>
                  <td className="px-4 py-3.5 text-text-dim">
                    {sensorValue(row, 'kelembapan_udara')}%
                  </td>
                  <td className="px-4 py-3.5 text-text-dim">{sensorValue(row, 'kadar_tds')}</td>
                  <td className="px-4 py-3.5 text-text-dim">{sensorValue(row, 'kadar_ph')}</td>
                  <td className="px-4 py-3.5 text-text-dim">{sensorValue(row, 'intensitas_uv')}</td>
                  <td className="px-4 py-3.5 text-text-dim">{sensorValue(row, 'suhu_air')}°C</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

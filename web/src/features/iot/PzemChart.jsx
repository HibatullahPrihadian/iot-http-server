import { useMemo } from 'react'
import {
  Chart as ChartJS,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import { PZEM_METRICS, computePzemYMax } from './listrikUtils.js'
import { makeGradient } from './utils.js'

ChartJS.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
  Tooltip,
  Legend
)

ChartJS.defaults.color = '#aeaeb2'
ChartJS.defaults.font.family =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
ChartJS.defaults.font.size = 12

// Chart line metrik listrik (PZEM-004T) — tanpa annotation/resep.
export default function PzemChart({ metricKey, labels, values, height = 230 }) {
  const meta = PZEM_METRICS[metricKey]

  const yMax = useMemo(() => computePzemYMax(values, meta), [values, meta])

  const data = useMemo(
    () => ({
      labels,
      datasets: [
        {
          data: values,
          borderColor: meta.color,
          backgroundColor: (context) => {
            const { ctx, chartArea } = context.chart
            return makeGradient(ctx, chartArea, meta.color)
          },
          borderWidth: 2.5,
          pointRadius: 0,
          pointHoverRadius: 6,
          fill: true,
          tension: 0.4,
          spanGaps: true,
        },
      ],
    }),
    [labels, values, meta.color]
  )

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.04)' },
          ticks: { maxTicksLimit: 7 },
        },
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.04)', drawBorder: false },
          min: meta.yMin,
          max: yMax,
          beginAtZero: true,
        },
      },
      interaction: { mode: 'index', intersect: false },
    }),
    [meta.yMin, yMax]
  )

  return (
    <div style={{ position: 'relative', width: '100%', height }}>
      <Line data={data} options={options} />
    </div>
  )
}
